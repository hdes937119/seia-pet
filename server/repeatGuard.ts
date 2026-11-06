/**
 * 重複詞檢查（2026-11-06）
 *
 * 找出她最近幾則回覆裡一再出現的說法（例如「打鼓影片」「大叔看新聞」），
 * 回話前提醒她這次換個說法；回完再檢查一次（桌面只記 log，LINE 可以重寫一次）。
 */

const WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_REPLIES = 15;
const MAX_PHRASES = 6;

/** 常用字詞：不算「梗」 */
const STOP_WORDS = [
  '主人', '本喵', '西雅', '哈基米', '雙子星貓', '什麼', '一下', '今天', '現在', '我們', '你們', '他們', '這個', '那個', '這樣', '那樣',
  '不是', '就是', '可以', '怎麼', '是不是', '不要', '一直', '還是', '真的', '已經', '一樣', '而且', '因為', '所以', '然後', '如果', '其實',
  '知道', '覺得', '一起', '時候', '東西', '有點', '好像', '一點', '自己', '你的', '我的', '沒有', '不會', '應該', '這麼', '那麼', '剛剛',
  '等等', '先去', '要不要', '好不好', '對不對', '有沒有', '還沒', '一個', '幾個',
];
const PARTICLES = /[的了嗎吧呢啊喔哦哈嘛呀唷啦耶欸誒嘿呼唉哼喵嗚噢吼咦嗯]/g;

export function cleanReply(text: string): string {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[STICKER:[^\]]*\]\]/g, '')
    .replace(/\[\[NEXT\]\]/g, '\n');
}

function contentChars(phrase: string): number {
  let s = phrase;
  for (const w of STOP_WORDS) s = s.split(w).join('');
  return s.replace(PARTICLES, '').replace(/[^一-鿿A-Za-z0-9]/g, '').length;
}

/** 從一則回覆切出所有 3～8 字的片段（只在同一段文字裡切，不跨標點） */
function grams(text: string): Set<string> {
  const out = new Set<string>();
  const runs = cleanReply(text).split(/[^一-鿿A-Za-z0-9]+/).filter((r) => r.length >= 3);
  for (const r of runs) {
    for (let n = 3; n <= 8; n++) for (let i = 0; i + n <= r.length; i++) out.add(r.slice(i, i + n));
  }
  return out;
}

export interface PetLine {
  text: string;
  at?: number;
}

/**
 * 她最近一再用的說法。
 * - 4 字以上：在 2 則以上的回覆出現；3 字：要 3 則以上
 * - 主人這句話自己提到的不算（主人主動聊，她當然可以接）
 */
export function repeatedPhrases(lines: PetLine[], userText = '', now = Date.now()): string[] {
  const recent = lines
    .filter((l) => l && l.text && (!l.at || now - l.at <= WINDOW_MS))
    .slice(-MAX_REPLIES);
  if (recent.length < 2) return [];
  const count = new Map<string, number>();
  for (const l of recent) for (const g of grams(l.text)) count.set(g, (count.get(g) || 0) + 1);
  const user = String(userText || '');
  let cands = [...count.entries()].filter(([g, c]) => {
    if (c < (g.length >= 4 ? 2 : 3)) return false;
    if (contentChars(g) < 3) return false;
    if (user.includes(g)) return false;
    return true;
  });
  // 只留最長的版本：被更長、出現次數一樣多的片段包住的就丟掉
  cands = cands.filter(([g, c]) => !cands.some(([h, d]) => h !== g && h.length > g.length && h.includes(g) && d >= c));
  // 去掉頭尾的語助詞（「大叔看新聞的」→「大叔看新聞」），再把彼此重疊的只留分數高的那個
  const picked: string[] = [];
  for (const [g] of cands.sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)) {
    const t = g.replace(EDGE, '');
    if (t.length < 3 || picked.some((p) => overlaps(p, t))) continue;
    picked.push(t);
    if (picked.length >= MAX_PHRASES) break;
  }
  return picked;
}

const EDGE = /^[的了嗎吧呢啊喔哦哈嘛呀唷啦耶欸嘿喵又也都就還]+|[的了嗎吧呢啊喔哦哈嘛呀唷啦耶欸嘿喵]+$/g;

/** 兩個片段有共同的 3 字以上片段 → 算同一個梗 */
function overlaps(a: string, b: string): boolean {
  for (let i = 0; i + 3 <= b.length; i++) if (a.includes(b.slice(i, i + 3))) return true;
  return false;
}

export function repeatPrompt(phrases: string[]): string {
  if (!phrases.length) return '';
  return `\n【不要重複】你最近幾則已經講過好幾次：${phrases.map((p) => `「${p}」`).join('')}。這次不要再用這些說法或同一個梗；真的想說同一件事就換個講法，或乾脆不提。`;
}

/** 回完之後檢查：還是用了哪些 */
export function repeatHits(reply: string, phrases: string[]): string[] {
  const t = cleanReply(reply);
  return phrases.filter((p) => t.includes(p));
}
