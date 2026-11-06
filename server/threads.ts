/**
 * 話頭筆記（讓她的對話有「前後文」和「自己的念頭」）。
 * 借 AstrBot private_companion 的「主動候選／追問」和 dsh 插件「回合結束後再想一次」的做法：
 *
 *  每次聊完（桌面或 LINE），在背景用便宜的模型「回想一下剛剛的對話」，更新三樣東西：
 *   1. 這段對話的摘要：在聊什麼、已經講定了什麼、主人現在的狀態（讓 20 則視窗外的事也接得上）
 *   2. 話頭：值得之後再接回來的東西（主人隨口提到的事、約好的事、她問了但主人沒回答的、她自己好奇的）
 *   3. 想追問的一句：如果主人安靜了一陣子，她可以自己再補一句（「對了，剛剛你說…」）
 *  另外記住她最近問過主人的問題，避免同一件事一直問（例如一直追問開發進度）。
 *
 * 聊天提示詞會帶上摘要＋最多 3 個話頭；追問由 server.ts 在主人安靜一段時間後、經過主動說話閘門才送出。
 * 存在 data/memories/threads.json。
 */
import fs from 'fs';
import path from 'path';
import { cleanSeqs } from './recall';

export interface Thread {
  id: string;
  text: string;
  /** ask：她問了主人還沒回答；followup：主人提到、之後可以問進展；plan：約好的事；mine：她自己好奇／想分享 */
  kind: 'ask' | 'followup' | 'plan' | 'mine';
  score: number;
  createdAt: number;
  status: 'open' | 'used' | 'dropped';
  usedAt?: number;
  /** 來源原話編號（stream.jsonl 的 seq） */
  sourceSeqs?: number[];
}

export interface FollowUp {
  text: string;
  score: number;
  /** 主人安靜多久之後才說（秒） */
  waitSec: number;
  createdAt: number;
  /** 根據哪一則主人的訊息想出來的（主人又開口就作廢） */
  afterMasterAt: number;
  sent?: boolean;
  /** 來源原話編號（stream.jsonl 的 seq） */
  sourceSeqs?: number[];
}

interface State {
  summary: string;
  summaryAt: number;
  threads: Thread[];
  /** 她最近問過主人的問題（避免重複問） */
  asked: Array<{ text: string; at: number }>;
  followUp: FollowUp | null;
}

export interface ChatLine {
  role: 'user' | 'pet';
  text: string;
  at?: number;
  source?: 'line' | 'desktop';
  seq?: number;
}

const MAX_OPEN = 6;
const COOLDOWN_MS = 40 * 1000;
const SUMMARY_STALE_MS = 8 * 60 * 60 * 1000;
const THREAD_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const uid = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

function bigrams(t: string) {
  const c = String(t).replace(/[^\p{L}\p{N}]/gu, '');
  const out = new Set<string>();
  for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
  return out;
}
function overlap(a: string, b: string) {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return hit / Math.min(x.size, y.size);
}

/** 她這句回覆裡問了主人什麼（抓問句） */
export function extractQuestions(reply: string): string[] {
  return String(reply || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[[^\]]*\]\]/g, '\n')
    .split(/(?<=[？?])|\n/)
    .map((s) => s.replace(/^[！!，,。．.～~\s]+/, '').trim())
    .filter((s) => /[？?]$/.test(s) && s.replace(/[^\p{L}\p{N}]/gu, '').length >= 6)
    .slice(0, 3);
}

export interface ThreadsDeps {
  generateJson: (prompt: string) => Promise<any>;
  log?: (m: string) => void;
}

export function createThreads(dataDir: string, deps: ThreadsDeps) {
  const file = path.join(dataDir, 'memories', 'threads.json');
  const log = deps.log || console.log;
  let st: State = { summary: '', summaryAt: 0, threads: [], asked: [], followUp: null };
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
        st.threads = st.threads.slice(-40);
        st.asked = st.asked.slice(-20);
        fs.writeFileSync(file, JSON.stringify(st, null, 2));
      } catch (err: any) {
        log(`[話頭] 儲存失敗：${err?.message}`);
      }
    }, 800);
  };

  const open = (now = Date.now()) => {
    let changed = false;
    for (const t of st.threads) {
      if (t.status === 'open' && now - t.createdAt > THREAD_TTL_MS) {
        t.status = 'dropped';
        changed = true;
      }
    }
    if (changed) save();
    return st.threads.filter((t) => t.status === 'open').sort((a, b) => b.score - a.score);
  };

  /** 主人開口了 → 還沒送出的追問作廢（主人已經在聊別的了） */
  function masterSpoke() {
    if (st.followUp && !st.followUp.sent) {
      st.followUp = null;
      save();
    }
  }

  /** 她回完一句：記下她問了什麼、哪些話頭被她接回去了 */
  function afterReply(reply: string, now = Date.now()) {
    for (const q of extractQuestions(reply)) st.asked.push({ text: q.slice(0, 60), at: now });
    for (const t of open(now)) {
      if (overlap(t.text, reply) >= 0.45) {
        t.status = 'used';
        t.usedAt = now;
      }
    }
    save();
  }

  /** 給聊天提示詞 */
  function describeForChat(now = Date.now(), opts?: { withIds?: boolean }): string {
    const parts: string[] = [];
    const withIds = Boolean(opts?.withIds);
    if (st.summary && now - st.summaryAt < SUMMARY_STALE_MS) parts.push(`【這段對話到目前為止】${st.summary}`);
    const top = open(now).slice(0, 3);
    if (top.length) {
      const label: Record<Thread['kind'], string> = { ask: '你問了還沒得到回答', followup: '可以問後續', plan: '你們約好的事', mine: '你自己好奇' };
      parts.push(`【可以接回來的話頭】\n${top.map((t) => `- ${withIds ? `[${t.id}] ` : ''}${t.text}（${label[t.kind]}）`).join('\n')}`);
    }
    const recentAsked = st.asked.filter((a) => now - a.at < 6 * 60 * 60 * 1000).slice(-5);
    if (recentAsked.length) parts.push(`【你最近已經問過主人的】${recentAsked.map((a) => `「${a.text}」`).join('、')}（主人回答過或沒接話就不要再問一樣的事）`);
    if (!parts.length) return '';
    parts.push(
      '（聊天方式：像真的朋友一樣，記得前面聊過的內容，接著聊下去；回應完主人這句之後，如果氣氛適合，可以自然地反問一句、或接回上面一個話頭，一次最多一個。主人在忙、在打遊戲、或只回很短的話時就不要追問。不要像在做訪問，不要每句都以問句結尾。）'
    );
    return parts.join('\n');
  }

  let running = false;
  let lastRunAt = 0;

  function prompt(lines: ChatLine[], persona: string) {
    const fmt = (l: ChatLine) =>
      `${l.seq ? `[#${l.seq}] ` : ''}${l.role === 'user' ? '主人' : '西雅'}${l.source === 'line' ? '（LINE）' : ''}：${String(l.text).replace(/\[\[NEXT\]\]/g, ' / ').slice(0, 300)}`;
    return `你是貓娘「西雅」的內心。剛剛她和主人聊了下面這段，請在心裡回想一次，整理成筆記。
${persona}

【之前的摘要】${st.summary || '（沒有）'}
【之前記下的話頭】
${open().map((t) => `${t.id}｜${t.kind}｜${t.text}`).join('\n') || '（沒有）'}
【她最近問過主人的】${st.asked.slice(-5).map((a) => a.text).join('；') || '（沒有）'}

【最近的對話（舊→新）】
${lines.map(fmt).join('\n')}

請輸出：
1. summary：這段對話到目前為止的重點（80～160 字）：在聊什麼、已經講定或主人回答了什麼、主人現在的狀態和心情。只寫對話裡真的有的。
2. add：新的「之後值得接回來的話頭」，最多 2 個，每個 30 字內，只能根據對話裡真的出現的內容，並附上 sourceSeqs（來自【最近的對話】哪幾句的 #編號，例如 [120, 121]）：
   - ask：她問了主人、主人還沒回答（主人已經回答的不要）
   - plan：兩人約好或說好「下次」要做的事
   （主人提到之後會有結果的事——考試、比賽、身體不舒服、在等東西——另外有「事件記憶」會記、到時候提醒她問，這裡不要記）
   - mine：她自己對主人說的某件事真的好奇、想多知道的
   score 0～1：越重要、越自然越高。已經在「之前記下的話頭」裡的不要重複。
3. close：已經聊完、主人回答了、或不再相關的話頭 id。
4. followUp：如果主人現在安靜下來，她過一會兒會自己補一句什麼嗎？（像朋友過幾分鐘又想到「對了，剛剛…」）
   要嘛是 null，要嘛是 { "text": "25 字內、用她的口吻", "score": 0～1, "waitSec": 90～600, "sourceSeqs": [根據哪幾句 #編號] }。
   對話已經自然結束（道晚安、說要去忙、主人說等等再聊）、或沒有真的值得說的，就給 null。不要問「她最近問過主人的」一樣的事。
只輸出一份 JSON：{ "summary": "…", "add": [{ "text": "…", "kind": "plan", "score": 0.6, "sourceSeqs": [120] }], "close": ["t-…"], "followUp": null }`;
  }

  /** 聊完之後在背景呼叫（不用等） */
  async function reflect(lines: ChatLine[], persona: string, masterAt: number, now = Date.now()) {
    if (running || now - lastRunAt < COOLDOWN_MS) return;
    const recent = lines.filter((l) => l.text && l.text.trim()).slice(-14);
    if (recent.length < 2) return;
    const validSeqMap = new Map<number, string>();
    for (const l of recent) if (typeof l.seq === 'number' && l.seq > 0) validSeqMap.set(l.seq, l.text);
    running = true;
    lastRunAt = now;
    try {
      const out = await deps.generateJson(prompt(recent, persona));
      const summary = String(out?.summary || '').trim();
      if (summary) {
        st.summary = summary.slice(0, 240);
        st.summaryAt = Date.now();
      }
      const closeIds = new Set((Array.isArray(out?.close) ? out.close : []).map(String));
      for (const t of st.threads) if (t.status === 'open' && closeIds.has(t.id)) t.status = 'used';
      for (const a of Array.isArray(out?.add) ? out.add.slice(0, 2) : []) {
        const text = String(a?.text || '').trim().slice(0, 40);
        const kind = ['ask', 'plan', 'mine'].includes(a?.kind) ? a.kind : 'mine';
        if (!text || open().some((t) => overlap(t.text, text) >= 0.5)) continue;
        const seqs = cleanSeqs(a?.sourceSeqs, 6).filter((s) => !validSeqMap.size || validSeqMap.has(s));
        st.threads.push({
          id: uid(),
          text,
          kind,
          score: Math.max(0, Math.min(1, Number(a?.score) || 0.5)),
          createdAt: Date.now(),
          status: 'open',
          ...(seqs.length ? { sourceSeqs: seqs } : {}),
        });
      }
      // 開著的話頭太多：留分數高的
      const o = open();
      for (const t of o.slice(MAX_OPEN)) t.status = 'dropped';
      const f = out?.followUp;
      const ftext = String(f?.text || '').trim();
      const fseqs = cleanSeqs(f?.sourceSeqs, 4).filter((s) => !validSeqMap.size || validSeqMap.has(s));
      const citedText = fseqs.length
        ? fseqs.map((s) => validSeqMap.get(s) || '').join(' ')
        : recent.map((l) => l.text).join(' ');
      const hasCitedOverlap = bigrams(ftext).size === 0 || [...bigrams(ftext)].some((g) => bigrams(citedText).has(g));
      if (ftext && (!validSeqMap.size || fseqs.length > 0) && hasCitedOverlap && !st.asked.slice(-5).some((a) => overlap(a.text, ftext) >= 0.5)) {
        st.followUp = {
          text: ftext.slice(0, 50),
          score: Math.max(0, Math.min(1, Number(f?.score) || 0)),
          waitSec: Math.max(90, Math.min(600, Number(f?.waitSec) || 180)),
          createdAt: Date.now(),
          afterMasterAt: masterAt,
          ...(fseqs.length ? { sourceSeqs: fseqs } : {}),
        };
      } else {
        if (ftext && ((validSeqMap.size && !fseqs.length) || !hasCitedOverlap)) {
          log(`[話頭] 追問「${ftext.slice(0, 30)}」沒有對上原話編號或關鍵詞，擋掉`);
        }
        st.followUp = null;
      }
      save();
      log(`[話頭] 想了一下：開著 ${open().length} 個話頭${st.followUp ? `；想追問「${st.followUp.text}」（${st.followUp.score.toFixed(2)}）` : ''}`);
    } catch (err: any) {
      log(`[話頭] 回想失敗：${err?.status || err?.message}`);
    } finally {
      running = false;
    }
  }

  /** 該不該送追問了（主人安靜夠久、分數夠高、主人沒有又開口） */
  function dueFollowUp(lastMasterAt: number, now = Date.now(), minScore = 0.65): FollowUp | null {
    const f = st.followUp;
    if (!f || f.sent || f.score < minScore) return null;
    if (lastMasterAt > f.afterMasterAt) return null; // 主人又說話了
    if (now - f.createdAt > 30 * 60 * 1000) return null; // 太久了，不自然
    if (now - Math.max(lastMasterAt, f.createdAt) < f.waitSec * 1000) return null;
    return f;
  }

  function markFollowUpSent(now = Date.now()) {
    if (!st.followUp) return;
    st.followUp.sent = true;
    st.asked.push({ text: st.followUp.text.slice(0, 60), at: now });
    save();
  }

  function snapshot() {
    return { ...st, open: open() };
  }

  return { masterSpoke, afterReply, describeForChat, reflect, dueFollowUp, markFollowUpSent, snapshot };
}

export type Threads = ReturnType<typeof createThreads>;
