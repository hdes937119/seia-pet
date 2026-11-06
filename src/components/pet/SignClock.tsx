import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * 她躲起來時，從視窗底下伸一隻手舉著小木牌報時間（在呆毛左邊）。
 *  - 牌子：HH:mm（冒號慢慢閃）＋星期；滑鼠移上去多一行日期
 *  - 整點時牌子會晃一下
 *  - 深夜（23:00～06:00）變淡，滑鼠移上去恢復
 *  - 平常半透明、點擊會穿透到後面的視窗；滑鼠移到呆毛上時才變清楚並顯示日期
 */
const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const pad = (n: number) => String(n).padStart(2, '0');

// onClick：舊版點招牌可以叫她出來；現在招牌不擋點擊，只有呆毛能點（保留參數相容）
export const SignClock: React.FC<{ visible: boolean; onClick?: () => void }> = ({ visible }) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  const hour = now.getHours();
  const night = hour >= 23 || hour < 6;
  // 整點那一分鐘：key 換掉 → 重播晃動動畫
  const chimeKey = now.getMinutes() === 0 ? `chime-${hour}` : 'still';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="sign-clock"
          aria-hidden="true"
          // 點擊會直接穿透到後面的視窗（只有呆毛能點）；平常半透明，滑鼠移到呆毛上才變清楚、顯示日期（見 index.css）
          className={`pet-sign absolute z-40 bottom-0 w-[84px] pointer-events-none ${night ? 'pet-sign-night' : ''}`}
          style={{ right: 'calc(8px + var(--pet-w) * 0.5 + 22px)' }}
          initial={{ y: '110%' }}
          animate={{ y: '0%', transition: { delay: 0.85, type: 'spring', stiffness: 260, damping: 14 } }}
          exit={{ y: '110%', transition: { duration: 0.15 } }}
        >
          {/* 滑鼠移上去才出現的日期 */}
          <span className="pet-sign-date pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/85 border border-purple-400/50 px-2 py-0.5 text-[10px] text-purple-100 opacity-0 transition-opacity duration-150">
            {now.getMonth() + 1}月{now.getDate()}日 {WEEKDAYS[now.getDay()]}
          </span>

          {/* 外層：平常輕輕晃（CSS）；內層：整點大晃一下（motion），兩個分開才不會互相蓋掉 */}
          <div className="pet-sign-body" style={{ transformOrigin: '50% 100%' }}>
          <motion.div
            key={chimeKey}
            style={{ transformOrigin: '50% 100%' }}
            animate={chimeKey === 'still' ? undefined : { rotate: [0, -9, 7, -5, 3, 0] }}
            transition={{ duration: 1.1, ease: 'easeInOut' }}
          >
            {/* 木牌 */}
            <div className="relative mx-auto w-[78px] rounded-md border-2 border-[#8a5a2b] bg-[#f5e6c8] px-1 pt-0.5 pb-1 text-center leading-none shadow-[0_3px_8px_rgba(0,0,0,0.45)]">
              <span className="absolute left-1 top-1 h-1 w-1 rounded-full bg-[#8a5a2b]/70" />
              <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-[#8a5a2b]/70" />
              <div className="font-extrabold text-[18px] tracking-wide text-[#5b3a1e] tabular-nums">
                {pad(hour)}
                <span className="pet-sign-colon">:</span>
                {pad(now.getMinutes())}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-[#8a5a2b]">{WEEKDAYS[now.getDay()]}</div>
            </div>

            {/* 木棍 + 握著木棍的手 + 袖子（從視窗底下伸上來） */}
            <svg viewBox="0 0 84 66" className="block w-[84px] h-[66px] -mt-px" aria-hidden="true">
              <defs>
                <linearGradient id="sign-sleeve" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#6f63e6" />
                  <stop offset="1" stopColor="#3d3a9e" />
                </linearGradient>
              </defs>
              {/* 木棍 */}
              <rect x="39" y="0" width="6" height="44" rx="1.5" fill="#9a6633" stroke="#5e3b17" strokeWidth="1.2" />
              {/* 手（手背朝外握住木棍：四根手指橫著包住，大拇指從上面扣住） */}
              <path
                d="M30.5 29 Q30 24.5 35 24.5 L50 24.5 Q55 24.5 55 29.5 L55 39 Q55 44.5 49 44.5 L35.5 44.5 Q30.5 44.5 30.5 39 Z"
                fill="#ffe3d3"
                stroke="#a8705f"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              {/* 指縫（四根手指） */}
              <path d="M31 29.5 L46 29.5 M31 34.5 L46 34.5 M31 39.5 L46 39.5" stroke="#c98d7b" strokeWidth="1.1" strokeLinecap="round" />
              {/* 指尖彎回來的弧 */}
              <path d="M46 24.8 Q50.5 27 46 29.5 M46 29.5 Q50.5 32 46 34.5 M46 34.5 Q50.5 37 46 39.5 M46 39.5 Q50.5 42 46 44.3" fill="none" stroke="#c98d7b" strokeWidth="1.1" strokeLinecap="round" />
              {/* 大拇指 */}
              <path d="M30.8 28 Q33 20.5 41 21.6 Q44.5 22.4 43.2 25 Q41.5 26.3 37.5 26 Q34 26.6 32.6 29.8 Z" fill="#ffe3d3" stroke="#a8705f" strokeWidth="1.4" strokeLinejoin="round" />
              {/* 指甲的小粉色 */}
              <ellipse cx="40.6" cy="23.3" rx="1.6" ry="1" fill="#f7a7b8" opacity="0.8" />
              {/* 袖子 */}
              <path d="M24 67 L29 45 Q42 41 55 45 L60 67 Z" fill="url(#sign-sleeve)" stroke="#2a1f66" strokeWidth="1.6" strokeLinejoin="round" />
              {/* 袖口白邊 */}
              <path d="M28.5 47 Q42 42.5 55.5 47 L54.6 43.2 Q42 39 29.4 43.2 Z" fill="#f4f1ff" stroke="#2a1f66" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
