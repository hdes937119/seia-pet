/**
 * 主人在不在、西雅在哪裡：河木鎮世界觀的「一天的節奏」。
 *
 *  - 主人在不在：桌寵前端每分鐘回報系統閒置秒數（鍵盤、滑鼠多久沒動）。
 *      上班時段離開 30 分鐘、其他時段離開 2.5 小時，才算「出門了」；短暫離開不算。
 *  - 西雅在哪：照主人班表，主人出門上班 → 她傳送去河木鎮上班；下班時間到 → 她回泰拉的家。
 *      班表在設定面板可以改；Google 行事曆今天有「請假 / 休假 / 國定假日」→ 她也放假。
 *  - 主人回來時（打招呼）：
 *      早上第一次見面 → 依前一晚的疲勞決定她早起、一起醒、還是賴床。
 *      下班回家 → 交換今天鎮上的事，可能帶伴手禮（當天有送禮事件一定帶，不然每天約 25% 機率）。
 *  - 主人說「我回來了」→ 她立刻傳送過來。
 *  - 下班時間過了 30 分鐘主人還沒回來 → 在 LINE 問是不是加班（一天一次）。
 *
 * 狀態存在 data/world/presence.json。
 */
import fs from 'fs';
import path from 'path';
import { isWorkTime, type World } from './world';
import { inObservationNight, tonightEvent, OBSERVATION_END_H } from './sky';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const AWAY_WORK_MS = 30 * MIN;
const AWAY_OTHER_MS = 150 * MIN;
const MORNING_GAP_MS = 5 * HOUR;
const OVERTIME_ASK_AFTER_MS = 30 * MIN;
const GIFT_CHANCE = 0.25;
/** 賴床狀態最多維持多久（主人一直沒跟她說話也會自己醒） */
const OVERSLEEP_MAX_MS = 40 * MIN;
/** 特殊觀測夜：幾點出發去官邸值夜 */
const NIGHT_SHIFT_LEAVE_MIN = 19 * 60 + 30;

export type WakeMode = 'early' | 'together' | 'oversleep';

interface PresenceState {
  lastReportAt: number;
  lastActiveAt: number;
  /** 她下班回家了，但還沒跟主人分享今天的事 */
  pendingHomecoming: boolean;
  shiftEndedAt: number;
  /** 前一晚最後一次在電腦前的時間和她當時的有效體力 */
  night: { at: number; effective: number } | null;
  wake: { date: string; mode: WakeMode; at: number; awake: boolean } | null;
  overtimeAskedDate: string;
  lastGiftDate: string;
  /** 特殊觀測夜：已經跟主人說過今晚要值夜的日期 */
  announcedNightDate: string;
  /** 特殊觀測夜：值夜的那一晚 */
  nightShift: { date: string; name: string; back: boolean } | null;
  /** 主人自己說過他在哪（「我出門了」「到家了」「在床上」…），有時效 */
  masterHint?: { where: MasterWhere; text: string; at: number } | null;
}

export type MasterWhere = 'out' | 'work' | 'home' | 'bed';

/** 從主人的話裡抓「他現在在哪」（只抓講自己現在狀態的說法） */
const WHERE_RULES: Array<[MasterWhere, RegExp]> = [
  ['bed', /(在|躺|窩在|賴在)床上|躺床|準備睡|要睡了|睡前|在被窩/],
  ['home', /到家|回到家|回家了|我在家|在家裡|在房間|在客廳|在沙發|在廁所|在洗澡|洗完澡|在煮飯/],
  ['work', /在公司|到公司|上班中|在上班|在開會|在辦公室|在教室|在上課/],
  ['out', /出門|在外面|在路上|外出|在捷運|在公車|搭(車|捷運|公車|高鐵|火車)|在車上|在餐廳|在店裡|在排隊|在逛|在超商|在便利商店|在買|在夜市|在醫院|在學校/],
];
const HINT_TTL: Record<MasterWhere, number> = { out: 3 * 60 * 60 * 1000, work: 4 * 60 * 60 * 1000, home: 6 * 60 * 60 * 1000, bed: 8 * 60 * 60 * 1000 };
export function detectMasterWhere(text: string): MasterWhere | null {
  const t = String(text || '');
  // 問句（「你在家嗎」）不算
  if (/[？?]\s*$/.test(t.trim()) && /你|妳/.test(t)) return null;
  for (const [where, re] of WHERE_RULES) if (re.test(t)) return where;
  return null;
}

export interface PresenceDeps {
  world: World;
  /** 她現在的有效體力（0～100） */
  effectiveEnergy: () => number;
  /** 今天是不是請假 / 國定假日（看 Google 行事曆） */
  isHolidayToday: () => Promise<boolean>;
  /** 用 LINE 主動傳一句話給主人（加班時問一下） */
  pushLine?: (text: string) => Promise<boolean>;
  /** 主人在電腦前時，讓她在桌寵上說一句話 */
  sayOnDesktop?: (text: string, emotion?: string) => void;
  log?: (msg: string) => void;
}

export interface GreetingContext {
  /** 加到打招呼提示詞裡的情況說明 */
  situation: string;
  /** 這次要帶伴手禮（回傳的 JSON 要有 gift 欄位） */
  wantGift: boolean;
  /** 這次打招呼會提到的鎮上事件（講完標記為已說過） */
  eventIds: string[];
  kind: 'wake' | 'homecoming' | 'at-work' | null;
}

const dateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const OVERTIME_LINES = [
  '今天加班喔？本喵已經下班回家等你了…才、才不是在等你喵！',
  '主人～下班時間過了耶，還在忙嗎？記得吃點東西喵。',
  '本喵都從河木鎮傳送回來了，你怎麼還沒回家…今天加班嗎？',
];

export function createPresence(dataDir: string, deps: PresenceDeps) {
  const file = path.join(dataDir, 'world', 'presence.json');
  let st: PresenceState = {
    lastReportAt: 0,
    lastActiveAt: Date.now(),
    pendingHomecoming: false,
    shiftEndedAt: 0,
    night: null,
    wake: null,
    overtimeAskedDate: '',
    lastGiftDate: '',
    announcedNightDate: '',
    nightShift: null,
    masterHint: null,
  };
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
      } catch (err: any) {
        deps.log?.(`[河木鎮] 儲存在家狀態失敗：${err?.message}`);
      }
    }, 500);
  };

  const world = deps.world;
  const schedule = () => world.snapshot().schedule;

  let holidayCache = { date: '', value: false };
  async function holiday(now: number) {
    const key = dateKey(now);
    if (holidayCache.date !== key) {
      holidayCache = { date: key, value: await deps.isHolidayToday().catch(() => false) };
      if (holidayCache.value) deps.log?.('[河木鎮] 行事曆上今天放假，西雅也放假');
    }
    return holidayCache.value;
  }

  /** 這段時間裡有沒有她的上班時段 */
  function workedBetween(from: number, to: number) {
    for (let t = from; t <= to; t += 15 * MIN) if (isWorkTime(schedule(), t)) return true;
    return false;
  }

  /** 今天她有沒有去上班（今天班表有排、而且主人有出門） */
  const isWorkingNow = async (now: number) => isWorkTime(schedule(), now) && !(await holiday(now));

  /** 依前一晚的疲勞決定早上怎麼醒 */
  function decideWake(now: number): WakeMode {
    const night = st.night && now - st.night.at < 16 * HOUR ? st.night : null;
    const energy = night ? night.effective : 70;
    const h = night ? new Date(night.at).getHours() : 23;
    const late = h >= 1 && h < 6 ? 0.25 : h === 0 ? 0.12 : 0;
    const pEarly = Math.min(0.75, Math.max(0.05, 0.15 + (energy / 100) * 0.55 - late));
    const pOversleep = Math.min(0.7, Math.max(0.05, 0.1 + (1 - energy / 100) * 0.5 + late));
    const r = Math.random();
    return r < pEarly ? 'early' : r < pEarly + pOversleep ? 'oversleep' : 'together';
  }

  /** 主人回到電腦前（awayMs＝離開了多久） */
  function noteReturn(awayMs: number, now: number) {
    const hour = new Date(now).getHours();
    if (awayMs >= MORNING_GAP_MS && hour >= 5 && hour < 12 && st.wake?.date !== dateKey(now)) {
      const mode = decideWake(now);
      st.wake = { date: dateKey(now), mode, at: now, awake: mode !== 'oversleep' };
      deps.log?.(`[河木鎮] 早上見面：${mode === 'early' ? '她比主人早起' : mode === 'oversleep' ? '她賴床了' : '一起醒來'}`);
    }
  }

  /**
   * 前端每分鐘回報一次系統閒置秒數。
   * 回傳這次發生的變化（log 用）。
   */
  async function report(idleSec: number, now = Date.now()): Promise<string[]> {
    const changes: string[] = [];
    const idleMs = Math.max(0, Number(idleSec) || 0) * 1000;
    const activeNow = idleMs < 90 * 1000;
    const prevActive = st.lastActiveAt;

    if (activeNow) {
      const awayMs = prevActive ? now - idleMs - prevActive : 0;
      if (awayMs > 10 * MIN) noteReturn(awayMs, now);
      st.lastActiveAt = now - idleMs;
      const h = new Date(now).getHours();
      if (h >= 21 || h < 6) st.night = { at: now, effective: deps.effectiveEnergy() };
    }
    st.lastReportAt = now;

    const away = now - st.lastActiveAt;
    const where = world.snapshot().location.where;
    const working = await isWorkingNow(now);

    // 特殊觀測夜（真實流星雨極大期）：晚上 19:30 出發去官邸值夜，隔天早上 7 點回來
    const tonight = tonightEvent(now);
    const d = new Date(now);
    const minsNow = d.getHours() * 60 + d.getMinutes();
    if (tonight && where !== 'lodging' && (minsNow >= NIGHT_SHIFT_LEAVE_MIN || inObservationNight(now)) && st.nightShift?.date !== dateKey(now - (d.getHours() < OBSERVATION_END_H ? 12 * HOUR : 0))) {
      world.setLocation('lodging');
      st.pendingHomecoming = false;
      st.nightShift = { date: dateKey(now - (d.getHours() < OBSERVATION_END_H ? 12 * HOUR : 0)), name: tonight.name, back: false };
      changes.push(`今晚是${tonight.name}，西雅去河木鎮官邸值夜了`);
      const bye = `本喵要出發去觀測站值夜了！今晚是${tonight.name}的極大期${tonight.major ? '，一年一次的大日子' : ''}～有事用 LINE 找我喵。`;
      if (away < 10 * MIN) deps.sayOnDesktop?.(bye, 'proud');
      else void deps.pushLine?.(bye);
      save();
      for (const c of changes) deps.log?.(`[河木鎮] ${c}`);
      return changes;
    }
    if (where === 'lodging') {
      // 值完夜，早上 7 點回家（很睏）
      if (!inObservationNight(now) && d.getHours() >= OBSERVATION_END_H + 2) {
        world.setLocation('terra');
        if (st.nightShift) st.nightShift.back = true;
        st.night = { at: now - 2 * HOUR, effective: 15 };
        changes.push('西雅值完夜，傳送回泰拉的家了');
      }
      save();
      for (const c of changes) deps.log?.(`[河木鎮] ${c}`);
      return changes;
    }

    // 主人出門上班 → 她也去河木鎮上班
    if (where === 'terra' && working && away >= AWAY_WORK_MS) {
      world.setLocation('town');
      changes.push('主人出門了，西雅傳送去河木鎮上班');
    }
    // 下班時間到 → 她回泰拉的家（主人可能還沒回來）
    if (where === 'town' && !isWorkTime(schedule(), now)) {
      world.setLocation('terra');
      st.pendingHomecoming = true;
      st.shiftEndedAt = now;
      changes.push('西雅下班了，傳送回泰拉的家');
    }
    // 下班 30 分鐘了主人還沒回來 → LINE 問一下是不是加班（一天一次）
    if (
      st.pendingHomecoming &&
      away >= AWAY_WORK_MS &&
      now - st.shiftEndedAt >= OVERTIME_ASK_AFTER_MS &&
      st.overtimeAskedDate !== dateKey(now) &&
      deps.pushLine
    ) {
      st.overtimeAskedDate = dateKey(now);
      const ok = await deps.pushLine(OVERTIME_LINES[Math.floor(Math.random() * OVERTIME_LINES.length)]);
      if (ok) changes.push('主人還沒回家，用 LINE 問是不是加班');
    }
    // 賴床太久就自己醒了
    if (st.wake && !st.wake.awake && now - st.wake.at > OVERSLEEP_MAX_MS) st.wake.awake = true;

    save();
    for (const c of changes) deps.log?.(`[河木鎮] ${c}`);
    return changes;
  }

  /** 今天還沒跟主人說過的鎮上事（重要的先） */
  function untoldToday(now: number) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return world
      .recentEvents(2, now)
      .filter((e) => !e.told && e.at >= start.getTime() - 6 * HOUR && e.kind !== 'gift')
      .sort((a, b) => b.importance - a.importance || b.at - a.at);
  }

  /** arrival：first＝她先下班回家等主人、together＝一起到家、rushed＝上班到一半被主人叫回來 */
  function homecomingText(now: number, arrival: 'first' | 'together' | 'rushed') {
    const events = untoldToday(now).slice(0, 2);
    const lines = events.map((e) => `- ${e.title}：${e.summary}`).join('\n');
    const dizzy = deps.effectiveEnergy() < 35 ? '今天很累，傳送過來有點暈。' : '';
    return {
      text:
        (arrival === 'rushed'
          ? `你本來還在河木鎮上班，一聽到主人回來，就用傳送裝置趕回泰拉的家（工作先丟給同事了）。${dizzy}`
          : `你今天在河木鎮上班，${arrival === 'first' ? '下班後先用傳送裝置回到泰拉的家，一直在等主人回來；主人現在終於回來了' : '剛下班，用傳送裝置回到泰拉的家，剛好跟主人一起到家'}。${dizzy}`) +
        (lines
          ? `\n今天鎮上發生的事（挑一件最有趣的、用你的口氣講給主人聽，用鎮上的人名和地名；不用全部講）：\n${lines}`
          : '\n今天鎮上沒什麼特別的事，可以抱怨一下工作、或問主人今天過得怎樣。'),
      eventIds: events.map((e) => e.id),
    };
  }

  function giftDecision(now: number) {
    if (st.lastGiftDate === dateKey(now)) return false;
    const hasGiftEvent = world.recentEvents(1, now).some((e) => e.kind === 'gift' && !e.told);
    return hasGiftEvent || Math.random() < GIFT_CHANCE;
  }

  /**
   * 打招呼前呼叫：依「主人離開多久、現在幾點、她今天有沒有上班」決定這次招呼的情境。
   */
  async function greetingContext(reason: string, awayMinutes: number, now = Date.now()): Promise<GreetingContext> {
    const none: GreetingContext = { situation: '', wantGift: false, eventIds: [], kind: null };
    if (reason !== 'startup' && reason !== 'return') return none;
    const awayMs = Math.max(0, Number(awayMinutes) || 0) * MIN;
    noteReturn(awayMs, now);
    st.lastActiveAt = now;
    const today = dateKey(now);

    // 1. 早上第一次見面
    if (st.wake && st.wake.date === today && now - st.wake.at < 5 * MIN) {
      const reasonNight =
        st.night && now - st.night.at < 16 * HOUR
          ? new Date(st.night.at).getHours() < 6
            ? `昨晚被主人拉著聊到 ${new Date(st.night.at).getHours()} 點多`
            : st.night.effective < 40
              ? '昨天很累'
              : '昨晚睡得不錯'
          : '';
      const afterShift = st.nightShift && st.nightShift.back && st.nightShift.date === dateKey(now - 24 * HOUR);
      if (afterShift) st.wake.mode = st.wake.mode === 'early' ? 'together' : st.wake.mode;
      const shiftNote = afterShift ? `你昨晚在河木鎮觀測站值夜看${st.nightShift!.name}，清晨才回來，超睏；可以跟主人分享昨晚看到的流星（照「最近鎮上發生的事」講）。` : '';
      const situation =
        shiftNote +
        (st.wake.mode === 'early'
          ? `【早上】你今天比主人早起（${reasonNight || '精神不錯'}），已經起來一陣子了。跟主人說早安，可以順便說你幫他做了什麼小事（例如咖啡在桌上、窗簾拉開了），或抱怨他起得好晚。`
          : st.wake.mode === 'oversleep'
            ? `【早上】你賴床了！主人開電腦時你還在睡（${reasonNight || '太睏了'}）。用迷迷糊糊、剛被吵醒的語氣說話（例如「唔…再五分鐘…」「現在幾點了…」），可以怪主人昨晚害你太晚睡。`
            : `【早上】你跟主人差不多同時醒來，還有點睏。跟主人說早安。`);
      save();
      return { situation, wantGift: false, eventIds: [], kind: 'wake' };
    }

    // 特殊觀測夜：她在官邸值夜，不會回家
    if (world.snapshot().location.where === 'lodging') {
      const ev = tonightEvent(now);
      save();
      return {
        situation: `【你今晚在河木鎮值夜】${ev ? `今晚是${ev.name}的極大期，` : ''}你在觀測站值夜，透過通訊終端看到主人回到電腦前。跟他打招呼、說說你這邊的夜空，提醒他早點睡（你明天早上才回去）。`,
        wantGift: false,
        eventIds: [],
        kind: 'at-work',
      };
    }

    // 2. 她今天上過班 → 下班回家交換今天的事
    const workedWhileAway = workedBetween(now - awayMs, now) && !(await holiday(now));
    const workingNow = await isWorkingNow(now);
    if (!workingNow && (st.pendingHomecoming || workedWhileAway)) {
      const arrivedFirst = st.pendingHomecoming && now - st.shiftEndedAt > 10 * MIN;
      const { text, eventIds } = homecomingText(now, arrivedFirst ? 'first' : 'together');
      const wantGift = giftDecision(now);
      st.pendingHomecoming = false;
      world.setLocation('terra');
      save();
      return {
        situation:
          `【下班回家】${text}` +
          (wantGift
            ? '\n你今天帶了一個伴手禮給主人（傳送裝置只能帶小東西）：請想一個跟今天鎮上的事或鎮上居民有關的小東西，在對話裡拿出來（傲嬌地說是順便、剛好多的），並在 JSON 加上 gift 欄位。'
            : ''),
        wantGift,
        eventIds,
        kind: 'homecoming',
      };
    }

    // 3. 主人在她上班時間回到電腦前（提早回來、或今天休假沒記在行事曆）
    if (workingNow && world.snapshot().location.where === 'town') {
      return {
        situation:
          '【你還在河木鎮上班】主人在你的上班時間回到電腦前了，你是透過通訊終端看到他的。可以問他怎麼這麼早回來、今天是不是休假；如果他說「我回來了」，你就會傳送回去。',
        wantGift: false,
        eventIds: [],
        kind: 'at-work',
      };
    }
    save();
    return none;
  }

  /** 打招呼說完之後：記下伴手禮、把講到的事標記為已說過 */
  function afterGreeting(ctx: GreetingContext, gift: { name?: string; from?: string; why?: string } | null, now = Date.now()) {
    if (ctx.eventIds.length) world.markTold(ctx.eventIds);
    if (ctx.wantGift && gift?.name) {
      st.lastGiftDate = dateKey(now);
      const giver = gift.from && world.findResident(gift.from) ? gift.from : undefined;
      world.addEvent({
        at: now,
        title: `帶回伴手禮：${String(gift.name).slice(0, 14)}`,
        summary: `西雅從河木鎮帶了「${gift.name}」回來給主人${gift.from ? `（${gift.from}）` : ''}${gift.why ? `：${gift.why}` : ''}`.slice(0, 160),
        involves: giver ? ['seia', giver] : ['seia'],
        importance: 2,
        kind: 'gift',
        told: true,
      });
      deps.log?.(`[河木鎮] 伴手禮：${gift.name}`);
      save();
    }
  }

  /** 主人說「我回來了」→ 她立刻傳送過來（回傳要加進聊天提示詞的情境） */
  async function manualReturn(now = Date.now()): Promise<string> {
    const where = world.snapshot().location.where;
    st.lastActiveAt = now;
    if (where === 'town' || where === 'lodging' || st.pendingHomecoming) {
      const arrivedFirst = st.pendingHomecoming && now - st.shiftEndedAt > 10 * MIN;
      const fromWork = where === 'town' && (await isWorkingNow(now));
      world.setLocation('terra');
      st.pendingHomecoming = false;
      const { text, eventIds } = homecomingText(now, fromWork ? 'rushed' : arrivedFirst ? 'first' : 'together');
      world.markTold(eventIds);
      save();
      return `\n【主人說他回來了】${text}`;
    }
    return '';
  }

  /** 給聊天提示詞：她現在在哪 */
  /** 主人的話裡提到自己在哪 → 記下來（聊天、LINE 都會呼叫） */
  function noteMasterText(text: string, now = Date.now()) {
    const where = detectMasterWhere(text);
    if (!where) return;
    st.masterHint = { where, text: String(text).slice(0, 40), at: now };
    save();
  }

  /**
   * 主人現在大概在哪（給 LINE 聊天用）。依據：
   *  1. 主人自己說過的（有時效）
   *  2. 電腦有沒有人在用（桌寵每分鐘回報系統閒置時間）
   *  3. 桌寵有沒有開著（太久沒回報 → 電腦關了或睡著）
   *  4. 是不是主人的上班時間、是不是深夜
   * 不確定就明說不確定，讓她用問的，不要自己認定。
   */
  function describeMaster(now = Date.now()): string {
    const fmtAgo = (ms: number) => (ms < 60 * MIN ? `${Math.max(1, Math.round(ms / MIN))} 分鐘` : `${Math.round(ms / (60 * MIN))} 小時`);
    const h = new Date(now).getHours();
    const petAlive = now - st.lastReportAt < 3 * MIN;
    const idle = now - st.lastActiveAt;
    const hint = st.masterHint && now - st.masterHint.at < HINT_TTL[st.masterHint.where] ? st.masterHint : null;
    const work = isWorkTime(schedule(), now);
    const parts: string[] = [];
    if (petAlive && idle < 3 * MIN) {
      parts.push('主人就在電腦前（人在你旁邊），卻用 LINE 傳訊息給你——可能是懶得打字、在用手機、或在用電腦版 LINE，可以吐槽他。');
    } else {
      if (hint) {
        const label: Record<MasterWhere, string> = { out: '在外面', work: '在上班／上課', home: '在家裡（不在電腦前）', bed: '躺在床上' };
        parts.push(`主人 ${fmtAgo(now - hint.at)}前說過他${label[hint.where]}（他說：「${hint.text}」），應該還是這樣，除非他說了別的。`);
      } else if (work) {
        parts.push('現在是主人的上班時間，他多半在公司或外面，用手機跟你聊。');
      } else if (!petAlive) {
        parts.push('電腦上的桌寵現在沒開（或電腦睡著了），你看不到主人在不在家。');
      } else if (idle < 30 * MIN) {
        parts.push(`主人離開電腦大約 ${fmtAgo(idle)}了，可能在家裡別的地方（洗澡、吃飯、躺著滑手機），也可能出門了。`);
      } else {
        parts.push(`主人離開電腦大約 ${fmtAgo(idle)}了，可能出門了，也可能在家休息。`);
      }
      if (!hint && (h >= 23 || h < 6) && !work) parts.push('這麼晚了，他很可能已經躺在床上用手機。');
    }
    const sure = (petAlive && idle < 3 * MIN) || !!hint;
    return `【主人現在大概在哪】${parts.join('')}${sure ? '' : '你不確定的事不要自己認定（不要說「你出門了」或「你在家」），需要的話可以自然地問一句他在哪；他說了你就記得。'}`;
  }

  function describeLocation(channel: 'desktop' | 'line', now = Date.now()): string {
    const where = world.snapshot().location.where;
    const tonight = tonightEvent(now);
    const d = new Date(now);
    const mins = d.getHours() * 60 + d.getMinutes();
    if (tonight && where !== 'lodging' && mins < NIGHT_SHIFT_LEAVE_MIN && d.getHours() >= 6 && st.announcedNightDate !== dateKey(now)) {
      return `【今晚的特別任務】今晚是${tonight.name}的極大期（${tonight.note}），你晚上 19:30 要回河木鎮官邸、在觀測站值夜到天亮。找個自然的時機先跟主人說一聲（說一次就好），可以期待、可以抱怨要熬夜。`;
    }
    if (where === 'lodging' && tonight) {
      return `【你現在在哪】你今晚在河木鎮的觀測站值夜看${tonight.name}，透過通訊終端跟主人聊。可以講你看到的流星、誰跑來一起看。${channel === 'line' ? `\n${describeMaster(now)}` : ''}`;
    }
    if (where === 'town' || where === 'lodging') {
      return channel === 'line'
        ? `【你現在在哪】你在河木鎮${where === 'lodging' ? '的舊港區官邸' : '上班'}，透過通訊終端（LINE）跟主人聊天。可以順口講一下你現在在做什麼。\n${describeMaster(now)}`
        : '【你現在在哪】你還在河木鎮上班，是透過通訊終端跟電腦前的主人說話。';
    }
    if (channel === 'line') return `【你現在在哪】你在泰拉的家，用 LINE 跟主人聊。\n${describeMaster(now)}`;
    return '';
  }

  /** 她已經跟主人說了今晚要值夜 → 不再提醒她 */
  function markNightAnnounced(reply: string, now = Date.now()) {
    const tonight = tonightEvent(now);
    if (!tonight || st.announcedNightDate === dateKey(now)) return;
    if (reply.includes(tonight.name.slice(0, 3)) || /值夜|流星雨/.test(reply)) {
      st.announcedNightDate = dateKey(now);
      save();
    }
  }

  function isAsleep(now = Date.now()) {
    return Boolean(st.wake && st.wake.date === dateKey(now) && !st.wake.awake && now - st.wake.at < OVERSLEEP_MAX_MS);
  }

  /** 主人跟她說話了 → 賴床的她醒了 */
  function wakeUp() {
    if (st.wake && !st.wake.awake) {
      st.wake.awake = true;
      save();
    }
  }

  function snapshot() {
    return { ...st, where: world.snapshot().location };
  }

  return { report, greetingContext, afterGreeting, manualReturn, describeLocation, describeMaster, noteMasterText, markNightAnnounced, isAsleep, wakeUp, snapshot };
}

export type Presence = ReturnType<typeof createPresence>;

/** 主人說「我回來了」 */
export const RETURN_RE = /^(我)?(回來|回来|到家|回到家)(了|啦|囉|嘍|喔|哦)?[!！~～。.喵啦]*$/;
