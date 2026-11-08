import React, { useCallback, useEffect, useState } from 'react';

/**
 * 主人的委託（設定面板「探索」分頁，工坊底下）：看計畫、回覆檢查點、給意見、設每日額度、
 * 執行她做好的工具（不花 AI 額度）、排程。見 server/commission.ts。
 */

interface Stage {
  title: string;
  goal: string;
  status: 'todo' | 'doing' | 'review' | 'done';
}
interface Checkpoint {
  id: string;
  at: number;
  kind: 'plan' | 'stage';
  stage?: number;
  report: string;
  ask?: string;
  status: 'waiting' | 'approved' | 'changes';
  reply?: string;
  stuck?: boolean;
}
interface Playtest {
  at: number;
  page: string;
  ok: boolean;
  reason?: string;
  errors: string[];
  seen?: string;
  problems?: string[];
  untested?: string[];
  matches?: boolean;
  shotKey?: string;
  shots?: number;
}
interface ToolDef {
  title: string;
  desc: string;
  run: string;
  report?: string;
  page?: string;
  scheduleHours?: number;
  scheduleOn: boolean;
}
interface ToolRun {
  at: number;
  ok: boolean;
  code: number;
  ms: number;
  output: string;
  trigger: 'manual' | 'schedule' | 'seia';
}
interface Job {
  id: string;
  at: number;
  goal: string;
  status: 'running' | 'done' | 'failed';
  result?: string;
  error?: string;
}
interface Commission {
  id: string;
  title: string;
  direction: string;
  constraints: string;
  status: 'planning' | 'review' | 'active' | 'paused' | 'done' | 'dropped';
  plan?: string;
  stages: Stage[];
  stage: number;
  dailyBudgetTwd: number;
  spentTodayTwd: number;
  checkpoints: Checkpoint[];
  feedback: Array<{ at: number; text: string; via: string }>;
  tool?: ToolDef;
  runs: ToolRun[];
  jobs: Job[];
  waiting: Checkpoint | null;
  due?: { ok: boolean; reason?: string };
  lastPlaytest?: Playtest;
}
interface Detail extends Commission {
  handoff: string;
  report: string;
  files: Array<{ path: string; bytes: number }>;
  notebook: string[];
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' };
const STATUS: Record<Commission['status'], string> = {
  planning: '✍️ 她在寫計畫',
  review: '⏳ 計畫等你看',
  active: '🔨 進行中',
  paused: '⏸️ 暫停',
  done: '✅ 完成',
  dropped: '🗑️ 取消',
};
const STAGE_MARK: Record<Stage['status'], string> = { todo: '○', doing: '▶', review: '⏳', done: '✔' };
const time = (ms: number) => new Date(ms).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const CommissionPanel: React.FC = () => {
  const [list, setList] = useState<Commission[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', direction: '', constraints: '' });
  const [showPage, setShowPage] = useState(false);

  const load = useCallback(() => {
    fetch('/api/commissions')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setList(j.commissions || []))
      .catch(() => setMsg('讀不到委託（後端沒開，或還沒重開後端？）'));
  }, []);
  const loadDetail = useCallback((id: string) => {
    fetch(`/api/commissions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDetail)
      .catch(() => setDetail(null));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      load();
      if (open) loadDetail(open);
    }, 20000);
    return () => window.clearInterval(t);
  }, [load, loadDetail, open]);

  useEffect(() => {
    setShowPage(false);
    if (open) loadDetail(open);
    else setDetail(null);
  }, [open, loadDetail]);

  const call = async (url: string, method: string, body?: unknown, okMsg = '') => {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      setMsg(j.ok === false ? j.reason || '沒成功' : okMsg);
      return j;
    } catch {
      setMsg('連不到後端');
      return null;
    } finally {
      setBusy(false);
      load();
      if (open) loadDetail(open);
    }
  };

  const create = async () => {
    if (!form.direction.trim()) return setMsg('要寫你想要她做什麼');
    const j = await call('/api/commissions', 'POST', form, '交給她了，她會先寫計畫給你看（大約一分鐘）');
    if (j?.ok) {
      setForm({ title: '', direction: '', constraints: '' });
      setShowNew(false);
      setOpen(j.commission.id);
    }
  };

  if (!list) return <p className="text-[10px] text-slate-500 px-1">{msg || '讀取委託中…'}</p>;
  const d = detail && detail.id === open ? detail : null;

  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span>📜 主人的委託</span>
        <button type="button" onClick={() => setShowNew(!showNew)} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px]">
          {showNew ? '收起' : '＋ 新委託'}
        </button>
      </div>
      {showNew && (
        <div className="space-y-1.5 rounded-lg bg-slate-950/60 border border-slate-800 p-2">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="名稱（可空白）"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <textarea
            value={form.direction}
            onChange={(e) => setForm({ ...form, direction: e.target.value })}
            placeholder="想要她做什麼（例如：做一個 Path of Exile 通貨漲跌系統，每天記價格，告訴我哪些在漲）"
            rows={3}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <input
            value={form.constraints}
            onChange={(e) => setForm({ ...form, constraints: e.target.value })}
            placeholder="限制（可空白，例如：只用公開資料、先做聯盟賽季）"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <button type="button" disabled={busy} onClick={create} className="px-2.5 py-1 rounded bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-white">
            交給她
          </button>
          <p className="text-[10px] text-slate-500">也可以直接在聊天裡跟她說「委託你做…」。</p>
        </div>
      )}
      {msg && <p className="text-[10px] text-slate-400">{msg}</p>}

      {list.map((c) => (
        <div key={c.id} className="rounded-lg bg-slate-950/60 border border-slate-800 px-2 py-1.5 space-y-1">
          <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full flex items-center justify-between gap-2 text-left">
            <span className="font-medium truncate">{c.title}</span>
            <span className="text-[10px] text-slate-400 shrink-0">
              {c.waiting ? '⏳ 等你回覆' : STATUS[c.status]}
              {c.status === 'active' && c.stages[c.stage] ? `・${c.stage + 1}/${c.stages.length}` : ''}
            </span>
          </button>
          <p className="text-[10px] text-slate-500">
            今天 NT${c.spentTodayTwd.toFixed(1)} / {c.dailyBudgetTwd}
            {c.jobs.some((j) => j.status === 'running') ? '・🔨 工坊正在做' : ''}
            {c.tool ? `・🧰 ${c.tool.title}` : ''}
          </p>

          {open === c.id && (
            <div className="space-y-2 pt-1 border-t border-slate-800">
              <p className="text-[10px] text-slate-300 whitespace-pre-wrap">委託：{c.direction}{c.constraints ? `\n限制：${c.constraints}` : ''}</p>

              {c.waiting && (
                <div className="rounded bg-amber-950/40 border border-amber-800/60 p-1.5 space-y-1">
                  <p className="text-[11px] text-amber-200">⏳ {c.waiting.kind === 'plan' ? '計畫等你同意' : `第 ${(c.waiting.stage ?? 0) + 1} 階段的成果`}（{time(c.waiting.at)}）</p>
                  <p className="text-[10px] text-slate-200 whitespace-pre-wrap max-h-40 overflow-auto">{c.waiting.report}</p>
                  {c.waiting.ask && <p className="text-[10px] text-amber-100">她想問：{c.waiting.ask}</p>}
                  {c.waiting.stuck && (
                    <p className="text-[10px] text-rose-200">⚠️ 她說這個階段沒做成／卡住了。按「讓她繼續做」不會跳到下一階段；真的要略過這個階段才按「跳過這階段」。</p>
                  )}
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="你的意見（要修改時寫要改哪裡）"
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        call(`/api/commissions/${c.id}/checkpoint`, 'POST', { decision: 'approve', note }, c.waiting?.stuck ? '她會繼續做這個階段' : '同意了，她會繼續做').then(() => setNote(''))
                      }
                      className="px-2 py-0.5 rounded bg-emerald-700/80 hover:bg-emerald-600"
                    >
                      {c.waiting.stuck ? '讓她繼續做' : '同意'}
                    </button>
                    {c.waiting.stuck && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          window.confirm('她說這個階段沒做成。確定要跳過、算這個階段完成，直接進下一階段？') &&
                          call(`/api/commissions/${c.id}/checkpoint`, 'POST', { decision: 'approve', note, force: true }, '跳過這個階段了').then(() => setNote(''))
                        }
                        className="px-2 py-0.5 rounded bg-rose-900/70 hover:bg-rose-800"
                      >
                        跳過這階段
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || !note.trim()}
                      onClick={() => call(`/api/commissions/${c.id}/checkpoint`, 'POST', { decision: 'changes', note }, '她會照你的意見改').then(() => setNote(''))}
                      className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                    >
                      要修改
                    </button>
                  </div>
                </div>
              )}

              {!!c.stages.length && (
                <div className="space-y-0.5">
                  {c.stages.map((s, i) => (
                    <p key={i} className={`text-[10px] ${i === c.stage && c.status === 'active' ? 'text-purple-200' : 'text-slate-400'}`}>
                      {STAGE_MARK[s.status]} {i + 1}. {s.title}：{s.goal}
                    </p>
                  ))}
                </div>
              )}

              {c.plan && (
                <details>
                  <summary className="text-[10px] text-slate-400 cursor-pointer">完整計畫</summary>
                  <p className="text-[10px] text-slate-300 whitespace-pre-wrap max-h-60 overflow-auto">{c.plan}</p>
                </details>
              )}

              {c.tool && (
                <div className="rounded bg-slate-900 border border-slate-700 p-1.5 space-y-1">
                  <p className="text-[11px]">🧰 {c.tool.title}</p>
                  <p className="text-[10px] text-slate-400">{c.tool.desc}（{c.tool.run}）</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => call(`/api/commissions/${c.id}/run-tool`, 'POST', undefined, '跑完了')}
                      className="px-2 py-0.5 rounded bg-purple-700/80 hover:bg-purple-600 disabled:opacity-40"
                    >
                      {busy ? '執行中…' : '立即執行'}
                    </button>
                    <label className="flex items-center gap-1 text-[10px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={c.tool.scheduleOn}
                        onChange={(e) => call(`/api/commissions/${c.id}`, 'PUT', { scheduleOn: e.target.checked })}
                        className="accent-purple-500"
                      />
                      每
                      <input
                        type="number"
                        min={1}
                        max={168}
                        defaultValue={c.tool.scheduleHours || 24}
                        onBlur={(e) => call(`/api/commissions/${c.id}`, 'PUT', { scheduleHours: Number(e.target.value) })}
                        className="w-12 bg-slate-950 border border-slate-700 rounded px-1"
                      />
                      小時自動跑（電腦開著才會跑）
                    </label>
                  </div>
                  {c.tool.page && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setShowPage(!showPage)} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]">
                        {showPage ? '收起網頁' : '看網頁'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => call(`/api/commissions/${c.id}/playtest`, 'POST', {}, '她實際打開看過了（大約要半分鐘）')}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] disabled:opacity-40"
                      >
                        🔍 讓她打開看看
                      </button>
                    </div>
                  )}
                  {c.lastPlaytest && (
                    <details>
                      <summary className="text-[10px] text-slate-400 cursor-pointer">
                        她實際打開看到的（{time(c.lastPlaytest.at)}）{c.lastPlaytest.ok ? (c.lastPlaytest.matches === false ? '⚠️ 跟助手說的不一樣' : c.lastPlaytest.errors.length || c.lastPlaytest.problems?.length ? '⚠️ 有問題' : '✔') : '✘ 沒打開成'}
                      </summary>
                      {c.lastPlaytest.ok ? (
                        <div className="space-y-1">
                          <p className="text-[10px] text-slate-300 whitespace-pre-wrap">{c.lastPlaytest.seen || '（沒寫成）'}</p>
                          {!!c.lastPlaytest.errors.length && <p className="text-[10px] text-rose-300 whitespace-pre-wrap">{c.lastPlaytest.errors.join('\n')}</p>}
                          {!!c.lastPlaytest.problems?.length && <p className="text-[10px] text-amber-200">問題：{c.lastPlaytest.problems.join('；')}</p>}
                          {!!c.lastPlaytest.untested?.length && <p className="text-[10px] text-slate-400">還沒測到：{c.lastPlaytest.untested.join('；')}</p>}
                          <div className="flex gap-1">
                            {Array.from({ length: c.lastPlaytest.shots || 0 }, (_, i) => (
                              <img key={i} src={`/api/commissions/${c.id}/playtest/${c.lastPlaytest!.shotKey}-${i + 1}.png`} alt={`截圖 ${i + 1}`} className="w-1/3 rounded border border-slate-700" />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400">{c.lastPlaytest.reason}</p>
                      )}
                    </details>
                  )}
                  {showPage && c.tool.page && (
                    <iframe
                      title={c.tool.title}
                      src={`/api/commissions/${c.id}/ws/${c.tool.page.split('/').map(encodeURIComponent).join('/')}`}
                      sandbox="allow-scripts"
                      className="w-full h-96 rounded border border-slate-700 bg-white"
                    />
                  )}
                  {d?.report && <pre className="text-[10px] text-slate-200 whitespace-pre-wrap max-h-60 overflow-auto bg-slate-950 rounded p-1">{d.report}</pre>}
                  {!!c.runs.length && (
                    <details>
                      <summary className="text-[10px] text-slate-400 cursor-pointer">
                        最近執行：{time(c.runs[c.runs.length - 1].at)} {c.runs[c.runs.length - 1].ok ? '✔' : '✘'}
                      </summary>
                      {[...c.runs].reverse().slice(0, 5).map((r, i) => (
                        <pre key={i} className="text-[10px] text-slate-400 whitespace-pre-wrap max-h-32 overflow-auto">
                          {time(r.at)} {r.trigger === 'schedule' ? '排程' : r.trigger === 'seia' ? '西雅用' : '手動'} {r.ok ? '✔' : `✘（${r.code}）`}{'\n'}
                          {r.output.slice(-800)}
                        </pre>
                      ))}
                    </details>
                  )}
                </div>
              )}

              {!!c.jobs.length && (
                <details>
                  <summary className="text-[10px] text-slate-400 cursor-pointer">工坊紀錄（{c.jobs.length}）</summary>
                  {[...c.jobs].reverse().slice(0, 6).map((j) => (
                    <p key={j.id} className="text-[10px] text-slate-400 whitespace-pre-wrap">
                      {time(j.at)} {j.status === 'running' ? '🔨' : j.status === 'done' ? '✔' : '✘'} {j.goal}
                      {j.status !== 'running' ? `\n${(j.result || j.error || '').slice(0, 300)}` : ''}
                    </p>
                  ))}
                </details>
              )}
              {d?.handoff && (
                <details>
                  <summary className="text-[10px] text-slate-400 cursor-pointer">工坊助手的交接筆記</summary>
                  <p className="text-[10px] text-slate-400 whitespace-pre-wrap max-h-48 overflow-auto">{d.handoff}</p>
                </details>
              )}
              {!!d?.notebook?.length && (
                <details>
                  <summary className="text-[10px] text-slate-400 cursor-pointer">她的研究筆記</summary>
                  {d.notebook.map((n, i) => (
                    <p key={i} className="text-[10px] text-slate-400">{n.slice(0, 300)}</p>
                  ))}
                </details>
              )}

              {!c.waiting && c.status !== 'done' && c.status !== 'dropped' && (
                <div className="flex gap-1.5">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="給她意見（下一輪會看到）"
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  />
                  <button
                    type="button"
                    disabled={busy || !note.trim()}
                    onClick={() => call(`/api/commissions/${c.id}/feedback`, 'POST', { note }, '收到，她下一輪會看').then(() => setNote(''))}
                    className="shrink-0 px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                  >
                    送出
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <label className="flex items-center gap-1 text-slate-300">
                  每天最多 NT$
                  <input
                    type="number"
                    min={0}
                    max={500}
                    defaultValue={c.dailyBudgetTwd}
                    onBlur={(e) => call(`/api/commissions/${c.id}`, 'PUT', { dailyBudgetTwd: Number(e.target.value) }, '額度改好了')}
                    className="w-14 bg-slate-950 border border-slate-700 rounded px-1"
                  />
                </label>
                {c.status === 'active' && (
                  <>
                    <button type="button" disabled={busy} onClick={() => call(`/api/commissions/${c.id}/cycle`, 'POST', undefined, '她馬上開始一輪')} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
                      現在做一輪
                    </button>
                    <button type="button" disabled={busy} onClick={() => call(`/api/commissions/${c.id}`, 'PUT', { status: 'paused' })} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
                      暫停
                    </button>
                  </>
                )}
                {c.status === 'paused' && (
                  <button type="button" disabled={busy} onClick={() => call(`/api/commissions/${c.id}`, 'PUT', { status: 'active' })} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
                    繼續
                  </button>
                )}
                {c.status !== 'dropped' && c.status !== 'done' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => window.confirm('確定不做這個委託了？（工作區和工具會留著）') && call(`/api/commissions/${c.id}`, 'PUT', { status: 'dropped' })}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-red-800/70"
                  >
                    不做了
                  </button>
                )}
                {(c.status === 'dropped' || c.status === 'done') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => window.confirm('刪掉這個委託和它的工作區、工具？刪了就找不回來。') && call(`/api/commissions/${c.id}`, 'DELETE').then(() => setOpen(null))}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-red-800/70"
                  >
                    刪除
                  </button>
                )}
              </div>
              {c.status === 'active' && c.due && !c.due.ok && <p className="text-[10px] text-slate-500">下一輪：{c.due.reason}</p>}
            </div>
          )}
        </div>
      ))}
      {!list.length && !showNew && <p className="text-[10px] text-slate-500">還沒有委託。在聊天裡跟她說「委託你做…」，或按「＋ 新委託」。</p>}
      <p className="text-[10px] text-slate-500">委託的花費有自己的每日額度，不算在她日常活動的預算裡。工具在隔離的工坊裡執行，不呼叫 AI、不花錢。</p>
    </div>
  );
};
