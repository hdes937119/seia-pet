import React, { useCallback, useEffect, useState } from 'react';

/**
 * 她在忙（設定面板「主動」分頁）：自動開關、現在的狀態、手動叫她去做某件事（也可以拿來測試）。
 * 自動只在主人下班在家的時候發生（照「工作時間」設定），每天最多 BUSY_PER_DAY 次。
 */

interface Snapshot {
  busy: boolean;
  current: { label: string; emoji: string; endAt: number } | null;
  remainingSec: number;
  missedCount: number;
  autoEnabled: boolean;
  perDay: number;
  today: number;
  activities: Array<{ id: string; label: string; emoji: string }>;
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' };

export const BusyPanel: React.FC = () => {
  const [data, setData] = useState<Snapshot | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    fetch('/api/busy')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setMsg('讀不到狀態（後端沒開？）'));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  const call = async (url: string, method: string, body?: unknown) => {
    setMsg('');
    try {
      const r = await fetch(url, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (j.ok === false) setMsg(j.reason || '不行喵');
      else if (j.busy !== undefined) setData(j);
    } catch {
      setMsg('連不到後端');
    }
    load();
  };

  if (!data) return <p className="text-[10px] text-slate-500 px-1">{msg || '讀取中…'}</p>;

  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-1.5">
      <label className="flex items-center justify-between gap-2">
        <span>
          ⏳ 她偶爾會去忙自己的事
          <span className="block text-[10px] text-slate-500">
            你下班在家時，偶爾去洗澡、買宵夜、晾衣服…（每天最多 {data.perDay} 次，今天 {data.today}）。不在時傳的訊息，她回來會一次回覆。
          </span>
        </span>
        <input
          type="checkbox"
          checked={data.autoEnabled}
          onChange={(e) => call('/api/busy/auto', 'PUT', { enabled: e.target.checked })}
          className="w-4 h-4 accent-purple-500 shrink-0"
        />
      </label>
      {data.busy && data.current ? (
        <div className="flex items-center justify-between gap-2 text-[11px] text-purple-200">
          <span>
            {data.current.emoji} 正在{data.current.label}・還有約 {Math.ceil(data.remainingSec / 60)} 分鐘
            {data.missedCount ? `・你傳了 ${data.missedCount} 則` : ''}
          </span>
          <button type="button" onClick={() => call('/api/busy/end', 'POST')} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
            叫她回來
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {data.activities.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => call('/api/busy/start', 'POST', { activity: a.id })}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px]"
              title={`叫她現在去${a.label}`}
            >
              {a.emoji} {a.label}
            </button>
          ))}
        </div>
      )}
      {msg && <p className="text-[10px] text-amber-300">{msg}</p>}
    </div>
  );
};
