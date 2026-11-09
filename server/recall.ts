/**
 * 原話回憶（借 dsh-hippocampus「自動記、按線索想、會變淡」的設計，MIT；這裡是重新寫的簡化版）。
 *
 *  - 每一句對話（桌面＋LINE，主人和她）原封不動追加到 data/memories/stream.jsonl，只增不改、不刪。
 *    這是唯一的原始紀錄；索引都在記憶體裡、每次啟動重建。
 *  - 主人說話時，用這句話當線索，從「目前對話視窗以外」的舊對話裡用 BM25（中文用兩字一組切詞）找最像的幾段，
 *    帶上前後一句，放進提示詞讓她「隱約想起來」。
 *  - 會變淡：越舊的紀錄越不容易被想起（半衰期 30 天），但紀錄本身不刪；主人用很具體的詞提起，還是想得起來。
 *  - 不用 embedding、不用資料庫、不花 API 錢。
 */
import fs from 'fs';
import path from 'path';

export interface StreamRecord {
  seq: number;
  at: number;
  role: 'user' | 'pet';
  text: string;
  ch: 'desktop' | 'line';
}

/** 整理模型回傳的原話編號（只留正整數、去重、由小到大） */
export function cleanSeqs(raw: unknown, max = 6): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const x of raw) {
    const n = typeof x === 'string' ? Number(x.replace(/^#/, '').trim()) : Number(x);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b).slice(-max);
}

const HALF_LIFE_DAYS = 30;
/** 最近這段時間的對話已經在上下文裡了，不用「回想」 */
const SKIP_RECENT_MS = 3 * 60 * 60 * 1000;
/** 中到的詞夠不夠特別（idf 加總），以及最後分數的門檻 */
const MIN_IDF_SUM = 5.5;
const MIN_SCORE = 2.0;
const K1 = 1.4;
const B = 0.75;
const STOP = new Set(['喵喵', '主人', '本喵', '什麼', '怎麼', '這個', '那個', '我們', '你們', '就是', '然後', '可以', '沒有', '不是', '真的', '一下', '一個', '現在', '知道', '覺得', '還是', '因為', '所以', '如果', '這樣', '那樣', '的話']);

/** 切詞：中日文兩字一組、英文數字一個單字 */
export function tokenize(text: string): string[] {
  const t = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .toLowerCase();
  const out: string[] = [];
  for (const m of t.match(/[a-z0-9][a-z0-9'.+-]{1,}/g) || []) out.push(m);
  for (const run of t.match(/[぀-ヿ㐀-鿿]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) {
      const g = run.slice(i, i + 2);
      if (!STOP.has(g)) out.push(g);
    }
  }
  return out;
}

export function createRecall(dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'memories', 'stream.jsonl');
  const recs: StreamRecord[] = [];
  const docs: Array<Map<string, number>> = [];
  const lens: number[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;
  let seq = 0;
  /** 去重：同一個人說的同一句話（10 分鐘內）只記一次 */
  const lastSeen = new Map<string, number>();
  const lastSeenSeq = new Map<string, number>();
  const bySeqIdx = new Map<number, number>();
  const dupKey = (role: string, text: string) => `${role}|${text}`;
  /** 11/9：後端記完整回覆、前端又把拆開的每一句送來 → 同一段話記兩次。她的一句話如果包含在 10 分鐘內她另一則更長的回覆裡，就是分段，不再記 */
  const segNorm = (t: string) => String(t || '').replace(/\[\[[A-Z]+(:[^\]]*)?\]\]/g, '').replace(/\s+/g, '');
  function isSegmentOf(role: string, text: string, at: number): boolean {
    if (role !== 'pet') return false;
    const n = segNorm(text);
    if (n.length < 2) return false;
    // 11/9：分段常常晚好幾句才送來 → 往回看 400 句（用時間判斷，不用句數）
    for (let i = recs.length - 1, k = 0; i >= 0 && k < 400; i--, k++) {
      const p = recs[i];
      if (p.role !== 'pet' || Math.abs(p.at - at) > 10 * 60 * 1000) continue;
      const pn = segNorm(p.text);
      if (pn.length > n.length && pn.includes(n)) return true;
    }
    return false;
  }

  function index(r: StreamRecord) {
    const tf = new Map<string, number>();
    const toks = tokenize(r.text);
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    recs.push(r);
    bySeqIdx.set(r.seq, recs.length - 1);
    docs.push(tf);
    lens.push(toks.length);
    totalLen += toks.length;
    seq = Math.max(seq, r.seq);
    const k = dupKey(r.role, r.text);
    lastSeen.set(k, r.at);
    lastSeenSeq.set(k, r.seq);
  }

  try {
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (r && typeof r.text === 'string') {
            if (isSegmentOf(r.role, r.text, Number(r.at) || 0)) {
              seq = Math.max(seq, Number(r.seq) || 0);
              continue;
            }
            index(r);
          }
        } catch {
          // 壞掉的一行跳過
        }
      }
    }
  } catch (err: any) {
    log(`[回憶] 讀取失敗：${err?.message}`);
  }

  /** 記下一句話（同一句在 2 分鐘內重複送來就不記） */
  function append(role: StreamRecord['role'], text: string, ch: StreamRecord['ch'], at = Date.now()) {
    const clean = String(text || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\[\[NEXT\]\]/g, '\n')
      .trim();
    if (!clean) return;
    const seen = lastSeen.get(dupKey(role, clean.slice(0, 2000)));
    if (seen !== undefined && Math.abs(at - seen) < 10 * 60 * 1000) return;
    if (isSegmentOf(role, clean, at)) return;
    const r: StreamRecord = { seq: seq + 1, at, role, text: clean.slice(0, 2000), ch };
    index(r);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(r) + '\n');
    } catch (err: any) {
      log(`[回憶] 寫入失敗：${err?.message}`);
    }
  }

  /** 一次記好幾句（桌面每次會送最近的對話來：已經記過的會自動跳過，順便補上以前沒記到的） */
  function appendMany(lines: Array<{ role: StreamRecord['role']; text: string; at?: number; ch: StreamRecord['ch'] }>) {
    for (const l of [...lines].sort((a, b) => (a.at || 0) - (b.at || 0))) append(l.role, l.text, l.ch, l.at || Date.now());
  }

  /** 用主人這句話當線索，找以前聊過的片段（每段＝符合的那句＋前後一句） */
  function search(query: string, now = Date.now(), max = 2) {
    const q = [...new Set(tokenize(query))];
    if (q.length < 2 || !recs.length) return [];
    const N = recs.length;
    const avg = totalLen / N || 1;
    const scored: Array<{ i: number; s: number }> = [];
    for (let i = 0; i < N; i++) {
      const r = recs[i];
      if (now - r.at < SKIP_RECENT_MS) continue;
      const tf = docs[i];
      let s = 0;
      let idfSum = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const n = df.get(t) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        idfSum += idf;
        s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * lens[i]) / avg));
      }
      // 只中到很常見的詞（「晚上」「好看」）太像巧合：中到的詞要夠特別
      if (idfSum < MIN_IDF_SUM) continue;
      const ageDays = (now - r.at) / 86_400_000;
      s *= Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      scored.push({ i, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const picked: number[] = [];
    for (const x of scored) {
      if (x.s < MIN_SCORE) break;
      if (picked.some((p) => Math.abs(p - x.i) <= 2)) continue; // 同一段只拿一次
      picked.push(x.i);
      if (picked.length >= max) break;
    }
    return picked.map((i) => {
      // 前後一句：只帶同一段對話裡的（20 分鐘內）
      const near = (j: number) => j >= 0 && j < recs.length && Math.abs(recs[j].at - recs[i].at) <= 20 * 60 * 1000;
      const lines = [near(i - 1) ? recs[i - 1] : null, recs[i], near(i + 1) ? recs[i + 1] : null].filter(Boolean) as StreamRecord[];
      return { at: recs[i].at, lines };
    });
  }

  const fmtWhen = (ms: number, now: number) => {
    const days = Math.floor((now - ms) / 86_400_000);
    const d = new Date(ms);
    const h = d.getHours();
    const part = h < 6 ? '半夜' : h < 11 ? '早上' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上';
    if (days < 1) return `今天${part}`;
    if (days < 2) return `昨天${part}`;
    if (days < 7) return `${days} 天前的${part}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${part}`;
  };

  /** 給聊天提示詞 */
  function describeForChat(query: string, now = Date.now()): string {
    const found = search(query, now);
    if (!found.length) return '';
    const cut = (t: string) => (t.length > 80 ? `${t.slice(0, 78)}…` : t).replace(/\s+/g, ' ');
    return (
      `【跟這句話有關、你以前跟主人聊過的（原話）】\n` +
      found
        .map(
          (f) =>
            `- ${fmtWhen(f.at, now)}${f.lines.some((l) => l.ch === 'line') ? '（LINE）' : ''}：` +
            f.lines.map((l) => `${l.role === 'user' ? '主人' : '你'}「${cut(l.text)}」`).join(' ')
        )
        .join('\n') +
      `\n（真的相關時才自然地提，例如「我記得你上次說…」；越久以前的記得越模糊，不要把細節講得太肯定，也不要硬塞。）`
    );
  }

  function stats() {
    return { records: recs.length, terms: df.size, first: recs[0]?.at || null };
  }

  /** 最近幾句對話（桌面＋LINE，依時間） */
  function recent(n = 12): StreamRecord[] {
    return recs.slice(-n);
  }

  /** 某段時間的對話（給核心記憶的每晚反思） */
  function between(start: number, end: number): StreamRecord[] {
    return recs.filter((r) => r.at >= start && r.at < end);
  }

  /** 用編號取單句原話 */
  function bySeq(s: number): StreamRecord | undefined {
    const idx = bySeqIdx.get(Number(s));
    return idx !== undefined ? recs[idx] : undefined;
  }

  /** 用編號清單取原話（withNeighbors=true 時順便帶上同一段 20 分鐘內的前後一句） */
  function bySeqs(seqs: number[], withNeighbors = false): StreamRecord[] {
    const picked = new Set<number>();
    for (const s of cleanSeqs(seqs, 20)) {
      const idx = bySeqIdx.get(s);
      if (idx === undefined) continue;
      picked.add(idx);
      if (withNeighbors) {
        const near = (j: number) => j >= 0 && j < recs.length && Math.abs(recs[j].at - recs[idx].at) <= 20 * 60 * 1000;
        if (near(idx - 1)) picked.add(idx - 1);
        if (near(idx + 1)) picked.add(idx + 1);
      }
    }
    return [...picked].sort((a, b) => a - b).map((i) => recs[i]);
  }

  /** 某個編號（含）之後的所有原話 */
  function afterSeq(minSeq: number): StreamRecord[] {
    const m = Number(minSeq) || 0;
    return recs.filter((r) => r.seq >= m);
  }

  /** 幫一組對話訊息找出它們在 stream.jsonl 裡的 seq 編號（找不到就回傳 undefined） */
  function matchSeqs(lines: Array<{ role: 'user' | 'pet'; text: string; at?: number }>): Array<number | undefined> {
    return lines.map((l) => {
      const clean = String(l.text || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\[\[NEXT\]\]/g, '\n')
        .trim()
        .slice(0, 2000);
      if (!clean) return undefined;
      const exactSeq = lastSeenSeq.get(dupKey(l.role, clean));
      if (exactSeq !== undefined) return exactSeq;
      const head = clean.replace(/\s+/g, ' ').slice(0, 60);
      for (let i = recs.length - 1; i >= Math.max(0, recs.length - 400); i--) {
        const r = recs[i];
        if (r.role !== l.role) continue;
        if (l.at && Math.abs(r.at - l.at) > 24 * 3_600_000) continue;
        const rt = r.text.replace(/\s+/g, ' ');
        if (rt === clean.replace(/\s+/g, ' ') || (head.length >= 4 && rt.startsWith(head))) return r.seq;
      }
      return undefined;
    });
  }

  return { append, appendMany, search, describeForChat, stats, recent, between, bySeq, bySeqs, afterSeq, matchSeqs };
}

export type Recall = ReturnType<typeof createRecall>;
