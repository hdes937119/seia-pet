/**
 * 行動提案（11/6）：她想在主人電腦上做的事，先寫成「照順序的步驟」，主人在電腦前看過、整個同意才執行。
 *
 * 規則（主人定的）：
 *   - 她先列出方案和順序；主人同意之後整個照順序執行。
 *   - 中間有任何修改（步驟改了、加了、換了）都是新版本，要主人再同意一次。同意時記下步驟的指紋，執行每一步前都核對，對不上就停。
 *   - 某一步失敗就停在那裡，結果寫回給她；她要改做法就送新版本。
 *
 * 第一版只開放這幾種步驟（其他的照舊用「提案」請主人自己來）：
 *   winget    用 winget 安裝軟體（提案時先用 winget show 查出名稱和發行者給主人看）
 *   download  從公開網址下載檔案到「下載\西雅」資料夾（不覆蓋，最多 DOWNLOAD_MAX_MB）
 *   open      打開「下載\西雅」裡的檔案（安裝檔會特別標出來）或一個公開網址
 *   write_file 在主人借的、可以新增檔案的資料夾裡新增一個文字檔（不覆蓋、最多 200KB）
 * 不開放：任意指令、需要系統管理員權限的動作、刪除檔案。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { decodeOutput } from './winText';

export type StepType = 'winget' | 'download' | 'open' | 'write_file';
export interface ActionStep {
  type: StepType;
  /** winget 套件 ID */
  id?: string;
  url?: string;
  filename?: string;
  /** open：下載資料夾裡的檔名或公開網址 */
  target?: string;
  /** write_file：資料夾名字、相對路徑、內容 */
  folder?: string;
  path?: string;
  content?: string;
  note?: string;
  /** 程式查到的資訊（給主人看） */
  check?: string;
  warn?: string;
}
export interface StepResult {
  i: number;
  ok: boolean;
  output: string;
  at: number;
}
export type PlanStatus = 'checking' | 'invalid' | 'waiting' | 'running' | 'done' | 'failed' | 'rejected' | 'superseded';
export interface ActionPlan {
  id: string;
  title: string;
  why: string;
  from: string;
  project?: string;
  commission?: string;
  createdAt: number;
  version: number;
  revisionOf?: string;
  steps: ActionStep[];
  status: PlanStatus;
  problems?: string[];
  approvedAt?: number;
  approvedHash?: string;
  results: StepResult[];
  finishedAt?: number;
  masterNote?: string;
  /** 她看過結果了（給她的區塊用） */
  seen?: boolean;
}

export interface HostDeps {
  isPublicUrl: (url: string) => Promise<boolean>;
  /** 主人借的、可以新增檔案的資料夾（名字 → 路徑） */
  addFolder: (name: string) => { label: string; path: string } | null;
  /** 可以新增檔案的資料夾名稱（錯誤訊息用） */
  addFolderNames?: () => string[];
  log?: (m: string) => void;
}

const MAX_STEPS = 12;
const downloadMaxMb = () => Number(process.env.DOWNLOAD_MAX_MB) || 500;
export const downloadDir = () => path.join(os.homedir(), 'Downloads', '西雅');
const RUNNABLE_RE = /\.(exe|msi|msix|appx|bat|cmd|ps1|vbs|js|jar|lnk|scr|com)$/i;
const WINGET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{1,80}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};
export const stepsHash = (steps: ActionStep[]) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(steps.map((s) => ({ type: s.type, id: s.id, url: s.url, filename: s.filename, target: s.target, folder: s.folder, path: s.path, content: s.content }))))
    .digest('hex');

export function safeFileName(name: string) {
  return String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
}
export function safeRelPath(rel: string) {
  const r = String(rel || '').replace(/\\/g, '/').trim();
  if (!r || r.length > 200 || r.startsWith('/') || /^[a-zA-Z]:/.test(r)) return '';
  if (r.split('/').some((s) => !s || s === '.' || s === '..' || /[:*?"<>|\x00-\x1f]/.test(s))) return '';
  return r;
}

/** 把她給的步驟整理成乾淨的格式（看不懂的回傳問題） */
export function normalizeSteps(raw: any[]): { steps: ActionStep[]; problems: string[] } {
  const steps: ActionStep[] = [];
  const problems: string[] = [];
  (Array.isArray(raw) ? raw : []).slice(0, MAX_STEPS + 1).forEach((x, i) => {
    const t = String(x?.type || '');
    const note = String(x?.note || '').slice(0, 200) || undefined;
    if (t === 'winget') {
      const id = String(x?.id || '').trim();
      if (!WINGET_ID_RE.test(id)) problems.push(`第 ${i + 1} 步：winget 套件 ID「${id}」格式不對`);
      steps.push({ type: 'winget', id, note });
    } else if (t === 'download') {
      const url = String(x?.url || '').trim();
      let filename = safeFileName(x?.filename || '');
      if (!filename) {
        try {
          filename = safeFileName(decodeURIComponent(new URL(url).pathname.split('/').pop() || '')) || 'download';
        } catch {
          filename = 'download';
        }
      }
      if (!/^https?:\/\//i.test(url)) problems.push(`第 ${i + 1} 步：下載網址要是 http／https`);
      steps.push({ type: 'download', url, filename, note });
    } else if (t === 'open') {
      const target = String(x?.target || '').trim();
      if (!target) problems.push(`第 ${i + 1} 步：open 沒有寫要打開什麼`);
      steps.push({ type: 'open', target: /^https?:\/\//i.test(target) ? target : safeFileName(target), note });
    } else if (t === 'write_file') {
      const rel = safeRelPath(x?.path || '');
      const content = String(x?.content ?? '');
      if (!rel) problems.push(`第 ${i + 1} 步：檔案路徑不對（要是資料夾裡的相對路徑）`);
      if (Buffer.byteLength(content) > 200 * 1024) problems.push(`第 ${i + 1} 步：內容超過 200KB`);
      steps.push({ type: 'write_file', folder: String(x?.folder || '').trim(), path: rel, content, note });
    } else problems.push(`第 ${i + 1} 步：不支援的步驟「${t}」（只能用 winget、download、open、write_file）`);
  });
  if (!steps.length) problems.push('沒有任何步驟');
  if (steps.length > MAX_STEPS) problems.push(`步驟太多（最多 ${MAX_STEPS} 步）`);
  return { steps: steps.slice(0, MAX_STEPS), problems };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err: any) {
      return resolve({ code: -1, out: String(err?.message || err) });
    }
    // winget 在繁中系統可能輸出 Big5：收集原始位元組，最後再猜編碼（winText.ts）
    const chunks: Buffer[] = [];
    let size = 0;
    const add = (d: Buffer) => {
      chunks.push(d);
      size += d.length;
      while (size > 200_000 && chunks.length > 1) size -= chunks.shift()!.length;
    };
    const text = () => decodeOutput(Buffer.concat(chunks)).slice(-15000);
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    const killer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err: any) => {
      clearTimeout(killer);
      resolve({ code: -1, out: `${text()}\n${err?.message || err}` });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(killer);
      resolve({ code, out: text() });
    });
  });
}
/** winget 的輸出有進度條和控制字元，整理成看得懂的文字 */
export function cleanOutput(s: string) {
  return String(s || '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n|\r/)
    .map((l) => l.replace(/[█▒░\-\\|/]{3,}.*$/, '').trimEnd())
    .filter((l) => l.trim() && !/^\s*[-\\|/]\s*$/.test(l))
    .join('\n')
    .slice(-3000);
}
export function parseWingetShow(out: string): { name?: string; publisher?: string; version?: string } {
  const pick = (re: RegExp) => out.match(re)?.[1]?.trim();
  return {
    name: pick(/(?:Found|找到)\s+(.+?)\s+\[/) || pick(/^\s*(?:Name|名稱)\s*[:：]\s*(.+)$/m),
    publisher: pick(/^\s*(?:Publisher|發行者|發佈者)\s*[:：]\s*(.+)$/m),
    version: pick(/^\s*(?:Version|版本)\s*[:：]\s*(.+)$/m),
  };
}

export function createHostActions(dataDir: string, deps: HostDeps) {
  const file = path.join(dataDir, 'actions', 'plans.json');
  const log = deps.log || console.log;
  let plans: ActionPlan[] = [];
  try {
    if (fs.existsSync(file)) plans = JSON.parse(fs.readFileSync(file, 'utf8')).plans || [];
  } catch {
    // 從頭開始
  }
  for (const p of plans) if (p.status === 'running' || p.status === 'checking') Object.assign(p, { status: p.status === 'running' ? 'failed' : 'invalid', problems: [...(p.problems || []), '桌寵在中途被關掉了'] });
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ plans }, null, 2));
    } catch (err: any) {
      log(`[行動] 儲存失敗：${err?.message}`);
    }
  };
  const get = (id: string) => plans.find((p) => p.id === id);
  let busy: string | null = null;

  /** 提案進來先檢查（winget 查名稱發行者、網址是不是公開、資料夾有沒有給、檔案會不會蓋掉） */
  async function check(p: ActionPlan) {
    const problems = [...(p.problems || [])];
    const willDownload = new Set<string>();
    for (const [i, s] of p.steps.entries()) {
      const n = `第 ${i + 1} 步`;
      if (s.type === 'winget') {
        if (process.platform !== 'win32') {
          problems.push(`${n}：winget 只能在 Windows 上用`);
          continue;
        }
        const r = await run('winget', ['show', '--id', String(s.id), '-e', '--accept-source-agreements', '--disable-interactivity'], 60_000);
        const info = parseWingetShow(cleanOutput(r.out));
        if (r.code !== 0 || !info.name) problems.push(`${n}：winget 找不到套件「${s.id}」`);
        else s.check = `${info.name}${info.publisher ? `｜發行者：${info.publisher}` : ''}${info.version ? `｜版本 ${info.version}` : ''}`;
      } else if (s.type === 'download') {
        if (!(await deps.isPublicUrl(String(s.url)))) problems.push(`${n}：下載網址不是公開網站`);
        else {
          try {
            s.check = `來源網站：${new URL(String(s.url)).hostname}｜存成：下載\\西雅\\${s.filename}`;
          } catch {
            problems.push(`${n}：看不懂這個網址`);
          }
        }
        if (RUNNABLE_RE.test(String(s.filename))) s.warn = '這是可以執行的檔案（安裝檔、腳本）';
        willDownload.add(String(s.filename));
      } else if (s.type === 'open') {
        const t = String(s.target);
        if (/^https?:\/\//i.test(t)) {
          if (!(await deps.isPublicUrl(t))) problems.push(`${n}：網址不是公開網站`);
          else s.check = `用預設瀏覽器打開 ${t.slice(0, 120)}`;
        } else {
          const exists = fs.existsSync(path.join(downloadDir(), t));
          if (!exists && !willDownload.has(t)) problems.push(`${n}：「下載\\西雅」裡沒有「${t}」，前面的步驟也不會下載它`);
          s.check = `打開 下載\\西雅\\${t}`;
          if (RUNNABLE_RE.test(t)) s.warn = '會執行這個程式（安裝檔或腳本），請確認來源';
        }
      } else if (s.type === 'write_file') {
        const f = deps.addFolder(String(s.folder));
        if (!f) {
          const names = deps.addFolderNames?.() || [];
          problems.push(
            `${n}：write_file 的 folder 要填主人借你、可以新增檔案的資料夾名稱${String(s.folder || '').trim() ? `（沒有叫「${s.folder}」的）` : '（這次沒填）'}；${names.length ? `現在可以用：${names.map((x) => `「${x}」`).join('、')}` : '現在一個都沒有'}。做好的作品和委託網頁會自動放上主人的「西雅的工作桌」，不用這樣搬。`
          );
        }
        else {
          const dest = path.join(f.path, ...String(s.path).split('/'));
          if (fs.existsSync(dest)) problems.push(`${n}：「${s.path}」已經存在，不會覆蓋`);
          s.check = `新增 ${f.label}\\${String(s.path).replace(/\//g, '\\')}（${Buffer.byteLength(String(s.content || ''))} bytes）`;
          if (RUNNABLE_RE.test(String(s.path))) s.warn = '這是可以執行的檔案';
        }
      }
    }
    p.problems = problems;
    p.status = problems.length ? 'invalid' : 'waiting';
    save();
    log(`[行動] 「${p.title}」${p.status === 'waiting' ? '檢查好了，等主人同意' : `有問題：${problems.join('；').slice(0, 120)}`}`);
    return p;
  }

  async function create(input: { title: string; why: string; steps: any[]; from: string; project?: string; commission?: string; revisionOf?: string }): Promise<ActionPlan> {
    const { steps, problems } = normalizeSteps(input.steps);
    const prev = input.revisionOf ? get(input.revisionOf) : undefined;
    const p: ActionPlan = {
      id: `a-${stamp()}-${Math.random().toString(36).slice(2, 5)}`,
      title: String(input.title || prev?.title || '行動提案').slice(0, 40),
      why: String(input.why || '').slice(0, 500),
      from: String(input.from || '').slice(0, 60),
      project: input.project || prev?.project,
      commission: input.commission || prev?.commission,
      createdAt: Date.now(),
      version: (prev?.version || 0) + 1,
      revisionOf: prev?.id,
      steps,
      status: 'checking',
      problems,
      results: [],
    };
    if (prev && ['waiting', 'invalid', 'failed', 'rejected'].includes(prev.status)) prev.status = 'superseded';
    plans.push(p);
    plans = plans.slice(-40);
    save();
    log(`[行動] 她提出行動提案「${p.title}」（第 ${p.version} 版，${steps.length} 步）`);
    const checked = await check(p);
    // 11/9：同一件事送了好幾份 → 新的檢查過了，舊的（同名、或寫同一個檔、下載同一個網址）作廢
    if (checked.status === 'waiting') {
      const keys = (x: ActionPlan) => new Set(x.steps.map((s: any) => (s.type === 'write_file' ? `w:${s.folder}/${s.path}` : s.type === 'download' ? `d:${s.url}` : s.type === 'winget' ? `g:${s.id}` : `o:${s.target}`)));
      const mine = keys(checked);
      for (const o of plans) {
        if (o === checked || o.status !== 'waiting') continue;
        if (o.title === checked.title || [...keys(o)].some((k) => mine.has(k))) {
          o.status = 'superseded';
          log(`[行動] 「${o.title}」（${o.id}）跟新的提案重複，作廢`);
        }
      }
      save();
    }
    return checked;
  }

  async function execStep(s: ActionStep): Promise<{ ok: boolean; output: string }> {
    if (s.type === 'winget') {
      const r = await run('winget', ['install', '--id', String(s.id), '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], 20 * 60_000);
      return { ok: r.code === 0, output: cleanOutput(r.out) || `結束碼 ${r.code}` };
    }
    if (s.type === 'download') {
      fs.mkdirSync(downloadDir(), { recursive: true });
      let url = String(s.url);
      for (let hop = 0; hop < 6; hop++) {
        if (!(await deps.isPublicUrl(url))) return { ok: false, output: `網址不是公開網站：${url}` };
        const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SeiaPet' }, signal: AbortSignal.timeout(30 * 60_000) });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          url = new URL(res.headers.get('location')!, url).toString();
          continue;
        }
        if (!res.ok || !res.body) return { ok: false, output: `下載失敗（HTTP ${res.status}）` };
        const len = Number(res.headers.get('content-length') || 0);
        if (len > downloadMaxMb() * 1024 * 1024) return { ok: false, output: `檔案太大（${Math.round(len / 1024 / 1024)}MB，上限 ${downloadMaxMb()}MB）` };
        let dest = path.join(downloadDir(), String(s.filename));
        for (let i = 1; fs.existsSync(dest) && i < 100; i++) dest = path.join(downloadDir(), String(s.filename).replace(/(\.[^.]*)?$/, ` (${i})$1`));
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        let got = 0;
        try {
          for await (const chunk of res.body as any) {
            got += chunk.length;
            if (got > downloadMaxMb() * 1024 * 1024) throw new Error(`超過上限 ${downloadMaxMb()}MB`);
            if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          }
          await new Promise<void>((r, j) => out.end((e: any) => (e ? j(e) : r())));
          fs.renameSync(tmp, dest);
        } catch (err: any) {
          out.destroy();
          fs.rmSync(tmp, { force: true });
          return { ok: false, output: `下載中斷：${err?.message || err}` };
        }
        if (path.basename(dest) !== s.filename) s.filename = path.basename(dest);
        return { ok: true, output: `存好了：下載\\西雅\\${path.basename(dest)}（${Math.round(got / 1024)} KB）` };
      }
      return { ok: false, output: '轉址太多次' };
    }
    if (s.type === 'open') {
      const t = String(s.target);
      if (process.platform !== 'win32') return { ok: false, output: '只能在 Windows 上打開' };
      if (/^https?:\/\//i.test(t)) {
        if (!(await deps.isPublicUrl(t))) return { ok: false, output: '網址不是公開網站' };
        spawn('rundll32.exe', ['url.dll,FileProtocolHandler', t], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        return { ok: true, output: `打開了 ${t}` };
      }
      const p = path.join(downloadDir(), t);
      if (!p.startsWith(downloadDir() + path.sep) || !fs.existsSync(p)) return { ok: false, output: `找不到 下載\\西雅\\${t}` };
      spawn('explorer.exe', [p], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return { ok: true, output: `打開了 下載\\西雅\\${t}（安裝檔要主人自己在畫面上按下一步）` };
    }
    if (s.type === 'write_file') {
      const f = deps.addFolder(String(s.folder));
      if (!f) return { ok: false, output: `資料夾「${s.folder}」沒有給、過期了，或是唯讀` };
      const dest = path.join(f.path, ...String(s.path).split('/'));
      if (!dest.startsWith(f.path.replace(/[\\/]+$/, '') + path.sep)) return { ok: false, output: '路徑不在資料夾裡' };
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, String(s.content || ''), { encoding: 'utf8', flag: 'wx' });
      } catch (err: any) {
        return { ok: false, output: err?.code === 'EEXIST' ? '檔案已經存在，沒有覆蓋' : `寫不進去：${err?.message}` };
      }
      return { ok: true, output: `新增了 ${f.label}\\${String(s.path).replace(/\//g, '\\')}` };
    }
    return { ok: false, output: '不支援的步驟' };
  }

  /** 主人同意：整個照順序執行（不等做完） */
  function approve(id: string, onDone: (p: ActionPlan) => void | Promise<void>): { ok: boolean; reason?: string } {
    const p = get(id);
    if (!p) return { ok: false, reason: '沒有這個提案' };
    if (p.status !== 'waiting') return { ok: false, reason: `這個提案現在是「${p.status}」，不能同意` };
    if (busy) return { ok: false, reason: '另一個提案正在執行' };
    p.approvedAt = Date.now();
    p.approvedHash = stepsHash(p.steps);
    p.status = 'running';
    busy = p.id;
    save();
    log(`[行動] 主人同意了「${p.title}」，開始執行 ${p.steps.length} 步`);
    void (async () => {
      // 照同意時的步驟執行（凍結一份）；每一步前都核對提案沒被改過
      const frozen: ActionStep[] = JSON.parse(JSON.stringify(p.steps));
      try {
        for (let i = 0; i < frozen.length; i++) {
          const cur = get(p.id);
          if (!cur || cur.status !== 'running' || stepsHash(cur.steps) !== p.approvedHash) throw new Error('提案在執行中被改了或取消了，停下來');
          const s = frozen[i];
          log(`[行動] 「${p.title}」第 ${i + 1} 步：${s.type} ${s.id || s.url || s.target || s.path || ''}`.slice(0, 160));
          let r: { ok: boolean; output: string };
          try {
            r = await execStep(s);
          } catch (err: any) {
            r = { ok: false, output: String(err?.message || err) };
          }
          p.results.push({ i, ok: r.ok, output: r.output.slice(0, 3000), at: Date.now() });
          // 下載時同名檔已存在、自動改了檔名 → 後面打開同一個檔案的步驟跟著改（只改凍結的那份，是程式改的不是她改的）
          const orig = p.steps[i];
          if (s.type === 'download' && r.ok && s.filename !== orig.filename)
            for (const x of frozen.slice(i + 1)) if (x.type === 'open' && x.target === orig.filename) x.target = s.filename;
          save();
          if (!r.ok) {
            p.status = 'failed';
            break;
          }
        }
        if (p.status === 'running') p.status = 'done';
      } catch (err: any) {
        p.status = 'failed';
        p.results.push({ i: p.results.length, ok: false, output: String(err?.message || err), at: Date.now() });
      } finally {
        p.finishedAt = Date.now();
        busy = null;
        save();
        log(`[行動] 「${p.title}」${p.status === 'done' ? '全部完成' : '停下來了'}`);
      }
      try {
        await onDone(p);
      } catch (err: any) {
        log(`[行動] 收尾失敗：${err?.message}`);
      }
    })();
    return { ok: true };
  }

  function reject(id: string, note: string) {
    const p = get(id);
    if (!p || !['waiting', 'invalid'].includes(p.status)) return false;
    p.status = 'rejected';
    p.masterNote = String(note || '').slice(0, 500) || undefined;
    p.finishedAt = Date.now();
    save();
    log(`[行動] 主人沒同意「${p.title}」${note ? `：${note.slice(0, 60)}` : ''}`);
    return true;
  }

  function resultText(p: ActionPlan): string {
    const lines = p.steps.map((s, i) => {
      const r = p.results.find((x) => x.i === i);
      return `${i + 1}. ${s.type} ${s.id || s.url || s.target || s.path || ''}：${r ? `${r.ok ? '成功' : '失敗'}，${r.output.slice(-300)}` : '沒有執行'}`;
    });
    return lines.join('\n');
  }

  const STATUS: Record<PlanStatus, string> = {
    checking: '程式在檢查',
    invalid: '檢查沒過',
    waiting: '等主人同意',
    running: '執行中',
    done: '完成',
    failed: '中途失敗',
    rejected: '主人沒同意',
    superseded: '有新版本了',
  };

  /** 給她看（研究、委託、自主行動）：最近的提案和結果 */
  function describeForSeia(now = Date.now()): string {
    const recent = plans.filter((p) => p.status !== 'superseded' && now - p.createdAt < 7 * 86_400_000).slice(-5);
    if (!recent.length) return '';
    return `你的行動提案（要主人同意才會在主人電腦上執行；改步驟就要送新版本再同意）：\n${recent
      .map(
        (p) =>
          `- ${p.id}「${p.title}」第 ${p.version} 版：${STATUS[p.status]}${p.problems?.length && p.status === 'invalid' ? `（${p.problems.join('；').slice(0, 200)}）` : ''}${p.masterNote ? `；主人說：${p.masterNote}` : ''}${
            ['done', 'failed'].includes(p.status) ? `\n${resultText(p).slice(0, 600)}` : ''
          }`
      )
      .join('\n')}`;
  }

  function describeForChat(now = Date.now()): string {
    const recent = plans.filter((p) => p.status !== 'superseded' && now - p.createdAt < 3 * 86_400_000).slice(-3);
    if (!recent.length) return '';
    return `【你的行動提案】${recent.map((p) => `「${p.title}」${STATUS[p.status]}`).join('；')}。主人要在電腦前的設定面板按同意才會執行；聊天時照實說狀態，不要說還沒執行的已經做好了。`;
  }

  function snapshot() {
    return { busy, downloadDir: downloadDir(), plans: [...plans].reverse() };
  }

  return { create, approve, reject, get, describeForSeia, describeForChat, resultText, snapshot, isBusy: () => busy };
}

export type HostActions = ReturnType<typeof createHostActions>;
