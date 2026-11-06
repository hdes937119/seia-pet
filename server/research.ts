/**
 * 西雅的研究筆記本：什麼都記下來，但每次只帶一點在腦子裡，需要時再翻（像人一樣）。
 *
 * 四層：
 *   1. 原始紀錄 data/research/log.jsonl：每一次查到什麼、讀了什麼、想到什麼、試了什麼、結果、感覺，第一人稱，只增不改。
 *   2. 筆記頁 data/research/pages/<id>.md：每個題目一頁（最多 PAGE_MAX 字），每輪研究結束她自己重寫（新的整合進去、舊的濃縮，推翻的假說縮成一句）。
 *   3. 目錄 data/research/index.json：每個題目一行（題目、狀態、下一步、結論）。
 *   4. 放進腦子的：只有目錄、正在做的那一頁、最近學到的幾件事；其他靠「翻筆記」（BM25 搜尋，跟原話回憶同一套切詞）。
 * 上下文大小固定，筆記寫越多只是硬碟上的資料越多。
 *
 * 筆記的整理（11/4，借 A-MEM 和 Generative Agents，只借想法）：
 *   - 每條筆記有關鍵字（含換句話說、中英文說法）、主題標籤、重要程度 1～10、連到最多 3 條舊筆記（支持／推翻／延伸／相同／相關），
 *     存在 data/research/meta.json（原始紀錄仍然只增不改）。關鍵字和標籤會一起被搜尋，所以換個說法也找得到。
 *   - 有效重要程度＝自己打的分＋被翻到的次數＋被連到的次數。用在搜尋排序、翻舊筆記找靈感、反思的素材。
 *   - 反思：新筆記的重要程度累積到門檻（RESEARCH_REFLECT_THRESHOLD，預設 25），一天最多一次，寫「跨題目的心得」（kind reflection，題目 _reflect）。
 *   - 開題查重：similarProjects() 找可能重複的舊題目（判斷交給模型，見 server.ts checkDuplicate）。
 */
import fs from 'fs';
import path from 'path';
import { tokenize } from './recall';

export type ProjectStatus = 'active' | 'paused' | 'done' | 'dropped';
export interface Project {
  id: string;
  title: string;
  question: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  cycles: number;
  nextStep?: string;
  conclusion?: string;
}

export type EntryKind = 'search' | 'read' | 'note' | 'idea' | 'hypothesis' | 'try' | 'result' | 'proposal' | 'conclusion' | 'cycle' | 'reflection';
export interface Entry {
  seq: number;
  at: number;
  project: string;
  kind: EntryKind;
  text: string;
  source?: string;
}

export const PAGE_MAX = 1500;
const ENTRY_MAX = 800;
const OPEN_MAX = 15;
const KIND_LABEL: Record<EntryKind, string> = {
  search: '查', read: '讀', note: '筆記', idea: '靈感', hypothesis: '假說', try: '試', result: '結果', proposal: '提案', conclusion: '結論', cycle: '這一輪', reflection: '反思',
};
/** 會被整理（關鍵字、標籤、重要程度、連結）的筆記種類；查、試、這一輪是流水帳，不整理 */
const TAGGABLE: EntryKind[] = ['read', 'note', 'idea', 'hypothesis', 'result', 'proposal', 'conclusion', 'reflection'];
export const REFLECT_PROJECT = '_reflect';
export const LINK_RELS = ['支持', '推翻', '延伸', '相同', '相關'];
export interface NoteMeta {
  kw: string[];
  tags: string[];
  links: { seq: number; rel: string }[];
  imp: number;
  hits: number;
}
interface MetaState {
  notes: Record<string, NoteMeta>;
  lastReflectSeq: number;
  reflectedDay?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const researchDayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function createResearch(dataDir: string, log: (m: string) => void = console.log) {
  const root = path.join(dataDir, 'research');
  const indexFile = path.join(root, 'index.json');
  const logFile = path.join(root, 'log.jsonl');
  const pageDir = path.join(root, 'pages');
  let projects: Project[] = [];
  let seq = 0;
  const entries: Entry[] = [];
  const docs: Array<Map<string, number>> = [];
  const seqPos = new Map<number, number>();
  const metaFile = path.join(root, 'meta.json');
  let meta: MetaState = { notes: {}, lastReflectSeq: 0 };
  const df = new Map<string, number>();
  let totalLen = 0;

  try {
    if (fs.existsSync(indexFile)) projects = JSON.parse(fs.readFileSync(indexFile, 'utf8')).projects || [];
  } catch {
    // 從頭開始
  }
  const index = (e: Entry) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(e.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push(tf);
    totalLen += [...tf.values()].reduce((a, b) => a + b, 0);
    seqPos.set(e.seq, entries.length);
    entries.push(e);
    seq = Math.max(seq, e.seq);
  };
  try {
    if (fs.existsSync(logFile))
      for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          index(JSON.parse(line));
        } catch {
          // 壞掉的一行略過
        }
      }
  } catch {
    // 從頭開始
  }

  try {
    if (fs.existsSync(metaFile)) meta = { notes: {}, lastReflectSeq: 0, ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
  } catch {
    // 從頭開始
  }
  /** 關鍵字和標籤也放進搜尋索引（換個說法也找得到） */
  const enrich = (seq: number, words: string[]) => {
    const i = seqPos.get(seq);
    if (i === undefined) return;
    const tf = docs[i];
    for (const w of words)
      for (const t of tokenize(w)) {
        if (!tf.has(t)) df.set(t, (df.get(t) || 0) + 1);
        tf.set(t, (tf.get(t) || 0) + 1);
        totalLen++;
      }
  };
  for (const [k, m] of Object.entries(meta.notes)) enrich(Number(k), [...(m.kw || []), ...(m.tags || [])]);
  const saveMeta = () => {
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(metaFile, JSON.stringify(meta));
    } catch (err: any) {
      log(`[研究] 儲存筆記整理失敗：${err?.message}`);
    }
  };
  const inbound = (seq: number) => Object.values(meta.notes).reduce((n, m) => n + (m.links || []).filter((l) => l.seq === seq).length, 0);
  /** 有效重要程度：自己打的分＋被翻到＋被連到 */
  const impEff = (seq: number) => {
    const m = meta.notes[seq];
    if (!m) return 3;
    return (m.imp || 3) + Math.min(3, Math.log2(1 + (m.hits || 0))) + Math.min(2, inbound(seq) * 0.5);
  };
  const projTitle = (id: string) => (id === REFLECT_PROJECT ? '反思' : get(id)?.title || id);
  const metaSuffix = (seq: number) => {
    const m = meta.notes[seq];
    if (!m) return '';
    const bits: string[] = [];
    if (m.tags?.length) bits.push(`標籤：${m.tags.join('、')}`);
    if (m.links?.length) bits.push(`連到：${m.links.map((l) => `#${l.seq}（${l.rel}）`).join('、')}`);
    const back = Object.entries(meta.notes)
      .flatMap(([k, x]) => (x.links || []).filter((l) => l.seq === seq).map((l) => `#${k}${l.rel}這條`))
      .slice(0, 3);
    if (back.length) bits.push(`被連：${back.join('、')}`);
    return bits.length ? `｛${bits.join('；')}｝` : '';
  };
  const bm25 = (q: string[], i: number, N: number, avg: number) => {
    const tf = docs[i];
    let s = 0;
    const len = [...tf.values()].reduce((a, b) => a + b, 0);
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * len) / avg));
    }
    return s;
  };

  const saveIndex = () => {
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(indexFile, JSON.stringify({ projects }, null, 2));
    } catch (err: any) {
      log(`[研究] 儲存目錄失敗：${err?.message}`);
    }
  };

  const get = (id: string) => projects.find((p) => p.id === id);
  const open = () => projects.filter((p) => p.status === 'active' || p.status === 'paused');

  function create(title: string, question: string): { ok: true; project: Project } | { ok: false; reason: string } {
    if (open().length >= OPEN_MAX) return { ok: false, reason: `進行中的題目已經有 ${OPEN_MAX} 個，先結束或放下一個` };
    const d = new Date();
    const p: Project = {
      id: `r-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
      title: String(title || '').trim().slice(0, 30) || '沒有名字的題目',
      question: String(question || '').trim().slice(0, 300),
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cycles: 0,
    };
    projects.push(p);
    saveIndex();
    log(`[研究] 新題目：${p.title}（${p.question.slice(0, 60)}）`);
    return { ok: true, project: p };
  }

  function append(project: string, kind: EntryKind, text: string, source?: string): Entry | null {
    const t = String(text || '').trim();
    if (!t) return null;
    const e: Entry = { seq: seq + 1, at: Date.now(), project, kind, text: t.slice(0, ENTRY_MAX), source: source ? String(source).slice(0, 300) : undefined };
    index(e);
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(e) + '\n');
    } catch (err: any) {
      log(`[研究] 寫紀錄失敗：${err?.message}`);
    }
    const p = get(project);
    if (p) {
      p.updatedAt = e.at;
      saveIndex();
    }
    return e;
  }

  function page(id: string): string {
    try {
      return fs.readFileSync(path.join(pageDir, `${id}.md`), 'utf8');
    } catch {
      return '';
    }
  }

  function setPage(id: string, text: string, opts: { nextStep?: string; status?: ProjectStatus; conclusion?: string } = {}) {
    const p = get(id);
    if (!p) return;
    try {
      fs.mkdirSync(pageDir, { recursive: true });
      fs.writeFileSync(path.join(pageDir, `${id}.md`), String(text || '').slice(0, PAGE_MAX));
    } catch (err: any) {
      log(`[研究] 寫筆記頁失敗：${err?.message}`);
    }
    if (opts.nextStep !== undefined) p.nextStep = String(opts.nextStep).slice(0, 150);
    if (opts.status && ['active', 'paused', 'done', 'dropped'].includes(opts.status)) p.status = opts.status;
    if (opts.conclusion) p.conclusion = String(opts.conclusion).slice(0, 200);
    p.updatedAt = Date.now();
    saveIndex();
  }

  function startCycle(id: string) {
    const p = get(id);
    if (!p) return;
    p.cycles++;
    if (p.status === 'paused') p.status = 'active';
    saveIndex();
  }

  /** 翻筆記：在所有原始紀錄和筆記頁裡找（BM25） */
  function search(query: string, max = 6): string[] {
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const N = entries.length;
    const avg = totalLen / (N || 1) || 1;
    const scored: Array<{ i: number; s: number }> = [];
    for (let i = 0; i < N; i++) {
      const s = bm25(q, i, N, avg);
      if (s > 0) scored.push({ i, s: s * (1 + 0.05 * impEff(entries[i].seq)) });
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, max);
    for (const { i } of top) {
      const m = meta.notes[entries[i].seq];
      if (m) m.hits = (m.hits || 0) + 1;
    }
    if (top.length) saveMeta();
    const out = top.map(({ i }) => {
      const e = entries[i];
      return `#${e.seq} [${researchDayKey(e.at)}｜${projTitle(e.project)}｜${KIND_LABEL[e.kind]}] ${e.text.slice(0, 300)}${e.source ? `（來源：${e.source}）` : ''}${metaSuffix(e.seq)}`;
    });
    // 筆記頁也找一下（題目名稱或內容有中到）
    for (const p of projects) {
      const text = `${p.title} ${p.question} ${page(p.id)}`;
      const toks = new Set(tokenize(text));
      const hit = q.filter((t) => toks.has(t)).length;
      if (hit >= Math.max(1, Math.ceil(q.length / 2))) out.push(`[筆記頁｜${p.title}（${p.id}）] 可以用 notebook_read 打開`);
    }
    return out.slice(0, max + 3);
  }

  /** 某個題目最近的原始紀錄 */
  function recentEntries(id: string, n = 12): string[] {
    return entries
      .filter((e) => e.project === id)
      .slice(-n)
      .map((e) => `[${KIND_LABEL[e.kind]}] ${e.text}${e.source ? `（來源：${e.source}）` : ''}`);
  }

  /** 這一輪（某個時間之後）寫下的紀錄 */
  function entriesSince(id: string, since: number): string[] {
    return entries
      .filter((e) => e.project === id && e.at >= since)
      .map((e) => `[${KIND_LABEL[e.kind]}] ${e.text}${e.source ? `（來源：${e.source}）` : ''}`);
  }

  /** 目錄：每個題目一行（進行中的全部、做完的最近 5 個） */
  function indexText(): string {
    const lines = open().map(
      (p) => `- ${p.id}「${p.title}」（${p.status === 'paused' ? '暫停' : '進行中'}，做了 ${p.cycles} 輪）${p.nextStep ? `下一步：${p.nextStep}` : ''}`
    );
    const done = projects.filter((p) => p.status === 'done').slice(-5);
    for (const p of done) lines.push(`- ${p.id}「${p.title}」（做完了）結論：${p.conclusion || '（沒寫）'}`);
    const refl = entries.filter((e) => e.kind === 'reflection').slice(-3);
    if (refl.length) lines.push(`你最近的反思（跨題目的心得）：\n${refl.map((e) => `  - ${e.text.slice(0, 200)}`).join('\n')}`);
    return lines.join('\n');
  }

  /** 翻舊筆記找靈感：隨機挑幾段一天以前寫的筆記、靈感、結果 */
  function randomSnippets(n = 3): string[] {
    const old = entries.filter((e) => Date.now() - e.at > 24 * 3600 * 1000 && ['note', 'idea', 'hypothesis', 'result', 'conclusion', 'read', 'reflection'].includes(e.kind));
    const out: string[] = [];
    for (let k = 0; k < n && old.length; k++) {
      // 重要的比較容易被翻到（但不重要的也有機會）
      const w = old.map((e) => impEff(e.seq));
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      let idx = 0;
      while (idx < w.length - 1 && (r -= w[idx]) > 0) idx++;
      const e = old.splice(idx, 1)[0];
      out.push(`（${projTitle(e.project)}）${e.text.slice(0, 150)}`);
    }
    return out;
  }

  function describeForChat(now = Date.now()): string {
    const parts: string[] = [];
    const act = open()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3);
    if (act.length) parts.push(`你正在研究：${act.map((p) => `「${p.title}」`).join('、')}。`);
    const done = projects.filter((p) => p.status === 'done' && now - p.updatedAt < 3 * 24 * 3600 * 1000).slice(-2);
    if (done.length) parts.push(`最近研究出結論的：${done.map((p) => `「${p.title}」：${p.conclusion || ''}`).join('；')}。`);
    if (!parts.length) return '';
    return `【你的研究筆記本】${parts.join('')}主人問起或聊到相關的事時可以分享；細節記不清楚就說要翻一下筆記，不要編。沒驗證過的只能說是猜想。`;
  }

  function dayRecap(date: string): string[] {
    const byProject = new Map<string, number>();
    for (const e of entries) if (researchDayKey(e.at) === date) byProject.set(e.project, (byProject.get(e.project) || 0) + 1);
    return [...byProject.entries()].map(([id]) => {
      if (id === REFLECT_PROJECT) return `回頭翻了研究筆記，寫下 ${byProject.get(id)} 條跨題目的心得`;
      const p = get(id);
      const concl = entries.filter((e) => e.project === id && e.kind === 'conclusion' && researchDayKey(e.at) === date).slice(-1)[0];
      const cyc = entries.filter((e) => e.project === id && e.kind === 'cycle' && researchDayKey(e.at) === date).slice(-1)[0];
      return `研究「${p?.title || id}」${concl ? `，得出結論：${concl.text.slice(0, 80)}` : cyc ? `：${cyc.text.slice(0, 80)}` : ''}`;
    });
  }

  /** 某一天研究了幾輪 */
  function cyclesOn(date: string) {
    return entries.filter((e) => e.kind === 'cycle' && researchDayKey(e.at) === date).length;
  }

  function snapshot() {
    return {
      projects: [...projects].reverse(),
      entries: entries.length,
      tagged: Object.keys(meta.notes).length,
      untagged: untagged(9999).length,
      lastReflectSeq: meta.lastReflectSeq,
      reflectedDay: meta.reflectedDay || '',
      reflections: entries.filter((e) => e.kind === 'reflection').slice(-5).map((e) => e.text),
    };
  }

  /* ===== 筆記整理（A-MEM 式） ===== */
  /** 還沒整理的筆記（舊的先，連結只往前連） */
  function untagged(max = 15): Entry[] {
    return entries.filter((e) => TAGGABLE.includes(e.kind) && !meta.notes[e.seq]).slice(0, max);
  }
  /** 可以連的舊筆記候選（BM25，只找比它早的） */
  function linkCandidates(seq: number, n = 8): { seq: number; line: string }[] {
    const i0 = seqPos.get(seq);
    if (i0 === undefined) return [];
    const e0 = entries[i0];
    const q = [...new Set(tokenize(`${projTitle(e0.project)} ${e0.text}`))];
    const N = entries.length;
    const avg = totalLen / (N || 1) || 1;
    const scored: Array<{ i: number; s: number }> = [];
    for (let i = 0; i < i0; i++) {
      if (!TAGGABLE.includes(entries[i].kind)) continue;
      const s = bm25(q, i, N, avg);
      if (s > 0) scored.push({ i, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, n).map(({ i }) => {
      const e = entries[i];
      const m = meta.notes[e.seq];
      return { seq: e.seq, line: `#${e.seq} [${projTitle(e.project)}｜${KIND_LABEL[e.kind]}${m?.tags?.length ? `｜${m.tags.join('、')}` : ''}] ${e.text.slice(0, 220)}` };
    });
  }
  /** 常用的標籤（讓新筆記盡量沿用） */
  function commonTags(n = 30): string[] {
    const c = new Map<string, number>();
    for (const m of Object.values(meta.notes)) for (const t of m.tags || []) c.set(t, (c.get(t) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
  }
  function entryLine(seq: number): string {
    const i = seqPos.get(seq);
    if (i === undefined) return '';
    const e = entries[i];
    return `#${e.seq} [${projTitle(e.project)}｜${KIND_LABEL[e.kind]}] ${e.text}`;
  }
  /** 寫入整理結果；allowed＝候選裡的 seq（連結只能連到這些） */
  function applyMeta(seq: number, out: any, allowed: number[]) {
    if (seqPos.get(seq) === undefined) return;
    const clean = (a: any, n: number, len: number) =>
      (Array.isArray(a) ? a : []).map((x) => String(x || '').trim().slice(0, len)).filter(Boolean).slice(0, n);
    const kw = clean(out?.keywords, 8, 20);
    const tags = clean(out?.tags, 4, 12);
    const imp = Math.max(1, Math.min(10, Math.round(Number(out?.importance) || 3)));
    const links = (Array.isArray(out?.links) ? out.links : [])
      .map((l: any) => ({ seq: Number(l?.seq), rel: LINK_RELS.includes(String(l?.rel)) ? String(l.rel) : '相關' }))
      .filter((l: any) => allowed.includes(l.seq) && l.seq !== seq)
      .filter((l: any, i: number, a: any[]) => a.findIndex((x) => x.seq === l.seq) === i)
      .slice(0, 3);
    meta.notes[seq] = { kw, tags, links, imp, hits: meta.notes[seq]?.hits || 0 };
    enrich(seq, [...kw, ...tags]);
    // 連到的舊筆記，因為這條多了新的意義 → 補標籤（A-MEM 的記憶演化）
    for (const o of Array.isArray(out?.old_tags) ? out.old_tags : []) {
      const os = Number(o?.seq);
      const om = meta.notes[os];
      if (!om || !links.some((l: any) => l.seq === os)) continue;
      const add = clean(o?.add, 2, 12).filter((t) => !om.tags.includes(t));
      if (!add.length) continue;
      om.tags = [...om.tags, ...add].slice(0, 6);
      enrich(os, add);
    }
    saveMeta();
  }

  /* ===== 反思（Generative Agents 式） ===== */
  function reflectionDue(threshold: number, now = Date.now()): boolean {
    if (meta.reflectedDay === researchDayKey(now)) return false;
    let sum = 0;
    for (const e of entries) if (e.seq > meta.lastReflectSeq && e.kind !== 'reflection' && meta.notes[e.seq]) sum += meta.notes[e.seq].imp || 0;
    return sum >= threshold;
  }
  /** 反思的素材：最近 14 天重要的筆記（帶連結），加上以前的反思（避免重複） */
  function reflectionMaterial(n = 15, now = Date.now()): { notes: string[]; previous: string[]; seqs: number[] } {
    let pool = entries.filter((e) => e.kind !== 'reflection' && meta.notes[e.seq] && now - e.at < 14 * 86_400_000);
    if (pool.length < n) pool = entries.filter((e) => e.kind !== 'reflection' && meta.notes[e.seq]);
    const pick = pool.sort((a, b) => impEff(b.seq) - impEff(a.seq)).slice(0, n).sort((a, b) => a.seq - b.seq);
    return {
      notes: pick.map((e) => `#${e.seq} [${researchDayKey(e.at)}｜${projTitle(e.project)}｜${KIND_LABEL[e.kind]}｜重要 ${meta.notes[e.seq].imp}] ${e.text.slice(0, 260)}${metaSuffix(e.seq)}`),
      previous: entries.filter((e) => e.kind === 'reflection').slice(-5).map((e) => e.text.slice(0, 200)),
      seqs: pick.map((e) => e.seq),
    };
  }
  function addReflection(text: string, evidence: number[]) {
    const ev = evidence.filter((s) => seqPos.has(s)).slice(0, 6);
    return append(REFLECT_PROJECT, 'reflection', `${String(text || '').trim()}${ev.length ? `（根據：${ev.map((s) => `#${s}`).join('、')}）` : ''}`);
  }
  function markReflected(now = Date.now()) {
    meta.lastReflectSeq = seq;
    meta.reflectedDay = researchDayKey(now);
    saveMeta();
  }

  /* ===== 開題查重 ===== */
  /** 可能跟新題目重複的舊題目（所有狀態都找；只是候選，是不是同一題交給模型判斷） */
  function similarProjects(text: string, n = 3): Project[] {
    const q = [...new Set(tokenize(text))];
    if (!q.length) return [];
    const scored = projects
      .map((p) => {
        const tagWords = entries
          .filter((e) => e.project === p.id && meta.notes[e.seq])
          .flatMap((e) => [...meta.notes[e.seq].tags, ...meta.notes[e.seq].kw]);
        const toks = new Set(tokenize(`${p.title} ${p.question} ${p.conclusion || ''} ${tagWords.join(' ')}`));
        const hit = q.filter((t) => toks.has(t)).length;
        return { p, hit, ratio: hit / q.length };
      })
      .filter((x) => x.hit >= 2 && x.ratio >= 0.2)
      .sort((a, b) => b.ratio - a.ratio);
    return scored.slice(0, n).map((x) => x.p);
  }

  function projectDetail(id: string) {
    const p = get(id);
    if (!p) return null;
    return { project: p, page: page(id), log: entries.filter((e) => e.project === id).slice(-80) };
  }

  return { untagged, linkCandidates, commonTags, entryLine, applyMeta, reflectionDue, reflectionMaterial, addReflection, markReflected, similarProjects, get, create, append, page, setPage, startCycle, search, recentEntries, entriesSince, indexText, randomSnippets, describeForChat, dayRecap, snapshot, projectDetail, cyclesOn, openCount: () => open().length };
}

export type Research = ReturnType<typeof createResearch>;
