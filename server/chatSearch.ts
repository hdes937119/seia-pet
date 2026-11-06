/**
 * 聊天時「真的去網路上找」：主人說「幫我找幾張梗圖 / 搜一下 XX 的文章 / 找 XX 的影片」時，
 * 先真的搜尋，再把結果（含梗圖本身）交給她看，她只能根據真的結果回覆，不能自己編。
 *
 *  - 梗圖：Reddit 英文梗圖版的熱門圖（每次 2 張，不重複）
 *  - 文章 / 資料：Gemini 內建的 Google 搜尋，附真實網址
 *  - 影片：YouTube 搜尋
 */
import { sources } from './explore';

export type SearchKind = 'meme' | 'web' | 'video';

export interface SearchItem {
  title: string;
  url: string; // 原文 / 影片 / 文章網址
  source: string; // r/memes、YouTube、網域…
  image?: { url: string; previewUrl: string; mime: string; data: string }; // 梗圖本身（data = base64）
}

export interface ChatSearchResult {
  kind: SearchKind;
  query: string;
  items: SearchItem[];
  summary?: string; // Google 搜尋的重點整理
  error?: string;
}

/* ───────────── 判斷主人是不是要她去找東西 ───────────── */

const ASK_RE = /搜|找|查|google|谷歌|翻翻|翻一下|上網看|網上看|推薦/i;
const MEME_RE = /梗圖|迷因|meme|搞笑的?圖|好笑的?圖/i;
const VIDEO_RE = /影片|視頻|video|youtube|yt\b/i;
const WEB_RE = /文章|新聞|資料|網頁|消息|評價|評測|心得|攻略|教學|資訊|網址|連結|報導/;

export function detectSearchRequest(text: string): { kind: SearchKind } | null {
  const t = String(text || '');
  if (!ASK_RE.test(t) || /找不到|找到了|搜不到|查不到/.test(t)) return null;
  if (MEME_RE.test(t)) return { kind: 'meme' };
  if (VIDEO_RE.test(t)) return { kind: 'video' };
  if (WEB_RE.test(t)) return { kind: 'web' };
  return null;
}

/* ───────────── 梗圖：Reddit 熱門圖 ───────────── */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sentMemes: string[] = []; // 最近傳過的，不重複
const MEMES_PER_REQUEST = 2;

function pickSubreddits(text: string): string[] {
  if (/程式|code|coding|bug|工程師|programm|寫扣|debug/i.test(text)) return ['ProgrammerHumor'];
  if (/動漫|anime|二次元|番/i.test(text)) return ['Animemes'];
  if (/遊戲|game|gaming|電動/i.test(text)) return ['gamingmemes', 'gaming'];
  if (/貓|cat/i.test(text)) return ['catmemes'];
  return ['memes', 'wholesomememes'];
}

const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** 解析 Reddit 的 Atom RSS：找出有 i.redd.it 圖片（JPG / PNG，LINE 只吃這兩種）的貼文 */
export function parseRedditImagePosts(xml: string, sub: string) {
  const out: Array<{ id: string; title: string; url: string; imageUrl: string; previewUrl: string; sub: string }> = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = unescapeHtml((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const link = (entry.match(/<link href="([^"]+)"/) || [])[1] || '';
    const id = (entry.match(/<id>([^<]+)<\/id>/) || [])[1] || link;
    const content = unescapeHtml((entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '');
    const imageUrl = (content.match(/https:\/\/i\.redd\.it\/[A-Za-z0-9_-]+\.(?:jpe?g|png)/i) || [])[0];
    if (!title || !link || !imageUrl) continue;
    const preview = (content.match(/<img src="(https:\/\/[^"]+)"/) || [])[1];
    out.push({ id, title, url: unescapeHtml(link), imageUrl, previewUrl: preview ? unescapeHtml(preview) : imageUrl, sub });
  }
  return out;
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} 回應 ${res.status}`);
  return res.text();
}

async function downloadImage(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const mime = (res.headers.get('content-type') || '').split(';')[0];
    if (!res.ok || !/^image\/(jpeg|png)$/.test(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return null; // 太大的不給模型看
    return { mime, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

async function findMemes(text: string): Promise<SearchItem[]> {
  const subs = pickSubreddits(text);
  const posts = [];
  for (const sub of subs) {
    try {
      posts.push(...parseRedditImagePosts(await fetchText(`https://www.reddit.com/r/${sub}/hot/.rss?limit=30`), sub));
    } catch (err: any) {
      console.warn(`[找梗圖] r/${sub} 失敗：`, err?.message);
    }
  }
  // 熱門前段隨機挑，傳過的不再傳
  const fresh = posts.filter((p) => !sentMemes.includes(p.id) && !/\[?mod\]?|announcement|rules/i.test(p.title));
  fresh.sort(() => Math.random() - 0.5);
  const picked: SearchItem[] = [];
  for (const p of fresh) {
    if (picked.length >= MEMES_PER_REQUEST) break;
    const img = await downloadImage(p.imageUrl);
    if (!img) continue;
    // LINE 的預覽圖要 1MB 內、而且只吃 JPG / PNG（Reddit 的預覽圖常常是 WebP）→ 直接用原圖，太大的換一張
    if ((img.data.length * 3) / 4 > 1024 * 1024) continue;
    picked.push({ title: p.title, url: p.url, source: `r/${p.sub}`, image: { url: p.imageUrl, previewUrl: p.imageUrl, ...img } });
    sentMemes.push(p.id);
  }
  if (sentMemes.length > 300) sentMemes.splice(0, sentMemes.length - 300);
  return picked;
}

/* ───────────── 文章 / 影片 ───────────── */

type Generate = (contents: any, config: Record<string, any>) => Promise<{ response: any }>;

/** 把主人那句話轉成搜尋關鍵字（「妳幫我找一下 PoE 新賽季的配裝影片」→「PoE 新賽季 配裝」） */
async function toQuery(generate: Generate, text: string): Promise<string> {
  try {
    const { response } = await generate(
      [{ role: 'user', parts: [{ text: `把這句話轉成適合搜尋引擎的關鍵字（保留原本的語言和專有名詞，不要加引號，只輸出關鍵字）：${text}` }] }],
      { temperature: 0 }
    );
    const q = String(response.text || '').split('\n')[0].trim().slice(0, 80);
    if (q) return q;
  } catch {
    // 用原句
  }
  return text.slice(0, 80);
}

async function googleSearch(generate: Generate, text: string): Promise<{ summary: string; items: SearchItem[] }> {
  const { response } = await generate(
    [
      {
        role: 'user',
        parts: [{ text: `用 Google 搜尋回答這個請求，用繁體中文列出 2～3 個最相關、最新的重點，每個一兩句：${text}` }],
      },
    ],
    { tools: [{ googleSearch: {} }], temperature: 0.3 }
  );
  const chunks: any[] = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const items: SearchItem[] = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    items.push({ title: String(c.web.title || '網頁'), url: uri, source: String(c.web.title || '') });
    if (items.length >= 3) break;
  }
  return { summary: String(response?.text || '').trim().slice(0, 1200), items };
}

/* ───────────── 對外：執行搜尋 ───────────── */

export async function runChatSearch(kind: SearchKind, text: string, generate: Generate): Promise<ChatSearchResult> {
  try {
    if (kind === 'meme') {
      const items = await findMemes(text);
      return { kind, query: text, items, error: items.length ? undefined : 'Reddit 沒回應或沒有可以用的圖' };
    }
    if (kind === 'video') {
      const query = await toQuery(generate, text);
      const vids = await sources.searchYouTube(query, 3);
      const items = vids.map((v) => ({ title: v.title, url: v.url, source: 'YouTube' }));
      return { kind, query, items, error: items.length ? undefined : 'YouTube 沒找到' };
    }
    const { summary, items } = await googleSearch(generate, text);
    return { kind, query: text, items, summary, error: items.length ? undefined : 'Google 搜尋沒有結果' };
  } catch (err: any) {
    console.warn('[聊天搜尋] 失敗：', err?.status || err?.message);
    return { kind, query: text, items: [], error: '網路搜尋失敗' };
  }
}

const KIND_LABEL: Record<SearchKind, string> = { meme: '梗圖', web: '網路文章 / 資料', video: '影片' };

/** 給系統提示詞：她剛剛真的找到的東西（或老實說沒找到） */
export function searchPrompt(r: ChatSearchResult): string {
  if (!r.items.length) {
    return `\n【搜尋結果】主人剛剛叫你去找${KIND_LABEL[r.kind]}，你真的去找了，但${r.error || '沒找到'}。請老實跟主人說這次沒找到（可以撒嬌說等等再試），絕對不要編造任何圖片、文章、影片或網址。`;
  }
  const list = r.items
    .map((it, i) => `${i + 1}. 「${it.title}」（${it.source}）`)
    .join('\n');
  return (
    `\n【你剛剛真的上網找到的${KIND_LABEL[r.kind]}（這是真的搜尋結果）】\n${list}` +
    (r.summary ? `\n搜尋重點：${r.summary}` : '') +
    (r.kind === 'meme' ? `\n這幾張梗圖的圖片就附在主人這句話後面，你看得到；照順序就是 1、2。` : '') +
    `\n請只根據這些真的內容回覆：介紹或吐槽你找到的東西（梗圖要說出圖裡實際在演什麼，看不懂英文梗就說你的理解）。不要編造這裡沒有的內容。網址和圖片系統會自動附上，你不用自己打網址。`
  );
}

/** 給模型看的梗圖圖片（附在主人最新那句話後面） */
export function searchImageParts(r: ChatSearchResult) {
  return r.items.filter((it) => it.image).map((it) => ({ inlineData: { mimeType: it.image!.mime, data: it.image!.data } }));
}

/** 給桌面聊天視窗顯示的附件（不含圖片本體，前端直接載網址） */
export function searchAttachments(r: ChatSearchResult) {
  return r.items.map((it) =>
    it.image
      ? { type: 'image' as const, url: it.image.url, link: it.url, title: it.title }
      : { type: 'link' as const, url: it.url, title: it.title }
  );
}
