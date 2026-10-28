/**
 * 事件記憶（事件日記）：記住主人生活中「發生過的事」，並在適當時間主動追問。
 *
 *  - 存在 data/memories/events.json（真實檔案，不受瀏覽器儲存空間影響，也不進 Git）
 *  - 由 /api/memory/compile 在背景把對話整理成事件（每 ~10 則對話或主人離開時）
 *  - 聊天與打招呼時，挑出「到期該追問」「最近」「跟這句話相關」的事件放進提示詞
 */
import fs from 'fs';
import path from 'path';

export type EventCategory = 'life' | 'work' | 'study' | 'health' | 'game' | 'plan' | 'emotion' | 'other';
export type EventStatus = 'open' | 'resolved';

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
}

interface Store {
  events: MemoryEvent[];
}

const MAX_EVENTS = 300;
const ASK_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 問過一次後，12 小時內不再追問同一件事
const MAX_ASKS = 2; // 最多主動問兩次，主人沒回就不再煩他

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
    const added = events.map((e, i) => ({
      ...e,
      id: `evt_${now}_${i}`,
      createdAt: now,
      status: e.status || 'open',
      askCount: 0,
    })) as MemoryEvent[];
    store.events.push(...added);
    // 太多時，優先丟掉「已結束、又不重要」的舊事件
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
    Object.assign(ev, patch, { id: ev.id, createdAt: ev.createdAt });
    return ev;
  }

  function remove(id: string): boolean {
    const store = load();
    const before = store.events.length;
    store.events = store.events.filter((e) => e.id !== id);
    return store.events.length !== before;
  }

  /** 到期該追問、而且最近沒問過的事件（最重要的排前面） */
  function dueFollowUps(now = Date.now(), limit = 2): MemoryEvent[] {
    return load()
      .events.filter(
        (e) =>
          e.status === 'open' &&
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

  /** 給聊天用的事件記憶段落 */
  function contextFor(userText: string, now = Date.now()): { prompt: string; dueIds: string[] } {
    const due = dueFollowUps(now);
    const used = new Set(due.map((e) => e.id));
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = load()
      .events.filter((e) => !used.has(e.id) && e.createdAt >= weekAgo)
      .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
      .slice(0, 5);
    recent.forEach((e) => used.add(e.id));
    const rel = related(userText, used);

    const fmt = (e: MemoryEvent) =>
      `- ${e.date}：${e.summary}${e.outcome ? `（後來：${e.outcome}）` : e.status === 'resolved' ? '（已結束）' : ''}`;
    const parts: string[] = [];
    if (due.length)
      parts.push(
        `【⚠️ 到期該關心的後續：這次回覆一定要像朋友一樣自然地問一句結果，而且要講到關鍵詞（優先於其他往事）。只有在主人正在講很沉重或很急的事時才先不問】\n${due
          .map((e) => `${fmt(e)}［關鍵詞：${e.keyword}］`)
          .join('\n')}`
      );
    if (recent.length) parts.push(`【最近一週主人身上發生的事】\n${recent.map(fmt).join('\n')}`);
    if (rel.length) parts.push(`【跟這句話有關的往事】\n${rel.map(fmt).join('\n')}`);
    return { prompt: parts.join('\n'), dueIds: due.map((e) => e.id) };
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

  return { list, add, update, remove, save, dueFollowUps, contextFor, markAskedIfMentioned };
}

export type EventMemory = ReturnType<typeof createEventMemory>;
