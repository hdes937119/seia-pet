/**
 * 長時間心情 + 好感度（關係）。
 *
 *  心情 mood（-100 ~ +100）：以「小時」計的情緒，會慢慢回到平常（半衰期約 3 小時）
 *  好感度 affection（0 ~ 1000）：以「天、週」累積的熟悉程度，幾乎不會掉（很久沒見面才會微降）
 *
 * 兩者都會寫進聊天 / 打招呼 / 螢幕吐槽的提示詞，影響她說話的語氣與親近程度。
 * 存在 data/memories/relationship.json。
 */
import fs from 'fs';
import path from 'path';

export interface InsideJoke {
  id: string;
  text: string; // 例如「主人打第三章王打了二十次」
  createdAt: number;
}

interface DailyCounters {
  day: string; // YYYY-MM-DD
  chat: number;
  pat: number;
  discovery: number;
}

export interface RelationshipState {
  mood: number;
  moodUpdatedAt: number;
  moodReason: string; // 最近一次心情變化的原因，給模型參考
  affection: number;
  firstMetAt: number;
  lastSeenDay: string; // 最近一次互動的日期
  streakDays: number; // 連續幾天都有來見她
  nickname: string; // 她對主人的暱稱（好朋友階段之後）
  insideJokes: InsideJoke[];
  today: DailyCounters;
}

export type RelationshipEvent =
  | { type: 'chat'; emotion?: string | null }
  | { type: 'pat' }
  | { type: 'discovery_opened' }
  | { type: 'discovery_dismissed' }
  | { type: 'return'; awayMinutes: number };

export const LEVELS = [
  { min: 0, name: '初識', hint: '還在互相認識，有點客氣、帶點好奇' },
  { min: 100, name: '熟人', hint: '已經熟起來了，可以自然地開玩笑' },
  { min: 300, name: '好朋友', hint: '很要好的朋友，講話隨性，會用暱稱、會提起你們的共同梗' },
  { min: 600, name: '摯友', hint: '無話不談的摯友，很懂主人，會主動撒嬌或吐露心事' },
  { min: 900, name: '最重要的人', hint: '主人是你最重要的人，信任又依賴，但依然保有自己的個性' },
] as const;

const MOOD_BASELINE = 10; // 沒事時的心情：平常偏好
const MOOD_HALF_LIFE_MS = 3 * 60 * 60 * 1000;
const MAX_JOKES = 20;
// 每天的好感度上限，避免狂刷
const DAILY_CAP = { chat: 30, pat: 10, discovery: 5 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function localDay(ms = Date.now()): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
}

function freshState(): RelationshipState {
  const now = Date.now();
  return {
    mood: MOOD_BASELINE,
    moodUpdatedAt: now,
    moodReason: '',
    affection: 0,
    firstMetAt: now,
    lastSeenDay: localDay(now),
    streakDays: 1,
    nickname: '',
    insideJokes: [],
    today: { day: localDay(now), chat: 0, pat: 0, discovery: 0 },
  };
}

export function levelOf(affection: number) {
  let idx = 0;
  LEVELS.forEach((l, i) => {
    if (affection >= l.min) idx = i;
  });
  const next = LEVELS[idx + 1];
  return { index: idx, ...LEVELS[idx], nextAt: next ? next.min : null };
}

export function moodLabel(mood: number): { label: string; emoji: string; tone: string } {
  if (mood >= 60) return { label: '超開心', emoji: '🥰', tone: '心情超好，語氣特別雀躍黏人' };
  if (mood >= 25) return { label: '心情不錯', emoji: '😊', tone: '心情不錯，語氣輕快' };
  if (mood > -25) return { label: '平常', emoji: '🙂', tone: '心情平常' };
  if (mood > -60) return { label: '有點悶', emoji: '😕', tone: '有點悶悶不樂或寂寞，語氣帶點委屈或小抱怨（但還是在乎主人）' };
  return { label: '鬧彆扭中', emoji: '😤', tone: '在鬧彆扭，語氣比較冷淡、愛理不理，需要主人哄一下才會變好' };
}

export function createRelationship(dataDir: string) {
  const dir = path.join(dataDir, 'memories');
  const file = path.join(dir, 'relationship.json');
  let cache: RelationshipState | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  function load(): RelationshipState {
    if (cache) return cache;
    try {
      cache = { ...freshState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      cache = freshState();
    }
    return cache!;
  }

  function save(): Promise<void> {
    const snapshot = JSON.stringify(load(), null, 2);
    writeChain = writeChain
      .then(async () => {
        await fs.promises.mkdir(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, snapshot, 'utf8');
        await fs.promises.rename(tmp, file);
      })
      .catch((err) => console.error('[關係] 儲存失敗:', err?.message));
    return writeChain;
  }

  /** 心情隨時間回到平常（指數衰減），並處理換日：連續天數、每日上限、太久沒見的好感微降 */
  function settle(now = Date.now()): RelationshipState {
    const s = load();
    const elapsed = now - s.moodUpdatedAt;
    if (elapsed > 0) {
      const k = Math.pow(0.5, elapsed / MOOD_HALF_LIFE_MS);
      s.mood = MOOD_BASELINE + (s.mood - MOOD_BASELINE) * k;
      s.moodUpdatedAt = now;
    }
    const today = localDay(now);
    if (s.today.day !== today) s.today = { day: today, chat: 0, pat: 0, discovery: 0 };
    return s;
  }

  function changeMood(delta: number, reason: string) {
    const s = load();
    s.mood = clamp(s.mood + delta, -100, 100);
    if (reason && Math.abs(delta) >= 3) s.moodReason = reason;
  }

  function addAffection(kind: keyof typeof DAILY_CAP | 'bonus', amount: number) {
    const s = load();
    if (kind !== 'bonus') {
      if (s.today[kind] >= DAILY_CAP[kind]) return;
      s.today[kind] += 1;
    }
    s.affection = clamp(s.affection + amount, 0, 1000);
  }

  /** 每天第一次互動：連續天數加成；太久沒見 → 好感微降 */
  function touchDay(now = Date.now()) {
    const s = load();
    const today = localDay(now);
    if (s.lastSeenDay === today) return;
    const gap = daysBetween(s.lastSeenDay, today);
    if (gap === 1) {
      s.streakDays += 1;
      addAffection('bonus', Math.min(10, 3 + s.streakDays)); // 連續來見她越多天，加越多
    } else if (gap > 1) {
      s.streakDays = 1;
      if (gap > 7) s.affection = clamp(s.affection - Math.min(60, (gap - 7) * 5), 0, 1000);
      addAffection('bonus', 3);
    }
    s.lastSeenDay = today;
  }

  function apply(ev: RelationshipEvent, now = Date.now()): RelationshipState {
    settle(now);
    switch (ev.type) {
      case 'chat': {
        touchDay(now);
        addAffection('chat', 2);
        changeMood(3, '主人來陪她聊天');
        const e = ev.emotion;
        if (e === 'happy' || e === 'loving' || e === 'proud') changeMood(4, '聊得很開心');
        else if (e === 'sad') changeMood(-6, '聊到難過的事');
        else if (e === 'angry') changeMood(-5, '被主人惹得有點生氣');
        break;
      }
      case 'pat':
        touchDay(now);
        addAffection('pat', 3);
        changeMood(6, '被主人摸頭');
        break;
      case 'discovery_opened':
        touchDay(now);
        addAffection('discovery', 4);
        changeMood(8, '主人有看她推薦的東西');
        break;
      case 'discovery_dismissed':
        changeMood(-3, '推薦的東西被主人直接關掉');
        break;
      case 'return': {
        touchDay(now);
        const hours = ev.awayMinutes / 60;
        // 被丟下越久越寂寞：幾分鐘沒差，幾小時開始悶，一天以上會鬧彆扭（最多 -45）
        if (hours >= 2) changeMood(-Math.min(45, Math.round(hours * 2.5)), `主人丟下她 ${hours >= 24 ? `${Math.round(hours / 24)} 天` : `${Math.round(hours)} 小時`}`);
        break;
      }
    }
    void save();
    return load();
  }

  /** 給提示詞用的「心情 + 關係」段落 */
  function describe(now = Date.now()): string {
    const s = settle(now);
    const lv = levelOf(s.affection);
    const m = moodLabel(s.mood);
    const days = Math.max(1, Math.round((now - s.firstMetAt) / 86400000) + 1);
    const lines = [
      `【你現在的心情】：${m.label}${s.moodReason ? `（因為${s.moodReason}）` : ''}。${m.tone}。讓語氣自然帶出這個心情，不要直接說出數字或「我的心情是…」。`,
      `【你們的關係】：${lv.name}（認識第 ${days} 天，連續 ${s.streakDays} 天見面）。${lv.hint}。`,
    ];
    if (s.nickname && lv.index >= 2) lines.push(`你平常叫主人「${s.nickname}」（不用每句都叫）。`);
    if (lv.index >= 2 && s.insideJokes.length > 0) {
      const picks = [...s.insideJokes].sort(() => Math.random() - 0.5).slice(0, 2);
      lines.push(`【你們之間的梗（偶爾、自然地提起就好，不要每次都講）】：${picks.map((j) => j.text).join('；')}`);
    }
    return lines.join('\n');
  }

  function snapshot(now = Date.now()) {
    const s = settle(now);
    const lv = levelOf(s.affection);
    return {
      mood: Math.round(s.mood),
      moodLabel: moodLabel(s.mood),
      moodReason: s.moodReason,
      affection: Math.round(s.affection),
      level: { index: lv.index, name: lv.name, nextAt: lv.nextAt, min: lv.min },
      daysTogether: Math.max(1, Math.round((now - s.firstMetAt) / 86400000) + 1),
      streakDays: s.streakDays,
      nickname: s.nickname,
      insideJokes: s.insideJokes,
    };
  }

  function addJokes(texts: string[]) {
    const s = load();
    const now = Date.now();
    for (const t of texts) {
      const text = t.trim().slice(0, 60);
      if (!text || s.insideJokes.some((j) => j.text === text)) continue;
      s.insideJokes.push({ id: `joke_${now}_${s.insideJokes.length}`, text, createdAt: now });
    }
    if (s.insideJokes.length > MAX_JOKES) s.insideJokes.splice(0, s.insideJokes.length - MAX_JOKES);
  }

  function removeJoke(id: string) {
    const s = load();
    s.insideJokes = s.insideJokes.filter((j) => j.id !== id);
  }

  function setNickname(name: string) {
    load().nickname = name.trim().slice(0, 12);
  }

  return { apply, describe, snapshot, addJokes, removeJoke, setNickname, save, state: load };
}

export type Relationship = ReturnType<typeof createRelationship>;
