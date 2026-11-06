import { useEffect, useRef } from 'react';

/**
 * 整點報時：每到整點（xx:00 ~ xx:02 之間）呼叫一次 onChime(hour)。
 *
 *  - 主人離開電腦 10 分鐘以上（Electron 系統閒置時間）就不報，沒人聽
 *  - onChime 回傳 false = 她現在在忙（正在回話、在聽你說話）→ 15 秒後再試，整點後 2 分鐘內都還會補報
 *  - 同一個整點只報一次（記在 localStorage，重開桌寵也不會重報）
 */

const LAST_CHIME_KEY = 'gemini_twin_cat_last_chime';
const POLL_MS = 15_000;
const LATE_MINUTES = 2; // 整點後幾分鐘內還可以補報
const AWAY_SEC = 10 * 60;

function read(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function useHourlyChime({ enabled, onChime }: { enabled: boolean; onChime: (hour: number) => boolean }) {
  const onChimeRef = useRef(onChime);
  onChimeRef.current = onChime;

  useEffect(() => {
    if (!enabled) return;
    const api = (window as any).electronAPI;

    const check = async () => {
      const now = new Date();
      if (now.getMinutes() > LATE_MINUTES) return;
      const key = `${now.toDateString()} ${now.getHours()}`;
      if (read(LAST_CHIME_KEY) === key) return;

      // 主人不在電腦前 → 這個整點就不報了
      try {
        if (api?.getSystemIdleSeconds && (await api.getSystemIdleSeconds()) >= AWAY_SEC) {
          write(LAST_CHIME_KEY, key);
          return;
        }
      } catch {
        // 拿不到閒置時間就當作主人在
      }

      if (onChimeRef.current(now.getHours())) write(LAST_CHIME_KEY, key);
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
