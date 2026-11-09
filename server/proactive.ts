/**
 * 主動說話的統一閘門（借 astrbot private_companion 的「主動候選生命周期」）。
 *
 * 西雅會主動開口的地方很多：打招呼、整點報時、Gemini 網頁吐槽、寂寞搭話、突然想問的事、閒逛推薦、
 * 值夜道別、加班詢問……以前各自有各自的冷卻，同時觸發就會很吵。現在每一句主動的話都先問這個閘門：
 *
 *  優先度：
 *    high（打招呼、值夜道別、加班詢問）→ 只看勿擾，其他規則都不擋
 *    scheduled（整點報時：主人自己打開的功能）→ 只看「主人在不在」和「起床寬限期」
 *    medium（Gemini 網頁吐槽、寂寞搭話）、low（突然想問、閒逛推薦）→ 下面的規則都要過
 *  規則：
 *    1. 主人不在電腦前（閒置 10 分鐘以上）→ 不對空房間說話（medium／low）
 *    2. 起床寬限期：早上第一次見面後 20 分鐘內，只讓 high 說話（讓主人先清醒）
 *    3. 兩句主動的話至少間隔 8 分鐘（主人上一句還沒回 → 間隔加倍）
 *    4. 主人連續 2 句主動的話都沒回 → medium／low 先停，等主人開口
 *    5. 每天 medium＋low 最多 14 句（.env 的 PROACTIVE_DAILY_MAX 可改）
 *
 * 記在 data/world/proactive.json（每天的數量、最近的紀錄、被擋的原因，方便除錯）。
 */
import fs from 'fs';
import path from 'path';

export type ProactiveKind =
  | 'greeting'
  | 'night-shift'
  | 'overtime'
  | 'gemini-web'
  | 'nudge'
  | 'followup'
  | 'hourly'
  | 'curiosity'
  | 'discovery';

const PRIORITY: Record<ProactiveKind, 'high' | 'scheduled' | 'medium' | 'low'> = {
  greeting: 'high',
  'night-shift': 'high',
  overtime: 'high',
  'gemini-web': 'medium',
  nudge: 'medium',
  followup: 'medium',
  hourly: 'scheduled',
  curiosity: 'low',
  discovery: 'low',
};

const MIN = 60 * 1000;
const MIN_GAP_MS = 8 * MIN;
const WAKE_GRACE_MS = 20 * MIN;
const AWAY_MS = 10 * MIN;
const UNANSWERED_STOP = 2;
const SCREEN_AFTER_MASTER_MS = 1 * MIN;
const SCREEN_MIN_GAP_MS = 4 * MIN;

interface ProactiveState {
  date: string;
  count: number;
  lastAt: number;
  /** 主人上次開口之後，她主動說了幾句 */
  unanswered: number;
  lastMasterAt: number;
  /** 上一次自動螢幕吐槽的時間 */
  lastScreenAt?: number;
  /** 11/10：螢幕吐槽自己的「主人還沒回」（不跟報時、通知共用；只用來放慢，不會整個停） */
  screenUnanswered?: number;
  log: Array<{ at: number; kind: ProactiveKind; ok: boolean; reason?: string }>;
}

export interface ProactiveDeps {
  /** 主人上一次在電腦前操作的時間 */
  lastActiveAt: () => number;
  /** 今天早上第一次見面的時間（沒有就 0） */
  wokeAt: () => number;
  /** 她在忙（洗澡、出門…）→ 什麼都先不說 */
  isBusy?: () => boolean;
  log?: (m: string) => void;
}

const dateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function createProactive(dataDir: string, deps: ProactiveDeps) {
  const file = path.join(dataDir, 'world', 'proactive.json');
  let st: ProactiveState = { date: '', count: 0, lastAt: 0, unanswered: 0, lastMasterAt: Date.now(), log: [] };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(st, null, 2));
      } catch {
        // 不影響運作
      }
    }, 1000);
  };
  const dailyMax = () => Number(process.env.PROACTIVE_DAILY_MAX) || 14;

  function roll(now: number) {
    if (st.date !== dateKey(now)) {
      st.date = dateKey(now);
      st.count = 0;
    }
  }

  /** 判斷能不能說（不會記錄成「說了」） */
  function check(kind: ProactiveKind, now = Date.now()): { ok: boolean; reason?: string } {
    roll(now);
    const pri = PRIORITY[kind];
    if (deps.isBusy?.()) return { ok: false, reason: '她正在忙' };
    if (pri === 'high') return { ok: true };
    if (now - deps.lastActiveAt() > AWAY_MS) return { ok: false, reason: '主人不在電腦前' };
    const woke = deps.wokeAt();
    if (woke && now - woke < WAKE_GRACE_MS) return { ok: false, reason: '起床寬限期' };
    // 整點報時：前面主動說的話主人都還沒回，就不要一直報（以前會半夜每小時叫一次去睡）
    if (pri === 'scheduled') return st.unanswered >= UNANSWERED_STOP ? { ok: false, reason: `主人還沒回前面 ${st.unanswered} 句` } : { ok: true };
    if (st.unanswered >= UNANSWERED_STOP) return { ok: false, reason: `主人還沒回前面 ${st.unanswered} 句` };
    const gap = st.unanswered > 0 ? MIN_GAP_MS * 2 : MIN_GAP_MS;
    if (now - st.lastAt < gap) return { ok: false, reason: '剛剛才說過話' };
    if (st.count >= dailyMax()) return { ok: false, reason: `今天已經主動說了 ${st.count} 句` };
    return { ok: true };
  }

  /** 想說話：通過就直接算「說了」（回傳 true），沒通過記下原因 */
  function request(kind: ProactiveKind, now = Date.now()): boolean {
    const r = check(kind, now);
    st.log = [...st.log, { at: now, kind, ok: r.ok, reason: r.reason }].slice(-40);
    if (!r.ok) {
      deps.log?.(`[主動] 先不說（${kind}）：${r.reason}`);
      save();
      return false;
    }
    if (PRIORITY[kind] === 'medium' || PRIORITY[kind] === 'low') {
      st.count++;
      st.lastAt = now;
      st.unanswered++;
    } else if (PRIORITY[kind] === 'high') {
      st.lastAt = now;
      st.unanswered++;
    } else if (PRIORITY[kind] === 'scheduled') {
      st.unanswered++;
    }
    save();
    return true;
  }

  /** 主人開口了（聊天或 LINE）→ 主動話的「未回」歸零 */
  function masterSpoke(now = Date.now()) {
    st.unanswered = 0;
    st.screenUnanswered = 0;
    st.lastMasterAt = now;
    save();
  }

  function snapshot() {
    return { ...st, dailyMax: dailyMax() };
  }

  /**
   * 螢幕搭話（主人自己打開的螢幕偵測）用的輕量檢查：頻率由前端的冷卻時間管，不算進每天的主動句數，
   * 這裡只擋「她在忙」和「主人 1 分鐘內剛講過話」（剛聊完就不要插嘴吐槽畫面）。
   */
  // live＝實況模式（主人開的、只在遊戲畫面）：不等主人回應，頻率交給前端的冷卻時間
  function screenCheck(now = Date.now(), live = false, cooldownSec = 0): { ok: boolean; reason?: string } {
    if (deps.isBusy?.()) return { ok: false, reason: '她正在忙' };
    if (now - st.lastMasterAt < SCREEN_AFTER_MASTER_MS) return { ok: false, reason: '主人剛剛才跟她說過話' };
    if (live) return { ok: true };
    // 11/10：間隔跟著主人在面板設的冷卻（以前固定 4 分鐘，面板寫 2 分鐘其實是 4 分鐘）；
    // 主人一直沒回就逐漸放慢（2 句後 ×2、4 句後 ×4），不會像以前 2 句就整個停
    const base = cooldownSec > 0 ? Math.max(30_000, cooldownSec * 1000 * 0.8) : SCREEN_MIN_GAP_MS;
    const n = st.screenUnanswered || 0;
    const mul = n >= 4 ? 4 : n >= 2 ? 2 : 1;
    if (now - (st.lastScreenAt || 0) < base * mul) return { ok: false, reason: n >= 2 ? `前面 ${n} 句吐槽主人都還沒回，放慢一點` : '剛剛才吐槽過畫面' };
    return { ok: true };
  }

  /** 自動螢幕吐槽真的說出口了：也算一句「主人還沒回」 */
  function screenSaid(now = Date.now(), live = false) {
    st.lastScreenAt = now;
    // 實況模式的吐槽是旁白，不算「主人還沒回」；一般吐槽只算進自己的計數（不再卡住報時、通知，也不被它們卡住）
    if (!live) st.screenUnanswered = (st.screenUnanswered || 0) + 1;
    save();
  }

  return { check, request, masterSpoke, snapshot, screenCheck, screenSaid };
}

export type Proactive = ReturnType<typeof createProactive>;
