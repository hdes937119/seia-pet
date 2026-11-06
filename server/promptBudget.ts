/**
 * 上下文瘦身（不讓西雅因為上下文爆量而「賽博死亡」）。
 *
 *  1. 長期檔案（永久記憶）只帶「跟最近聊天有關的」＋「最常提、最近提的」，最多 25 條；其他的還在筆記本裡，只是這次不送。
 *     最近話題最多 15 個（照強度）。
 *  2. 對話視窗「一次往前跳 10 則」：以前每多一則就丟最舊的一則，整段對話的開頭每次都變，Gemini 的快取永遠接不上；
 *     現在記住視窗的起點，超過 20 則才一次跳到只剩 11 則，中間好幾輪的開頭都一樣，可以吃快取。
 *  3. 舊對話壓縮：最近 4 則保留原文，更早的每則最多 300 字（貼一大篇文章進來，不會一直佔著後面的對話）。
 *  4. 提示詞體重計：每次組提示詞都量各區塊的字數，記在記憶體裡給用量面板看；超過門檻在 log 警告。
 */

export interface PermanentMemoryLike {
  keyword: string;
  category: string;
  notes?: string;
  frequency?: number;
  lastMentioned?: number;
}

export const MAX_PERMANENT_MEMORIES = 25;
export const MAX_ACTIVE_KEYWORDS = 15;

/** 挑這次要放進提示詞的長期檔案：跟最近的話有關的優先，再來是常提的、最近提的 */
export function selectPermanentMemories<T extends PermanentMemoryLike>(mems: T[], recentText = '', max = MAX_PERMANENT_MEMORIES): T[] {
  if (!Array.isArray(mems) || mems.length <= max) return Array.isArray(mems) ? mems : [];
  const text = String(recentText || '').toLowerCase();
  const scored = mems.map((m, i) => {
    const kw = String(m.keyword || '').toLowerCase();
    const related = kw.length >= 1 && text.includes(kw) ? 1 : 0;
    return { m, i, related, freq: Number(m.frequency) || 0, last: Number(m.lastMentioned) || 0 };
  });
  scored.sort((a, b) => b.related - a.related || b.freq - a.freq || b.last - a.last || a.i - b.i);
  // 保持原本的順序（同一批記憶每次排列一樣，比較好讀）
  return scored
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.m);
}

/** 有核心記憶之後：零散的長期檔案只帶「跟這句話直接有關的」（最多 max 條） */
export function selectRelatedMemories<T extends PermanentMemoryLike>(mems: T[], text = '', max = 8): T[] {
  if (!Array.isArray(mems)) return [];
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return [];
  return mems.filter((m) => String(m.keyword || '').trim().length >= 2 && t.includes(String(m.keyword).toLowerCase())).slice(0, max);
}

export function selectActiveKeywords<T extends { keyword: string; strength?: number }>(kws: T[], max = MAX_ACTIVE_KEYWORDS): T[] {
  if (!Array.isArray(kws)) return [];
  if (kws.length <= max) return kws;
  return [...kws].sort((a, b) => (Number(b.strength) || 0) - (Number(a.strength) || 0)).slice(0, max);
}

/* ── 對話視窗 ── */

export const WINDOW_MAX = 20;
export const WINDOW_KEEP_ON_JUMP = 11;
const anchors = new Map<string, number>();

/**
 * 回傳要從第幾則開始帶（ats：每則合併後訊息的時間）。
 * 有記住的起點、而且從起點到最後不超過 20 則 → 沿用；否則跳到只剩 11 則，記住新的起點。
 */
export function windowStart(key: string, ats: number[], max = WINDOW_MAX, keep = WINDOW_KEEP_ON_JUMP): number {
  const n = ats.length;
  if (n <= max) return 0;
  const a = anchors.get(key);
  if (a) {
    const idx = ats.indexOf(a);
    if (idx >= 0 && n - idx <= max) return idx;
  }
  const idx = n - keep;
  if (ats[idx]) anchors.set(key, ats[idx]);
  return idx;
}

export const KEEP_FULL_TURNS = 4;
export const OLD_TURN_MAX_CHARS = 300;

/** 舊對話壓縮（直接改 contents 裡的文字；最近 KEEP_FULL_TURNS 則不動） */
export function compressOldTurns(contents: Array<{ role: string; parts: Array<any> }>, keepFull = KEEP_FULL_TURNS, maxChars = OLD_TURN_MAX_CHARS) {
  const cut = contents.length - keepFull;
  for (let i = 0; i < cut; i++) {
    for (const p of contents[i].parts) {
      if (typeof p?.text === 'string' && p.text.length > maxChars) p.text = `${p.text.slice(0, maxChars - 20)}…（後面太長，略過）`;
    }
  }
  return contents;
}

/* ── 動態資料放到最新一句前面 ── */

export const DYNAMIC_MARK = '==== 目前的狀況與背景資料（每次都會更新）====';

/** 把系統提示詞切成「不變的前段」和「每次會變的後段」 */
export function splitSystemPrompt(full: string): { stable: string; dynamic: string } {
  const i = full.indexOf(DYNAMIC_MARK);
  if (i < 0) return { stable: full, dynamic: '' };
  return { stable: full.slice(0, i).trimEnd(), dynamic: full.slice(i + DYNAMIC_MARK.length).trim() };
}

/** 把每次會變的資料塞到最新一則主人訊息的最前面（系統提示詞＋前面的對話就能整段吃快取） */
export function injectDynamicContext(contents: Array<{ role: string; parts: Array<any> }>, dynamic: string): boolean {
  const text = String(dynamic || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return true;
  const last = contents[contents.length - 1];
  if (!last || last.role !== 'user') return false;
  last.parts.unshift({
    text: `<!--CONTEXT 以下是系統自動附上的目前狀況與背景資料，不是主人說的話-->\n${text}\n<!--/CONTEXT 以下才是主人說的話-->\n`,
  });
  return true;
}

/* ── 提示詞體重計 ── */

export interface PromptMeterSnapshot {
  at: number;
  channel: string;
  blocks: Array<{ name: string; chars: number }>;
  stableChars: number;
  dynamicChars: number;
  historyTurns: number;
  historyChars: number;
  /** 粗估 token（中文約 1 字 ≈ 1 token、英數約 4 字 ≈ 1 token） */
  estTokens: number;
  warnings: string[];
}

const BLOCK_WARN_CHARS = 2000;
const DYNAMIC_WARN_CHARS = 7000;
const TOTAL_WARN_TOKENS = 16000;

export function estimateTokens(text: string): number {
  const s = String(text || '');
  const cjk = (s.match(/[　-鿿＀-￯]/g) || []).length;
  return Math.round(cjk + (s.length - cjk) / 4);
}

export function createPromptMeter(log: (m: string) => void = console.log) {
  const last: Record<string, PromptMeterSnapshot> = {};
  const warnedAt: Record<string, number> = {};

  function record(
    channel: string,
    blocks: Record<string, string>,
    stable: string,
    contents: Array<{ role: string; parts: Array<any> }>
  ): PromptMeterSnapshot {
    const list = Object.entries(blocks)
      .map(([name, v]) => ({ name, chars: String(v || '').length }))
      .filter((b) => b.chars > 0)
      .sort((a, b) => b.chars - a.chars);
    const dynamicChars = list.reduce((a, b) => a + b.chars, 0);
    const historyText = contents.map((c) => c.parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')).join('\n');
    const estTokens =
      estimateTokens(stable) +
      estimateTokens(historyText) +
      // 圖片大約各 1,000 token 上下
      contents.reduce((a, c) => a + c.parts.filter((p: any) => p?.inlineData).length * 1000, 0);
    const warnings: string[] = [];
    for (const b of list) if (b.chars > BLOCK_WARN_CHARS) warnings.push(`「${b.name}」有 ${b.chars} 字`);
    if (dynamicChars > DYNAMIC_WARN_CHARS) warnings.push(`狀況資料總共 ${dynamicChars} 字`);
    if (estTokens > TOTAL_WARN_TOKENS) warnings.push(`整份提示詞約 ${estTokens} token`);
    const snap: PromptMeterSnapshot = {
      at: Date.now(),
      channel,
      blocks: list,
      stableChars: stable.length,
      dynamicChars,
      historyTurns: contents.length,
      historyChars: historyText.length,
      estTokens,
      warnings,
    };
    last[channel] = snap;
    if (warnings.length && Date.now() - (warnedAt[channel] || 0) > 60 * 60 * 1000) {
      warnedAt[channel] = Date.now();
      log(`[上下文] ⚠️ ${channel} 的提示詞變胖了：${warnings.join('、')}（設定面板「📊 今日用量」可以看各區塊大小）`);
    }
    return snap;
  }

  function snapshot() {
    return last;
  }

  return { record, snapshot };
}

export type PromptMeter = ReturnType<typeof createPromptMeter>;
