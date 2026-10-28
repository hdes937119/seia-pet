import { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, powerMonitor, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(">>> 桌寵主程式啟動中... <<<");

let mainWindow;

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

    // 注意：網址（localhost vs 127.0.0.1）決定了 localStorage / IndexedDB 存在哪裡，
    // 改掉會讓聊天紀錄、記憶、立繪「看起來不見」，所以保持原本的 localhost。
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.setMenuBarVisibility(false);
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

// 語音輸入全域熱鍵：就算正在打遊戲（桌寵沒有焦點）也能按。
// 預設 Ctrl+Alt+V，可用環境變數 VOICE_HOTKEY 改，例如 VOICE_HOTKEY=F8
const VOICE_HOTKEY = process.env.VOICE_HOTKEY || 'Ctrl+Alt+V';
let registeredVoiceHotkey = null;

ipcMain.handle('get-voice-hotkey', () => registeredVoiceHotkey);

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
    registerVoiceHotkey();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});