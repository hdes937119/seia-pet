import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * 右鍵扇形選單：以立繪為圓心，往「視窗中央」的方向展開成扇形，
 * 所以桌寵放在角落時選單也不會超出畫面。點外面、按 Esc 或再按右鍵就收起。
 */

export interface RadialMenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  active?: boolean;
  badge?: number;
}

interface RadialMenuProps {
  open: boolean;
  center: { x: number; y: number };
  items: RadialMenuItem[];
  onClose: () => void;
  radius?: number;
  spreadDeg?: number;
}

export const RadialMenu: React.FC<RadialMenuProps> = ({
  open,
  center,
  items,
  onClose,
  radius = 112,
  spreadDeg = 150,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 扇形的中心方向：從立繪指向視窗中央
  const towardX = window.innerWidth / 2 - center.x;
  const towardY = window.innerHeight / 2 - center.y;
  const baseAngle = Math.atan2(towardY, towardX);
  const spread = (spreadDeg * Math.PI) / 180;
  const step = items.length > 1 ? spread / (items.length - 1) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="radial"
          className="fixed inset-0 z-[70]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        >
          {/* 中心光圈 */}
          <motion.div
            className="absolute w-28 h-28 -ml-14 -mt-14 rounded-full border-2 border-dashed border-purple-300/60 shadow-[0_0_24px_rgba(168,85,247,0.45)] pointer-events-none"
            style={{ left: center.x, top: center.y }}
            initial={{ scale: 0.3 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.3 }}
          />

          {items.map((item, i) => {
            const angle = baseAngle - spread / 2 + step * i;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            return (
              <motion.button
                key={item.id}
                type="button"
                className="absolute -ml-7 -mt-7 w-14 h-14 rounded-full flex flex-col items-center justify-center gap-0.5 text-white shadow-xl border-2 transition-colors group"
                style={{ left: center.x, top: center.y }}
                initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
                animate={{ x, y, scale: 1, opacity: 1 }}
                exit={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
                transition={{ type: 'spring', damping: 16, stiffness: 260, delay: i * 0.03 }}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                  onClose();
                }}
              >
                <span
                  className={`absolute inset-0 rounded-full ${
                    item.active
                      ? 'bg-gradient-to-br from-pink-500 to-purple-600 border-pink-200'
                      : 'bg-slate-900/90 group-hover:bg-purple-700/95'
                  } border-2 border-purple-300/60 backdrop-blur-md`}
                />
                <span className="relative">{item.icon}</span>
                <span className="relative text-[9px] font-semibold leading-none whitespace-nowrap">{item.label}</span>
                {!!item.badge && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-pink-500 text-[9px] font-bold flex items-center justify-center border border-white">
                    {item.badge}
                  </span>
                )}
              </motion.button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
