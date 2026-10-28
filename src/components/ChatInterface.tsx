import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Smile, Volume2, VolumeX, Trash2, ArrowLeftRight, CheckCheck, Square, Mic, Loader2, X } from 'lucide-react';
import { ChatMessage, ChatStyle, PersonalityConfig, MemoryKeyword, ScreenActivity } from '../types';
import type { VoiceInputState } from '../hooks/useVoiceInput';

// 把訊息裡的網址變成可點的連結（Electron 裡會由 main.js 交給預設瀏覽器開啟）
const URL_RE = /(https?:\/\/[^\s]+)/g;
function renderWithLinks(text: string): React.ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted text-sky-300 hover:text-sky-200 break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {part.length > 48 ? part.slice(0, 45) + '…' : part}
      </a>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onInterrupt?: () => void;
  chatStyle: ChatStyle;
  onToggleChatStyle: () => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onClearMessages: () => void;
  personality: PersonalityConfig;
  permanentMemories: MemoryKeyword[];
  currentActivity?: ScreenActivity | null;
  isStreamingOrWaiting: boolean;
  voiceInputState?: VoiceInputState;
  voiceInputLevel?: number;
  voiceInputError?: string | null;
  onToggleVoiceInput?: () => void;
  onCancelVoiceInput?: () => void;
  onDismissVoiceInputError?: () => void;
  voiceHotkey?: string | null;
  /** 外框尺寸（浮動對話框時用 h-full 跟著容器） */
  className?: string;
  onClose?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  onInterrupt,
  chatStyle,
  onToggleChatStyle,
  voiceEnabled,
  onToggleVoice,
  onClearMessages,
  personality,
  permanentMemories,
  currentActivity,
  isStreamingOrWaiting,
  voiceInputState = 'idle',
  voiceInputLevel = 0,
  voiceInputError,
  onToggleVoiceInput,
  onCancelVoiceInput,
  onDismissVoiceInputError,
  voiceHotkey,
  className = 'h-[600px] max-h-[82vh]',
  onClose,
}) => {
  const [inputText, setInputText] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to latest message（串流中逐字更新時用 auto，避免平滑捲動一直排隊造成抖動）
  const lastMsg = messages[messages.length - 1];
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: lastMsg?.isStreaming ? 'auto' : 'smooth' });
  }, [messages, isStreamingOrWaiting, lastMsg?.isStreaming]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');
    await onSendMessage(text);
  };

  const sendSticker = (stickerText: string) => {
    setShowStickers(false);
    onSendMessage(stickerText);
  };

  const quickPrompts = [
    '你剛才看螢幕知道我在做什麼嗎？',
    '你待機時有找到什麼好看的影片嗎？',
    '你還記得我最喜歡什麼嗎？',
    '今天好累喔，摸摸頭安慰我一下喵～',
  ];

  return (
    <div
      className={`flex flex-col ${className} rounded-2xl overflow-hidden border shadow-2xl backdrop-blur-xl transition-colors duration-300 ${
        chatStyle === 'line'
          ? 'bg-[#1E2329]/90 border-[#06C755]/40 shadow-emerald-950/30'
          : 'bg-slate-900/90 border-purple-500/40 shadow-purple-950/30'
      }`}
    >
      {/* Top Header Bar */}
      <div
        className={`px-4 py-3 flex items-center justify-between border-b transition-colors ${
          chatStyle === 'line'
            ? 'bg-[#252D37] border-slate-700/60 text-slate-100'
            : 'bg-slate-900/90 border-slate-800 text-slate-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className={`w-10 h-10 rounded-full overflow-hidden border-2 ${
                chatStyle === 'line'
                  ? 'border-[#06C755]'
                  : 'border-amber-400/70'
              }`}
            >
              <img
                src="/bili_cover.jpg"
                alt="雙子星貓"
                className="w-full h-full object-cover object-[59%_18%] scale-150"
              />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base">
                雙子星貓 · 星穹領航員
              </h3>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase font-semibold ${
                  chatStyle === 'line'
                    ? 'bg-[#06C755]/20 text-[#06C755] border border-[#06C755]/40'
                    : 'bg-purple-950/80 text-purple-300 border border-purple-800/40'
                }`}
              >
                {chatStyle === 'line' ? 'LINE 模式' : 'GEMINI 模式'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {currentActivity
                ? `正在注視：${currentActivity.title}`
                : '✦ 指尖冒氣泡、靈感為你飆，穿梭信息海跳替你解煩惱喵～'}
            </p>
          </div>
        </div>

        {/* Header Action Tools */}
        <div className="flex items-center gap-1.5">
          {/* Style Switcher */}
          <button
            onClick={onToggleChatStyle}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="切換 LINE / Gemini 對話介面"
          >
            <ArrowLeftRight className="w-3 h-3 text-purple-400" />
            <span className="hidden sm:inline">切換樣式</span>
          </button>

          {/* Voice Switcher */}
          <button
            onClick={onToggleVoice}
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              voiceEnabled
                ? 'bg-purple-950/80 text-purple-300 border border-purple-800/50'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
            title={voiceEnabled ? '語音朗讀開啟' : '靜音中'}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Clear Button */}
          <button
            onClick={onClearMessages}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="清空聊天記錄"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="收起對話框（再點一下立繪也可以）"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Stream Container */}
      <div
        className={`flex-1 p-4 overflow-y-auto space-y-3.5 ${
          chatStyle === 'line' ? 'bg-[#181D24]' : 'bg-slate-950/60'
        }`}
      >
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {/* Pet Avatar if left */}
              {!isUser && (
                <div className="w-8 h-8 rounded-full overflow-hidden border border-indigo-400/50 shrink-0 shadow-md">
                  <img
                    src="/bili_cover.jpg"
                    alt="雙子星貓"
                    className="w-full h-full object-cover object-[59%_18%] scale-150"
                  />
                </div>
              )}

              {/* Message content */}
              <div
                className={`max-w-[78%] sm:max-w-[72%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed shadow-sm ${
                  isUser
                    ? chatStyle === 'line'
                      ? 'bg-[#06C755] text-white rounded-br-xs'
                      : 'bg-purple-600 text-white rounded-br-xs'
                    : chatStyle === 'line'
                    ? 'bg-[#2A3441] text-slate-100 rounded-bl-xs border border-slate-700/60'
                    : 'bg-slate-800/90 text-slate-100 rounded-bl-xs border border-slate-700'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {renderWithLinks(msg.content)}
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-purple-300 animate-pulse rounded-sm" />
                  )}
                </p>
              </div>

              {/* Timestamps & LINE Read Receipt */}
              <div className="flex flex-col text-[10px] text-slate-500 font-mono pb-0.5 shrink-0">
                {isUser && (
                  <span className="flex items-center gap-0.5 text-emerald-400 font-medium">
                    <CheckCheck className="w-3 h-3" /> 已讀
                  </span>
                )}
                <span>{msg.timestamp}</span>
              </div>
            </div>
          );
        })}

        {/* Typing indicator with instant interrupt button（文字開始串流後就不再顯示） */}
        {isStreamingOrWaiting && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex items-end gap-2 justify-start">
            <div className="w-8 h-8 rounded-full overflow-hidden border border-indigo-400/50 shrink-0">
              <img
                src="/bili_cover.jpg"
                alt="雙子星貓"
                className="w-full h-full object-cover object-[59%_18%] scale-150"
              />
            </div>
            <div className="bg-slate-800 border border-slate-700 text-slate-300 rounded-2xl px-3 py-2 text-xs rounded-bl-xs flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <span className="text-[11px]">雙子星貓正在思考...（可直接輸入打斷）</span>
              {onInterrupt && (
                <button
                  type="button"
                  onClick={onInterrupt}
                  className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-950/90 hover:bg-rose-900 text-rose-300 border border-rose-700/60 text-[10px] font-medium transition-colors"
                  title="立即打斷思考"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  打斷
                </button>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-3 py-1.5 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
        {quickPrompts.map((q, idx) => (
          <button
            key={idx}
            onClick={() => onSendMessage(q)}
            className="shrink-0 px-2.5 py-1 text-[11px] rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Sticker Drawer */}
      {showStickers && (
        <div className="p-3 bg-slate-900 border-t border-slate-800 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            '（摸摸雙子星貓的頭頂）',
            '（投餵一塊特製香脆大豆包）',
            '（遞上一杯無糖冰綠茶）',
            '哼！本喵才沒有做錯呢！',
            '本喵知道錯了對不起嘛喵～',
            '辛苦啦～抱一個！',
          ].map((sticker, idx) => (
            <button
              key={idx}
              onClick={() => sendSticker(sticker)}
              className="p-2 text-xs rounded-xl bg-slate-800/80 hover:bg-slate-700 text-purple-200 border border-slate-700 text-center transition-all hover:scale-105"
            >
              {sticker}
            </button>
          ))}
        </div>
      )}

      {/* Voice input status strip */}
      {(voiceInputState !== 'idle' || voiceInputError) && (
        <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800 flex items-center gap-2 text-[11px]">
          {voiceInputState === 'listening' && (
            <>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <span className="text-rose-200 shrink-0">正在聽…說完停一下會自動送出</span>
              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-rose-400 transition-[width] duration-75"
                  style={{ width: `${Math.round(voiceInputLevel * 100)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={onCancelVoiceInput}
                className="shrink-0 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                取消
              </button>
            </>
          )}
          {voiceInputState === 'transcribing' && (
            <>
              <Loader2 className="w-3.5 h-3.5 text-purple-300 animate-spin" />
              <span className="text-purple-200">語音轉文字中…</span>
            </>
          )}
          {voiceInputState === 'idle' && voiceInputError && (
            <>
              <span className="text-amber-300 flex-1">🎙️ {voiceInputError}</span>
              <button
                type="button"
                onClick={onDismissVoiceInputError}
                className="p-0.5 rounded text-slate-400 hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Bottom Message Input Box — Always enabled so user can interrupt anytime */}
      <form
        onSubmit={handleSend}
        className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2"
      >
        <button
          type="button"
          onClick={() => setShowStickers(!showStickers)}
          className="p-2 text-slate-400 hover:text-purple-300 hover:bg-slate-800 rounded-xl transition-colors"
          title="發送哈基米貼圖/互動短語"
        >
          <Smile className="w-5 h-5" />
        </button>

        {onToggleVoiceInput && (
          <button
            type="button"
            onClick={onToggleVoiceInput}
            disabled={voiceInputState === 'transcribing'}
            className={`p-2 rounded-xl transition-colors disabled:opacity-60 ${
              voiceInputState === 'listening'
                ? 'bg-rose-600 text-white animate-pulse'
                : 'text-slate-400 hover:text-purple-300 hover:bg-slate-800'
            }`}
            title={
              voiceInputState === 'listening'
                ? '正在聽，再按一次立即送出'
                : `語音輸入${voiceHotkey ? `（全域熱鍵 ${voiceHotkey}，打遊戲時也能用）` : ''}`
            }
          >
            {voiceInputState === 'transcribing' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
        )}

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isStreamingOrWaiting
              ? '隨時輸入並發送，將立即打斷思考並優先回覆你...'
              : chatStyle === 'line'
              ? '像平常回 LINE 一樣輸入訊息...'
              : '輸入給雙子星貓的訊息...'
          }
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500/70 transition-colors"
        />

        {isStreamingOrWaiting && onInterrupt && !inputText.trim() ? (
          <button
            type="button"
            onClick={onInterrupt}
            className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium flex items-center gap-1 transition-all"
            title="立即打斷思考"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>打斷</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!inputText.trim()}
            className={`p-2 rounded-xl text-white transition-all disabled:opacity-40 ${
              chatStyle === 'line'
                ? 'bg-[#06C755] hover:bg-[#05b34c]'
                : 'bg-purple-600 hover:bg-purple-500'
            }`}
            title={isStreamingOrWaiting ? '打斷思考並立即發送' : '發送'}
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </form>
    </div>
  );
};
