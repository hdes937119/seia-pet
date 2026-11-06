/**
 * Gemini 網頁版對話連動：主人在瀏覽器（gemini.google.com）問 Gemini 的問題和回答，
 * 由瀏覽器腳本（public/gemini-web-sync.user.js）送到桌寵後端，讓她知道你最近在問什麼。
 *
 * 只存最近 30 則、每則截短；存在 data/gemini-web.json（不會被更新包帶走）。
 */
import fs from 'fs';
import path from 'path';

export interface GeminiWebItem {
  question: string;
  answer: string;
  at: number;
}

const MAX_ITEMS = 30;
const Q_MAX = 400;
const A_MAX = 600;
/** 聊天時只提最近這段時間內問的 */
const CONTEXT_WINDOW_MS = 6 * 60 * 60 * 1000;

const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/<!--[\s\S]*?-->/g, '') // 不讓網頁內容夾帶隱藏標記
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function createGeminiWebStore(dataDir: string) {
  const file = path.join(dataDir, 'gemini-web.json');
  let items: GeminiWebItem[] = [];
  try {
    if (fs.existsSync(file)) items = JSON.parse(fs.readFileSync(file, 'utf8'))?.items || [];
  } catch {
    items = [];
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ items }, null, 2));
      } catch (err: any) {
        console.warn('[Gemini 網頁] 儲存失敗：', err?.message);
      }
    }, 300);
  };

  return {
    /** 收到一組問答；同一題重複送來（重新整理頁面）就忽略。回傳新加入的那一筆 */
    add(question: unknown, answer: unknown): GeminiWebItem | null {
      const q = clean(question, Q_MAX);
      const a = clean(answer, A_MAX);
      if (!q || !a) return null;
      if (items.some((x) => x.question === q && x.answer.slice(0, 80) === a.slice(0, 80))) return null;
      const item = { question: q, answer: a, at: Date.now() };
      items.push(item);
      if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS);
      save();
      return item;
    },

    recent(windowMs = CONTEXT_WINDOW_MS, max = 5): GeminiWebItem[] {
      const since = Date.now() - windowMs;
      return items.filter((x) => x.at >= since).slice(-max);
    },
  };
}

export type GeminiWebStore = ReturnType<typeof createGeminiWebStore>;

/** 給聊天提示詞：主人最近在 Gemini 網頁版問了什麼（背景資料） */
export function describeGeminiWeb(store: GeminiWebStore): string {
  const list = store.recent();
  if (!list.length) return '';
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    `【主人最近在 Gemini 網頁版問的事（背景資料）】\n` +
    list.map((x) => `- ${fmt(x.at)} 問：「${x.question.slice(0, 120)}」（Gemini 大意：${x.answer.slice(0, 100)}）`).join('\n') +
    `\n（這是主人在瀏覽器裡問「另一個 Gemini」的事，不是問你的。只有聊到相關話題時才自然提一句，例如「你剛剛不是問 Gemini 那個…」；不相關就不要提，也不要假裝是你回答的。）`
  );
}
