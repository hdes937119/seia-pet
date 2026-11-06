/**
 * 她的偏執（主觀偏見與認知缺陷）：只在觸發時才放進提示詞，不會每句都發作。
 *
 *  1. 護短：主人在講跟別人的衝突 → 一律站主人這邊，就算主人有點理虧也先幫他講話。
 *  2. 討厭下雨：聊到雨，或外面真的在下雨（Open-Meteo 天氣）→ 悲觀、暴躁、強詞奪理。
 *  3. 被指責先嘴硬：第一次被說錯 → 找藉口強詞奪理；短時間內再被指出 → 不甘願地服軟。
 *  4. 得寸進尺：主人連續好幾次都順著她 → 有機率提出一個任性、不太合理（但無害）的要求。
 */

/* ───────── 1. 護短 ───────── */
const CONFLICT_RE =
  /被(罵|唸|念|兇|嫌|酸|誤會|針對|欺負|扣|刁難|檢討|噴|嗆)|吵架|欺負|刁難|找麻煩|靠北|很瞎|有夠瞎|不爽|氣死|討厭(他|她|那個)|(老闆|主管|上司|同事|室友|客戶|朋友|家人|老師|隊友|路人|網友).{0,12}(說|罵|嫌|兇|唸|念|怪|不爽|雷|很爛|白目|針對)/;

/* ───────── 2. 討厭下雨 ───────── */
const RAIN_RE = /雨|颱風|梅雨|濕答答|潮濕|淋濕|雨傘/;
const WEATHER_TTL_MS = 30 * 60 * 1000;
let weatherCache: { at: number; raining: boolean; label: string } | null = null;

/** WMO 天氣代碼：毛毛雨、雨、陣雨、雷雨 */
const isRainCode = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99);

async function currentWeather(): Promise<{ raining: boolean; label: string } | null> {
  if (weatherCache && Date.now() - weatherCache.at < WEATHER_TTL_MS) return weatherCache;
  // 預設台北；別的地方在 .env 設 WEATHER_LAT / WEATHER_LON
  const lat = Number(process.env.WEATHER_LAT) || 25.03;
  const lon = Number(process.env.WEATHER_LON) || 121.56;
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,precipitation&timezone=auto`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    const code = Number(data?.current?.weather_code);
    const raining = isRainCode(code) || Number(data?.current?.precipitation) > 0.2;
    const label = code >= 95 ? '雷雨' : code >= 80 ? '陣雨' : code >= 61 ? '下雨' : code >= 51 ? '毛毛雨' : raining ? '下雨' : '沒下雨';
    weatherCache = { at: Date.now(), raining, label };
    return weatherCache;
  } catch (err: any) {
    console.warn('[天氣] 讀取失敗：', err?.message);
    weatherCache = { at: Date.now(), raining: false, label: '不知道' }; // 失敗也先別一直重試
    return null;
  }
}

/** 外面現在是不是在下雨（桌寵會換成撐傘不爽的樣子） */
export async function isRainingNow(): Promise<boolean> {
  return Boolean((await currentWeather())?.raining);
}

/* ───────── 3. 被指責 ───────── */
const BLAME_RE =
  /(你|妳)(錯了|說錯|講錯|搞錯|弄錯|亂講|亂說|亂掰|在騙|騙人|唬爛|胡說|幻覺|瞎掰|又錯|根本不|好笨|很笨|笨蛋|爛透)|不對吧|才不是|錯了啦|哪有|胡說八道|你在說什麼|妳在說什麼/;
const BLAME_WINDOW_MS = 10 * 60 * 1000;
let blameLog: number[] = [];

/* ───────── 4. 得寸進尺 ───────── */
const AGREE_RE =
  /^(好|好啊|好喔|好哦|好的|好吧|好呀|好好好|可以|可以啊|行|行啊|沒問題|ok|okay|嗯嗯?|嗯好|遵命|是的|是是|收到|聽你的|都聽你的|你說了算|妳說了算|依你|照你說的|當然|當然好|讓你|給你|送你)[!！~～。.喵啦呀喔哦]*$/i;
const SPOILED_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const SPOILED_CHANCE = 0.4;
let lastSpoiledAt = 0;

export interface QuirkInput {
  userText: string;
  /** 最近幾句主人說的話（舊 → 新，含這一句） */
  recentUserTexts: string[];
}

/** 這次要觸發哪些偏執（回傳要加進提示詞的段落，沒有就是空字串） */
export async function quirkPrompt({ userText, recentUserTexts }: QuirkInput, now = Date.now()): Promise<string> {
  const text = String(userText || '');
  const parts: string[] = [];

  // 1. 護短
  if (CONFLICT_RE.test(text)) {
    parts.push(
      '【你的偏執：護短】主人在講他跟別人的衝突。你一律先站主人這邊：幫他講話、吐槽對方，就算主人可能有點理虧也先護著他（可以有點強詞奪理）；之後頂多小小補一句。但如果涉及違法、傷害別人或主人自己會吃大虧的事，就不要附和，改成擔心他。'
    );
  }

  // 2. 討厭下雨
  const weather = await currentWeather();
  const talkingRain = RAIN_RE.test(text);
  if (weather?.raining || talkingRain) {
    parts.push(
      `【你的偏執：極度討厭下雨】${weather?.raining ? `外面現在真的在${weather.label}，你今天心情很差，講話比平常暴躁、悲觀。` : ''}${
        talkingRain ? '主人提到雨，你會忍不住發牢騷：' : ''
      }你覺得下雨天什麼都會變糟（毛會塌、心情會爛、出門一定倒楣），講到雨就會不講理地抱怨、強詞奪理，就算主人說雨很浪漫也要硬拗回來。不過不要因此不回答主人的問題。`
    );
  }

  // 3. 被指責：第一次嘴硬，短時間內再被指出就服軟
  if (BLAME_RE.test(text)) {
    blameLog = [...blameLog.filter((t) => now - t < BLAME_WINDOW_MS), now];
    parts.push(
      blameLog.length >= 2
        ? '【你的偏執：嘴硬到最後還是服軟】主人又一次指出你錯了。這次你終於不甘願地服軟：先小小嘴硬一句，然後承認（例如「好啦…是本喵搞錯了啦，哼，下次不會了」），並更正錯誤的地方。'
        : '【你的偏執：被指責時強詞奪理】主人說你錯了。你的第一反應是嘴硬：找藉口、強詞奪理（例如「那、那是本喵在測試你有沒有認真聽！」），1~2 句就好。但不能堅持明顯錯誤的事實——如果你真的錯了，就在嘴硬之後含糊地帶過一句正確的說法；主人再堅持你就會服軟。'
    );
  } else if (blameLog.length && now - blameLog[blameLog.length - 1] > BLAME_WINDOW_MS) {
    blameLog = [];
  }

  // 4. 得寸進尺：主人最近連續 3 句以上都順著她
  let streak = 0;
  for (let i = recentUserTexts.length - 1; i >= 0; i--) {
    if (AGREE_RE.test(String(recentUserTexts[i] || '').trim())) streak++;
    else break;
  }
  if (streak >= 3 && now - lastSpoiledAt > SPOILED_COOLDOWN_MS && Math.random() < SPOILED_CHANCE) {
    lastSpoiledAt = now;
    parts.push(
      '【你的偏執：得寸進尺】主人最近對你百依百順，你被寵壞了，這次忍不住得寸進尺：用撒嬌或傲嬌的語氣提出一個有點任性、不太合理、但無害的要求（例如要主人學三聲貓叫、說要一整箱高級罐頭、要主人陪你看完十集動畫、要主人以後叫你「女王大人」）。只提一次；主人拒絕就鬧一下彆扭然後算了。'
    );
  }

  return parts.length ? `\n${parts.join('\n')}` : '';
}
