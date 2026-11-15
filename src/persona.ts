/**
 * 前端的人格包（11/15 第 54 項）：開畫面前先問後端 /api/persona，之後各元件同步讀 persona()。
 * 讀不到（後端還沒起來）就用上次存的，再不然就是西雅（標準詞）。
 */
export interface PersonaInfo {
  id: string;
  name: string;
  title: string;
  species: string;
  selfRef: string;
  userCall: string;
  tic: string;
  world: boolean;
  seed: string;
  sliders: { sharpTongue?: number; chatty?: number; humorous?: number; tsundere?: number };
  /** 跟西雅一樣（標準詞，什麼都不換） */
  canon: boolean;
  /** 真的資料夾名稱：工作桌、工作桌裡給她看的檔案、下載底下她的資料夾 */
  desk: string;
  inbox: string;
  downloads: string;
}

const CANON: PersonaInfo = {
  id: 'seia',
  name: '西雅',
  title: '雙子星貓',
  species: '貓娘',
  selfRef: '本喵',
  userCall: '主人',
  tic: '喵',
  world: true,
  seed: '',
  sliders: { sharpTongue: 50, chatty: 60, humorous: 70, tsundere: 60 },
  canon: true,
  desk: '西雅的工作桌',
  inbox: '給西雅',
  downloads: '西雅',
};

const CACHE_KEY = 'pet_persona_cache';
let current: PersonaInfo = CANON;

function readCache(): PersonaInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...CANON, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

/** 開畫面前呼叫一次（最多等 2.5 秒） */
export async function loadPersona(): Promise<PersonaInfo> {
  const cached = readCache();
  if (cached) current = cached;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('/api/persona', { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      current = { ...CANON, ...j, sliders: { ...CANON.sliders, ...(j?.sliders || {}) } };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(current));
      } catch {
        // 存不了就算了
      }
    }
  } catch {
    // 後端沒回應：用快取或西雅
  }
  return current;
}

export function persona(): PersonaInfo {
  return current;
}

/** 全名：「雙子星貓・西雅」；沒有稱號就只有名字 */
export function fullName(p = current): string {
  return p.title ? `${p.title}・${p.name}` : p.name;
}

/** 當標籤用的稱呼（以前寫死「雙子星貓」的地方）：有稱號用稱號，否則用名字 */
export function titleOrName(p = current): string {
  return p.title || p.name;
}

/** 視窗標題 */
export function windowTitle(p = current): string {
  return p.canon ? 'Gemini 雙子星貓 · 美國大豆包 AI 桌寵' : `${fullName(p)} · AI 桌寵`;
}
