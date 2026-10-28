import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Film, Volume2, VolumeX, Settings2, Monitor, MessageCircle, Mic } from 'lucide-react';
import {
  PersonalityConfig,
  MemoryKeyword,
  ChatMessage,
  DiscoveredVideo,
  ScreenActivity,
  ChatStyle,
  GeminiModelOption,
  Discovery,
  ExploreSettings,
} from './types';
import { voiceService } from './services/voiceService';
import { streamChat, createSentenceSplitter } from './services/chatStream';
import { useVoiceInput } from './hooks/useVoiceInput';
import { usePetState } from './hooks/usePetState';
import { memoryDecayService } from './services/memoryDecayService';
import { PetStage } from './components/PetStage';
import { RadialMenu, type RadialMenuItem } from './components/RadialMenu';
import { SettingsPanel, type ExploreStatus, type SettingsTab } from './components/SettingsPanel';
import { useIdleExplorer } from './hooks/useIdleExplorer';
import { useServerEvents } from './hooks/useServerEvents';
import { useAvatarAppearance } from './hooks/useAvatarAppearance';
import { useClickThrough } from './hooks/useClickThrough';
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
const STORAGE_KEY_EXPLORE = 'gemini_twin_cat_explore';

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

  // 浮動版面：預設只顯示立繪；左鍵開對話框、右鍵開扇形選單
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [radialMenu, setRadialMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('look');

  // 自主網路探索
  const [exploreSettings, setExploreSettings] = useState<ExploreSettings>(() => {
    const defaults: ExploreSettings = { enabled: true, idleMinutes: 15, petInterests: '' };
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EXPLORE);
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  });
  const [exploreStatus, setExploreStatus] = useState<ExploreStatus>({ state: 'idle' });
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EXPLORE, JSON.stringify(exploreSettings));
    } catch {
      // ignore
    }
  }, [exploreSettings]);
  const appearance = useAvatarAppearance();
  const rootRef = useRef<HTMLDivElement>(null);
  useClickThrough(rootRef);

  const bubbleTimeoutRef = useRef<any>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const isWaitingRef = useRef(false);

  // 桌寵動態：視窗偵測決定運作模式（遊戲 / Gemini 網頁 / LINE），15 分鐘沒更新就回到待機
  const SCREEN_MODE_TTL_MS = 15 * 60 * 1000;
  const appContext = currentActivity?.appContext;
  const screenModeFresh =
    !!currentActivity?.capturedAt && Date.now() - currentActivity.capturedAt < SCREEN_MODE_TTL_MS;
  const screenMode =
    screenModeFresh && appContext && appContext !== 'other' ? appContext : null;
  const pet = usePetState(screenMode);

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
    pet.markActive();
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
      // 後端回傳的情緒訊號 → 桌寵切換情緒動作
      pet.triggerEmotion(data.emotion);

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

  // 4. 自主網路探索（Autonomous Web Exploration）
  const buildExploreBody = (reason: string) => ({
    personality, // 含 customPrompt（今日特調），作為搜尋關鍵字的種子
    petInterests: exploreSettings.petInterests,
    // 只拿永久記憶和還很「新鮮」的關鍵字，快被忘掉的不算興趣
    memoryInterests: memories
      .filter((m) => m.isPermanent || m.strength >= 40)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 8)
      .map((m) => m.keyword),
    recentUrls: videos.slice(0, 40).map((v) => v.url || v.searchKeyword).filter(Boolean),
    preferredModel,
    reason,
  });

  // 收到探索結果：收進摸魚手帳、頭頂彈出推播氣泡、用語音叫主人
  const handleDiscovery = useCallback(
    (d: Discovery) => {
      const entry: DiscoveredVideo = {
        id: d.id,
        title: d.title,
        category: d.category,
        summary: d.snippet,
        catReview: d.catReview,
        tag: d.tag,
        searchKeyword: d.url,
        url: d.url,
        source: d.source,
        sourceLabel: d.sourceLabel,
        discoveredAt: d.discoveredAt,
      };
      setVideos((prev) => [entry, ...prev.filter((v) => (v.url || v.searchKeyword) !== d.url)]);
      setDiscovery(d);
      voiceService.speak(d.bubbleText);
      pet.triggerEmotion('proud');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pet.triggerEmotion]
  );

  /** 背景探索：後端先回 202，找到東西後經由 /api/events 主動推播 */
  const requestExplore = async (reason: 'idle' | 'manual') => {
    try {
      const res = await fetch('/api/auto-explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildExploreBody(reason)),
      });
      if (res.status === 409) return; // 已經在逛了
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      setExploreStatus({ state: 'error', message: err?.message || '無法連線到後端' });
    }
  };

  /** 摸魚手帳的「立即搜一部」：同步等結果 */
  const handleExploreNow = async () => {
    try {
      const res = await fetch('/api/auto-explore?wait=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildExploreBody('manual')),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      handleDiscovery(data as Discovery);
    } catch (err) {
      console.warn('Explore error:', err);
    }
  };

  const openDiscovery = (d: Discovery) => {
    const api = (window as any).electronAPI;
    if (api?.openExternal) api.openExternal(d.url);
    else window.open(d.url, '_blank', 'noopener,noreferrer');
    setDiscovery(null);
  };

  // 後端主動推播（SSE）
  useServerEvents({
    hello: (data) => setExploreStatus({ state: data?.exploring ? 'exploring' : 'idle' }),
    discovery: (data) => handleDiscovery(data as Discovery),
    'explore-status': (data) => setExploreStatus(data as ExploreStatus),
  });

  // 閒置偵測：主人超過設定時間沒操作電腦 → 自動出門探索
  useIdleExplorer({
    enabled: exploreSettings.enabled,
    idleMinutes: exploreSettings.idleMinutes,
    onIdle: () => requestExplore('idle'),
  });

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
      '喵～♪ 好舒服～再多摸兩下嘛！',
      '哼！本喵才不是隨便給人摸的呢……（發出呼嚕聲）',
      '呼嚕呼嚕～本喵的心情值直接飆升 100 點！',
      '主人今天辛苦啦～本喵的大豆包能量分你一半喵！',
    ];
    const picked = patReactions[Math.floor(Math.random() * patReactions.length)];
    triggerSpeak(picked);
  };

  const permanentCount = memories.filter((m) => m.isPermanent).length;
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);

  const openSettings = (tab: typeof settingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setIsChatOpen(false);
  };

  // 右鍵扇形選單的項目
  const radialItems: RadialMenuItem[] = [
    {
      id: 'chat',
      label: isChatOpen ? '收起對話' : '聊天',
      icon: <MessageCircle className="w-5 h-5" />,
      active: isChatOpen,
      onSelect: () => {
        setSettingsOpen(false);
        setIsChatOpen((v) => !v);
      },
    },
    {
      id: 'voice-input',
      label: '語音輸入',
      icon: <Mic className="w-5 h-5" />,
      active: voiceInput.state === 'listening',
      onSelect: () => voiceInput.toggle(),
    },
    {
      id: 'videos',
      label: '摸魚手帳',
      icon: <Film className="w-5 h-5" />,
      badge: videos.length,
      onSelect: () => setActiveModal('videos'),
    },
    {
      id: 'notebook',
      label: '記憶筆記',
      icon: <BookOpen className="w-5 h-5" />,
      badge: permanentCount,
      onSelect: () => setActiveModal('notebook'),
    },
    {
      id: 'screen',
      label: '螢幕偵測',
      icon: <Monitor className="w-5 h-5" />,
      active: isAutoTracking,
      onSelect: () => openSettings('screen'),
    },
    {
      id: 'mute',
      label: voiceEnabled ? '靜音' : '開聲音',
      icon: voiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />,
      active: !voiceEnabled,
      onSelect: () => setVoiceEnabled((v) => !v),
    },
    {
      id: 'settings',
      label: '設定',
      icon: <Settings2 className="w-5 h-5" />,
      active: settingsOpen,
      onSelect: () => (settingsOpen ? setSettingsOpen(false) : openSettings(settingsTab)),
    },
  ];

  return (
    <div
      ref={rootRef}
      data-passthrough
      className="fixed inset-0 overflow-hidden text-slate-100 antialiased selection:bg-purple-600/30 selection:text-purple-200"
      style={{ ['--pet-w' as any]: '220px', ['--pet-h' as any]: '300px' } as React.CSSProperties}
    >
      {/* 在一般瀏覽器預覽時給個背景；Electron 桌寵視窗則完全透明 */}
      {!isElectron && (
        <div data-passthrough className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950" />
      )}

      {/* 四個角落的拖曳把手（只在 Electron 桌寵視窗顯示） */}
      <WindowDragCorners />

      {/* 對話框：像漫畫氣泡一樣從立繪旁邊彈出 */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            key="chat-bubble"
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 16 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            style={{ transformOrigin: '85% 100%' }}
            className="absolute z-40 right-2 bottom-[calc(var(--pet-h)+14px)] w-[min(440px,calc(100%-16px))] h-[min(560px,calc(100%-var(--pet-h)-24px))]"
          >
            <ChatInterface
              className="h-full"
              onClose={() => setIsChatOpen(false)}
              messages={messages}
              onSendMessage={handleSendMessage}
              onInterrupt={handleInterrupt}
              chatStyle={chatStyle}
              onToggleChatStyle={() => setChatStyle((prev) => (prev === 'line' ? 'gemini' : 'line'))}
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
            {/* 漫畫氣泡的尾巴，指向立繪 */}
            <span
              className={`absolute -bottom-2 right-24 w-5 h-5 rotate-45 border-r border-b ${
                chatStyle === 'line' ? 'bg-slate-900 border-[#06C755]/40' : 'bg-slate-900 border-purple-500/40'
              }`}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 設定面板（半透明懸浮；關閉時只隱藏，螢幕偵測不會中斷） */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsTab}
        visualMode={appearance.visualMode}
        onVisualModeChange={appearance.setVisualMode}
        hasCustomImage={Boolean(appearance.customImgUrl)}
        onUploadCustomImage={appearance.uploadCustomImage}
        onPreviewPetState={pet.previewState}
        preferredModel={preferredModel}
        onPreferredModelChange={setPreferredModel}
        voiceEnabled={voiceEnabled}
        onToggleVoice={() => setVoiceEnabled(!voiceEnabled)}
        voiceHotkey={voiceHotkey}
        screenTracker={
          <ScreenVisionTracker
            personality={personality}
            permanentMemories={memories.filter((m) => m.isPermanent)}
            onActivityDetected={handleActivityDetected}
            isAutoTracking={isAutoTracking}
            onToggleAutoTracking={setIsAutoTracking}
            interruptSignal={interruptSignal}
            preferredModel={preferredModel}
          />
        }
        personalityTuner={<PersonalityTuner personality={personality} onChange={setPersonality} />}
        exploreSettings={exploreSettings}
        onExploreSettingsChange={setExploreSettings}
        onExploreNow={() => requestExplore('manual')}
        exploreStatus={exploreStatus}
        customPrompt={personality.customPrompt}
      />

      {/* 桌寵本體：固定在右下角的座標點 */}
      <div className="absolute z-30 right-2 bottom-2" style={{ width: 'var(--pet-w)', height: 'var(--pet-h)' }}>
        <PetStage
          visualMode={appearance.visualMode}
          customImgUrl={appearance.customImgUrl}
          petState={pet.state}
          isTalking={isTalking}
          speechText={speechBubbleText}
          showSpeech={!isChatOpen && !settingsOpen}
          isWatchingScreen={Boolean(currentActivity) && isAutoTracking}
          isListening={voiceInput.state === 'listening'}
          onLeftClick={() => {
            setRadialMenu((m) => ({ ...m, open: false }));
            setSettingsOpen(false);
            setIsChatOpen((v) => !v);
          }}
          onRightClick={({ x, y }) => setRadialMenu((m) => ({ open: !m.open, x, y }))}
          onPatStart={() => {
            pet.startPatting();
            handlePetHead();
          }}
          onPatEnd={pet.stopPatting}
          discovery={discovery}
          isExploring={exploreStatus.state === 'exploring'}
          onOpenDiscovery={() => discovery && openDiscovery(discovery)}
          onDismissDiscovery={() => setDiscovery(null)}
        />
      </div>

      {/* 右鍵扇形選單 */}
      <RadialMenu
        open={radialMenu.open}
        center={{ x: radialMenu.x, y: radialMenu.y }}
        items={radialItems}
        onClose={() => setRadialMenu((m) => ({ ...m, open: false }))}
      />

      {/* Memory Notebook Modal */}
      {activeModal === 'notebook' && (
        <MemoryNotebookModal memories={memories} onClose={() => setActiveModal('none')} />
      )}

      {/* Idle Video Backlog Modal */}
      {activeModal === 'videos' && (
        <IdleVideoBacklogModal
          videos={videos}
          onClose={() => setActiveModal('none')}
          onExploreNow={handleExploreNow}
          onAskAboutVideo={(video) => {
            handleAskAboutVideo(video);
            setIsChatOpen(true);
          }}
          onDeleteVideo={handleDeleteVideo}
        />
      )}
    </div>
  );
}
