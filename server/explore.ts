/**
 * 桌寵自主網路探索（Autonomous Web Exploration）
 *
 *  Phase 2 多源搜尋：YouTube（yt-search）、維基百科 API、Bing 新聞 RSS、Reddit 熱門 RSS、Hacker News API、
 *    PTT 看板（列表 / 看板內搜尋）、巴哈姆特哈啦板（列表 / 看板內搜尋）+ GNN 新聞 RSS
 *    - 實測 DuckDuckGo、Mojeek 與 Reddit 的 JSON API 都會回 403；google-it 需要爬 Google 網頁容易被封；
 *      Bing「網頁搜尋」RSS 回傳的結果跟關鍵字無關（Instagram、購物網站…）不能用。
 *    - 巴哈的全站搜尋會被擋，只能逛「已知看板編號（bsn）」的看板 → 由設定面板提供看板清單。
 *    - Reddit 用機器人 User-Agent 會被 429，用一般瀏覽器字串的 RSS 才抓得到。
 *    - Reddit API 需要審核，改用主人的「私人首頁 RSS」（.env 的 REDDIT_FRONTPAGE_RSS）讀主人自己的首頁。
 *    所有論壇頁面都有 10 分鐘快取；被 403 / 429 擋的網站暫停 15 分鐘，避免被封鎖。
 *  Phase 3 AI 篩選：先讓 Gemini 依喜好規劃搜尋關鍵字，再從候選中挑一篇最有趣的，
 *    依人設滑桿的語氣（server/persona.ts）寫推播與短評。
 */
import ytSearch from 'yt-search';
import { describePersonality, type PersonalityConfig } from './persona';

export type SourceKind = 'youtube' | 'wiki' | 'news' | 'reddit' | 'hn' | 'ptt' | 'bahamut';

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

export interface BahamutBoard {
  name: string;
  bsn: string;
}

export interface ExploreInput {
  personality?: PersonalityConfig;
  petInterests?: string; // 設定面板「探索興趣」
  memoryInterests?: string[]; // 長期記憶裡的主人喜好
  /** 她自己想逛（照她自己的興趣或隨便逛）：不參考主人的 Reddit 首頁和常逛的版 */
  ownMode?: boolean;
  recentUrls?: string[]; // 最近推薦過的，避免重複
  sources?: Partial<Record<SourceKind, boolean>>; // 各來源開關（沒給 = 開）
  pttBoards?: string[]; // 常逛的 PTT 看板（英文板名）
  bahamutBoards?: BahamutBoard[]; // 常逛的巴哈哈啦板
  subreddits?: string[]; // 常逛的 subreddit
}

/** 由 server.ts 注入：送 prompt 給 Gemini 並回傳解析後的 JSON */
export type GenerateJson = (prompt: string, opts?: { temperature?: number; fast?: boolean }) => Promise<any>;

const SOURCE_LABEL: Record<SourceKind, string> = {
  youtube: 'YouTube',
  wiki: '維基百科',
  news: '新聞',
  reddit: 'Reddit',
  hn: 'Hacker News',
  ptt: 'PTT',
  bahamut: '巴哈姆特',
};

export const DEFAULT_PTT_BOARDS = ['C_Chat', 'Steam', 'PlayStation', 'PC_Shopping', 'movie', 'joke'];
export const DEFAULT_BAHAMUT_BOARDS: BahamutBoard[] = [
  { name: '流亡黯道', bsn: '18966' },
  { name: '原神', bsn: '36730' },
  { name: '英雄聯盟', bsn: '17532' },
  { name: '魔物獵人', bsn: '5786' },
  { name: 'Nintendo Switch', bsn: '31587' },
  { name: '電腦應用綜合討論', bsn: '60030' },
];

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/* ───────────────────────── 抓取與解析工具 ───────────────────────── */

// 維基百科要求機器人用可辨識的 User-Agent（用一般瀏覽器字串會被 429 擋）
const BOT_UA = 'GeminiDesktopPet/1.0 (personal desktop-pet hobby project; low volume)';

async function fetchText(
  url: string,
  timeoutMs = 12000,
  userAgent = BROWSER_UA,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', ...extraHeaders },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err: any = new Error(`HTTP ${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

// 論壇頁面快取 + 被擋時整個網站暫停一陣子（禮貌地抓，不要被封）
const PAGE_TTL_MS = 10 * 60 * 1000;
const BLOCKED_PAUSE_MS = 15 * 60 * 1000;
const pageCache = new Map<string, { at: number; text: string }>();
const hostPausedUntil = new Map<string, number>();

async function fetchCached(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const host = new URL(url).hostname;
  if ((hostPausedUntil.get(host) ?? 0) > Date.now()) {
    const err: any = new Error(`${host} 之前擋過我們，先休息一下`);
    err.status = 429;
    throw err;
  }
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.text;
  try {
    const text = await fetchText(url, 12000, BROWSER_UA, extraHeaders);
    pageCache.set(url, { at: Date.now(), text });
    if (pageCache.size > 200) {
      for (const [k, v] of pageCache) if (Date.now() - v.at >= PAGE_TTL_MS) pageCache.delete(k);
    }
    return text;
  } catch (err: any) {
    if (err?.status === 429 || err?.status === 403) hostPausedUntil.set(host, Date.now() + BLOCKED_PAUSE_MS);
    throw err;
  }
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

/** 先放「搜尋結果」，不夠再用「熱門」補，網址重複的去掉 */
function mergeUnique<T extends Candidate>(primary: T[], extra: T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of [...primary, ...extra]) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

const pick = <T,>(arr: T[]): T | undefined => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined);

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

/**
 * Bing 新聞的連結是轉址連結（bing.com/news/apiclick.aspx?tid=亂數&url=真正網址），
 * 每次抓 tid 都不同，會讓「避免重複推薦」失效；這裡把真正的文章網址取出來。
 */
function unwrapBingLink(link: string): string {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith('bing.com') && /apiclick/i.test(u.pathname)) {
      const real = u.searchParams.get('url');
      if (real && /^https?:\/\//i.test(real)) return real;
    }
  } catch {
    // 不是合法網址就原樣回傳
  }
  return link;
}

async function searchBingNews(query: string, limit: number): Promise<Candidate[]> {
  const xml = await fetchText(`https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(query)}`);
  return parseFeed(xml)
    .map((it) => ({ ...it, link: unwrapBingLink(it.link) }))
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

async function redditHot(subreddit: string, limit: number): Promise<Candidate[]> {
  const sub = subreddit.replace(/^\/?r\//i, '').replace(/[^A-Za-z0-9_]/g, '');
  if (!sub) return [];
  const xml = await fetchCached(`https://www.reddit.com/r/${sub}/hot/.rss?limit=15`);
  return parseFeed(xml)
    .filter((it) => /^https?:\/\//.test(it.link) && it.title.trim())
    .slice(0, limit)
    .map((it) => ({ source: 'reddit' as const, title: it.title, url: it.link, snippet: `r/${sub} · ${cleanText(it.description, 180)}` }));
}

/* ── Reddit：主人自己的首頁（私人 RSS，不需要 Reddit API）──
 * Reddit 的 API 現在要審核才能用，但「私人 RSS」還在：
 * https://old.reddit.com/prefs/feeds/ 裡「your front page」那列的 RSS 連結（含私人 token），
 * 放在 .env 的 REDDIT_FRONTPAGE_RSS。連結等於你的首頁鑰匙，所以只放 .env、log 也不印出來。
 */
function redditFrontPageUrl(): string | null {
  const raw = (process.env.REDDIT_FRONTPAGE_RSS || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !/(^|\.)reddit\.com$/i.test(u.hostname) || !u.searchParams.get('feed')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const subredditOf = (link: string) => link.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/i)?.[1] || '';

async function redditFrontPage(): Promise<Candidate[]> {
  const url = redditFrontPageUrl();
  if (!url) return [];
  let xml: string;
  try {
    xml = await fetchCached(url);
  } catch (err: any) {
    // 原本的錯誤訊息含網址（有私人 token），換成不含網址的說明
    const e: any = new Error(
      `讀不到你的 Reddit 首頁（${err?.status ? `HTTP ${err.status}` : '連線失敗'}），請檢查 .env 的 REDDIT_FRONTPAGE_RSS`
    );
    e.status = err?.status;
    throw e;
  }
  return parseFeed(xml)
    .filter((it) => /^https?:\/\//.test(it.link) && it.title.trim())
    .map((it) => {
      const sub = subredditOf(it.link);
      return {
        source: 'reddit' as const,
        title: it.title,
        url: it.link,
        snippet: `${sub ? `r/${sub} · ` : ''}你的 Reddit 首頁 · ${cleanText(it.description, 160)}`,
      };
    });
}

/** 首頁文章裡跟這次主題有關的排前面；都無關就從最前面幾篇隨機挑，偶爾也聊聊你首頁上的別的東西 */
function rankByTopic(items: Candidate[], words: Array<string | undefined>, limit: number): Candidate[] {
  const keys = words
    .flatMap((w) => String(w || '').toLowerCase().split(/[\s,，、/|]+/))
    .filter((w) => w.length >= 2);
  const scored = items.map((c, i) => {
    const hay = `${c.title} ${c.snippet}`.toLowerCase();
    return { c, i, s: keys.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0) };
  });
  const hits = scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
  if (hits.length) return hits.slice(0, limit);
  const top = items.slice(0, 10);
  const out: Candidate[] = [];
  while (top.length && out.length < limit) out.push(top.splice(Math.floor(Math.random() * top.length), 1)[0]);
  return out;
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

/* ── PTT ── */

type Scored = Candidate & { score: number };

/** 解析 PTT 文章列表（看板首頁或看板內搜尋結果），置底公告之後的不要 */
function parsePttList(html: string, board: string): Scored[] {
  const main = html.split('r-list-sep')[0];
  const out: Scored[] = [];
  for (const block of main.split('class="r-ent"').slice(1)) {
    const a = block.match(/<a href="(\/bbs\/[^"]+\.html)">([\s\S]*?)<\/a>/);
    if (!a) continue; // 已刪除的文章
    const title = cleanText(a[2], 120);
    if (!title || /^\[(公告|協尋|板務)\]/.test(title)) continue;
    const nrec = cleanText(block.match(/class="nrec">([\s\S]*?)<\/div>/)?.[1] ?? '');
    const score = nrec === '爆' ? 100 : nrec.startsWith('X') ? -10 : Number(nrec) || 0;
    const date = cleanText(block.match(/class="date">([\s\S]*?)<\/div>/)?.[1] ?? '');
    out.push({
      source: 'ptt',
      title,
      url: `https://www.ptt.cc${a[1]}`,
      snippet: `PTT ${board} 板 · ${score >= 100 ? '爆文' : `推 ${score}`} · ${date}`,
      score,
    });
  }
  return out;
}

/** PTT：先在看板內搜尋主題關鍵字，不夠再用看板首頁推文數最高的補（over18 cookie 讓八卦板等也能進） */
async function pttBoard(board: string, query: string, limit: number): Promise<Candidate[]> {
  const b = board.replace(/[^A-Za-z0-9_-]/g, '');
  if (!b) return [];
  const headers = { Cookie: 'over18=1' };
  const byScore = (x: Scored, y: Scored) => y.score - x.score;
  let found: Scored[] = [];
  if (query) {
    found = parsePttList(await fetchCached(`https://www.ptt.cc/bbs/${b}/search?q=${encodeURIComponent(query)}`, headers), b);
    // 搜尋結果可能翻出一兩年前的文章：有近 60 天的就只留近期的（網址 M.<秒數> 是發文時間）
    const postedAt = (c: Candidate) => Number(c.url.match(/\/M\.(\d{9,10})\./)?.[1] ?? 0) * 1000;
    const recentOnly = found.filter((c) => Date.now() - postedAt(c) < 60 * 86400000);
    if (recentOnly.length > 0) found = recentOnly;
    found.sort(byScore);
  }
  let hot: Scored[] = [];
  if (found.length < limit) {
    hot = parsePttList(await fetchCached(`https://www.ptt.cc/bbs/${b}/index.html`, headers), b)
      .filter((c) => !/^(Re|Fw):/i.test(c.title))
      .sort(byScore);
  }
  return mergeUnique(found, hot, limit).map(({ score, ...c }) => c);
}

/* ── 巴哈姆特 ── */

function parseBahamutList(html: string, board: BahamutBoard): Scored[] {
  const out: Scored[] = [];
  for (const row of html.split('<tr class="b-list__row').slice(1)) {
    if (row.slice(0, 60).includes('--sticky')) continue; // 置頂文
    const href = row.match(/href="(C\.php\?bsn=\d+&(?:amp;)?snA=\d+)/)?.[1];
    const titleHtml = row.match(/class="b-list__main__title[^"]*">([\s\S]*?)<\/p>/)?.[1];
    if (!href || !titleHtml) continue; // 廣告列
    const title = cleanText(titleHtml, 120);
    const brief = cleanText(row.match(/class="b-list__brief">([\s\S]*?)<\/p>/)?.[1] ?? '', 140);
    const interact = Number((row.match(/title="互動：([\d,]+)"/)?.[1] ?? '0').replace(/,/g, '')) || 0;
    const views = row.match(/title="人氣：([\d,]+)"/)?.[1] ?? '0';
    const time = cleanText(row.match(/last=1"[^>]*>([^<]*)</)?.[1] ?? '');
    out.push({
      source: 'bahamut',
      title,
      url: `https://forum.gamer.com.tw/${decodeEntities(href)}`,
      snippet: `巴哈 ${board.name} 板 · 互動 ${interact} · 人氣 ${views}${time ? ` · ${time}` : ''}${brief ? ` · ${brief}` : ''}`,
      score: interact,
    });
  }
  return out;
}

/** 巴哈：看板內標題搜尋，不夠再用看板首頁互動數最高的補 */
async function bahamutBoard(board: BahamutBoard, query: string, limit: number): Promise<Candidate[]> {
  const bsn = board.bsn.replace(/\D/g, '');
  if (!bsn) return [];
  const base = `https://forum.gamer.com.tw/B.php?bsn=${bsn}`;
  const load = async (url: string) => {
    const html = await fetchCached(url);
    // 有年齡限制或需要登入的看板會被導到警示頁
    if (/<title>[^<]*(兒少保護|系統訊息)/.test(html)) throw new Error(`巴哈看板 ${board.name}（${bsn}）需要登入，逛不了`);
    return parseBahamutList(html, board);
  };
  const found = query ? await load(`${base}&qt=1&q=${encodeURIComponent(query)}`) : [];
  const hot = found.length < limit ? (await load(base)).sort((x, y) => y.score - x.score) : [];
  return mergeUnique(found, hot, limit).map(({ score, ...c }) => c);
}

/** 巴哈 GNN 新聞 RSS：只留標題 / 內文提到關鍵字的 */
async function bahamutGnn(query: string, limit: number): Promise<Candidate[]> {
  const words = query.toLowerCase().split(/[\s,，、]+/).filter((w) => w.length >= 2);
  if (words.length === 0) return [];
  const xml = await fetchCached('https://gnn.gamer.com.tw/rss.xml');
  return parseFeed(xml)
    .filter((it) => /^https?:\/\//.test(it.link))
    .filter((it) => words.some((w) => `${it.title} ${it.description}`.toLowerCase().includes(w)))
    .slice(0, limit)
    .map((it) => ({ source: 'bahamut' as const, title: it.title, url: it.link, snippet: `巴哈 GNN 新聞 · ${cleanText(it.description, 160)}` }));
}

// 供測試 / 除錯使用
export const sources = { searchYouTube, searchWikipedia, searchBingNews, redditHot, redditFrontPage, hackerNews, pttBoard, bahamutBoard, bahamutGnn };

/* ───────────────────────── 主流程 ───────────────────────── */

// 最近幾次逛過的興趣，下次先避開
const recentFocus: string[] = [];

/** 依來源輪流挑，讓候選盡量涵蓋不同來源 */
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
  const on = (s: SourceKind) => input.sources?.[s] !== false;

  // AI 很不會「隨機挑」（幾乎每次都挑第一個興趣）→ 由程式抽一個，並避開最近逛過的
  const interests = [
    ...new Set(
      [...(input.petInterests || '').split(/[、,，\n]+/), ...(input.memoryInterests || [])]
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 30)
    ),
  ];
  const fresh = interests.filter((s) => !recentFocus.includes(s));
  const focus = pick(fresh.length ? fresh : interests);
  if (focus) {
    recentFocus.push(focus);
    if (recentFocus.length > Math.min(3, Math.max(0, interests.length - 1))) recentFocus.shift();
  }
  const pttBoards = input.pttBoards?.length ? input.pttBoards : DEFAULT_PTT_BOARDS;
  const bahaBoards = input.bahamutBoards?.length ? input.bahamutBoards : DEFAULT_BAHAMUT_BOARDS;
  // 主人的 Reddit 首頁（有設定才讀）：裡面出現的 subreddit 也當成「主人常逛的」給 AI 參考
  let frontPage: Candidate[] = [];
  if (on('reddit') && redditFrontPageUrl() && !input.ownMode) {
    try {
      frontPage = await redditFrontPage();
    } catch (err: any) {
      log(`[探索] ${err?.message || err}`);
    }
  }
  const subreddits = [
    ...new Set([...(input.subreddits || []), ...frontPage.map((c) => subredditOf(c.url)).filter(Boolean)]),
  ].slice(0, 30);

  // Phase 1→2：讓 Gemini 從喜好裡挑一個今天想逛的主題，並產生各來源的搜尋字
  const forumHints = [
    on('ptt') && `- PTT 看板（優先從這裡挑，也可以挑你很確定存在的其他 PTT 看板英文名稱）：${pttBoards.join('、')}`,
    on('bahamut') && `- 巴哈姆特哈啦板（只能從這份清單挑，用括號裡的編號；都跟主題無關就給空字串）：${bahaBoards.map((b) => `${b.name}(${b.bsn})`).join('、')}`,
    on('reddit') && subreddits.length > 0 && `- 主人常逛的 subreddit（${frontPage.length ? '包含主人 Reddit 首頁上的，' : ''}相關就優先用）：${subreddits.join('、')}`,
  ]
    .filter(Boolean)
    .join('\n');

  let plan: any = {};
  try {
    plan = await generateJson(
      `你是桌寵貓娘「雙子星貓」，主人去忙了，你想趁空檔自己上網逛逛。
${input.ownMode ? '這次你想逛「你自己」有興趣的東西（不是為了主人），以下是你的興趣方向' : '以下是主人的喜好與你的個性設定'}（可能混雜性格描述，請只取出「興趣主題」）：
${seeds || '（沒有特別設定，就挑遊戲、動漫、科技、迷因之類的）'}
${forumHints ? `\n可以逛的論壇：\n${forumHints}\n` : ''}
${
  focus
    ? `這次請圍繞「${focus}」挑一個具體的主題（可以是它的某個面向，例如新聞、攻略、梗、角色）`
    : '請從中「隨機」挑一個今天想逛的主題（不要每次都挑第一個）'
}，各來源的看板與搜尋字都要跟這個主題相關。輸出嚴格 JSON：
{
  "topic": "這次的主題（中文，10字內）",
  "youtubeQuery": "YouTube 搜尋字（英文內容較多的主題用英文）",
  "wikiQuery": "維基百科條目名稱（主題本身或相關的冷知識條目，2~10字）",
  "newsQuery": "新聞搜尋字（簡短，例如遊戲或作品名稱）",
  "subreddit": "最相關的 subreddit 名稱（不含 r/，沒有就給空字串）",
  "hnQuery": "若主題跟科技/科學/科幻有關，給 Hacker News 英文搜尋字，否則空字串",
  "pttBoard": "最相關的 PTT 看板英文名稱",
  "pttQuery": "PTT 看板內標題搜尋字（台灣鄉民的講法，2~6字，例如遊戲簡稱；不確定就空字串）",
  "bahamutBsn": "最相關的巴哈哈啦板編號（數字字串，沒有相關的就空字串）",
  "bahamutQuery": "巴哈看板內標題搜尋字（2~6字，不確定就空字串）"
}`,
      { temperature: 1.0, fast: true }
    );
  } catch (err: any) {
    log(`[探索] 規劃關鍵字失敗，改用簡單關鍵字：${err?.message}`);
  }
  const fallbackTopic =
    seeds.split(/[、,，\n]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 20)[0] || 'Path of Exile';
  const topic = plan.topic || focus || fallbackTopic;
  const q = (s?: string) => (s && String(s).trim()) || topic;
  const opt = (s?: string) => (s && String(s).trim()) || '';

  // 論壇看板：PTT 沒挑就從主人的清單隨機挑（看板內還會用關鍵字搜尋）；
  // Reddit 只逛 AI 挑的（隨便抽一個常逛的 subreddit 常常跟主題無關）；巴哈只能用清單內的看板
  const subreddit = opt(plan.subreddit);
  const pttTarget = opt(plan.pttBoard) || pick(pttBoards) || '';
  const bahaTarget = bahaBoards.find((b) => b.bsn === String(plan.bahamutBsn || '').trim());

  log(
    `[探索] 主題：${topic}｜YT「${q(plan.youtubeQuery)}」 Wiki「${q(plan.wikiQuery)}」 News「${q(plan.newsQuery)}」` +
      ` r/${subreddit || '-'} PTT ${pttTarget || '-'}「${opt(plan.pttQuery)}」 巴哈 ${bahaTarget?.name || '-'}「${opt(plan.bahamutQuery)}」`
  );

  const searchStart = Date.now();
  const jobs: Array<[SourceKind, Promise<Candidate[]>]> = [];
  if (on('ptt') && pttTarget) jobs.push(['ptt', pttBoard(pttTarget, opt(plan.pttQuery), 3)]);
  if (on('bahamut')) {
    jobs.push([
      'bahamut',
      bahaTarget
        ? bahamutBoard(bahaTarget, opt(plan.bahamutQuery), 3)
        : bahamutGnn(`${q(plan.newsQuery)} ${topic}`, 2), // 沒有相關看板 → 看 GNN 有沒有相關新聞
    ]);
  }
  if (on('reddit') && (subreddit || frontPage.length)) {
    jobs.push([
      'reddit',
      (async () => {
        const fromFront = rankByTopic(frontPage, [topic, focus, subreddit, plan.youtubeQuery, plan.newsQuery], 2);
        let hot: Candidate[] = [];
        if (subreddit) {
          try {
            hot = await redditHot(subreddit, 3);
          } catch (err: any) {
            if (!fromFront.length) throw err;
            log(`[探索] r/${subreddit} 讀取失敗，只用你的首頁：${err?.message || err}`);
          }
        }
        return mergeUnique(fromFront, hot, 4);
      })(),
    ]);
  }
  if (on('youtube')) jobs.push(['youtube', searchYouTube(q(plan.youtubeQuery), 3)]);
  if (on('news')) jobs.push(['news', searchBingNews(q(plan.newsQuery), 3)]);
  if (on('wiki')) jobs.push(['wiki', searchWikipedia(q(plan.wikiQuery), 2)]);
  if (on('hn') && plan.hnQuery) jobs.push(['hn', hackerNews(plan.hnQuery, 2)]);
  if (jobs.length === 0) throw new Error('所有探索來源都被關掉了');

  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  const recent = new Set(input.recentUrls || []);
  const groups = settled.map((r, i) => {
    if (r.status === 'rejected') {
      log(`[探索] ${SOURCE_LABEL[jobs[i][0]]} 搜尋失敗：${r.reason?.message || r.reason}`);
      return [];
    }
    return r.value.filter((c) => c.title && !recent.has(c.url));
  });
  const candidates = interleave(groups, 8);
  log(
    `[探索] 搜尋完成（${Date.now() - searchStart}ms），候選 ${candidates.length} 筆：` +
      jobs.map(([s], i) => `${SOURCE_LABEL[s]} ${groups[i].length}`).join('、')
  );
  if (candidates.length === 0) throw new Error('所有來源都沒有抓到東西');

  // Phase 3：資料清洗成純文字，交給 Gemini 挑一篇並寫短評
  const listing = candidates
    .map((c, i) => `${i + 1}. [${SOURCE_LABEL[c.source]}] ${c.title}\n   摘要：${c.snippet || '（無）'}`)
    .join('\n');

  // 語氣完全跟著設定面板的人設滑桿走（毒舌 / 話癆 / 幽默 / 傲嬌），不在這裡寫死
  const persona = describePersonality(input.personality);
  let choice: any = {};
  try {
    choice = await generateJson(
      `你是桌寵貓娘「雙子星貓」，剛剛自己上網逛了「${topic}」，找到這些：
${listing}

【你的性格】：${persona.traits}
【說話語氣】：${persona.toneRule}

從中挑出「跟主題『${topic}』直接相關、而且最有趣」的一篇分享給主人。
跟主題無關的東西（例如購物頁、軟體教學、網站首頁）絕對不要選；如果都普普通通，就挑最貼近主題的那篇。
論壇文章（PTT、巴哈、Reddit）推文 / 互動數高的通常比較有梗，可以優先考慮。
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

  const idx = Math.min(candidates.length, Math.max(1, Number(choice.pick) || 1)) - 1;
  const chosen = candidates[idx];
  const isForum = chosen.source === 'reddit' || chosen.source === 'ptt' || chosen.source === 'bahamut';
  return {
    id: 'disc_' + Date.now(),
    title: chosen.title,
    url: chosen.url,
    source: chosen.source,
    sourceLabel: SOURCE_LABEL[chosen.source],
    snippet: chosen.snippet,
    catReview: choice.catReview || '這個看起來挺有意思的，給你看看～',
    bubbleText: choice.bubbleText || persona.bubbleExample,
    category: choice.category || (chosen.source === 'youtube' ? 'gaming' : isForum ? 'forum' : 'article'),
    tag: choice.tag || topic.slice(0, 4),
    topic,
    discoveredAt: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
  };
}

/* ───────────────────────── 設定解析（server.ts 用） ───────────────────────── */

const splitList = (s: unknown): string[] =>
  typeof s === 'string' ? s.split(/[,，、\n]+/).map((x) => x.trim()).filter(Boolean) : [];

/** 「C_Chat, Steam」或含網址的字串 → 看板英文名 */
export function parsePttBoards(s: unknown): string[] {
  return splitList(s)
    .map((x) => (x.match(/bbs\/([A-Za-z0-9_-]+)/)?.[1] ?? x).replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
    .slice(0, 20);
}

/** 「流亡黯道 18966、原神 36730」或看板網址 → [{ name, bsn }] */
export function parseBahamutBoards(s: unknown): BahamutBoard[] {
  return splitList(s)
    .map((x) => {
      const bsn = x.match(/bsn=(\d+)/)?.[1] ?? x.match(/(\d{2,6})\s*\)?\s*$/)?.[1];
      if (!bsn) return null;
      const name = x.replace(/https?:\/\/\S+/, '').replace(/[(（]?\s*\d{2,6}\s*[)）]?\s*$/, '').trim() || `看板 ${bsn}`;
      return { name, bsn };
    })
    .filter((b): b is BahamutBoard => b !== null)
    .slice(0, 20);
}

export function parseSubreddits(s: unknown): string[] {
  return splitList(s)
    .map((x) => x.replace(/^.*\/r\//i, '').replace(/^r\//i, '').replace(/[^A-Za-z0-9_]/g, ''))
    .filter(Boolean)
    .slice(0, 20);
}
