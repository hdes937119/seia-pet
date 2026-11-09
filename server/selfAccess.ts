/**
 * 11/10 主人給西雅的完整權限（主人原話：除了 Windows 系統檔之外都能讀、能自己裝套件、對自己的程式碼有完全的存取權，用壞了靠紀錄回溯）。
 *
 * - 工坊（WSL）：工作用的帳號不用密碼就能 sudo；dsh 用 danger-full-access（不開沙盒，見 workshop.ts permMode）。
 * - 主人的 Windows：每個磁碟唯讀掛到 /mnt/win/<代號小寫>。藏起來（主人 11/10 選的）：Windows 系統資料夾、桌寵的 .env 和
 *   ngrok-authtoken.txt、各瀏覽器的使用者資料（密碼、登入 cookie）、ngrok 設定、.ssh。
 * - 她自己的程式（桌寵專案）：可讀寫掛到 /mnt/self（.env、ngrok-authtoken.txt 一樣藏）。
 * - 每次工坊開工前把桌寵程式碼備份到 logs/self-backups/<id>.tar.gz，做完比對：有改就記到 data/self-edits.jsonl，
 *   沒改就刪掉備份。主人用「回溯西雅改的程式.bat」（scripts/self/rollback.ts）回到某次修改之前。
 * - 聊天工具 my_computer：在 Windows 這邊直接列資料夾、讀檔、用檔名找（同一份藏起來的清單）。
 *
 * 注意：她在工坊有 sudo，所以「唯讀」「藏起來」擋得住不小心和一般的網頁誘導，擋不住刻意用 root 拆掉。這是主人知道並同意的。
 * 關掉：.env 設 SEIA_FULL_ACCESS=false（回到沙盒）。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { wslEnv, collector } from './winText';
import { packTarGz, readDirEntries } from './tarball';

export interface SelfEdit {
  at: number;
  id: string;
  title: string;
  changed: string[];
  added: string[];
  deleted: string[];
  backup: string;
  type?: 'edit' | 'rollback';
}

/** 備份、比對時跳過的（記憶和紀錄、套件、產出、私人檔、金鑰） */
export const SELF_SKIP = (rel: string) =>
  /^(data|node_modules|dist|build|logs|\.git|西雅的工作桌|voice-files|TTS|seia projects|\.aistudio)(\/|$)/.test(rel) ||
  /^(\.env.*|ngrok-authtoken\.txt|ngrok-domain\.txt|ngrok\.exe|sovits-dir\.txt|sync-dir\.txt|sync-state\.json)$/.test(rel) ||
  /\.claude-new$/.test(rel) ||
  /(^|\/)__pycache__(\/|$)/.test(rel);
export const SELF_MAX_FILE = 5 * 1024 * 1024;
const KEEP_BACKUPS = 40;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const md5 = (b: Buffer) => crypto.createHash('md5').update(b).digest('hex');

export function selfFiles(root: string) {
  return readDirEntries(root, SELF_SKIP).filter((e) => e.data.length <= SELF_MAX_FILE);
}

export function createSelfAccess(o: { root: string; dataDir: string; distro: string; log?: (m: string) => void }) {
  const log = o.log || console.log;
  const backupDir = path.join(o.root, 'logs', 'self-backups');
  const editLog = path.join(o.dataDir, 'self-edits.jsonl');
  const enabled = () => process.env.SEIA_FULL_ACCESS !== 'false';
  const isWin = process.platform === 'win32';

  /** 藏起來的 Windows 路徑 */
  function hidden(): string[] {
    const home = os.homedir();
    const L = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const R = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      process.env.SystemRoot || 'C:\\Windows',
      path.join(o.root, '.env'),
      path.join(o.root, 'ngrok-authtoken.txt'),
      path.join(L, 'Google', 'Chrome', 'User Data'),
      path.join(L, 'Microsoft', 'Edge', 'User Data'),
      path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      path.join(L, 'Vivaldi', 'User Data'),
      path.join(R, 'Opera Software'),
      path.join(R, 'Mozilla', 'Firefox', 'Profiles'),
      path.join(L, 'ngrok'),
      path.join(R, 'ngrok'),
      path.join(home, '.ssh'),
    ];
  }
  const norm = (p: string) => path.resolve(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  function isHidden(p: string): boolean {
    const base = path.basename(p).toLowerCase();
    if (base === '.env' || base.startsWith('.env.')) return !base.endsWith('.example');
    const n = norm(p);
    return hidden().some((h) => {
      const hn = norm(h);
      return n === hn || n.startsWith(`${hn}\\`);
    });
  }
  /** C:\Users\x → /mnt/win/c/Users/x */
  function toWsl(p: string): string {
    const m = /^([a-zA-Z]):[\\/]?(.*)$/.exec(p);
    if (!m) return '';
    return `/mnt/win/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`.replace(/\/+$/, '');
  }
  function drives(): string[] {
    if (!isWin) return [];
    const out: string[] = [];
    for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      try {
        if (fs.existsSync(`${L}:\\`)) out.push(L);
      } catch {
        // 沒有這個磁碟
      }
    }
    return out;
  }

  /** 用 root 在工坊裡跑：sudo 免密碼、掛磁碟、掛自己的專案、把要藏的蓋掉（每次開工前跑，已經掛好的會跳過） */
  function mountScript(): string {
    const lines = [
      'set +e',
      'U=$(id -nu 1000 2>/dev/null || echo user)',
      'if [ ! -f /etc/sudoers.d/seia-full ]; then printf \'%s ALL=(ALL) NOPASSWD:ALL\\n\' "$U" > /etc/sudoers.d/seia-full && chmod 440 /etc/sudoers.d/seia-full && echo "===SEIA:SUDO 1"; fi',
    ];
    for (const L of drives()) {
      const mp = `/mnt/win/${L.toLowerCase()}`;
      lines.push(`mkdir -p ${mp}; mountpoint -q ${mp} || mount -t drvfs '${L}:' ${mp} -o ro,uid=1000,gid=1000 || echo "===SEIA:WINFAIL ${L}"`);
    }
    lines.push(`SRC=$(echo ${b64(o.root)} | base64 -d); mkdir -p /mnt/self; mountpoint -q /mnt/self || mount -t drvfs "$SRC" /mnt/self -o rw,uid=1000,gid=1000 || echo "===SEIA:SELFFAIL 1"`);
    const hide = [...hidden().map(toWsl), '/mnt/self/.env', '/mnt/self/ngrok-authtoken.txt'].filter(Boolean);
    for (const h of hide)
      lines.push(
        `P=$(echo ${b64(h)} | base64 -d); if findmnt -n --mountpoint "$P" >/dev/null 2>&1; then :; elif [ -d "$P" ]; then mount -t tmpfs -o ro,size=4k,mode=000 seia-hidden "$P" || echo "===SEIA:HIDEFAIL $P"; elif [ -f "$P" ]; then mount --bind /dev/null "$P" || echo "===SEIA:HIDEFAIL $P"; fi`
      );
    lines.push('echo "===SEIA:ACCESS ok"');
    return lines.join('\n');
  }

  function runRoot(script: string, timeoutSec = 60): Promise<string> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('wsl.exe', ['-d', o.distro, '-u', 'root', '-e', 'bash', '-c', `echo ${b64(script)} | base64 -d > /tmp/seia-access.sh && bash /tmp/seia-access.sh`], { windowsHide: true, env: wslEnv() });
      } catch (e: any) {
        return resolve(`===SEIA:ERR ${e?.message || e}`);
      }
      const out = collector();
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => out.push(d));
      const t = setTimeout(() => child.kill(), timeoutSec * 1000);
      child.on('error', (e: any) => {
        clearTimeout(t);
        resolve(`${out.text()}\n===SEIA:ERR ${e?.message || e}`);
      });
      child.on('close', () => {
        clearTimeout(t);
        resolve(out.text());
      });
    });
  }

  let warned = '';
  async function ensure(): Promise<boolean> {
    if (!enabled() || !isWin) return false;
    const out = await runRoot(mountScript());
    if (out.includes('===SEIA:SUDO 1')) log('[權限] 工坊裡的 sudo 改成不用密碼了');
    const bad = out.split(/\r?\n/).filter((l) => /===SEIA:(WINFAIL|SELFFAIL|HIDEFAIL|ERR)/.test(l));
    const key = bad.join('|');
    if (bad.length && key !== warned) log(`[權限] ⚠️ 工坊掛載有問題：${bad.join('；').slice(0, 400)}`);
    warned = key;
    return out.includes('===SEIA:ACCESS ok') && !bad.some((l) => /SELFFAIL|HIDEFAIL/.test(l));
  }

  /* ===== 改自己的程式：備份、比對、紀錄 ===== */
  const manifests = new Map<string, Map<string, string>>();
  function before(id: string) {
    if (!enabled()) return;
    try {
      const entries = selfFiles(o.root);
      manifests.set(id, new Map(entries.map((e) => [e.path, md5(e.data)])));
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, `${id}.tar.gz`), packTarGz(entries));
    } catch (err: any) {
      log(`[改自己] ⚠️ 開工前備份失敗：${err?.message}`);
    }
  }
  function after(id: string, title: string): SelfEdit | null {
    const old = manifests.get(id);
    if (!old) return null;
    manifests.delete(id);
    const backup = path.join(backupDir, `${id}.tar.gz`);
    try {
      const now = new Map(selfFiles(o.root).map((e) => [e.path, md5(e.data)]));
      const changed: string[] = [];
      const added: string[] = [];
      const deleted: string[] = [];
      for (const [p, h] of now) {
        if (!old.has(p)) added.push(p);
        else if (old.get(p) !== h) changed.push(p);
      }
      for (const p of old.keys()) if (!now.has(p)) deleted.push(p);
      if (!changed.length && !added.length && !deleted.length) {
        fs.rmSync(backup, { force: true });
        return null;
      }
      const e: SelfEdit = { at: Date.now(), id, title, changed, added, deleted, backup: path.relative(o.root, backup).replace(/\\/g, '/'), type: 'edit' };
      fs.mkdirSync(path.dirname(editLog), { recursive: true });
      fs.appendFileSync(editLog, `${JSON.stringify(e)}\n`);
      log(`[改自己] 「${title}」改了自己的程式：改 ${changed.length}、新增 ${added.length}、刪除 ${deleted.length}（${[...changed, ...added, ...deleted].slice(0, 8).join('、')}）；備份 ${e.backup}`);
      prune();
      return e;
    } catch (err: any) {
      log(`[改自己] ⚠️ 做完比對失敗：${err?.message}`);
      return null;
    }
  }
  function prune() {
    try {
      const list = fs.readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz')).sort();
      for (const f of list.slice(0, Math.max(0, list.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupDir, f), { force: true });
    } catch {
      // 清不掉也沒關係
    }
  }
  function recent(n = 5): SelfEdit[] {
    try {
      return fs
        .readFileSync(editLog, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l) as SelfEdit)
        .slice(-n);
    } catch {
      return [];
    }
  }

  /** package.json 被改了：在 Windows 這邊 npm install（工坊裝的是 Linux 版，不能用） */
  function npmInstall(timeoutSec = 600): Promise<{ ok: boolean; tail: string }> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(isWin ? 'npm.cmd' : 'npm', ['install', '--no-fund', '--no-audit'], { cwd: o.root, windowsHide: true, shell: isWin });
      } catch (e: any) {
        return resolve({ ok: false, tail: String(e?.message || e) });
      }
      const out = collector();
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => out.push(d));
      const t = setTimeout(() => child.kill(), timeoutSec * 1000);
      child.on('error', (e: any) => {
        clearTimeout(t);
        resolve({ ok: false, tail: String(e?.message || e) });
      });
      child.on('close', (code: number | null) => {
        clearTimeout(t);
        resolve({ ok: code === 0, tail: out.text().slice(-600) });
      });
    });
  }

  /** 重開桌寵（另開一個不屬於桌寵的視窗跑 restart-pet.bat，不然 stop-pet 會連自己一起關掉） */
  function restartPet(): boolean {
    if (!isWin) return false;
    try {
      const bat = path.join(o.root, 'restart-pet.bat');
      const child = spawn('cmd.exe', ['/d', '/c', `start "seia-restart" /min cmd /c ""${bat}""`], { cwd: o.root, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
      child.unref();
      return true;
    } catch (err: any) {
      log(`[改自己] ⚠️ 重開失敗：${err?.message}`);
      return false;
    }
  }

  /* ===== 聊天工具 my_computer：在 Windows 這邊看檔案 ===== */
  const SKIP_WALK = /^(node_modules|\.git|\$recycle\.bin|system volume information|appdata)$/i;
  function browse(action: string, p0: string, query = ''): string {
    const home = os.homedir();
    let p = String(p0 || '').trim().replace(/^["']|["']$/g, '');
    if (!p || p === '~') p = home;
    p = p.replace(/^~(?=[\\/])/, home);
    if (/^[a-zA-Z]:$/.test(p)) p += '\\';
    if (!path.isAbsolute(p)) p = path.join(home, p);
    p = path.resolve(p);
    if (isHidden(p)) return `「${p}」被主人藏起來了（系統資料夾、金鑰或瀏覽器的密碼資料），不能看。`;
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch (e: any) {
      return `找不到或打不開「${p}」（${e?.code || e?.message}）。`;
    }
    const act = action === 'read' || action === 'find' ? action : 'list';
    if (st.isFile() || act === 'read') {
      if (!st.isFile()) return `「${p}」是資料夾，用 list。`;
      const size = st.size;
      let buf: Buffer;
      try {
        const fd = fs.openSync(p, 'r');
        buf = Buffer.alloc(Math.min(size, 64 * 1024));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
      } catch (e: any) {
        return `讀不到「${p}」（${e?.code || e?.message}）。`;
      }
      if (buf.subarray(0, 4000).includes(0)) return `「${p}」是二進位檔（${Math.round(size / 1024)}KB），沒辦法當文字讀。`;
      const text = buf.toString('utf8');
      return `「${p}」（${Math.round(size / 1024)}KB${size > 12000 ? '，只讀了開頭 12000 字' : ''}）：\n${text.slice(0, 12000)}`;
    }
    if (act === 'find') {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return 'find 要給檔名關鍵字（query）。';
      const hits: string[] = [];
      let seen = 0;
      const walk = (d: string, depth: number) => {
        if (hits.length >= 80 || seen > 20000 || depth > 5) return;
        let list: fs.Dirent[] = [];
        try {
          list = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of list) {
          seen++;
          const f = path.join(d, e.name);
          if (isHidden(f)) continue;
          if (e.name.toLowerCase().includes(q)) hits.push(`${f}${e.isDirectory() ? '\\' : ''}`);
          if (hits.length >= 80) return;
          if (e.isDirectory() && !SKIP_WALK.test(e.name)) walk(f, depth + 1);
        }
      };
      walk(p, 0);
      return hits.length ? `在「${p}」底下找到 ${hits.length} 個${hits.length >= 80 ? '（只列前 80 個）' : ''}：\n${hits.join('\n')}` : `在「${p}」底下（往下 5 層）找不到檔名有「${q}」的。`;
    }
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(p, { withFileTypes: true });
    } catch (e: any) {
      return `打不開「${p}」（${e?.code || e?.message}）。`;
    }
    const rows: string[] = [];
    for (const e of list) {
      const f = path.join(p, e.name);
      if (isHidden(f)) continue;
      if (rows.length >= 200) break;
      if (e.isDirectory()) rows.push(`📁 ${e.name}\\`);
      else {
        let kb = '';
        try {
          kb = `（${Math.max(1, Math.round(fs.statSync(f).size / 1024))}KB）`;
        } catch {
          kb = '';
        }
        rows.push(`📄 ${e.name}${kb}`);
      }
    }
    return `「${p}」裡有 ${list.length} 個項目${list.length > rows.length ? `（列出 ${rows.length} 個）` : ''}：\n${rows.join('\n') || '（空的）'}`;
  }

  return { enabled, ensure, before, after, recent, isHidden, toWsl, drives, mountScript, npmInstall, restartPet, browse, root: o.root };
}

export type SelfAccess = ReturnType<typeof createSelfAccess>;
