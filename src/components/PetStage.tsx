import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, Mic, Search } from 'lucide-react';
import { ChibiPet } from './pet/ChibiPet';
import { DiscoveryBubble } from './DiscoveryBubble';
import type { Discovery } from '../types';
import type { PetStateId } from './pet/petStates';
import type { VisualMode } from '../hooks/useAvatarAppearance';

/**
 * 桌寵本體：只畫立繪（背景透明），固定在畫面上的一個座標點。
 *  - 左鍵輕點 → onLeftClick（打開 / 收起對話框）
 *  - 右鍵 → 攔截系統選單，改呼叫 onRightClick（扇形選單）
 *  - 動態桌寵按住頭部 → 摸頭
 *  - 對話框收起時，貓貓說的話用漫畫泡泡顯示在頭上
 */

interface PetStageProps {
  visualMode: VisualMode;
  customImgUrl: string | null;
  petState: PetStateId;
  isTalking: boolean;
  speechText?: string;
  showSpeech: boolean;
  isWatchingScreen: boolean;
  isListening: boolean;
  onLeftClick: () => void;
  onRightClick: (point: { x: number; y: number }) => void;
  onPatStart: () => void;
  onPatEnd: () => void;
  /** 自主探索推播 */
  discovery?: Discovery | null;
  isExploring?: boolean;
  onOpenDiscovery?: () => void;
  onDismissDiscovery?: () => void;
}

export const PetStage: React.FC<PetStageProps> = ({
  visualMode,
  customImgUrl,
  petState,
  isTalking,
  speechText,
  showSpeech,
  isWatchingScreen,
  isListening,
  onLeftClick,
  onRightClick,
  onPatStart,
  onPatEnd,
  discovery,
  isExploring = false,
  onOpenDiscovery,
  onDismissDiscovery,
}) => {
  return (
    <div
      className="relative w-full h-full select-none"
      onClick={(e) => {
        if (e.button === 0) onLeftClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault(); // 不要跳出瀏覽器 / 系統的右鍵選單
        const rect = e.currentTarget.getBoundingClientRect();
        onRightClick({ x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.45 });
      }}
    >
      {/* 自主探索推播氣泡（優先於一般對話泡泡） */}
      <AnimatePresence>
        {discovery && onOpenDiscovery && onDismissDiscovery && (
          <DiscoveryBubble key={discovery.id} discovery={discovery} onOpen={onOpenDiscovery} onDismiss={onDismissDiscovery} />
        )}
      </AnimatePresence>

      {/* 頭上的漫畫泡泡（對話框收起時才顯示） */}
      <AnimatePresence>
        {showSpeech && speechText && !discovery && (
          <motion.div
            key="speech"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="absolute bottom-[92%] right-[10%] w-[230px] z-40 pointer-events-none"
          >
            <div className="relative bg-white/95 text-slate-800 text-xs leading-relaxed rounded-2xl px-3 py-2 shadow-xl border-2 border-purple-300 max-h-36 overflow-hidden">
              {speechText}
              <span className="absolute -bottom-2.5 right-10 w-4 h-4 bg-white/95 border-r-2 border-b-2 border-purple-300 rotate-45" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 小狀態徽章 */}
      <div className="absolute top-1 left-1 z-40 flex flex-col gap-1 pointer-events-none">
        {isWatchingScreen && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-950/70 text-emerald-300 border border-emerald-500/40">
            <Eye className="w-3 h-3 animate-pulse" /> 注視中
          </span>
        )}
        {isExploring && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-sky-600/90 text-white animate-pulse">
            <Search className="w-3 h-3" /> 上網逛逛中
          </span>
        )}
        {isListening && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-rose-600/90 text-white animate-pulse">
            <Mic className="w-3 h-3" /> 聽你說
          </span>
        )}
      </div>

      {/* 立繪本體 */}
      <div
        className="absolute inset-0 cursor-pointer"
        title="左鍵：聊天 · 右鍵：選單 · 按住頭：摸頭"
      >
        {visualMode === 'chibi' && (
          <ChibiPet
            state={petState}
            isTalking={isTalking}
            onHeadPressStart={onPatStart}
            onHeadPressEnd={onPatEnd}
            showLabel={false}
          />
        )}

        {visualMode === 'custom' && customImgUrl && (
          <img
            src={customImgUrl}
            alt="自訂雙子星貓形象"
            draggable={false}
            className={`w-full h-full object-contain object-bottom drop-shadow-[0_6px_18px_rgba(76,29,149,0.55)] ${
              isTalking ? 'pet-anim-talk pet-body' : 'pet-anim-float pet-body'
            }`}
          />
        )}

        {visualMode === 'mv_full' && (
          <div className="absolute inset-x-0 bottom-0 aspect-video rounded-2xl overflow-hidden border-2 border-indigo-400/50 shadow-[0_0_30px_rgba(99,102,241,0.45)] pet-anim-float pet-body">
            <img src="/bili_cover.jpg" alt="雙子星貓 舞台" draggable={false} className="w-full h-full object-cover" />
            {isTalking && <div className="absolute inset-0 ring-4 ring-inset ring-amber-300/75 animate-pulse" />}
          </div>
        )}
      </div>
    </div>
  );
};
