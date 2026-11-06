import React, { useCallback, useEffect, useState } from 'react';

/**
 * 📁 資料夾權限（設定面板「探索」分頁的工坊底下）：她請求、你同意；或你自己給。
 * 只有工坊工作執行時才會唯讀掛進工坊，做完就卸下。系統資料夾、使用者資料夾本身、AppData、. 開頭的資料夾、桌寵自己的資料夾一律不能給。
 */

interface Grant {
  id: string;
  label: string;
  path: string;
  mode: 'read' | 'add';
  note: string;
  createdAt: number;
  expiresAt: number | null;
  expired?: boolean;
}
interface Req {
  id: string;
  at: number;
  purpose: string;
  what: string;
  mode: 'read' | 'add';
  from: string;
  status: 'open' | 'granted' | 'declined';
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' };
const MODE_LABEL = { read: '唯讀', add: '唯讀＋可以新增檔案' };

export const FolderGrants: React.FC = () => {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [form, setForm] = useState({ path: '', label: '', mode: 'read', days: 7, note: '', requestId: '' });
  const [warn, setWarn] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    fetch('/api/folders')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setGrants(d.grants || []);
        setRequests(d.requests || []);
      })
      .catch(() => setMsg('讀不到資料夾權限（後端沒開？）'));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const check = async () => {
    setMsg('');
    setWarn(null);
    const r = await fetch('/api/folders/check', { method: 'POST', headers: HEADERS, body: JSON.stringify({ path: form.path }) })
      .then((x) => x.json())
      .catch(() => null);
    if (!r) return setMsg('檢查失敗');
    if (!r.ok) return setMsg(`不能給：${r.reason}`);
    setWarn(r.warnings || []);
  };
  const give = async () => {
    const r = await fetch('/api/folders', { method: 'POST', headers: HEADERS, body: JSON.stringify(form) })
      .then((x) => x.json())
      .catch(() => null);
    if (!r?.ok) return setMsg(`不能給：${r?.reason || '失敗'}`);
    setMsg(`給了「${r.grant.label}」`);
    setWarn(null);
    setForm({ path: '', label: '', mode: 'read', days: 7, note: '', requestId: '' });
    load();
  };
  const remove = async (id: string) => {
    await fetch(`/api/folders/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
    load();
  };
  const test = async (g: Grant) => {
    setMsg(`測試「${g.label}」中…（掛上、列出檔案、卸下）`);
    const r = await fetch(`/api/folders/${g.id}/test`, { method: 'POST', headers: HEADERS })
      .then((x) => x.json())
      .catch(() => null);
    if (!r?.ok) return setMsg(`測試失敗：${r?.reason || '後端沒回應'}`);
    setMsg(`工坊看得到（唯讀）：${(r.files || []).join('、') || '（空資料夾）'}`);
  };
  const decline = async (id: string) => {
    await fetch(`/api/folders/requests/${id}/decline`, { method: 'POST', headers: HEADERS }).catch(() => {});
    load();
  };
  const answer = (q: Req) => {
    setForm({ path: '', label: q.what.slice(0, 20), mode: q.mode, days: 7, note: q.purpose.slice(0, 100), requestId: q.id });
    setWarn(null);
    setMsg(`回覆她的請求「${q.what}」：填上資料夾路徑，按「檢查」`);
  };

  const open = requests.filter((q) => q.status === 'open');
  const live = grants.filter((g) => !g.expired);

  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span>📁 資料夾權限</span>
        <span className="text-[10px] text-slate-400">只有工坊工作時唯讀掛進去，做完卸下</span>
      </div>

      {open.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-amber-300">她想要的資料夾：</p>
          {open.map((q) => (
            <div key={q.id} className="rounded-lg bg-slate-950/60 border border-amber-800/60 px-2 py-1.5 space-y-1">
              <p>
                「{q.what}」<span className="text-[10px] text-slate-400">（{MODE_LABEL[q.mode]}，{q.from}）</span>
              </p>
              <p className="text-[10px] text-purple-200">用途：{q.purpose}</p>
              <div className="flex gap-1">
                <button type="button" onClick={() => answer(q)} className="px-2 py-0.5 rounded bg-emerald-700/70 hover:bg-emerald-600">
                  選資料夾給她
                </button>
                <button type="button" onClick={() => decline(q.id)} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
                  不給
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <input
          value={form.path}
          onChange={(e) => {
            setForm({ ...form, path: e.target.value });
            setWarn(null);
          }}
          placeholder="資料夾路徑，例如 D:\照片\2026"
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
        />
        <div className="flex gap-1">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="給她看的名字（空白＝資料夾名）"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
          />
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-1 text-xs">
            <option value="read">唯讀</option>
            <option value="add">可以新增檔案</option>
          </select>
          <select value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} className="bg-slate-950 border border-slate-700 rounded-lg px-1 text-xs">
            <option value={1}>1 天</option>
            <option value={7}>7 天</option>
            <option value={0}>永久</option>
          </select>
        </div>
        <input
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="說明（例如：裡面是我的跑步紀錄）"
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
        />
        <div className="flex gap-1">
          <button type="button" disabled={!form.path.trim()} onClick={check} className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40">
            檢查
          </button>
          {warn && (
            <button type="button" onClick={give} className="px-2.5 py-1 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white">
              {warn.length ? '我知道了，還是給她' : '給她'}
            </button>
          )}
          {form.requestId && (
            <button type="button" onClick={() => setForm({ path: '', label: '', mode: 'read', days: 7, note: '', requestId: '' })} className="px-2 py-1 rounded-lg bg-slate-800">
              取消
            </button>
          )}
        </div>
        {warn && warn.length > 0 && (
          <div className="text-[10px] text-amber-300">
            ⚠️ 裡面有看起來像金鑰、密碼的檔案（她會讀得到）：
            <ul className="list-disc ml-4">
              {warn.map((w) => (
                <li key={w} className="break-all">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
        {msg && <p className="text-[10px] text-slate-400">{msg}</p>}
      </div>

      {live.length > 0 && (
        <div className="space-y-1">
          {live.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/60 border border-slate-800 px-2 py-1">
              <span className="min-w-0">
                <span className="font-medium">「{g.label}」</span>
                <span className="text-[10px] text-slate-400">
                  {' '}
                  {MODE_LABEL[g.mode]}，{g.expiresAt ? `到 ${new Date(g.expiresAt).toLocaleDateString('zh-TW')}` : '永久'}
                </span>
                <span className="block text-[10px] text-slate-500 truncate">{g.path}</span>
              </span>
              <span className="shrink-0 flex gap-1">
                <button type="button" onClick={() => test(g)} className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600">
                  測試
                </button>
                <button type="button" onClick={() => remove(g.id)} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-red-800/70">
                  收回
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-500">系統資料夾、使用者資料夾本身、AppData、. 開頭的資料夾、桌寵自己的資料夾和它的上層（例如桌面）都不能給。可以新增檔案的資料夾，她只能放新檔案進去，不會覆蓋或刪除你的檔案。</p>
    </div>
  );
};
