/**
 * 桌寵自主網路探索（Autonomous Web Exploration）
 *
 *  Phase 2 多源搜尋：YouTube（yt-search）、維基百科 API、Bing 新聞 RSS、Reddit 熱門 RSS、Hacker News API
 *    - 實測 DuckDuckGo、Mojeek 與 Reddit 的 JSON API 都會回 403；google-it 需要爬 Google 網頁容易被封；
 *      Bing「網頁搜尋」RSS 回傳的結果跟關鍵字無關（Instagram、購物網站…）不能用。
 *      所以改用這些「官方提供、免金鑰」而且結果準確的 RSS / API，不需要額外安裝套件。
 *  Phase 3 AI 篩選：先讓 Gemini 依喜好規劃搜尋關鍵字，再從候選中挑一篇最有趣的，
 *    依人設滑桿的語氣（server/persona.ts）寫推播與短評。
 */
import ytSearch from 'yt-search';
import { describePersonality, type PersonalityConfig } from './persona';

export type SourceKind = 'youtube' | 'wiki' | 'news' | 'reddit' | 'hn';

export interface Candidate {
  source: SourceKind;
  title: string;
  url: string;
  snippet: string;
}

export interface Discovery {
  id: string;
  title: string;
  url: string;
  source: SourceKind;
  sourceLabel: string;
  snippet: string;
  catReview: string;
  bubbleText: string;
  category: string;
  tag: string;
  topic: string;
  discoveredAt: string;
}

export interface ExploreInput {
  personality?: PersonalityConfig;
  petInterests?: string; // 設定面板「探索興趣」
  memoryInterests?: string[]; // 長期記憶裡的主人喜好
  recentUrls?: string[]; // 最近推薦過的，避免重複
}

/** 由 server.ts 注入：送 prompt 給 Gemini 並回傳解析後的 JSON */
export type GenerateJson = (prompt: string, opts?: { temperature?: number; fast?: boolean }) => Promise<any>;

const SOURCE_LABEL: Record<SourceKind, string> = {
  youtube: 'YouTube',
  wiki: '維基百科',
  news: '新聞',
  reddit: 'Reddit',
  hn: 'Hacker News',
};

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/* ───────────────────────── 抓取與解析工具 ───────────────────────── */

// 維基百科要求機器人用可辨識的 User-Agent（用一般瀏覽器字串會被 429 擋）
const BOT_UA = 'GeminiDesktopPet/1.0 (personal desktop-pet hobby project; low volume)';

async function fetchText(url: string, timeoutMs = 12000, userAgent = BROWSER_UA): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err: any = new Error(`HTTP ${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

function cleanText(s: string, max = 220): string {
  const text = decodeEntities(decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

/** 同時支援 RSS <item> 與 Atom <entry>（Reddit） */
function parseFeed(xml: string): Array<{ title: string; link: string; description: string }> {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    return {
      title: cleanText(pickTag(b, 'title'), 160),
      link: decodeEntities(atomLink || cleanText(pickTag(b, 'link'), 600)),
      description: pickTag(b, 'description') || pickTag(b, 'content') || pickTag(b, 'summary'),
    };
  });
}

/* ───────────────────────── 各搜尋來源 ───────────────────────── */

async function searchYouTube(query: string, limit: number): Promise<Candidate[]> {
  const r = await ytSearch(query);
  return r.videos.slice(0, limit).map((v) => ({
    source: 'youtube' as const,
    title: v.title,
    url: v.url,
    snippet: cleanText(`${v.author?.name ?? ''} · ${v.timestamp ?? ''} · ${v.description ?? ''}`),
  }));
}

async function searchBingNews(query: string, limit: number): Promise<Candidate[]> {
  const xml = await fetchText(`https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(query)}`);
  return parseFeed(xml)
    .filter((it) => /^https?:\/\//.test(it.link))
    .slice(0, limit)
    .map((it) => ({ source: 'news' as const, title: it.title, url: it.link, snippet: cleanText(it.description) }));
}

/** 維基百科條目搜尋：關鍵字含中日文就搜中文維基，否則英文維基 */
async function searchWikipedia(query: string, limit: number): Promise<Candidate[]> {
  const lang = /[぀-ヿ㐀-鿿]/.test(query) ? 'zh' : 'en';
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1` +
    `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}` +
    (lang === 'zh' ? '&variant=zh-tw' : '');
  const data = JSON.parse(await fetchText(url, 12000, BOT_UA));
  return (data.query?.search || []).map((s: any) => ({
    source: 'wiki' as const,
    title: s.title,
    url: `https://${lang}.wikipedia.org/${lang === 'zh' ? 'zh-tw' : 'wiki'}/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
    snippet: cleanText(s.snippet),
  }));
}

// Reddit RSS 有頻率限制：快取 10 分鐘，被 429 時冷卻 15 分鐘
const redditCache = new Map<string, { at: number; items: Candidate[] }>();
let redditCooldownUntil = 0;

async function redditHot(subreddit: string, limit: number): Promise<Candidate[]> {
  const sub = subreddit.replace(/^\/?r\//i, '').replace(/[^A-Za-z0-9_]/g, '');
  if (!sub || Date.now() < redditCooldownUntil) return [];
  const cached = redditCache.get(sub);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.items.slice(0, limit);
  try {
    const xml = await fetchText(`https://www.reddit.com/r/${sub}/hot/.rss?limit=15`);
    const items = parseFeed(xml)
      .filter((it) => /^https?:\/\//.test(it.link) && !/^\s*$/.test(it.title))
      .map((it) => ({ source: 'reddit' as const, title: it.title, url: it.link, snippet: `r/${sub} · ${cleanText(it.description, 180)}` }));
    redditCache.set(sub, { at: Date.now(), items });
    return items.slice(0, limit);
  } catch (err: any) {
    if (err?.status === 429) redditCooldownUntil = Date.now() + 15 * 60 * 1000;
    throw err;
  }
}

async function hackerNews(query: string, limit: number): Promise<Candidate[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit * 2}`;
  const data = JSON.parse(await fetchText(url));
  return (data.hits || [])
    .filter((h: any) => h.title)
    .slice(0, limit)
    .map((h: any) => ({
      source: 'hn' as const,
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `Hacker News · ${h.points ?? 0} points · ${h.num_comments ?? 0} comments`,
    }));
}

// 供測試 / 除錯使用
export const sources = { searchYouTube, searchWikipedia, searchBingNews, redditHot, hackerNews };

/* ───────────────────────── 主流程 ───────────────────────── */


/** 依來源輪流挑，讓 5 篇候選盡量涵蓋不同來源 */
function interleave(groups: Candidate[][], max: number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; out.length < max && groups.some((g) => g.length > i); i++) {
    for (const g of groups) if (g[i] && out.length < max) out.push(g[i]);
  }
  return out;
}

export async function runAutoExplore(
  input: ExploreInput,
  generateJson: GenerateJson,
  log: (msg: string) => void = console.log
): Promise<Discovery> {
  const seeds = [input.petInterests, input.personality?.customPrompt, (input.memoryInterests || []).join('、')]
    .filter(Boolean)
    .join('\n');

  // Phase 1→2：讓 Gemini 從喜好裡挑一個今天想逛的主題，並產生各來源的搜尋字
  let plan: any = {};
  try {
    plan = await generateJson(
      `你是桌寵貓娘「雙子星貓」，主人去忙了，你想趁空檔自己上網逛逛。
以下是主人的喜好與你的個性設定（可能混雜性格描述，請只取出「興趣主題」）：
${seeds || '（沒有特別設定，就挑遊戲、動漫、科技、迷因之類的）'}

請從中「隨機」挑一個今天想逛的主題（不要每次都挑第一個），並輸出嚴格 JSON：
{
  "topic": "這次的主題（中文，10字內）",
  "youtubeQuery": "YouTube 搜尋字（英文內容較多的主題用英文）",
  "wikiQuery": "維基百科條目名稱（主題本身或相關的冷知識條目，2~10字）",
  "newsQuery": "新聞搜尋字（簡短，例如遊戲或作品名稱）",
  "subreddit": "最相關的 subreddit 名稱（不含 r/，沒有就給空字串）",
  "hnQuery": "若主題跟科技/科學/科幻有關，給 Hacker News 英文搜尋字，否則空字串"
}`,
      { temperature: 1.0, fast: true }
    );
  } catch (err: any) {
    log(`[探索] 規劃關鍵字失敗，改用簡單關鍵字：${err?.message}`);
  }
  const fallbackTopic =
    seeds.split(/[、,，\n]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 20)[0] || 'Path of Exile';
  const topic = plan.topic || fallbackTopic;
  const q = (s?: string) => (s && String(s).trim()) || topic;
  log(
    `[探索] 主題：${topic}｜YT「${q(plan.youtubeQuery)}」 Wiki「${q(plan.wikiQuery)}」 News「${q(plan.newsQuery)}」 r/${plan.subreddit || '-'}`
  );

  const searchStart = Date.now();
  const jobs: Array<[SourceKind, Promise<Candidate[]>]> = [
    ['youtube', searchYouTube(q(plan.youtubeQuery), 3)],
    ['wiki', searchWikipedia(q(plan.wikiQuery), 2)],
    ['news', searchBingNews(q(plan.newsQuery), 3)],
  ];
  if (plan.subreddit) jobs.push(['reddit', redditHot(plan.subreddit, 3)]);
  if (plan.hnQuery) jobs.push(['hn', hackerNews(plan.hnQuery, 2)]);

  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  const recent = new Set(input.recentUrls || []);
  const groups = settled.map((r, i) => {
    if (r.status === 'rejected') {
      log(`[探索] ${SOURCE_LABEL[jobs[i][0]]} 搜尋失敗：${r.reason?.message || r.reason}`);
      return [];
    }
    return r.value.filter((c) => c.title && !recent.has(c.url));
  });
  const candidates = interleave(groups, 5);
  log(`[探索] 搜尋完成（${Date.now() - searchStart}ms），候選 ${candidates.length} 筆`);
  if (candidates.length === 0) throw new Error('所有來源都沒有抓到東西');

  // Phase 3：資料清洗成純文字，交給 Gemini 挑一篇並寫短評
  const listing = candidates
    .map((c, i) => `${i + 1}. [${SOURCE_LABEL[c.source]}] ${c.title}\n   摘要：${c.snippet || '（無）'}`)
    .join('\n');

  // 語氣完全跟著設定面板的人設滑桿走（毒舌 / 話癆 / 幽默 / 傲嬌），不在這裡寫死
  const persona = describePersonality(input.personality);
  let pick: any = {};
  try {
    pick = await generateJson(
      `你是桌寵貓娘「雙子星貓」，剛剛自己上網逛了「${topic}」，找到這些：
${listing}

【你的性格】：${persona.traits}
【說話語氣】：${persona.toneRule}

從中挑出「跟主題『${topic}』直接相關、而且最有趣」的一篇分享給主人。
跟主題無關的東西（例如購物頁、軟體教學、網站首頁）絕對不要選；如果都普普通通，就挑最貼近主題的那篇。
bubbleText 與 catReview 都必須完全依照上面的【說話語氣】來寫。輸出嚴格 JSON：
{
  "pick": 被選中的編號（1~${candidates.length} 的數字）,
  "bubbleText": "跳出來叫主人看的一句話（30字內，${persona.lengthHint}）。語氣參考：「${persona.bubbleExample}」，但要換成自己的話",
  "catReview": "${persona.reviewStyle}，要提到具體內容（40字內）",
  "category": "gaming | animation | funny | tech | music | news | forum | article 其中一個",
  "tag": "2~4字的標籤"
}`,
      { temperature: 0.9 }
    );
  } catch (err: any) {
    log(`[探索] AI 篩選失敗，隨機挑一篇：${err?.message}`);
  }

  const idx = Math.min(candidates.length, Math.max(1, Number(pick.pick) || 1)) - 1;
  const chosen = candidates[idx];
  return {
    id: 'disc_' + Date.now(),
    title: chosen.title,
    url: chosen.url,
    source: chosen.source,
    sourceLabel: SOURCE_LABEL[chosen.source],
    snippet: chosen.snippet,
    catReview: pick.catReview || '這個看起來挺有意思的，給你看看～',
    bubbleText: pick.bubbleText || persona.bubbleExample,
    category: pick.category || (chosen.source === 'youtube' ? 'gaming' : chosen.source === 'reddit' ? 'forum' : 'article'),
    tag: pick.tag || topic.slice(0, 4),
    topic,
    discoveredAt: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
  };
}
