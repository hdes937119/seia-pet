/**
 * 西雅的工作桌（2026-11-09，主人選方案 2）：桌寵資料夾裡的「西雅的工作桌」，主人在 Windows 上直接打開就看得到。
 *
 *   成品\     她在工坊做好的作品，做完自動複製一份過來（每件一個資料夾）
 *   委託\     委託做出來的網頁、報告，每次工作做完（或工具跑完）自動更新
 *   給西雅\   主人想給她看的檔案放這裡：她聊天、研究、委託時都看得到，工坊開工時也會唯讀放進去
 *
 * 工坊本身還是隔離的（WSL、沙盒）：她寫的程式碰不到這個資料夾以外的地方。複製由桌寵後端（Windows 這邊）做。
 * 她自己的資料夾（成品、委託底下）會被新版覆蓋；「給西雅」她只能讀。
 */
import fs from 'fs';
import path from 'path';

export const DESK_NAME = '西雅的工作桌';
const SUB = { works: '成品', commissions: '委託', research: '研究', inbox: '給西雅' } as const;
const SKIP_COMMISSION = new Set(['PLAN.md', 'HANDOFF.md', 'STEP_RESULT.md', 'TOOL.json']);
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 200;

const README = `這是西雅的工作桌（桌寵自動建立的）

成品\\    西雅在工坊做好的小作品，做完會自動放一份到這裡（每件一個資料夾，雙擊 index.html 就能打開）
委託\\    你交代的委託做出來的網頁和報告，她每做完一步就會更新
研究\\    你叫她研究的專案或網頁（例如 GitHub 連結），報告是 RESULT.md
給西雅\\  你想給她看的檔案（文字、程式、資料）放這裡，她聊天、研究、做委託時都看得到（她只能讀，不會改）

西雅的程式還是在隔離的工坊裡跑，碰不到這個資料夾以外的東西。
`;

/** 資料夾名稱裡不能用的字元換掉 */
export function safeName(s: string) {
  const t = String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 40);
  return t || '未命名';
}

export function createDesk(projectRoot: string, dataDir: string, log: (m: string) => void = console.log) {
  const root = path.join(projectRoot, DESK_NAME);
  const dir = (k: keyof typeof SUB) => path.join(root, SUB[k]);

  function ensure() {
    try {
      for (const k of Object.keys(SUB) as Array<keyof typeof SUB>) fs.mkdirSync(dir(k), { recursive: true });
      const readme = path.join(root, '說明.txt');
      let old = '';
      try {
        old = fs.readFileSync(readme, 'utf8');
      } catch {
        old = '';
      }
      if (!old.includes('研究\\')) fs.writeFileSync(readme, '﻿' + README.replace(/\n/g, '\r\n'));
    } catch (err: any) {
      log(`[工作桌] 建立失敗：${err?.message}`);
    }
  }
  ensure();

  /** 複製一個資料夾（只複製檔案；skip 回傳 true 的相對路徑跳過）；回傳複製了幾個 */
  function copyTree(src: string, dest: string, skip: (rel: string) => boolean): number {
    let n = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (n >= MAX_FILES) return;
        const f = path.join(d, e.name);
        const rel = path.relative(src, f).split(path.sep).join('/');
        if (skip(rel)) continue;
        if (e.isDirectory()) walk(f);
        else if (e.isFile()) {
          const st = fs.statSync(f);
          if (st.size > MAX_FILE) continue;
          const to = path.join(dest, rel);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(f, to);
          n++;
        }
      }
    };
    walk(src);
    return n;
  }

  /** 哪個資料夾是哪一件（記在 data 裡，不在工作桌上多放檔案） */
  const mapFile = path.join(dataDir, 'desk-map.json');
  let map: Record<string, string> = {};
  try {
    if (fs.existsSync(mapFile)) map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  } catch {
    map = {};
  }
  /** 名字撞到別的東西：同一件（id 一樣）沿用，不一樣就加短 id */
  function slot(base: string, name: string, id: string): string {
    const known = map[id];
    if (known && fs.existsSync(known) && path.dirname(known) === base) return known;
    let p = path.join(base, safeName(name));
    if (fs.existsSync(p) && Object.entries(map).some(([k, v]) => v === p && k !== id)) p = path.join(base, `${safeName(name)}（${id.replace(/^title:/, '').slice(-6)}）`);
    fs.mkdirSync(p, { recursive: true });
    map[id] = p;
    try {
      fs.writeFileSync(mapFile, JSON.stringify(map, null, 1));
    } catch {
      // 沒關係
    }
    return p;
  }

  /** 工坊作品做好了 → 成品\<作品名>\ */
  function putWork(w: { id: string; title: string; entry?: string }, workDir: string): string {
    if (!w.entry || !fs.existsSync(workDir)) return '';
    try {
      ensure();
      const dest = slot(dir('works'), w.title, w.id);
      const n = copyTree(workDir, dest, (rel) => /^_skilltest(\/|$)|^_skills(\/|$)|^deliver(\/|$)/.test(rel));
      const shown = `${DESK_NAME}\\${SUB.works}\\${path.basename(dest)}`;
      log(`[工作桌] 作品「${w.title}」放到 ${shown}（${n} 個檔案）`);
      return shown;
    } catch (err: any) {
      log(`[工作桌] 放作品失敗：${err?.message}`);
      return '';
    }
  }

  /** 委託做完一步、或工具跑完 → 委託\<委託名>\（不含計畫、交接筆記、資料庫） */
  function putCommission(c: { id: string; title: string }, wsDir: string): string {
    if (!fs.existsSync(wsDir)) return '';
    try {
      ensure();
      const dest = slot(dir('commissions'), c.title, c.id);
      const n = copyTree(wsDir, dest, (rel) => SKIP_COMMISSION.has(rel) || /^(data|_desk|node_modules|__pycache__|\.cache|\.git)(\/|$)/.test(rel));
      const shown = `${DESK_NAME}\\${SUB.commissions}\\${path.basename(dest)}`;
      if (n) log(`[工作桌] 委託「${c.title}」更新到 ${shown}（${n} 個檔案）`);
      return shown;
    } catch (err: any) {
      log(`[工作桌] 放委託失敗：${err?.message}`);
      return '';
    }
  }

  /** 研究做完（實驗室 study）→ 研究\<題目>\（RESULT.md 和小的輸出檔，不含下載下來的專案 _repo） */
  function putStudy(w: { id: string; title: string }, workDir: string, sub: 'research' | 'works' = 'research'): string {
    if (!fs.existsSync(workDir)) return '';
    try {
      ensure();
      const dest = slot(dir(sub), w.title, `${sub === 'works' ? 'task' : 'study'}:${w.title}`);
      const n = copyTree(workDir, dest, (rel) => /^(_repo|_skills|_skilltest|_prev|deliver|\.venv|node_modules|\.cache)(\/|$)/.test(rel));
      const shown = `${DESK_NAME}\\${SUB[sub]}\\${path.basename(dest)}`;
      log(`[工作桌] 研究「${w.title}」放到 ${shown}（${n} 個檔案）`);
      return shown;
    } catch (err: any) {
      log(`[工作桌] 放研究失敗：${err?.message}`);
      return '';
    }
  }

  /** 「給西雅」裡的檔案清單 */
  function inbox(max = 40): Array<{ rel: string; bytes: number; at: number }> {
    const out: Array<{ rel: string; bytes: number; at: number }> = [];
    const base = dir('inbox');
    const walk = (d: string) => {
      let list: fs.Dirent[] = [];
      try {
        list = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of list) {
        if (out.length >= max) return;
        if (e.name.startsWith('.')) continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.isFile()) {
          const st = fs.statSync(f);
          out.push({ rel: path.relative(base, f).split(path.sep).join('/'), bytes: st.size, at: st.mtimeMs });
        }
      }
    };
    walk(base);
    return out.sort((a, b) => b.at - a.at);
  }

  /** 讀「給西雅」裡的一個文字檔 */
  function readInbox(rel: string, max = 12000): { ok: boolean; text?: string; reason?: string } {
    const r = String(rel || '').replace(/\\/g, '/').trim();
    if (!r || r.includes('..') || /^[/]/.test(r) || /^[a-zA-Z]:/.test(r)) return { ok: false, reason: '路徑不對' };
    const base = dir('inbox');
    const p = path.normalize(path.join(base, r));
    if (!p.startsWith(base + path.sep) || !fs.existsSync(p)) return { ok: false, reason: `「給西雅」裡沒有 ${r}` };
    const buf = fs.readFileSync(p);
    if (buf.subarray(0, 4000).includes(0)) return { ok: false, reason: '這不是文字檔（圖片、壓縮檔這類現在讀不了）' };
    return { ok: true, text: buf.toString('utf8').replace(/^﻿/, '').slice(0, max) };
  }

  /** 開工時要放進去的「給西雅」檔案（委託工作區的 _desk/ 用）；太大的不放 */
  function inboxFiles(maxTotal = 10 * 1024 * 1024): Array<{ rel: string; data: Buffer }> {
    const out: Array<{ rel: string; data: Buffer }> = [];
    let total = 0;
    for (const f of inbox(100)) {
      if (total + f.bytes > maxTotal) continue;
      try {
        out.push({ rel: f.rel, data: fs.readFileSync(path.join(dir('inbox'), f.rel)) });
        total += f.bytes;
      } catch {
        // 讀不到就算了
      }
    }
    return out;
  }

  /** 給她看：工作桌上有什麼 */
  function describe(): string {
    const list = (k: keyof typeof SUB) => {
      try {
        return fs.readdirSync(dir(k), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    };
    const files = inbox(15);
    return [
      `你和主人共用的工作桌：桌寵資料夾裡的「${DESK_NAME}」（主人在 Windows 直接打開就看得到；設定面板工坊那裡也有「打開工作桌」）。`,
      `- ${SUB.works}\\：你在工坊做好的作品會自動放進來（${list('works').slice(-8).join('、') || '還沒有'}）`,
      `- ${SUB.commissions}\\：委託做出來的網頁和報告，每做完一步自動更新（${list('commissions').slice(-8).join('、') || '還沒有'}）`,
      `- ${SUB.research}\\：主人叫你研究的專案／網頁的報告（${list('research').slice(-8).join('、') || '還沒有'}）`,
      `- ${SUB.inbox}\\：主人放給你看的檔案（${files.length ? files.map((f) => `${f.rel}（${Math.ceil(f.bytes / 1024)}KB）`).join('、') : '現在是空的'}）；用 my_desk 讀`,
      '做好的東西不用搬也不用送行動提案，程式會自動放上工作桌；請主人去工作桌（或設定面板）打開就好。',
    ].join('\n');
  }

  return { root, ensure, putWork, putCommission, putStudy, inbox, readInbox, inboxFiles, describe, inboxDir: () => dir('inbox') };
}

export type Desk = ReturnType<typeof createDesk>;
