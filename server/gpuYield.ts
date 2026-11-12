/**
 * 顯卡讓位：玩吃顯卡的遊戲（預設 Path of Exile）時，把 GPT-SoVITS 換成用 CPU 跑，
 * 讓出它佔著的專屬 GPU 記憶體；遊戲關掉一陣子後再換回顯卡。
 *
 *  - 每 15 秒看一次工作清單（tasklist），程式名稱開頭符合 GPU_YIELD_PROCESSES（逗號分隔，預設 PathOfExile）就算在玩。
 *  - 偵測到遊戲 → 馬上換 CPU；遊戲關掉滿 60 秒 → 換回顯卡（避免遊戲重開、更新時來回切）。
 *  - 換的方式：關掉 GPT-SoVITS（api_v2.py），用另一份設定重開：
 *      顯卡：GPT_SoVITS/configs/tts_infer.yaml（start-pet.bat 原本用的那份）
 *      CPU ：GPT_SoVITS/configs/tts_infer_cpu.yaml（每次從上面那份複製，只把 custom 的 device / is_half 改掉）
 *  - 重開那 20～60 秒她沒有聲音（照常打字回覆）；CPU 模式念一句會慢幾秒。
 *  - GPT-SoVITS 沒在跑（例如沒裝）就什麼都不做，不會自己把它叫起來。
 *  - 只在 Windows 有作用；.env 設 GPU_YIELD=off 可以整個關掉。
 */
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

type Mode = 'gpu' | 'cpu';

export interface GpuYieldOptions {
  /** GPT-SoVITS 的網址（例如 http://127.0.0.1:9880） */
  baseUrl: string;
  /** 桌寵資料夾（讀 sovits-dir.txt、寫 logs\gpt-sovits.log） */
  petDir: string;
  /** GPT-SoVITS 重開好之後呼叫（要重新掛聲帶） */
  onRestarted: (mode: Mode) => void;
  log?: (msg: string) => void;
}

const POLL_MS = 15_000;
const BACK_TO_GPU_AFTER_MS = 60_000;
const GPU_CONFIG = 'GPT_SoVITS/configs/tts_infer.yaml';
const CPU_CONFIG = 'GPT_SoVITS/configs/tts_infer_cpu.yaml';

function run(file: string, args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) =>
      resolve(String(stdout || '')),
    );
  });
}

function findSovitsDir(petDir: string): string | null {
  let dir = path.join(process.env.USERPROFILE || '', 'Desktop', 'GPT-SoVITS-v2pro-20250604');
  try {
    const txt = fs.readFileSync(path.join(petDir, 'sovits-dir.txt'), 'utf8').split(/\r?\n/)[0].trim();
    if (txt) dir = txt;
  } catch { /* 沒有 sovits-dir.txt 就用預設位置 */ }
  return fs.existsSync(path.join(dir, 'api_v2.py')) ? dir : null;
}

/** 從顯卡版設定複製一份 CPU 版：只改 custom 區塊的 device 和 is_half */
function writeCpuConfig(sovitsDir: string) {
  const text = fs.readFileSync(path.join(sovitsDir, GPU_CONFIG), 'utf8');
  const lines = text.split(/\r?\n/);
  let inCustom = false;
  const out = lines.map((line) => {
    if (/^\S/.test(line)) inCustom = /^custom:\s*$/.test(line);
    if (!inCustom) return line;
    if (/^\s+device:/.test(line)) return line.replace(/device:.*/, 'device: cpu');
    if (/^\s+is_half:/.test(line)) return line.replace(/is_half:.*/, 'is_half: false');
    return line;
  });
  fs.writeFileSync(path.join(sovitsDir, CPU_CONFIG), out.join('\n'), 'utf8');
}

async function isUp(baseUrl: string) {
  try {
    const r = await fetch(`${baseUrl}/docs`, { signal: AbortSignal.timeout(3_000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

export function startGpuYield(opts: GpuYieldOptions) {
  const log = opts.log || ((m: string) => console.log(m));
  if (process.platform !== 'win32') return;
  if (/^(off|0|false|no)$/i.test(process.env.GPU_YIELD || '')) {
    log('[顯卡讓位] .env 設了 GPU_YIELD=off，不啟用');
    return;
  }
  const sovitsDir = findSovitsDir(opts.petDir);
  if (!sovitsDir) {
    log('[顯卡讓位] 找不到 GPT-SoVITS 資料夾，不啟用');
    return;
  }
  const games = (process.env.GPU_YIELD_PROCESSES || 'PathOfExile')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const port = new URL(opts.baseUrl).port || '9880';

  let mode: Mode | null = null; // null = 還沒確認目前是哪一種
  let switching = false;
  let lastGameSeenAt = 0;

  async function gameRunning() {
    const out = await run('tasklist', ['/FO', 'CSV', '/NH']);
    return out.split(/\r?\n/).some((row) => {
      const name = row.split('","')[0].replace(/^"/, '').toLowerCase();
      return games.some((g) => name.startsWith(g));
    });
  }

  /** 看正在跑的 api_v2.py 用哪份設定；沒在跑回傳 null */
  async function currentMode(): Promise<Mode | null> {
    if (!(await isUp(opts.baseUrl))) return null;
    const out = await run('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*api_v2.py*' } | ForEach-Object { $_.CommandLine }",
    ]);
    return /tts_infer_cpu\.yaml/i.test(out) ? 'cpu' : 'gpu';
  }

  async function restartAs(target: Mode) {
    switching = true;
    const t0 = Date.now();
    try {
      log(target === 'cpu' ? '[顯卡讓位] 偵測到遊戲，GPT-SoVITS 改用 CPU（讓出顯卡記憶體）…' : '[顯卡讓位] 遊戲關了，GPT-SoVITS 換回顯卡…');
      if (target === 'cpu') writeCpuConfig(sovitsDir!);

      // 1. 關掉現在的 GPT-SoVITS（跟 stop-pet.bat 一樣，用命令列找 api_v2.py）
      await run('powershell', [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*api_v2.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ]);
      await waitFor(async () => !(await isUp(opts.baseUrl)), 15_000);

      // 2. 用另一份設定重開（輸出接在原本的 logs\gpt-sovits.log 後面）
      const logDir = path.join(opts.petDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const py = path.join(sovitsDir!, 'runtime', 'python.exe');
      const cfg = target === 'cpu' ? CPU_CONFIG : GPU_CONFIG;
      const cmdline = `"${py}" api_v2.py -a 127.0.0.1 -p ${port} -c ${cfg} >> "${path.join(logDir, 'gpt-sovits.log')}" 2>&1`;
      const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], {
        cwd: sovitsDir!,
        detached: true,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: 'ignore',
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      child.unref();

      if (!(await waitFor(() => isUp(opts.baseUrl), 180_000))) {
        log('[顯卡讓位] GPT-SoVITS 三分鐘內沒起來，看 logs\\gpt-sovits.log（重開桌寵會用顯卡版重新啟動）');
        mode = null;
        return;
      }
      mode = target;
      log(`[顯卡讓位] 完成，GPT-SoVITS 現在用${target === 'cpu' ? ' CPU' : '顯卡'}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
      opts.onRestarted(target);
    } catch (err: any) {
      log(`[顯卡讓位] 切換失敗：${err?.message || err}`);
      mode = null;
    } finally {
      switching = false;
    }
  }

  async function tick() {
    if (switching) return;
    const playing = await gameRunning();
    if (playing) lastGameSeenAt = Date.now();

    if (mode === null) {
      mode = await currentMode();
      if (mode === null) return; // GPT-SoVITS 沒在跑：不動它
    }
    if (playing && mode === 'gpu') await restartAs('cpu');
    else if (!playing && mode === 'cpu' && Date.now() - lastGameSeenAt >= BACK_TO_GPU_AFTER_MS) await restartAs('gpu');
  }

  log(`[顯卡讓位] 啟用：玩 ${games.join(', ')} 時 GPT-SoVITS 改用 CPU`);
  // 等 start-pet.bat 把 GPT-SoVITS 叫起來再開始看
  setTimeout(() => {
    tick().catch(() => {});
    setInterval(() => tick().catch(() => {}), POLL_MS);
  }, 20_000);
}
