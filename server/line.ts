/**
 * LINE 連動（LINE 官方帳號 + Messaging API）：傳輸、驗證、綁定、對話紀錄、推播額度。
 *
 *  - 只跟「綁定的主人」私聊：第一次用 LINE 傳「綁定 6 位數字」（數字顯示在後端視窗）
 *  - 回覆（reply）免費不限量；主動推播（push）會算進每月額度 → 這裡有每日 / 每月上限保護
 *  - 主人不在電腦前時她找到的東西先排隊，等主人下次在 LINE 說話時順便一起回（回覆免費）
 *
 * 資料存在 data/line/state.json（data 資料夾不會被更新包帶走）。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface LineConfig {
  secret: string;
  token: string;
}

export function lineConfig(): LineConfig | null {
  const secret = (process.env.LINE_CHANNEL_SECRET || '').trim();
  const token = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  return secret && token ? { secret, token } : null;
}

/** LINE 送來的 webhook 一定帶簽章：用 Channel secret 驗證，假的請求一律拒絕 */
export function verifySignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* ───────────── Messaging API ───────────── */

export type LineMessage =
  | { type: 'text'; text: string }
  // 圖片：兩個網址都要 https；原圖 10MB 內、預覽圖 1MB 內，只吃 JPG / PNG
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

async function callApi(token: string, url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err: any = new Error(`LINE API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
}

/** LINE 一次最多 5 則、每則最多 5000 字 */
const fit = (messages: LineMessage[]) =>
  messages
    .filter((m) => m.type !== 'text' || m.text.trim())
    .slice(0, 5)
    .map((m) => (m.type === 'text' ? { ...m, text: m.text.slice(0, 4900) } : m));

export const lineApi = {
  reply: (token: string, replyToken: string, messages: LineMessage[]) =>
    callApi(token, 'https://api.line.me/v2/bot/message/reply', { replyToken, messages: fit(messages) }),
  push: (token: string, to: string, messages: LineMessage[]) =>
    callApi(token, 'https://api.line.me/v2/bot/message/push', { to, messages: fit(messages) }),
  /** 「輸入中…」動畫（私聊才有，免費） */
  loading: (token: string, chatId: string, seconds = 20) =>
    callApi(token, 'https://api.line.me/v2/bot/chat/loading/start', { chatId, loadingSeconds: seconds }),
  /** 下載主人傳來的圖片 */
  async content(token: string, messageId: string): Promise<{ data: Buffer; mime: string }> {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`下載圖片失敗（HTTP ${res.status}）`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
  },
};

/* ───────────── 狀態儲存 ───────────── */

export interface LineHistoryItem {
  role: 'user' | 'pet';
  content: string;
  at: number;
}

export interface PendingShare {
  id: string;
  title: string;
  url: string;
  sourceLabel: string;
  bubbleText: string;
  at: number;
}

interface LineState {
  ownerId: string | null;
  pairCode: string;
  history: LineHistoryItem[];
  pending: PendingShare[];
  push: { month: string; count: number; day: string; dayCount: number; monthBlocked?: boolean };
  lastCompiledAt: number;
  keywordQueue: unknown[];
  calendarReminded: Record<string, number>;
  desktopContext: {
    personality?: any;
    permanentMemories?: any[];
    activeKeywords?: any[];
    preferredModel?: string;
    /** 主人最近在電腦上跟她聊的幾句（LINE 回覆時一起參考） */
    recentDesktop?: Array<{ role: 'user' | 'pet'; content: string; at: number }>;
    at?: number;
  };
}

const HISTORY_MAX = 60;
const PENDING_MAX = 5;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dayKey = (d = new Date()) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;

export function createLineStore(dataDir: string) {
  const dir = path.join(dataDir, 'line');
  const file = path.join(dir, 'state.json');
  const fresh = (): LineState => ({
    ownerId: null,
    pairCode: String(crypto.randomInt(100000, 1000000)),
    history: [],
    pending: [],
    push: { month: monthKey(), count: 0, day: dayKey(), dayCount: 0 },
    lastCompiledAt: 0,
    keywordQueue: [],
    calendarReminded: {},
    desktopContext: {},
  });

  let state: LineState = fresh();
  let loaded = false;
  try {
    if (fs.existsSync(file)) {
      state = { ...fresh(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      loaded = true;
    }
  } catch (err: any) {
    console.warn('[LINE] 讀取 data/line/state.json 失敗，改用新的狀態：', err?.message);
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, file);
      } catch (err: any) {
        console.warn('[LINE] 儲存狀態失敗：', err?.message);
      }
    }, 300);
  };

  // 第一次啟動就把綁定碼存起來：重開後端時綁定碼不會變
  if (!loaded) save();

  const rollPush = () => {
    const m = monthKey();
    const d = dayKey();
    if (state.push.month !== m) state.push = { month: m, count: 0, day: d, dayCount: 0 };
    if (state.push.day !== d) state.push = { ...state.push, day: d, dayCount: 0 };
  };

  return {
    owner: () => state.ownerId,
    pairCode: () => state.pairCode,
    setOwner(id: string) {
      state.ownerId = id;
      save();
    },

    history: () => state.history,
    appendHistory(role: LineHistoryItem['role'], content: string) {
      const text = content.trim();
      if (!text) return;
      state.history.push({ role, content: text.slice(0, 2000), at: Date.now() });
      if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);
      save();
    },

    /** 主人不在電腦前時她找到的東西：排隊等下次回覆時順便講 */
    addPending(p: Omit<PendingShare, 'at'>) {
      state.pending = state.pending.filter((x) => x.url !== p.url && Date.now() - x.at < PENDING_TTL_MS);
      state.pending.push({ ...p, at: Date.now() });
      if (state.pending.length > PENDING_MAX) state.pending.splice(0, state.pending.length - PENDING_MAX);
      save();
    },
    takePending(max: number): PendingShare[] {
      state.pending = state.pending.filter((x) => Date.now() - x.at < PENDING_TTL_MS);
      if (max <= 0 || state.pending.length === 0) return [];
      const taken = state.pending.splice(-max); // 最新的優先
      save();
      return taken;
    },

    /** 推播額度：daily = false 時只檢查每月上限（行事曆提醒用） */
    canPush(opts: { daily: boolean }): boolean {
      rollPush();
      const monthly = Number(process.env.LINE_PUSH_MONTHLY_LIMIT) || 180;
      const daily = Number(process.env.LINE_PUSH_DAILY_LIMIT) || 5;
      if (state.push.monthBlocked) return false;
      if (state.push.count >= monthly) return false;
      return !opts.daily || state.push.dayCount < daily;
    },
    notePush() {
      rollPush();
      state.push.count++;
      state.push.dayCount++;
      save();
    },
    /** LINE 回「這個月額度用完了」→ 這個月不再推播 */
    blockPushThisMonth() {
      rollPush();
      state.push.monthBlocked = true;
      save();
    },
    pushUsage: () => {
      rollPush();
      return { month: state.push.count, today: state.push.dayCount };
    },

    lastCompiledAt: () => state.lastCompiledAt,
    setLastCompiledAt(ms: number) {
      state.lastCompiledAt = ms;
      save();
    },

    /** 在 LINE 聊天時偵測到的喜好關鍵字：等桌寵連上時交給它記住 */
    queueKeywords(list: unknown[]) {
      state.keywordQueue.push(...list);
      state.keywordQueue = state.keywordQueue.slice(-50);
      save();
    },
    takeKeywords(): unknown[] {
      const out = state.keywordQueue;
      if (!out.length) return [];
      state.keywordQueue = [];
      save();
      return out;
    },

    calendarReminded: (key: string) => Boolean(state.calendarReminded[key]),
    markCalendarReminded(keys: string[]) {
      const now = Date.now();
      for (const k of keys) state.calendarReminded[k] = now;
      for (const [k, at] of Object.entries(state.calendarReminded)) if (now - at > 7 * 86_400_000) delete state.calendarReminded[k];
      save();
    },

    /** 桌寵最近一次送來的個性設定、長期記憶（LINE 聊天時沿用，讓她在 LINE 上也是同一個她） */
    desktopContext: () => state.desktopContext,
    setDesktopContext(ctx: LineState['desktopContext']) {
      state.desktopContext = { ...ctx, at: Date.now() };
      save();
    },
  };
}

export type LineStore = ReturnType<typeof createLineStore>;
