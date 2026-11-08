// 西雅的配件（11/9）：配件視窗裡唯一能碰到的東西 window.seia。
// 每個呼叫都經過桌寵主程式（main.js 的 widget-bridge）轉給後端，後端檢查主人安裝時給的權限和頻率。
const { contextBridge, ipcRenderer } = require('electron');

const call = (action, args) => ipcRenderer.invoke('widget-bridge', action, args || {});

contextBridge.exposeInMainWorld('seia', {
  say: (text) => call('say', { text: String(text || '') }),
  notify: (title, body) => call('notify', { title: String(title || ''), body: String(body || '') }),
  remind: (opts) => call('remind', opts && typeof opts === 'object' ? opts : {}),
  reminders: () => call('reminders'),
  cancelReminder: (id) => call('cancel', { id: String(id || '') }),
});
