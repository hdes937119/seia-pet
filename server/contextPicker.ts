/**
 * 回話前先挑材料（2026-11-06）
 *
 * 聊天的背景資料有很多區塊（往事、話頭、河木鎮、工坊、額度…），全部塞給模型時，
 * Flash 會傾向「每樣都用一點」，回覆就變成拼湊。這裡在正式回話前，
 * 先用最便宜的模型看主人這句話，只挑出這次真的接得上的 0～2 項；
 * 「狀態」類的區塊（關係、時間、忙碌、畫面、音樂、說話範例）每次都帶。
 */

/** 每次都帶的區塊（是她的狀態，不是要拿出來講的話題） */
export const ALWAYS_BLOCKS = new Set(['關係', '時間', '忙碌', '畫面', '音樂', '說話範例']);

/** 要挑過才帶的區塊 */
export const PICKABLE_BLOCKS = [
  '核心記憶',
  '長期檔案',
  '話頭',
  '以前聊過',
  '往事',
  'Gemini網頁',
  '興趣',
  '河木鎮',
  '最近的改變',
  '需求目標',
  '日記',
  '工坊',
  '畫室',
  '自己的時間',
  '研究',
  '委託',
  '提案',
  '工具箱',
  '額度',
];

/** 選材失敗時的保底：這兩項本來就是照主人這句話找出來的 */
const FALLBACK_BLOCKS = ['往事', '以前聊過'];

const PREVIEW_CHARS = 600;
const MAX_PICK = 2;

export interface PickResult {
  blocks: Record<string, string>;
  picked: string[];
  mode: 'model' | 'short' | 'gaming' | 'fallback' | 'empty';
  ms: number;
  reason?: string;
}

export interface PickInput {
  blocks: Record<string, string>;
  userText: string;
  /** 最近幾則對話（舊到新），例如「主人：…」「西雅：…」 */
  recent: string[];
  gaming?: boolean;
  /** 這次一定要帶的（例如主人在回覆委託的檢查點）；短話、打遊戲時也帶 */
  force?: string[];
  /** 呼叫便宜模型，回傳文字（JSON）；要自己處理逾時 */
  generate: (prompt: string, signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  log?: (m: string) => void;
}

/** 一定要帶的（關鍵字直接決定，不用問模型） */
const FORCE_RULES: Array<{ re: RegExp; block: string }> = [
  { re: /工坊|做一個|做個|幫我做|做好了沒|作品/, block: '工坊' },
  { re: /額度|預算|花了多少|token/i, block: '額度' },
  { re: /委託/, block: '委託' },
  { re: /提案|安裝|下載|瀏覽器/, block: '提案' },
  { re: /研究|筆記本|實驗/, block: '研究' },
  { re: /河木鎮|鎮上|老鐵|米拉|小卡|凱恩|朔|嚕嚕|船長|觀測站|星港|食堂/, block: '河木鎮' },
];

function isShortReply(t: string) {
  const s = t.replace(/<!--[\s\S]*?-->/g, '').replace(/[\s。！？!?.,，~～…]/g, '');
  return s.length <= 4;
}

function keep(all: Record<string, string>, names: string[]) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (!v || !v.trim()) continue;
    if (ALWAYS_BLOCKS.has(k) || !PICKABLE_BLOCKS.includes(k) || names.includes(k)) out[k] = v;
  }
  return out;
}

export function buildPickPrompt(userText: string, recent: string[], candidates: Array<[string, string]>) {
  const list = candidates
    .map(([name, text]) => {
      const t = text.replace(/\s+\n/g, '\n').trim();
      return `### ${name}\n${t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS)}…` : t}`;
    })
    .join('\n\n');
  return `你是聊天助手的「選材員」。貓娘桌寵「西雅」等一下要回主人的話。下面有幾組背景資料，請判斷：要好好回主人「這一句」，哪幾組是真的接得上、用得到的？

原則：
- 大部分時候答案是「一組都不用」（空陣列）。閒聊、短回應、主人在講他自己的事、他在問一般知識時，通常都不需要。
- 只有主人這句話直接講到、問到那組資料裡的東西，或不看那組資料就會答錯時，才選。
- 不要因為「可以順便提一下」就選。最多選 ${MAX_PICK} 組。

【最近的對話（舊→新）】
${recent.join('\n') || '（沒有）'}

【主人這一句】
${userText}

【背景資料】
${list}

只輸出 JSON：{"use":["組名"],"why":"一句話理由"}`;
}

export function parsePick(text: string, candidates: string[]): string[] | null {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!Array.isArray(obj?.use)) return null;
    return [...new Set(obj.use.map((x: any) => String(x).trim()).filter((x: string) => candidates.includes(x)))].slice(0, MAX_PICK) as string[];
  } catch {
    return null;
  }
}

export async function pickContext(input: PickInput): Promise<PickResult> {
  const t0 = Date.now();
  const log = input.log || console.log;
  const userText = String(input.userText || '').trim();
  const candidates = Object.entries(input.blocks).filter(([k, v]) => PICKABLE_BLOCKS.includes(k) && v && v.trim());
  const names = candidates.map(([k]) => k);
  const forced = [
    ...new Set([...FORCE_RULES.filter((r) => r.re.test(userText)).map((r) => r.block), ...(input.force || [])]),
  ].filter((b) => names.includes(b));

  const done = (picked: string[], mode: PickResult['mode'], reason?: string): PickResult => {
    const all = [...new Set([...forced, ...picked])];
    const res: PickResult = { blocks: keep(input.blocks, all), picked: all, mode, ms: Date.now() - t0, reason };
    log(`[選材] 帶了：${all.length ? all.join('、') : '（都不帶）'}（${modeLabel(mode)}，${(res.ms / 1000).toFixed(1)} 秒${reason ? `；${reason.slice(0, 40)}` : ''}）`);
    return res;
  };

  if (!candidates.length) return done([], 'empty');
  if (input.gaming) return done([], 'gaming');
  if (isShortReply(userText)) return done([], 'short');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 2500);
  try {
    const text = await input.generate(buildPickPrompt(userText, input.recent, candidates), ctrl.signal);
    const picked = parsePick(text, names);
    if (!picked) return done(FALLBACK_BLOCKS.filter((b) => names.includes(b)), 'fallback', '看不懂選材結果');
    let why = '';
    try {
      why = String(JSON.parse(String(text).match(/\{[\s\S]*\}/)![0]).why || '');
    } catch {
      /* 沒理由也沒關係 */
    }
    return done(picked, 'model', why);
  } catch (err: any) {
    const why = ctrl.signal.aborted ? '逾時' : String(err?.status || err?.message || '出錯');
    return done(FALLBACK_BLOCKS.filter((b) => names.includes(b)), 'fallback', why);
  } finally {
    clearTimeout(timer);
  }
}

function modeLabel(m: PickResult['mode']) {
  return { model: '選材員挑的', short: '短話不帶', gaming: '打遊戲中不帶', fallback: '選材失敗，用保底', empty: '沒有材料' }[m];
}
