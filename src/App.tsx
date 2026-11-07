import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Film, Settings2, Monitor, MessageCircle, Mic, Music2 } from 'lucide-react';
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
import { splitSegments, typingDelayMs, speakableText, type Segment } from './services/replyRhythm';
import { useVoiceInput } from './hooks/useVoiceInput';
import { usePetState } from './hooks/usePetState';
import { memoryDecayService } from './services/memoryDecayService';
import { PetStage } from './components/PetStage';
import { RadialMenu, type RadialMenuItem } from './components/RadialMenu';
import { type PreparedMedia } from './utils/chatMedia';
import { SettingsPanel, type ExploreStatus, type SettingsTab } from './components/SettingsPanel';
import { useIdleExplorer } from './hooks/useIdleExplorer';
import { markPetInteraction } from './utils/petInteraction';
import { useAutoHide } from './hooks/useAutoHide';
import { useHourlyChime } from './hooks/useHourlyChime';
import { Ahoge } from './components/pet/Ahoge';
import { SignClock } from './components/pet/SignClock';
import { useServerEvents } from './hooks/useServerEvents';
import { pickPatReaction } from './utils/patReactions';
import { getClientTime } from './utils/clientTime';
import { useCompanionGreeting, type GreetingReason } from './hooks/useCompanionGreeting';
import { useDiaryCompiler, messageTime } from './hooks/useDiaryCompiler';
import { useRelationship } from './hooks/useRelationship';
import { RelationshipCard } from './components/RelationshipCard';
import { useAvatarAppearance } from './hooks/useAvatarAppearance';
import { useClickThrough } from './hooks/useClickThrough';
import { useMusicPlayer } from './hooks/useMusicPlayer';
import { MusicPlayer } from './components/MusicPlayer';
import { ScreenVisionTracker } from './components/ScreenVisionTracker';
import type { PinMode } from './components/SettingsPanel';
import { grabLiveFrame } from './liveFrame';
import { PersonalityTuner } from './components/PersonalityTuner';
import { MemoryNotebookModal } from './components/MemoryNotebookModal';
import { IdleVideoBacklogModal } from './components/IdleVideoBacklogModal';
import { ChatInterface } from './components/ChatInterface';
import { WindowDragCorners } from './components/WindowDragCorners';

const AUTO_HIDE_KEY = 'gemini_twin_cat_auto_hide';

/** LINE 對話紀錄的一筆（後端 /api/line/history） */
interface LineHistoryItem {
  role: 'user' | 'pet';
  content: string;
  at: number;
}

/** LINE 對話 → 對話框的訊息（她的回覆照 [[NEXT]] / 貼圖拆成好幾則，跟桌面上一樣） */
function lineToChatMessages(items: LineHistoryItem[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const it of items) {
    const d = new Date(it.at);
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const timestamp = sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
    const segs: Segment[] = it.role === 'pet' ? splitSegments(it.content, true).complete : [{ content: it.content }];
    segs.forEach((seg, i) => {
      out.push({
        id: `line_${it.at}_${i}`, // 結尾是時間戳，跟桌面訊息一起依時間排序
        role: it.role,
        content: seg.content,
        sticker: seg.sticker,
        timestamp,
        isRead: true,
        source: 'line',
      });
    });
  }
  return out;
}

/** 桌面訊息 + LINE 訊息依時間排好（沒有時間的桌面訊息跟著前一則） */
function mergeByTime(desktop: ChatMessage[], line: ChatMessage[]): ChatMessage[] {
  if (line.length === 0) return desktop;
  let last = 0;
  const tagged = [
    ...desktop.map((m, i) => {
      last = messageTime(m) ?? last;
      return { m, t: last, k: 0, i };
    }),
    ...line.map((m, i) => ({ m, t: messageTime(m) ?? 0, k: 1, i })),
  ];
  return tagged.sort((a, b) => a.t - b.t || a.k - b.k || a.i - b.i).map((x) => x.m);
}
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

const PIN_MODE_KEY = 'gemini_twin_cat_pin_mode';

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
  // 聊天框外觀：目前固定 LINE 風格（ChatInterface 裡依 chatStyle 分支上色，以後要換色調就在這裡加新的樣式）
  const chatStyle: ChatStyle = 'line';
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
  const isChatOpenRef = useRef(false);
  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);
  const [radialMenu, setRadialMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('look');

  // 自主網路探索
  const [exploreSettings, setExploreSettings] = useState<ExploreSettings>(() => {
    const defaults: ExploreSettings = {
      enabled: true,
      idleMinutes: 15,
      petInterests: '',
      greetOnReturn: true,
      lateNightReminder: true,
      hourlyChime: true,
      stamina: 'normal',
      sources: { youtube: true, wiki: true, news: true, reddit: true, hn: true, ptt: true, bahamut: true },
      pttBoards: 'C_Chat, Steam, PlayStation, PC_Shopping, movie, joke',
      bahamutBoards: '流亡黯道 18966、原神 36730、英雄聯盟 17532、魔物獵人 5786、Nintendo Switch 31587、電腦應用綜合討論 60030',
      subreddits: '',
    };
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EXPLORE);
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      // 新增的來源開關要補上預設值（舊設定裡沒有）
      return { ...defaults, ...parsed, sources: { ...defaults.sources, ...(parsed.sources || {}) } };
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
  const pendingMediaRef = useRef<PreparedMedia[]>([]);
  // 她在忙（洗澡、出門買宵夜…）：後端決定，這裡只負責顯示倒數
  const [busyInfo, setBusyInfo] = useState<{ emoji: string; label: string; endAt: number; awayNote: string } | null>(null);
  const applyBusy = useCallback((data: any) => {
    const c = data?.busy ? data.current : null;
    setBusyInfo(c ? { emoji: c.emoji, label: c.label, endAt: c.endAt, awayNote: c.awayNote } : null);
  }, []);
  useEffect(() => {
    const load = () =>
      fetch('/api/busy')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && applyBusy(d))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [applyBusy]);
  const isWaitingRef = useRef(false);

  // 桌寵動態：視窗偵測決定運作模式（遊戲 / Gemini 網頁 / LINE），15 分鐘沒更新就回到待機
  const SCREEN_MODE_TTL_MS = 15 * 60 * 1000;
  const appContext = currentActivity?.appContext;
  const screenModeFresh =
    !!currentActivity?.capturedAt && Date.now() - currentActivity.capturedAt < SCREEN_MODE_TTL_MS;
  const screenMode =
    screenModeFresh && appContext && appContext !== 'other' ? appContext : null;
  // 長時間心情與好感度（影響語氣、閒置動作，設定面板「主動」分頁可以看）
  const relation = useRelationship();
  // 主人說「在吃飯」（桌面或 LINE 都算）→ 她也換成捧碗陪你吃，說「吃飽了」或 45 分鐘後換回來
  const [eatingUntil, setEatingUntil] = useState(0);
  useEffect(() => {
    if (!eatingUntil) return;
    const left = eatingUntil - Date.now();
    if (left <= 0) {
      setEatingUntil(0);
      return;
    }
    const t = window.setTimeout(() => setEatingUntil(0), left);
    return () => window.clearTimeout(t);
  }, [eatingUntil]);
  // 體力與天氣：累了打哈欠、沒電抱枕頭、外面在下雨就撐傘不爽（後端判斷，每 3 分鐘問一次，聊完也會更新）
  // asleep：河木鎮的早上賴床（還沒被主人叫醒）
  const [petStatus, setPetStatus] = useState<{ tier: 'fresh' | 'tired' | 'exhausted'; raining: boolean; asleep?: boolean }>({
    tier: 'fresh',
    raining: false,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/pet-status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d?.tier) setPetStatus({ tier: d.tier, raining: Boolean(d.raining), asleep: Boolean(d.asleep) });
        })
        .catch(() => {});
    load();
    const t = window.setInterval(load, 3 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  // 優先順序：吃飯 > 賴床 / 沒電（連打遊戲都撐不住）> 螢幕偵測的情境 > 累了 > 下雨天 > 待機
  const baseMode = eatingUntil
    ? 'eating'
    : petStatus.asleep || petStatus.tier === 'exhausted'
      ? 'exhausted'
      : screenMode ?? (petStatus.tier === 'tired' ? 'tired' : petStatus.raining ? 'rainy' : null);
  const pet = usePetState(baseMode, relation.snapshot?.mood ?? 0);

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

  // 最近 20 則 LINE 對話（只顯示在對話框，不存進桌寵的聊天紀錄；後端有新訊息會即時推過來）
  const [lineHistory, setLineHistory] = useState<LineHistoryItem[]>([]);
  useEffect(() => {
    fetch('/api/line/history')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.items)) setLineHistory(data.items);
      })
      .catch(() => undefined);
  }, []);
  const lineMessages = useMemo(() => lineToChatMessages(lineHistory), [lineHistory]);
  const chatDisplay = useMemo(() => mergeByTime(messages, lineMessages), [messages, lineMessages]);

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
  /**
   * 連續輸入防抖（借 astrbot private_companion）：主人一句話拆成兩三則快速連傳時，
   * 先等一下再一起回，不會被她搶答、回兩次。看起來像她在等你打完。
   * 句子看起來講完了（句號、問號、夠長）只等 0.9 秒；短短的、像還沒講完的等 2 秒。語音輸入不用等。
   */
  const debounceMs = (text: string) => {
    const t = text.trim();
    if (/[。！？!?…~～]$|喵$/.test(t) || t.length >= 20) return 900;
    return 2000;
  };

  const handleSendMessage = async (text: string, opts: { immediate?: boolean; media?: PreparedMedia } = {}) => {
    markPetInteraction(); // 跟她聊天也算有理她（語音熱鍵送出時不會有點擊）
    if (!text.trim() && !opts.media) return;
    // 主人傳的圖片 / 影片：等到這次真的送出去才清掉（連傳時前一次被取消，附件會跟著下一次一起送）
    if (opts.media) pendingMediaRef.current = [...pendingMediaRef.current, opts.media].slice(-4);

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
      content: text.trim() || (opts.media?.kind === 'video' ? '（傳了一段影片）' : '（傳了一張圖片）'),
      ...(opts.media
        ? { media: { kind: opts.media.kind, thumb: opts.media.thumb, name: opts.media.name, durationSec: opts.media.durationSec } }
        : {}),
      timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    // 給她的上下文：桌面 + LINE 的對話依時間排好（她記得你剛剛在 LINE 上說了什麼）
    const contextMessages = mergeByTime(nextMessages, lineMessages);
    setMessages(nextMessages);
    isWaitingRef.current = true;
    pet.markActive();
    setIsStreamingOrWaiting(true);

    // 等一下看主人是不是還要接著打（又送出新的一則 → 這次取消，由新的那次一起回）
    if (!opts.immediate) {
      await new Promise((r) => setTimeout(r, debounceMs(text)));
      if (controller.signal.aborted) return;
    }

    // 說話節奏：回覆可能被模型用 [[NEXT]] 切成好幾則（或含貼圖）。
    // 第 1 則照常逐字串流；第 2 則開始，先「輸入中…」一下再整則送出，像真人連傳訊息。
    const petMsgBase = 'msg_pet_' + Date.now();
    const segId = (i: number) => `${petMsgBase}_${i}`;
    let streamedText = ''; // 串流收到的原始文字（含 [[NEXT]]）
    let firstSegText = ''; // 第 1 則目前顯示到哪（給語音逐句唸用）
    let firstSegDone = false;
    const createdSegs = new Set<number>();
    const scheduledSegs = new Set<number>();
    let revealChain: Promise<void> = Promise.resolve();
    const splitter = createSentenceSplitter();
    const timestamp = () =>
      new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

    const upsertSeg = (i: number, seg: Segment, isStreaming: boolean) => {
      const fields = { content: seg.content, sticker: seg.sticker, isStreaming };
      if (!createdSegs.has(i)) {
        createdSegs.add(i);
        setMessages((prev) => [
          ...prev,
          { id: segId(i), role: 'pet', timestamp: timestamp(), isRead: true, ...fields },
        ]);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === segId(i) ? { ...m, ...fields } : m)));
      }
      if (seg.content) showBubble(seg.content);
    };

    // 第 2 則之後：等一下（輸入中…）再整則送出，並交給語音
    const scheduleReveal = (i: number, seg: Segment) => {
      if (scheduledSegs.has(i)) return;
      scheduledSegs.add(i);
      revealChain = revealChain.then(async () => {
        await new Promise((r) => setTimeout(r, typingDelayMs(seg)));
        if (controller.signal.aborted) return;
        upsertSeg(i, seg, false);
        const say = speakableText(seg);
        if (say) voiceService.enqueue(say);
      });
    };

    // 第 1 則講完了：結束串流狀態、把剩下沒唸的交給語音
    const finishFirstSeg = (seg: Segment) => {
      if (firstSegDone) return;
      firstSegDone = true;
      upsertSeg(0, seg, false);
      if (firstSegText) {
        // 最後一包文字常常跟 [[NEXT]] / 貼圖一起到，還沒交給語音過 → 先補上，不然句尾會被吞掉
        const tail = seg.content.startsWith(firstSegText) ? seg.content.slice(firstSegText.length) : '';
        if (tail) for (const sentence of splitter.push(tail)) voiceService.enqueue(sentence);
        const rest = splitter.flush();
        if (rest) voiceService.enqueue(rest);
      } else if (speakableText(seg)) {
        voiceService.enqueue(speakableText(seg));
      }
    };

    /** 依目前收到的文字更新畫面：第 1 則逐字顯示，其餘排隊送出 */
    const render = (raw: string, done: boolean) => {
      const { complete, partial } = splitSegments(raw, done);
      if (!firstSegDone) {
        if (complete.length > 0) {
          finishFirstSeg(complete[0]);
        } else if (partial) {
          // 第 1 則還在講：逐字顯示，每湊滿一句先交給語音
          const added = partial.slice(firstSegText.length);
          firstSegText = partial;
          upsertSeg(0, { content: partial }, true);
          for (const sentence of splitter.push(added)) voiceService.enqueue(sentence);
        }
      }
      complete.forEach((seg, i) => {
        if (i > 0) scheduleReveal(i, seg);
      });
    };

    try {
      const permanentMemories = memoryDecayService.getPermanentMemories();
      const activeKeywords = memoryDecayService.getActiveKeywords();
      const attachments = pendingMediaRef.current.map((m) => ({
        mime: m.mime,
        data: m.data,
        kind: m.kind,
        name: m.name,
        durationSec: m.durationSec,
        mosaic: m.mosaic,
      }));
      pendingMediaRef.current = [];
      // 送出這一刻的畫面（螢幕共享開著才有）；抓不到才用上次分析時的截圖
      const liveFrame = grabLiveFrame();

      const data = await streamChat(
        {
          // 後端會把連傳訊息合併後取最近 20 則；這裡多送一些原始訊息當餘裕，但不要整串歷史都送
          messages: contextMessages
            .slice(-80)
            .map((m) => ({ role: m.role, content: m.content, source: m.source, at: messageTime(m) ?? undefined })),
          personality,
          permanentMemories,
          activeKeywords,
          currentActivity: currentActivity
            ? {
              type: currentActivity.category,
              appContext: currentActivity.appContext,
              title: currentActivity.title,
              observation: currentActivity.observation,
              capturedAt: currentActivity.capturedAt,
            }
            : undefined,
          latestScreenshot: liveFrame?.data ?? currentActivity?.screenshotUrl,
          latestScreenshotAt: liveFrame?.at ?? currentActivity?.capturedAt,
          latestScreenshotLive: !!liveFrame,
          staminaMode: exploreSettings.stamina,
          attachments,
          preferredModel,
          clientTime: getClientTime(),
          // 讓她知道現在在放什麼（「這首是什麼」「下一首」才接得上）
          musicState: {
            status: music.state.status,
            title: music.track?.title,
            author: music.track?.author,
            volume: music.state.volume,
          },
        },
        controller.signal,
        (delta) => {
          if (controller.signal.aborted) return;
          streamedText += delta;
          render(streamedText, false);
        },
        // 她開口前的微表情（白眼、嘆氣、心虛、害羞、偷笑）：一收到就先做表情
        (event, payload) => {
          if (event === 'act' && !controller.signal.aborted) pet.triggerAct(payload?.act);
        }
      );
      if (data.petStatus?.tier) setPetStatus(data.petStatus);

      if (controller.signal.aborted) return;

      // 主人叫她放歌 / 切歌 / 調音量 → 馬上執行，不用等後面幾則訊息打完字
      if (data.music) music.command(data.music);

      // 中途斷線但已經講了一半 → 保留已輸出的內容；正常結束時用後端整理過的完整回覆
      const finalText =
        data.error && streamedText
          ? `${streamedText}…（訊號中斷了喵）`
          : data.reply || streamedText || '哈…本喵聽到了喵～';
      render(finalText, true);
      // 等第 2 則之後的訊息都「打完字」送出，才算這輪回覆結束
      await revealChain;
      if (controller.signal.aborted) return;

      // 她真的上網找到的東西：梗圖一張一則、連結整理成一則（content 也寫給她自己看，之後聊天記得傳過什麼）
      if (Array.isArray(data.attachments) && data.attachments.length) {
        const extra: ChatMessage[] = [];
        data.attachments.forEach((a: any, i: number) => {
          if (a?.type === 'image' && a.url) {
            extra.push({
              id: `${petMsgBase}_img_${i}`,
              role: 'pet',
              content: `（傳了梗圖：${a.title || ''} ${a.link || ''}）`,
              image: { url: a.url, link: a.link, title: a.title },
              timestamp: timestamp(),
              isRead: true,
            });
          }
        });
        const links = data.attachments.filter((a: any) => a?.type === 'link' && a.url);
        if (links.length) {
          extra.push({
            id: `${petMsgBase}_links`,
            role: 'pet',
            content: links.map((a: any) => `🔗 ${a.title || ''}\n${a.url}`).join('\n\n'),
            timestamp: timestamp(),
            isRead: true,
          });
        }
        if (extra.length) setMessages((prev) => [...prev, ...extra]);
      }

      // 後端回傳的情緒訊號 → 桌寵切換情緒動作；聊完心情與好感度也變了，更新一下
      pet.triggerEmotion(data.emotion);
      void relation.refresh();

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
        // 使用者打斷或送出新訊息：保留已經輸出的部分（第 1 則），還沒送出的就不送了
        if (createdSegs.has(0) && !firstSegDone) upsertSeg(0, { content: firstSegText }, false);
        return;
      }
      console.warn('Chat fallback triggered:', err);
      if (streamedText) {
        render(`${streamedText}…（訊號中斷了喵）`, true);
      } else {
        const errorReply = '哈…本喵的神經突觸剛才打結了喵！請再跟我說一次～';
        upsertSeg(0, { content: errorReply }, false);
        triggerSpeak(errorReply);
      }
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
    onResult: (text) => handleSendMessage(text, { immediate: true }),
    onStart: () => {
      markPetInteraction();
      voiceService.stop();
    },
  });
  const [voiceHotkey, setVoiceHotkey] = useState<string | null>(null);

  // 內建音樂播放器：她說話、或主人在語音輸入時，音樂自動轉小聲
  const music = useMusicPlayer({ duck: isTalking || voiceInput.state === 'listening' });
  const [musicOpen, setMusicOpen] = useState(false);

  // Electron 全域熱鍵：就算正在打遊戲（桌寵不在焦點）也能觸發
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onVoiceHotkey) return;
    api.getVoiceHotkey?.().then((label: string | null) => setVoiceHotkey(label));
    return api.onVoiceHotkey(() => voiceInput.toggle());
  }, [voiceInput.toggle]);

  // 置頂模式：off＝一般視窗、normal＝一般置頂、game＝遊戲中也在最上層（預設）
  const [pinMode, setPinMode] = useState<PinMode>(() => {
    try {
      const v = localStorage.getItem(PIN_MODE_KEY);
      return v === 'off' || v === 'normal' || v === 'game' ? v : 'game';
    } catch {
      return 'game';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PIN_MODE_KEY, pinMode);
    } catch {
      // ignore
    }
    (window as any).electronAPI?.setPinMode?.(pinMode);
  }, [pinMode]);

  // 叫出她的全域熱鍵：打開對話框、焦點放到輸入框，可以直接打字
  const [summonHotkey, setSummonHotkey] = useState<string | null>(null);
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onSummon) return;
    api.getSummonHotkey?.().then((label: string | null) => setSummonHotkey(label));
    return api.onSummon(() => {
      markPetInteraction();
      setIsChatOpen(true);
      const focusInput = (tries: number) => {
        const el = document.querySelector('input[data-chat-input]') as HTMLInputElement | null;
        if (el) el.focus();
        else if (tries > 0) setTimeout(() => focusInput(tries - 1), 80);
      };
      setTimeout(() => focusInput(10), 50);
    });
  }, []);

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
    sources: exploreSettings.sources,
    pttBoards: exploreSettings.pttBoards,
    bahamutBoards: exploreSettings.bahamutBoards,
    subreddits: exploreSettings.subreddits,
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
      if (isChatOpenRef.current) {
        // 對話框開著時，頭頂氣泡會被對話框擋住 → 改成直接在對話裡分享（連結可點）
        setMessages((prev) => [
          ...prev,
          {
            id: 'msg_discovery_' + d.id,
            role: 'pet',
            content: `🧭 ${d.bubbleText}\n【${d.sourceLabel}】${d.title}\n🐾 ${d.catReview}\n${d.url}`,
            timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
            isRead: true,
          },
        ]);
      } else {
        setDiscovery(d);
      }
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
    void relation.report('discovery_opened'); // 主人有看她推薦的東西 → 開心、好感 +
  };

  /** 她自己主動說的一句話（Gemini 網頁吐槽、突然想起的事）：冒泡泡、出聲、記進聊天；正在跟她聊天時就不插嘴 */
  const petSays = (data: any) => {
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text || isWaitingRef.current) return;
    setMessages((prev) => [
      ...prev,
      {
        id: 'msg_pet_say_' + Date.now(),
        role: 'pet',
        content: text,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        isRead: true,
      },
    ]);
    triggerSpeak(text);
    if (data?.emotion) pet.triggerEmotion(data.emotion);
  };

  // 後端主動推播（SSE）
  useServerEvents({
    hello: (data) => setExploreStatus({ state: data?.exploring ? 'exploring' : 'idle' }),
    discovery: (data) => handleDiscovery(data as Discovery),
    'explore-status': (data) => setExploreStatus(data as ExploreStatus),
    // 主人在瀏覽器問 Gemini → 她在旁邊偷看，吐槽一句（正在跟她聊天時就不插嘴）
    'gemini-web': (data) => petSays(data),
    // 她自己突然想到要說的話（例如閒置時想起你上次在看的東西）
    'pet-says': (data) => petSays(data),
    busy: (data) => applyBusy(data),
    meal: (data) => {
      if (data?.status === 'eating') setEatingUntil(Number(data.until) || Date.now() + 45 * 60 * 1000);
      else if (data?.status === 'full') setEatingUntil(0);
      else if (data?.status === 'hungry') pet.triggerEmotion('hungry');
    },
    'line-history': (data) => {
      if (Array.isArray(data?.items)) setLineHistory(data.items);
    },
    // 在 LINE 上聊天時她發現的喜好關鍵字 → 一樣記進桌寵的長期記憶
    keywords: (data) => {
      if (!Array.isArray(data)) return;
      for (const kw of data) {
        if (kw?.keyword) memoryDecayService.reinforceKeyword(kw.keyword, kw.category, kw.notes);
      }
    },
  });

  // 冷落偵測：主人超過設定時間（預設 15 分鐘）沒點她、沒跟她聊天 → 自動出門探索
  useIdleExplorer({
    enabled: exploreSettings.enabled,
    idleMinutes: exploreSettings.idleMinutes,
    onIdle: () => requestExplore('idle'),
  });

  // 主動打招呼：開啟桌寵 / 離開回來 / 深夜提醒 / 整點報時（像朋友注意到你來了）
  const lastGreetAtRef = useRef(0);
  const requestGreeting = async (reason: GreetingReason, awayMinutes: number, awaySince: number) => {
    // 主人正在等回覆或在講話時，不要插話
    if (isWaitingRef.current || voiceInput.state !== 'idle') return;
    lastGreetAtRef.current = Date.now();
    try {
      // 主人不在時貓貓自己找到的東西（探索結果的 id 是 disc_時間戳）
      const foundWhileAway = videos
        .filter((v) => v.id.startsWith('disc_') && Number(v.id.slice(5)) >= awaySince)
        .map((v) => ({ title: v.title, sourceLabel: v.sourceLabel || '' }));
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      const res = await fetch('/api/greeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          awayMinutes,
          clientTime: getClientTime(),
          personality,
          discoveries: foundWhileAway,
          lastTopic: lastUserMsg?.content,
          currentActivity: currentActivity ? { title: currentActivity.title } : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      // 主動說話的閘門說先不要（主人不在、剛起床、前面的話還沒回、今天說太多）
      if (data?.skipped) return;
      // 報時一定要報：Gemini 沒回應就用簡單的一句
      const text: string =
        res.ok && data?.text
          ? data.text
          : reason === 'hourly'
            ? `${new Date().getHours()} 點了喵～`
            : '';
      if (!text) return;
      if (isWaitingRef.current) return; // 等回應期間主人開始聊天了 → 不插話

      setMessages((prev) => [
        ...prev,
        {
          id: `msg_greet_${Date.now()}`,
          role: 'pet',
          content: text,
          timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
          isRead: true,
        },
      ]);
      triggerSpeak(text);
      // 早上賴床：抱著枕頭還沒醒（主人一跟她說話就會醒）
      if (typeof data?.asleep === 'boolean') setPetStatus((prev) => ({ ...prev, asleep: data.asleep }));
      if (!data?.asleep) pet.triggerEmotion(data?.emotion || 'happy');
      void relation.refresh(); // 回來打招呼時心情可能因為「被丟下太久」變差了
    } catch (err) {
      console.warn('Greeting error:', err);
    }
  };

  // 整點報時：她在忙（回話中、聽你說話）就晚一點補報；剛跟你打過招呼（2 分鐘內）就不重複
  useHourlyChime({
    enabled: exploreSettings.hourlyChime,
    onChime: () => {
      if (isWaitingRef.current || voiceInput.state !== 'idle') return false;
      if (Date.now() - lastGreetAtRef.current < 2 * 60 * 1000) return true;
      void requestGreeting('hourly', 0, Date.now());
      return true;
    },
  });

  // 事件日記：每累積幾句話、或主人離開電腦時，把對話整理成「發生過的事」
  const diary = useDiaryCompiler(messages, isStreamingOrWaiting);

  useCompanionGreeting({
    greetOnReturn: exploreSettings.greetOnReturn,
    lateNightReminder: exploreSettings.lateNightReminder,
    onGreet: (reason, awayMinutes, awaySince) => requestGreeting(reason, awayMinutes, awaySince),
  });

  // 主人 10 分鐘沒點她、沒跟她聊天 → 趁空檔把對話整理成事件日記（沒有新對話就不會做事）
  useIdleExplorer({
    enabled: true,
    idleMinutes: 10,
    onIdle: () => diary.compileNow(),
  });

  // 5. Ask Twin Cat about a specific discovered video in chat
  const handleAskAboutVideo = (video: DiscoveredVideo) => {
    handleSendMessage(`貓貓，跟我分享一下你剛才在手帳記下的這部《${video.title}》！它在講什麼？`, { immediate: true });
  };

  const handleDeleteVideo = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };
  // Head patting reaction
  // 摸頭反應：語氣跟著人設滑桿（傲嬌 / 毒舌 / 溫柔 / 一般）
  const handlePetHead = () => {
    triggerSpeak(pickPatReaction(personality));
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
      id: 'music',
      label: '音樂',
      icon: <Music2 className="w-5 h-5" />,
      active: musicOpen || music.state.status === 'playing',
      onSelect: () => setMusicOpen((v) => !v),
    },
    {
      id: 'settings',
      label: '設定',
      icon: <Settings2 className="w-5 h-5" />,
      active: settingsOpen,
      onSelect: () => (settingsOpen ? setSettingsOpen(false) : openSettings(settingsTab)),
    },
  ];

  // 沒碰她就躲起來（只剩呆毛）：設定記在 localStorage
  const [autoHideSettings, setAutoHideSettings] = useState<{ enabled: boolean; seconds: number; clock?: boolean }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(AUTO_HIDE_KEY) || 'null');
      if (v && typeof v.enabled === 'boolean' && typeof v.seconds === 'number') return v;
    } catch {
      // ignore
    }
    return { enabled: true, seconds: 5 };
  });
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_HIDE_KEY, JSON.stringify(autoHideSettings));
    } catch {
      // ignore
    }
  }, [autoHideSettings]);

  // 她有事要做（說話、頭上有泡泡、推播、等回覆、聽你說話、被摸頭）或你開著任何面板時 → 一定出來
  const autoHide = useAutoHide({
    enabled: autoHideSettings.enabled,
    delayMs: autoHideSettings.seconds * 1000,
    keepVisible:
      isTalking ||
      Boolean(speechBubbleText) ||
      Boolean(discovery) ||
      isStreamingOrWaiting ||
      voiceInput.state !== 'idle' ||
      pet.state === 'patting' ||
      isChatOpen ||
      settingsOpen ||
      radialMenu.open ||
      activeModal !== 'none',
  });

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
              messages={chatDisplay}
              onSendMessage={(text, media) => handleSendMessage(text, { media })}
              onInterrupt={handleInterrupt}
              chatStyle={chatStyle}
              onToggleChatStyle={() => {}}
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
        autoHide={autoHideSettings}
        onAutoHideChange={setAutoHideSettings}
        preferredModel={preferredModel}
        onPreferredModelChange={setPreferredModel}
        voiceEnabled={voiceEnabled}
        onToggleVoice={() => setVoiceEnabled(!voiceEnabled)}
        voiceHotkey={voiceHotkey}
        pinMode={pinMode}
        onPinModeChange={setPinMode}
        summonHotkey={summonHotkey}
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
        relationship={
          <RelationshipCard
            snapshot={relation.snapshot}
            onNicknameChange={(nickname) => relation.update({ nickname })}
            onRemoveJoke={relation.removeJoke}
            onPatch={(patch) => relation.update(patch)}
          />
        }
      />

      {/* 桌寵本體：固定在右下角的座標點；沒碰她一陣子就往下溜出畫面 */}
      <motion.div
        className={`absolute z-30 right-2 bottom-2 ${autoHide.hidden ? 'pointer-events-none' : ''}`}
        style={{ width: 'var(--pet-w)', height: 'var(--pet-h)' }}
        aria-hidden={autoHide.hidden}
        initial={false}
        animate={autoHide.hidden ? { y: ['0%', '-6%', '118%'] } : { y: '0%' }}
        transition={
          autoHide.hidden
            ? { duration: 0.75, times: [0, 0.25, 1], ease: ['easeOut', 'easeIn'] }
            : { type: 'spring', stiffness: 260, damping: 17 }
        }
      >
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
            void relation.report('pat'); // 摸頭 → 心情變好、好感 +
          }}
          onPatEnd={pet.stopPatting}
          discovery={discovery}
          isExploring={exploreStatus.state === 'exploring'}
          onOpenDiscovery={() => discovery && openDiscovery(discovery)}
          away={busyInfo}
          onCallBack={() => {
            void fetch('/api/busy/end', { method: 'POST', headers: { 'X-Gemini-Pet': '1' } })
              .then((r) => r.json())
              .then(applyBusy)
              .catch(() => {});
          }}
          onDismissDiscovery={() => {
            setDiscovery(null);
            void relation.report('discovery_dismissed'); // 直接關掉 → 有點失落
          }}
        />
      </motion.div>

      {/* 她躲起來時留在角落的呆毛，點一下叫她出來 */}
      <Ahoge visible={autoHide.hidden} onClick={autoHide.wake} />
      <SignClock visible={autoHide.hidden && autoHideSettings.clock !== false} onClick={autoHide.wake} />

      {/* 迷你音樂播放器（立繪左邊） */}
      <MusicPlayer music={music} open={musicOpen} onClose={() => setMusicOpen(false)} />

      {/* 右鍵扇形選單 */}
      <RadialMenu
        open={radialMenu.open}
        center={{ x: radialMenu.x, y: radialMenu.y }}
        items={radialItems}
        // 多了「音樂」共 8 顆按鈕 → 半徑和展開角度加大，按鈕才不會疊在一起
        radius={128}
        spreadDeg={170}
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
