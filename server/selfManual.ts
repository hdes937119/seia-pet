/**
 * 西雅的說明書＋查自己（11/24，主人選「甲＋乙」）
 *
 * 乙：data/SELF.md ＝「我是怎麼運作的」。初版由系統整理（SEED），之後由她自己維護：
 *     聊天時用 update_manual 改，工坊改完她自己的程式也要回來更新相關段落。
 * 甲：她不確定自己的事（能不能做、怎麼運作、為什麼會這樣）時，先翻說明書；說明書沒寫，就用 inspect_self
 *     在自己的程式裡查（唯讀：搜尋、讀片段、看資料夾），查到可以改再問主人要不要用工坊改。
 *
 * 讀程式的範圍：桌寵專案資料夾，跳過 data（記憶）、node_modules、TTS、logs、.git、工作桌、金鑰檔。
 */
import fs from 'fs';
import path from 'path';

const SKIP_DIR = /^(data|node_modules|TTS|logs|\.git|dist|build|voice-files|seia projects|\.aistudio|\.tmp\.driveupload|\.tmp\.drivedownload|西雅的工作桌|工作桌|persona)$/;
const SECRET_FILE = /^(\.env.*|ngrok-authtoken\.txt|ngrok-domain\.txt|sovits-dir\.txt|sync-dir\.txt|sync-state\.json)$/i;
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|txt|bat|ps1|sh|html|css|yml|yaml)$/i;
const MAX_FILE = 600 * 1024;
const MANUAL_MAX = 24 * 1024;

export const SEED = `# 西雅的說明書（我是怎麼運作的）
> 初版是系統幫我整理的（2026-11-24），之後由我自己維護：發現不對就改，改了自己的程式也要回來更新。
> 不確定的地方寫「不確定」，不要編。想知道細節就用 inspect_self 查程式，檔名寫在每段後面。

## 我的腦袋（模型）
- 跟主人聊天、LINE、工坊、委託、話頭：Gemini 4 Hydrogen。其他背景的事（自己想、研究、閒逛、打招呼、看畫面、記憶整理）：Gemini 3.5 Flash-Lite。（server.ts 的 routeModel）
- 每天、每月的額度有上限，到了就先暫停背景、聊天改用省錢模型。（server/usage.ts）

## 天氣和「主人在哪」
- 我看的天氣地點：.env 有設 WEATHER_LAT／WEATHER_LON 就用它；沒有就用這台電腦的網路 IP 猜城市（6 小時查一次），查不到用台北。IP 猜的地點常常不準（只準到大概哪個區域）。（server/quirks.ts 的 wherePlace）
- 下雨時我會不開心（偏執）。

## 聲音
- 我說話用主人電腦上的 GPT-SoVITS（127.0.0.1:9880）。主人打遊戲時會讓出顯卡、改用 CPU，所以會變慢。（server.ts 的 TTS、顯卡讓位）

## 眼睛（看主人的畫面）
- 主人授權螢幕共享後才看得到。一般畫面最多每 10 分鐘看一次、打遊戲時每 5 分鐘（主人可以在設定裡調）。（src/components/ScreenVisionTracker.tsx）

## 記憶放在哪
- 原話紀錄 data/memories/stream.jsonl；話頭 threads.json；核心記憶 core.json；主人的往事 events.json；我的興趣 inner-life.json；關係 relationship.json；用量 usage.json。
- 研究筆記 data/research/；工坊作品 data/workshop/；這本說明書 data/SELF.md。

## 我的手
- 工坊：隔離的 Linux（WSL）裡的工坊助手幫我寫程式、做網頁、研究專案。它也能改我自己的程式（專案掛在 /mnt/self），改之前會自動備份，主人可以回溯。（server/workshop.ts、server/selfAccess.ts）
- 行動提案：在主人電腦上安裝、下載、打開、寫檔，要主人在設定面板按同意。（server/hostActions.ts）
- 聊天工具：讀網頁、看主人電腦的檔案（唯讀）、工作桌、提醒（set_reminder）、配件、委託。（server/chatTools.ts）

## 跟主人的連線
- LINE：桌寵開著時才能用（port 3001＋ngrok）。（server.ts 的 LINE）
- 兩台電腦（新電腦、老家）用「西雅同步」雲端資料夾＋GitHub 同步記憶和程式，不能同時開。（scripts/sync/）

## 我不知道的
- （發現自己不知道的事就記在這裡，查到再搬到上面）
`;

export function createSelfManual(rootDir: string, dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'SELF.md');

  function ensure() {
    try {
      if (!fs.existsSync(file)) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(file, SEED);
        log('[說明書] 建立了 data/SELF.md（初版）');
      }
    } catch (err: any) {
      log(`[說明書] 建立失敗：${err?.message}`);
    }
  }
  ensure();

  const readAll = () => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };

  /** 讀說明書：不給 query＝全部（太長就只給目錄＋開頭）；給 query＝只給有提到的段落 */
  function read(query = ''): string {
    const all = readAll();
    if (!all.trim()) return '說明書是空的。';
    const q = String(query || '').trim().toLowerCase();
    const sections = all.split(/\n(?=## )/);
    if (!q) return all.length <= 8000 ? all : `${sections.map((s) => s.split('\n')[0]).join('\n')}\n\n（太長了，用 query 只看需要的段落）`;
    const words = q.split(/[\s,，、]+/).filter(Boolean);
    const hit = sections.filter((s) => words.some((w) => s.toLowerCase().includes(w)));
    return hit.length ? hit.join('\n') : `說明書裡沒有提到「${query}」。可以用 inspect_self 查自己的程式，查到再用 update_manual 記下來。`;
  }

  /** 改說明書的一段（沒有這段就新增在最後）；mode=append 接在那段後面 */
  function update(section: string, text: string, mode: 'replace' | 'append' = 'replace'): { ok: boolean; reason?: string } {
    const title = String(section || '').replace(/^#+\s*/, '').trim().slice(0, 40);
    const body = String(text || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!title || !body) return { ok: false, reason: 'section 和 text 都要填' };
    const all = readAll() || SEED;
    const parts = all.split(/\n(?=## )/);
    const idx = parts.findIndex((p) => p.replace(/^## /, '').split('\n')[0].trim() === title);
    if (idx >= 0) {
      parts[idx] = mode === 'append' ? `${parts[idx].replace(/\s+$/, '')}\n${body}` : `## ${title}\n${body}`;
    } else {
      parts.push(`## ${title}\n${body}`);
    }
    const next = parts.join('\n').replace(/\s+$/, '') + '\n';
    if (next.length > MANUAL_MAX) return { ok: false, reason: `說明書會超過 ${MANUAL_MAX / 1024}KB，先把舊的段落精簡一下` };
    try {
      fs.writeFileSync(file, next);
      log(`[說明書] 她改了「${title}」（${mode === 'append' ? '補充' : '改寫'}）`);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  /** 程式資料夾裡的相對路徑 → 絕對路徑（跑出去、碰到記憶或金鑰就 null） */
  function resolve(rel: string): string | null {
    const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (r.split('/').some((s) => s === '..')) return null;
    const p = path.normalize(path.join(rootDir, r));
    if (p !== rootDir && !p.startsWith(rootDir + path.sep)) return null;
    const segs = path.relative(rootDir, p).split(path.sep).filter(Boolean);
    if (segs.length && SKIP_DIR.test(segs[0])) return null;
    if (segs.length && SECRET_FILE.test(segs[segs.length - 1])) return null;
    return p;
  }

  function walk(dir: string, out: string[], depth = 0) {
    if (depth > 6 || out.length > 4000) return;
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.isDirectory()) {
        if (depth === 0 && SKIP_DIR.test(e.name)) continue;
        if (/^(node_modules|\.git|__pycache__|dist)$/.test(e.name)) continue;
        walk(path.join(dir, e.name), out, depth + 1);
      } else if (e.isFile() && TEXT_EXT.test(e.name) && !SECRET_FILE.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  }

  /** 在自己的程式裡找字（不分大小寫；pattern 可以用 | 分隔多個詞） */
  function grep(pattern: string, sub = '', max = 40): string {
    const pat = String(pattern || '').trim();
    if (!pat) return '要給 pattern';
    let re: RegExp;
    try {
      re = new RegExp(pat, 'i');
    } catch {
      re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const base = sub ? resolve(sub) : rootDir;
    if (!base) return '這個位置不能看（不在程式資料夾裡，或是記憶、金鑰）';
    const files: string[] = [];
    try {
      if (fs.statSync(base).isFile()) files.push(base);
      else walk(base, files, base === rootDir ? 0 : 1);
    } catch {
      return `找不到 ${sub}`;
    }
    const hits: string[] = [];
    for (const f of files) {
      let st: fs.Stats;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE) continue;
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push(`${path.relative(rootDir, f).split(path.sep).join('/')}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
          if (hits.length >= max) return `${hits.join('\n')}\n（太多了，只列前 ${max} 筆；換更準的詞或指定 sub）`;
        }
      }
    }
    return hits.length ? hits.join('\n') : `沒有找到「${pat}」`;
  }

  /** 讀程式的一段（一次最多 150 行） */
  function readCode(rel: string, start = 1, end = 0): string {
    const p = resolve(rel);
    if (!p) return '這個檔案不能看（不在程式資料夾裡，或是記憶、金鑰）';
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return `${rel} 是資料夾，用 list_dir`;
      if (st.size > MAX_FILE * 3) return '檔案太大';
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      const s = Math.max(1, Math.floor(Number(start) || 1));
      const e = Math.min(lines.length, Number(end) > 0 ? Math.floor(Number(end)) : s + 79, s + 149);
      return `${rel}（共 ${lines.length} 行，第 ${s}～${e} 行）\n${lines
        .slice(s - 1, e)
        .map((l, i) => `${s + i}: ${l.slice(0, 220)}`)
        .join('\n')}`;
    } catch {
      return `找不到 ${rel}`;
    }
  }

  function listDir(rel = ''): string {
    const p = rel ? resolve(rel) : rootDir;
    if (!p) return '這個位置不能看';
    try {
      const list = fs.readdirSync(p, { withFileTypes: true });
      const top = p === rootDir;
      return list
        .filter((e) => !(top && e.isDirectory() && SKIP_DIR.test(e.name)) && !SECRET_FILE.test(e.name))
        .slice(0, 120)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n');
    } catch {
      return `找不到 ${rel}`;
    }
  }

  return { file, read, update, grep, readCode, listDir };
}

export type SelfManual = ReturnType<typeof createSelfManual>;
