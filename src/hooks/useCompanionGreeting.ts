import { useEffect, useRef } from 'react';

/**
 * 陪伴感：像朋友一樣注意到主人「來了」「回來了」「這麼晚還沒睡」。
 *
 *  - startup：打開桌寵時，距離上次見面超過 1 小時 → 打招呼
 *  - return：主人離開電腦 10 分鐘以上又回來 → 打招呼（Electron 用系統閒置時間判斷）
 *  - late_night：凌晨 1~5 點主人還在用電腦 → 一晚提醒一次早點睡
 *
 * 同類招呼至少間隔 20 分鐘，避免一直講話。
 */

export type GreetingReason = 'startup' | 'return' | 'late_night' | 'hourly';

interface Options {
  greetOnReturn: boolean;
  lateNightReminder: boolean;
  /** awayMinutes：離開了幾分鐘；awaySince：從什麼時候開始不在（用來找「不在時」貓貓找到的東西） */
  onGreet: (reason: GreetingReason, awayMinutes: number, awaySince: number) => void;
  /** 主人剛離開電腦（閒置超過 10 分鐘）時呼叫一次，例如趁空檔整理事件日記 */
  onAway?: () => void;
}

const LAST_SEEN_KEY = 'gemini_twin_cat_last_seen';
const LATE_NIGHT_KEY = 'gemini_twin_cat_late_night_reminded';
const POLL_MS = 15_000;
const AWAY_THRESHOLD_SEC = 10 * 60; // 閒置超過 10 分鐘才算「離開」
const BACK_SEC = 30; // 閒置時間掉回 30 秒內 = 回來了
const STARTUP_GAP_MIN = 60;
const MIN_GAP_MS = 20 * 60 * 1000;
// 每分鐘把閒置秒數告訴後端（河木鎮：判斷主人在不在、西雅要不要去上班）
const PRESENCE_EVERY_MS = 60_000;

function readNumber(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function useCompanionGreeting({ greetOnReturn, lateNightReminder, onGreet, onAway }: Options) {
  const onGreetRef = useRef(onGreet);
  const onAwayRef = useRef(onAway);
  const optsRef = useRef({ greetOnReturn, lateNightReminder });
  useEffect(() => {
    onGreetRef.current = onGreet;
    onAwayRef.current = onAway;
    optsRef.current = { greetOnReturn, lateNightReminder };
  }, [onGreet, onAway, greetOnReturn, lateNightReminder]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    let lastGreetAt = 0;
    let maxIdleSec = 0; // 這段離開期間觀察到的最長閒置時間
    let lastDomActivity = Date.now();
    let lastPresenceAt = 0;

    const greet = (reason: GreetingReason, awayMinutes: number, awaySince: number) => {
      if (Date.now() - lastGreetAt < MIN_GAP_MS) return;
      lastGreetAt = Date.now();
      onGreetRef.current(reason, awayMinutes, awaySince);
    };

    // 開啟時：距離上次見面夠久才打招呼（第一次使用已經有歡迎訊息，不重複）
    const lastSeen = readNumber(LAST_SEEN_KEY);
    write(LAST_SEEN_KEY, String(Date.now()));
    if (lastSeen && optsRef.current.greetOnReturn) {
      const gapMin = (Date.now() - lastSeen) / 60000;
      if (gapMin >= STARTUP_GAP_MIN) {
        // 稍等一下，讓立繪和語音先載入
        window.setTimeout(() => greet('startup', gapMin, lastSeen), 2500);
      }
    }

    // 瀏覽器模式：沒有系統閒置時間，退而求其次監聽本頁操作
    const markDom = () => {
      lastDomActivity = Date.now();
    };
    const domEvents = ['mousemove', 'keydown', 'pointerdown', 'wheel'] as const;
    if (!api?.getSystemIdleSeconds) {
      domEvents.forEach((e) => window.addEventListener(e, markDom, { passive: true }));
    }

    const check = async () => {
      let idleSec: number;
      try {
        idleSec = api?.getSystemIdleSeconds
          ? await api.getSystemIdleSeconds()
          : (Date.now() - lastDomActivity) / 1000;
      } catch {
        return;
      }

      if (Date.now() - lastPresenceAt >= PRESENCE_EVERY_MS) {
        lastPresenceAt = Date.now();
        fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idleSec }),
        }).catch(() => {});
      }

      const active = idleSec < BACK_SEC;
      if (active) write(LAST_SEEN_KEY, String(Date.now()));

      // 離開 → 回來
      if (idleSec >= AWAY_THRESHOLD_SEC) {
        if (maxIdleSec < AWAY_THRESHOLD_SEC) onAwayRef.current?.(); // 剛離開
        maxIdleSec = Math.max(maxIdleSec, idleSec);
      } else if (active && maxIdleSec >= AWAY_THRESHOLD_SEC) {
        const awayMinutes = maxIdleSec / 60;
        const awaySince = Date.now() - maxIdleSec * 1000;
        maxIdleSec = 0;
        if (optsRef.current.greetOnReturn) greet('return', awayMinutes, awaySince);
        return;
      }

      // 深夜還在用電腦：一晚只提醒一次
      const now = new Date();
      const hour = now.getHours();
      if (active && optsRef.current.lateNightReminder && hour >= 1 && hour < 5) {
        const tonight = now.toDateString();
        let reminded = '';
        try {
          reminded = localStorage.getItem(LATE_NIGHT_KEY) || '';
        } catch {
          // ignore
        }
        if (reminded !== tonight) {
          write(LATE_NIGHT_KEY, tonight);
          greet('late_night', 0, Date.now());
        }
      }
    };

    const timer = window.setInterval(check, POLL_MS);
    return () => {
      window.clearInterval(timer);
      domEvents.forEach((e) => window.removeEventListener(e, markDom));
    };
  }, []);
}
