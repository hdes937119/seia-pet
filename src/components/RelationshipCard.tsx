import React, { useEffect, useState } from 'react';
import { Heart, X } from 'lucide-react';
import type { RelationshipSnapshot } from '../hooks/useRelationship';

/** 設定面板「主動」分頁的「我們的關係」：好感度階段、相處天數、目前心情、暱稱、共同的梗 */
interface RelationshipCardProps {
  snapshot: RelationshipSnapshot | null;
  onNicknameChange: (nickname: string) => void;
  onRemoveJoke: (id: string) => void;
  onPatch?: (patch: { nicknameOff?: boolean; unrefuse?: string }) => void;
}

export const RelationshipCard: React.FC<RelationshipCardProps> = ({ snapshot, onNicknameChange, onRemoveJoke, onPatch }) => {
  const [nickname, setNickname] = useState(snapshot?.nickname || '');
  useEffect(() => setNickname(snapshot?.nickname || ''), [snapshot?.nickname]);
  // 她自己寫的核心筆記（每天凌晨反思一次）
  const [core, setCore] = useState<Array<{ id: string; about: 'master' | 'self'; text: string; evidence: string[]; tentative?: boolean }>>([]);
  useEffect(() => {
    fetch('/api/core-memory')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setCore(Array.isArray(j.notes) ? j.notes : []))
      .catch(() => {});
  }, [snapshot?.affection]);
  const removeCore = (id: string) => {
    fetch(`/api/core-memory/${id}`, { method: 'DELETE', headers: { 'X-Gemini-Pet': '1' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setCore(Array.isArray(j.notes) ? j.notes : []))
      .catch(() => {});
  };

  if (!snapshot) {
    return <p className="text-[11px] text-slate-500 px-1">讀取關係資料中…（後端沒開的話會看不到）</p>;
  }

  const { level, affection, moodLabel, moodReason, mood } = snapshot;
  // 這個階段內的進度
  const span = level.nextAt ? level.nextAt - level.min : 1;
  const progress = level.nextAt ? Math.min(100, Math.round(((affection - level.min) / span) * 100)) : 100;
  const moodPct = Math.round(((mood + 100) / 200) * 100);

  return (
    <div className="rounded-xl bg-gradient-to-br from-pink-950/40 via-purple-950/40 to-slate-900/70 border border-pink-500/30 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-pink-100 flex items-center gap-1">
          <Heart className="w-3.5 h-3.5 fill-pink-400 text-pink-400" /> 我們的關係
        </span>
        <span className="text-[10px] text-slate-400">
          認識第 {snapshot.daysTogether} 天 · 連續 {snapshot.streakDays} 天見面
        </span>
      </div>

      {/* 好感度 */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="font-bold text-pink-200">{level.name}</span>
          <span className="text-slate-400 font-mono">
            好感 {affection}
            {level.nextAt ? ` / ${level.nextAt}` : '（滿級）'}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-pink-500 to-purple-400" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* 心情 */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-slate-200">
            {moodLabel.emoji} 現在心情：{moodLabel.label}
          </span>
          {moodReason && <span className="text-[10px] text-slate-400 truncate max-w-[55%]">因為{moodReason}</span>}
        </div>
        <div className="h-1.5 rounded-full bg-gradient-to-r from-sky-900 via-slate-700 to-amber-700 relative">
          <span
            className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-pink-400 -translate-x-1/2 shadow"
            style={{ left: `${moodPct}%` }}
          />
        </div>
      </div>

      {/* 暱稱 */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-300 shrink-0">她叫你</span>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onBlur={() => nickname !== snapshot.nickname && onNicknameChange(nickname)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder={level.index >= 2 ? '還沒取，或自己填一個' : '到「好朋友」階段她會幫你取暱稱'}
          maxLength={12}
          className="flex-1 bg-slate-900/80 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-pink-400"
        />
      </div>

      {/* 不要暱稱／她不會再用的稱呼（在對話裡說「別這樣叫我」也會記到這裡） */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
        <label className="flex items-center gap-1 cursor-pointer mr-2">
          <input type="checkbox" checked={!!snapshot.nicknameOff} onChange={(e) => onPatch?.({ nicknameOff: e.target.checked })} />
          不要暱稱
        </label>
        {(snapshot.refusedNicknames || []).length > 0 && <span>她不會再用：</span>}
        {(snapshot.refusedNicknames || []).map((n) => (
          <span key={n} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300">
            {n}
            <button onClick={() => onPatch?.({ unrefuse: n })} className="text-slate-500 hover:text-emerald-400" title="讓她可以再用這個稱呼">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {/* 共同的梗 */}
      {snapshot.insideJokes.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 mb-1">我們之間的梗（熟了以後她偶爾會提起）</p>
          <div className="flex flex-wrap gap-1">
            {snapshot.insideJokes.map((j) => (
              <span key={j.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-slate-900/80 border border-slate-700 text-[10px] text-slate-200">
                {j.text}
                <button onClick={() => onRemoveJoke(j.id)} className="text-slate-500 hover:text-rose-400" title="刪掉這個梗">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 她自己寫的核心筆記（Letta 式，每天凌晨反思；寫錯的可以刪，她會記得那是錯的） */}
      {core.length > 0 && (
        <div className="space-y-1">
          {(['master', 'self'] as const).map((about) => {
            const list = core.filter((n) => n.about === about);
            if (!list.length) return null;
            return (
              <div key={about}>
                <p className="text-[10px] text-slate-400 mb-0.5">{about === 'master' ? '她對你的理解' : '她自己的相處心得'}</p>
                {list.map((n) => (
                  <div key={n.id} className="flex items-start gap-1 text-[10px] text-slate-200" title={`根據：${n.evidence.join('；')}`}>
                    <span className="flex-1">
                      {n.text}
                      {n.tentative && <span className="text-slate-500">（還不確定）</span>}
                    </span>
                    <button onClick={() => removeCore(n.id)} className="text-slate-500 hover:text-rose-400 shrink-0" title="這條寫錯了，刪掉">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
