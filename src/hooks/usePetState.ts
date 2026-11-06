import { useCallback, useEffect, useRef, useState } from 'react';
import type { PetActId, PetEmotionId, PetModeId, PetStateId } from '../components/pet/petStates';
import { PET_ACTS, PET_EMOTIONS } from '../components/pet/petStates';

/**
 * 桌寵狀態機。顯示優先順序：
 *   預覽（手動挑選） > 摸頭 > 微表情（開口前幾秒） > 情緒（幾秒後自動結束） > 運作模式 > 待機
 * 閒置一段時間沒事做時，會隨機冒出一個小情緒，讓她看起來是活的。
 */

const EMOTION_MS = 6000;
const PATTING_LINGER_MS = 1800; // 放開後再舒服一下
const PREVIEW_MS = 8000;
const IDLE_MIN_MS = 45_000;
const IDLE_MAX_MS = 90_000;
// 閒置時的隨機小情緒，依長時間心情挑選（心情好比較常開心，心情差比較常沮喪）
const IDLE_EMOTIONS: Record<'good' | 'normal' | 'bad', PetEmotionId[]> = {
  good: ['happy', 'loving', 'happy', 'proud', 'hungry'],
  normal: ['happy', 'hungry', 'proud', 'confused', 'loving'],
  bad: ['sad', 'confused', 'sad', 'angry'],
};

type ScreenMode = Extract<PetModeId, 'gaming' | 'gemini_web' | 'line' | 'eating' | 'tired' | 'exhausted' | 'rainy'> | null;
const ACT_MS = 3500;

export function usePetState(screenMode: ScreenMode, mood = 0) {
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const [emotion, setEmotion] = useState<PetEmotionId | null>(null);
  const [act, setAct] = useState<PetActId | null>(null);
  const actTimer = useRef<number | undefined>(undefined);
  const [patting, setPatting] = useState(false);
  const [preview, setPreview] = useState<PetStateId | null>(null);

  const emotionTimer = useRef<number | undefined>(undefined);
  const patTimer = useRef<number | undefined>(undefined);
  const previewTimer = useRef<number | undefined>(undefined);
  const lastActivityAt = useRef(Date.now());

  const markActive = () => {
    lastActivityAt.current = Date.now();
  };

  /** 後端或對話送來的情緒訊號 */
  const triggerEmotion = useCallback((value: string | null | undefined, ms = EMOTION_MS) => {
    if (!value || !(PET_EMOTIONS as string[]).includes(value)) return;
    markActive();
    window.clearTimeout(emotionTimer.current);
    setEmotion(value as PetEmotionId);
    emotionTimer.current = window.setTimeout(() => setEmotion(null), ms);
  }, []);

  /** 微表情：她開口前的一瞬間反應（白眼、嘆氣、心虛、害羞、偷笑） */
  const triggerAct = useCallback((value: string | null | undefined, ms = ACT_MS) => {
    if (!value || !(PET_ACTS as string[]).includes(value)) return;
    window.clearTimeout(actTimer.current);
    setAct(value as PetActId);
    actTimer.current = window.setTimeout(() => setAct(null), ms);
  }, []);

  const startPatting = useCallback(() => {
    markActive();
    window.clearTimeout(patTimer.current);
    setPatting(true);
  }, []);

  const stopPatting = useCallback(() => {
    window.clearTimeout(patTimer.current);
    patTimer.current = window.setTimeout(() => setPatting(false), PATTING_LINGER_MS);
  }, []);

  /** 手動預覽某個狀態（測試用） */
  const previewState = useCallback((state: PetStateId | null) => {
    window.clearTimeout(previewTimer.current);
    setPreview(state);
    if (state) previewTimer.current = window.setTimeout(() => setPreview(null), PREVIEW_MS);
  }, []);

  // 閒置隨機情緒
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const wait = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
      timer = window.setTimeout(() => {
        const idleFor = Date.now() - lastActivityAt.current;
        if (idleFor >= IDLE_MIN_MS) {
          const pool =
            IDLE_EMOTIONS[moodRef.current >= 25 ? 'good' : moodRef.current <= -25 ? 'bad' : 'normal'];
          const pick = pool[Math.floor(Math.random() * pool.length)];
          triggerEmotion(pick, 5000);
        }
        schedule();
      }, wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [triggerEmotion]);

  useEffect(
    () => () => {
      window.clearTimeout(emotionTimer.current);
      window.clearTimeout(patTimer.current);
      window.clearTimeout(previewTimer.current);
      window.clearTimeout(actTimer.current);
    },
    []
  );

  const state: PetStateId = preview ?? (patting ? 'patting' : act ?? emotion ?? screenMode ?? 'idle');

  return { state, triggerEmotion, triggerAct, startPatting, stopPatting, previewState, markActive };
}
