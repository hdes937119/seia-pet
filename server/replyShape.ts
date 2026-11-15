/**
 * 回覆的長度和樣子（11/15，主人看了語用檢視後要求）：
 *  - 長度不再只靠提示詞：依主人這句話的長度、要不要詳細說明、打遊戲、「話癆」滑桿算出這次的額度，
 *    提示詞告訴她額度，超過的部分程式會在句子結束的地方切掉（串流和最後存下來的回覆用同一套規則）。
 *  - 拆掉固定模板：最近好幾則都用問句結尾、都在提議幫主人做事、都用感嘆詞開頭 → 這次提醒她換一種。
 *
 * 話癆滑桿（chatty 0～100）怎麼影響：字數 ×0.6（0）～×1.4（100），60 是 ×1.08；
 * 30 以下最多 1 則（要詳細說明時 2 則），70 以上可以多傳 1 則。
 */

export interface ReplyBudget {
  /** 告訴她的字數（不含標點也大致相同） */
  chars: number;
  /** 程式真的切掉的上限 */
  hard: number;
  /** 最多幾則（[[NEXT]] 分開的） */
  segs: number;
  why: string;
}

const DETAIL_RE = /怎麼|為什麼|為何|如何|教我|解釋|介紹|分享|講講|說說|在講什麼|講什麼|是什麼|幫我(查|找|想|寫|整理|看|規劃|算)|建議|推薦|計畫|步驟|比較|差別|優缺點|心得|故事|詳細|仔細/;

const visibleLen = (s: string) => String(s || '').replace(/\[\[[^\]]*\]\]|\[\[[^\]]*$|<!--[\s\S]*?(-->|$)/g, '').replace(/[\s]/g, '').length;

export function replyBudget(opts: { userText: string; chatty?: number; gaming?: boolean; detail?: boolean }): ReplyBudget {
  const u = visibleLen(opts.userText);
  const detail = Boolean(opts.detail) || DETAIL_RE.test(String(opts.userText || ''));
  let chars = u <= 12 ? 45 : u <= 40 ? 90 : 150;
  let segs = u <= 12 ? 1 : u <= 40 ? 2 : 3;
  const why: string[] = [`主人這句 ${u} 字`];
  if (detail) {
    chars = Math.min(320, Math.round(chars * 2.2));
    segs += 1;
    why.push('要詳細說明');
  }
  const c = typeof opts.chatty === 'number' && Number.isFinite(opts.chatty) ? Math.max(0, Math.min(100, opts.chatty)) : 60;
  chars = Math.round(chars * (0.6 + (c / 100) * 0.8));
  if (c < 30) segs = detail ? Math.min(segs, 2) : 1;
  else if (c > 70) segs += 1;
  why.push(`話癆 ${c}`);
  if (opts.gaming) {
    chars = Math.min(chars, detail ? 90 : 50);
    segs = 1;
    why.push('打遊戲中');
  }
  chars = Math.max(20, chars);
  segs = Math.max(1, Math.min(4, segs));
  return { chars, hard: Math.round(chars * 1.35) + 8, segs, why: why.join('、') };
}

/** 給提示詞的一行 */
export function budgetPrompt(b: ReplyBudget): string {
  return `\n【這次回覆的長度】${b.segs === 1 ? '只傳 1 則' : `最多 ${b.segs} 則（用 [[NEXT]] 分開，只有真的有兩件不同的事才分）`}，全部加起來約 ${b.chars} 字以內（${b.why}）。寧可短，不要湊滿；超過的部分程式會直接切掉，主人看不到。`;
}

const SENT_END = /[。！？!?～~…]|\.{3}/g;

/**
 * 依額度切掉超過的部分：只在句子結束的地方切；隱藏標記（<!--…-->）不算字、也不會被切掉（留在最後）。
 * 串流時拿「目前為止的全部文字」呼叫，回傳值永遠是輸入的前綴（標記另外處理），所以可以邊收邊送。
 * 回傳 { text, cut }：cut＝這段文字已經超過、後面再來的都不要。
 */
export function limitReply(full: string, b: ReplyBudget): { text: string; cut: boolean } {
  const src = String(full || '');
  // 標記先拿出來（最後放回去），只對看得到的文字算長度
  const markers: string[] = [];
  const body = src.replace(/<!--[\s\S]*?-->/g, (m) => {
    markers.push(m);
    return '\u0000';
  });
  const parts = body.split('[[NEXT]]');
  let used = 0;
  let segsUsed = 0;
  let stickers = 0;
  const kept: string[] = [];
  let cut = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const textOnly = p.replace(/\[\[STICKER:[^\]]*\]\]/g, '').replace(/\u0000/g, '');
    const isSticker = !visibleLen(textOnly) && /\[\[STICKER:/.test(p);
    if (isSticker) {
      if (stickers >= 1) {
        // 第二張貼圖不要
        kept.push(p.replace(/\[\[STICKER:[^\]]*\]\]/g, ''));
        continue;
      }
      stickers++;
      kept.push(p);
      continue;
    }
    if (!visibleLen(textOnly)) {
      kept.push(p);
      continue;
    }
    if (segsUsed >= b.segs) {
      cut = true;
      break;
    }
    const len = visibleLen(textOnly);
    if (used + len <= b.hard) {
      kept.push(p);
      used += len;
      segsUsed++;
      continue;
    }
    // 這一則會超過：在句子結束的地方切
    const room = b.hard - used;
    let best = -1;
    let count = 0;
    let lastIdx = 0;
    SENT_END.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENT_END.exec(p))) {
      count += visibleLen(p.slice(lastIdx, m.index + m[0].length));
      lastIdx = m.index + m[0].length;
      if (count <= room) best = lastIdx;
      else break;
    }
    if (best > 0) kept.push(p.slice(0, best));
    else if (segsUsed === 0) {
      // 第一則就超過、又找不到句尾：照長度硬切，保留至少一句
      let n = 0;
      let i2 = 0;
      for (; i2 < p.length && n < b.hard; i2++) if (!/\s/.test(p[i2])) n++;
      kept.push(`${p.slice(0, i2)}…`);
    }
    cut = true;
    break;
  }
  let text = kept.join('[[NEXT]]').replace(/(\[\[NEXT\]\])+$/, '');
  // 標記放回去：留在原本位置的保留，被切掉的補在最後
  let mi = 0;
  text = text.replace(/\u0000/g, () => markers[mi++] || '');
  if (mi < markers.length) text += markers.slice(mi).join('');
  return { text, cut };
}

/** 句子尾巴是不是問句（忽略貼圖和標記） */
const endsWithQuestion = (s: string) =>
  /[？?]\s*$/.test(
    String(s || '')
      .replace(/<!--[\s\S]*?-->|\[\[[^\]]*\]\]/g, '')
      .trim()
  );
const OFFER_RE = /要不要(本喵|我)?(幫你|來|去)?(放|播|找|準備|開|弄|拿)|幫你(放|播|找)(點|首|一首|些)|本喵(去)?幫你(放|播|找|準備)/;
const OPEN_EXCL_RE = /^(哇|欸|唉|嘿嘿|嘿|哎呀|咦|吼|哼|哈|喔喔|噢|嗚哇|喵哈|呼)/;

/** 最近幾則她的回覆有沒有落入固定模板 → 這次的提醒（沒有就空字串） */
export function shapePrompt(recentPet: string[]): string {
  const last = recentPet.filter((s) => s && !s.startsWith('👀')).slice(-4);
  const tips: string[] = [];
  if (last.filter(endsWithQuestion).length >= 2) tips.push('這次不要用問句結尾（最近好幾則都在反問主人）');
  if (recentPet.slice(-8).some((s) => OFFER_RE.test(s))) tips.push('這次不要提議幫主人做事（放音樂、找東西之類，最近已經提過）');
  if (last.filter((s) => OPEN_EXCL_RE.test(s.replace(/<!--[\s\S]*?-->/g, '').trim())).length >= 2) tips.push('開頭不要用感嘆詞（哇、欸、嘿嘿…），直接接話');
  const base =
    '\n【這次怎麼回】只做一件事就好：附和、吐槽、說你自己的事、或問一句——不要每次都「感嘆＋重述主人的話＋評論＋建議＋反問」全套。只回應主人最新這一句；主人換了話題（例如說要去洗澡、要出門），上一個話題就結束了，不要再接回去。';
  return `${base}${tips.length ? `\n${tips.map((t) => `- ${t}`).join('\n')}` : ''}`;
}

/**
 * 串流用：已經超過「告訴她的字數」之後，這一則最後一句還沒講完的先不送（等講完或確定要切再說），
 * 這樣真的切的時候不會切在已經送出去的字前面。最後的完整回覆還是以 limitReply 為準。
 */
export function streamPrefix(full: string, b: ReplyBudget): string {
  const { text, cut } = limitReply(full, b);
  if (cut || visibleLen(text) <= b.chars) return text;
  const sep = text.lastIndexOf('[[NEXT]]');
  const start = sep < 0 ? 0 : sep + 8;
  const seg = text.slice(start);
  let last = -1;
  SENT_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENT_END.exec(seg))) last = m.index + m[0].length;
  return last < 0 ? text.slice(0, start) : text.slice(0, start + last);
}

/** 用過工具（查委託、跑工具…）時要講的東西比較多：額度放寬 */
export function widen(b: ReplyBudget, mul = 2): ReplyBudget {
  return { chars: Math.round(b.chars * mul), hard: Math.round(b.hard * mul), segs: Math.min(4, b.segs + 1), why: `${b.why}、用了工具` };
}
