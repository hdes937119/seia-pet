import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, Mic, Search } from 'lucide-react';
import { ChibiPet } from './pet/ChibiPet';
import { HeadPatZone } from './pet/HeadPatZone';
import { PetParticles } from './pet/PetEffects';
import { PET_STATES } from './pet/petStates';
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
  /** 她在忙（洗澡、出門…）：不顯示立繪，改顯示「不在」的小卡和倒數 */
  away?: { emoji: string; label: string; endAt: number; awayNote: string } | null;
  onCallBack?: () => void;
}

/** 「她不在」的小卡：倒數計時 */
const AwayCard: React.FC<{ away: NonNullable<PetStageProps['away']>; onCallBack?: () => void }> = ({ away, onCallBack }) => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((away.endAt - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="absolute inset-x-[8%] bottom-[12%] z-30 flex flex-col items-center gap-1.5 px-3 py-3 rounded-2xl bg-slate-950/80 border border-purple-400/40 shadow-xl text-slate-100 backdrop-blur-md">
      <span className="text-4xl leading-none pet-anim-float">{away.emoji}</span>
      <span className="text-xs font-semibold">西雅正在{away.label}</span>
      <span className="font-mono text-lg text-purple-200 tabular-nums">{left > 0 ? `${mm}:${ss}` : '快回來了…'}</span>
      <span className="text-[10px] text-slate-400 text-center leading-snug">{away.awayNote}</span>
      {onCallBack && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCallBack();
          }}
          className="mt-0.5 px-2 py-0.5 rounded-lg text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300"
        >
          叫她回來
        </button>
      )}
    </div>
  );
};

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
  away,
  onCallBack,
}) => {
  const isPatting = petState === 'patting';
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
        {away && <AwayCard away={away} onCallBack={onCallBack} />}

        {!away && visualMode === 'chibi' && (
          <ChibiPet
            state={petState}
            isTalking={isTalking}
            onHeadPressStart={onPatStart}
            onHeadPressEnd={onPatEnd}
            showLabel={false}
          />
        )}

        {!away && visualMode === 'custom' && customImgUrl && (
          <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
            <img
              src={customImgUrl}
              alt="自訂雙子星貓形象"
              draggable={false}
              className={`w-full h-full object-contain object-bottom drop-shadow-[0_6px_18px_rgba(76,29,149,0.55)] pet-body ${
                isPatting ? 'pet-anim-squish' : isTalking ? 'pet-anim-talk' : 'pet-anim-float'
              }`}
            />
            {isPatting && <PetParticles specs={PET_STATES.patting.particles} stateKey="patting-custom" />}
            <HeadPatZone onStart={onPatStart} onEnd={onPatEnd} className="left-[20%] top-0 w-[60%] h-[40%]" />
          </div>
        )}

      </div>
    </div>
  );
};
