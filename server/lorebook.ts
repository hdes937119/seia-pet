/**
 * Lorebook（11/15 第 55 項）：公開版取代河木鎮的「世界設定」，由使用者自己寫。
 *
 * 檔案：persona/<id>/lorebook.json（跟人格包放在一起；不會上傳）
 *   {
 *     "entries": [
 *       { "name": "世界", "always": true, "content": "…每次聊天都會帶的基本設定…" },
 *       { "name": "阿福", "keys": ["阿福", "麵包店"], "content": "…最近的對話提到這些詞才帶…" }
 *     ]
 *   }
 * - always=true：每次聊天都帶（世界的基本設定，寫短一點）
 * - 其他：最近幾句對話出現 keys 裡任何一個詞才帶（角色、地點、道具…）；沒寫 keys 就用 name 當關鍵字
 * - 存檔就生效（看檔案修改時間重讀），不用重開
 *
 * 西雅沒有這個檔案（她的世界是河木鎮，見 server/world.ts），所以對她沒有任何影響。
 */
import fs from 'fs';
import path from 'path';
import { persona, PERSONA_DIR } from './personaPack';

export interface LoreEntry {
  name: string;
  keys: string[];
  content: string;
  always: boolean;
}

/** 整個區塊最多幾個字（太長會吃掉聊天的上下文） */
const MAX_CHARS = 2500;
/** 一條最多幾個字 */
const MAX_ENTRY = 800;
/** 看最近幾行對話來比對關鍵字 */
const RECENT_LINES = 6;

let cache: { file: string; mtime: number; entries: LoreEntry[] } | null = null;

function filePath() {
  return path.join(PERSONA_DIR, persona().id, 'lorebook.json');
}

export function loreEntries(): LoreEntry[] {
  const file = filePath();
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    cache = { file, mtime: 0, entries: [] };
    return [];
  }
  if (cache && cache.file === file && cache.mtime === mtime) return cache.entries;
  let entries: LoreEntry[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
    entries = list
      .map((e: any) => {
        const name = String(e?.name || '').trim();
        const content = String(e?.content || '').trim().slice(0, MAX_ENTRY);
        let keys = Array.isArray(e?.keys) ? e.keys.map((k: any) => String(k).trim()).filter(Boolean) : [];
        if (!keys.length && name) keys = [name];
        return { name, keys, content, always: e?.always === true };
      })
      .filter((e: LoreEntry) => e.content && (e.always || e.keys.length));
    console.log(`[世界設定] 讀到 ${entries.length} 條（persona/${persona().id}/lorebook.json）`);
  } catch (err: any) {
    console.warn(`[世界設定] persona/${persona().id}/lorebook.json 看不懂（${err?.message}），先不用`);
  }
  cache = { file, mtime, entries };
  return entries;
}

export function hasLorebook(): boolean {
  return loreEntries().length > 0;
}

/** 聊天背景資料的「世界設定」區塊：always 的每次帶，其他的看最近的對話有沒有提到 */
export function describeLorebook(recentText: string): string {
  const entries = loreEntries();
  if (!entries.length) return '';
  const recent = String(recentText || '').split('\n').slice(-RECENT_LINES).join('\n').toLowerCase();
  const hit = entries.filter((e) => e.always || e.keys.some((k) => recent.includes(k.toLowerCase())));
  if (!hit.length) return '';
  const lines: string[] = [];
  let total = 0;
  for (const e of [...hit.filter((x) => x.always), ...hit.filter((x) => !x.always)]) {
    const line = `- ${e.name ? `${e.name}：` : ''}${e.content}`;
    if (total + line.length > MAX_CHARS) break;
    lines.push(line);
    total += line.length;
  }
  return `【世界設定】（主人寫的、你所在世界的設定。這是背景，不用主動介紹；聊到相關的事時照這個說，不要跟它矛盾，也不要自己編出跟它衝突的事）\n${lines.join('\n')}`;
}
