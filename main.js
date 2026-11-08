import { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, powerMonitor, shell, session } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(">>> 桌寵主程式啟動中... <<<");

let mainWindow;
// 注意：網址（localhost vs 127.0.0.1）決定了 localStorage / IndexedDB 存在哪裡，
// 改掉會讓聊天紀錄、記憶、立繪「看起來不見」，所以保持原本的 localhost。
const APP_URL = 'http://localhost:3000';

// 置頂：off＝一般視窗、normal＝一般置頂、game＝最上層（無邊框全螢幕的遊戲也蓋不住她）
// 前端開機時會用 set-pin-mode 告訴這裡主人選的模式
let pinMode = 'normal';
let pinTimer = null;
function applyPin() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (pinTimer) { clearInterval(pinTimer); pinTimer = null; }
    if (pinMode === 'off') {
        mainWindow.setAlwaysOnTop(false);
        return;
    }
    if (pinMode === 'game') {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.moveTop();
        // 遊戲搶到前景時會把自己排到最上面，定時再把她拉回來（不搶焦點）
        pinTimer = setInterval(reassertTop, 3000);
        return;
    }
    mainWindow.setAlwaysOnTop(true, 'floating');
}
function reassertTop() {
    if (pinMode !== 'game' || !mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) return;
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
}
ipcMain.on('set-pin-mode', (_event, mode) => {
    pinMode = mode === 'off' || mode === 'game' ? mode : 'normal';
    applyPin();
    console.log(`[置頂] 模式：${pinMode}`);
});

function createWindow() {
    mainWindow = new BrowserWindow({
        // 浮動版面：右下角是立繪，上方留空間給漫畫氣泡式對話框
        width: 470,
        height: 820,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        resizable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'), // 掛載安全橋樑
            contextIsolation: true,
            nodeIntegration: false,
            // 打遊戲時桌寵不在前景，也要讓語音偵測、計時器照常運作
            backgroundThrottling: false,
        }
    });

    mainWindow.loadURL(APP_URL);
    mainWindow.setMenuBarVisibility(false);

    // 外部連結（摸魚手帳的「搜尋觀看」等 target=_blank / window.open）一律交給預設瀏覽器，
    // 不在桌寵程式裡開新視窗載入外部網站
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    // 防止桌寵視窗本身被導到外部網站（例如把連結拖進視窗）
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(APP_URL)) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    });
}

// 建立 IPC 通道，在背景抓取主螢幕 ID 傳給前端
ipcMain.handle('get-screen', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0]?.id ?? null;
});

// 視窗拖曳：前端按住角落把手時通知這裡，由主程式跟著游標移動視窗。
// （比 CSS 的 -webkit-app-region 可靠，不會被其他「不可拖曳」區塊抵銷）
let dragTimer = null;

function stopWindowDrag() {
    if (dragTimer) {
        clearInterval(dragTimer);
        dragTimer = null;
    }
}

ipcMain.on('window-drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    stopWindowDrag();
    const startCursor = screen.getCursorScreenPoint();
    const startBounds = win.getBounds();
    dragTimer = setInterval(() => {
        if (win.isDestroyed()) return stopWindowDrag();
        const cursor = screen.getCursorScreenPoint();
        // 用 setBounds 並固定寬高，避免 Windows 高 DPI 下 setPosition 讓視窗越拖越大的問題
        win.setBounds({
            x: startBounds.x + cursor.x - startCursor.x,
            y: startBounds.y + cursor.y - startCursor.y,
            width: startBounds.width,
            height: startBounds.height,
        });
    }, 8);
});

ipcMain.on('window-drag-stop', stopWindowDrag);

// 自主探索：系統層級的閒置秒數（主人在其他程式打遊戲 / 看網頁也算有在操作）
ipcMain.handle('get-system-idle', () => powerMonitor.getSystemIdleTime());

// 用預設瀏覽器開啟桌寵推薦的文章 / 影片（只允許 http / https）
ipcMain.handle('open-external', async (event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
});

// 透明區域滑鼠穿透：前端回報滑鼠是否停在透明背景上
// forward: true 讓穿透時仍持續收到 mousemove，滑鼠一移回立繪就能恢復可點擊
ipcMain.on('set-ignore-mouse', (event, ignore) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

// YouTube 帳號：在桌寵自己的瀏覽器裡登入，點唱機（嵌入的 YouTube 播放器）就會用主人的帳號播放
// （Premium 免廣告、播放紀錄記在主人帳號）。登入資訊存在桌寵自己的 Cookie，跟 Chrome 分開。
const YT_LOGIN_URL =
    'https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent('https://www.youtube.com/');
const GOOGLE_DOMAIN_RE = /(^|\.)(youtube\.com|google\.com(\.tw)?)$/i;
let ytLoginWindow = null;

async function isYouTubeLoggedIn() {
    const cookies = await session.defaultSession.cookies.get({ domain: 'youtube.com', name: 'LOGIN_INFO' });
    return cookies.length > 0;
}

function notifyYouTubeLogin(loggedIn) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('youtube-login-changed', Boolean(loggedIn));
}

// 西雅工坊的作品：開成獨立、可調整大小的視窗（沙盒、沒有 preload、不能導到別的地方）
const workWindows = new Map();
ipcMain.handle('open-workshop-work', (_event, id, entry, title) => {
    const workId = String(id || '');
    const file = String(entry || 'index.html');
    if (!/^w-[\d-]+$/.test(workId) || file.includes('..') || /^[\\/]/.test(file)) return false;
    const existing = workWindows.get(workId);
    if (existing && !existing.isDestroyed()) {
        existing.focus();
        return true;
    }
    const prefix = `${APP_URL}/api/workshop/${workId}/files/`;
    const win = new BrowserWindow({
        width: 560,
        height: 600,
        minWidth: 240,
        minHeight: 240,
        title: `西雅的工坊：${String(title || '作品').slice(0, 30)}`,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadURL(prefix + file.split('/').map(encodeURIComponent).join('/'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(prefix)) event.preventDefault();
    });
    // 標題固定用我們給的，不讓作品自己改
    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('closed', () => workWindows.delete(workId));
    workWindows.set(workId, win);
    return true;
});

// 西雅「試玩」自己的工坊作品：在看不見的視窗裡，用跟主人打開時一樣的網址和安全限制載入，
// 截三張圖（剛打開、亂點亂按之後、再等一下）、收集錯誤訊息，讓她用眼睛檢查，而不是只讀原始碼。
// 只聽 127.0.0.1，要帶 X-Gemini-Pet 標頭、不能有 Origin（瀏覽器網頁叫不動），只收作品 id，不收任意網址。
const PLAYTEST_PORT = Number(process.env.PLAYTEST_PORT) || 3002;
let playtestBusy = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playtestWork(workId, file) {
    // c- 開頭＝委託的專案工作區（11/8：委託做出的網頁也要實際打開檢查）
    const prefix = /^c-/.test(workId) ? `${APP_URL}/api/commissions/${workId}/ws/` : `${APP_URL}/api/workshop/${workId}/files/`;
    const url = prefix + file.split('/').map(encodeURIComponent).join('/');
    const W = 400;
    const H = 400;
    const win = new BrowserWindow({
        width: W,
        height: H,
        useContentSize: true,
        show: false,
        paintWhenInitiallyHidden: true,
        backgroundColor: '#ffffff',
        webPreferences: {
            offscreen: true,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: 'seia-playtest',
            backgroundThrottling: false,
        },
    });
    const wc = win.webContents;
    const logs = [];
    const push = (level, text) => {
        if (logs.length < 30) logs.push({ level, text: String(text || '').slice(0, 300) });
    };
    try {
        wc.setAudioMuted(true);
        wc.setWindowOpenHandler(() => ({ action: 'deny' }));
        wc.on('will-navigate', (event, u) => {
            if (!u.startsWith(prefix)) event.preventDefault();
        });
        wc.on('console-message', (e, lvl, msg) => {
            // Electron 新版只給一個 event（level 是字串），舊版是 (event, level 數字, message)
            const raw = e && e.level !== undefined ? e.level : lvl;
            const level = typeof raw === 'number' ? ['debug', 'info', 'warning', 'error'][raw] || 'info' : String(raw);
            if (level === 'warning' || level === 'error') push(level, e && e.message !== undefined ? e.message : msg);
        });
        wc.on('did-fail-load', (_e, code, desc) => push('error', `頁面載入失敗：${desc}（${code}）`));
        wc.on('render-process-gone', (_e, d) => push('error', `頁面當掉了：${d && d.reason}`));

        await Promise.race([wc.loadURL(url), sleep(8000)]);
        await sleep(1500);
        const shot = async () => {
            const img = await wc.capturePage();
            return img.isEmpty() ? '' : img.toPNG().toString('base64');
        };
        const shots = [];
        shots.push(await shot());

        // 像第一次玩的人：點畫面上幾個地方、拖一下（拉桿）、按幾個常用鍵
        const pts = [
            [0.5, 0.5], [0.5, 0.75], [0.5, 0.85], [0.25, 0.5], [0.75, 0.5], [0.5, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.6],
        ];
        for (const [fx, fy] of pts) {
            const x = Math.round(W * fx);
            const y = Math.round(H * fy);
            wc.sendInputEvent({ type: 'mouseMove', x, y });
            wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
            await sleep(250);
        }
        for (const fy of [0.6, 0.75, 0.9]) {
            const y = Math.round(H * fy);
            wc.sendInputEvent({ type: 'mouseDown', x: Math.round(W * 0.3), y, button: 'left', clickCount: 1 });
            for (let i = 1; i <= 5; i++) {
                wc.sendInputEvent({ type: 'mouseMove', x: Math.round(W * (0.3 + i * 0.12)), y, button: 'left' });
                await sleep(40);
            }
            wc.sendInputEvent({ type: 'mouseUp', x: Math.round(W * 0.9), y, button: 'left', clickCount: 1 });
        }
        for (const key of ['Space', 'Enter', 'Right', 'Left', 'Up', 'Down']) {
            wc.sendInputEvent({ type: 'keyDown', keyCode: key });
            wc.sendInputEvent({ type: 'keyUp', keyCode: key });
            await sleep(150);
        }
        await sleep(600);
        shots.push(await shot());
        await sleep(2500);
        shots.push(await shot());

        let text = '';
        try {
            text = String(await Promise.race([wc.executeJavaScript('document.body ? document.body.innerText : ""', true), sleep(2000).then(() => '')])).slice(0, 800);
        } catch {
            // 拿不到文字也沒關係
        }
        return { ok: true, shots: shots.filter(Boolean), logs, text };
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

/* ===== 西雅的瀏覽器（11/6）：在背景（看不見的視窗）替她開網頁、點、打字 =====
 * 登入資料存在自己的分區（persist:seia-browser），跟你的 Chrome、桌寵本身都分開。
 * 擋住：本機和內網的網址（包含網頁裡偷偷連過去的請求）、file:、在密碼／信用卡欄位打字、
 * 在付款／結帳／銀行／刪除帳號頁面點按或打字、跳出新視窗（改成在同一個分頁開）、網頁要權限（相機、通知…一律拒絕）。
 * 下載的檔案存到 data/browser-downloads/（每個最多 300MB）。閒置 10 分鐘自動關掉。
 * 你要幫她登入某個網站：後端叫 action=login，會開一個「看得到」的視窗，跟她共用同一個分區。
 */
const BROWSER_PARTITION = 'persist:seia-browser';
const BROWSER_W = 1280;
const BROWSER_H = 900;
const BLOCK_HOST_RE = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|::1$|::$|fc|fd|fe80:)|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\.local$|\.localhost$|\.internal$/i;
const SENSITIVE_URL_RE = /checkout|payment|\/pay(\/|\?|$)|paypal|billing|purchase|wallet|bank|transfer|delete[-_]?account|account\/delete|close[-_]?account|deactivate/i;
const SECRET_FIELD_RE = /pass|pwd|card|cvv|cvc|ccnum|cc-|pin\b|otp|one-time|ssn|security.?code|身分證|密碼|卡號/i;
let seiaBrowser = null;
let browserIdle = null;
let browserBusy = false;
let browserLoginWin = null;
const browserDownloads = [];

function browserHostOk(raw) {
    try {
        const u = new URL(raw);
        const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        return !!h && !BLOCK_HOST_RE.test(h);
    } catch {
        return false;
    }
}
function browserUrlOk(raw) {
    try {
        return /^https?:$/.test(new URL(raw).protocol) && browserHostOk(raw);
    } catch {
        return false;
    }
}

function browserSession() {
    const ses = session.fromPartition(BROWSER_PARTITION);
    if (ses.__seiaSetup) return ses;
    ses.__seiaSetup = true;
    // 網頁裡任何請求（圖片、fetch、WebSocket…）都不准連到本機或內網，例如桌寵自己的 API
    ses.webRequest.onBeforeRequest((d, cb) => {
        let cancel = false;
        try {
            const u = new URL(d.url);
            if (u.protocol === 'file:') cancel = true;
            else if (/^(https?|wss?):$/.test(u.protocol)) cancel = !browserHostOk(d.url);
        } catch {
            // 看不懂的網址照常
        }
        cb({ cancel });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.on('will-download', (_e, item) => {
        const dir = path.join(__dirname, 'data', 'browser-downloads');
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            // 建不了就讓下載失敗
        }
        let name = String(item.getFilename() || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'download';
        let dest = path.join(dir, name);
        for (let i = 1; fs.existsSync(dest) && i < 100; i++) dest = path.join(dir, name.replace(/(\.[^.]*)?$/, ` (${i})$1`));
        item.setSavePath(dest);
        const rec = { at: Date.now(), url: item.getURL().slice(0, 300), file: path.basename(dest), state: 'progressing' };
        browserDownloads.push(rec);
        if (browserDownloads.length > 20) browserDownloads.shift();
        item.on('updated', () => {
            if (item.getReceivedBytes() > 300 * 1024 * 1024) item.cancel();
        });
        item.once('done', (_ev, state) => {
            rec.state = state;
            console.log(`[瀏覽器] 下載${state === 'completed' ? '完成' : '沒成功'}：${rec.file}`);
        });
    });
    return ses;
}

function closeSeiaBrowser() {
    if (browserIdle) clearTimeout(browserIdle);
    browserIdle = null;
    if (seiaBrowser && !seiaBrowser.isDestroyed()) seiaBrowser.destroy();
    seiaBrowser = null;
}

function guardContents(wc) {
    wc.setAudioMuted(true);
    // 新視窗（target=_blank）改成在同一個分頁開
    wc.setWindowOpenHandler(({ url }) => {
        if (browserUrlOk(url)) setTimeout(() => wc.loadURL(url).catch(() => {}), 0);
        return { action: 'deny' };
    });
    const stop = (e, u) => {
        if (!browserUrlOk(u)) e.preventDefault();
    };
    wc.on('will-navigate', stop);
    wc.on('will-redirect', stop);
}

function ensureSeiaBrowser() {
    if (browserIdle) clearTimeout(browserIdle);
    browserIdle = setTimeout(closeSeiaBrowser, 10 * 60 * 1000);
    if (seiaBrowser && !seiaBrowser.isDestroyed()) return seiaBrowser;
    seiaBrowser = new BrowserWindow({
        width: BROWSER_W,
        height: BROWSER_H,
        useContentSize: true,
        show: false,
        paintWhenInitiallyHidden: true,
        backgroundColor: '#ffffff',
        webPreferences: {
            offscreen: true,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            session: browserSession(),
            backgroundThrottling: false,
        },
    });
    seiaBrowser.webContents.setFrameRate(5);
    guardContents(seiaBrowser.webContents);
    return seiaBrowser;
}

const PAGE_STATE_JS = `(() => {
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=""],[contenteditable=true],summary,[onclick]';
  document.querySelectorAll('[data-seia-n]').forEach((e) => e.removeAttribute('data-seia-n'));
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    n++;
    el.setAttribute('data-seia-n', String(n));
    const val = el.tagName === 'INPUT' && el.type === 'password' ? '' : (el.value || '');
    const t = (el.innerText || val || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.push({ n, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', role: el.getAttribute('role') || '', text: t, href: el.tagName === 'A' ? String(el.href || '').slice(0, 160) : '' });
    if (n >= 120) break;
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 3000), elements: out, scrollY: Math.round(scrollY), scrollH: document.documentElement.scrollHeight, viewH: innerHeight };
})()`;

async function pageState(wc, withShot = true) {
    const st = await Promise.race([wc.executeJavaScript(PAGE_STATE_JS, true), sleep(4000).then(() => null)]).catch(() => null);
    const out = st || { url: wc.getURL(), title: wc.getTitle(), text: '', elements: [] };
    if (withShot) {
        try {
            const img = await wc.capturePage();
            if (!img.isEmpty()) out.shot = img.resize({ width: 960 }).toJPEG(60).toString('base64');
        } catch {
            // 沒截圖也沒關係
        }
    }
    out.downloads = browserDownloads.slice(-5);
    return out;
}

async function waitSettled(wc, ms = 1500) {
    await sleep(300);
    if (wc.isLoading()) await Promise.race([new Promise((r) => wc.once('did-stop-loading', r)), sleep(8000)]);
    await sleep(ms);
}

/** 找到第 n 個元素：捲到畫面中間，回傳中心點和它是什麼 */
async function locate(wc, n) {
    return wc.executeJavaScript(
        `(() => { const el = document.querySelector('[data-seia-n="${Number(n)}"]'); if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
          const attrs = [el.getAttribute('type'), el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('placeholder')].filter(Boolean).join(' ');
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), attrs, editable: el.isContentEditable }; })()`,
        true
    );
}

async function browserAction(j) {
    const action = String(j.action || '');
    if (action === 'close') {
        closeSeiaBrowser();
        return { ok: true };
    }
    if (action === 'login') {
        const url = String(j.url || '');
        if (!browserUrlOk(url)) return { ok: false, reason: '這個網址不能開' };
        if (browserLoginWin && !browserLoginWin.isDestroyed()) {
            browserLoginWin.loadURL(url).catch(() => {});
            browserLoginWin.focus();
            return { ok: true };
        }
        browserLoginWin = new BrowserWindow({
            width: 1100,
            height: 820,
            title: '幫西雅登入（她的瀏覽器）',
            autoHideMenuBar: true,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: browserSession() },
        });
        guardContents(browserLoginWin.webContents);
        browserLoginWin.webContents.setAudioMuted(false);
        browserLoginWin.on('closed', () => (browserLoginWin = null));
        browserLoginWin.loadURL(url).catch(() => {});
        return { ok: true };
    }
    if (action === 'clear') {
        closeSeiaBrowser();
        await browserSession().clearStorageData();
        await browserSession().clearCache();
        return { ok: true };
    }
    const win = ensureSeiaBrowser();
    const wc = win.webContents;
    const cur = wc.getURL();
    if (action === 'open') {
        const url = String(j.url || '');
        if (!browserUrlOk(url)) return { ok: false, reason: '這個網址不能開（只能開公開的 http／https 網站）' };
        await Promise.race([wc.loadURL(url).catch(() => {}), sleep(15000)]);
        await waitSettled(wc);
        return { ok: true, state: await pageState(wc) };
    }
    if (!cur || cur === 'about:blank') return { ok: false, reason: '還沒打開任何網頁，先用 open' };
    if (action === 'state') return { ok: true, state: await pageState(wc, j.shot !== false) };
    if (action === 'back') {
        if (wc.canGoBack()) wc.goBack();
        await waitSettled(wc);
        return { ok: true, state: await pageState(wc) };
    }
    if (action === 'scroll') {
        const dy = Math.max(-3000, Math.min(3000, Number(j.dy) || 700));
        await wc.executeJavaScript(`window.scrollBy(0, ${dy})`, true).catch(() => {});
        await sleep(700);
        return { ok: true, state: await pageState(wc) };
    }
    if (action === 'click' || action === 'type') {
        if (SENSITIVE_URL_RE.test(cur)) return { ok: false, reason: '這是付款、結帳、銀行或刪除帳號之類的頁面，要主人自己來' };
        const el = await locate(wc, j.n).catch(() => null);
        if (!el) return { ok: false, reason: `畫面上找不到第 ${j.n} 個元素（頁面可能變了，先用 state 重新看）` };
        if (action === 'click') {
            wc.sendInputEvent({ type: 'mouseMove', x: el.x, y: el.y });
            wc.sendInputEvent({ type: 'mouseDown', x: el.x, y: el.y, button: 'left', clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseUp', x: el.x, y: el.y, button: 'left', clickCount: 1 });
            await waitSettled(wc);
            return { ok: true, state: await pageState(wc) };
        }
        if (el.type === 'password' || SECRET_FIELD_RE.test(el.attrs)) return { ok: false, reason: '這是密碼、卡號之類的欄位，西雅不能自己填（要登入就請主人幫忙）' };
        const text = String(j.text || '').slice(0, 2000);
        if (el.tag === 'select') {
            await wc.executeJavaScript(
                `(() => { const s = document.querySelector('[data-seia-n="${Number(j.n)}"]'); const t = ${JSON.stringify(text)};
                  const o = [...s.options].find((x) => x.text.trim() === t || x.value === t) || [...s.options].find((x) => x.text.includes(t));
                  if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } })()`,
                true
            );
        } else {
            wc.sendInputEvent({ type: 'mouseDown', x: el.x, y: el.y, button: 'left', clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseUp', x: el.x, y: el.y, button: 'left', clickCount: 1 });
            await sleep(150);
            wc.selectAll();
            wc.insertText(text);
            if (j.enter) {
                await sleep(150);
                wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
                wc.sendInputEvent({ type: 'char', keyCode: '\r' });
                wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
            }
        }
        await waitSettled(wc, j.enter ? 1500 : 500);
        return { ok: true, state: await pageState(wc) };
    }
    return { ok: false, reason: `不認得的動作：${action}` };
}

function handleBrowse(req, reply) {
    let body = '';
    req.on('data', (c) => {
        body += c;
        if (body.length > 20000) req.destroy();
    });
    req.on('end', async () => {
        let j;
        try {
            j = JSON.parse(body || '{}');
        } catch {
            return reply(400, { ok: false });
        }
        const light = ['login', 'close'].includes(String(j.action));
        if (browserBusy && !light) return reply(409, { ok: false, reason: 'busy' });
        if (!light) browserBusy = true;
        try {
            reply(200, await browserAction(j));
        } catch (err) {
            reply(500, { ok: false, reason: String((err && err.message) || err).slice(0, 200) });
        } finally {
            if (!light) browserBusy = false;
        }
    });
}

function startPlaytestServer() {
    const srv = http.createServer((req, res) => {
        const reply = (code, obj) => {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST' || req.headers['x-gemini-pet'] !== '1' || req.headers.origin) return reply(403, { ok: false });
        // 西雅的瀏覽器（同一個只聽 127.0.0.1 的通道）
        if (req.url === '/browse') return handleBrowse(req, reply);
        if (req.url !== '/playtest') return reply(404, { ok: false });
        let body = '';
        req.on('data', (c) => {
            body += c;
            if (body.length > 2000) req.destroy();
        });
        req.on('end', async () => {
            let id = '';
            let entry = 'index.html';
            try {
                const j = JSON.parse(body || '{}');
                id = String(j.id || '');
                entry = String(j.entry || 'index.html');
            } catch {
                return reply(400, { ok: false });
            }
            if (!/^[wc]-[\d-]+$/.test(id) || entry.includes('..') || /^[\\/]/.test(entry)) return reply(400, { ok: false });
            if (playtestBusy) return reply(409, { ok: false, reason: 'busy' });
            playtestBusy = true;
            try {
                reply(200, await playtestWork(id, entry));
            } catch (err) {
                reply(500, { ok: false, reason: String((err && err.message) || err).slice(0, 200) });
            } finally {
                playtestBusy = false;
            }
        });
    });
    srv.on('error', (err) => console.log(`[試玩] ⚠️ 開不了 port ${PLAYTEST_PORT}：${err.message}`));
    srv.listen(PLAYTEST_PORT, '127.0.0.1', () => console.log(`[試玩] 西雅試玩作品用的通道已開（127.0.0.1:${PLAYTEST_PORT}）`));
}

ipcMain.handle('youtube-login-status', () => isYouTubeLoggedIn());

ipcMain.handle('youtube-login', () => {
    if (ytLoginWindow && !ytLoginWindow.isDestroyed()) {
        ytLoginWindow.focus();
        return;
    }
    ytLoginWindow = new BrowserWindow({
        width: 480,
        height: 720,
        title: '登入 YouTube',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    ytLoginWindow.loadURL(YT_LOGIN_URL);
    // Google 登入流程裡的新視窗留在這個登入視窗；其他網站交給預設瀏覽器
    ytLoginWindow.webContents.setWindowOpenHandler(({ url }) => {
        let host = '';
        try { host = new URL(url).hostname; } catch { /* ignore */ }
        if (GOOGLE_DOMAIN_RE.test(host)) ytLoginWindow?.loadURL(url);
        else if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    // 登入完成會跳回 YouTube 首頁 → 確認有登入就自動關窗
    ytLoginWindow.webContents.on('did-navigate', async (_e, url) => {
        if (/^https:\/\/(www\.|m\.)?youtube\.com\//i.test(url) && (await isYouTubeLoggedIn())) {
            if (ytLoginWindow && !ytLoginWindow.isDestroyed()) ytLoginWindow.close();
        }
    });
    ytLoginWindow.on('closed', async () => {
        ytLoginWindow = null;
        notifyYouTubeLogin(await isYouTubeLoggedIn());
    });
});

// 登出：只清掉桌寵這邊的 Google / YouTube Cookie，不影響 Chrome
ipcMain.handle('youtube-logout', async () => {
    const ses = session.defaultSession;
    const all = await ses.cookies.get({});
    await Promise.all(
        all
            .filter((ck) => GOOGLE_DOMAIN_RE.test(ck.domain.replace(/^\./, '')))
            .map((ck) =>
                ses.cookies
                    .remove(`http${ck.secure ? 's' : ''}://${ck.domain.replace(/^\./, '')}${ck.path}`, ck.name)
                    .catch(() => {})
            )
    );
    notifyYouTubeLogin(false);
    return false;
});

// 語音輸入全域熱鍵：就算正在打遊戲（桌寵沒有焦點）也能按。
// 預設 Ctrl+Alt+V，可用環境變數 VOICE_HOTKEY 改，例如 VOICE_HOTKEY=F8
const VOICE_HOTKEY = process.env.VOICE_HOTKEY || 'Ctrl+Alt+V';
let registeredVoiceHotkey = null;

ipcMain.handle('get-voice-hotkey', () => registeredVoiceHotkey);

// 叫出她的全域熱鍵：不管在哪個畫面都把她拉到最上面、把焦點給聊天框；她已經在焦點上就把焦點還回去
// 預設 Ctrl+Alt+S，可用環境變數 SUMMON_HOTKEY 改
const SUMMON_HOTKEY = process.env.SUMMON_HOTKEY || 'Ctrl+Alt+S';
let registeredSummonHotkey = null;
ipcMain.handle('get-summon-hotkey', () => registeredSummonHotkey);

function summonPet() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isFocused()) {
        mainWindow.blur(); // 焦點交回給後面的視窗（通常就是遊戲）
        if (pinMode !== 'game') applyPin();
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.send('summon');
    // 不是「遊戲中最上層」模式時，等她失去焦點再回到原本的置頂等級
    if (pinMode !== 'game') mainWindow.once('blur', () => applyPin());
}

function registerSummonHotkey() {
    const ok = globalShortcut.register(SUMMON_HOTKEY, summonPet);
    if (ok) {
        registeredSummonHotkey = SUMMON_HOTKEY;
        console.log(`[置頂] 叫出熱鍵 ${SUMMON_HOTKEY} 已啟用`);
    } else {
        console.log(`[置頂] ⚠️ 熱鍵 ${SUMMON_HOTKEY} 被其他程式占用，請用 SUMMON_HOTKEY 換一組`);
    }
}

function registerVoiceHotkey() {
    const ok = globalShortcut.register(VOICE_HOTKEY, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('voice-hotkey');
        }
    });
    if (ok) {
        registeredVoiceHotkey = VOICE_HOTKEY;
        console.log(`[語音] 全域熱鍵 ${VOICE_HOTKEY} 已啟用`);
    } else {
        console.log(`[語音] ⚠️ 熱鍵 ${VOICE_HOTKEY} 被其他程式占用，請用 VOICE_HOTKEY 換一組`);
    }
}

app.whenReady().then(() => {
    createWindow();
    // 保險：視窗失去焦點時一定停止拖曳
    mainWindow.on('blur', stopWindowDrag);
    // 遊戲搶走焦點時，最上層模式馬上把她拉回來一次
    mainWindow.on('blur', () => setTimeout(reassertTop, 250));
    registerVoiceHotkey();
    registerSummonHotkey();
    startPlaytestServer();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});