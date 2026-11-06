import React, { useEffect, useState } from 'react';

/**
 * 主人的班表（設定面板）：西雅照這個時間去河木鎮上班。
 * 存在後端 data/world/world.json（GET / PUT /api/world/schedule）。
 */

type Slot = { start: string; end: string };
type Schedule = Record<string, Slot[]>;

// 星期一排第一個，星期日最後
const DAYS: Array<[number, string]> = [
  [1, '一'],
  [2, '二'],
  [3, '三'],
  [4, '四'],
  [5, '五'],
  [6, '六'],
  [0, '日'],
];

export const WorkScheduleEditor: React.FC = () => {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    fetch('/api/world/schedule')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.schedule && setSchedule(d.schedule))
      .catch(() => setState('error'));
  }, []);

  const save = (next: Schedule) => {
    setSchedule(next);
    setState('saving');
    fetch('/api/world/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: next }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d?.schedule) setSchedule(d.schedule);
        setState('saved');
      })
      .catch(() => setState('error'));
  };

  if (!schedule) {
    return <p className="text-[10px] text-slate-500 px-1">{state === 'error' ? '讀不到班表（後端沒開？）' : '讀取班表中…'}</p>;
  }

  const slotOf = (day: number): Slot | null => schedule[String(day)]?.[0] || null;
  const update = (day: number, slot: Slot | null) => {
    const next: Schedule = { ...schedule };
    if (slot) next[String(day)] = [slot];
    else delete next[String(day)];
    save(next);
  };

  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs space-y-1.5">
      <div>
        🗓️ 我的班表
        <span className="block text-[10px] text-slate-400 mt-0.5">
          你出門上班時，西雅也傳送去河木鎮上班；下班回家會跟你說鎮上的事。行事曆寫「請假」那天她也放假。
        </span>
      </div>
      {DAYS.map(([day, label]) => {
        const slot = slotOf(day);
        return (
          <div key={day} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 w-14 shrink-0">
              <input
                type="checkbox"
                checked={Boolean(slot)}
                onChange={(e) => update(day, e.target.checked ? { start: '09:00', end: '18:00' } : null)}
                className="w-3.5 h-3.5 accent-purple-500"
              />
              週{label}
            </label>
            {slot ? (
              <>
                <input
                  type="time"
                  value={slot.start}
                  onChange={(e) => e.target.value && update(day, { ...slot, start: e.target.value })}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-0.5 text-xs"
                />
                <span className="text-slate-500">～</span>
                <input
                  type="time"
                  value={slot.end}
                  onChange={(e) => e.target.value && update(day, { ...slot, end: e.target.value })}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-0.5 text-xs"
                />
              </>
            ) : (
              <span className="text-[10px] text-slate-500">休息</span>
            )}
          </div>
        );
      })}
      {state === 'error' && <p className="text-[10px] text-red-300">儲存失敗，開始時間要比結束時間早</p>}
      {state === 'saved' && <p className="text-[10px] text-emerald-300">已儲存</p>}
    </div>
  );
};
