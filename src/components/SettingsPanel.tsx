import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Image as ImageIcon, Sliders, Upload, X, Wand2, Sparkles, Compass, Loader2 } from 'lucide-react';
import type { DiscoverySource, ExploreSettings, GeminiModelOption } from '../types';
import type { VisualMode } from '../hooks/useAvatarAppearance';
import type { PetStateId } from './pet/petStates';
import { WorkScheduleEditor } from './WorkScheduleEditor';
import { UsagePanel } from './UsagePanel';
import { WorkshopPanel } from './WorkshopPanel';
import { BusyPanel } from './BusyPanel';
import { voiceService } from '../services/voiceService';

/**
 * 設定面板（半透明懸浮圖層）。
 * 注意：關閉時只是隱藏，不會卸載 —— 螢幕偵測模組要持續運作，關掉面板不能中斷螢幕分享。
 */

export type SettingsTab = 'look' | 'model' | 'screen' | 'persona' | 'explore';
export type PinMode = 'off' | 'normal' | 'game';
type Tab = SettingsTab;

export interface ExploreStatus {
  state: 'idle' | 'exploring' | 'error';
  message?: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  visualMode: VisualMode;
  onVisualModeChange: (mode: VisualMode) => void;
  hasCustomImage: boolean;
  onUploadCustomImage: (file: File) => void;
  onPreviewPetState: (state: PetStateId | null) => void;
  /** 沒碰她就躲起來（只剩呆毛） */
  autoHide: { enabled: boolean; seconds: number; clock?: boolean };
  onAutoHideChange: (v: { enabled: boolean; seconds: number; clock?: boolean }) => void;
  preferredModel: GeminiModelOption;
  onPreferredModelChange: (m: GeminiModelOption) => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  voiceHotkey: string | null;
  /** 置頂模式與叫出她的熱鍵 */
  pinMode: PinMode;
  onPinModeChange: (m: PinMode) => void;
  summonHotkey: string | null;
  screenTracker: React.ReactNode;
  personalityTuner: React.ReactNode;
  exploreSettings: ExploreSettings;
  onExploreSettingsChange: (s: ExploreSettings) => void;
  onExploreNow: () => void;
  exploreStatus: ExploreStatus;
  customPrompt?: string;
  /** 「我們的關係」卡片（放在「主動」分頁最上面） */
  relationship?: React.ReactNode;
}

const IDLE_OPTIONS = [5, 10, 15, 30, 60];
const AUTO_HIDE_OPTIONS = [5, 10, 30, 60];

const SOURCE_OPTIONS: Array<[DiscoverySource, string]> = [
  ['ptt', '💬 PTT'],
  ['bahamut', '🐉 巴哈姆特'],
  ['reddit', '👽 Reddit'],
  ['youtube', '▶ YouTube'],
  ['news', '📰 新聞'],
  ['wiki', 'W 維基百科'],
  ['hn', 'Y Hacker News'],
];

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
  const [speed, setSpeed] = useState<number>(voiceService.getSpeed());
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
    ['model', '模型', <Cpu key="c" className="w-3.5 h-3.5" />],
    ['persona', '個性', <Sliders key="s" className="w-3.5 h-3.5" />],
    ['explore', '主動', <Compass key="e" className="w-3.5 h-3.5" />],
  ];
  const ex = props.exploreSettings;
  const setEx = (patch: Partial<ExploreSettings>) => props.onExploreSettingsChange({ ...ex, ...patch });
  const exploring = props.exploreStatus.state === 'exploring';

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
          <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span>📌 置頂</span>
              <select
                value={props.pinMode}
                onChange={(e) => props.onPinModeChange(e.target.value as PinMode)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs"
              >
                <option value="game">遊戲中也在最上層</option>
                <option value="normal">一般置頂</option>
                <option value="off">不置頂</option>
              </select>
            </div>
            <span className="block text-[10px] text-slate-400 leading-relaxed">
              「遊戲中也在最上層」：遊戲要設成無邊框視窗（Windowed Fullscreen）；獨佔全螢幕的遊戲誰都蓋不過，請用熱鍵叫她。
              {props.summonHotkey ? ` 叫出她：${props.summonHotkey}（再按一次把焦點還給遊戲）` : ''}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">立繪樣式</p>
          <div className="flex gap-1.5">
            {modeButton('chibi', '動態桌寵', <Wand2 className="w-3.5 h-3.5" />)}
            {modeButton('custom', '自訂立繪', <Sparkles className="w-3.5 h-3.5" />, !props.hasCustomImage)}
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

          <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs">
            <span>
              🙈 沒碰她就躲起來
              <span className="block text-[10px] text-slate-400 mt-0.5">只剩呆毛在角落，點呆毛叫她出來；她要說話或推播時會自己跑出來</span>
            </span>
            <input
              type="checkbox"
              checked={props.autoHide.enabled}
              onChange={(e) => props.onAutoHideChange({ ...props.autoHide, enabled: e.target.checked })}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
          </label>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">多久沒碰她就躲</span>
            <select
              value={props.autoHide.seconds}
              onChange={(e) => props.onAutoHideChange({ ...props.autoHide, seconds: Number(e.target.value) })}
              disabled={!props.autoHide.enabled}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs disabled:opacity-50"
            >
              {AUTO_HIDE_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec} 秒
                </option>
              ))}
            </select>
          </div>
          <label className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs ${props.autoHide.enabled ? '' : 'opacity-50'}`}>
            <span>
              🕐 躲起來時舉牌報時間
              <span className="block text-[10px] text-slate-400 mt-0.5">在呆毛旁邊舉著小木牌；滑鼠移上去看日期，整點牌子會晃一下</span>
            </span>
            <input
              type="checkbox"
              checked={props.autoHide.clock !== false}
              onChange={(e) => props.onAutoHideChange({ ...props.autoHide, clock: e.target.checked })}
              disabled={!props.autoHide.enabled}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
          </label>
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
          <UsagePanel />
          <label className="block px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-1">
            <span className="flex justify-between">
              <span>🗣️ 說話速度（GPT-SoVITS 調，不會變調）</span>
              <span className="font-mono text-purple-300">{speed.toFixed(2)}x</span>
            </span>
            <input
              type="range"
              min="0.8"
              max="1.4"
              step="0.05"
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                voiceService.setSpeed(v);
              }}
              className="w-full accent-purple-500"
            />
          </label>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            🎙️ 免持語音輸入：{props.voiceHotkey ? `全域熱鍵 ${props.voiceHotkey}` : '對話框裡的麥克風按鈕'}，說完停一下會自動送出。
          </p>
        </div>

        {/* 螢幕偵測：一直掛載，切換分頁 / 關閉面板都不會中斷螢幕分享 */}
        {/* 螢幕偵測不在分頁列上，只從圓形選單的「螢幕偵測」打開（元件一直掛著，螢幕分享不會中斷） */}
        <div className={tab === 'screen' ? 'space-y-2' : 'hidden'}>
          <p className="text-xs font-semibold">🖥️ 螢幕偵測</p>
          {props.screenTracker}
        </div>

        {/* 個性 */}
        <div className={tab === 'persona' ? '' : 'hidden'}>{props.personalityTuner}</div>

        {/* 主動互動：關係 + 打招呼 + 自主網路探索 */}
        <div className={tab === 'explore' ? 'space-y-3' : 'hidden'}>
          <WorkshopPanel />
          {props.relationship}
          <p className="text-[11px] text-slate-400">陪伴感</p>
          <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs">
            <span>
              👋 回來時打招呼
              <span className="block text-[10px] text-slate-400 mt-0.5">打開桌寵、或離開電腦 10 分鐘以上回來時，會依時間跟你打招呼</span>
            </span>
            <input
              type="checkbox"
              checked={ex.greetOnReturn}
              onChange={(e) => setEx({ greetOnReturn: e.target.checked })}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
          </label>
          <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs">
            <span>
              🌙 深夜提醒早點睡
              <span className="block text-[10px] text-slate-400 mt-0.5">凌晨 1~5 點還在用電腦時，一晚提醒一次</span>
            </span>
            <input
              type="checkbox"
              checked={ex.lateNightReminder}
              onChange={(e) => setEx({ lateNightReminder: e.target.checked })}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
          </label>
          <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs">
            <span>
              🕐 整點報時
              <span className="block text-[10px] text-slate-400 mt-0.5">每到整點跳出來報時，順便說句話；你離開電腦時不會報</span>
            </span>
            <input
              type="checkbox"
              checked={ex.hourlyChime}
              onChange={(e) => setEx({ hourlyChime: e.target.checked })}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
          </label>
          <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs">
            <span>
              🔋 體力系統
              <span className="block text-[10px] text-slate-400 mt-0.5">陪你聊太久、深夜或午飯後，她會累、回得比較短、會抱怨想休息（說很急時還是會幫你）</span>
            </span>
            <select
              value={ex.stamina ?? 'normal'}
              onChange={(e) => setEx({ stamina: e.target.value as 'off' | 'light' | 'normal' })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs shrink-0"
            >
              <option value="normal">正常</option>
              <option value="light">輕微</option>
              <option value="off">關閉</option>
            </select>
          </label>
          <WorkScheduleEditor />
          <BusyPanel />

          <p className="text-[11px] text-slate-400 pt-1">自主網路探索</p>
          <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs">
            <span>
              🧭 閒置時自動上網探索
              <span className="block text-[10px] text-slate-400 mt-0.5">主人一段時間沒點她、沒跟她聊天，貓貓會自己去逛 YouTube / 文章 / 論壇，回來推給你</span>
            </span>
            <input
              type="checkbox"
              checked={ex.enabled}
              onChange={(e) => setEx({ enabled: e.target.checked })}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
          </label>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">多久沒理她就出發</span>
            <select
              value={ex.idleMinutes}
              onChange={(e) => setEx({ idleMinutes: Number(e.target.value) })}
              disabled={!ex.enabled}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs disabled:opacity-50"
            >
              {IDLE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} 分鐘
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">探索興趣（逗號或頓號分隔，留空則只參考個性設定與記憶）</label>
            <textarea
              value={ex.petInterests}
              onChange={(e) => setEx({ petInterests: e.target.value })}
              rows={2}
              placeholder="例如：克蘇魯、硬核科幻、Path of Exile、Podcast"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-purple-400 resize-none"
            />
            {props.customPrompt && (
              <p className="text-[10px] text-slate-500">
                也會參考「個性」分頁的今日特調：{props.customPrompt}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">要逛哪些地方</label>
            <div className="grid grid-cols-2 gap-1">
              {SOURCE_OPTIONS.map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700 text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={ex.sources[key] !== false}
                    onChange={(e) => setEx({ sources: { ...ex.sources, [key]: e.target.checked } })}
                    className="w-3.5 h-3.5 accent-purple-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {ex.sources.ptt !== false && (
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-400">常逛的 PTT 看板（英文板名，逗號分隔）</label>
              <input
                value={ex.pttBoards}
                onChange={(e) => setEx({ pttBoards: e.target.value })}
                placeholder="C_Chat, Steam, PC_Shopping"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-400"
              />
            </div>
          )}
          {ex.sources.bahamut !== false && (
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-400">
                常逛的巴哈哈啦板（名稱 + 看板編號，編號在看板網址的 bsn= 後面）
              </label>
              <textarea
                value={ex.bahamutBoards}
                onChange={(e) => setEx({ bahamutBoards: e.target.value })}
                rows={2}
                placeholder="流亡黯道 18966、原神 36730"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-400 resize-none"
              />
            </div>
          )}
          {ex.sources.reddit !== false && (
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-400">常逛的 subreddit（留空就讓貓貓自己找）</label>
              <input
                value={ex.subreddits}
                onChange={(e) => setEx({ subreddits: e.target.value })}
                placeholder="pathofexile, gaming"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-400"
              />
            </div>
          )}

          <button
            type="button"
            onClick={props.onExploreNow}
            disabled={exploring}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-sky-600 to-purple-600 text-white disabled:opacity-60"
          >
            {exploring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
            {exploring ? '貓貓正在網路上逛…' : '現在就讓貓貓去逛逛'}
          </button>
          {props.exploreStatus.state === 'error' && (
            <p className="text-[11px] text-amber-300">⚠️ 上次探索失敗：{props.exploreStatus.message}</p>
          )}
          <p className="text-[10px] text-slate-500 leading-relaxed">
            論壇會先在看板內搜尋主題，找不到就看推文 / 互動最多的熱門文。同一頁 10 分鐘內只抓一次，被網站擋就休息 15 分鐘。找到的東西會跳在貓貓頭上，也會收進「摸魚手帳」。
          </p>
        </div>
      </div>
    </section>
  );
};
