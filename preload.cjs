const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenId: () => ipcRenderer.invoke('get-screen'),
  // 角落把手拖動整個桌寵視窗
  startWindowDrag: () => ipcRenderer.send('window-drag-start'),
  stopWindowDrag: () => ipcRenderer.send('window-drag-stop'),
  // 透明區域滑鼠穿透：ignore=true 時點擊會穿過視窗到底下的程式
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', Boolean(ignore)),
  // 語音輸入全域熱鍵：回傳取消訂閱的函式
  getVoiceHotkey: () => ipcRenderer.invoke('get-voice-hotkey'),
  onVoiceHotkey: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('voice-hotkey', handler);
    return () => ipcRenderer.removeListener('voice-hotkey', handler);
  },
});
