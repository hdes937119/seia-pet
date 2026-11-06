import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  Play,
  Square,
  RefreshCw,
  Eye,
  ImagePlus,
  Zap,
  Clock,
  XCircle,
} from 'lucide-react';
import { ScreenActivity, PersonalityConfig, MemoryKeyword, GeminiModelOption } from '../types';
import { getClientTime } from '../utils/clientTime';

const GAME_COOLDOWN_KEY = 'gemini_twin_cat_game_cooldown';
const isGamingActivity = (a: ScreenActivity | null) =>
  a?.category === 'gaming' || a?.appContext === 'gaming';

/**
 * 畫面變化偵測（借 dsh-see-now 的想法，程式自己寫）：
 * 每秒把畫面縮成 64×36 打一個「變化分數」（0～255，靜止畫面 0、滑鼠移動不到 1、換一張圖幾十分）。
 *  - 重大時刻：分數超過門檻，而且比「最近的平均」高很多 → 換地圖、Boss 出場、死掉…
 *    聲光很強的遊戲平均本來就高，一直閃不會被當成重大時刻；觸發後 3 秒內不重複算。
 *  - 慢慢變：小變化一直累加，超過一定量就存一格，慢慢走的畫面也不會漏。
 * 打遊戲時：冷卻到了，有重大時刻才搭話；一直沒有的話，等到「保底時間」才看一次。
 * 送圖：只拼有變化的那幾格（格數不固定），只有一個重大時刻時改送那一刻的完整大圖（場景模式）。
 */
const PACE_KEY = 'gemini_twin_cat_vision_pace';
type VisionPace = 'calm' | 'normal' | 'dense';
const PACE: Record<VisionPace, { cutAbs: number; spike: number; drift: number; fallbackMul: number; label: string }> = {
  calm: { cutAbs: 20, spike: 3, drift: 90, fallbackMul: 3, label: '安靜' },
  normal: { cutAbs: 12, spike: 2.5, drift: 60, fallbackMul: 2.5, label: '普通' },
  dense: { cutAbs: 7, spike: 2, drift: 36, fallbackMul: 1.5, label: '密集' },
};
const SAMPLE_MS = 1000;
const CUT_REFRACTORY_MS = 3000;
const WARMUP_SAMPLES = 4;
const MAX_KEPT = 9;
const SKIP_RETRY_MS = 30_000;

interface KeptFrame {
  canvas: HTMLCanvasElement;
  at: number;
  cut: boolean;
}

interface VisualPack {
  image: string;
  kind: 'grid' | 'scene';
  frames: number;
  note: string;
}

interface ScreenVisionTrackerProps {
  personality: PersonalityConfig;
  permanentMemories: MemoryKeyword[];
  onActivityDetected: (activity: ScreenActivity) => void;
  isAutoTracking: boolean;
  onToggleAutoTracking: (enabled: boolean) => void;
  interruptSignal?: number; // Increments whenever user interrupts or sends a chat message
  preferredModel?: GeminiModelOption;
}

export const ScreenVisionTracker: React.FC<ScreenVisionTrackerProps> = ({
  personality,
  permanentMemories,
  onActivityDetected,
  isAutoTracking,
  onToggleAutoTracking,
  interruptSignal = 0,
  preferredModel = 'gemini-3.1-pro-preview',
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastActivity, setLastActivity] = useState<ScreenActivity | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastUsedModel, setLastUsedModel] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  // Default minimum cooldown after first trigger: 300 seconds (5 minutes)
  const [cooldownSec, setCooldownSec] = useState<number>(300);
  // 打遊戲時當遊戲夥伴：聊得比較勤（預設 2 分鐘），可以另外設定
  const [gameCooldownSec, setGameCooldownSec] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(GAME_COOLDOWN_KEY)) || 120;
    } catch {
      return 120;
    }
  });
  const [isGamingNow, setIsGamingNow] = useState(false);
  const [pace, setPace] = useState<VisionPace>(() => {
    try {
      const v = localStorage.getItem(PACE_KEY);
      return v === 'calm' || v === 'dense' ? v : 'normal';
    } catch {
      return 'normal';
    }
  });
  const paceRef = useRef<VisionPace>(pace);
  useEffect(() => {
    paceRef.current = pace;
    try {
      localStorage.setItem(PACE_KEY, pace);
    } catch {
      // ignore
    }
  }, [pace]);
  const [waitingHighlight, setWaitingHighlight] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(GAME_COOLDOWN_KEY, String(gameCooldownSec));
    } catch {
      // ignore
    }
  }, [gameCooldownSec]);
  const [remainingCooldownSec, setRemainingCooldownSec] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAnalyzingRef = useRef(false);
  const lastAnalyzeTimeRef = useRef<number>(0);
  const hasDoneFirstTriggerRef = useRef<boolean>(false);
  const lastThumbPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const lastActivityRef = useRef<ScreenActivity | null>(null);
  const personalityRef = useRef<PersonalityConfig>(personality);
  const permanentMemoriesRef = useRef<MemoryKeyword[]>(permanentMemories);
  const onActivityDetectedRef = useRef(onActivityDetected);
  const preferredModelRef = useRef<GeminiModelOption>(preferredModel);
  const visionAbortRef = useRef<AbortController | null>(null);
  // 變化偵測（見檔案開頭的說明）：上一次取樣的小圖、最近的平均分數、存下來的格子
  const scoreCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevScorePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const baselineRef = useRef<number>(0);
  const sampleCountRef = useRef<number>(0);
  const driftAccRef = useRef<number>(0);
  const lastCutAtRef = useRef<number>(0);
  const keptRef = useRef<KeptFrame[]>([]);
  const lastCutFullRef = useRef<{ at: number; data: string } | null>(null);
  const retryAtRef = useRef<number>(0);
  // 用 ref 存串流，讓 onended 這類事件回呼永遠拿到最新的串流（避免抓到舊的 null）
  const streamRef = useRef<MediaStream | null>(null);
  const onToggleAutoTrackingRef = useRef(onToggleAutoTracking);

  useEffect(() => {
    onToggleAutoTrackingRef.current = onToggleAutoTracking;
  }, [onToggleAutoTracking]);

  useEffect(() => {
    personalityRef.current = personality;
  }, [personality]);

  useEffect(() => {
    permanentMemoriesRef.current = permanentMemories;
  }, [permanentMemories]);

  useEffect(() => {
    onActivityDetectedRef.current = onActivityDetected;
  }, [onActivityDetected]);

  useEffect(() => {
    preferredModelRef.current = preferredModel;
  }, [preferredModel]);

  // Immediately abort any in-flight vision analysis if the user interrupts or sends a chat message
  useEffect(() => {
    if (interruptSignal > 0 && visionAbortRef.current) {
      visionAbortRef.current.abort();
      visionAbortRef.current = null;
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
    }
  }, [interruptSignal]);

  const abortCurrentAnalysis = () => {
    if (visionAbortRef.current) {
      visionAbortRef.current.abort();
      visionAbortRef.current = null;
    }
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
  };

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const maxDim = 768;
    let width = vw;
    let height = vh;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.75);
  }, []);

  const resetChangeTracking = useCallback(() => {
    prevScorePixelsRef.current = null;
    baselineRef.current = 0;
    sampleCountRef.current = 0;
    driftAccRef.current = 0;
    lastCutAtRef.current = 0;
    keptRef.current = [];
    lastCutFullRef.current = null;
    retryAtRef.current = 0;
  }, []);

  /** 跟上一秒比，算畫面變化分數（0～255）；畫面還沒準備好回傳 null */
  const scoreFrame = useCallback((): number | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    if (!scoreCanvasRef.current) scoreCanvasRef.current = document.createElement('canvas');
    const c = scoreCanvasRef.current;
    const w = 64;
    const h = 36;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const cur = ctx.getImageData(0, 0, w, h).data;
    const prev = prevScorePixelsRef.current;
    prevScorePixelsRef.current = new Uint8ClampedArray(cur);
    if (!prev) return null;
    let sum = 0;
    for (let i = 0; i < cur.length; i += 4) {
      const dr = Math.abs(cur[i] - prev[i]);
      const dg = Math.abs(cur[i + 1] - prev[i + 1]);
      const db = Math.abs(cur[i + 2] - prev[i + 2]);
      const dy = Math.abs(0.299 * (cur[i] - prev[i]) + 0.587 * (cur[i + 1] - prev[i + 1]) + 0.114 * (cur[i + 2] - prev[i + 2]));
      // 亮度變化佔一半、顏色變化佔一半
      sum += 0.5 * dy + (dr + dg + db) / 6;
    }
    return sum / (w * h);
  }, []);

  /** 存一格（384 寬的小圖）；超過 9 格先丟最舊的「慢慢變」格子，重大時刻盡量留著 */
  const keepFrame = useCallback((cut: boolean) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const w = 384;
    const h = Math.round((video.videoHeight * w) / video.videoWidth);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const list = [...keptRef.current, { canvas: c, at: Date.now(), cut }];
    while (list.length > MAX_KEPT) {
      const i = list.findIndex((f) => !f.cut);
      list.splice(i >= 0 ? i : 0, 1);
    }
    keptRef.current = list;
  }, []);

  /** 把上次分析之後存下來的格子打包：3 格以上拼圖（格數不固定）；只有一個重大時刻就送那一刻的大圖 */
  const buildVisual = useCallback((): VisualPack | null => {
    const now = Date.now();
    const kept = keptRef.current;
    if (kept.length >= 3) {
      const n = kept.length;
      const cols = n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const cw = kept[0].canvas.width;
      const ch = kept[0].canvas.height;
      const canvas = document.createElement('canvas');
      canvas.width = cw * cols;
      canvas.height = ch * rows;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const notes: string[] = [];
      kept.forEach((f, i) => {
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * ch;
        ctx.drawImage(f.canvas, x, y, cw, ch);
        const ago = Math.max(0, Math.round((now - f.at) / 1000));
        const label = `${i + 1}${f.cut ? '★' : ''} ${ago}秒前`;
        ctx.font = 'bold 16px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = f.cut ? 'rgba(180,30,60,0.8)' : 'rgba(0,0,0,0.6)';
        ctx.fillRect(x + 4, y + 4, tw + 12, 22);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x + 10, y + 21);
        notes.push(`${i + 1}${f.cut ? '★' : ''}＝${ago}秒前`);
      });
      return { image: canvas.toDataURL('image/jpeg', 0.7), kind: 'grid', frames: n, note: notes.join('、') };
    }
    const full = lastCutFullRef.current;
    if (full) {
      const ago = Math.max(0, Math.round((now - full.at) / 1000));
      return { image: full.data, kind: 'scene', frames: 1, note: `${ago}秒前` };
    }
    return null;
  }, []);

  /** 分析成功後，把已經送出去的格子清掉（分析途中新存的留著） */
  const clearSentFrames = useCallback((sentAt: number) => {
    keptRef.current = keptRef.current.filter((f) => f.at > sentAt);
    if (lastCutFullRef.current && lastCutFullRef.current.at <= sentAt) lastCutFullRef.current = null;
  }, []);

  const computeFrameDiff = useCallback((updateReference: boolean = false): number => {
    if (!videoRef.current || !diffCanvasRef.current) return 0;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return 0;

    const w = 32;
    const h = 18;
    const canvas = diffCanvasRef.current;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    ctx.drawImage(video, 0, 0, w, h);
    const currentPixels = ctx.getImageData(0, 0, w, h).data;

    if (!lastThumbPixelsRef.current) {
      if (updateReference) {
        lastThumbPixelsRef.current = new Uint8ClampedArray(currentPixels);
      }
      return 100;
    }

    const prevPixels = lastThumbPixelsRef.current;
    let totalDiff = 0;
    const pixelCount = w * h;

    for (let i = 0; i < currentPixels.length; i += 4) {
      const rDiff = Math.abs(currentPixels[i] - prevPixels[i]);
      const gDiff = Math.abs(currentPixels[i + 1] - prevPixels[i + 1]);
      const bDiff = Math.abs(currentPixels[i + 2] - prevPixels[i + 2]);
      if (rDiff + gDiff + bDiff > 45) {
        totalDiff++;
      }
    }

    if (updateReference) {
      lastThumbPixelsRef.current = new Uint8ClampedArray(currentPixels);
    }

    return Math.round((totalDiff / pixelCount) * 100);
  }, []);

  // Send screenshot to backend Gemini Vision API
  const analyzeScreenshot = useCallback(
    async (
      base64Img: string,
      opts: { scenarioHint?: string; visual?: VisualPack | null; manual?: boolean } = {}
    ) => {
      const { scenarioHint, visual, manual = false } = opts;
      const sentAt = Date.now();
      const prevAnalyzeTime = lastAnalyzeTimeRef.current;
      const wasFirst = !hasDoneFirstTriggerRef.current;
      if (visionAbortRef.current) {
        visionAbortRef.current.abort();
      }
      const controller = new AbortController();
      visionAbortRef.current = controller;

      isAnalyzingRef.current = true;
      setIsAnalyzing(true);
      setStatusNotice(null);
      lastAnalyzeTimeRef.current = Date.now();
      hasDoneFirstTriggerRef.current = true;
      computeFrameDiff(true);

      const t0 = Date.now();
      try {
        const res = await fetch('/api/vision-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            screenshot: base64Img,
            personality: personalityRef.current,
            permanentMemories: permanentMemoriesRef.current,
            recentActivity: lastActivityRef.current?.title,
            recentObservation: lastActivityRef.current?.observation,
            scenarioHint,
            mosaic: visual?.image || undefined,
            mosaicKind: visual?.kind,
            mosaicFrames: visual?.frames,
            mosaicNote: visual?.note,
            manual,
            preferredModel: preferredModelRef.current,
            clientTime: getClientTime(),
          }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        // 後端說先不說（她在忙、主人剛講完話…）：沒花 Gemini 額度，30 秒後再試，存下來的格子留著
        if (data.skipped) {
          lastAnalyzeTimeRef.current = prevAnalyzeTime;
          if (wasFirst) hasDoneFirstTriggerRef.current = false;
          retryAtRef.current = Date.now() + SKIP_RETRY_MS;
          setStatusNotice(`她先不搭話：${data.reason || '時機不對'}`);
          return;
        }
        clearSentFrames(sentAt);

        const elapsed = data.latencyMs || Date.now() - t0;
        setLastLatencyMs(elapsed);
        if (data.usedModel) {
          setLastUsedModel(data.usedModel);
        }

        const activity: ScreenActivity = {
          category: data.activityCategory || 'video',
          appContext: data.appContext,
          title: data.activityTitle || '螢幕畫面分析',
          observation: data.observation || '已識別當前畫面細節',
          catComment: data.catComment,
          timestamp: new Date().toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          screenshotUrl: base64Img,
          capturedAt: t0,
          usedModel: data.usedModel,
        };

        lastActivityRef.current = activity;
        setLastActivity(activity);
        setIsGamingNow(isGamingActivity(activity));
        onActivityDetectedRef.current(activity);
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // User interrupted analysis cleanly
          return;
        }
        console.warn('Vision API error:', err);
        setStatusNotice(`Gemini 視覺分析提示：${err?.message || '請稍後重試'}`);
      } finally {
        if (visionAbortRef.current === controller) {
          visionAbortRef.current = null;
          isAnalyzingRef.current = false;
          setIsAnalyzing(false);
        }
      }
    },
    [computeFrameDiff, clearSentFrames]
  );

  // 自動觸發規則：
  // 1. 開始共享後，畫面一就緒就先看一次
  // 2. 之後每秒打變化分數、存格子；冷卻時間（一般 5 分鐘／遊戲 2 分鐘）是最快的頻率，不會更勤
  //    - 一般畫面：冷卻到了、而且跟上次看的時候差 10% 以上才看
  //    - 打遊戲：冷卻到了、這段時間有重大時刻才看；一直沒有就等到保底時間（冷卻 × 節奏倍數）
  useEffect(() => {
    if (!stream || !isAutoTracking) {
      setRemainingCooldownSec(0);
      setWaitingHighlight(false);
      return;
    }

    const monitorTimer = setInterval(() => {
      const now = Date.now();
      const p = PACE[paceRef.current];

      // 每秒打分數（分析中也照打，才不會漏掉畫面）
      const score = scoreFrame();
      if (score !== null) {
        sampleCountRef.current++;
        const base = baselineRef.current;
        const warmedUp = sampleCountRef.current > WARMUP_SAMPLES;
        const isCut =
          warmedUp &&
          score >= p.cutAbs &&
          score >= base * p.spike + 2 &&
          now - lastCutAtRef.current >= CUT_REFRACTORY_MS;
        // 最近的平均（突然的大跳動只算一部分，免得一次換場就把平均拉太高）
        baselineRef.current = sampleCountRef.current === 1 ? score : base * 0.9 + Math.min(score, base * 3 + 10) * 0.1;
        if (isCut) {
          lastCutAtRef.current = now;
          driftAccRef.current = 0;
          keepFrame(true);
          const full = captureFrame();
          if (full) lastCutFullRef.current = { at: now, data: full };
        } else {
          driftAccRef.current += score;
          if (driftAccRef.current >= p.drift) {
            driftAccRef.current = 0;
            keepFrame(false);
          }
        }
      }

      if (isAnalyzingRef.current) return;
      if (now < retryAtRef.current) return;

      const gaming = isGamingActivity(lastActivityRef.current);
      const effectiveCooldown = gaming ? gameCooldownSec : cooldownSec;
      const elapsedSec = Math.floor((now - lastAnalyzeTimeRef.current) / 1000);
      const remaining = Math.max(0, effectiveCooldown - elapsedSec);
      setRemainingCooldownSec(remaining);

      // First time after sharing starts: trigger immediately once video frames are ready
      if (!hasDoneFirstTriggerRef.current) {
        setWaitingHighlight(false);
        const frame = captureFrame();
        if (frame) {
          analyzeScreenshot(frame);
        }
        return;
      }

      if (elapsedSec < effectiveCooldown) {
        setWaitingHighlight(false);
        return;
      }

      if (gaming) {
        const hasHighlight = keptRef.current.some((f) => f.cut);
        const fallbackSec = Math.round(effectiveCooldown * p.fallbackMul);
        const due = elapsedSec >= fallbackSec && keptRef.current.length > 0;
        if (!hasHighlight && !due) {
          setWaitingHighlight(true);
          setRemainingCooldownSec(Math.max(0, fallbackSec - elapsedSec));
          return;
        }
        setWaitingHighlight(false);
        const frame = captureFrame();
        if (frame) analyzeScreenshot(frame, { visual: buildVisual() });
        return;
      }

      setWaitingHighlight(false);
      const diff = computeFrameDiff(false);
      if (diff >= 10) {
        const frame = captureFrame();
        if (frame) analyzeScreenshot(frame);
      }
    }, SAMPLE_MS);

    return () => clearInterval(monitorTimer);
  }, [stream, isAutoTracking, cooldownSec, gameCooldownSec, computeFrameDiff, captureFrame, analyzeScreenshot, scoreFrame, keepFrame, buildVisual]);

  // Listen for global Ctrl+V image paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                analyzeScreenshot(reader.result, { manual: true });
              }
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [analyzeScreenshot]);

  const handleManualCapture = () => {
    if (!stream) {
      setStatusNotice('請先點擊「授權螢幕共享」或使用「貼上/傳圖」喵～');
      return;
    }
    const frame = captureFrame();
    if (frame) {
      analyzeScreenshot(frame, { manual: true });
    }
  };

  // Start real screen sharing (the monitor interval triggers the first analysis within ~2s)
  const startScreenShare = async () => {
    setStatusNotice(null);
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.getScreenId) {
      setStatusNotice('螢幕共享只能在桌寵（Electron）視窗裡使用；瀏覽器裡可以用「貼上/傳圖」喵～');
      return;
    }
    try {
      // 1. 透過橋樑向作業系統索取主螢幕 ID
      const sourceId = await electronAPI.getScreenId();
      if (!sourceId) throw new Error('找不到可擷取的螢幕');

      // 2. 改用 getUserMedia，並指定 desktop 來源 (完全繞過內嵌視窗限制)
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          }
        } as any
      });

      hasDoneFirstTriggerRef.current = false;
      lastThumbPixelsRef.current = null;
      resetChangeTracking();
      streamRef.current = mediaStream;
      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => { });
      }

      mediaStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      // 首次分析交給下方的監控 interval（畫面就緒後立即觸發），不再另外 setTimeout，避免重複呼叫 API
      onToggleAutoTracking(true);
    } catch (err: any) {
      console.warn('Screen share aborted or blocked:', err);
      setStatusNotice('無法取得螢幕權限，請確認系統設定');
    }
  };

  // 只讀 ref，所以從任何舊的閉包（例如 track.onended）呼叫都能正確清乾淨
  const stopScreenShare = () => {
    abortCurrentAnalysis();
    const current = streamRef.current;
    if (current) {
      current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    }
    streamRef.current = null;
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    hasDoneFirstTriggerRef.current = false;
    lastThumbPixelsRef.current = null;
    resetChangeTracking();
    setRemainingCooldownSec(0);
    onToggleAutoTrackingRef.current(false);
  };

  // 元件卸載時（例如收起側邊面板）停止串流，避免背景一直佔用螢幕擷取
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        onToggleAutoTrackingRef.current(false);
      }
    };
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        analyzeScreenshot(reader.result, { manual: true });
      }
    };
    reader.readAsDataURL(file);
  };

  const formatCooldown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}分${s < 10 ? '0' : ''}${s}秒`;
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-slate-200 backdrop-blur-md">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={diffCanvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-purple-400" />
          <h3 className="font-semibold text-slate-100 text-sm">螢幕即時工作追蹤 (Screen Vision)</h3>
          {lastLatencyMs !== null && (
            <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/40">
              <Zap className="w-2.5 h-2.5" /> {(lastLatencyMs / 1000).toFixed(1)}s
              {lastUsedModel ? ` · ${lastUsedModel}` : ''}
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {isAnalyzing && (
            <button
              onClick={abortCurrentAnalysis}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-all shadow-sm"
              title="立即打斷畫面分析"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>打斷分析</span>
            </button>
          )}

          {stream ? (
            <button
              onClick={stopScreenShare}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-600/90 hover:bg-rose-500 text-white transition-all shadow-sm"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>停止共享</span>
            </button>
          ) : (
            <button
              onClick={startScreenShare}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition-all shadow-md"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>授權螢幕共享</span>
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
            title="上傳螢幕截圖或直接按 Ctrl+V 貼上截圖"
          >
            <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
            <span>貼上/傳圖</span>
          </button>

          {stream && (
            <button
              onClick={handleManualCapture}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-sm"
              title="手動立即讓貓貓看一眼當前畫面（不受5分鐘冷卻限制）"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>立即看畫面</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Video Stream Monitor & 5-Minute Cooldown Indicator */}
      <div
        className={`mb-3 rounded-xl border border-indigo-500/30 bg-slate-950/80 p-2.5 ${stream ? 'block' : 'fixed -top-96 -left-96 w-4 h-4 opacity-0 pointer-events-none'
          }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-semibold text-emerald-300">首次切換已主動觸發</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-amber-300 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {waitingHighlight
                ? `🎮 等精彩時刻（最久再 ${formatCooldown(remainingCooldownSec)}）`
                : remainingCooldownSec > 0
                ? `下次自動觸發冷卻: ${formatCooldown(remainingCooldownSec)}`
                : '已就緒（偵測到換片即自動觸發）'}
            </span>
            <select
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200"
              title="一般畫面（看影片、工作…）多久最多聊一次"
            >
              <option value={300}>一般：每 5 分鐘</option>
              <option value={600}>一般：每 10 分鐘</option>
              <option value={900}>一般：每 15 分鐘</option>
            </select>
            <select
              value={gameCooldownSec}
              onChange={(e) => setGameCooldownSec(Number(e.target.value))}
              className={`border rounded px-1.5 py-0.5 text-[10px] ${
                isGamingNow ? 'bg-rose-950/70 border-rose-500/60 text-rose-100' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
              title="打遊戲時當遊戲夥伴，多久最多聊一次遊戲內容（越短越熱鬧，也越耗 Gemini 額度）"
            >
              <option value={60}>🎮 遊戲：每 1 分鐘</option>
              <option value={120}>🎮 遊戲：每 2 分鐘</option>
              <option value={300}>🎮 遊戲：每 5 分鐘</option>
            </select>
            <select
              value={pace}
              onChange={(e) => setPace(e.target.value as VisionPace)}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200"
              title="打遊戲時，畫面要變多大才算「精彩時刻」：安靜＝只有大事才講、密集＝小事也講。沒有精彩時刻時，最久等冷卻時間的 3／2.5／1.5 倍才看一次"
            >
              {(Object.keys(PACE) as VisionPace[]).map((k) => (
                <option key={k} value={k}>
                  節奏：{PACE[k].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-28 object-contain rounded-lg bg-black border border-slate-800"
        />
      </div>

      {statusNotice && (
        <p className="text-xs text-amber-300 mb-2.5 font-medium bg-amber-950/40 border border-amber-800/40 p-2 rounded-lg">
          💡 {statusNotice}
        </p>
      )}

      {/* Status & Current Detected Activity */}
      {lastActivity ? (
        <div className="bg-slate-950/70 border border-purple-900/40 rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-purple-300">{lastActivity.title}</span>
              <span className="text-slate-500">· {lastActivity.category}</span>
            </div>
            <span className="font-mono text-[11px]">{lastActivity.timestamp}</span>
          </div>

          <div className="flex gap-3 items-start">
            {lastActivity.screenshotUrl && (
              <img
                src={lastActivity.screenshotUrl}
                alt="畫面截圖"
                className="w-20 h-12 object-cover rounded border border-slate-700 shrink-0 mt-0.5"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 mb-1">
                🔍 畫面識別：{lastActivity.observation}
              </p>
              <p className="text-xs font-medium text-pink-200 bg-purple-950/50 border border-pink-500/30 px-2.5 py-1.5 rounded-lg leading-relaxed">
                ✦ 雙子星貓：「{lastActivity.catComment}」
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-400 bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              按「授權螢幕共享」開始；換畫面時她會看一眼，不會一直打擾。
            </span>
          </div>
        </div>
      )}

    </div>
  );
};
