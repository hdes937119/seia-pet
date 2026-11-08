import React, { useCallback, useEffect, useState } from 'react';

/**
 * 西雅的配件（11/9，設定面板「探索」分頁、工坊底下）：她申請把作品裝成配件 → 主人在這裡安裝或拒絕；
 * 已安裝的可以打開、移除；看她（配件）登記的提醒。見 server/widgets.ts。
 */

type Perm = 'say' | 'notify' | 'remind';
interface Widget {
  id: string;
  title: string;
  why: string;
  source: { kind: 'work' | 'commission'; id: string; entry: string };
  perms: Perm[];
  status: 'pending' | 'installed' | 'rejected' | 'removed';
  changed?: boolean;
  from: string;
  requestedAt: number;
  decidedAt?: number;
  note?: string;
}
interface Reminder {
  id: string;
  widgetId: string;
  widgetTitle: string;
  at: number;
  text: string;
  repeat?: 'daily';
}
interface Snapshot {
  perms: Record<Perm, string>;
  widgets: Widget[];
  reminders: Reminder[];
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' };
const time = (ms: number) => new Date(ms).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const WidgetsPanel: React.FC = () => {
  const [data, setData] = useState<Snapshot | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/widgets')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setMsg('讀不到配件（後端還沒重開？）'));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 20000);
    return () => window.clearInterval(t);
  }, [load]);

  const call = async (url: string, method: string, body?: unknown, okMsg = '') => {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      setMsg(j.ok === false ? j.reason || '沒成功' : okMsg);
    } catch {
      setMsg('沒成功');
    } finally {
      setBusy(false);
      load();
    }
  };
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const canOpen = typeof api?.openWidget === 'function';

  if (!data) return msg ? <p className="text-[10px] text-slate-500 px-1">{msg}</p> : null;
  const pending = data.widgets.filter((w) => w.status === 'pending');
  const installed = data.widgets.filter((w) => w.status === 'installed');
  const rejected = data.widgets.filter((w) => w.status === 'rejected').slice(0, 3);

  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span>🧩 西雅的配件</span>
        <span className="text-[10px] text-slate-400">已安裝 {installed.length} 個</span>
      </div>
      {msg && <p className="text-[10px] text-amber-200">{msg}</p>}

      {pending.map((w) => (
        <div key={w.id} className="rounded bg-amber-950/40 border border-amber-800/60 p-1.5 space-y-1">
          <p className="text-[11px] text-amber-200">
            ⏳ 她想把「{w.title}」裝成配件{w.changed ? '（內容跟你上次安裝時不一樣了，要再同意一次）' : ''}
          </p>
          <p className="text-[10px] text-slate-300">
            來源：{w.source.kind === 'work' ? '工坊作品' : '委託網頁'} {w.source.id}／{w.source.entry}（{w.from}，{time(w.requestedAt)}）
          </p>
          {w.why && <p className="text-[10px] text-slate-200 whitespace-pre-wrap">她說：{w.why}</p>}
          <div className="text-[10px] text-slate-300">
            要的權限：
            {w.perms.length ? (
              <ul className="list-disc pl-4">
                {w.perms.map((p) => (
                  <li key={p}>{data.perms[p] || p}</li>
                ))}
              </ul>
            ) : (
              '不用（只是一個小視窗）'
            )}
          </div>
          <input
            value={notes[w.id] || ''}
            onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })}
            placeholder="想跟她說的話（不裝的話寫原因）"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => call(`/api/widgets/${w.id}/decide`, 'POST', { approve: true, note: notes[w.id] || '' }, '裝好了，圓形選單「配件」打得開')}
              className="px-2 py-0.5 rounded bg-emerald-700/80 hover:bg-emerald-600"
            >
              安裝
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => call(`/api/widgets/${w.id}/decide`, 'POST', { approve: false, note: notes[w.id] || '' }, '跟她說先不裝了')}
              className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600"
            >
              不要
            </button>
          </div>
        </div>
      ))}

      {installed.map((w) => (
        <div key={w.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate">{w.title}</p>
            <p className="text-[10px] text-slate-400 truncate">{w.perms.length ? w.perms.map((p) => data.perms[p] || p).join('、') : '沒有權限'}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            {canOpen && (
              <button type="button" onClick={() => api.openWidget(w.id, w.title)} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]">
                打開
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm(`移除配件「${w.title}」？它登記的提醒也會一起刪掉。`) && call(`/api/widgets/${w.id}`, 'DELETE', undefined, '移除了')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-red-800/70 text-[10px]"
            >
              移除
            </button>
          </div>
        </div>
      ))}

      {!!data.reminders.length && (
        <details>
          <summary className="text-[10px] text-slate-400 cursor-pointer">配件登記的提醒（{data.reminders.length}）</summary>
          {data.reminders.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-[10px] text-slate-300">
              <span className="truncate">
                ⏰ {time(r.at)}{r.repeat ? '（每天）' : ''} {r.text}（{r.widgetTitle}）
              </span>
              <button type="button" disabled={busy} onClick={() => call(`/api/widgets/reminders/${r.id}`, 'DELETE', undefined, '提醒取消了')} className="px-1.5 rounded bg-slate-800 hover:bg-slate-700 shrink-0">
                取消
              </button>
            </div>
          ))}
        </details>
      )}

      {rejected.map((w) => (
        <p key={w.id} className="text-[10px] text-slate-500">
          ✘ 沒裝：「{w.title}」{w.note ? `（${w.note}）` : ''}
        </p>
      ))}

      {!data.widgets.length && <p className="text-[10px] text-slate-500">還沒有配件。她覺得自己做的作品適合常駐在你桌上（鬧鐘、計時器、提醒…）時，會在這裡申請，你同意才會裝。</p>}
      <p className="text-[10px] text-slate-500">配件一樣在離線沙盒裡跑，碰不到你的檔案和網路；只能用你給的權限（說話、通知、提醒），而且有次數限制。</p>
    </div>
  );
};
