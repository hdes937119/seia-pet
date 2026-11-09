import React, { useCallback, useEffect, useState } from 'react';

/**
 * 行動提案＋她的瀏覽器（設定面板「探索」分頁，委託底下）。
 * 行動提案：她列好步驟，你在這裡看完整內容、整個同意才會在你電腦上照順序執行；改了就是新版本，要再同意。
 * 她的瀏覽器：背景開著，登入資料跟你的 Chrome 分開；需要登入的網站在這裡開視窗幫她登入。
 */

interface Step {
  type: 'winget' | 'download' | 'open' | 'write_file';
  id?: string;
  url?: string;
  filename?: string;
  target?: string;
  folder?: string;
  path?: string;
  content?: string;
  note?: string;
  check?: string;
  warn?: string;
}
interface Plan {
  id: string;
  title: string;
  why: string;
  from: string;
  createdAt: number;
  version: number;
  revisionOf?: string;
  steps: Step[];
  status: 'checking' | 'invalid' | 'waiting' | 'running' | 'done' | 'failed' | 'rejected' | 'superseded';
  problems?: string[];
  results: Array<{ i: number; ok: boolean; output: string; at: number }>;
  masterNote?: string;
}
interface BrowseRun {
  at: number;
  goal: string;
  from: string;
  steps: string[];
  ok: boolean;
  answer: string;
  urls: string[];
  ms: number;
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' };
const STATUS: Record<Plan['status'], string> = {
  checking: '🔎 檢查中',
  invalid: '⚠️ 檢查沒過（她會改）',
  waiting: '⏳ 等你同意',
  running: '⚙️ 執行中',
  done: '✅ 完成',
  failed: '💥 中途失敗',
  rejected: '🙅 沒同意',
  superseded: '（有新版本）',
};
const TYPE: Record<Step['type'], string> = { winget: '安裝軟體', download: '下載', open: '打開', write_file: '新增檔案' };
const time = (ms: number) => new Date(ms).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const ActionsPanel: React.FC = () => {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [dl, setDl] = useState('');
  const [runs, setRuns] = useState<BrowseRun[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/actions')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        setPlans(j.plans || []);
        setDl(j.downloadDir || '');
      })
      .catch(() => setMsg('讀不到行動提案（後端還沒重開？）'));
    fetch('/api/browser')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        setRuns(j.history || []);
        setRunning(j.running || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, [load]);

  const post = async (url: string, body?: unknown, okMsg = '') => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      setMsg(j.ok === false ? j.reason || '沒成功' : okMsg);
      return j;
    } catch {
      setMsg('連不到後端');
      return null;
    } finally {
      setBusy(false);
      load();
    }
  };

  if (!plans) return <p className="text-[10px] text-slate-500 px-1">{msg || '讀取行動提案中…'}</p>;
  const shown = plans.filter((p) => p.status !== 'superseded').slice(0, 6);

  const stepLine = (s: Step) => {
    if (s.type === 'winget') return `${s.id}${s.check ? `（${s.check}）` : ''}`;
    if (s.type === 'download') return `${s.url}\n→ 下載\\西雅\\${s.filename}`;
    if (s.type === 'open') return s.target || '';
    return `${s.folder}\\${s.path}`;
  };

  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span>🧭 行動提案</span>
        <span className="text-[10px] text-slate-500">在你電腦上做事前，一定先問你</span>
      </div>
      {msg && <p className="text-[10px] text-slate-400">{msg}</p>}

      {shown.map((p) => (
        <div key={p.id} className="rounded-lg bg-slate-950/60 border border-slate-800 px-2 py-1.5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">
              {p.title}
              <span className="ml-1 text-[10px] text-slate-500">第 {p.version} 版・{p.from}</span>
            </span>
            <span className="text-[10px] text-slate-400 shrink-0">{STATUS[p.status]}</span>
          </div>
          {p.why && <p className="text-[10px] text-purple-200 whitespace-pre-wrap">西雅：{p.why}</p>}
          <ol className="space-y-1">
            {p.steps.map((s, i) => {
              const r = p.results.find((x) => x.i === i);
              return (
                <li key={i} className="text-[10px] text-slate-300">
                  <span className="text-slate-400">{i + 1}. {TYPE[s.type]}：</span>
                  <span className="whitespace-pre-wrap break-all">{stepLine(s)}</span>
                  {s.note && <span className="block text-slate-500">（{s.note}）</span>}
                  {s.warn && <span className="block text-amber-300">⚠️ {s.warn}</span>}
                  {s.type === 'write_file' && s.content && (
                    <details>
                      <summary className="cursor-pointer text-slate-500">看內容</summary>
                      <pre className="whitespace-pre-wrap max-h-32 overflow-auto bg-slate-950 rounded p-1">{s.content.slice(0, 3000)}</pre>
                    </details>
                  )}
                  {r && <span className={`block whitespace-pre-wrap ${r.ok ? 'text-emerald-300' : 'text-red-300'}`}>{r.ok ? '✔ ' : '✘ '}{r.output.slice(-400)}</span>}
                </li>
              );
            })}
          </ol>
          {!!p.problems?.length && p.status === 'invalid' && <p className="text-[10px] text-amber-300 whitespace-pre-wrap">{p.problems.join('\n')}</p>}
          {p.masterNote && <p className="text-[10px] text-slate-400">你說：{p.masterNote}</p>}
          {p.status === 'waiting' && (
            <div className="space-y-1">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="不同意的話，跟她說原因或要怎麼改"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`確定讓她照順序在你的電腦上執行這 ${p.steps.length} 步嗎？`) &&
                    post(`/api/actions/${p.id}/approve`, undefined, '開始執行了')
                  }
                  className="px-2 py-0.5 rounded bg-emerald-700/80 hover:bg-emerald-600 disabled:opacity-40"
                >
                  同意，整個執行
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => post(`/api/actions/${p.id}/reject`, { note }, '跟她說了').then(() => setNote(''))}
                  className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                >
                  不要
                </button>
              </div>
            </div>
          )}
          <p className="text-[10px] text-slate-600">{time(p.createdAt)}</p>
        </div>
      ))}
      {!shown.length && <p className="text-[10px] text-slate-500">還沒有提案。她研究或做委託時，如果需要在你電腦上裝軟體、下載檔案，會先在這裡列步驟給你看。</p>}
      {dl && <p className="text-[10px] text-slate-500 break-all">她下載的東西放在：{dl}</p>}

      <details className="pt-1 border-t border-slate-800">
        <summary className="text-[10px] text-slate-400 cursor-pointer">進階：她的瀏覽器（幫她登入、清除瀏覽資料）</summary>
      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between">
          <span>🌐 她的瀏覽器</span>
          <span className="text-[10px] text-slate-500">{running ? `正在：${running.slice(0, 20)}…` : '在背景，沒在用'}</span>
        </div>
        <div className="flex gap-1.5">
          <input
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            placeholder="要幫她登入的網址（https://…）"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <button
            type="button"
            disabled={busy || !/^https?:\/\//i.test(loginUrl.trim())}
            onClick={() => post('/api/browser/login', { url: loginUrl.trim() }, '開了一個視窗，登入完直接關掉就好')}
            className="shrink-0 px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
          >
            開視窗幫她登入
          </button>
        </div>
        {runs.slice(0, 5).map((r, i) => (
          <details key={i}>
            <summary className="text-[10px] text-slate-400 cursor-pointer">
              {time(r.at)} {r.ok ? '✔' : '✘'} {r.goal.slice(0, 40)}（{r.steps.length} 步）
            </summary>
            <p className="text-[10px] text-slate-500 whitespace-pre-wrap">{r.steps.join('\n')}</p>
            <p className="text-[10px] text-slate-300 whitespace-pre-wrap max-h-40 overflow-auto">{r.answer.slice(0, 1500)}</p>
          </details>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm('清掉她瀏覽器的登入資料和快取？') && post('/api/browser/clear', undefined, '清掉了')}
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
        >
          清除她的瀏覽資料
        </button>
        <p className="text-[10px] text-slate-500">她不能自己登入、留言、發文、購買；密碼和卡號欄位她打不進去，付款、結帳、銀行頁面她也不能點。瀏覽器紀錄重開後端會清掉，做研究時的結果會留在她的筆記裡。</p>
      </div>
      </details>
    </div>
  );
};
