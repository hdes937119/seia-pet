/**
 * 自訂立繪的永久儲存：交給後端存成專案資料夾裡的 data/custom-avatar.png。
 * 這樣不受瀏覽器儲存空間影響（換網址 localhost / 127.0.0.1、清快取都不會不見），
 * 也可以直接在資料夾裡找到這張圖。
 */

const LEGACY_LOCALSTORAGE_KEY = 'gemini_twin_cat_custom_img';

export async function loadCustomAvatar(): Promise<string | null> {
  try {
    const res = await fetch('/api/avatar', { method: 'HEAD', cache: 'no-store' });
    if (res.ok) return `/api/avatar?v=${Date.now()}`;

    // 舊版存在瀏覽器 localStorage 的圖 → 搬到檔案
    const legacy = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    if (legacy?.startsWith('data:image/')) {
      const saved = await saveCustomAvatar(legacy);
      if (saved) {
        localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
        return saved;
      }
      return legacy;
    }
  } catch (err) {
    console.warn('讀取自訂立繪失敗:', err);
  }
  return null;
}

/** 存檔成功時回傳可顯示的網址，失敗回傳 null */
export async function saveCustomAvatar(imageDataUrl: string): Promise<string | null> {
  try {
    const res = await fetch('/api/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: imageDataUrl }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `/api/avatar?v=${Date.now()}`;
  } catch (err) {
    console.warn('儲存自訂立繪失敗:', err);
    return null;
  }
}
