/**
 * 收尾沉默（借 astrbot private_companion 的「確定性沉默」）：
 * 主人只說「晚安」「謝謝」「掰掰」「嗯」這種收尾的話，而她上一句（15 分鐘內）已經道過晚安 / 說過不客氣 / 道別，
 * 就不再呼叫模型，直接用一個小動作回應——省錢，也不會互道晚安沒完沒了。
 */
const MASTER_CLOSE: Array<[kind: 'night' | 'thanks' | 'bye' | 'ack', re: RegExp]> = [
  ['night', /^(晚安+|晚安安|我?(要|先|去)?睡(覺)?了|去睡(覺)?[囉啰了]?|おやすみ|good ?night|gn)[\s!！~～。.…喵啦囉哦喔呀唷]*$/i],
  ['thanks', /^(謝謝|謝啦|謝囉|感謝|多謝|thx|thanks|thank you|3q)[\s!！~～。.…喵啦囉哦喔你妳呀]*$/i],
  ['bye', /^(掰掰?|拜拜|bye( bye)?|886|先這樣|下次聊|改天聊)[\s!！~～。.…喵啦囉哦喔呀]*$/i],
  ['ack', /^(嗯+|好+|ok|okay|喔+|哦+|好喔|好的|嗯嗯|了解|知道了)[\s!！~～。.…喵啦]*$/i],
];
const PET_CLOSED = /晚安|好夢|明天見|掰掰|拜拜|不客氣|不用謝|快去睡|睡個好覺|路上小心|bye/i;

const CANNED: Record<'night' | 'thanks' | 'bye' | 'ack', Array<{ text: string; emotion: string }>> = {
  night: [
    { text: '（抱著枕頭揮揮手）晚安喵…zzZ', emotion: 'loving' },
    { text: '（已經縮成一團）…晚安', emotion: 'loving' },
    { text: 'zzZ…（尾巴晃了一下當作回應）', emotion: 'happy' },
  ],
  thanks: [
    { text: '嘿嘿～', emotion: 'proud' },
    { text: '（尾巴得意地翹起來）', emotion: 'proud' },
    { text: '哼，小事一樁喵', emotion: 'proud' },
  ],
  bye: [
    { text: '（揮揮手）', emotion: 'happy' },
    { text: '路上小心喵！', emotion: 'loving' },
  ],
  ack: [
    { text: '（點點頭）', emotion: 'happy' },
    { text: '嗯哼～', emotion: 'happy' },
  ],
};

const WINDOW_MS = 15 * 60 * 1000;

/**
 * 該不該沉默回應。messages 是前端送來的整段對話（role: user / pet…，content, at）。
 * 回傳 null＝照常呼叫模型；否則回傳要直接回的那一句。
 */
export function closingReply(messages: any[], now = Date.now()): { text: string; emotion: string; kind: string } | null {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return null;
  const userText = String(last.content || '').trim();
  const hit = MASTER_CLOSE.find(([, re]) => re.test(userText));
  if (!hit) return null;
  // 她上一句（在主人這句之前最近的一句她說的話）
  let prevPet: any = null;
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i]?.role !== 'user') {
      prevPet = messages[i];
      break;
    }
    // 中間夾著主人的其他話（不是單純收尾）→ 照常回
    if (!MASTER_CLOSE.some(([, re]) => re.test(String(messages[i]?.content || '').trim()))) return null;
  }
  if (!prevPet || !PET_CLOSED.test(String(prevPet.content || ''))) return null;
  const at = Number(prevPet.at) || 0;
  if (at && now - at > WINDOW_MS) return null;
  const list = CANNED[hit[0]];
  const pick = list[Math.floor(Math.random() * list.length)];
  return { ...pick, kind: hit[0] };
}
