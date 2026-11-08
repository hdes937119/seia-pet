const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenId: () => ipcRenderer.invoke('get-screen'),
  // 角落把手拖動整個桌寵視窗
  startWindowDrag: () => ipcRenderer.send('window-drag-start'),
  stopWindowDrag: () => ipcRenderer.send('window-drag-stop'),
  // 自主探索：系統閒置秒數、用預設瀏覽器開啟連結
  getSystemIdleSeconds: () => ipcRenderer.invoke('get-system-idle'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // 透明區域滑鼠穿透：ignore=true 時點擊會穿過視窗到底下的程式
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', Boolean(ignore)),
  // YouTube 帳號（點唱機用主人的帳號播放）
  getYouTubeLoginStatus: () => ipcRenderer.invoke('youtube-login-status'),
  youtubeLogin: () => ipcRenderer.invoke('youtube-login'),
  youtubeLogout: () => ipcRenderer.invoke('youtube-logout'),
  onYouTubeLoginChanged: (callback) => {
    const handler = (_event, loggedIn) => callback(Boolean(loggedIn));
    ipcRenderer.on('youtube-login-changed', handler);
    return () => ipcRenderer.removeListener('youtube-login-changed', handler);
  },
  // 西雅工坊的作品：開成可以調整大小的獨立視窗
  openWorkshopWork: (id, entry, title) => ipcRenderer.invoke('open-workshop-work', id, entry, title),
  // 西雅的配件（主人安裝過的作品）：開成小視窗
  openWidget: (id, title) => ipcRenderer.invoke('open-widget', id, title),
  // 語音輸入全域熱鍵：回傳取消訂閱的函式
  getVoiceHotkey: () => ipcRenderer.invoke('get-voice-hotkey'),
  onVoiceHotkey: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('voice-hotkey', handler);
    return () => ipcRenderer.removeListener('voice-hotkey', handler);
  },
  // 置頂模式（off／normal／game）與叫出她的全域熱鍵
  setPinMode: (mode) => ipcRenderer.send('set-pin-mode', String(mode)),
  getSummonHotkey: () => ipcRenderer.invoke('get-summon-hotkey'),
  onSummon: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('summon', handler);
    return () => ipcRenderer.removeListener('summon', handler);
  },
});
