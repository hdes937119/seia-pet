import { useEffect, useRef } from 'react';
import { installPetInteractionTracking, lastPetInteractionAt } from '../utils/petInteraction';

/**
 * 冷落偵測：主人超過 idleMinutes 沒有理她（沒點她、沒摸頭、沒跟她聊天）時，呼叫一次 onIdle。
 * 用在：自動上網探索（預設 15 分鐘）、整理事件日記（10 分鐘）。
 *
 * 只看主人有沒有跟桌寵互動，不看整台電腦有沒有在用：
 * 主人在打遊戲、看網頁但沒理她，一樣會觸發。
 *
 * 同一段沒理她的時間只觸發一次；主人再理她之後才會重新計算。
 */

interface Options {
  enabled: boolean;
  idleMinutes: number;
  onIdle: () => void;
}

const POLL_MS = 20_000;

export function useIdleExplorer({ enabled, idleMinutes, onIdle }: Options) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    installPetInteractionTracking();
    const thresholdMs = idleMinutes * 60_000;
    // 已經為「哪一次互動之後的冷落」觸發過；主人再理她，時間戳就會不一樣
    let firedFor = -1;

    const check = () => {
      const last = lastPetInteractionAt();
      if (firedFor === last) return;
      if (Date.now() - last >= thresholdMs) {
        firedFor = last;
        onIdleRef.current();
      }
    };

    const timer = window.setInterval(check, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, idleMinutes]);
}
