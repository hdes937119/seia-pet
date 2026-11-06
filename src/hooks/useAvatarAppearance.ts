import { useCallback, useEffect, useState } from 'react';
import { removeFakeTransparency } from '../utils/removeFakeTransparency';
import { loadCustomAvatar, saveCustomAvatar } from '../services/avatarStore';

/**
 * 立繪外觀：目前顯示哪種立繪（動態桌寵 / 自訂圖）＋自訂圖的載入與上傳。
 * 桌寵本體與設定面板共用同一份狀態。
 */

export type VisualMode = 'chibi' | 'custom';
const VISUAL_MODES: VisualMode[] = ['chibi', 'custom'];
const VISUAL_MODE_KEY = 'gemini_twin_cat_visual_mode';

export function useAvatarAppearance() {
  // 記住上次選的模式；舊的「動態骨骼」由動態桌寵取代，預設也是動態桌寵
  const [visualMode, setVisualMode] = useState<VisualMode>(() => {
    try {
      const saved = localStorage.getItem(VISUAL_MODE_KEY);
      if (saved === 'live_rig' || saved === 'mv_full') return 'chibi';
      return saved && (VISUAL_MODES as string[]).includes(saved) ? (saved as VisualMode) : 'chibi';
    } catch {
      return 'chibi';
    }
  });
  const [customImgUrl, setCustomImgUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 啟動時從後端（data/custom-avatar.*）載入自訂立繪
  useEffect(() => {
    let cancelled = false;
    loadCustomAvatar().then((url) => {
      if (cancelled) return;
      setCustomImgUrl(url);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 記住目前模式；若選了「自訂」但還沒有自訂圖，退回動態桌寵
  useEffect(() => {
    if (!loaded) return;
    if (visualMode === 'custom' && !customImgUrl) {
      setVisualMode('chibi');
      return;
    }
    try {
      localStorage.setItem(VISUAL_MODE_KEY, visualMode);
    } catch {
      // ignore
    }
  }, [visualMode, customImgUrl, loaded]);

  /** 上傳自訂立繪：GIF 保持原樣，其他圖片自動去除假透明棋盤格背景，存成 data/custom-avatar.* */
  const uploadCustomImage = useCallback(async (file: File) => {
    let result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    if (file.type !== 'image/gif') {
      try {
        result = (await removeFakeTransparency(result)).dataUrl;
      } catch (err) {
        console.warn('立繪背景處理失敗，改用原圖:', err);
      }
    }
    setCustomImgUrl(result);
    setVisualMode('custom');
    const savedUrl = await saveCustomAvatar(result);
    if (savedUrl) setCustomImgUrl(savedUrl);
    else console.warn('自訂立繪未能永久儲存，下次開啟可能需要重新上傳');
  }, []);

  return { visualMode, setVisualMode, customImgUrl, uploadCustomImage };
}
