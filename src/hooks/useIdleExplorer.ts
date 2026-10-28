import { useEffect, useRef } from 'react';

/**
 * 閒置偵測（Phase 1）：主人超過 idleMinutes 沒有操作電腦時，呼叫一次 onIdle。
 *
 *  - Electron：用系統閒置時間（powerMonitor.getSystemIdleTime），
 *    主人在打遊戲、看網頁時也算「有在操作」，不會誤判。
 *  - 一般瀏覽器：退而求其次，監聽本頁的 mousemove / keydown / pointerdown / wheel。
 *
 * 同一段閒置只觸發一次；主人回來操作（閒置時間歸零）後才會重新計算。
 */

interface Options {
  enabled: boolean;
  idleMinutes: number;
  onIdle: () => void;
}

const POLL_MS = 20_000;
const ACTIVE_RESET_SEC = 30; // 閒置時間掉回這以下，就視為主人回來了

export function useIdleExplorer({ enabled, idleMinutes, onIdle }: Options) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    const api = (window as any).electronAPI;
    const thresholdSec = idleMinutes * 60;
    let firedThisSession = false;

    // 瀏覽器模式：自己記錄最後一次操作時間
    let lastActivity = Date.now();
    const markActive = () => {
      lastActivity = Date.now();
    };
    const domEvents = ['mousemove', 'keydown', 'pointerdown', 'wheel'] as const;
    if (!api?.getSystemIdleSeconds) {
      domEvents.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
    }

    const check = async () => {
      let idleSec: number;
      try {
        idleSec = api?.getSystemIdleSeconds
          ? await api.getSystemIdleSeconds()
          : (Date.now() - lastActivity) / 1000;
      } catch {
        return;
      }
      if (idleSec < ACTIVE_RESET_SEC) {
        firedThisSession = false;
        return;
      }
      if (!firedThisSession && idleSec >= thresholdSec) {
        firedThisSession = true;
        onIdleRef.current();
      }
    };

    const timer = window.setInterval(check, POLL_MS);
    return () => {
      window.clearInterval(timer);
      domEvents.forEach((e) => window.removeEventListener(e, markActive));
    };
  }, [enabled, idleMinutes]);
}
