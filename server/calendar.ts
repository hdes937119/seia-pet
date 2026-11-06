/**
 * Google 日曆讀取（用「私密網址（iCal 格式）」，不需要 Google API / OAuth）。
 *
 * 在 Google 日曆網頁版：設定 → 你的日曆 → 「整合日曆」→「iCal 格式的私密網址」，
 * 把網址放進 .env 的 GOOGLE_CALENDAR_ICS（多個日曆用逗號分隔）。
 * 這個網址等於你行事曆的鑰匙：只放 .env，log 也不會印出來。
 *
 * 自己解析 ICS（不依賴套件），支援：
 *   整天 / 有時間的事件、時區（TZID / UTC / 浮動時間）、
 *   重複事件 RRULE（DAILY / WEEKLY / MONTHLY / YEARLY，INTERVAL、COUNT、UNTIL、BYDAY、BYMONTHDAY、BYMONTH）、
 *   EXDATE（刪掉其中一次）、RECURRENCE-ID（單次改時間 / 取消）、STATUS:CANCELLED。
 */

export interface CalEvent {
  uid: string;
  title: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  location?: string;
}

interface Wall {
  y: number;
  m: number; // 1~12
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

interface DT {
  wall: Wall;
  tz: string; // 'UTC' | 'floating' | IANA 時區名稱
  allDay: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  uid: string;
  title: string;
  location?: string;
  start?: DT;
  end?: DT;
  rrule?: string;
  exdates: DT[];
  recurrenceId?: DT;
  cancelled: boolean;
}

/* ───────────── 時間工具 ───────────── */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function tzOffsetMs(utcMs: number, tz: string): number {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, dtf);
  }
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/** 「某時區的牆上時間」→ UTC 毫秒 */
function wallToUtc(w: Wall, tz: string): number {
  if (tz === 'UTC') return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
  if (tz === 'floating') return new Date(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss).getTime();
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
  try {
    const off1 = tzOffsetMs(guess, tz);
    let utc = guess - off1;
    const off2 = tzOffsetMs(utc, tz);
    if (off2 !== off1) utc = guess - off2;
    return utc;
  } catch {
    // 看不懂的時區名稱（例如 Outlook 的 Windows 時區名）→ 當作本機時間
    return new Date(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss).getTime();
  }
}

function dtToDate(dt: DT): Date {
  return new Date(wallToUtc(dt.wall, dt.allDay ? 'floating' : dt.tz));
}

/** 把牆上時間當成日曆計算（加天數、算星期），用 UTC 當計算引擎 */
const wallMs = (w: Wall) => Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
function msToWall(ms: number): Wall {
  const d = new Date(ms);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
  };
}
const DAY = 86_400_000;
const addDays = (w: Wall, n: number) => msToWall(wallMs(w) + n * DAY);
const weekday = (w: Wall) => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay(); // 0 = 星期日
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 本機日期字串 YYYY-MM-DD */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ───────────── ICS 解析 ───────────── */

function parseLine(line: string): Prop | null {
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const parts = head.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

function parseDT(value: string, params: Record<string, string>): DT | null {
  const v = value.trim();
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (params.VALUE === 'DATE' || date) {
    if (!date) return null;
    return { wall: { y: +date[1], m: +date[2], d: +date[3], hh: 0, mm: 0, ss: 0 }, tz: 'floating', allDay: true };
  }
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!t) return null;
  return {
    wall: { y: +t[1], m: +t[2], d: +t[3], hh: +t[4], mm: +t[5], ss: +t[6] },
    tz: t[7] ? 'UTC' : params.TZID || 'floating',
    allDay: false,
  };
}

function parseEvents(ics: string): RawEvent[] {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0; // 跳過 VEVENT 裡的 VALARM
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { uid: '', title: '', exdates: [], cancelled: false };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line === 'END:VEVENT') {
      if (cur.start) out.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith('BEGIN:')) {
      depth++;
      continue;
    }
    if (line.startsWith('END:')) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        cur.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        cur.title = unescapeText(prop.value);
        break;
      case 'LOCATION':
        cur.location = unescapeText(prop.value) || undefined;
        break;
      case 'DTSTART':
        cur.start = parseDT(prop.value, prop.params) ?? undefined;
        break;
      case 'DTEND':
        cur.end = parseDT(prop.value, prop.params) ?? undefined;
        break;
      case 'RRULE':
        cur.rrule = prop.value.trim();
        break;
      case 'EXDATE':
        for (const v of prop.value.split(',')) {
          const dt = parseDT(v, prop.params);
          if (dt) cur.exdates.push(dt);
        }
        break;
      case 'RECURRENCE-ID':
        cur.recurrenceId = parseDT(prop.value, prop.params) ?? undefined;
        break;
      case 'STATUS':
        cur.cancelled = prop.value.trim().toUpperCase() === 'CANCELLED';
        break;
    }
  }
  return out;
}

/* ───────────── 重複事件展開 ───────────── */

const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  untilMs?: number;
  byday?: Array<{ n: number; wd: number }>;
  bymonthday?: number[];
  bymonth?: number[];
}

function parseRRule(s: string, startTz: string): RRule | null {
  const kv: Record<string, string> = {};
  for (const part of s.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) kv[k.toUpperCase()] = v.toUpperCase();
  }
  const freq = kv.FREQ as RRule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const rule: RRule = { freq, interval: Math.max(1, Number(kv.INTERVAL) || 1) };
  if (kv.COUNT) rule.count = Number(kv.COUNT);
  if (kv.UNTIL) {
    const u = parseDT(kv.UNTIL, {});
    if (u) rule.untilMs = u.allDay ? wallToUtc({ ...u.wall, hh: 23, mm: 59, ss: 59 }, startTz) : wallToUtc(u.wall, u.tz === 'floating' ? startTz : u.tz);
  }
  if (kv.BYDAY) {
    rule.byday = kv.BYDAY.split(',')
      .map((x) => x.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: WD[m[2]] }));
  }
  if (kv.BYMONTHDAY) rule.bymonthday = kv.BYMONTHDAY.split(',').map(Number).filter(Boolean);
  if (kv.BYMONTH) rule.bymonth = kv.BYMONTH.split(',').map(Number).filter(Boolean);
  return rule;
}

/** 某個月裡符合 BYDAY（例如 2MO、-1FR、MO）或 BYMONTHDAY 的日期 */
function daysInMonthMatching(y: number, m: number, rule: RRule, startDay: number): number[] {
  const dim = daysInMonth(y, m);
  if (rule.bymonthday?.length) {
    return rule.bymonthday
      .map((d) => (d > 0 ? d : dim + d + 1))
      .filter((d) => d >= 1 && d <= dim)
      .sort((a, b) => a - b);
  }
  if (rule.byday?.length) {
    const days = new Set<number>();
    for (const { n, wd } of rule.byday) {
      const all: number[] = [];
      for (let d = 1; d <= dim; d++) if (weekday({ y, m, d, hh: 0, mm: 0, ss: 0 }) === wd) all.push(d);
      if (n === 0) all.forEach((d) => days.add(d));
      else {
        const pick = n > 0 ? all[n - 1] : all[all.length + n];
        if (pick) days.add(pick);
      }
    }
    return [...days].sort((a, b) => a - b);
  }
  return startDay <= dim ? [startDay] : [];
}

/** 展開重複事件，回傳每一次的「牆上時間」（只列到 windowEndMs 為止） */
function expand(start: DT, rule: RRule, windowEndMs: number): Wall[] {
  const tz = start.allDay ? 'floating' : start.tz;
  const s = start.wall;
  const out: Wall[] = [];
  let emitted = 0;
  const startMs = wallToUtc(s, tz);
  const done = () => rule.count !== undefined && emitted >= rule.count;
  const push = (w: Wall): boolean => {
    const ms = wallToUtc(w, tz);
    if (ms < startMs) return true; // DTSTART 之前的不算
    if (rule.untilMs !== undefined && ms > rule.untilMs) return false;
    if (ms > windowEndMs) return false;
    out.push(w);
    emitted++;
    return !done();
  };
  const time = { hh: s.hh, mm: s.mm, ss: s.ss };

  for (let i = 0; i < 20000; i++) {
    if (rule.freq === 'DAILY') {
      const w = addDays(s, i * rule.interval);
      if (rule.byday?.length && !rule.byday.some((b) => b.wd === weekday(w))) continue;
      if (rule.bymonth?.length && !rule.bymonth.includes(w.m)) continue;
      if (!push(w)) break;
    } else if (rule.freq === 'WEEKLY') {
      const weekStart = addDays(s, -((weekday(s) + 6) % 7) + i * 7 * rule.interval); // 週一開始
      const days = rule.byday?.length
        ? [...new Set(rule.byday.map((b) => (b.wd + 6) % 7))].sort((a, b) => a - b)
        : [(weekday(s) + 6) % 7];
      let keepGoing = true;
      for (const off of days) {
        const w = { ...addDays(weekStart, off), ...time };
        if (!push(w)) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) break;
    } else if (rule.freq === 'MONTHLY') {
      const total = s.m - 1 + i * rule.interval;
      const y = s.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (rule.bymonth?.length && !rule.bymonth.includes(m)) continue;
      let keepGoing = true;
      for (const d of daysInMonthMatching(y, m, rule, s.d)) {
        if (!push({ y, m, d, ...time })) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) break;
    } else {
      // YEARLY
      const y = s.y + i * rule.interval;
      const months = rule.bymonth?.length ? [...rule.bymonth].sort((a, b) => a - b) : [s.m];
      let keepGoing = true;
      for (const m of months) {
        const days =
          rule.byday?.length || rule.bymonthday?.length ? daysInMonthMatching(y, m, rule, s.d) : s.d <= daysInMonth(y, m) ? [s.d] : [];
        for (const d of days) {
          if (!push({ y, m, d, ...time })) {
            keepGoing = false;
            break;
          }
        }
        if (!keepGoing) break;
      }
      if (!keepGoing) break;
    }
    if (done()) break;
    // 安全閥：開始時間已經超過視窗很多就停
    if (wallToUtc(addDays(s, i * 7), tz) > windowEndMs + 400 * DAY) break;
  }
  return out;
}

/* ───────────── 對外：解析並列出時間範圍內的事件 ───────────── */

/** 列出「開始時間」落在 [fromMs, toMs) 的所有事件（含展開後的重複事件） */
export function eventsBetween(ics: string, fromMs: number, toMs: number): CalEvent[] {
  const raw = parseEvents(ics);
  const masters = raw.filter((e) => !e.recurrenceId);
  const overrides = raw.filter((e) => e.recurrenceId);
  const keyOf = (uid: string, dt: DT) => `${uid}|${wallToUtc(dt.wall, dt.allDay ? 'floating' : dt.tz)}`;
  const overridden = new Set(overrides.map((o) => keyOf(o.uid, o.recurrenceId!)));
  const out: CalEvent[] = [];

  const make = (e: RawEvent, startDt: DT, durationMs: number | null): CalEvent => {
    const start = dtToDate(startDt);
    return {
      uid: e.uid,
      title: e.title || '（沒有標題的行程）',
      start,
      end: durationMs !== null ? new Date(start.getTime() + durationMs) : undefined,
      allDay: startDt.allDay,
      location: e.location,
    };
  };

  for (const e of masters) {
    if (e.cancelled || !e.start) continue;
    const dur = e.end ? dtToDate(e.end).getTime() - dtToDate(e.start).getTime() : null;
    const rule = e.rrule ? parseRRule(e.rrule, e.start.allDay ? 'floating' : e.start.tz) : null;
    if (!rule) {
      const ms = dtToDate(e.start).getTime();
      if (ms >= fromMs && ms < toMs) out.push(make(e, e.start, dur));
      continue;
    }
    const exKeys = new Set(e.exdates.map((x) => keyOf(e.uid, { ...x, allDay: e.start!.allDay, tz: x.tz === 'floating' ? e.start!.tz : x.tz })));
    for (const w of expand(e.start, rule, toMs)) {
      const occ: DT = { wall: w, tz: e.start.tz, allDay: e.start.allDay };
      const k = keyOf(e.uid, occ);
      if (exKeys.has(k) || overridden.has(k)) continue;
      const ms = dtToDate(occ).getTime();
      if (ms >= fromMs && ms < toMs) out.push(make(e, occ, dur));
    }
  }

  for (const o of overrides) {
    if (o.cancelled || !o.start) continue;
    const ms = dtToDate(o.start).getTime();
    if (ms < fromMs || ms >= toMs) continue;
    const dur = o.end ? dtToDate(o.end).getTime() - ms : null;
    out.push(make(o, o.start, dur));
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
}

/** 下載多個日曆的 ICS 並列出範圍內的事件（10 分鐘快取；錯誤訊息不含網址） */
const icsCache = new Map<string, { at: number; text: string }>();
export async function fetchCalendarEvents(urls: string[], fromMs: number, toMs: number): Promise<CalEvent[]> {
  const all: CalEvent[] = [];
  for (const [i, url] of urls.entries()) {
    let text = icsCache.get(url)?.at && Date.now() - icsCache.get(url)!.at < 10 * 60_000 ? icsCache.get(url)!.text : '';
    if (!text) {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!res || !res.ok) throw new Error(`讀不到第 ${i + 1} 個日曆（${res ? `HTTP ${res.status}` : '連線失敗'}），請檢查 GOOGLE_CALENDAR_ICS`);
      text = await res.text();
      icsCache.set(url, { at: Date.now(), text });
    }
    all.push(...eventsBetween(text, fromMs, toMs));
  }
  return all.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** 讀 .env 的 GOOGLE_CALENDAR_ICS（逗號或空白分隔，只接受 https） */
export function calendarUrls(): string[] {
  return (process.env.GOOGLE_CALENDAR_ICS || '')
    .split(/[,\s]+/)
    .map((s: string) => s.trim())
    .filter((s: string) => /^https:\/\//i.test(s));
}

/** 「10:00–11:00」「整天」 */
export function formatEventTime(e: CalEvent): string {
  if (e.allDay) return '整天';
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return e.end && e.end.getTime() > e.start.getTime() ? `${hm(e.start)}–${hm(e.end)}` : hm(e.start);
}
