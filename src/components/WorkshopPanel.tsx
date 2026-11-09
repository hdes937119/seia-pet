import React, { useCallback, useEffect, useState } from 'react';
import { FolderGrants } from './FolderGrants';
import { CommissionPanel } from './CommissionPanel';
import { WidgetsPanel } from './WidgetsPanel';
import { ActionsPanel } from './ActionsPanel';

/**
 * 西雅的工坊（設定面板「探索」分頁）：叫她去工坊做東西、看她做好的作品、決定要不要讓她展示。
 * 作品放在 sandbox 的 iframe 裡跑（沒有同源權限、不能連網路、不能碰桌寵或你的檔案）。
 */

interface Work {
  id: string;
  title: string;
  brief: string;
  ideaBy: 'seia' | 'master';
  auto?: boolean;
  status: 'running' | 'done' | 'failed' | 'approved' | 'rejected';
  createdAt: number;
  finishedAt?: number;
  entry?: string;
  comment?: string;
  error?: string;
  files: Array<{ path: string; bytes: number }>;
  folders?: string[];
  delivered?: string[];
  kind?: 'lab';
  result?: string;
}
interface Snapshot {
  auto?: { enabled: boolean; perDay: number; today: number };
  busy: string | null;
  dailyMax: number;
  today: number;
  canStart: { ok: boolean; reason?: string };
  works: Work[];
}

const STATUS_LABEL: Record<Work['status'], string> = {
  running: '🔨 製作中',
  done: '✨ 做好了，等你看',
  failed: '💥 失敗',
  approved: '✅ 已展示',
  rejected: '🙈 收起來了',
};

const HEADERS = { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' };

export const WorkshopPanel: React.FC = () => {
  const [data, setData] = useState<Snapshot | null>(null);
  const [idea, setIdea] = useState('');
  const [msg, setMsg] = useState('');
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/workshop')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setMsg('讀不到工坊（後端沒開？）'));
  }, []);

  useEffect(() => {
    load();
    // 有作品在做的時候常常更新
    const t = window.setInterval(load, data?.busy ? 5000 : 30000);
    return () => window.clearInterval(t);
  }, [load, data?.busy]);

  const start = async () => {
    setStarting(true);
    setMsg('她在想要做什麼…');
    try {
      const r = await fetch('/api/workshop/start', { method: 'POST', headers: HEADERS, body: JSON.stringify({ idea: idea.trim() }) });
      const j = await r.json();
      if (!j.ok) setMsg(j.reason || '開不了工');
      else {
        setMsg(`開工了：「${j.work.title}」（大約要幾分鐘）`);
        setIdea('');
      }
    } catch {
      setMsg('開工失敗');
    } finally {
      setStarting(false);
      load();
    }
  };

  const toggleAuto = async (enabled: boolean) => {
    await fetch('/api/workshop/auto', { method: 'PUT', headers: HEADERS, body: JSON.stringify({ enabled }) }).catch(() => {});
    load();
  };

  const act = async (id: string, action: 'approve' | 'reject' | 'delete') => {
    if (action === 'delete' && !window.confirm('確定要刪掉這個作品嗎？')) return;
    await fetch(action === 'delete' ? `/api/workshop/${id}` : `/api/workshop/${id}/${action}`, {
      method: action === 'delete' ? 'DELETE' : 'POST',
      headers: HEADERS,
    }).catch(() => {});
    if (action === 'delete' && preview === id) setPreview(null);
    load();
  };

  // 在桌寵（Electron）裡：開成獨立、可以調整大小的視窗；在瀏覽器裡：面板裡的小窗
  const popOut = typeof window !== 'undefined' && typeof (window as any).electronAPI?.openWorkshopWork === 'function';
  const openWork = (w: Work) => {
    if (popOut && w.entry) {
      (window as any).electronAPI.openWorkshopWork(w.id, w.entry, w.title);
      return;
    }
    setPreview(preview === w.id ? null : w.id);
  };

  if (!data) return <p className="text-[10px] text-slate-500 px-1">{msg || '讀取工坊中…'}</p>;

  return (
    <>
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          🛠️ 西雅的工坊
          {typeof (window as any).electronAPI?.openDesk === 'function' && (
            <button
              type="button"
              onClick={() => (window as any).electronAPI.openDesk('')}
              title="桌寵資料夾裡的「西雅的工作桌」：她做好的作品、委託成果都在這裡；想給她看的檔案放進「給西雅」"
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
            >
              📂 工作桌
            </button>
          )}
        </span>
        <span className="text-[10px] text-slate-400">
          今天 {data.today} / {data.dailyMax} 件
        </span>
      </div>
      <div className="flex gap-1.5">
        <input
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="點子（空白＝讓她自己決定）"
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={starting || !data.canStart.ok}
          onClick={start}
          className="shrink-0 px-2.5 py-1 rounded-lg bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-white"
          title={data.canStart.ok ? '' : data.canStart.reason}
        >
          {starting ? '…' : '去做吧'}
        </button>
      </div>
      {data.auto && (
        <label className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
          <span>
            ✨ 心血來潮時自己去做
            <span className="text-slate-500">（每天最多 {data.auto.perDay} 件，今天 {data.auto.today}）</span>
          </span>
          <input
            type="checkbox"
            checked={data.auto.enabled}
            onChange={(e) => toggleAuto(e.target.checked)}
            className="w-4 h-4 accent-purple-500 shrink-0"
          />
        </label>
      )}
      {(msg || !data.canStart.ok) && <p className="text-[10px] text-slate-400">{msg || data.canStart.reason}</p>}

      <div className="space-y-1.5">
        {data.works.slice(0, 8).map((w) => (
          <div key={w.id} className="rounded-lg bg-slate-950/60 border border-slate-800 px-2 py-1.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">
                {w.kind === 'lab' ? '🔬 ' : ''}
                {w.title}
                <span className="ml-1 text-[10px] text-slate-500">{w.kind === 'lab' ? '（研究用的實驗室）' : w.ideaBy === 'master' ? '（你的點子）' : w.auto ? '（她心血來潮）' : '（她想的）'}</span>
              </span>
              <span className="text-[10px] text-slate-400 shrink-0">{w.kind === 'lab' && w.status === 'done' ? '🔬 跑完了' : STATUS_LABEL[w.status]}</span>
            </div>
            {w.comment && <p className="text-[10px] text-purple-200">西雅：{w.comment}</p>}
            {w.kind === 'lab' && w.result && (
              <p className="text-[10px] text-slate-300 whitespace-pre-wrap max-h-28 overflow-auto">{w.result.slice(0, 800)}</p>
            )}
            {!!w.folders?.length && <p className="text-[10px] text-slate-400">📁 用了：{w.folders.join('、')}</p>}
            {!!w.delivered?.length && <p className="text-[10px] text-emerald-300 break-all">📥 放進你的資料夾：{w.delivered.join('、')}</p>}
            {w.error && <p className="text-[10px] text-red-300 break-all">{w.error.slice(0, 200)}</p>}
            {w.entry && (
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => openWork(w)} className="px-2 py-0.5 rounded bg-purple-700/70 hover:bg-purple-600">
                  {popOut ? '開新視窗玩' : preview === w.id ? '收起' : '打開玩玩'}
                </button>
                {w.status !== 'approved' && (
                  <button type="button" onClick={() => act(w.id, 'approve')} className="px-2 py-0.5 rounded bg-emerald-700/70 hover:bg-emerald-600">
                    讓她展示
                  </button>
                )}
                {w.status === 'approved' && (
                  <button type="button" onClick={() => act(w.id, 'reject')} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
                    收起來
                  </button>
                )}
                <button type="button" onClick={() => act(w.id, 'delete')} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-red-800/70">
                  刪除
                </button>
              </div>
            )}
            {!w.entry && w.status !== 'running' && (
              <button type="button" onClick={() => act(w.id, 'delete')} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-red-800/70">
                刪除
              </button>
            )}
            {!popOut && preview === w.id && w.entry && (
              <iframe
                title={w.title}
                src={`/api/workshop/${w.id}/files/${w.entry.split('/').map(encodeURIComponent).join('/')}`}
                sandbox="allow-scripts"
                className="w-full aspect-square rounded-lg border border-slate-700 bg-white"
              />
            )}
          </div>
        ))}
        {!data.works.length && <p className="text-[10px] text-slate-500">還沒有作品。按「去做吧」讓她自己決定做什麼。</p>}
      </div>
      <p className="text-[10px] text-slate-500">作品在隔離的工坊裡做、在沙盒裡跑；只有你在下面給的資料夾，工作時才會唯讀掛進去。「讓她展示」之後，她聊天時才會提起它。</p>
      <details className="pt-1 border-t border-slate-800">
        <summary className="text-[10px] text-slate-400 cursor-pointer">進階：借她資料夾（現在想給她看的檔案，放進工作桌的「給西雅」就好）</summary>
        <FolderGrants />
      </details>
    </div>
    <WidgetsPanel />
    <CommissionPanel />
    <ActionsPanel />
    </>
  );
};
