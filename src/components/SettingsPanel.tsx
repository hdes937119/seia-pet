import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Image as ImageIcon, Monitor, Sliders, Upload, Volume2, VolumeX, X, Wand2, Sparkles, Maximize2 } from 'lucide-react';
import type { GeminiModelOption } from '../types';
import type { VisualMode } from '../hooks/useAvatarAppearance';
import { ALL_PET_STATES, type PetStateId } from './pet/petStates';

/**
 * 設定面板（半透明懸浮圖層）。
 * 注意：關閉時只是隱藏，不會卸載 —— 螢幕偵測模組要持續運作，關掉面板不能中斷螢幕分享。
 */

type Tab = 'look' | 'model' | 'screen' | 'persona';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  visualMode: VisualMode;
  onVisualModeChange: (mode: VisualMode) => void;
  hasCustomImage: boolean;
  onUploadCustomImage: (file: File) => void;
  onPreviewPetState: (state: PetStateId | null) => void;
  preferredModel: GeminiModelOption;
  onPreferredModelChange: (m: GeminiModelOption) => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  voiceHotkey: string | null;
  screenTracker: React.ReactNode;
  personalityTuner: React.ReactNode;
}

const MODEL_OPTIONS: Array<[GeminiModelOption, string]> = [
  ['gemini-3.1-pro-preview', '✨ Gemini 3.1 Pro（主力高階）'],
  ['gemini-3.8-flash', '⚡ Gemini 3.8 Flash（最新多模態）'],
  ['gemini-4-argon', '🔥 Gemini 4 Pro / Argon'],
  ['auto', '🚀 自動智慧輪替（防限流）'],
  ['gemini-3-flash-preview', '💨 Gemini 3.0 Flash'],
  ['gemini-3.5-flash', '🌟 Gemini 3.5 Flash'],
  ['gemini-3.1-flash-lite', '🍃 Gemini 3.1 Flash Lite'],
];

export const SettingsPanel: React.FC<SettingsPanelProps> = (props) => {
  const { open, onClose, initialTab } = props;
  const [tab, setTab] = useState<Tab>(initialTab ?? 'look');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const tabs: Array<[Tab, string, React.ReactNode]> = [
    ['look', '外觀', <ImageIcon key="i" className="w-3.5 h-3.5" />],
    ['model', '模型/語音', <Cpu key="c" className="w-3.5 h-3.5" />],
    ['screen', '螢幕偵測', <Monitor key="m" className="w-3.5 h-3.5" />],
    ['persona', '個性', <Sliders key="s" className="w-3.5 h-3.5" />],
  ];

  const modeButton = (mode: VisualMode, label: string, icon: React.ReactNode, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => props.onVisualModeChange(mode)}
      className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-xs font-medium border transition-all disabled:opacity-40 ${
        props.visualMode === mode
          ? 'bg-gradient-to-r from-purple-600 to-pink-600 border-pink-300/60 text-white'
          : 'bg-slate-900/70 border-slate-700 text-slate-300 hover:border-purple-400/60'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <section
      aria-hidden={!open}
      className={`absolute z-50 right-2 bottom-[calc(var(--pet-h)+14px)] w-[min(440px,calc(100%-16px))] h-[min(560px,calc(100%-var(--pet-h)-24px))] flex flex-col rounded-2xl border border-purple-400/30 bg-slate-950/80 backdrop-blur-xl shadow-2xl shadow-purple-950/50 text-slate-100 overflow-hidden transition-all duration-200 ${
        open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none invisible'
      }`}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-slate-900/60 shrink-0">
        <span className="text-sm font-semibold">⚙️ 設定</span>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" title="關閉（Esc）">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="flex gap-1 px-2 pt-2 shrink-0">
        {tabs.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[11px] font-medium ${
              tab === id ? 'bg-purple-600/80 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {/* 外觀 */}
        <div className={tab === 'look' ? 'space-y-3' : 'hidden'}>
          <p className="text-[11px] text-slate-400">立繪樣式</p>
          <div className="flex gap-1.5">
            {modeButton('chibi', '動態桌寵', <Wand2 className="w-3.5 h-3.5" />)}
            {modeButton('custom', '自訂立繪', <Sparkles className="w-3.5 h-3.5" />, !props.hasCustomImage)}
            {modeButton('mv_full', '原片全景', <Maximize2 className="w-3.5 h-3.5" />)}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onUploadCustomImage(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-slate-900/70 border border-dashed border-purple-400/50 text-purple-200 hover:bg-purple-900/40"
          >
            <Upload className="w-3.5 h-3.5" /> 上傳自訂立繪（自動去除網格背景）
          </button>

          <p className="text-[11px] text-slate-400 pt-1">預覽動態桌寵動作</p>
          <div className="grid grid-cols-4 gap-1.5">
            {ALL_PET_STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  props.onVisualModeChange('chibi');
                  props.onPreviewPetState(s.id);
                }}
                className="px-1 py-1.5 rounded-lg text-[11px] bg-slate-900/70 border border-slate-700 hover:border-pink-400/60 hover:bg-purple-900/40"
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 模型 / 語音 */}
        <div className={tab === 'model' ? 'space-y-3' : 'hidden'}>
          <label className="block text-[11px] text-slate-400">優先使用的 Gemini 模型（限流時會自動輪替）</label>
          <select
            value={props.preferredModel}
            onChange={(e) => props.onPreferredModelChange(e.target.value as GeminiModelOption)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-purple-400"
          >
            {MODEL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={props.onToggleVoice}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs border ${
              props.voiceEnabled
                ? 'bg-purple-900/50 border-purple-400/50 text-purple-100'
                : 'bg-slate-900/70 border-slate-700 text-slate-400'
            }`}
          >
            {props.voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            {props.voiceEnabled ? '語音朗讀：開啟' : '語音朗讀：靜音'}
          </button>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            🎙️ 免持語音輸入：{props.voiceHotkey ? `全域熱鍵 ${props.voiceHotkey}` : '對話框裡的麥克風按鈕'}，說完停一下會自動送出。
          </p>
        </div>

        {/* 螢幕偵測：一直掛載，切換分頁 / 關閉面板都不會中斷螢幕分享 */}
        <div className={tab === 'screen' ? '' : 'hidden'}>{props.screenTracker}</div>

        {/* 個性 */}
        <div className={tab === 'persona' ? '' : 'hidden'}>{props.personalityTuner}</div>
      </div>
    </section>
  );
};
