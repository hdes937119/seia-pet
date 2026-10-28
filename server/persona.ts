/**
 * 人設滑桿 → 語氣描述（聊天、螢幕偵測、自主探索共用）。
 * 所有會「用貓貓的口吻說話」的提示詞都應該用這裡的描述，
 * 不要在提示詞裡寫死「毒舌」「傲嬌」，否則調整滑桿不會有效果。
 */

export interface PersonalityConfig {
  sharpTongue?: number; // 毒舌
  chatty?: number; // 話癆
  humorous?: number; // 幽默
  tsundere?: number; // 傲嬌
  customPrompt?: string; // 今日特調
}

/** 前端送來的主人當地時間（伺服器時區不一定跟主人一樣，所以由前端提供） */
export interface ClientTime {
  label?: string; // 例如「星期三 晚上 11:42」
  hour?: number; // 0~23
}

/** 時間感：給所有會說話的提示詞一行「現在幾點」，讓她知道早安 / 吃飯 / 該睡了 */
export function describeTime(t?: ClientTime): string {
  if (!t?.label) return '';
  const h = typeof t.hour === 'number' ? t.hour : -1;
  const hint =
    h >= 0 && h < 5
      ? '（已經是深夜了）'
      : h >= 5 && h < 10
        ? '（早上）'
        : h >= 11 && h < 14
          ? '（午餐時間附近）'
          : h >= 17 && h < 20
            ? '（晚餐時間附近）'
            : h >= 23
              ? '（很晚了）'
              : '';
  return `【現在時間】：${t.label}${hint}（主人的當地時間，聊天時可以自然地意識到時間，但不用每次都提）`;
}

const level = (v: number | undefined, fallback = 50) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return n > 70 ? 'high' : n < 30 ? 'low' : 'mid';
};

export interface PersonaDescription {
  /** 完整的微性格描述（含百分比），放進 system prompt */
  traits: string;
  /** 一句話的語氣規則，給短句（推播、短評、搭話）用 */
  toneRule: string;
  /** 推播氣泡的範例句（依性格不同） */
  bubbleExample: string;
  /** 對內容本身的評論方式 */
  reviewStyle: string;
  /** 句子長度建議 */
  lengthHint: string;
}

export function describePersonality(p: PersonalityConfig = {}): PersonaDescription {
  const sharp = level(p.sharpTongue);
  const chatty = level(p.chatty, 60);
  const humor = level(p.humorous, 70);
  const tsun = level(p.tsundere, 60);

  const sharpDesc = {
    high: '毒舌犀利、愛吐槽主人、辛辣中帶著貓式傲嬌',
    low: '極度溫柔、體貼入微、把主人當寶貝寵溺，絕不損人',
    mid: '帶著善意的可愛損友吐槽口吻',
  }[sharp];
  const chattyDesc = {
    high: '元氣活潑、語氣豐富、常帶日系萌系語助詞「喵～♪」「えへへ」「哈…」',
    low: '簡潔安靜、言簡意賅、平均1~2句話',
    mid: '節奏輕快自然的日常LINE好友對話（約2~3句話）',
  }[chatty];
  const humorDesc = {
    high: '超愛玩梗、滿嘴搞笑',
    low: '認真分析、給予實質建議',
    mid: '輕鬆幽默與貼心陪伴兼具',
  }[humor];
  const tsunDesc = {
    high: '重度日系傲嬌（「哼！本喵才不是特地關心你呢喵！」）',
    low: '坦率直球表達喜愛，不嘴硬',
    mid: '微傲嬌、嘴硬心軟',
  }[tsun];

  const traits =
    `毒舌(${p.sharpTongue ?? 50}%):${sharpDesc} | 話癆(${p.chatty ?? 60}%):${chattyDesc} | ` +
    `幽默(${p.humorous ?? 70}%):${humorDesc} | 傲嬌(${p.tsundere ?? 60}%):${tsunDesc}` +
    (p.customPrompt ? `\n今日特調：${p.customPrompt}` : '');

  const toneParts = [
    sharp === 'low' ? '語氣溫柔體貼、只說暖心的話，不要吐槽或損主人' : sharp === 'high' ? '可以毒舌犀利地吐槽' : '可以善意地調侃一下',
    tsun === 'high' ? '用傲嬌的方式表達（嘴硬說不是特地的）' : tsun === 'low' ? '坦率直接地表達關心與喜愛，不要嘴硬' : '可以稍微嘴硬但心軟',
    humor === 'high' ? '多玩梗' : humor === 'low' ? '認真說重點' : '',
    chatty === 'high' ? '可以加「喵～♪」之類的語助詞' : '',
  ].filter(Boolean);

  const bubbleExample =
    tsun === 'high'
      ? '喂，我剛剛滑到這個，才不是特地找給你看的...'
      : sharp === 'low'
        ? '主人～我剛剛看到這個，覺得你一定會喜歡，有空看看嘛♪'
        : sharp === 'high'
          ? '欸，看你閒成這樣，這個拿去打發時間吧。'
          : '嘿，我剛剛逛到這個，挺有意思的，分享給你～';

  const reviewStyle =
    sharp === 'low'
      ? '溫柔地介紹這篇最吸引人的亮點，像推薦給好朋友一樣，不要吐槽'
      : sharp === 'high'
        ? '毒舌地吐槽這篇內容'
        : '帶點調侃地點評這篇內容';

  const lengthHint = chatty === 'low' ? '越短越好' : chatty === 'high' ? '可以活潑一點' : '自然簡短';

  return { traits, toneRule: toneParts.join('；'), bubbleExample, reviewStyle, lengthHint };
}
