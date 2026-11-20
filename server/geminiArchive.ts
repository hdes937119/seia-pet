/**
 * Gemini 舊紀錄（11/20，主人選「C：主題整理＋可以翻的檔案庫」，範圍最近一個月）
 *
 * 主人用 Google 匯出（Takeout →「我的活動」→ Gemini 應用程式，JSON 格式）下載紀錄，
 * 把 MyActivity.json（中文介面可能叫「我的活動.json」）放進工作桌的「給西雅」。
 * 後端每 10 分鐘看一次：發現新的匯出檔 → 讀進來（只留最近 IMPORT_DAYS 天）→ 存成檔案庫 → 請模型整理一次「主人常問的主題」。
 *
 * - 檔案庫：data/gemini-archive.json（不上傳、走記憶同步）
 * - 聊天：主人這句話跟某幾題有關時，才把那幾題（和主題整理）放進背景資料「問過Gemini」
 * - 跟 server/geminiWeb.ts 不一樣：那個是瀏覽器腳本即時送來、只看最近 6 小時；這個是舊紀錄、用關鍵字查
 */
import fs from 'fs';
import path from 'path';

export interface ArchiveItem {
  question: string;
  answer: string;
  at: number;
}

interface ArchiveState {
  items: ArchiveItem[];
  /** 模型整理的「主人最近常問 Gemini 的主題」 */
  summary: string;
  summaryAt: number;
  /** 讀過的匯出檔（路徑|大小|修改時間），一樣的檔案不重讀 */
  imported: string[];
  importedAt: number;
}

export const IMPORT_DAYS = Number(process.env.GEMINI_IMPORT_DAYS) || 30;
const Q_MAX = 800;
const A_MAX = 1500;
const MAX_ITEMS = 3000;
const MAX_FILE = 80 * 1024 * 1024;

/** Gemini 網頁和匯出檔在問題前面加的字（螢幕閱讀器用的「你說了」、匯出檔的「Prompted」） */
export const QUESTION_PREFIX_RE = /^\s*(你說了|您說了|你说了|You said|Prompted|Asked|已提示|已輸入提示|提示|你問了)\s*[:：]?\s*/i;

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

function htmlToText(html: string): string {
  return decode(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const clean = (s: string, max: number) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 看起來是不是 Takeout「我的活動」的 Gemini 紀錄 */
function isGeminiRecord(r: any): boolean {
  if (!r || typeof r !== 'object' || !r.time) return false;
  const tag = [r.header, ...(Array.isArray(r.products) ? r.products : [])].map(String).join(' ');
  return /gemini|bard/i.test(tag);
}

/** 把一筆 Takeout 紀錄變成問答（不是提問的紀錄回傳 null） */
export function recordToItem(r: any): ArchiveItem | null {
  if (!isGeminiRecord(r)) return null;
  const at = Date.parse(String(r.time));
  if (!Number.isFinite(at)) return null;
  const title = String(r.title || '');
  if (!QUESTION_PREFIX_RE.test(title)) return null; // 「使用了擴充功能」「給了意見」這類不是提問
  const question = clean(title.replace(QUESTION_PREFIX_RE, ''), Q_MAX);
  if (!question) return null;
  const html = (Array.isArray(r.safeHtmlItem) ? r.safeHtmlItem : []).map((x: any) => String(x?.html || '')).join('\n');
  const answer = clean(htmlToText(html), A_MAX);
  return { question, answer, at };
}

/** 找關鍵字用：英文單字、數字，和中文的兩字詞 */
const STOP = new Set(
  '什麼 怎麼 可以 一下 我想 覺得 這個 那個 有沒 沒有 是不 不是 如果 因為 所以 還是 就是 一個 我們 你們 他們 現在 時候 知道 請問 幫我 給我 我要 要怎 怎樣 為什 麼樣 的話 一些 喜歡 應該 需要 能不 能夠 之前 之後 剛剛 今天 明天 問題 方法 可能 the and for with what how you your that this are can'.split(' ')
);
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const t = String(text || '').toLowerCase();
  for (const w of t.match(/[a-z][a-z0-9.+#-]{2,}|\d{2,}/g) || []) if (!STOP.has(w)) out.add(w);
  for (const run of t.match(/[一-鿿]+/g) || []) {
    for (let i = 0; i + 1 < run.length; i++) {
      const bi = run.slice(i, i + 2);
      if (!STOP.has(bi)) out.add(bi);
    }
  }
  return out;
}

export function createGeminiArchive(dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'gemini-archive.json');
  let st: ArchiveState = { items: [], summary: '', summaryAt: 0, imported: [], importedAt: 0 };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 壞掉就從空的開始
  }
  const save = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(st, null, 1));
    } catch (err: any) {
      log(`[Gemini 舊紀錄] 儲存失敗：${err?.message}`);
    }
  };

  /** 在一個資料夾（工作桌「給西雅」）裡找還沒讀過的匯出檔，讀進來。回傳這次新加了幾題 */
  function scan(dir: string, now = Date.now()): { added: number; files: string[] } {
    const found: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 6) return;
      let list: fs.Dirent[] = [];
      try {
        list = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of list) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f, depth + 1);
        else if (e.isFile() && /\.json$/i.test(e.name)) found.push(f);
      }
    };
    walk(dir, 0);
    const since = now - IMPORT_DAYS * 86_400_000;
    let added = 0;
    const files: string[] = [];
    for (const f of found) {
      let sig = '';
      try {
        const s = fs.statSync(f);
        if (s.size > MAX_FILE) continue;
        sig = `${f}|${s.size}|${Math.round(s.mtimeMs)}`;
      } catch {
        continue;
      }
      if (st.imported.includes(sig)) continue;
      let data: any;
      try {
        data = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
      } catch {
        continue; // 不是 JSON 就不是匯出檔
      }
      if (!Array.isArray(data) || !data.some(isGeminiRecord)) continue; // 別的 JSON（不是 Gemini 的活動紀錄）
      st.imported.push(sig);
      const seen = new Set(st.items.map((x) => `${x.at}|${x.question.slice(0, 60)}`));
      let n = 0;
      for (const r of data) {
        const it = recordToItem(r);
        if (!it || it.at < since) continue;
        const k = `${it.at}|${it.question.slice(0, 60)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        st.items.push(it);
        n++;
      }
      added += n;
      files.push(path.basename(f));
      log(`[Gemini 舊紀錄] 讀了 ${path.basename(f)}：最近 ${IMPORT_DAYS} 天新加 ${n} 題`);
    }
    if (files.length) {
      st.items.sort((a, b) => a.at - b.at);
      if (st.items.length > MAX_ITEMS) st.items.splice(0, st.items.length - MAX_ITEMS);
      st.importedAt = now;
      st.imported = st.imported.slice(-50);
      save();
    }
    return { added, files };
  }

  /** 給模型整理主題用的材料（只有問題，太多就平均抽樣） */
  function summaryPrompt(): string {
    const qs = st.items.map((x) => x.question.slice(0, 150));
    const step = Math.max(1, Math.ceil(qs.length / 400));
    const picked = qs.filter((_, i) => i % step === 0);
    const from = st.items[0] ? new Date(st.items[0].at).toLocaleDateString('zh-TW') : '';
    const to = st.items.length ? new Date(st.items[st.items.length - 1].at).toLocaleDateString('zh-TW') : '';
    return `下面是一個人在 ${from}～${to} 問 Gemini（AI 助理）的問題，共 ${qs.length} 題${step > 1 ? `（平均抽了 ${picked.length} 題）` : ''}。
請整理出他最常問、最在意的 5～8 個主題，每個主題一行：「主題：一句話說他想知道或在做什麼」。只根據下面的問題，不要猜測沒出現的事；很私人的事（健康、感情、金錢）用中性的說法帶過就好。只輸出這幾行，用繁體中文。

${picked.map((q) => `- ${q}`).join('\n')}`;
  }
  function setSummary(text: string, now = Date.now()) {
    st.summary = clean(String(text || '').replace(/\n+/g, '；'), 700);
    st.summaryAt = now;
    save();
  }

  /** 跟這句話有關的舊問題（關鍵字比對） */
  function search(text: string, max = 3): ArchiveItem[] {
    const q = tokens(text);
    if (!q.size || !st.items.length) return [];
    const scored = st.items
      .map((it) => {
        const hay = `${it.question} ${it.answer.slice(0, 300)}`.toLowerCase();
        let s = 0;
        for (const t of q) if (hay.includes(t)) s += /^[a-z0-9]/.test(t) ? 2 : 1;
        return { it, s };
      })
      .filter((x) => x.s >= 3)
      .sort((a, b) => b.s - a.s || b.it.at - a.it.at);
    return scored.slice(0, max).map((x) => x.it);
  }

  /** 聊天背景資料「問過Gemini」：有相關的舊問題才有內容 */
  function describeForChat(userText: string): string {
    if (!st.items.length) return '';
    const hits = search(userText);
    const forced = /gemini|問過|之前問|上次問|以前問/i.test(String(userText || ''));
    if (!hits.length && !forced) return '';
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };
    const lines = [`【主人以前在 Gemini 問過的事（從他匯出的紀錄，最近 ${IMPORT_DAYS} 天，共 ${st.items.length} 題）】`];
    if (st.summary) lines.push(`他常問的主題：${st.summary}`);
    for (const h of hits) lines.push(`- ${fmt(h.at)} 問：「${h.question.slice(0, 160)}」（Gemini 大意：${h.answer.slice(0, 200) || '沒有記到回答'}）`);
    lines.push('（這是主人以前問「另一個 Gemini」的事，不是問你的、也不是你回答的。只有聊到相關的事才自然提一句，不相關就不要提；記不清楚的細節不要編。）');
    return lines.join('\n');
  }

  return {
    scan,
    summaryPrompt,
    setSummary,
    search,
    describeForChat,
    needsSummary: () => st.items.length > 0 && st.summaryAt < st.importedAt,
    stats: () => ({ items: st.items.length, summary: st.summary, importedAt: st.importedAt, from: st.items[0]?.at || 0, to: st.items[st.items.length - 1]?.at || 0 }),
  };
}

export type GeminiArchive = ReturnType<typeof createGeminiArchive>;
