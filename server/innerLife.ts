/**
 * 她的「內在生活」：觀察日誌 → 興趣自然湧現。
 *
 * 沒有人幫她設定喜歡什麼。她只是一直在旁邊看：主人的螢幕、在 Gemini 網頁問的事、聊天、她自己逛到的東西。
 *  1. 觀察日誌：每次看到 / 聽到，就記一筆原始觀察（文字）。
 *  2. 定期整理（每幾小時，或累積夠多筆）：請模型把新觀察標上「主題」和「具體的東西」
 *     （例如 主題「盆栽」、東西「龜背芋」）。
 *  3. 主題權重：同一天出現只算一次（避免一天狂看就暴衝），權重會隨時間衰減（半衰期 14 天）。
 *  4. 湧現：最近 30 天裡有 4 天以上碰到、橫跨 10 天以上、權重夠高 → 變成「她自己的興趣」，並記下由來。
 *     太久沒碰到、權重掉光 → 興趣淡掉。
 *
 * 長出來的興趣會：寫進聊天提示（偶爾流露）、加進她閒逛的方向、讓她閒置時主動問起具體的東西
 * （「你上次看的那盆龜背芋後來有買嗎？」）。
 *
 * 興趣獨立性（不要變成主人的鏡子）：
 *  - 來源有分量：主人那邊來的（螢幕、Gemini、聊天、LINE）只算 0.35～0.4；陪主人逛的 0.6；
 *    她自己逛的（own）、在河木鎮經歷的（town）算 1。
 *  - 天性過濾：整理時依她的天性打分數（很喜歡 ×1.4、普通 ×1、沒興趣 ×0.5），所以主人愛的東西她不一定愛。
 *  - 長出來的興趣分兩種：「自己的」（她自己那邊的分量夠多）和「主人喜歡的、你知道」（大多是從主人那邊看來的）。
 *    後者她可以有自己的看法，甚至覺得無聊。
 *  - 會膩：自己的興趣 12 天沒有新東西 → 有點膩了，不再主動去逛，直到看到新的東西。
 *
 * 存在 data/memories/inner-life.json（只在主人自己的電腦上）。
 */
import fs from 'fs';
import path from 'path';

export type ObservationSource = 'screen' | 'gemini_web' | 'chat' | 'line' | 'explore' | 'own' | 'town';

/** 每種來源算多少分量（主人那邊來的打折，她自己的算滿） */
const SOURCE_WEIGHT: Record<ObservationSource, number> = {
  screen: 0.35,
  gemini_web: 0.35,
  chat: 0.4,
  line: 0.4,
  explore: 0.6,
  own: 1,
  town: 1,
};
const SELF_SOURCES: ObservationSource[] = ['own', 'town'];

/** 她的天性：決定她對什麼比較容易起興趣（不是設定好的興趣，只是傾向） */
export const TEMPERAMENT =
  '喜歡：星空和天文、宇宙航行、古老的機械和老東西、貓、奇怪的冷知識、甜點、亮晶晶或會發光的東西、有點神秘的傳說；' +
  '沒興趣：下雨和潮濕、無聊的重複作業、太吵太擠的東西、純數字的財經消息';

/** 她隨便逛的時候，會從這些「完全隨機」的方向裡挑（跟主人無關） */
export const CURIOSITY_POOL = [
  '深海生物', '古代文明', '廢墟探險', '奇怪的發明', '太空站生活', '甜點的歷史', '世界各地的火車', '機械鐘錶',
  '極光', '世界各地的貓', '天文攝影', '古地圖', '隕石', '燈塔', '自動人偶', '古代天文儀器', '螢火蟲', '奇怪的博物館',
];

interface Observation {
  at: number;
  source: ObservationSource;
  text: string;
  tagged?: boolean;
}

export interface Interest {
  topic: string;
  weight: number;
  weightAt: number; // weight 是在這個時間點算的（之後要先衰減）
  days: string[]; // 碰到這個主題的日子（YYYY-MM-DD，不重複）
  sources: Partial<Record<ObservationSource, number>>;
  /** 從她自己那邊（own、town）累積的分量 / 從主人那邊累積的分量 */
  selfWeight?: number;
  masterWeight?: number;
  /** 她對這個主題的天性傾向：每次整理的分數累加（2 很喜歡、1 普通、0 沒興趣） */
  appealSum?: number;
  appealCount?: number;
  /** 長出來的興趣是「自己的」還是「主人喜歡的（她知道）」 */
  kind?: 'mine' | 'master';
  /** 最近一次看到新的具體東西 */
  lastNewDetailAt?: number;
  /** 膩了（自己的興趣很久沒新東西） */
  bored?: boolean;
  details: string[]; // 最近看到的具體東西（龜背芋…）
  firstSeen: number;
  lastSeen: number;
  emerged: boolean;
  emergedAt?: number;
  origin?: string; // 這個興趣怎麼來的
  asked: Record<string, number>; // 已經主動問過的具體東西 → 時間
  lastAskedAt?: number;
}

interface Store {
  observations: Observation[];
  interests: Record<string, Interest>;
  lastReflectAt: number;
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_OBS = 500;
const WEIGHT_HALF_LIFE_DAYS = 14;
const EMERGE_DAYS = 4; // 最近 30 天內碰到幾天以上
const EMERGE_SPAN_DAYS = 10; // 而且要橫跨 10 天以上（是「這幾週」慢慢在意，不是一口氣看了幾天）
const EMERGE_WEIGHT = 2.2;
const FADE_WEIGHT = 0.8;
const REFLECT_EVERY_MS = 4 * 60 * 60 * 1000;
const REFLECT_MIN_NEW = 25;
const ASK_COOLDOWN_MS = 2 * DAY; // 主動問的間隔（整體）
const SAME_DETAIL_COOLDOWN_MS = 14 * DAY;

const SOURCE_LABEL: Record<ObservationSource, string> = {
  screen: '在螢幕上看',
  gemini_web: '問 Gemini',
  chat: '跟你聊',
  line: '在 LINE 上聊',
  explore: '陪主人的喜好在網路上逛到',
  own: '你自己隨便逛到',
  town: '在河木鎮碰到',
};
const BORED_AFTER_MS = 12 * DAY;
const SELF_SHARE_FOR_MINE = 0.35;

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type GenerateJson = (prompt: string) => Promise<any>;

export function createInnerLife(dataDir: string) {
  const dir = path.join(dataDir, 'memories');
  const file = path.join(dir, 'inner-life.json');
  let store: Store = { observations: [], interests: {}, lastReflectAt: 0 };
  try {
    if (fs.existsSync(file)) store = { ...store, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 壞掉就從頭開始
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
        fs.renameSync(tmp, file);
      } catch (err: any) {
        console.warn('[內在生活] 儲存失敗：', err?.message);
      }
    }, 500);
  };

  /** 這個主題有多少是她自己碰到的（0～1）；舊資料沒有分開記，就看來源次數 */
  function selfShare(it: Interest): number {
    if ((it.selfWeight || 0) + (it.masterWeight || 0) > 0) return (it.selfWeight || 0) / ((it.selfWeight || 0) + (it.masterWeight || 0));
    const total = Object.values(it.sources).reduce((a, b) => a + (b || 0), 0) || 1;
    return SELF_SOURCES.reduce((a, s) => a + (it.sources[s] || 0), 0) / total;
  }

  /** 天性傾向：like / neutral / dislike */
  function stanceOf(it: Interest): 'like' | 'neutral' | 'dislike' {
    if (!it.appealCount) return 'neutral';
    const avg = (it.appealSum || 0) / it.appealCount;
    return avg >= 1.4 ? 'like' : avg < 0.6 ? 'dislike' : 'neutral';
  }

  /** 衰減到現在的權重 */
  const weightNow = (it: Interest, now = Date.now()) =>
    it.weight * Math.pow(0.5, (now - it.weightAt) / (WEIGHT_HALF_LIFE_DAYS * DAY));

  /* ───────── 1. 觀察 ───────── */

  function note(source: ObservationSource, text: string, now = Date.now()) {
    const t = String(text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (t.length < 4) return;
    // 30 分鐘內一模一樣的就不重複記
    if (store.observations.some((o) => o.text === t && now - o.at < 30 * 60 * 1000)) return;
    store.observations.push({ at: now, source, text: t });
    if (store.observations.length > MAX_OBS) store.observations.splice(0, store.observations.length - MAX_OBS);
    save();
  }

  /* ───────── 2. 整理 + 3. 權重 + 4. 湧現 ───────── */

  function shouldReflect(now = Date.now()) {
    const fresh = store.observations.filter((o) => !o.tagged).length;
    return fresh >= REFLECT_MIN_NEW || (fresh > 0 && now - store.lastReflectAt > REFLECT_EVERY_MS);
  }

  function applyTag(topic: string, thing: string | null, obs: Observation, now: number, appeal = 1) {
    const key = topic.trim().slice(0, 24);
    if (!key) return;
    const it: Interest = store.interests[key] || {
      topic: key,
      weight: 0,
      weightAt: obs.at,
      days: [],
      sources: {},
      details: [],
      firstSeen: obs.at,
      lastSeen: obs.at,
      emerged: false,
      asked: {},
    };
    const day = dayKey(obs.at);
    const newDay = !it.days.includes(day);
    // 新的一天碰到 +1；同一天再碰到只 +0.2（一天狂看不會暴衝）
    // × 來源分量（主人那邊來的打折）× 天性（很喜歡 1.4、普通 1、沒興趣 0.5）
    const a = Math.max(0, Math.min(2, Number(appeal)));
    const appealFactor = a >= 1.5 ? 1.4 : a < 0.5 ? 0.5 : 1;
    const inc = (newDay ? 1 : 0.2) * (SOURCE_WEIGHT[obs.source] ?? 0.5) * appealFactor;
    it.weight = weightNow(it, obs.at) + inc;
    if (SELF_SOURCES.includes(obs.source)) it.selfWeight = (it.selfWeight || 0) + inc;
    else it.masterWeight = (it.masterWeight || 0) + inc;
    it.appealSum = (it.appealSum || 0) + a;
    it.appealCount = (it.appealCount || 0) + 1;
    it.weightAt = obs.at;
    if (newDay) it.days = [...it.days, day].slice(-60);
    it.sources[obs.source] = (it.sources[obs.source] || 0) + 1;
    if (thing) {
      const t = thing.trim().slice(0, 20);
      if (t && t !== key) {
        if (!it.details.includes(t)) {
          it.lastNewDetailAt = obs.at;
          it.bored = false;
        }
        it.details = [...it.details.filter((d) => d !== t), t].slice(-6);
      }
    }
    it.lastSeen = Math.max(it.lastSeen, obs.at);
    store.interests[key] = it;
  }

  function updateEmergence(now = Date.now()): string[] {
    const changes: string[] = [];
    const since = dayKey(now - 30 * DAY);
    for (const it of Object.values(store.interests)) {
      const w = weightNow(it, now);
      const recent = it.days.filter((d) => d >= since).sort();
      const span = recent.length ? (Date.parse(recent[recent.length - 1]) - Date.parse(recent[0])) / DAY : 0;
      if (!it.emerged && recent.length >= EMERGE_DAYS && span >= EMERGE_SPAN_DAYS && w >= EMERGE_WEIGHT) {
        it.emerged = true;
        it.emergedAt = now;
        it.lastNewDetailAt = it.lastNewDetailAt || now;
        const top = (Object.entries(it.sources) as Array<[ObservationSource, number]>).sort((a, b) => b[1] - a[1])[0];
        const share = selfShare(it);
        it.kind = share >= SELF_SHARE_FOR_MINE ? 'mine' : 'master';
        it.origin =
          it.kind === 'mine'
            ? `因為這幾週常常${top ? SOURCE_LABEL[top[0]] : '碰到'}跟「${it.topic}」有關的東西，你不知不覺也在意起來了`
            : `這是主人很常在看的東西，你在旁邊看久了也很熟，但它不一定是你的菜`;
        changes.push(it.kind === 'mine' ? `長出自己的新興趣：${it.topic}` : `知道主人很喜歡：${it.topic}`);
      } else if (it.emerged && w < FADE_WEIGHT && now - it.lastSeen > 45 * DAY) {
        it.emerged = false;
        changes.push(`興趣淡掉了：${it.topic}`);
      } else if (it.emerged) {
        // 分類會跟著變：她自己越來越常碰到 → 變成自己的
        const kind = selfShare(it) >= SELF_SHARE_FOR_MINE ? 'mine' : 'master';
        if (kind !== it.kind) {
          it.kind = kind;
          changes.push(kind === 'mine' ? `「${it.topic}」變成她自己的興趣了` : `「${it.topic}」比較像是主人的興趣`);
        }
        // 會膩：自己的興趣很久沒看到新東西
        if (it.kind === 'mine' && !it.bored && now - (it.lastNewDetailAt || it.emergedAt || now) > BORED_AFTER_MS) {
          it.bored = true;
          changes.push(`對「${it.topic}」有點膩了`);
        }
      }
    }
    // 太久沒碰、權重也很低的主題就清掉，檔案不會一直長大
    for (const [k, it] of Object.entries(store.interests)) {
      if (!it.emerged && weightNow(it, now) < 0.15 && now - it.lastSeen > 60 * DAY) delete store.interests[k];
    }
    return changes;
  }

  let reflecting = false;
  /** 把還沒整理的觀察標上主題（由 server.ts 給模型呼叫函式） */
  async function reflect(generateJson: GenerateJson, now = Date.now()): Promise<string[]> {
    if (reflecting) return [];
    const fresh = store.observations.filter((o) => !o.tagged).slice(-60);
    if (!fresh.length) return [];
    reflecting = true;
    try {
      const known = Object.values(store.interests)
        .sort((a, b) => weightNow(b, now) - weightNow(a, now))
        .slice(0, 40)
        .map((i) => i.topic);
      const prompt = `你在幫一隻桌寵貓娘「西雅」整理她這幾天「看到、聽到的東西」。下面是觀察紀錄（主人的螢幕、主人問 Gemini 的問題、主人跟她聊的話、陪主人逛到的、她自己隨便逛到的、她在河木鎮碰到的事）。
西雅的天性：${TEMPERAMENT}
請幫每一筆標上：
- topic：生活化的主題，2~6 字（例如「盆栽」「Path of Exile」「重金屬音樂」「咖啡」「機械鍵盤」）。同一件事請盡量沿用已經有的主題名稱：${known.length ? known.join('、') : '（目前沒有）'}
- thing：這筆裡面提到的「具體的東西」（例如「龜背芋」「Master of Puppets」），沒有就給 null。
- appeal：以西雅的天性來看，她自己會不會被這個主題吸引：2 很吸引她、1 普通、0 她沒興趣（跟主人喜不喜歡無關）。
沒有實質內容的（系統畫面、空白桌面、桌寵自己、打招呼、單純的情緒回應）請 topic 給 null。

觀察紀錄：
${fresh.map((o, i) => `${i}. [${o.source}] ${o.text}`).join('\n')}

輸出嚴格 JSON：{"tags":[{"i":0,"topic":"...或 null","thing":"...或 null","appeal":1}]}`;
      const parsed = await generateJson(prompt);
      const tags: any[] = Array.isArray(parsed?.tags) ? parsed.tags : [];
      for (const tag of tags) {
        const obs = fresh[Number(tag?.i)];
        if (!obs) continue;
        if (typeof tag.topic === 'string' && tag.topic.trim() && tag.topic !== 'null') {
          applyTag(tag.topic, typeof tag.thing === 'string' && tag.thing !== 'null' ? tag.thing : null, obs, now, tag.appeal ?? 1);
        }
      }
      for (const o of fresh) o.tagged = true;
      store.lastReflectAt = now;
      const changes = updateEmergence(now);
      save();
      return changes;
    } finally {
      reflecting = false;
    }
  }

  /* ───────── 使用 ───────── */

  function emerged(now = Date.now()): Interest[] {
    return Object.values(store.interests)
      .filter((i) => i.emerged)
      .sort((a, b) => weightNow(b, now) - weightNow(a, now));
  }

  /** 聊天提示：她自己慢慢長出來的興趣（偶爾流露） */
  function describeForChat(now = Date.now()): string {
    const all = emerged(now);
    const mine = all.filter((i) => i.kind !== 'master').slice(0, 3);
    const masters = all.filter((i) => i.kind === 'master').slice(0, 3);
    if (!mine.length && !masters.length) return '';
    const stanceText: Record<string, string> = {
      like: '你其實也滿喜歡',
      neutral: '你覺得還好',
      dislike: '老實說你覺得有點無聊（可以吐槽，但不要掃主人的興）',
    };
    return (
      (mine.length
        ? `【你自己慢慢長出來的興趣（沒有人設定，是你自己在意起來的）】\n` +
          mine
            .map(
              (i) =>
                `- ${i.topic}：${i.origin || ''}${i.details.length ? `；最近看到的：${i.details.slice(-3).join('、')}` : ''}${i.bored ? '（最近有點膩了，提到時興致沒那麼高）' : ''}`
            )
            .join('\n') +
          `\n（偶爾——不是每次——可以自然流露：聊到相關話題時特別起勁、有自己的看法，或順口提一句你最近也在注意。不要硬扯到不相關的話題。）\n`
        : '') +
      (masters.length
        ? `【主人很喜歡、你在旁邊看久了很熟的東西（不一定是你的菜）】\n` +
          masters.map((i) => `- ${i.topic}：${stanceText[stanceOf(i)]}`).join('\n') +
          `\n（聊到這些時你很熟、接得上話，但你有自己的看法；不用假裝跟主人一樣熱衷。）`
        : '')
    );
  }

  /** 給閒逛：她自己的興趣也是她會去找的方向 */
  function exploreHints(now = Date.now()): string[] {
    return emerged(now)
      .filter((i) => i.kind !== 'master' && !i.bored)
      .slice(0, 3)
      .map((i) => (i.details.length ? `${i.topic}（${i.details.slice(-2).join('、')}）` : i.topic));
  }

  /** 閒置時想主動問的事：興趣裡最近看到、還沒問過的具體東西 */
  function pickCuriosity(now = Date.now()): { topic: string; thing: string; origin: string } | null {
    const anyRecentAsk = Object.values(store.interests).some((i) => i.lastAskedAt && now - i.lastAskedAt < ASK_COOLDOWN_MS);
    if (anyRecentAsk) return null;
    for (const it of emerged(now).filter((i) => !i.bored)) {
      const thing = [...it.details].reverse().find((d) => !it.asked[d] || now - it.asked[d] > SAME_DETAIL_COOLDOWN_MS);
      if (thing) return { topic: it.topic, thing, origin: it.origin || '' };
    }
    return null;
  }

  function markAsked(topic: string, thing: string, now = Date.now()) {
    const it = store.interests[topic];
    if (!it) return;
    it.asked[thing] = now;
    it.lastAskedAt = now;
    save();
  }

  /** 設定面板 / 除錯用 */
  function snapshot(now = Date.now()) {
    return Object.values(store.interests)
      .map((i) => ({
        topic: i.topic,
        weight: Math.round(weightNow(i, now) * 100) / 100,
        days: i.days.length,
        emerged: i.emerged,
        kind: i.kind || null,
        selfShare: Math.round(selfShare(i) * 100) / 100,
        stance: stanceOf(i),
        bored: Boolean(i.bored),
        details: i.details,
        origin: i.origin,
      }))
      .sort((a, b) => b.weight - a.weight);
  }

  /** 最近看到、逛到的東西（給她自己想要做什麼的時候參考） */
  function recent(n = 8, sources?: ObservationSource[]): string[] {
    return store.observations
      .filter((o) => !sources || sources.includes(o.source))
      .slice(-n)
      .map((o) => `${SOURCE_LABEL[o.source] || o.source}：${o.text.slice(0, 120)}`);
  }

  return { note, shouldReflect, reflect, describeForChat, exploreHints, pickCuriosity, markAsked, snapshot, emerged, recent };
}

export type InnerLife = ReturnType<typeof createInnerLife>;
