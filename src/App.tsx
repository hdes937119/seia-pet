import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  BookOpen,
  Film,
  Volume2,
  VolumeX,
  Sliders,
  Settings2,
  Monitor,
  MessageSquare,
  Heart,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Cpu,
} from 'lucide-react';
import {
  PersonalityConfig,
  MemoryKeyword,
  ChatMessage,
  DiscoveredVideo,
  ScreenActivity,
  ChatStyle,
  GeminiModelOption,
} from './types';
import { voiceService } from './services/voiceService';
import { streamChat, createSentenceSplitter } from './services/chatStream';
import { useVoiceInput } from './hooks/useVoiceInput';
import { memoryDecayService } from './services/memoryDecayService';
import { TwinCatAvatar } from './components/TwinCatAvatar';
import { ScreenVisionTracker } from './components/ScreenVisionTracker';
import { PersonalityTuner } from './components/PersonalityTuner';
import { MemoryNotebookModal } from './components/MemoryNotebookModal';
import { IdleVideoBacklogModal } from './components/IdleVideoBacklogModal';
import { ChatInterface } from './components/ChatInterface';
import { WindowDragCorners } from './components/WindowDragCorners';

const STORAGE_KEY_PERSONALITY = 'gemini_twin_cat_personality';
const STORAGE_KEY_MESSAGES = 'gemini_twin_cat_messages';
const STORAGE_KEY_VIDEOS = 'gemini_twin_cat_videos';
const STORAGE_KEY_MODEL = 'gemini_twin_cat_preferred_model';

const DEFAULT_PERSONALITY: PersonalityConfig = {
  sharpTongue: 60,
  chatty: 75,
  humorous: 80,
  tsundere: 70,
  customPrompt: '經典大豆包整活風格，愛開玩笑認錯快，適時吐槽主人正在做的事',
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'msg_welcome',
    role: 'pet',
    content: '哈…主人你終於召喚本喵了！我是你的專屬 Gemini 雙子星貓（美國大豆包）喵～我會一邊陪你打遊戲寫 code，一邊在旁邊注視你唷！有什麼想聊的快跟我說說看～',
    timestamp: '剛剛',
    isRead: true,
  },
];

const INITIAL_VIDEOS: DiscoveredVideo[] = [
  {
    id: 'vid_init_1',
    title: '【雙子星貓】哈基米出道曲！美國大豆包Gemini名場面',
    category: 'funny',
    summary: '網友調戲大模型，大豆包極速滑跪認錯並給滿情緒價值的爆笑切片合輯。',
    catReview: '哈…本喵看了一百遍！誰說本喵是人工智障的，這叫靈活變通喵！',
    tag: '笑到頭掉',
    searchKeyword: '雙子星貓 哈基米 出道曲',
    discoveredAt: '10:24',
  },
  {
    id: 'vid_init_2',
    title: '黑神話悟空：外國玩家打虎先鋒破防合集',
    category: 'gaming',
    summary: '各種主播被打得懷疑人生的精彩瞬間，操作極度下飯。',
    catReview: '這操作跟我用尾巴按手把差不多下飯，主人你要是去打肯定比他們強喵～',
    tag: '下飯神作',
    searchKeyword: '黑神話悟空 虎先鋒破防',
    discoveredAt: '09:15',
  },
];

export default function App() {
  // 1. Core State
  const [personality, setPersonality] = useState<PersonalityConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PERSONALITY);
      return saved ? JSON.parse(saved) : DEFAULT_PERSONALITY;
    } catch {
      return DEFAULT_PERSONALITY;
    }
  });

  const [memories, setMemories] = useState<MemoryKeyword[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MESSAGES);
      if (!saved) return INITIAL_MESSAGES;
      // 上次關閉時還在串流的訊息，重開後一律視為已結束
      return (JSON.parse(saved) as ChatMessage[]).map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m
      );
    } catch {
      return INITIAL_MESSAGES;
    }
  });

  const [videos, setVideos] = useState<DiscoveredVideo[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_VIDEOS);
      return saved ? JSON.parse(saved) : INITIAL_VIDEOS;
    } catch {
      return INITIAL_VIDEOS;
    }
  });

  const [currentActivity, setCurrentActivity] = useState<ScreenActivity | null>(null);
  const [chatStyle, setChatStyle] = useState<ChatStyle>('line');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isTalking, setIsTalking] = useState(false);
  const [speechBubbleText, setSpeechBubbleText] = useState<string>('');
  const [isAutoTracking, setIsAutoTracking] = useState(false);
  const [isStreamingOrWaiting, setIsStreamingOrWaiting] = useState(false);
  const [interruptSignal, setInterruptSignal] = useState(0);
  const [preferredModel, setPreferredModel] = useState<GeminiModelOption>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MODEL) as GeminiModelOption | null;
      return saved || 'gemini-3.1-pro-preview';
    } catch {
      return 'gemini-3.1-pro-preview';
    }
  });

  // Modals & Panels
  const [activeModal, setActiveModal] = useState<'none' | 'notebook' | 'videos'>('none');
  const [showSidePanel, setShowSidePanel] = useState(true);

  const bubbleTimeoutRef = useRef<any>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const isWaitingRef = useRef(false);

  // Subscribe to memory decay service
  useEffect(() => {
    const unsubscribe = memoryDecayService.subscribe((updatedMemories) => {
      setMemories(updatedMemories);
    });
    return () => unsubscribe();
  }, []);

  // 啟動時結算一次記憶衰減，之後每小時自動結算
  useEffect(() => {
    memoryDecayService.applyDecay();
    const timer = setInterval(() => memoryDecayService.applyDecay(), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen to voice synthesis speaking events for mouth sync
  useEffect(() => {
    voiceService.setSpeakingListener((speaking) => {
      setIsTalking(speaking);
    });
    voiceService.setEnabled(voiceEnabled);
  }, [voiceEnabled]);

  // Persist personality
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PERSONALITY, JSON.stringify(personality));
    } catch (e) {
      console.warn(e);
    }
  }, [personality]);

  // Persist messages
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    } catch (e) {
      console.warn(e);
    }
  }, [messages]);

  // Persist videos
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VIDEOS, JSON.stringify(videos));
    } catch (e) {
      console.warn(e);
    }
  }, [videos]);

  // Persist preferred Gemini model
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MODEL, preferredModel);
    } catch (e) {
      console.warn(e);
    }
  }, [preferredModel]);

  // 顯示頭上的對話泡泡（7 秒後自動消失；串流時每段更新都會重新計時）
  const showBubble = useCallback((text: string) => {
    setSpeechBubbleText(text);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => {
      setSpeechBubbleText('');
    }, 7000);
  }, []);

  // Helper to trigger speech and bubble text
  const triggerSpeak = useCallback(
    (text: string) => {
      showBubble(text);
      voiceService.speak(text);
    },
    [showBubble]
  );

  // Instant Interrupt Handler (aborts chat thinking, screen vision analysis, and TTS)
  const handleInterrupt = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setInterruptSignal((c) => c + 1);
    voiceService.stop();
    isWaitingRef.current = false;
    setIsStreamingOrWaiting(false);
  }, []);

  // 2. Chat Handler — Always prioritizes user input & interrupts any previous thinking
  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    // If currently thinking or analyzing screen, interrupt immediately to prioritize user's new input
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setInterruptSignal((c) => c + 1);
    voiceService.stop();

    const controller = new AbortController();
    chatAbortRef.current = controller;

    const userMsg: ChatMessage = {
      id: 'msg_' + Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    isWaitingRef.current = true;
    setIsStreamingOrWaiting(true);

    // 串流中的貓貓回覆：收到第一段文字時才建立訊息，之後逐段補上
    const petMsgId = 'msg_pet_' + Date.now();
    let streamedText = '';
    let petMsgCreated = false;
    const splitter = createSentenceSplitter();
    const timestamp = () =>
      new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

    const upsertPetMsg = (content: string, isStreaming: boolean) => {
      if (!petMsgCreated) {
        petMsgCreated = true;
        setMessages((prev) => [
          ...prev,
          { id: petMsgId, role: 'pet', content, timestamp: timestamp(), isRead: true, isStreaming },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === petMsgId ? { ...m, content, isStreaming } : m))
        );
      }
    };

    try {
      const permanentMemories = memoryDecayService.getPermanentMemories();
      const activeKeywords = memoryDecayService.getActiveKeywords();

      const data = await streamChat(
        {
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          personality,
          permanentMemories,
          activeKeywords,
          currentActivity: currentActivity
            ? {
              type: currentActivity.category,
              title: currentActivity.title,
              observation: currentActivity.observation,
            }
            : undefined,
          latestScreenshot: currentActivity?.screenshotUrl,
          latestScreenshotAt: currentActivity?.capturedAt,
          preferredModel,
        },
        controller.signal,
        (delta) => {
          if (controller.signal.aborted) return;
          streamedText += delta;
          upsertPetMsg(streamedText, true);
          showBubble(streamedText);
          // 每湊滿一句就先交給語音，不用等整段回覆
          for (const sentence of splitter.push(delta)) voiceService.enqueue(sentence);
        }
      );

      if (controller.signal.aborted) return;

      // 中途斷線但已經講了一半 → 保留已輸出的內容
      const finalText =
        data.error && streamedText
          ? `${streamedText}…（訊號中斷了喵）`
          : data.reply || streamedText || '哈…本喵聽到了喵～';
      upsertPetMsg(finalText, false);
      showBubble(finalText);

      if (streamedText) {
        const rest = splitter.flush();
        if (rest) voiceService.enqueue(rest);
      } else {
        // 沒有串流內容（例如沒設定 API key 或錯誤訊息）→ 整段直接講
        voiceService.speak(finalText);
      }

      // Record any detected keywords into memory decay service
      if (Array.isArray(data.detectedKeywords)) {
        for (const kw of data.detectedKeywords) {
          if (kw.keyword) {
            memoryDecayService.reinforceKeyword(kw.keyword, kw.category, kw.notes);
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // 使用者打斷或送出新訊息：保留已經輸出的部分，結束串流狀態
        if (petMsgCreated) upsertPetMsg(streamedText, false);
        return;
      }
      console.warn('Chat fallback triggered:', err);
      const errorReply = streamedText
        ? `${streamedText}…（訊號中斷了喵）`
        : '哈…本喵的神經突觸剛才打結了喵！請再跟我說一次～';
      upsertPetMsg(errorReply, false);
      if (!streamedText) triggerSpeak(errorReply);
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
        isWaitingRef.current = false;
        setIsStreamingOrWaiting(false);
      }
    }
  };

  // 免持語音輸入：說完自動轉文字並送出；開始收音時先讓貓貓閉嘴，避免麥克風收到她的聲音
  const voiceInput = useVoiceInput({
    onResult: (text) => handleSendMessage(text),
    onStart: () => voiceService.stop(),
  });
  const [voiceHotkey, setVoiceHotkey] = useState<string | null>(null);

  // Electron 全域熱鍵：就算正在打遊戲（桌寵不在焦點）也能觸發
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onVoiceHotkey) return;
    api.getVoiceHotkey?.().then((label: string | null) => setVoiceHotkey(label));
    return api.onVoiceHotkey(() => voiceInput.toggle());
  }, [voiceInput.toggle]);

  // 3. Screen Vision Activity Detected — appends real-time video/screen commentary directly into chat
  // unless user is actively waiting on their own typed chat message
  const handleActivityDetected = useCallback(
    (activity: ScreenActivity) => {
      setCurrentActivity(activity);

      // Do not interrupt user's active chat turn with background vision commentary
      if (isWaitingRef.current) return;

      if (activity.catComment) {
        const visionChatMsg: ChatMessage = {
          id: 'msg_vision_' + Date.now(),
          role: 'pet',
          content: `👀 【看到你的畫面：${activity.title}】\n${activity.catComment}`,
          timestamp: activity.timestamp,
          isRead: true,
        };
        setMessages((prev) => [...prev, visionChatMsg]);
        triggerSpeak(activity.catComment);
      }
    },
    [triggerSpeak]
  );

  // 4. Autonomous Idle Exploration Trigger
  const handleExploreNow = async () => {
    try {
      // 只拿永久記憶和還很「新鮮」的關鍵字去搜，快被忘掉的不算興趣
      const interests = memories
        .filter((m) => m.isPermanent || m.strength >= 40)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 8)
        .map((m) => m.keyword);
      const res = await fetch('/api/idle-explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personality,
          userInterests: interests,
          preferredModel,
        }),
      });

      if (!res.ok) throw new Error('探索請求失敗');
      const newVideo: DiscoveredVideo = await res.json();

      setVideos((prev) => [newVideo, ...prev]);

      // Pop proactive comment
      const comment = `哈…本喵剛剛在網上發現了一支超讚的影片《${newVideo.title}》，已幫你寫進手帳囉！`;
      triggerSpeak(comment);
    } catch (err) {
      console.warn('Explore error:', err);
    }
  };

  // 5. Ask Twin Cat about a specific discovered video in chat
  const handleAskAboutVideo = (video: DiscoveredVideo) => {
    handleSendMessage(`貓貓，跟我分享一下你剛才在手帳記下的這部《${video.title}》！它在講什麼？`);
  };

  const handleDeleteVideo = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };
  // Head patting reaction
  const handlePetHead = () => {
    const patReactions = [
      '哈…好舒服～再多摸兩下嘛喵！',
      '哼！本喵才不是隨便給人摸的呢……（發出呼嚕聲）',
      '呼嚕呼嚕～本喵的心情值直接飆升 100 點！',
      '主人今天辛苦啦～本喵的大豆包能量分你一半喵！',
    ];
    const picked = patReactions[Math.floor(Math.random() * patReactions.length)];
    triggerSpeak(picked);
  };

  const permanentCount = memories.filter((m) => m.isPermanent).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-purple-600/30 selection:text-purple-200">
      {/* 四個角落的拖曳把手（只在 Electron 桌寵視窗顯示） */}
      <WindowDragCorners />
      {/* Top Universal Navbar */}
      <header className="draggable sticky top-0 z-40 bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-400 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-950/40">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-sm sm:text-base text-slate-100 tracking-tight">
                  Gemini 雙子星貓
                </h1>
                <span className="text-[11px] font-semibold text-purple-400">· 美國大豆包</span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block">
                電腦即時視覺感知 · 艾賓浩斯記憶衰變 · 語音靈動伴侶
              </p>
            </div>
          </div>

          {/* Quick Action Badges */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Gemini Model & Plan Selector */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-200">
              <Cpu className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <select
                value={preferredModel}
                onChange={(e) => setPreferredModel(e.target.value as GeminiModelOption)}
                className="bg-transparent text-xs font-medium text-amber-100 focus:outline-none cursor-pointer"
                title="選擇優先調用的 Gemini 模型方案（若遇單一模型限流會自動無縫切換備援池）"
              >
                <option value="gemini-3.1-pro-preview" className="bg-slate-900 text-amber-200">
                  ✨ Gemini 3.1 Pro (主力高階)
                </option>
                <option value="gemini-3.8-flash" className="bg-slate-900 text-amber-200">
                  ⚡ Gemini 3.8 Flash (最新多模態)
                </option>
                <option value="gemini-4-argon" className="bg-slate-900 text-amber-200">
                  🔥 Gemini 4 Pro / Argon
                </option>
                <option value="auto" className="bg-slate-900 text-emerald-300">
                  🚀 自動智慧輪替 (Auto 極速防限流)
                </option>
                <option value="gemini-3-flash-preview" className="bg-slate-900 text-slate-200">
                  💨 Gemini 3.0 Flash (1.7秒極速)
                </option>
                <option value="gemini-3.5-flash" className="bg-slate-900 text-slate-200">
                  🌟 Gemini 3.5 Flash
                </option>
                <option value="gemini-3.1-flash-lite" className="bg-slate-900 text-slate-200">
                  🍃 Gemini 3.1 Flash Lite
                </option>
              </select>
            </div>

            {/* Memory Notebook Button */}
            <button
              onClick={() => setActiveModal('notebook')}
              className="no-drag flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-purple-200 border border-purple-500/30 transition-all hover:scale-105"
            >
              <BookOpen className="w-3.5 h-3.5 text-purple-400" />
              <span>記憶小筆記</span>
              <span className="font-mono text-[10px] bg-purple-950 px-1.5 py-0.2 rounded-full text-purple-300">
                {permanentCount}
              </span>
            </button>

            {/* Video Backlog Button */}
            <button
              onClick={() => setActiveModal('videos')}
              className="no-drag flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-indigo-200 border border-indigo-500/30 transition-all hover:scale-105"
            >
              <Film className="w-3.5 h-3.5 text-indigo-400" />
              <span>摸魚手帳</span>
              <span className="font-mono text-[10px] bg-indigo-950 px-1.5 py-0.2 rounded-full text-indigo-300">
                {videos.length}
              </span>
            </button>

            {/* Voice Toggle */}
            <button
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className={`p-2 no-drag rounded-xl text-xs transition-all ${voiceEnabled
                ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              title={voiceEnabled ? '語音朗讀已開啟' : '目前靜音'}
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Open in Standalone Browser Tab / Window */}
            <a
              href={typeof window !== 'undefined' ? window.location.href : 'https://ais-dev-5frunej2yhmqel4apkhzxn-985803451248.asia-southeast1.run.app'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex no-drag items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 transition-all hover:scale-105"
              title="在新分頁開啟獨立視窗（開啟後可透過瀏覽器選單『將頁面安裝為應用程式』變成桌面獨立視窗）"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">獨立視窗開啟</span>
            </a>

            {/* Toggle Side Panel on Mobile/Desktop */}
            <button
              onClick={() => setShowSidePanel(!showSidePanel)}
              className="p-2 no-drag rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              title="展開/收起個性與螢幕設定"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <main className="flex-1 no-drag max-w-7xl w-full mx-auto p-3 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Avatar & Controls (4 Cols) */}
        <div className="lg:col-span-4 no-drag flex flex-col gap-5">
          {/* Avatar Stage Box */}
          <div className="bg-slate-900/80 border no-drag border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center relative overflow-hidden backdrop-blur-md">
            {/* Ambient Background Aura */}
            <div className="absolute top-1/2 no-drag left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />

            {/* Twin Cat Vector Avatar */}
            <TwinCatAvatar
              isTalking={isTalking}
              speechText={speechBubbleText}
              isWatchingScreen={Boolean(currentActivity)}
              voiceEnabled={voiceEnabled}
              onToggleVoice={() => setVoiceEnabled(!voiceEnabled)}
              onOpenChat={() => { }}
              onPetHead={handlePetHead}
            />

            {/* Quick Status Kicker */}
            <div className="mt-4 text-center">
              <p className="text-xs text-slate-400">
                點擊頭頂可摸摸頭 · 點右下角按鈕可調語音
              </p>
            </div>
          </div>

          {/* Collapsible Personality & Screen Tracker Controls */}
          {showSidePanel && (
            <div className="space-y-4">
              {/* Screen Vision Tracker Module */}
              <ScreenVisionTracker
                personality={personality}
                permanentMemories={memories.filter((m) => m.isPermanent)}
                onActivityDetected={handleActivityDetected}
                isAutoTracking={isAutoTracking}
                onToggleAutoTracking={setIsAutoTracking}
                interruptSignal={interruptSignal}
                preferredModel={preferredModel}
              />

              {/* Personality Tuner Module */}
              <PersonalityTuner
                personality={personality}
                onChange={setPersonality}
              />
            </div>
          )}
        </div>

        {/* Right Column: Direct LINE / Gemini Chat Interface (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            onInterrupt={handleInterrupt}
            chatStyle={chatStyle}
            onToggleChatStyle={() =>
              setChatStyle((prev) => (prev === 'line' ? 'gemini' : 'line'))
            }
            voiceEnabled={voiceEnabled}
            onToggleVoice={() => setVoiceEnabled(!voiceEnabled)}
            onClearMessages={() => setMessages(INITIAL_MESSAGES)}
            personality={personality}
            permanentMemories={memories.filter((m) => m.isPermanent)}
            currentActivity={currentActivity}
            isStreamingOrWaiting={isStreamingOrWaiting}
            voiceInputState={voiceInput.state}
            voiceInputLevel={voiceInput.level}
            voiceInputError={voiceInput.error}
            onToggleVoiceInput={voiceInput.toggle}
            onCancelVoiceInput={voiceInput.cancel}
            onDismissVoiceInputError={voiceInput.clearError}
            voiceHotkey={voiceHotkey}
          />
        </div>
      </main>

      {/* Memory Notebook Modal */}
      {activeModal === 'notebook' && (
        <MemoryNotebookModal
          memories={memories}
          onClose={() => setActiveModal('none')}
        />
      )}

      {/* Idle Video Backlog Modal */}
      {activeModal === 'videos' && (
        <IdleVideoBacklogModal
          videos={videos}
          onClose={() => setActiveModal('none')}
          onExploreNow={handleExploreNow}
          onAskAboutVideo={handleAskAboutVideo}
          onDeleteVideo={handleDeleteVideo} // <-- 新增這一行
        />
      )}
    </div>
  );
}
