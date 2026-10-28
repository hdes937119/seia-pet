const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenId: () => ipcRenderer.invoke('get-screen')
});