import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Film, Send, Smile, Volume2, VolumeX, CheckCheck, Square, Mic, Loader2, X } from 'lucide-react';
import { prepareChatMedia, type PreparedMedia } from '../utils/chatMedia';
import { ChatMessage, ChatStyle, PersonalityConfig, MemoryKeyword, ScreenActivity } from '../types';
import type { VoiceInputState } from '../hooks/useVoiceInput';
import { STICKERS } from '../services/replyRhythm';

// 把訊息裡的網址變成可點的連結（Electron 裡會由 main.js 交給預設瀏覽器開啟）
const URL_RE = /(https?:\/\/[^\s]+)/g;
function renderWithLinks(raw: string): React.ReactNode {
  // 聊天訊息不顯示 Markdown 粗體的星號（模型偶爾還是會加）
  const text = raw.replace(/\*\*(.+?)\*\*/g, '$1');
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
  onSendMessage: (text: string, media?: PreparedMedia) => Promise<void>;
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
  // 準備要傳的圖片 / 影片（按送出才真的傳）
  const [pendingMedia, setPendingMedia] = useState<PreparedMedia | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const attachFile = async (file?: File | null) => {
    if (!file) return;
    setMediaError(null);
    setMediaBusy(true);
    try {
      setPendingMedia(await prepareChatMedia(file));
    } catch (err: any) {
      setMediaError(err?.message || '這個檔案傳不了');
    } finally {
      setMediaBusy(false);
    }
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to latest message（串流中逐字更新時用 auto，避免平滑捲動一直排隊造成抖動）
  const lastMsg = messages[messages.length - 1];
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: lastMsg?.isStreaming ? 'auto' : 'smooth' });
  }, [messages, isStreamingOrWaiting, lastMsg?.isStreaming]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() && !pendingMedia) return;
    const text = inputText;
    const media = pendingMedia || undefined;
    setInputText('');
    setPendingMedia(null);
    await onSendMessage(text, media);
  };

  const sendSticker = (stickerText: string) => {
    setShowStickers(false);
    onSendMessage(stickerText);
  };

  return (
    <div
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        e.preventDefault();
        setDragOver(false);
        void attachFile(file);
      }}
      className={`relative flex flex-col ${dragOver ? 'ring-2 ring-[#06C755]' : ''} ${className} rounded-2xl overflow-hidden border shadow-2xl backdrop-blur-xl transition-colors duration-300 ${
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
                雙子星貓・西雅
              </h3>
            </div>
            {currentActivity && <p className="text-xs text-slate-400">{`正在注視：${currentActivity.title}`}</p>}
          </div>
        </div>

        {/* Header Action Tools */}
        <div className="flex items-center gap-1.5">
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

              {/* Message content（貼圖訊息顯示成大張貼圖卡，不包對話框） */}
              {msg.media ? (
                // 主人傳的圖片 / 影片（紀錄裡只存縮圖）
                <div className="max-w-[60%] flex flex-col items-end gap-1">
                  <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-black shadow-md">
                    <img src={msg.media.thumb} alt={msg.media.name || '附件'} className="block max-h-48 object-contain" />
                    {msg.media.kind === 'video' && (
                      <span className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white">
                        <Film className="w-3 h-3" />
                        {msg.media.durationSec ? `${Math.round(msg.media.durationSec)} 秒` : '影片'}
                      </span>
                    )}
                  </div>
                  {msg.content && !msg.content.startsWith('（傳了') && (
                    <div className="rounded-2xl px-3.5 py-2 text-xs sm:text-sm bg-[#06C755] text-white rounded-br-xs whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                  )}
                </div>
              ) : msg.image ? (
                // 她真的上網找到的梗圖：點圖片打開原文
                <a
                  href={msg.image.link || msg.image.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block max-w-[72%] rounded-2xl overflow-hidden border border-slate-700 bg-slate-900 shadow-md"
                  title={msg.image.title}
                >
                  <img src={msg.image.url} alt={msg.image.title || '梗圖'} className="block w-full max-h-72 object-contain bg-black" />
                  {msg.image.title && (
                    <span className="block px-2.5 py-1.5 text-[11px] leading-snug text-slate-300">{msg.image.title}</span>
                  )}
                </a>
              ) : msg.sticker && STICKERS[msg.sticker] ? (
                <div className="flex flex-col items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-pink-200/90 to-purple-200/90 border-2 border-white/70 shadow-lg select-none">
                  <span className="text-4xl leading-none">{STICKERS[msg.sticker].emoji}</span>
                  <span className="mt-1 text-[11px] font-bold text-purple-800">{STICKERS[msg.sticker].label}</span>
                </div>
              ) : (
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
              )}

              {/* Timestamps & LINE Read Receipt */}
              <div className="flex flex-col text-[10px] text-slate-500 font-mono pb-0.5 shrink-0">
                {isUser && (
                  <span className="flex items-center gap-0.5 text-emerald-400 font-medium">
                    <CheckCheck className="w-3 h-3" /> 已讀
                  </span>
                )}
                {msg.source === 'line' && (
                  <span className="font-sans font-bold text-[9px] text-[#06C755]" title="在 LINE 上的對話">
                    LINE
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
              <span className="text-[11px]">西雅輸入中…（可直接輸入打斷）</span>
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

      {(pendingMedia || mediaError) && (
        <div className="px-3 py-2 bg-slate-900 border-t border-slate-800 flex items-center gap-2 text-[11px]">
          {pendingMedia && (
            <>
              <img src={pendingMedia.thumb} alt="" className="w-12 h-12 rounded-lg object-cover border border-slate-700" />
              <span className="flex-1 text-slate-300 truncate">
                {pendingMedia.kind === 'video'
                  ? `🎬 影片${pendingMedia.durationSec ? ` ${Math.round(pendingMedia.durationSec)} 秒` : ''}${pendingMedia.mosaic ? '（太大了，會改傳 9 張截圖）' : ''}`
                  : '🖼️ 圖片'}
                ・按送出就會傳給她，可以順便打字
              </span>
            </>
          )}
          {mediaError && <span className="flex-1 text-amber-300">{mediaError}</span>}
          <button
            type="button"
            onClick={() => {
              setPendingMedia(null);
              setMediaError(null);
            }}
            className="p-1 rounded text-slate-400 hover:text-slate-200"
            title="不傳了"
          >
            <X className="w-3.5 h-3.5" />
          </button>
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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={mediaBusy}
          className="p-2 text-slate-400 hover:text-purple-300 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
          title="傳圖片或影片（也可以直接貼上或拖進對話框）"
        >
          {mediaBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            void attachFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

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
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files || []).find((f) => /^(image|video)\//.test(f.type));
            if (file) {
              e.preventDefault();
              void attachFile(file);
            }
          }}
          placeholder={
            isStreamingOrWaiting
              ? '隨時輸入並發送，將立即打斷思考並優先回覆你...'
              : chatStyle === 'line'
              ? '像平常回 LINE 一樣輸入訊息...'
              : '輸入給西雅的訊息...'
          }
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500/70 transition-colors"
        />

        {isStreamingOrWaiting && onInterrupt && !inputText.trim() && !pendingMedia ? (
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
            disabled={!inputText.trim() && !pendingMedia}
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
