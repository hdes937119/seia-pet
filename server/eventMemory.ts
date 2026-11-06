/**
 * 事件記憶（事件日記）：記住主人生活中「發生過的事」，並在適當時間主動追問。
 *
 *  - 存在 data/memories/events.json（真實檔案，不受瀏覽器儲存空間影響，也不進 Git）
 *  - 由 /api/memory/compile 在背景把對話整理成事件（每 ~10 則對話或主人離開時）
 *  - 聊天與打招呼時，挑出「到期該追問」「最近」「跟這句話相關」的事件放進提示詞
 *  - 遺忘曲線：每件事有「清晰度」，隨時間變淡（越重要忘得越慢），被重新提起就再變清楚。
 *    清楚的給她完整摘要；模糊的只給大概（拿掉細節，她想背也背不出來）；快忘光的只有主人提到時才會隱約想起。
 *    原始紀錄完整保留在檔案裡，只是不給她看。
 */
import fs from 'fs';
import path from 'path';
import { cleanSeqs } from './recall';

export type EventCategory = 'life' | 'work' | 'study' | 'health' | 'game' | 'plan' | 'emotion' | 'other';
export type EventStatus = 'open' | 'resolved' | 'expired';
export type EventActor = 'master' | 'seia' | 'world';

export interface MemoryEvent {
  id: string;
  createdAt: number;
  date: string; // 事件發生 / 被提到的日期 YYYY-MM-DD
  summary: string; // 一句話摘要，例如「說隔天要去面試，很緊張」
  keyword: string; // 追問時一定會用到的關鍵詞，例如「面試」（用來判斷她有沒有真的問）
  category: EventCategory;
  importance: number; // 1~5
  followUpAt: number | null; // 該追問的時間（ms），null = 不需要追問
  status: EventStatus;
  outcome?: string; // 後續結果，例如「面試過了，下週二報到」
  askCount: number; // 已經主動問過幾次
  lastAskedAt?: number;
  gist?: string; // 模糊版：不含數字、人名、細節的一句話（例如「主人工作上遇到很麻煩的事」）
  feeling?: string; // 主人當時的情緒（例如「很煩」）
  recallCount?: number; // 被重新提起幾次（越常提起越不容易忘）
  lastRecalledAt?: number;
  /** 誰做的事：master（主人，預設）｜seia（西雅自己）｜world（河木鎮） */
  actor?: EventActor;
  /** 來源原話編號（stream.jsonl 的 seq） */
  sourceSeqs?: number[];
  /** 計畫／待追問的有效期限（ms）；過了這個時間還沒確認就標成 expired（標失效不刪除） */
  validUntil?: number | null;
  /** 為什麼標成失效 */
  expiredReason?: string;
}

export function inferEventActor(e: Partial<MemoryEvent>): EventActor {
  if (e.actor === 'master' || e.actor === 'seia' || e.actor === 'world') return e.actor;
  const s = String(e.summary || '');
  if (/河木鎮|艾琳|老巴爾|塔莉|米洛/.test(s) && !s.includes('主人')) return 'world';
  if (/^(西雅|希雅|貓娘|本喵)/.test(s) && !s.includes('主人')) return 'seia';
  return 'master';
}

/* ───────────── 遺忘曲線 ───────────── */

const DAY = 24 * 60 * 60 * 1000;
/** 清晰度剩一半所需的天數（依重要程度） */
const HALF_LIFE_DAYS: Record<number, number> = { 1: 3, 2: 7, 3: 14, 4: 30, 5: 60 };

export type Clarity = 'clear' | 'fuzzy' | 'faded' | 'gone';

/** 0 ~ 1：1 = 剛發生、記得很清楚 */
export function clarityScore(e: MemoryEvent, now = Date.now()): number {
  // 還沒結束、該追問的事：她一直惦記著，不會忘
  if (e.status === 'open' && e.followUpAt !== null && e.followUpAt !== undefined) return 1;
  const base = HALF_LIFE_DAYS[Math.round(e.importance)] ?? 14;
  // 每被提起一次，半衰期變長（間隔複習）
  const halfLife = base * Math.pow(1.8, Math.min(e.recallCount || 0, 6));
  const since = now - Math.max(e.createdAt, e.lastRecalledAt || 0);
  return Math.pow(0.5, since / (halfLife * DAY));
}

export function clarityOf(e: MemoryEvent, now = Date.now()): Clarity {
  const c = clarityScore(e, now);
  return c >= 0.5 ? 'clear' : c >= 0.2 ? 'fuzzy' : c >= 0.06 ? 'faded' : 'gone';
}

const CATEGORY_LABEL: Record<string, string> = {
  life: '生活上',
  work: '工作上',
  study: '讀書上',
  health: '身體',
  game: '遊戲',
  plan: '計畫中',
  emotion: '心情上',
  other: '',
};

/** 模糊的時間感：「大概兩週前」而不是精確日期 */
function vagueWhen(ms: number, now = Date.now()): string {
  const days = (now - ms) / DAY;
  if (days < 2) return '前幾天';
  if (days < 6) return '這幾天';
  if (days < 11) return '大概一週前';
  if (days < 25) return '大概兩三週前';
  if (days < 50) return '大概一個多月前';
  if (days < 120) return '幾個月前';
  return '很久以前';
}

interface Store {
  events: MemoryEvent[];
}

const MAX_EVENTS = 300;
const ASK_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 問過一次後，12 小時內不再追問同一件事
const MAX_ASKS = 2; // 最多主動問兩次，主人沒回就不再煩他
/** 過了預計追問時間多久還沒後續紀錄，就改成「開放式問法」（不要假設一定發生了） */
export const OVERDUE_OPEN_ASK_MS = 24 * 60 * 60 * 1000;
/** 過了預計追問時間多久還沒確認結果，就標成 expired（標失效不刪除） */
const PLAN_EXPIRE_AFTER_FOLLOWUP_MS = 72 * 60 * 60 * 1000;
/** 沒有設追問時間的計畫類事件，預設有效期間 7 天 */
const PLAN_NO_FOLLOWUP_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

export function isOverduePlan(e: MemoryEvent, now = Date.now()): boolean {
  return e.status === 'open' && e.followUpAt !== null && e.followUpAt !== undefined && now - e.followUpAt > OVERDUE_OPEN_ASK_MS;
}

export function createEventMemory(dataDir: string) {
  const dir = path.join(dataDir, 'memories');
  const file = path.join(dir, 'events.json');
  let cache: Store | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  function load(): Store {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = { events: Array.isArray(parsed?.events) ? parsed.events : [] };
    } catch {
      cache = { events: [] };
    }
    return cache;
  }

  /** 依序寫入（排隊），避免兩個請求同時寫壞檔案；先寫暫存檔再改名，寫到一半當機也不會毀損 */
  function save(): Promise<void> {
    const snapshot = JSON.stringify(load(), null, 2);
    writeChain = writeChain
      .then(async () => {
        await fs.promises.mkdir(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, snapshot, 'utf8');
        await fs.promises.rename(tmp, file);
      })
      .catch((err) => console.error('[事件記憶] 儲存失敗:', err?.message));
    return writeChain;
  }

  function list(): MemoryEvent[] {
    return [...load().events].sort((a, b) => b.createdAt - a.createdAt);
  }

  function add(events: Array<Omit<MemoryEvent, 'id' | 'createdAt' | 'askCount' | 'status'> & Partial<MemoryEvent>>) {
    const store = load();
    const now = Date.now();
    const added = events.map((e, i) => {
      const seqs = cleanSeqs(e.sourceSeqs, 8);
      const actor = inferEventActor(e);
      const followUpAt = e.followUpAt ?? null;
      const validUntil =
        e.validUntil !== undefined
          ? e.validUntil
          : followUpAt !== null
            ? followUpAt + PLAN_EXPIRE_AFTER_FOLLOWUP_MS
            : e.category === 'plan'
              ? now + PLAN_NO_FOLLOWUP_EXPIRE_MS
              : null;
      return {
        ...e,
        id: `evt_${now}_${i}`,
        createdAt: now,
        status: e.status || 'open',
        askCount: 0,
        actor,
        ...(seqs.length ? { sourceSeqs: seqs } : {}),
        ...(validUntil !== null ? { validUntil } : {}),
      };
    }) as MemoryEvent[];
    store.events.push(...added);
    // 太多時，優先丟掉「已結束或已過期、又不重要」的舊事件
    if (store.events.length > MAX_EVENTS) {
      store.events.sort(
        (a, b) =>
          Number(a.status === 'open') - Number(b.status === 'open') ||
          a.importance - b.importance ||
          a.createdAt - b.createdAt
      );
      store.events.splice(0, store.events.length - MAX_EVENTS);
    }
    return added;
  }

  function update(id: string, patch: Partial<MemoryEvent>): MemoryEvent | null {
    const ev = load().events.find((e) => e.id === id);
    if (!ev) return null;
    const mergedSeqs = patch.sourceSeqs ? cleanSeqs([...(ev.sourceSeqs || []), ...patch.sourceSeqs], 10) : ev.sourceSeqs;
    Object.assign(ev, patch, {
      id: ev.id,
      createdAt: ev.createdAt,
      ...(mergedSeqs && mergedSeqs.length ? { sourceSeqs: mergedSeqs } : {}),
    });
    return ev;
  }

  function remove(id: string): boolean {
    const store = load();
    const before = store.events.length;
    store.events = store.events.filter((e) => e.id !== id);
    return store.events.length !== before;
  }

  /**
   * 計畫／待追問事件的有效期間檢查：
   * 過了有效期限（預計追問時間 + 3 天，或已追問滿 2 次且又過 24 小時）仍沒有後續證據 → 標成 expired（標失效不刪除）。
   */
  function expireStalePlans(now = Date.now(), hasRecentEvidence?: (e: MemoryEvent) => boolean): MemoryEvent[] {
    const expired: MemoryEvent[] = [];
    for (const e of load().events) {
      if (e.status !== 'open') continue;
      const deadline =
        e.validUntil ??
        (e.followUpAt !== null && e.followUpAt !== undefined
          ? e.followUpAt + PLAN_EXPIRE_AFTER_FOLLOWUP_MS
          : e.category === 'plan'
            ? e.createdAt + PLAN_NO_FOLLOWUP_EXPIRE_MS
            : null);
      const askedOut =
        e.followUpAt !== null &&
        e.followUpAt !== undefined &&
        e.askCount >= MAX_ASKS &&
        Boolean(e.lastAskedAt && now - e.lastAskedAt > OVERDUE_OPEN_ASK_MS);
      const pastDeadline = deadline !== null && now > deadline;
      if (!pastDeadline && !askedOut) continue;
      if (hasRecentEvidence?.(e)) continue;
      e.status = 'expired';
      e.expiredReason = askedOut ? '問過兩次仍無後續紀錄（標失效保留）' : '過了預計時間沒有後續紀錄（標失效保留）';
      expired.push(e);
    }
    if (expired.length) void save();
    return expired;
  }

  /** 到期該追問、而且最近沒問過的「主人」事件（最重要的排前面；西雅自己或河木鎮的事不追問主人） */
  function dueFollowUps(now = Date.now(), limit = 2): MemoryEvent[] {
    return load()
      .events.filter(
        (e) =>
          e.status === 'open' &&
          inferEventActor(e) === 'master' &&
          e.followUpAt !== null &&
          e.followUpAt <= now &&
          e.askCount < MAX_ASKS &&
          (!e.lastAskedAt || now - e.lastAskedAt > ASK_COOLDOWN_MS)
      )
      .sort((a, b) => b.importance - a.importance || (a.followUpAt ?? 0) - (b.followUpAt ?? 0))
      .slice(0, limit);
  }

  /** 跟主人這句話有關的舊事件：用中文雙字詞 / 英文單字做簡單比對 */
  function related(text: string, exclude: Set<string>, limit = 2): MemoryEvent[] {
    const tokens = new Set<string>();
    const cjk = text.match(/[㐀-鿿]+/g) || [];
    for (const run of cjk) for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
    for (const w of text.toLowerCase().match(/[a-z0-9]{3,}/g) || []) tokens.add(w);
    if (tokens.size === 0) return [];
    return load()
      .events.filter((e) => !exclude.has(e.id))
      .map((e) => {
        const hay = `${e.keyword} ${e.summary} ${e.outcome || ''}`.toLowerCase();
        let score = 0;
        for (const t of tokens) if (hay.includes(t)) score++;
        if (e.keyword && text.includes(e.keyword)) score += 3;
        return { e, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score || b.e.createdAt - a.e.createdAt)
      .slice(0, limit)
      .map((x) => x.e);
  }

  /** 依清晰度寫出她「記得的樣子」 */
  function recollection(e: MemoryEvent, now = Date.now(), withId = false): string {
    const idPrefix = withId ? `[${e.id}] ` : '';
    const actor = inferEventActor(e);
    const actorNote = actor === 'seia' ? '【你自己（西雅）的事，不是主人做的】' : actor === 'world' ? '【河木鎮的事，不是主人現實中的事】' : '';
    if (e.status === 'expired') {
      return `- ${idPrefix}${e.date}【當時的計畫，後來沒確認有沒有成】：${actorNote}${e.summary}（已過有效期間沒確認結果，不要當成一定發生過的事）`;
    }
    const level = clarityOf(e, now);
    if (level === 'clear') {
      return `- ${idPrefix}${e.date}【記得很清楚】：${actorNote}${e.summary}${e.outcome ? `（後來：${e.outcome}）` : e.status === 'resolved' ? '（已結束）' : ''}`;
    }
    const when = vagueWhen(e.createdAt, now);
    const what = e.gist || `跟「${e.keyword}」有關的${CATEGORY_LABEL[e.category] ?? ''}事`;
    const feeling = e.feeling ? `，你記得主人那時候${e.feeling}` : '';
    if (level === 'fuzzy') {
      const after = e.status === 'resolved' ? '，後來好像有結果了但你忘了是什麼' : '';
      return `- ${idPrefix}${when}【有點模糊】：${actorNote}好像是${what}${feeling}${after}（細節你記不清楚了）`;
    }
    return `- ${idPrefix}${when}【快忘光了】：${actorNote}隱約記得跟「${e.keyword}」有關（其他都想不起來）`;
  }

  /** 主人提起、或她自己講到 → 這件事重新變清楚 */
  function recall(ids: string[], now = Date.now()) {
    let changed = false;
    for (const id of ids) {
      const ev = load().events.find((e) => e.id === id);
      if (!ev) continue;
      ev.recallCount = (ev.recallCount || 0) + 1;
      ev.lastRecalledAt = now;
      changed = true;
    }
    if (changed) void save();
  }

  /** 給聊天用的事件記憶段落 */
  /**
   * freshLines：給到期的事附上「原話回憶裡關於它最近的幾句」（讀取時以原話為準：
   * 摘要可能已經過期，例如答應要做的東西其實已經做好了）
   */
  function contextFor(userText: string, now = Date.now(), freshLines?: (e: MemoryEvent) => string[]): { prompt: string; dueIds: string[]; shownIds: string[] } {
    const due = dueFollowUps(now);
    const used = new Set(due.map((e) => e.id));
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    // 「最近的事」：只放還記得的（清楚或模糊），過期失效或忘光的不會自己冒出來
    const recent = load()
      .events.filter((e) => !used.has(e.id) && e.status !== 'expired' && e.createdAt >= weekAgo && clarityScore(e, now) >= 0.2)
      .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
      .slice(0, 5);
    recent.forEach((e) => used.add(e.id));
    // 「跟這句話有關的往事」：主人提起了，連快忘光的也會隱約想起（完全忘掉的就想不起來了）
    const rel = related(userText, used).filter((e) => clarityOf(e, now) !== 'gone');

    const fmt = (e: MemoryEvent) => recollection(e, now, true);
    const parts: string[] = [];
    if (due.length)
      parts.push(
        `【⚠️ 到期該關心的後續：這次回覆要像朋友一樣自然地問一句結果，而且要講到關鍵詞（優先於其他往事）。只有在主人正在講很沉重或很急的事、在忙或打遊戲、或只回很短的話時才先不問，下次再問。每件底下如果附了「最近的原話」，以原話為準：原話裡已經看得出結果（做好了、去過了、取消了），就不要再問，當作已經結束】\n${due
          .map((e) => {
            const fresh = (freshLines?.(e) || []).slice(-4);
            const overdueNote = isOverduePlan(e, now)
              ? '（⚠️ 這件事已經過了預計時間超過一天且還沒有後續紀錄，不確定主人後來有沒有去做；請用「後來有…嗎？」這種開放式問法，不要直接假設已經發生了）'
              : '';
            return `${fmt(e)}［關鍵詞：${e.keyword}］${overdueNote}${fresh.length ? `\n　關於這件事最近的原話：\n${fresh.map((l) => `　${l}`).join('\n')}` : ''}`;
          })
          .join('\n')}`
      );
    if (recent.length) parts.push(`【最近一週主人身上發生的事】\n${recent.map(fmt).join('\n')}`);
    if (rel.length) parts.push(`【跟這句話有關的往事】\n${rel.map(fmt).join('\n')}`);
    // 主人自己提起的舊事 → 這次照原本的模糊程度回想（「喔對，好像有這回事」），之後才記得比較牢
    if (rel.length) recall(rel.map((e) => e.id), now);
    if (parts.length)
      parts.push(
        '（記憶的清晰度：【記得很清楚】可以講細節；【有點模糊】只能用「我記得你好像…但細節忘了」的口吻講大概，絕對不要自己補細節；【快忘光了】只能說隱約有印象，可以反問主人。這是你真實的記憶狀態，不要假裝記得更多。）'
      );
    return {
      prompt: parts.join('\n'),
      dueIds: due.map((e) => e.id),
      shownIds: [...due, ...recent, ...rel].map((e) => e.id),
    };
  }

  /** 她的回覆裡講到某件事的關鍵詞 → 那件事被「想起來」，清晰度回升 */
  function markRecalledIfMentioned(ids: string[], reply: string, now = Date.now()) {
    const hit = ids.filter((id) => {
      const ev = load().events.find((e) => e.id === id);
      return ev && ev.keyword && reply.includes(ev.keyword);
    });
    if (hit.length) recall(hit, now);
  }

  /** 她的回覆裡真的提到關鍵詞，才算「問過了」 */
  function markAskedIfMentioned(ids: string[], reply: string, now = Date.now()) {
    let changed = false;
    for (const id of ids) {
      const ev = load().events.find((e) => e.id === id);
      if (ev && ev.keyword && reply.includes(ev.keyword)) {
        ev.askCount += 1;
        ev.lastAskedAt = now;
        changed = true;
      }
    }
    if (changed) void save();
  }

  return { list, add, update, remove, save, dueFollowUps, expireStalePlans, contextFor, markAskedIfMentioned, markRecalledIfMentioned, recall };
}

export type EventMemory = ReturnType<typeof createEventMemory>;
