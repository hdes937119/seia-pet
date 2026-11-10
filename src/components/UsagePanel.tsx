import React, { useEffect, useState } from 'react';

/**
 * 今日用量（設定面板「模型」分頁）：今天花了多少、預算還剩多少、哪個任務最貴、快取命中率、回覆首字耗時。
 * 資料來自後端 /api/usage（token 數是 Gemini 回報的，費用是依公開價目表估算）。
 */

interface TaskRow {
  task: string;
  calls: number;
  costTwd: number;
  cacheHitRate: number | null;
  unknown: number;
  background: boolean;
}
interface UsageSummary {
  budgetTwd: number;
  budgetSource?: 'panel' | 'env' | 'default';
  todayTwd: number;
  monthTwd: number;
  overBudget: boolean;
  cacheHitRate: number | null;
  ttftMedianMs: number | null;
  tasks: TaskRow[];
  promptMeter?: Record<string, PromptMeter>;
}
interface PromptMeter {
  at: number;
  blocks: Array<{ name: string; chars: number }>;
  stableChars: number;
  dynamicChars: number;
  historyTurns: number;
  estTokens: number;
  warnings: string[];
}

const TASK_LABEL: Record<string, string> = {
  chat: '聊天',
  line: 'LINE',
  greeting: '打招呼',
  vision: '看螢幕',
  transcribe: '語音輸入',
  explore: '探索（你按的）',
  'explore-idle': '她自己閒逛',
  narrator: '河木鎮說書人',
  goals: '今天的目標',
  nudge: '主動搭話',
  writeback: '整理鎮上設定',
  reflect: '整理興趣',
  'gemini-web': 'Gemini 網頁吐槽',
  curiosity: '突然想問',
  diary: '日記',
  workshop: '工坊',
  threads: '回想話頭',
};

export const UsagePanel: React.FC = () => {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetMsg, setBudgetMsg] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const saveBudget = async (value: number | null) => {
    setBudgetMsg('');
    try {
      const r = await fetch('/api/usage/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' },
        body: JSON.stringify({ budgetTwd: value }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return setBudgetMsg(j.reason || '沒存成功');
      setBudgetMsg(value === null ? `回到預設：每天 NT$${j.budgetTwd}` : `已存：之後每天 NT$${j.budgetTwd}`);
      setBudgetInput('');
      setReloadKey((k) => k + 1);
    } catch {
      setBudgetMsg('沒存成功（後端沒開？）');
    }
  };

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/usage')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => alive && (setData(d), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [reloadKey]);

  if (!data) {
    return <p className="text-[10px] text-slate-500 px-1">{error ? '讀不到用量（後端沒開？）' : '讀取用量中…'}</p>;
  }
  const pct = Math.min(100, Math.round((data.todayTwd / data.budgetTwd) * 100));
  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span>📊 今日用量</span>
        <span className={data.overBudget ? 'text-red-300' : 'text-slate-300'}>
          約 NT${data.todayTwd.toFixed(1)} / {data.budgetTwd}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full ${data.overBudget ? 'bg-red-400' : 'bg-purple-400'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-slate-400">
        本月約 NT${data.monthTwd.toFixed(0)}・快取命中 {data.cacheHitRate ?? '—'}%・回覆首字 {data.ttftMedianMs ? `${(data.ttftMedianMs / 1000).toFixed(1)} 秒` : '—'}
        {data.overBudget ? '・超過預算：背景任務休息中（聊天不受影響）' : ''}
      </p>
      <div className="space-y-0.5">
        {data.tasks.slice(0, 8).map((t) => (
          <div key={t.task} className="flex justify-between text-[10px] text-slate-400">
            <span>
              {TASK_LABEL[t.task] || t.task}
              {t.background ? '（背景）' : ''} × {t.calls}
            </span>
            <span>
              NT${t.costTwd.toFixed(2)}
              {t.unknown ? `（${t.unknown} 次未回報）` : ''}
            </span>
          </div>
        ))}
      </div>
      {Object.entries(data.promptMeter || {}).map(([ch, m]) => (
        <div key={ch} className="pt-1 border-t border-slate-800 space-y-0.5">
          <div className="flex justify-between text-[10px] text-slate-300">
            <span>⚖️ 提示詞體重（{ch === 'line' ? 'LINE' : '桌面'}，最近一次）</span>
            <span className={m.warnings.length ? 'text-amber-300' : ''}>約 {m.estTokens.toLocaleString()} token</span>
          </div>
          <p className="text-[10px] text-slate-500">
            規則 {m.stableChars} 字・狀況 {m.dynamicChars} 字・對話 {m.historyTurns} 則
          </p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            {m.blocks.slice(0, 8).map((b) => `${b.name} ${b.chars}`).join('・')}
          </p>
          {m.warnings.length > 0 && <p className="text-[10px] text-amber-300">⚠️ {m.warnings.join('、')}</p>}
        </div>
      ))}
      <div className="pt-1 border-t border-slate-800 space-y-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-slate-300 shrink-0">每日預算 NT$</span>
          <input
            type="number"
            min={1}
            step={1}
            value={budgetInput}
            placeholder={String(data.budgetTwd)}
            onChange={(e) => setBudgetInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && budgetInput.trim()) void saveBudget(Number(budgetInput));
            }}
            className="w-20 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 text-[11px]"
          />
          <button
            disabled={!budgetInput.trim()}
            onClick={() => void saveBudget(Number(budgetInput))}
            className="px-2 py-0.5 rounded bg-purple-600/70 hover:bg-purple-500 disabled:opacity-40 text-[11px]"
          >
            儲存
          </button>
          {data.budgetSource === 'panel' && (
            <button onClick={() => void saveBudget(null)} className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[10px] text-slate-300">
              回到預設
            </button>
          )}
        </div>
        {budgetMsg && <p className="text-[10px] text-purple-200">{budgetMsg}</p>}
        <p className="text-[10px] text-slate-500">
          這裡填的金額每天都會自動套用（現在：{data.budgetSource === 'panel' ? '面板設定' : data.budgetSource === 'env' ? '.env 的 DAILY_BUDGET_TWD' : '預設值'}）。超過後背景任務會休息，聊天不受影響；委託另有自己的額度。費用依公開價目表估算，實際以 Google 帳單為準。
        </p>
      </div>
    </div>
  );
};
