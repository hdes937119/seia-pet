import { useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import { getClientTime } from '../utils/clientTime';

/**
 * 事件日記整理：把還沒整理過的對話交給後端（/api/memory/compile），由 Gemini 整理成事件。
 *  - 累積 5 句主人說的話（約 10 則對話）就整理一次
 *  - 主人離開電腦時（compileNow），只要有新對話就整理
 * 已經整理到哪裡記在 localStorage，重開也不會重複整理。
 */

const DIARY_AT_KEY = 'gemini_twin_cat_diary_at';
const USER_MSGS_PER_COMPILE = 5;

/** 訊息 id 結尾是建立時間（Date.now()），用來判斷先後 */
export function messageTime(m: ChatMessage): number | null {
  const match = m.id.match(/(\d{12,})(?:_\d+)?$/);
  return match ? Number(match[1]) : null;
}

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function useDiaryCompiler(messages: ChatMessage[], isBusy: boolean) {
  const messagesRef = useRef(messages);
  const runningRef = useRef(false);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const compile = useCallback(async (force: boolean) => {
    if (runningRef.current) return;
    let since = 0;
    try {
      since = Number(localStorage.getItem(DIARY_AT_KEY)) || 0;
    } catch {
      // ignore
    }
    const pending = messagesRef.current
      .map((m) => ({ m, at: messageTime(m) }))
      .filter((x): x is { m: ChatMessage; at: number } => x.at !== null && x.at > since && !x.m.isStreaming);
    const userCount = pending.filter((x) => x.m.role === 'user').length;
    if (userCount === 0 || (!force && userCount < USER_MSGS_PER_COMPILE)) return;

    runningRef.current = true;
    try {
      const res = await fetch('/api/memory/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: pending.map(({ m, at }) => ({ role: m.role, content: m.content, at })),
          today: localDate(),
          clientTime: getClientTime(),
        }),
      });
      if (res.ok) {
        const latest = Math.max(...pending.map((x) => x.at));
        try {
          localStorage.setItem(DIARY_AT_KEY, String(latest));
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('[事件日記] 整理失敗:', err);
    } finally {
      runningRef.current = false;
    }
  }, []);

  // 對話告一段落（不在等回覆）時檢查一次：夠多句就整理
  useEffect(() => {
    if (isBusy) return;
    const t = window.setTimeout(() => void compile(false), 3000);
    return () => window.clearTimeout(t);
  }, [messages, isBusy, compile]);

  return { compileNow: () => compile(true) };
}
