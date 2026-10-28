import React, { useEffect, useRef } from 'react';

const LONG_PRESS_MS = 220; // 按住超過這個時間才算摸頭，輕點則是打開對話框

/**
 * 頭部感應區：按住（長按）是摸頭；輕點則照常把 click 往上傳給立繪（打開對話框）。
 * 動態桌寵、自訂立繪、原片全景共用。
 */
interface HeadPatZoneProps {
  onStart?: () => void;
  onEnd?: () => void;
  className: string;
}

export const HeadPatZone: React.FC<HeadPatZoneProps> = ({ onStart, onEnd, className }) => {
  const pressTimer = useRef<number | undefined>(undefined);
  const patting = useRef(false);
  const suppressClick = useRef(false);

  const endPress = () => {
    window.clearTimeout(pressTimer.current);
    if (patting.current) {
      patting.current = false;
      suppressClick.current = true;
      onEnd?.();
    }
  };
  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  if (!onStart && !onEnd) return null;

  return (
    <div
      className={`absolute z-40 rounded-full cursor-grab active:cursor-grabbing ${className}`}
      title="輕點聊天 · 按住摸頭"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        patting.current = false;
        window.clearTimeout(pressTimer.current);
        pressTimer.current = window.setTimeout(() => {
          patting.current = true;
          onStart?.();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onClick={(e) => {
        // 剛剛是摸頭 → 不要順便打開對話框
        if (suppressClick.current) {
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
    />
  );
};
