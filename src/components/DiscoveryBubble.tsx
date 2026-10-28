import React from 'react';
import { motion } from 'motion/react';
import { ExternalLink, X } from 'lucide-react';
import type { Discovery } from '../types';

/**
 * 自主探索的推播氣泡（Phase 4）：在立繪頭頂彈出，
 * 點氣泡 → 用預設瀏覽器開啟文章 / 影片；✕ → 關掉（已經收進摸魚手帳）。
 */

const SOURCE_STYLE: Record<Discovery['source'], string> = {
  youtube: 'bg-red-500/90',
  wiki: 'bg-slate-600/90',
  news: 'bg-amber-500/90',
  reddit: 'bg-orange-500/90',
  hn: 'bg-orange-600/90',
  ptt: 'bg-indigo-700/90',
  bahamut: 'bg-sky-600/90',
};

const SOURCE_ICON: Record<Discovery['source'], string> = {
  youtube: '▶',
  wiki: 'W',
  news: '📰',
  reddit: '👽',
  hn: 'Y',
  ptt: '💬',
  bahamut: '🐉',
};

interface DiscoveryBubbleProps {
  discovery: Discovery;
  onOpen: () => void;
  onDismiss: () => void;
}

export const DiscoveryBubble: React.FC<DiscoveryBubbleProps> = ({ discovery, onOpen, onDismiss }) => (
  <motion.div
    initial={{ opacity: 0, y: 14, scale: 0.85 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -6, scale: 0.9 }}
    transition={{ type: 'spring', damping: 16, stiffness: 260 }}
    className="absolute bottom-[92%] right-0 w-[260px] z-50"
    onClick={(e) => e.stopPropagation()}
    onContextMenu={(e) => e.stopPropagation()}
  >
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="relative cursor-pointer bg-white/95 text-slate-800 rounded-2xl px-3 pt-2.5 pb-2 shadow-2xl border-2 border-pink-300 hover:border-pink-400 hover:-translate-y-0.5 transition-all"
      title="點一下用瀏覽器打開"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-700 text-white flex items-center justify-center shadow hover:bg-slate-600"
        title="關掉（已收進摸魚手帳）"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <p className="text-xs font-bold text-purple-700 leading-snug pr-3">{discovery.bubbleText}</p>

      <div className="mt-1.5 rounded-xl bg-slate-100 border border-slate-200 p-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${SOURCE_STYLE[discovery.source]}`}>
            {SOURCE_ICON[discovery.source]} {discovery.sourceLabel}
          </span>
          <span className="text-[10px] text-slate-500 truncate">#{discovery.tag}</span>
        </div>
        <p className="text-[12px] font-semibold leading-snug line-clamp-2">{discovery.title}</p>
        <p className="text-[11px] text-slate-600 mt-1 leading-snug line-clamp-2">🐾 {discovery.catReview}</p>
      </div>

      <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-pink-600 font-semibold">
        <ExternalLink className="w-3 h-3" /> 點我打開
      </div>
      <span className="absolute -bottom-2.5 right-14 w-4 h-4 bg-white/95 border-r-2 border-b-2 border-pink-300 rotate-45" />
    </div>
  </motion.div>
);
