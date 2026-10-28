import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  MessageCircle,
  Volume2,
  VolumeX,
  Eye,
  Wand2,
  Maximize2,
  Minimize2,
  Upload,
} from 'lucide-react';
import { removeFakeTransparency } from '../utils/removeFakeTransparency';
import { loadCustomAvatar, saveCustomAvatar } from '../services/avatarStore';
import { ChibiPet } from './pet/ChibiPet';
import { ALL_PET_STATES, type PetStateId } from './pet/petStates';

const VISUAL_MODE_KEY = 'gemini_twin_cat_visual_mode';

interface TwinCatAvatarProps {
  isTalking: boolean;
  speechText?: string;
  isWatchingScreen: boolean;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onOpenChat: () => void;
  onPetHead?: () => void;
  /** 動態桌寵目前狀態（由 App 的 usePetState 決定） */
  petState?: PetStateId;
  onPatStart?: () => void;
  onPatEnd?: () => void;
  onPreviewPetState?: (state: PetStateId | null) => void;
}

type VisualMode = 'mv_full' | 'chibi' | 'custom';
const VISUAL_MODES: VisualMode[] = ['mv_full', 'chibi', 'custom'];

export const TwinCatAvatar: React.FC<TwinCatAvatarProps> = ({
  isTalking,
  speechText,
  isWatchingScreen,
  voiceEnabled,
  onToggleVoice,
  onOpenChat,
  onPetHead,
  petState = 'idle',
  onPatStart,
  onPatEnd,
  onPreviewPetState,
}) => {
  // 記住上次選的立繪模式，重開後維持一樣；預設（或舊的「原片立繪」）優先顯示自訂立繪
  const [visualMode, setVisualMode] = useState<VisualMode>(() => {
    try {
      const saved = localStorage.getItem(VISUAL_MODE_KEY);
      if (saved === 'live_rig') return 'chibi'; // 舊的「動態骨骼」已由動態桌寵取代
      return saved && (VISUAL_MODES as string[]).includes(saved) ? (saved as VisualMode) : 'custom';
    } catch {
      return 'custom';
    }
  });
  const [isPatting, setIsPatting] = useState(false);
  const [customImgUrl, setCustomImgUrl] = useState<string | null>(null);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [patParticles, setPatParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 啟動時從後端（data/custom-avatar.*）載入自訂立繪
  useEffect(() => {
    let cancelled = false;
    loadCustomAvatar().then((url) => {
      if (cancelled) return;
      setCustomImgUrl(url);
      setAvatarLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 記住目前模式；若選了「自訂」但還沒有自訂圖，退回原片全景
  useEffect(() => {
    if (!avatarLoaded) return;
    if (visualMode === 'custom' && !customImgUrl) {
      setVisualMode('mv_full');
      return;
    }
    try {
      localStorage.setItem(VISUAL_MODE_KEY, visualMode);
    } catch {
      // ignore
    }
  }, [visualMode, customImgUrl, avatarLoaded]);

  const handlePet = (e: React.MouseEvent) => {
    setIsPatting(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const newId = Date.now();
    setPatParticles((prev) => [...prev, { id: newId, x: px, y: py }]);
    setTimeout(() => {
      setPatParticles((prev) => prev.filter((p) => p.id !== newId));
    }, 1000);

    if (onPetHead) onPetHead();
    setTimeout(() => setIsPatting(false), 750);
  };

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let result = reader.result as string;
      // GIF 動圖保持原樣（畫到 canvas 會失去動畫）；其他圖片自動去除假透明的棋盤格背景
      if (file.type !== 'image/gif') {
        try {
          result = (await removeFakeTransparency(result)).dataUrl;
        } catch (err) {
          console.warn('立繪背景處理失敗，改用原圖:', err);
        }
      }
      setCustomImgUrl(result);
      setVisualMode('custom');
      const savedUrl = await saveCustomAvatar(result);
      if (savedUrl) setCustomImgUrl(savedUrl);
      else console.warn('自訂立繪未能永久儲存，下次開啟可能需要重新上傳');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // 允許重新選同一張圖
  };

  return (
    <div ref={containerRef} className="relative select-none flex flex-col items-center w-full">
      {/* Hidden File Input for Custom Image/GIF */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleCustomUpload}
        className="hidden"
      />

      {/* Mode Selector Bar */}
      <div className="w-full flex items-center justify-between gap-1.5 mb-3 px-1">
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setVisualMode('mv_full')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              visualMode === 'mv_full'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="原片全景星穹舞台"
          >
            <Maximize2 className="w-3 h-3" />
            <span>原片全景</span>
          </button>

          <button
            type="button"
            onClick={() => setVisualMode('chibi')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              visualMode === 'chibi'
                ? 'bg-gradient-to-r from-pink-600 to-amber-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Q 版雙子星貓：會依視窗偵測與情緒自動切換動作"
          >
            <Wand2 className="w-3 h-3" />
            <span>動態桌寵</span>
          </button>

          {customImgUrl && (
            <button
              type="button"
              onClick={() => setVisualMode('custom')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                visualMode === 'custom'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="切回你上傳的自訂立繪"
            >
              <Sparkles className="w-3 h-3" />
              <span>自訂</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-purple-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors"
          title="上傳自訂動圖或截圖"
        >
          <Upload className="w-3 h-3" />
          <span>自訂圖</span>
        </button>
      </div>

      {/* Floating Speech Bubble Above Avatar */}
      <AnimatePresence>
        {speechText && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="w-full mb-3 z-30 bg-slate-900/95 border border-pink-500/40 shadow-xl shadow-purple-950/60 backdrop-blur-md rounded-2xl p-3 text-xs sm:text-sm text-slate-100 font-medium relative"
          >
            <div className="flex items-start gap-2">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-amber-300 font-bold shrink-0">
                ✦ 雙子星貓:
              </span>
              <p className="leading-relaxed text-slate-100">{speechText}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Interactive Stage */}
      <motion.div
        animate={{
          y: isPatting ? [0, -8, 3, 0] : [0, -5, 0],
          scale: isTalking ? [1, 1.02, 1] : 1,
        }}
        transition={{
          y: {
            repeat: isPatting ? 0 : Infinity,
            duration: isPatting ? 0.6 : 3.6,
            ease: 'easeInOut',
          },
          scale: {
            repeat: isTalking ? Infinity : 0,
            duration: 0.35,
          },
        }}
        className="relative group cursor-pointer w-full flex flex-col items-center"
        onClick={handlePet}
        title="點擊摸摸星穹領航員雙子星貓的頭～"
      >
        {/* Patting Floating Paw & Star Particles */}
        <AnimatePresence>
          {patParticles.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 1, y: p.y - 10, x: p.x - 10, scale: 0.6 }}
              animate={{ opacity: 0, y: p.y - 75, scale: 1.35 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.85, ease: 'easeOut' }}
              className="absolute z-40 pointer-events-none text-sm font-bold text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]"
              style={{ left: 0, top: 0 }}
            >
              ✦ 喵~ 🐾
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Status Indicator Pill */}
        <div className="absolute top-2.5 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-950/85 border border-amber-400/40 text-amber-200 backdrop-blur-md pointer-events-none shadow-lg">
          {isWatchingScreen ? (
            <>
              <Eye className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>星穹領航注視中</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>星穹領航員 · 雙子星貓</span>
            </>
          )}
        </div>

        {/* === ORIGINAL MV FULL 16:9 STAGE VIEW === */}
        {visualMode === 'mv_full' && (
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden border-2 border-indigo-500/40 shadow-[0_0_35px_rgba(99,102,241,0.3)] bg-[#141852]">
            <img
              src="/bili_cover.jpg"
              alt="雙子星貓 出道曲完整舞台"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            {isTalking && (
              <div className="absolute inset-0 ring-4 ring-inset ring-amber-300/75 animate-pulse pointer-events-none" />
            )}
          </div>
        )}

        {/* === MODE 3: CUSTOM UPLOADED IMAGE / GIF === */}
        {visualMode === 'custom' && customImgUrl && (
          <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border-2 border-purple-500/40 shadow-xl bg-slate-950">
            <img
              src={customImgUrl}
              alt="自訂雙子星貓形象"
              className="w-full h-full object-contain"
            />
          </div>
        )}

        {/* === 動態桌寵：Q 版雙子星貓，依運作模式 / 情緒自動切換動作 === */}
        {visualMode === 'chibi' && (
          <div className="relative w-full h-72 sm:h-80 rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-b from-[#131854] via-[#1d2268] to-[#261d5c] shadow-[0_0_35px_rgba(99,102,241,0.3)] overflow-hidden">
            <div className="absolute inset-0 pt-6 pb-1">
              <ChibiPet
                state={petState}
                isTalking={isTalking}
                onHeadPressStart={onPatStart}
                onHeadPressEnd={onPatEnd}
              />
            </div>

            {/* 預覽各種動作（測試用） */}
            {onPreviewPetState && (
              <select
                value=""
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onPreviewPetState((e.target.value || null) as PetStateId | null)}
                className="absolute z-50 top-2.5 right-3 bg-slate-950/85 border border-purple-400/40 rounded-lg px-1.5 py-1 text-[10px] text-purple-100 focus:outline-none"
                title="預覽桌寵的各種動作"
              >
                <option value="">🎬 預覽動作</option>
                <optgroup label="運作模式">
                  {ALL_PET_STATES.filter((s) => s.kind === 'mode').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.emoji} {s.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="情緒回應">
                  {ALL_PET_STATES.filter((s) => s.kind === 'emotion').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.emoji} {s.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </div>
        )}

        {/* Bottom Floating Quick Actions */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChat();
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white shadow-lg shadow-purple-950/50 transition-all hover:scale-105"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>與雙子星貓聊天</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVoice();
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 border ${
              voiceEnabled
                ? 'bg-slate-800/90 hover:bg-slate-700 text-amber-300 border-amber-500/30'
                : 'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border-rose-700/40'
            }`}
            title={voiceEnabled ? '語音朗讀開啟' : '目前靜音'}
          >
            {voiceEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                <span>語音開啟</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                <span>已靜音</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
