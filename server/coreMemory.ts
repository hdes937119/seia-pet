/**
 * 核心記憶（借 Letta／MemGPT「core memory」的想法，只借想法、這裡是自己寫的）。
 *
 * 兩小塊由她自己寫、自己改的筆記，每次聊天都帶著：
 *   - master：她對主人的理解（主人是什麼樣的人、在意什麼、怎麼相處比較好）
 *   - self：她自己的相處心得和態度（從經驗推出來的，不是設定好的個性）
 *
 * 每天凌晨 4 點後（電腦沒開就等下次開機）用前一天的對話反思一次（借 Generative Agents 的反思），
 * 由 server.ts 的 reflectCore() 呼叫模型，這裡只負責存、套用修改、過期和給提示詞的文字。
 *
 * 防止越想越冷（例如「主人回得短 → 主人不想理我 → 我少說話 → 互動更少 → 更確定」）：
 *   - 每條都要附根據（哪天、發生了什麼），只留最近 3 條根據
 *   - 模型標成 negative 的推論（被冷落、被拒絕、主人不想理她這類）先算「還不確定」，
 *     要在「另一天」又被確認才轉正；還不確定的 7 天沒被確認就自己消失
 *   - 每條 30 天沒被確認就過期；主人在設定面板刪掉的，記成「寫錯的」，之後不要再寫類似的
 *
 * 存在 data/memories/core.json。
 */
import fs from 'fs';
import path from 'path';
import { cleanSeqs } from './recall';

export type CoreAbout = 'master' | 'self';

export interface CoreNote {
  id: string;
  about: CoreAbout;
  text: string;
  /** 根據：「11/4 主人…」，最多留 3 條 */
  evidence: string[];
  /** 被寫進或確認過的日子（YYYY-MM-DD） */
  days: string[];
  firstAt: number;
  lastAt: number;
  /** 只有單一天根據的負面推論：還不確定 */
  tentative?: boolean;
  /** 來源原話編號（stream.jsonl 的 seq） */
  sourceSeqs?: number[];
}

export interface CoreOp {
  op: 'add' | 'update' | 'confirm' | 'remove';
  id?: string;
  about?: CoreAbout;
  text?: string;
  evidence?: string;
  negative?: boolean;
  sourceSeqs?: number[];
}

interface State {
  notes: CoreNote[];
  /** 已經反思到哪一天（含） */
  lastDay: string;
  /** 主人刪掉的（寫錯的） */
  rejected: Array<{ text: string; at: number }>;
  history: Array<{ at: number; day: string; ops: string[] }>;
}

export const CORE_MAX_PER = 12;
const DAY = 86_400_000;
const EXPIRE_MS = 30 * DAY;
const TENTATIVE_EXPIRE_MS = 7 * DAY;
const TEXT_MAX = 80;
const EVIDENCE_MAX = 100;

const pad = (n: number) => String(n).padStart(2, '0');
export const coreDayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** 某一天本機時間 00:00 的毫秒 */
export const dayStart = (day: string) => new Date(`${day}T00:00:00`).getTime();

export function createCoreMemory(dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'memories', 'core.json');
  let st: State = { notes: [], lastDay: '', rejected: [], history: [] };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(st, null, 2));
    } catch (err: any) {
      log(`[核心記憶] 存檔失敗：${err?.message}`);
    }
  }

  const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const newId = (now: number) => `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

  /** 過期：30 天沒被確認；還不確定的 7 天 */
  function expire(now = Date.now()): number {
    const before = st.notes.length;
    st.notes = st.notes.filter((n) => now - n.lastAt < (n.tentative ? TENTATIVE_EXPIRE_MS : EXPIRE_MS));
    return before - st.notes.length;
  }

  /**
   * 該反思哪幾天：昨天還沒反思、而且現在已經過了凌晨 4 點 → 回傳 { from, to }（最多往回 3 天）。
   * 第一次（從沒反思過）就看最近 3 天。
   */
  function pendingRange(now = Date.now()): { from: string; to: string } | null {
    if (new Date(now).getHours() < 4) return null;
    const yesterday = coreDayKey(now - DAY);
    if (st.lastDay && st.lastDay >= yesterday) return null;
    const earliest = coreDayKey(now - 3 * DAY);
    let from = st.lastDay ? coreDayKey(dayStart(st.lastDay) + DAY + 3_600_000) : earliest;
    if (from < earliest) from = earliest;
    return { from, to: yesterday };
  }

  function markDone(day: string) {
    if (!st.lastDay || day > st.lastDay) st.lastDay = day;
    save();
  }

  /** 套用模型給的修改（一次最多 8 個）；markDay＝把這天記成反思過了（手動補跑今天的時候不記，晚上照常反思） */
  function apply(ops: CoreOp[], day: string, now = Date.now(), markDay = true) {
    const done: string[] = [];
    for (const raw of (Array.isArray(ops) ? ops : []).slice(0, 8)) {
      const op = raw?.op;
      const ev = clean(raw?.evidence, EVIDENCE_MAX);
      const seqs = cleanSeqs(raw?.sourceSeqs, 6);
      const target = raw?.id ? st.notes.find((n) => n.id === raw.id) : undefined;
      if (op === 'add') {
        const about: CoreAbout = raw.about === 'self' ? 'self' : 'master';
        const text = clean(raw.text, TEXT_MAX);
        if (!text || !ev) continue;
        if (st.notes.some((n) => n.text === text)) continue;
        const note: CoreNote = {
          id: newId(now),
          about,
          text,
          evidence: [ev],
          days: [day],
          firstAt: now,
          lastAt: now,
          tentative: raw.negative ? true : undefined,
          ...(seqs.length ? { sourceSeqs: seqs } : {}),
        };
        st.notes.push(note);
        // 超過上限：丟掉同類裡最久沒被確認的
        const same = st.notes.filter((n) => n.about === about);
        if (same.length > CORE_MAX_PER) {
          const oldest = [...same].sort((a, b) => a.lastAt - b.lastAt)[0];
          st.notes = st.notes.filter((n) => n !== oldest);
          done.push(`滿了，忘掉「${oldest.text.slice(0, 20)}」`);
        }
        done.push(`新增${note.tentative ? '（還不確定）' : ''}「${text.slice(0, 30)}」`);
      } else if ((op === 'update' || op === 'confirm') && target) {
        if (op === 'update') {
          const text = clean(raw.text, TEXT_MAX);
          if (text) target.text = text;
        }
        if (ev) target.evidence = [...target.evidence, ev].slice(-3);
        if (seqs.length) target.sourceSeqs = cleanSeqs([...(target.sourceSeqs || []), ...seqs], 10);
        if (!target.days.includes(day)) target.days = [...target.days, day].slice(-10);
        target.lastAt = now;
        // 還不確定的，在另一天又被確認 → 轉正
        if (target.tentative && target.days.length >= 2) target.tentative = undefined;
        done.push(`${op === 'update' ? '修改' : '確認'}「${target.text.slice(0, 30)}」`);
      } else if (op === 'remove' && target) {
        st.notes = st.notes.filter((n) => n !== target);
        done.push(`拿掉「${target.text.slice(0, 30)}」`);
      }
    }
    const expired = expire(now);
    if (expired) done.push(`過期 ${expired} 條`);
    st.history = [...st.history, { at: now, day, ops: done }].slice(-30);
    if (markDay) markDone(day);
    else save();
    return done;
  }

  /** 主人在設定面板刪掉一條（記成寫錯的） */
  function removeByMaster(id: string) {
    const n = st.notes.find((x) => x.id === id);
    if (!n) return false;
    st.notes = st.notes.filter((x) => x !== n);
    st.rejected = [...st.rejected, { text: n.text, at: Date.now() }].slice(-20);
    save();
    log(`[核心記憶] 主人刪掉了：「${n.text}」`);
    return true;
  }

  const notesOf = (about: CoreAbout) => st.notes.filter((n) => n.about === about);
  const hasMaster = () => notesOf('master').length > 0;

  /** 給反思模型看的現況（含 id 和根據） */
  function describeForReflect(): string {
    const fmt = (n: CoreNote) =>
      `- id=${n.id}｜${n.text}${n.tentative ? '（還不確定）' : ''}｜根據：${n.evidence.join('；')}${
        n.sourceSeqs?.length ? `（原話 ${n.sourceSeqs.map((s) => `#${s}`).join(',')}）` : ''
      }`;
    return [
      `【你對主人的理解（master）】\n${notesOf('master').map(fmt).join('\n') || '（還沒有）'}`,
      `【你自己的相處心得（self）】\n${notesOf('self').map(fmt).join('\n') || '（還沒有）'}`,
      st.rejected.length ? `【主人刪掉過的筆記（表示寫錯了，不要再寫類似的）】\n${st.rejected.map((r) => `- ${r.text}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** 給聊天提示詞（withIds=true 時帶上 [c-...] 編號，給主動說話引用鎖核對） */
  function describeForChat(opts?: { withIds?: boolean }): string {
    const m = notesOf('master');
    const s = notesOf('self');
    if (!m.length && !s.length) return '';
    const withIds = Boolean(opts?.withIds);
    const parts: string[] = [];
    if (m.length)
      parts.push(
        `【你對主人的理解（你自己整理的筆記，可能有錯；主人現在說的話永遠優先，不要為了顯示你懂他而硬提）】\n${m
          .map((n) => `- ${withIds ? `[${n.id}] ` : ''}${n.text}`)
          .join('\n')}`
      );
    if (s.length)
      parts.push(
        `【你自己的相處心得（從你們相處的經驗得出來的，不是規定；標「還不確定」的可能只是想太多）】\n${s
          .map((n) => `- ${withIds ? `[${n.id}] ` : ''}${n.text}${n.tentative ? '（還不確定）' : ''}`)
          .join('\n')}`
      );
    return parts.join('\n');
  }

  function snapshot() {
    return { lastDay: st.lastDay, notes: st.notes, rejected: st.rejected, history: [...st.history].reverse().slice(0, 10) };
  }

  return { pendingRange, markDone, apply, removeByMaster, hasMaster, describeForReflect, describeForChat, snapshot, expire };
}

export type CoreMemory = ReturnType<typeof createCoreMemory>;
