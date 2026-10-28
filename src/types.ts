export interface PersonalityConfig {
  sharpTongue: number; // 0 - 100
  chatty: number;      // 0 - 100
  humorous: number;    // 0 - 100
  tsundere: number;    // 0 - 100
  customPrompt: string;
}

export interface MemoryKeyword {
  id: string;
  keyword: string;
  category: 'preference' | 'habit' | 'game' | 'topic' | 'food' | 'other';
  frequency: number;
  strength: number;      // 0 - 100
  lastMentioned: number; // timestamp
  lastDecayAt?: number;  // 上次衰減結算到的時間點，避免重複扣分
  isPermanent: boolean;  // strength >= 80 or frequency >= 4
  notes?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'pet';
  content: string;
  timestamp: string;
  isRead?: boolean;
  isStreaming?: boolean; // AI 回覆還在逐字輸出中
}

export interface DiscoveredVideo {
  id: string;
  title: string;
  category: 'gaming' | 'animation' | 'funny' | 'tech' | 'music';
  summary: string;
  catReview: string;
  tag: string;
  searchKeyword: string;
  discoveredAt: string;
}

export interface ScreenActivity {
  category: 'gaming' | 'video' | 'chatting' | 'coding' | 'work' | 'idle';
  appContext?: 'gaming' | 'gemini_web' | 'line' | 'other'; // 決定桌寵的運作模式
  title: string;
  observation: string;
  catComment: string;
  timestamp: string;
  screenshotUrl?: string;
  capturedAt?: number; // 截圖時間（ms），後端用來判斷截圖是否過期
  usedModel?: string;
}

export type ChatStyle = 'line' | 'gemini';

export type GeminiModelOption =
  | 'auto'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.8-flash'
  | 'gemini-4-argon'
  | 'gemini-3-flash-preview'
  | 'gemini-3.5-flash'
  | 'gemini-3.1-flash-lite';

