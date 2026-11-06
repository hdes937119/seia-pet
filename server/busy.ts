/**
 * 她在忙（沉浸感）：主人下班在家的時候，她偶爾會去做自己的事——洗澡、出門買宵夜、晾衣服、跟鎮上的人講電話……
 * 有一個倒數計時，期間她不在（桌寵變成一張「不在」的小卡）；主人傳的訊息她回來才看到，回來後一次回覆。
 *
 *  - 只在主人「下班」時（不在上班時段）、她醒著、沒有在值夜時才會發生。
 *  - 自動：每 15 分鐘擲一次骰子；主人 3 分鐘內有在跟她聊天就不去（不會聊到一半跑掉）；
 *    每天最多 BUSY_PER_DAY 次（預設 2）。設定面板可以關掉自動，也可以手動叫她去。
 *  - 每種事情有自己的時段和長度（買宵夜只在晚上、洗澡 20～35 分鐘…）。
 *
 * 存在 data/world/busy.json。
 */
import fs from 'fs';
import path from 'path';

export interface BusyActivity {
  id: string;
  label: string;
  emoji: string;
  /** 分鐘（最短、最長） */
  minutes: [number, number];
  /** 可以發生的時段（小時，可跨午夜，例如 [21, 2]） */
  hours: [number, number];
  /** 出發時說的話（{min} 會換成分鐘數） */
  leave: string[];
  /** 不在時，主人傳訊息會看到的小字 */
  awayNote: string;
  weight: number;
}

export const BUSY_ACTIVITIES: BusyActivity[] = [
  {
    id: 'bath',
    label: '洗澡',
    emoji: '🛁',
    minutes: [20, 35],
    hours: [19, 1],
    leave: ['本喵要去洗澡囉～大概 {min} 分鐘，不准偷看喵！', '洗香香時間到！{min} 分鐘後回來喵～'],
    awayNote: '浴室傳來水聲…她回來就會看到你的訊息',
    weight: 3,
  },
  {
    id: 'snack-run',
    label: '出門買宵夜',
    emoji: '🏪',
    minutes: [15, 30],
    hours: [21, 2],
    leave: ['肚子餓了，本喵去便利商店買個宵夜！{min} 分鐘左右回來，要幫你帶什麼嗎？', '我出門買宵夜喵～大概 {min} 分鐘！'],
    awayNote: '她出門買宵夜了，回來才會看手機',
    weight: 2,
  },
  {
    id: 'laundry',
    label: '晾衣服',
    emoji: '👕',
    minutes: [8, 15],
    hours: [18, 23],
    leave: ['洗衣機叫了，我去晾一下衣服，{min} 分鐘就好喵！'],
    awayNote: '她在陽台晾衣服',
    weight: 2,
  },
  {
    id: 'phone',
    label: '跟鎮上的人講電話',
    emoji: '📞',
    minutes: [10, 25],
    hours: [18, 23],
    leave: ['觀測站那邊打電話來了，我去接一下喵，大概 {min} 分鐘！'],
    awayNote: '她在講電話，暫時沒空看訊息',
    weight: 1,
  },
  {
    id: 'report',
    label: '寫觀測報告',
    emoji: '📝',
    minutes: [20, 40],
    hours: [18, 24],
    leave: ['今天的觀測報告還沒寫完…本喵專心寫個 {min} 分鐘，先不要吵我喔！'],
    awayNote: '她在專心寫觀測報告',
    weight: 1,
  },
  {
    id: 'hair',
    label: '吹頭髮',
    emoji: '💨',
    minutes: [8, 12],
    hours: [19, 1],
    leave: ['頭髮還濕濕的，我去吹一下，{min} 分鐘喵～'],
    awayNote: '吹風機的聲音好大，她聽不到',
    weight: 1,
  },
];

export interface BusyState {
  current: null | {
    activity: string;
    label: string;
    emoji: string;
    startAt: number;
    endAt: number;
    awayNote: string;
    manual: boolean;
  };
  /** 她不在時主人傳的訊息 */
  missed: Array<{ text: string; at: number }>;
  /** 最近做完的（給聊天提示詞：「你剛剛去洗澡了」） */
  last: null | { label: string; startAt: number; endAt: number };
  history: Array<{ date: string; activity: string; startAt: number; manual: boolean }>;
  autoEnabled: boolean;
}

export interface BusyDeps {
  /** 主人現在是不是下班在家（不在上班時段）、她醒著、沒有在值夜 */
  masterOffWork: (now: number) => boolean;
  /** 主人最後一次跟她聊天的時間 */
  lastChatAt: () => number;
  log?: (m: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const inHours = (h: number, [a, b]: [number, number]) => (a <= b ? h >= a && h < b : h >= a || h < b);
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

export function createBusy(dataDir: string, deps: BusyDeps) {
  const file = path.join(dataDir, 'world', 'busy.json');
  const log = deps.log || console.log;
  let st: BusyState = { current: null, missed: [], last: null, history: [], autoEnabled: true };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      st.history = st.history.slice(-60);
      st.missed = st.missed.slice(-20);
      fs.writeFileSync(file, JSON.stringify(st, null, 2));
    } catch (err: any) {
      log(`[忙碌] 儲存失敗：${err?.message}`);
    }
  };
  const perDay = () => {
    const v = Number(process.env.BUSY_PER_DAY);
    return Number.isFinite(v) && v >= 0 ? v : 2;
  };
  const todayCount = (now = Date.now()) => st.history.filter((h) => h.date === dayKey(now) && !h.manual).length;

  function isBusy(now = Date.now()) {
    return !!st.current && now < st.current.endAt;
  }

  /** 選一件現在可以做的事 */
  function pick(now: number, id?: string): BusyActivity | null {
    const h = new Date(now).getHours();
    if (id) return BUSY_ACTIVITIES.find((a) => a.id === id) || null;
    const pool = BUSY_ACTIVITIES.filter((a) => inHours(h, a.hours));
    if (!pool.length) return null;
    // 剛洗完澡比較會去吹頭髮；今天做過的事比較不會再做
    const doneToday = new Set(st.history.filter((x) => x.date === dayKey(now)).map((x) => x.activity));
    const justBathed = st.last && /洗澡/.test(st.last.label) && now - st.last.endAt < 15 * 60 * 1000;
    const weights = pool.map((a) => (a.id === 'hair' && justBathed ? 8 : doneToday.has(a.id) ? a.weight * 0.2 : a.id === 'hair' ? 0 : a.weight));
    const total = weights.reduce((x, y) => x + y, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /** 出發（回傳出發時說的話）；manual = 主人按的 */
  function start(opts: { activity?: string; minutes?: number; manual?: boolean } = {}, now = Date.now()) {
    if (isBusy(now)) return null;
    const a = pick(now, opts.activity);
    if (!a) return null;
    const min = Math.max(1, Math.min(120, Math.round(opts.minutes || rand(a.minutes[0], a.minutes[1]))));
    st.current = { activity: a.id, label: a.label, emoji: a.emoji, startAt: now, endAt: now + min * 60 * 1000, awayNote: a.awayNote, manual: !!opts.manual };
    st.missed = [];
    st.history.push({ date: dayKey(now), activity: a.id, startAt: now, manual: !!opts.manual });
    save();
    log(`[忙碌] 她去${a.label}了（${min} 分鐘）`);
    const line = a.leave[Math.floor(Math.random() * a.leave.length)].replace('{min}', String(min));
    return { line, current: st.current };
  }

  /** 自動：該不該去忙（每 15 分鐘問一次） */
  function shouldAutoStart(now = Date.now()) {
    if (!st.autoEnabled || isBusy(now)) return false;
    if (todayCount(now) >= perDay()) return false;
    if (!deps.masterOffWork(now)) return false;
    if (now - deps.lastChatAt() < 3 * 60 * 1000) return false; // 正在聊天，不跑掉
    // 上一件做完 40 分鐘內不再去（剛洗完澡去吹頭髮例外）
    const justBathed = st.last && /洗澡/.test(st.last.label) && now - st.last.endAt < 15 * 60 * 1000;
    if (st.last && now - st.last.endAt < 40 * 60 * 1000 && !justBathed) return false;
    return Math.random() < (justBathed ? 0.6 : 0.12);
  }

  /** 主人在她不在時傳了訊息 */
  function noteMissed(text: string, now = Date.now()) {
    st.missed.push({ text: String(text || '').slice(0, 300), at: now });
    save();
  }

  /** 時間到了 → 回來（回傳這次做了什麼、錯過的訊息）；還沒到回傳 null。force = 提早回來 */
  function finishIfDue(now = Date.now(), force = false) {
    const c = st.current;
    if (!c || (!force && now < c.endAt)) return null;
    const missed = st.missed;
    st.last = { label: c.label, startAt: c.startAt, endAt: Math.min(now, c.endAt) };
    st.current = null;
    st.missed = [];
    save();
    log(`[忙碌] ${c.label}完回來了${missed.length ? `（不在時主人傳了 ${missed.length} 則）` : ''}`);
    return { activity: c, missed };
  }

  function setAutoEnabled(on: boolean) {
    st.autoEnabled = on;
    save();
  }

  const hm = (ms: number) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** 給聊天提示詞：剛剛去做了什麼（回來 40 分鐘內） */
  function describeForChat(now = Date.now()): string {
    if (isBusy(now) && st.current) return `【你現在正在${st.current.label}】（${hm(st.current.startAt)} 開始，預計 ${hm(st.current.endAt)} 回來）`;
    if (st.last && now - st.last.endAt < 40 * 60 * 1000) return `【你剛剛去${st.last.label}了】（${hm(st.last.startAt)}～${hm(st.last.endAt)}），剛回來不久。`;
    return '';
  }

  function snapshot(now = Date.now()) {
    return {
      busy: isBusy(now),
      current: isBusy(now) ? st.current : null,
      remainingSec: isBusy(now) && st.current ? Math.ceil((st.current.endAt - now) / 1000) : 0,
      missedCount: st.missed.length,
      autoEnabled: st.autoEnabled,
      perDay: perDay(),
      today: todayCount(now),
      activities: BUSY_ACTIVITIES.map((a) => ({ id: a.id, label: a.label, emoji: a.emoji })),
    };
  }

  return { isBusy, start, shouldAutoStart, noteMissed, finishIfDue, setAutoEnabled, describeForChat, snapshot };
}

export type Busy = ReturnType<typeof createBusy>;
