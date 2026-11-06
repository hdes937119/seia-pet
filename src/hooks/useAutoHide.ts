import { useCallback, useEffect, useRef, useState } from 'react';
import { installPetInteractionTracking, lastPetInteractionAt, markPetInteraction } from '../utils/petInteraction';

/**
 * 自動躲起來：主人 delayMs 沒碰她（沒點她、沒摸頭、沒跟她聊天），她就溜出畫面，只剩呆毛在角落。
 *
 *  - keepVisible = true（她在說話、有推播、對話框或選單開著…）時一定出來，而且不會躲
 *  - 那些事情結束後，再等 delayMs 才躲
 *  - wake()：點呆毛時叫她出來
 */
interface Options {
  enabled: boolean;
  delayMs: number;
  keepVisible: boolean;
}

export function useAutoHide({ enabled, delayMs, keepVisible }: Options) {
  const [hidden, setHidden] = useState(false);
  const keepRef = useRef(keepVisible);
  keepRef.current = keepVisible;
  // 最後一次「她有事在忙」的時間，忙完後從這裡開始倒數
  const busyAt = useRef(Date.now());

  useEffect(() => {
    installPetInteractionTracking();
  }, []);

  // 有事要做 → 立刻出來；做完的那一刻開始倒數
  useEffect(() => {
    if (keepVisible) setHidden(false);
    busyAt.current = Date.now();
  }, [keepVisible]);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    busyAt.current = Date.now(); // 剛打開這個功能時也給 delayMs 的緩衝
    const timer = window.setInterval(() => {
      if (keepRef.current) {
        busyAt.current = Date.now();
        return;
      }
      if (Date.now() - Math.max(lastPetInteractionAt(), busyAt.current) >= delayMs) setHidden(true);
    }, 250);
    return () => window.clearInterval(timer);
  }, [enabled, delayMs]);

  const wake = useCallback(() => {
    markPetInteraction();
    busyAt.current = Date.now();
    setHidden(false);
  }, []);

  return { hidden: enabled && hidden, wake };
}
