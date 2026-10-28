const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenId: () => ipcRenderer.invoke('get-screen'),
  // 角落把手拖動整個桌寵視窗
  startWindowDrag: () => ipcRenderer.send('window-drag-start'),
  stopWindowDrag: () => ipcRenderer.send('window-drag-stop'),
});
