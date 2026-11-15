/**
 * 人格包（11/15，為了公開版「哈姬咪桌寵」）：
 *
 * 程式和提示詞裡照樣用西雅的說法寫（西雅、雙子星貓、貓娘、本喵、主人、喵…），
 * 送給 Gemini 之前，依目前的人格包把這些「標準詞」換成這隻桌寵自己的說法（見 getAiClient 的包裝）。
 * 西雅自己的人格包＝什麼都不換，所以她的行為跟以前完全一樣。
 *
 * 人格包放在 persona/<id>/persona.json；用哪一包：.env 的 PERSONA，否則 persona/active.txt，否則 seia。
 * persona/ 底下除了 _template 都不會上傳（.gitignore）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface PersonaPack {
  id: string;
  /** 名字（標準詞「西雅」） */
  name: string;
  /** 稱號（標準詞「雙子星貓」；整串是「雙子星貓・西雅」） */
  title: string;
  /** 物種／身分（標準詞「貓娘」） */
  species: string;
  /** 自稱（標準詞「本喵」） */
  selfRef: string;
  /** 怎麼稱呼使用者（標準詞「主人」） */
  userCall: string;
  /** 口癖語助詞（標準詞「喵」；空字串＝沒有） */
  tic: string;
  /** 天性：容易對什麼起興趣（不是設定好的興趣） */
  temperament: string;
  /** 隨便逛時的隨機方向 */
  curiosityPool: string[];
  /** 世界觀（河木鎮）：公開版預設關閉，之後改成 lorebook */
  world: boolean;
  /** 新生的桌寵：主人給的一兩句「牠是什麼樣的存在」（西雅沒有） */
  seed?: string;
  /** 滑桿預設值 */
  sliders?: { sharpTongue?: number; chatty?: number; humorous?: number; tsundere?: number };
}

/** 標準詞＝西雅的說法：程式裡寫的就是這些 */
export const CANON: PersonaPack = {
  id: 'seia',
  name: '西雅',
  title: '雙子星貓',
  species: '貓娘',
  selfRef: '本喵',
  userCall: '主人',
  tic: '喵',
  temperament:
    '喜歡：星空和天文、宇宙航行、古老的機械和老東西、貓、奇怪的冷知識、甜點、亮晶晶或會發光的東西、有點神秘的傳說；' +
    '沒興趣：下雨和潮濕、無聊的重複作業、太吵太擠的東西、純數字的財經消息',
  curiosityPool: [
    '深海生物', '古代文明', '廢墟探險', '奇怪的發明', '太空站生活', '甜點的歷史', '世界各地的火車', '機械鐘錶',
    '極光', '世界各地的貓', '天文攝影', '古地圖', '隕石', '燈塔', '自動人偶', '古代天文儀器', '螢火蟲', '奇怪的博物館',
  ],
  world: true,
  sliders: { sharpTongue: 50, chatty: 60, humorous: 70, tsundere: 60 },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PERSONA_DIR = path.join(ROOT, 'persona');

function activeId(): string {
  // 這裡會在 server.ts 讀 .env 之前就被呼叫（innerLife 載入時），所以自己看一下 .env 有沒有 PERSONA
  let env = String(process.env.PERSONA || '').trim();
  if (!env) {
    try {
      const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*PERSONA\s*=\s*["']?([^"'\r\n#]+)/m);
      if (m) env = m[1].trim();
    } catch {
      // 沒有 .env
    }
  }
  if (env && /^[\w.-]+$/.test(env)) return env;
  try {
    const t = fs.readFileSync(path.join(PERSONA_DIR, 'active.txt'), 'utf8').trim();
    if (t) return t;
  } catch {
    // 沒有就用西雅
  }
  return 'seia';
}

/** 稱呼使用者要用第三人稱（提示詞裡的「你」是桌寵自己）：填「你」會變成「你是住在你電腦上的桌寵」 */
function userCallOf(v: string): string {
  const t = String(v || '').trim();
  if (!t) return CANON.userCall;
  if (/^(你|妳|您|你們)$/.test(t)) {
    console.warn(`[人格包] userCall 不能填「${t}」（提示詞裡的「你」是桌寵自己），先用「夥伴」；請改成名字或暱稱`);
    return '夥伴';
  }
  return t;
}

let cached: PersonaPack | null = null;
/** 目前的人格包（缺的欄位用標準詞補；讀不到檔案就是西雅） */
export function persona(): PersonaPack {
  if (cached) return cached;
  const id = activeId();
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(PERSONA_DIR, id, 'persona.json'), 'utf8'));
  } catch {
    if (id !== 'seia') console.warn(`[人格包] 讀不到 persona/${id}/persona.json，先用西雅`);
  }
  const str = (v: any, d: string) => (typeof v === 'string' ? v : d);
  cached = {
    id,
    name: str(raw.name, CANON.name).trim() || CANON.name,
    title: str(raw.title, CANON.title),
    species: str(raw.species, CANON.species),
    selfRef: str(raw.selfRef, CANON.selfRef),
    userCall: userCallOf(str(raw.userCall, CANON.userCall)),
    tic: str(raw.tic, CANON.tic),
    temperament: str(raw.temperament, CANON.temperament),
    curiosityPool: Array.isArray(raw.curiosityPool) && raw.curiosityPool.length ? raw.curiosityPool.map(String) : CANON.curiosityPool,
    world: typeof raw.world === 'boolean' ? raw.world : id === 'seia',
    seed: str(raw.seed, ''),
    sliders: { ...CANON.sliders, ...(raw.sliders || {}) },
  };
  console.log(`[人格包] 用「${cached.title ? `${cached.title}・` : ''}${cached.name}」（persona/${id}）${isCanon() ? '' : '，送給 Gemini 前會換掉標準詞'}`);
  return cached;
}

/** 跟西雅一樣（不用換任何字） */
export function isCanon(p = persona()): boolean {
  return p.name === CANON.name && p.title === CANON.title && p.species === CANON.species && p.selfRef === CANON.selfRef && p.userCall === CANON.userCall && p.tic === CANON.tic;
}

let rules: Array<[RegExp, string]> | null = null;
function buildRules(): Array<[RegExp, string]> {
  const p = persona();
  const out: Array<[string, string]> = [];
  const add = (from: string, to: string) => {
    if (from !== to) out.push([from, to]);
  };
  // 11/15 第 54 項：真的資料夾名（工作桌、給她看的檔案、下載）跟名字無關，要在換「西雅」之前先換掉
  add(`${CANON.name}的工作桌`, deskName());
  add(`「給${CANON.name}`, `「${inboxName()}`);
  add(`\\給${CANON.name}`, `\\${inboxName()}`);
  add(`下載\\${CANON.name}`, `下載\\${downloadSub()}`);
  // 長的先換（「雙子星貓・西雅」「主人さん」「本喵」要在「西雅」「主人」「喵」之前）
  add(`${CANON.title}・${CANON.name}`, p.title ? `${p.title}・${p.name}` : p.name);
  add(`${CANON.title}·${CANON.name}`, p.title ? `${p.title}·${p.name}` : p.name); // 有些提示詞用半形的「·」
  if (!p.title) add(`「${CANON.title}」，名字叫`, '，名字叫');
  add(`桌寵${CANON.species}`, /桌寵/.test(p.species) ? p.species : `桌寵${p.species}`);
  add(`${CANON.userCall}さん`, p.userCall === CANON.userCall ? `${CANON.userCall}さん` : p.userCall);
  add(CANON.selfRef, p.selfRef || '我');
  add(CANON.title, p.title || p.name);
  add(CANON.name, p.name);
  add(CANON.species, p.species);
  add('貓貓', p.name);
  if (!/貓/.test(p.species)) add('貓式', '');
  add(CANON.userCall, p.userCall);
  if (p.tic !== CANON.tic) {
    // 口癖：「喵～♪」「喵！」這種語助詞換成新的（沒有口癖就拿掉）
    out.push([`${CANON.tic}～♪`, p.tic ? `${p.tic}～♪` : '～♪']);
    add(CANON.tic, p.tic);
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return out.map(([f, t]) => [new RegExp(esc(f), 'g'), t] as [RegExp, string]);
}

/**
 * 真的資料夾名稱（11/15 第 54 項）：西雅保留原本的名字；其他桌寵用跟名字無關的名字，
 * 這樣提示詞換了名字之後，路徑還是對得上（她用 my_computer、行動提案讀寫的就是這些路徑）。
 */
export function deskName(): string {
  return isCanon() ? `${CANON.name}的工作桌` : '工作桌';
}
/** 工作桌裡「主人放給她看的檔案」那個資料夾 */
export function inboxName(): string {
  return isCanon() ? `給${CANON.name}` : '給桌寵';
}
/** 「下載」底下她下載檔案的資料夾 */
export function downloadSub(): string {
  return isCanon() ? CANON.name : '桌寵';
}

/** 把一段提示詞裡的標準詞換成目前人格包的說法（西雅＝原封不動） */
export function personaText(text: string): string {
  if (isCanon() || !text) return text;
  if (!rules) rules = buildRules();
  let s = text;
  for (const [re, to] of rules) s = s.replace(re, to);
  return s;
}

/** 換掉一個 Gemini 請求裡所有會被模型讀到的文字：contents、systemInstruction、工具說明 */
export function personaRequest<T extends { contents?: any; config?: any }>(req: T): T {
  if (isCanon() || !req) return req;
  const tx = (v: any): any => {
    if (typeof v === 'string') return personaText(v);
    if (Array.isArray(v)) return v.map(tx);
    if (v && typeof v === 'object') {
      if (typeof v.text === 'string') return { ...v, text: personaText(v.text) };
      if (Array.isArray(v.parts)) return { ...v, parts: v.parts.map(tx) };
    }
    return v;
  };
  const txDesc = (v: any): any => {
    if (Array.isArray(v)) return v.map(txDesc);
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) o[k] = k === 'description' && typeof x === 'string' ? personaText(x) : txDesc(x);
      return o;
    }
    return v;
  };
  const config = req.config ? { ...req.config } : req.config;
  if (config?.systemInstruction) config.systemInstruction = tx(config.systemInstruction);
  if (config?.tools) config.tools = txDesc(config.tools);
  return { ...req, contents: tx(req.contents), config };
}

/** 給前端、設定面板：這隻桌寵是誰 */
export function personaPublic() {
  const p = persona();
  return { id: p.id, name: p.name, title: p.title, species: p.species, selfRef: p.selfRef, userCall: p.userCall, tic: p.tic, world: p.world, sliders: p.sliders, seed: p.seed || '', canon: isCanon(), desk: deskName(), inbox: inboxName(), downloads: downloadSub() };
}
