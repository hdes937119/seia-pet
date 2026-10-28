import React, { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, RotateCcw, Trash2 } from 'lucide-react';

/** 記憶小筆記的「日記」分頁：貓貓記得的「主人發生過的事」，可以標成已處理或刪掉記錯的 */

interface MemoryEvent {
  id: string;
  date: string;
  summary: string;
  keyword: string;
  category: string;
  importance: number;
  followUpAt: number | null;
  status: 'open' | 'resolved';
  outcome?: string;
  askCount: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  life: '生活',
  work: '工作',
  study: '學業',
  health: '健康',
  game: '遊戲',
  plan: '計畫',
  emotion: '心情',
  other: '其他',
};

function fmtFollowUp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const DiaryList: React.FC = () => {
  const [events, setEvents] = useState<MemoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/memory/events');
      const data = await res.json();
      setEvents(data.events || []);
    } catch {
      setError('讀不到日記，請確認後端有在執行');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const setStatus = async (id: string, status: 'open' | 'resolved') => {
    setEvents((prev) => prev?.map((e) => (e.id === id ? { ...e, status } : e)) ?? prev);
    await fetch(`/api/memory/events/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => load());
  };

  const remove = async (id: string) => {
    setEvents((prev) => prev?.filter((e) => e.id !== id) ?? prev);
    await fetch(`/api/memory/events/${id}`, { method: 'DELETE' }).catch(() => load());
  };

  if (error) return <p className="text-xs text-amber-300 text-center py-10">{error}</p>;
  if (!events)
    return (
      <div className="flex justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  if (events.length === 0)
    return (
      <p className="text-xs text-slate-500 text-center py-12 leading-relaxed">
        日記還是空的喵～
        <br />
        多跟貓貓聊聊你的生活（例如「明天要面試」），她會記下來，之後主動關心你。
      </p>
    );

  const now = Date.now();
  return (
    <>
      {events.map((e) => {
        const due = e.status === 'open' && e.followUpAt !== null && e.followUpAt <= now;
        return (
          <div
            key={e.id}
            className={`p-3 rounded-xl border transition-all ${
              e.status === 'resolved'
                ? 'bg-slate-950/40 border-slate-800 opacity-70'
                : due
                  ? 'bg-amber-950/30 border-amber-700/50'
                  : 'bg-slate-950/60 border-purple-900/40'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1 text-[10px]">
                  <span className="font-mono text-slate-400">{e.date}</span>
                  <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/40">
                    {CATEGORY_LABEL[e.category] || e.category}
                  </span>
                  {'★'.repeat(Math.max(1, Math.min(5, e.importance)))}
                  {e.status === 'resolved' ? (
                    <span className="text-emerald-400">已處理</span>
                  ) : e.followUpAt ? (
                    <span className={`flex items-center gap-0.5 ${due ? 'text-amber-300' : 'text-sky-300'}`}>
                      <CalendarClock className="w-3 h-3" />
                      {due ? '該關心了' : `預計 ${fmtFollowUp(e.followUpAt)} 關心`}
                      {e.askCount > 0 && `（問過 ${e.askCount} 次）`}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-slate-100">{e.summary}</p>
                {e.outcome && <p className="text-xs text-emerald-300 mt-1">↳ 後來：{e.outcome}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {e.status === 'open' ? (
                  <button
                    onClick={() => setStatus(e.id, 'resolved')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-800"
                    title="標成已處理（不再追問）"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus(e.id, 'open')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800"
                    title="改回未處理"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => remove(e.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                  title="刪除這則（記錯了）"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};
