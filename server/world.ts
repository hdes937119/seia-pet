/**
 * 河木鎮：西雅的生活世界（世界狀態）。
 *
 * 這裡只存「世界現在是什麼樣子」——居民、地點、彼此的關係、進行中的劇情線、發生過的事、已經確定的設定。
 * 之後的說書人（每天寫村莊日記）、回家流程、聊天即興內容寫回，都是讀寫這份資料，所以設定不會前後矛盾。
 *
 * 完整世界觀見專案文件「河木鎮世界觀」。存在 data/world/world.json（只在主人自己的電腦上）。
 */
import fs from 'fs';
import path from 'path';

/* ───────────── 資料結構 ───────────── */

export interface Resident {
  id: string;
  name: string;
  role: string;
  personality: string;
  /** 跟西雅的關係 */
  relationToSeia: string;
  /** 說話特色（給說書人寫對話用） */
  speech?: string;
  /** 這個人最近的狀況（例如「感冒在家休息」），說書人會更新 */
  status: string;
  statusAt: number;
  /** 偶爾才出現的角色 */
  occasional?: boolean;
}

export interface Place {
  id: string;
  name: string;
  desc: string;
}

/** 兩個角色之間的關係（seia＝西雅）。value：-100 很差 … 0 普通 … 100 很好 */
export interface Bond {
  a: string;
  b: string;
  value: number;
  note: string;
  updatedAt: number;
}

export interface ArcBeat {
  at: number;
  text: string;
}

/** 跨好幾天的劇情線 */
export interface Arc {
  id: string;
  title: string;
  summary: string;
  /** active 進行中 / dormant 埋著的伏筆 / resolved 已結束 */
  status: 'active' | 'dormant' | 'resolved';
  involves: string[];
  beats: ArcBeat[];
  startedAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

export type TownEventKind = 'daily' | 'arc' | 'gift' | 'special' | 'chat';

export interface TownEvent {
  id: string;
  at: number;
  title: string;
  summary: string;
  place?: string;
  involves: string[];
  /** 1 小事 … 5 大事 */
  importance: number;
  kind: TownEventKind;
  arcId?: string;
  /** 這件事的靈感來源（她真的逛到的文章 / 影片），主人問起時可以給真的連結 */
  inspiration?: { title: string; url?: string; source?: string };
  /** 她跟主人講過了沒 */
  told?: boolean;
}

/** 已經確定的設定（例如「米拉有一個在星港工作的妹妹」）。寫進來之後就不能再說相反的話 */
export interface CanonFact {
  id: string;
  subject: string;
  text: string;
  /**
   * 事實鍵「對象.面向」（例如「米拉.家人」「溫室.管理者」）：同一個鍵有新的設定時，舊的標記為被取代
   * （不刪除，可以查回來），提示詞只放最新的。借用 dsh-fish-memory 的做法。
   */
  key?: string;
  /** 被哪一條取代了 */
  supersededBy?: string;
  at: number;
  origin: 'bible' | 'narrator' | 'chat' | 'master';
}

export type SeiaWhere = 'terra' | 'town' | 'lodging' | 'transit';

/** 她逛到、可以變成鎮上故事素材的東西 */
export interface Inspiration {
  title: string;
  url?: string;
  source?: string;
  snippet?: string;
  at: number;
  /** explore＝陪主人逛到的、own＝她自己隨便逛的 */
  from: 'explore' | 'own';
  used?: boolean;
}

/** 主人的班表：一週每天的上班時段（0＝星期日）。沒有就是休假 */
export type WorkSchedule = Record<number, Array<{ start: string; end: string }>>;

export interface WorldState {
  version: number;
  createdAt: number;
  town: { name: string; desc: string };
  seia: { role: string; home: string; workplace: string; lodging: string };
  master: { home: string; desc: string };
  places: Place[];
  residents: Resident[];
  bonds: Bond[];
  arcs: Arc[];
  events: TownEvent[];
  facts: CanonFact[];
  /** 西雅現在在哪裡（回家流程會更新） */
  location: { where: SeiaWhere; since: number };
  /** 主人的班表（西雅照這個時間去河木鎮上班） */
  schedule: WorkSchedule;
  /** 還沒被寫進故事的素材 */
  inspirations: Inspiration[];
  /** 說書人上次寫到什麼時候 */
  narratedUntil: number;
}

/* ───────────── 初始設定（世界觀 v0.4） ───────────── */

const SCHEMA_VERSION = 1;

function seed(now: number): WorldState {
  const r = (
    id: string,
    name: string,
    role: string,
    personality: string,
    relationToSeia: string,
    speech: string,
    occasional = false
  ): Resident => ({ id, name, role, personality, relationToSeia, speech, status: '', statusAt: now, occasional });
  const bond = (a: string, b: string, value: number, note: string): Bond => ({ a, b, value, note, updatedAt: now });

  return {
    version: SCHEMA_VERSION,
    createdAt: now,
    town: {
      name: '河木鎮',
      desc: '主航道旁一顆偏遠小行星上的近未來邊境小鎮。科技很先進，但人很少、生活很慢；白天風吹過金色的砂原，晚上看得到星港的燈和流星。',
    },
    seia: {
      role: '實習觀測員兼領航員',
      home: '平常住在泰拉的主人家，每天用個人傳送裝置通勤去河木鎮上班',
      workplace: '觀測站',
      lodging: '舊港區官邸（靠近星港，只有遇到特殊星象觀測等突發狀況才在這裡過夜）',
    },
    master: {
      home: '母星泰拉',
      desc: '西雅的主人，住在離河木鎮很遠的泰拉；兩地只能靠個人傳送裝置或大型躍遷商船往來',
    },
    places: [
      { id: 'observatory', name: '觀測站', desc: '西雅工作的地方，有大望遠鏡和雷達螢幕' },
      { id: 'starport', name: '星港', desc: '貨船停靠的地方，外面的消息和貨物從這裡進來' },
      { id: 'lodging', name: '舊港區官邸', desc: '西雅在鎮上的落腳處，靠近星港' },
      { id: 'workshop', name: '鏽鐵工坊', desc: '老鐵的店，堆滿黃銅齒輪和古董零件' },
      { id: 'diner', name: '砂原食堂', desc: '鎮上唯一的餐廳，也是八卦中心' },
      { id: 'greenhouse', name: '溫室農場', desc: '在砂原上種菜，很不容易' },
      { id: 'tower', name: '舊信號塔', desc: '廢棄的高塔，傳說會收到奇怪的訊號' },
    ],
    residents: [
      r('laotie', '老鐵', '機械師（鏽鐵工坊）', '固執的老爺爺，迷蒸汽和黃銅，嘴硬心軟', '常跟西雅鬥嘴，其實很疼她', '說話很衝、愛碎念「現在的年輕人」，講到老機械就停不下來'),
      r('mira', '米拉', '砂原食堂老闆娘', '豪爽、愛八卦、廚藝好', '像大姐，會餵西雅吃東西', '大嗓門、笑聲很大，什麼八卦都知道'),
      r('kaka', '小卡', '送貨少年', '冒失、熱血、想當飛行員', '崇拜西雅，被她嫌煩', '講話很急、常常講到一半撞到東西'),
      r('shuo', '朔', '溫室研究員', '安靜、理性、有點社交障礙', '跟西雅互看不順眼，但有默契', '話很少、用詞精準，被戳到會突然講一長串數據'),
      r('kane', '凱恩', '星港維護員兼通訊官', '愛說大話、誇大其詞，但消息最靈通', '外面的消息都經過他的通訊台，常拿「獨家消息」跟西雅炫耀', '開口就是「跟你說個大消息」，十句裡有三句是吹的'),
      r('captain', '貨船船長', '躍遷貨船船長（不定期停靠）', '神秘、話少', '偶爾帶外面的奇怪貨物來，西雅很好奇他的來歷', '只講必要的話', true),
      r('lulu', '嚕嚕', '流浪機器貓', '不會說話，到處亂跑', '西雅的小跟班', '只會發出嗶嗶聲和馬達聲'),
    ],
    bonds: [
      bond('seia', 'laotie', 40, '常鬥嘴，其實很疼她'),
      bond('seia', 'mira', 60, '像大姐一樣照顧她'),
      bond('seia', 'kaka', 25, '被崇拜，嫌他煩'),
      bond('seia', 'shuo', 5, '互看不順眼但有默契'),
      bond('seia', 'kane', 20, '一半聽他的消息、一半拆穿他'),
      bond('seia', 'lulu', 70, '小跟班'),
      bond('laotie', 'shuo', -15, '一個信老機械、一個信數據，常吵架'),
      bond('mira', 'kane', 30, '最會拆穿凱恩的吹牛，但常收他的八卦'),
      bond('kaka', 'kane', 45, '小卡什麼都信凱恩'),
      bond('laotie', 'kaka', 35, '老鐵嘴上嫌小卡毛躁，其實會教他修東西'),
    ],
    arcs: [
      {
        id: 'tower-signal',
        title: '舊信號塔的怪訊號',
        summary: '廢棄的舊信號塔傳說偶爾會收到奇怪的訊號，沒有人知道來源。這是長期伏筆，不要太快揭曉。',
        status: 'dormant',
        involves: ['kane', 'shuo'],
        beats: [],
        startedAt: now,
        updatedAt: now,
      },
    ],
    events: [],
    facts: [],
    location: { where: 'terra', since: now },
    schedule: DEFAULT_SCHEDULE,
    inspirations: [],
    narratedUntil: 0,
  };
}

/** 主人的班表：週一～四 14:00～21:00、週五 08:00～18:00、週六日休息 */
export const DEFAULT_SCHEDULE: WorkSchedule = {
  1: [{ start: '14:00', end: '21:00' }],
  2: [{ start: '14:00', end: '21:00' }],
  3: [{ start: '14:00', end: '21:00' }],
  4: [{ start: '14:00', end: '21:00' }],
  5: [{ start: '08:00', end: '18:00' }],
};

const toMin = (hhmm: string) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** 這個時間點西雅在不在河木鎮上班（照主人班表） */
export function isWorkTime(schedule: WorkSchedule, ms: number): boolean {
  const d = new Date(ms);
  const mins = d.getHours() * 60 + d.getMinutes();
  return (schedule[d.getDay()] || []).some((s) => mins >= toMin(s.start) && mins < toMin(s.end));
}

/* ───────────── 存取 ───────────── */

const MAX_EVENTS = 800;
const MAX_FACTS = 300;
const DAY = 24 * 60 * 60 * 1000;

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createWorld(dataDir: string) {
  const dir = path.join(dataDir, 'world');
  const file = path.join(dir, 'world.json');
  let st: WorldState = seed(Date.now());
  let loaded = false;

  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WorldState>;
      st = { ...st, ...saved } as WorldState;
      loaded = true;
      // 世界觀之後加的新居民 / 地點：補進舊存檔（不覆蓋已經有的）
      const fresh = seed(Date.now());
      for (const res of fresh.residents) if (!st.residents.some((x) => x.id === res.id)) st.residents.push(res);
      for (const pl of fresh.places) if (!st.places.some((x) => x.id === pl.id)) st.places.push(pl);
      if (!st.schedule || !Object.keys(st.schedule).length) st.schedule = DEFAULT_SCHEDULE;
      if (!Array.isArray(st.inspirations)) st.inspirations = [];
      if (!st.narratedUntil) st.narratedUntil = 0;
    }
  } catch (err: any) {
    console.warn('[河木鎮] 讀取世界存檔失敗，從頭開始：', err?.message);
  }

  let timer: NodeJS.Timeout | null = null;
  function save() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
        fs.renameSync(tmp, file);
      } catch (err: any) {
        console.warn('[河木鎮] 儲存失敗：', err?.message);
      }
    }, 500);
  }
  if (!loaded) {
    console.log('[河木鎮] 建立新的世界存檔');
    save();
  }

  /** 名字或 id 都可以找到居民 */
  function findResident(key: string): Resident | undefined {
    const k = String(key || '').trim();
    return st.residents.find((r) => r.id === k || r.name === k);
  }
  const nameOf = (id: string) => (id === 'seia' ? '西雅' : findResident(id)?.name || id);
  const idOf = (key: string) => (key === 'seia' || key === '西雅' ? 'seia' : findResident(key)?.id || key);

  /* ── 寫入 ── */

  function addEvent(e: Partial<TownEvent> & { title: string; summary: string }): TownEvent {
    const ev: TownEvent = {
      id: uid('ev'),
      at: Date.now(),
      kind: 'daily',
      importance: 2,
      involves: [],
      ...e,
    } as TownEvent;
    ev.involves = [...new Set((ev.involves || []).map(idOf))];
    ev.importance = Math.max(1, Math.min(5, Math.round(Number(ev.importance) || 2)));
    st.events.push(ev);
    st.events.sort((a, b) => a.at - b.at);
    if (st.events.length > MAX_EVENTS) st.events.splice(0, st.events.length - MAX_EVENTS);
    if (ev.arcId) addBeat(ev.arcId, ev.title, ev.at);
    save();
    return ev;
  }

  /** 現在有效的設定（沒被取代的） */
  const liveFacts = () => st.facts.filter((f) => !f.supersededBy);

  /** 正規化事實鍵：「米拉 . 家人」「mira.家人」→「米拉.家人」 */
  function normKey(raw?: string): string | undefined {
    const k = String(raw || '').replace(/\s+/g, '').replace(/[．。]/g, '.');
    const m = k.match(/^([^.]+)\.(.+)$/);
    if (!m) return undefined;
    const who = m[1];
    const place = st.places.find((p) => p.id === who || p.name === who);
    return `${place ? place.name : nameOf(idOf(who))}.${m[2].slice(0, 12)}`;
  }

  /** 這個鍵目前的設定 */
  function factByKey(key: string): CanonFact | undefined {
    const k = normKey(key);
    return k ? liveFacts().find((f) => f.key === k) : undefined;
  }

  /**
   * 記下一條設定。帶 key 時：同一個鍵已經有設定 → replace=true 才取代（舊的標記 supersededBy），
   * 否則不寫（回傳 null，呼叫的人當成矛盾處理）。
   */
  function addFact(
    subject: string,
    text: string,
    origin: CanonFact['origin'] = 'narrator',
    opts: { key?: string; replace?: boolean } = {}
  ): CanonFact | null {
    const t = String(text || '').trim();
    if (!t) return null;
    const dup = liveFacts().find((f) => f.text === t);
    if (dup) return dup;
    const key = normKey(opts.key);
    const old = key ? liveFacts().find((f) => f.key === key) : undefined;
    if (old && !opts.replace) return null;
    const place = st.places.find((p) => p.id === subject || p.name === subject);
    const fact: CanonFact = { id: uid('fact'), subject: place ? place.name : nameOf(idOf(subject)) || subject, text: t, at: Date.now(), origin, key };
    if (old) old.supersededBy = fact.id;
    st.facts.push(fact);
    if (st.facts.length > MAX_FACTS) st.facts.splice(0, st.facts.length - MAX_FACTS);
    save();
    return fact;
  }

  function setStatus(resident: string, status: string) {
    const r = findResident(resident);
    if (!r) return false;
    r.status = String(status || '').trim().slice(0, 60);
    r.statusAt = Date.now();
    save();
    return true;
  }

  function adjustBond(a: string, b: string, delta: number, note?: string) {
    const [x, y] = [idOf(a), idOf(b)];
    let bond = st.bonds.find((k) => (k.a === x && k.b === y) || (k.a === y && k.b === x));
    if (!bond) {
      bond = { a: x, b: y, value: 0, note: '', updatedAt: Date.now() };
      st.bonds.push(bond);
    }
    bond.value = Math.max(-100, Math.min(100, Math.round(bond.value + (Number(delta) || 0))));
    if (note) bond.note = String(note).slice(0, 60);
    bond.updatedAt = Date.now();
    save();
    return bond;
  }

  function startArc(title: string, summary: string, involves: string[] = []): Arc {
    const arc: Arc = {
      id: uid('arc'),
      title: String(title).slice(0, 40),
      summary: String(summary).slice(0, 300),
      status: 'active',
      involves: [...new Set(involves.map(idOf))],
      beats: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    st.arcs.push(arc);
    save();
    return arc;
  }

  function addBeat(arcId: string, text: string, at = Date.now()) {
    const arc = st.arcs.find((a) => a.id === arcId);
    if (!arc) return false;
    arc.beats.push({ at, text: String(text).slice(0, 120) });
    arc.beats = arc.beats.slice(-30);
    if (arc.status === 'dormant') arc.status = 'active';
    arc.updatedAt = at;
    save();
    return true;
  }

  function resolveArc(arcId: string, ending: string) {
    const arc = st.arcs.find((a) => a.id === arcId);
    if (!arc) return false;
    if (ending) arc.beats.push({ at: Date.now(), text: `結局：${String(ending).slice(0, 120)}` });
    arc.status = 'resolved';
    arc.resolvedAt = arc.updatedAt = Date.now();
    save();
    return true;
  }

  /** 改班表（設定面板）。格式：{ 1: [{ start: '14:00', end: '21:00' }], … }，0＝星期日 */
  function setSchedule(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const next: WorkSchedule = {};
    const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const day = Number(k);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(v)) return false;
      const slots = v
        .filter((x: any) => x && TIME.test(String(x.start)) && TIME.test(String(x.end)) && toMin(x.start) < toMin(x.end))
        .map((x: any) => ({ start: String(x.start).padStart(5, '0'), end: String(x.end).padStart(5, '0') }));
      if (slots.length) next[day] = slots.slice(0, 3);
    }
    st.schedule = next;
    save();
    return true;
  }

  function setLocation(where: SeiaWhere) {
    if (st.location.where === where) return;
    st.location = { where, since: Date.now() };
    save();
  }

  function markTold(ids: string[]) {
    let changed = false;
    for (const ev of st.events) {
      if (ids.includes(ev.id) && !ev.told) {
        ev.told = true;
        changed = true;
      }
    }
    if (changed) save();
  }

  function addInspiration(item: Omit<Inspiration, 'at' | 'used'> & { at?: number }) {
    const title = String(item.title || '').trim();
    if (!title || st.inspirations.some((i) => i.title === title || (item.url && i.url === item.url))) return;
    st.inspirations.push({ ...item, title: title.slice(0, 160), snippet: item.snippet?.slice(0, 240), at: item.at || Date.now() });
    if (st.inspirations.length > 60) st.inspirations.splice(0, st.inspirations.length - 60);
    save();
  }

  function unusedInspirations() {
    return st.inspirations.filter((i) => !i.used);
  }

  function markInspirationsUsed(items: Inspiration[]) {
    for (const it of items) it.used = true;
    st.inspirations = st.inspirations.filter((i) => !i.used || Date.now() - i.at < 7 * DAY);
    save();
  }

  function setNarratedUntil(ms: number) {
    st.narratedUntil = ms;
    save();
  }

  /** 她的回覆講到了哪些鎮上的事 → 標記「已經跟主人說過」 */
  function markToldIfMentioned(reply: string, now = Date.now()) {
    const text = String(reply || '');
    if (!text) return;
    const bigrams = (t: string) => {
      const c = t.replace(/[^\p{L}\p{N}]/gu, '');
      const out = new Set<string>();
      for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
      return out;
    };
    const said = bigrams(text);
    const ids: string[] = [];
    for (const ev of recentEvents(3, now)) {
      if (ev.told) continue;
      const key = bigrams(ev.title);
      if (!key.size) continue;
      let hit = 0;
      for (const b of key) if (said.has(b)) hit++;
      if (hit >= 3 && hit / key.size >= 0.3) ids.push(ev.id);
    }
    if (ids.length) markTold(ids);
  }

  /* ── 讀取 ── */

  function recentEvents(days = 3, now = Date.now()) {
    return st.events.filter((e) => now - e.at < days * DAY);
  }

  const fmtDay = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  /** 給聊天用的精簡版（放進系統提示詞） */
  function describeForChat(now = Date.now()): string {
    const residents = st.residents
      .map((r) => `${r.name}｜${r.role}：${r.personality}；${r.relationToSeia}${r.status ? `。最近：${r.status}` : ''}`)
      .join('\n');
    const arcs = st.arcs
      .filter((a) => a.status === 'active')
      .slice(-3)
      .map((a) => `「${a.title}」${a.beats.length ? `：目前進展到「${a.beats[a.beats.length - 1].text}」` : `：${a.summary}`}`)
      .join('\n');
    const events = recentEvents(3, now)
      .sort((a, b) => b.importance - a.importance || b.at - a.at)
      .slice(0, 4)
      .sort((a, b) => a.at - b.at)
      .map((e) => `${fmtDay(e.at)}${e.told ? '（已經跟主人說過）' : ''} ${e.title}：${e.summary}`)
      .join('\n');
    const facts = liveFacts()
      .slice(-12)
      .map((f) => `${f.subject}：${f.text}`)
      .join('\n');

    return `【河木鎮（你自己的生活世界）】
你的身分：主人派你到${st.town.name}當${st.seia.role}。${st.seia.home}；工作地點是${st.seia.workplace}，${st.seia.lodging}。主人住在${st.master.home}。
${st.town.name}：${st.town.desc}
地點：${st.places.map((p) => p.name).join('、')}
鎮上的人：
${residents}
${arcs ? `進行中的事：\n${arcs}\n` : ''}${events ? `最近鎮上發生的事：\n${events}\n` : ''}${facts ? `已經確定的設定（不能說相反的話）：\n${facts}\n` : ''}河木鎮規則：
- 這是你真正的生活，不是在演戲；但只在主人問起你的一天、聊到相關的事，或你想分享時才提，一次 1～2 件，不要流水帳。
- 講鎮上的事一律用鎮上的人名和地名。可以補小細節（氣味、天氣、誰說了什麼），但不要自己發明大事（新居民、受傷生病、戀愛、吵翻、劇情大轉折）——大事只能來自上面「最近鎮上發生的事」和「進行中的事」。
- 鎮上的事跟現實世界分開：講現實的知識、新聞仍然要誠實，不能把鎮上的事說成現實真的發生過。
- 居民有自己的生活和煩惱，不是都繞著主人轉。`;
  }

  function snapshot() {
    return st;
  }

  return {
    snapshot,
    findResident,
    nameOf,
    addEvent,
    addFact,
    factByKey,
    liveFacts,
    setStatus,
    adjustBond,
    startArc,
    addBeat,
    resolveArc,
    setLocation,
    setSchedule,
    markTold,
    markToldIfMentioned,
    addInspiration,
    unusedInspirations,
    markInspirationsUsed,
    setNarratedUntil,
    recentEvents,
    describeForChat,
  };
}

export type World = ReturnType<typeof createWorld>;
