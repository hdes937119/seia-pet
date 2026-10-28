/**
 * 說話節奏：讓回覆像真人傳 LINE 一樣——有時一句、有時連傳兩三則、有時只丟貼圖。
 *
 * 模型用 [[NEXT]] 把回覆切成好幾則訊息，用 [[STICKER:名稱]] 代表一張貼圖（單獨一則）。
 * 第一則照常逐字串流（零延遲）；第二則開始，前面會先「輸入中…」一下再送出。
 */

export const NEXT_MARKER = '[[NEXT]]';
const STICKER_RE = /^\s*\[\[STICKER:([^\]]+)\]\]\s*$/;

export interface StickerDef {
  emoji: string;
  label: string;
}

/** 貼圖名稱要跟後端提示詞（server.ts 的 STICKER_NAMES）一致 */
export const STICKERS: Record<string, StickerDef> = {
  開心: { emoji: '😆', label: '開心！' },
  笑死: { emoji: '🤣', label: '笑死喵' },
  得意: { emoji: '😤', label: '哼哼～' },
  生氣: { emoji: '💢', label: '哼！' },
  害羞: { emoji: '😳', label: '才、才沒有…' },
  疑惑: { emoji: '🤔', label: '？？？' },
  哭哭: { emoji: '😭', label: '嗚嗚…' },
  讚: { emoji: '👍', label: '讚喵！' },
  晚安: { emoji: '🌙', label: '晚安喵～' },
};

export interface Segment {
  content: string; // 一般文字（貼圖時為空字串）
  sticker?: string; // 貼圖名稱
}

/** 去掉結尾「可能是 [[NEXT]] 開頭」的半截（例如串流到一半的 "[[NE"），避免閃一下又消失 */
function trimPartialMarker(text: string): string {
  for (let k = Math.min(NEXT_MARKER.length - 1, text.length); k > 0; k--) {
    if (NEXT_MARKER.startsWith(text.slice(-k))) return text.slice(0, -k);
  }
  return text;
}

/**
 * 把（可能還在串流中的）原始回覆切成一則一則的訊息。
 * done = false 時，最後一段可能還沒講完，放在 partial。
 */
export function splitSegments(raw: string, done: boolean): { complete: Segment[]; partial: string | null } {
  // 模型偶爾把貼圖黏在文字後面（「…晚安喵！[[STICKER:晚安]]」）→ 自動拆成獨立一則
  const normalized = raw.replace(/\[\[STICKER:([^\]]+)\]\]/g, `${NEXT_MARKER}[[STICKER:$1]]${NEXT_MARKER}`);
  const parts = normalized.split(NEXT_MARKER);
  const last = parts.pop() ?? '';
  const toSegment = (p: string): Segment | null => {
    const m = p.match(STICKER_RE);
    if (m) {
      const name = m[1].trim();
      // 模型給了不認識的貼圖名稱 → 退回文字顯示
      return STICKERS[name] ? { content: '', sticker: name } : { content: `（${name}）` };
    }
    const content = p.trim();
    return content ? { content } : null;
  };
  const complete = parts.map(toSegment).filter((s): s is Segment => s !== null);
  if (done) {
    const seg = toSegment(last);
    if (seg) complete.push(seg);
    return { complete, partial: null };
  }
  // 還在串流：還沒傳完的「[[…」（貼圖或換則標記）先藏起來，等傳完再判斷
  let partialText = trimPartialMarker(last).trimStart();
  const open = partialText.lastIndexOf('[[');
  if (open !== -1 && !partialText.includes(']]', open)) partialText = partialText.slice(0, open);
  if (partialText.endsWith('[')) partialText = partialText.slice(0, -1);
  partialText = partialText.trimEnd();
  return { complete, partial: partialText || null };
}

/** 第二則之後送出前的「輸入中」時間：依長度 0.6 ~ 2.2 秒 */
export function typingDelayMs(seg: Segment): number {
  if (seg.sticker) return 700;
  return Math.max(600, Math.min(2200, 350 + seg.content.length * 45));
}

/** 給語音用：貼圖不唸、標記拿掉 */
export function speakableText(seg: Segment): string {
  return seg.sticker ? '' : seg.content;
}
