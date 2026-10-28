import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 免持語音輸入（打遊戲用）：
 * 按一下開始聽 → 偵測到說話 → 停頓約 1.2 秒自動結束 → 轉成 16kHz WAV → 後端用 Gemini 轉文字 → 回呼 onResult。
 * 沒偵測到聲音 8 秒會自動取消；單次最長 30 秒。
 */

export type VoiceInputState = 'idle' | 'listening' | 'transcribing';

const SILENCE_TO_STOP_MS = 1200;
const NO_SPEECH_TIMEOUT_MS = 8000;
const MAX_RECORD_MS = 30000;
const CALIBRATE_MS = 300; // 一開始先量環境噪音
const MIN_THRESHOLD = 0.015;
const TARGET_SAMPLE_RATE = 16000;

interface Options {
  onResult: (text: string) => void;
  onStart?: () => void; // 例如：讓貓貓先閉嘴，避免麥克風收到她的聲音
}

export function useVoiceInput({ onResult, onStart }: Options) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [level, setLevel] = useState(0); // 0~1 音量，給 UI 顯示
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<VoiceInputState>('idle');
  const onResultRef = useRef(onResult);
  const onStartRef = useRef(onStart);
  const sessionRef = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder;
    ctx: AudioContext;
    timer: number;
    cancelled: boolean;
  } | null>(null);

  useEffect(() => {
    onResultRef.current = onResult;
    onStartRef.current = onStart;
  }, [onResult, onStart]);

  const setStateBoth = (s: VoiceInputState) => {
    stateRef.current = s;
    setState(s);
  };

  const cleanup = () => {
    const s = sessionRef.current;
    if (!s) return;
    window.clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    s.ctx.close().catch(() => {});
    sessionRef.current = null;
    setLevel(0);
  };

  /** 結束錄音；cancel = true 時直接丟掉不轉寫 */
  const stop = useCallback((cancel = false) => {
    const s = sessionRef.current;
    if (!s) return;
    s.cancelled = cancel;
    window.clearInterval(s.timer);
    if (s.recorder.state !== 'inactive') s.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    setStateBoth('listening'); // 先佔住狀態，避免連按熱鍵開出兩個錄音
    setError(null);
    onStartRef.current?.();
    playCue('start'); // 在開麥克風之前播，避免被錄進去
    await new Promise((r) => setTimeout(r, 120));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

      const startedAt = performance.now();
      let noiseSum = 0;
      let noiseCount = 0;
      let threshold = MIN_THRESHOLD;
      let speechStarted = false;
      let lastVoiceAt = startedAt;

      // 用 setInterval 而不是 requestAnimationFrame：視窗不在前景（打遊戲時）也要持續偵測
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(1, rms / 0.15));

        const now = performance.now();
        const elapsed = now - startedAt;
        if (elapsed < CALIBRATE_MS) {
          noiseSum += rms;
          noiseCount++;
          return;
        }
        if (noiseCount > 0) {
          threshold = Math.max(MIN_THRESHOLD, (noiseSum / noiseCount) * 3);
          noiseCount = 0;
        }

        if (rms > threshold) {
          speechStarted = true;
          lastVoiceAt = now;
        }
        if (speechStarted && now - lastVoiceAt > SILENCE_TO_STOP_MS) stop(false);
        else if (!speechStarted && elapsed > NO_SPEECH_TIMEOUT_MS) stop(true);
        else if (elapsed > MAX_RECORD_MS) stop(false);
      }, 50);

      recorder.onstop = async () => {
        const cancelled = sessionRef.current?.cancelled ?? true;
        const hadSpeech = speechStarted;
        cleanup();
        if (cancelled || !hadSpeech || chunks.length === 0) {
          playCue('cancel');
          setStateBoth('idle');
          return;
        }
        playCue('stop');
        setStateBoth('transcribing');
        try {
          const wavBase64 = await blobToWav16kBase64(new Blob(chunks, { type: 'audio/webm' }));
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: wavBase64, mimeType: 'audio/wav' }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          const text = (data?.text || '').trim();
          if (text) onResultRef.current(text);
          else setError('沒聽清楚，再說一次看看喵～');
        } catch (err: any) {
          console.warn('[STT] 失敗:', err);
          setError(`語音辨識失敗：${err?.message || '請稍後再試'}`);
        } finally {
          setStateBoth('idle');
        }
      };

      sessionRef.current = { stream, recorder, ctx, timer, cancelled: false };
      recorder.start(250);
    } catch (err: any) {
      console.warn('[STT] 無法開啟麥克風:', err);
      setError('無法使用麥克風，請確認系統的麥克風權限');
      cleanup();
      setStateBoth('idle');
    }
  }, [stop]);

  /** 熱鍵 / 按鈕用：沒在聽就開始，正在聽就立刻結束並送出 */
  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') void start();
    else if (stateRef.current === 'listening') stop(false);
  }, [start, stop]);

  const cancel = useCallback(() => stop(true), [stop]);

  useEffect(() => () => stop(true), [stop]);

  return { state, level, error, toggle, cancel, clearError: () => setError(null) };
}

/** 提示音：開始（上升兩聲）、收音完成（下降一聲）、取消（低音一聲） */
function playCue(kind: 'start' | 'stop' | 'cancel') {
  try {
    const ctx = new AudioContext();
    const notes =
      kind === 'start' ? [660, 990] : kind === 'stop' ? [880, 587] : [330];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.07;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    });
    setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch {
    // 沒有音效也不影響功能
  }
}

/** 把錄到的 webm/opus 轉成 16kHz 單聲道 16-bit WAV（Gemini 支援 WAV，檔案也比較小） */
export async function blobToWav16kBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  decodeCtx.close().catch(() => {});

  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0);

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
