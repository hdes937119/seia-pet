import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * 她躲起來時留在角落的呆毛：輕輕晃，滑鼠移上去會抖，點一下叫她出來。
 * 位置在立繪頭頂的正下方（視窗底部），跟她鑽下去的地方對齊。
 */
export const Ahoge: React.FC<{ visible: boolean; onClick: () => void }> = ({ visible, onClick }) => (
  <AnimatePresence>
    {visible && (
      <motion.button
        key="ahoge"
        type="button"
        title="點我叫她出來"
        aria-label="叫她出來"
        onClick={onClick}
        className="pet-ahoge absolute z-40 bottom-0 w-9 h-14 cursor-pointer"
        style={{ right: 'calc(8px + var(--pet-w) * 0.5 - 18px)' }}
        initial={{ y: '110%' }}
        animate={{ y: '0%', transition: { delay: 0.6, type: 'spring', stiffness: 320, damping: 13 } }}
        exit={{ y: '110%', transition: { duration: 0.15 } }}
      >
        <svg viewBox="0 0 36 56" className="pet-ahoge-svg w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="ahoge-hair" x1="0" y1="1" x2="0.4" y2="0">
              <stop offset="0" stopColor="#4f63d8" />
              <stop offset="0.6" stopColor="#7c6ff0" />
              <stop offset="1" stopColor="#c08af5" />
            </linearGradient>
          </defs>
          {/* 外框 → 本體 → 高光 */}
          <path
            d="M18 60 C 16 47, 12 37, 15 27 C 18 15, 29 9, 31.5 16.5 C 33.5 22.5, 27 26.5, 23 21"
            fill="none"
            stroke="#2a1f66"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M18 60 C 16 47, 12 37, 15 27 C 18 15, 29 9, 31.5 16.5 C 33.5 22.5, 27 26.5, 23 21"
            fill="none"
            stroke="url(#ahoge-hair)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path d="M15.5 44 C 14 37, 14 32, 15.8 26" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </motion.button>
    )}
  </AnimatePresence>
);
