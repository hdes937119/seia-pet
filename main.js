import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(">>> 桌寵主程式啟動中... <<<");

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 450,
        height: 700,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        resizable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'), // 掛載安全橋樑
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // 跟後端監聽的 127.0.0.1 對齊（Windows 上 localhost 可能先解析成 IPv6 ::1）
    mainWindow.loadURL('http://127.0.0.1:3000');
    mainWindow.setMenuBarVisibility(false);
}

// 建立 IPC 通道，在背景抓取主螢幕 ID 傳給前端
ipcMain.handle('get-screen', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0]?.id ?? null;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});