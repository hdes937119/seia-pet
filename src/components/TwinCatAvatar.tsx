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

const VISUAL_MODE_KEY = 'gemini_twin_cat_visual_mode';

interface TwinCatAvatarProps {
  isTalking: boolean;
  speechText?: string;
  isWatchingScreen: boolean;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onOpenChat: () => void;
  onPetHead?: () => void;
}

type VisualMode = 'mv_full' | 'live_rig' | 'custom';
const VISUAL_MODES: VisualMode[] = ['mv_full', 'live_rig', 'custom'];

export const TwinCatAvatar: React.FC<TwinCatAvatarProps> = ({
  isTalking,
  speechText,
  isWatchingScreen,
  voiceEnabled,
  onToggleVoice,
  onOpenChat,
  onPetHead,
}) => {
  // 記住上次選的立繪模式，重開後維持一樣；預設（或舊的「原片立繪」）優先顯示自訂立繪
  const [visualMode, setVisualMode] = useState<VisualMode>(() => {
    try {
      const saved = localStorage.getItem(VISUAL_MODE_KEY) as VisualMode | null;
      return saved && VISUAL_MODES.includes(saved) ? saved : 'custom';
    } catch {
      return 'custom';
    }
  });
  const [isBlinking, setIsBlinking] = useState(false);
  const [isPatting, setIsPatting] = useState(false);
  const [mouthPhase, setMouthPhase] = useState(0);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
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

  // Periodic natural eye blinking
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 150);
    }, 3400);
    return () => clearInterval(blinkInterval);
  }, []);

  // Mouth animation when speaking
  useEffect(() => {
    if (!isTalking) {
      setMouthPhase(0);
      return;
    }
    const mouthInterval = setInterval(() => {
      setMouthPhase((prev) => (prev + 1) % 3);
    }, 130);
    return () => clearInterval(mouthInterval);
  }, [isTalking]);

  // Mouse cursor tracking for Live Rig eyes
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = Math.max(-4, Math.min(4, (e.clientX - centerX) / 45));
      const dy = Math.max(-3, Math.min(3, (e.clientY - centerY) / 45));
      setEyeOffset({ x: dx, y: dy });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

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
            onClick={() => setVisualMode('live_rig')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              visualMode === 'live_rig'
                ? 'bg-gradient-to-r from-pink-600 to-amber-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="1:1 還原粉金異色瞳與星穹服動態骨骼"
          >
            <Wand2 className="w-3 h-3" />
            <span>動態骨骼</span>
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

        {/* === MODE 4: 1:1 VIDEO-ACCURATE INTERACTIVE ANIME RIG ===
             Matches BV1qCnJ6TEJB:
             - Periwinkle-blue hair + top ahoge + dual side buns + rainbow (cyan/yellow/pink) hair tips
             - Blue cat ears with pink interior & white fluffy ear tufts
             - Large Golden 4-pointed star hairpin on viewer's right temple
             - Pink (viewer's left) & Gold (viewer's right) heterochromia eyes with cursor tracking
             - White & navy halter crop top with 4-point star chest gem + wide flared sleeves + ruffled mini skirt
             - Giant fluffy cyan-yellow-pink tail + glowing lavender cat-paw energy beam! */}
        {visualMode === 'live_rig' && (
          <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border-2 border-indigo-500/40 bg-gradient-to-b from-[#131854] via-[#1d2268] to-[#261d5c] flex items-center justify-center shadow-[0_0_35px_rgba(99,102,241,0.3)]">
            <svg viewBox="0 0 360 320" className="w-full h-full">
              <defs>
                {/* Cosmic Starfield Glow */}
                <radialGradient id="pawBeamGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
                  <stop offset="55%" stopColor="#E9D5FF" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#A855F7" stopOpacity="0" />
                </radialGradient>

                {/* Rainbow Pastel Hair & Tail Gradient (Indigo -> Cyan -> Yellow -> Pink) */}
                <linearGradient id="rainbowTailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366F1" />
                  <stop offset="35%" stopColor="#38BDF8" />
                  <stop offset="70%" stopColor="#FDE047" />
                  <stop offset="100%" stopColor="#F472B6" />
                </linearGradient>

                {/* Main Periwinkle-Blue Hair Gradient */}
                <linearGradient id="crownHairGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#5B6AF0" />
                  <stop offset="65%" stopColor="#7C83F7" />
                  <stop offset="100%" stopColor="#C084FC" />
                </linearGradient>

                {/* Golden 4-Pointed Star Gradient */}
                <linearGradient id="goldStarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#FEF08A" />
                  <stop offset="50%" stopColor="#FACC15" />
                  <stop offset="100%" stopColor="#EA580C" />
                </linearGradient>

                {/* Left Eye: Vibrant Magenta-Pink */}
                <linearGradient id="pinkEyeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#831843" />
                  <stop offset="45%" stopColor="#EC4899" />
                  <stop offset="100%" stopColor="#FBCFE8" />
                </linearGradient>

                {/* Right Eye: Bright Golden-Amber */}
                <linearGradient id="goldEyeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#92400E" />
                  <stop offset="45%" stopColor="#F59E0B" />
                  <stop offset="100%" stopColor="#FEF08A" />
                </linearGradient>
              </defs>

              {/* Cosmic Background Vortex Rings */}
              <ellipse
                cx="310"
                cy="70"
                rx="65"
                ry="28"
                fill="none"
                stroke="#6366F1"
                strokeWidth="2"
                opacity="0.3"
                transform="rotate(-20 310 70)"
              />
              <ellipse
                cx="180"
                cy="295"
                rx="150"
                ry="22"
                fill="none"
                stroke="#60A5FA"
                strokeWidth="3"
                opacity="0.45"
              />

              {/* Giant Fluffy Rainbow Tail (Blue -> Cyan -> Yellow -> Pink) */}
              <motion.g
                animate={{ rotate: [-3, 4, -3] }}
                transition={{ repeat: Infinity, duration: 3.2, ease: 'easeInOut' }}
                style={{ transformOrigin: '220px 235px' }}
              >
                <path
                  d="M 215 230 C 265 210 335 235 340 285 C 320 305 275 305 230 270 Z"
                  fill="url(#rainbowTailGrad)"
                />
              </motion.g>

              {/* Long Flowing Rainbow Hair Back Layers */}
              <motion.g
                animate={{ rotate: [-1.5, 2, -1.5] }}
                transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                style={{ transformOrigin: '195px 110px' }}
              >
                {/* Pink-Violet Outer Strands */}
                <path
                  d="M 135 110 C 100 165 110 230 140 265 C 185 255 255 265 320 220 C 300 170 260 135 235 110 Z"
                  fill="url(#rainbowTailGrad)"
                  opacity="0.92"
                />
                {/* Periwinkle Upper Flowing Strands */}
                <path
                  d="M 145 95 C 125 145 135 195 160 225 C 200 220 245 210 285 180 C 260 145 240 115 225 95 Z"
                  fill="url(#crownHairGrad)"
                />
              </motion.g>

              {/* Glowing Cat-Paw Crescent Energy Slash (Left Side) */}
              <path
                d="M 125 40 C 35 70 25 195 130 255 C 65 195 75 95 135 55 Z"
                fill="url(#pawBeamGlow)"
              />

              {/* Floating Golden 4-Pointed Stars */}
              <g fill="url(#goldStarGrad)">
                <polygon points="55,65 59,75 69,79 59,83 55,93 51,83 41,79 51,75" />
                <polygon points="48,145 51,153 59,156 51,159 48,167 45,159 37,156 45,153" />
                <polygon points="75,205 78,213 86,216 78,219 75,227 72,219 64,216 72,213" />
                <polygon points="295,38 297,46 305,48 297,50 295,58 293,50 285,48 293,46" fill="#E0E7FF" />
              </g>

              {/* === OUTFIT: Star Dome Navigator White & Navy Crop Top + Ruffled Skirt + Wide Sleeves === */}
              {/* Left Flowing Wide Sleeve (Reaching out with Cat Paw Beam) */}
              <path
                d="M 162 156 L 112 125 L 95 182 L 152 195 Z"
                fill="#FFFFFF"
                stroke="#4F46E5"
                strokeWidth="2"
              />
              <path d="M 112 125 L 95 182 L 118 188 L 128 138 Z" fill="#312E81" />

              {/* Right Flowing Wide Sleeve */}
              <path
                d="M 222 162 L 275 185 L 258 232 L 212 200 Z"
                fill="#FFFFFF"
                stroke="#4F46E5"
                strokeWidth="2"
              />
              <path d="M 262 180 L 275 185 L 258 232 L 245 222 Z" fill="#4338CA" />

              {/* Torso & Bare Midriff */}
              <path d="M 172 152 L 212 152 L 208 212 L 175 212 Z" fill="#FFE4E6" />

              {/* White & Navy Halter Crop Top */}
              <path
                d="M 182 142 L 202 142 L 216 168 C 202 194 182 194 168 168 Z"
                fill="#FFFFFF"
                stroke="#312E81"
                strokeWidth="2.5"
              />
              {/* Navy Collar & Halter Neckline */}
              <path d="M 180 140 L 204 140 L 198 154 L 186 154 Z" fill="#1E1B4B" />
              {/* Four-Pointed Star Chest Emblem */}
              <polygon
                points="192,160 195,168 203,171 195,174 192,182 189,174 181,171 189,168"
                fill="#38BDF8"
                stroke="#FACC15"
                strokeWidth="1.2"
              />

              {/* White Ruffled Mini Skirt with Blue-Gold Ribbons */}
              <path
                d="M 168 208 L 216 208 L 238 252 C 208 262 174 262 146 252 Z"
                fill="#FFFFFF"
                stroke="#4338CA"
                strokeWidth="2"
              />
              <path
                d="M 168 208 L 216 208 L 222 222 L 162 222 Z"
                fill="#312E81"
              />
              {/* Skirt Waist Golden Star */}
              <polygon
                points="214,210 217,217 224,220 217,223 214,230 211,223 204,220 211,217"
                fill="url(#goldStarGrad)"
              />

              {/* Legs & Thigh Garter Star */}
              <path d="M 172 252 L 188 252 L 195 310 L 178 310 Z" fill="#FFE4E6" />
              <path d="M 198 252 L 214 252 L 226 310 L 208 310 Z" fill="#FFE4E6" />
              {/* Right Thigh Navy Garter Strap with Star */}
              <rect x="173" y="266" width="17" height="4" rx="2" fill="#1E1B4B" />
              <polygon
                points="182,268 184,273 189,275 184,277 182,282 180,277 175,275 180,273"
                fill="#38BDF8"
              />

              {/* Glowing Lavender-White Cat Paw Beam in Left Hand */}
              <motion.g
                animate={{ scale: isTalking ? [1, 1.12, 1] : [0.96, 1.04, 0.96] }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                style={{ transformOrigin: '96px 115px' }}
              >
                <circle cx="96" cy="115" r="28" fill="url(#pawBeamGlow)" />
                {/* Cute Lavender Cat Paw Pads */}
                <ellipse cx="98" cy="120" rx="11" ry="9" fill="#C084FC" opacity="0.85" />
                <circle cx="83" cy="108" r="4.2" fill="#C084FC" opacity="0.85" />
                <circle cx="91" cy="101" r="4.5" fill="#C084FC" opacity="0.85" />
                <circle cx="102" cy="101" r="4.5" fill="#C084FC" opacity="0.85" />
                <circle cx="110" cy="108" r="4.2" fill="#C084FC" opacity="0.85" />
              </motion.g>

              {/* === HEAD, BUNS, CAT EARS, HETEROCROMIA EYES & GOLDEN 4-POINT STAR HAIRPIN === */}
              {/* Dual Braided Side Buns (丸子頭) */}
              <circle cx="146" cy="78" r="16" fill="#5B6AF0" stroke="#312E81" strokeWidth="1.5" />
              <circle cx="238" cy="82" r="16" fill="#5B6AF0" stroke="#312E81" strokeWidth="1.5" />

              {/* Left Cat Ear (Periwinkle outer, Peach-pink inner, White fluffy ear tuft) */}
              <motion.g
                animate={{ rotate: isTalking ? [-4, 3, -4] : [0, 2.5, 0] }}
                transition={{ repeat: Infinity, duration: 2.2 }}
                style={{ transformOrigin: '160px 60px' }}
              >
                <path d="M 146 66 L 142 22 L 178 46 Z" fill="#5B6AF0" stroke="#312E81" strokeWidth="1.8" />
                <path d="M 150 62 L 146 30 L 172 48 Z" fill="#FDA4AF" />
                {/* White Inner Ear Fluff */}
                <path d="M 148 62 Q 155 46 168 52 Q 160 62 148 62 Z" fill="#FFFFFF" />
              </motion.g>

              {/* Right Cat Ear */}
              <motion.g
                animate={{ rotate: isTalking ? [4, -3, 4] : [0, -2.5, 0] }}
                transition={{ repeat: Infinity, duration: 2.4 }}
                style={{ transformOrigin: '224px 62px' }}
              >
                <path d="M 210 48 L 244 26 L 238 70 Z" fill="#5B6AF0" stroke="#312E81" strokeWidth="1.8" />
                <path d="M 215 50 L 239 34 L 234 65 Z" fill="#FDA4AF" />
                {/* White Inner Ear Fluff */}
                <path d="M 216 52 Q 228 48 234 64 Q 222 62 216 52 Z" fill="#FFFFFF" />
              </motion.g>

              {/* Face Base Contour */}
              <path
                d="M 152 82 C 150 118 166 142 192 144 C 218 142 234 118 232 82 C 230 56 154 56 152 82 Z"
                fill="#FFF1F2"
                stroke="#F43F5E"
                strokeWidth="0.8"
              />

              {/* *** HETEROCROMIA EYES (粉金異色瞳) *** */}
              {/* Viewer's Left Eye: Vibrant Magenta-Pink (#EC4899) */}
              {isBlinking ? (
                <path
                  d="M 163 102 Q 173 107 183 102"
                  stroke="#4C1D95"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : (
                <g transform={`translate(${eyeOffset.x}, ${eyeOffset.y})`}>
                  <ellipse cx="173" cy="102" rx="9.5" ry="11.5" fill="url(#pinkEyeGrad)" />
                  {/* Upper Eyelash */}
                  <path
                    d="M 162 96 Q 173 89 184 97"
                    stroke="#311042"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  {/* Dark Pupil & Starlight Highlights */}
                  <circle cx="173" cy="103" r="4" fill="#500724" />
                  <circle cx="169" cy="97" r="3" fill="#FFFFFF" />
                  <circle cx="177" cy="107" r="1.6" fill="#FDE047" />
                </g>
              )}

              {/* Viewer's Right Eye: Bright Golden-Amber (#F59E0B / #FACC15) */}
              {isBlinking ? (
                <path
                  d="M 201 104 Q 211 109 221 104"
                  stroke="#4C1D95"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : (
                <g transform={`translate(${eyeOffset.x}, ${eyeOffset.y})`}>
                  <ellipse cx="211" cy="104" rx="9.5" ry="11.5" fill="url(#goldEyeGrad)" />
                  {/* Upper Eyelash */}
                  <path
                    d="M 200 98 Q 211 91 222 99"
                    stroke="#311042"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  {/* Dark Amber Pupil & Starlight Highlights */}
                  <circle cx="211" cy="105" r="4" fill="#78350F" />
                  <circle cx="207" cy="99" r="3" fill="#FFFFFF" />
                  <circle cx="215" cy="109" r="1.6" fill="#FFFFFF" />
                </g>
              )}

              {/* Rosy Cheeks */}
              <ellipse cx="162" cy="116" rx="5.5" ry="3" fill="#FB7185" opacity="0.55" />
              <ellipse cx="222" cy="117" rx="5.5" ry="3" fill="#FB7185" opacity="0.55" />

              {/* Tiny Anime Nose */}
              <circle cx="192" cy="113" r="1.3" fill="#F43F5E" />

              {/* Expressive Cat Mouth with Cute Little Fang */}
              {isTalking ? (
                mouthPhase === 0 ? (
                  <g>
                    <path
                      d="M 185 121 Q 192 132 199 121 Z"
                      fill="#FB7185"
                      stroke="#881337"
                      strokeWidth="1.5"
                    />
                    {/* Tiny White Cat Fang */}
                    <polygon points="187,121 189,125 191,121" fill="#FFFFFF" />
                  </g>
                ) : mouthPhase === 1 ? (
                  <ellipse
                    cx="192"
                    cy="124"
                    rx="5"
                    ry="4"
                    fill="#F43F5E"
                    stroke="#881337"
                    strokeWidth="1.4"
                  />
                ) : (
                  <path
                    d="M 185 121 Q 188.5 125 192 122 Q 195.5 125 199 121"
                    stroke="#881337"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                )
              ) : (
                <g>
                  <path
                    d="M 185 120 Q 192 130 199 120 Z"
                    fill="#FDA4AF"
                    stroke="#881337"
                    strokeWidth="1.5"
                  />
                  {/* Cute Anime Fang */}
                  <polygon points="195,120 196.5,124 198,120" fill="#FFFFFF" />
                </g>
              )}

              {/* Periwinkle-Violet Front Hair Bangs & Curved Ahoge (呆毛) */}
              <path
                d="M 192 38 Q 196 18 214 22 Q 200 28 198 42 Z"
                fill="#6366F1"
              />
              <path
                d="M 148 84 C 152 46 232 46 236 86 C 226 68 216 74 210 92 C 202 72 195 76 190 95 C 184 75 176 72 170 90 C 162 72 154 70 148 84 Z"
                fill="url(#crownHairGrad)"
              />

              {/* Iconic Large Golden 4-Pointed Star Hairpin (金色四芒星髮飾 on Her Left Temple) */}
              <polygon
                points="230,62 235,76 249,81 235,86 230,100 225,86 211,81 225,76"
                fill="url(#goldStarGrad)"
                stroke="#78350F"
                strokeWidth="1.2"
              />
            </svg>
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
