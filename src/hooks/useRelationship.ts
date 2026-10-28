import { useCallback, useEffect, useState } from 'react';

/** 心情與好感度（由後端 /api/relationship 計算與保存） */

export interface RelationshipSnapshot {
  mood: number;
  moodLabel: { label: string; emoji: string; tone: string };
  moodReason: string;
  affection: number;
  level: { index: number; name: string; nextAt: number | null; min: number };
  daysTogether: number;
  streakDays: number;
  nickname: string;
  insideJokes: Array<{ id: string; text: string; createdAt: number }>;
  levels?: Array<{ min: number; name: string }>;
}

export type RelationshipEventType = 'pat' | 'discovery_opened' | 'discovery_dismissed';

const REFRESH_MS = 5 * 60 * 1000; // 心情會隨時間慢慢回到平常，定期更新顯示

export function useRelationship() {
  const [snapshot, setSnapshot] = useState<RelationshipSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/relationship');
      if (res.ok) setSnapshot(await res.json());
    } catch {
      // 後端沒開時就先不顯示
    }
  }, []);

  /** 回報互動（摸頭、打開 / 關掉推薦），後端會更新心情與好感度 */
  const report = useCallback(async (type: RelationshipEventType) => {
    try {
      const res = await fetch('/api/relationship/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (res.ok) setSnapshot(await res.json());
    } catch {
      // ignore
    }
  }, []);

  const update = useCallback(async (patch: { nickname?: string }) => {
    const res = await fetch('/api/relationship', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) setSnapshot(await res.json());
  }, []);

  const removeJoke = useCallback(async (id: string) => {
    const res = await fetch(`/api/relationship/jokes/${id}`, { method: 'DELETE' });
    if (res.ok) setSnapshot(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  return { snapshot, refresh, report, update, removeJoke };
}
