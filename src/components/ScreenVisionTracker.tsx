import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  Play,
  Square,
  RefreshCw,
  Eye,
  Sparkles,
  Gamepad2,
  Tv,
  MessageSquare,
  Code2,
  ImagePlus,
  Zap,
  Clock,
  XCircle,
} from 'lucide-react';
import { ScreenActivity, PersonalityConfig, MemoryKeyword, GeminiModelOption } from '../types';

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
  const sampleCounterRef = useRef(0);
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
    async (base64Img: string, scenarioHint?: string) => {
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
            preferredModel: preferredModelRef.current,
          }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        const elapsed = data.latencyMs || Date.now() - t0;
        setLastLatencyMs(elapsed);
        if (data.usedModel) {
          setLastUsedModel(data.usedModel);
        }

        const activity: ScreenActivity = {
          category: data.activityCategory || 'video',
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
    [computeFrameDiff]
  );

  // Cooldown timer & Auto-trigger rule:
  // 1. Triggers immediately on the first switch/start (hasDoneFirstTriggerRef === false)
  // 2. Afterwards, strictly enforces at least `cooldownSec` (default 300s = 5 minutes) before the next automatic trigger!
  useEffect(() => {
    if (!stream || !isAutoTracking) {
      setRemainingCooldownSec(0);
      return;
    }

    const monitorTimer = setInterval(() => {
      if (isAnalyzingRef.current) return;

      const elapsedSec = Math.floor((Date.now() - lastAnalyzeTimeRef.current) / 1000);
      const remaining = Math.max(0, cooldownSec - elapsedSec);
      setRemainingCooldownSec(remaining);

      // First time after sharing starts: trigger immediately once video frames are ready
      if (!hasDoneFirstTriggerRef.current) {
        const frame = captureFrame();
        if (frame) {
          analyzeScreenshot(frame);
        }
        return;
      }

      // Subsequent triggers: ONLY after minimum 5 minutes (cooldownSec) has elapsed AND screen changed
      if (elapsedSec >= cooldownSec) {
        const diff = computeFrameDiff(false);
        if (diff >= 10) {
          const frame = captureFrame();
          if (frame) {
            analyzeScreenshot(frame);
          }
        }
      }
    }, 2000);

    return () => clearInterval(monitorTimer);
  }, [stream, isAutoTracking, cooldownSec, computeFrameDiff, captureFrame, analyzeScreenshot]);

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
                analyzeScreenshot(reader.result);
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
      analyzeScreenshot(frame);
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
        analyzeScreenshot(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const simulateScenario = (type: 'gaming' | 'video' | 'chatting' | 'coding') => {
    sampleCounterRef.current += 1;
    const idx = sampleCounterRef.current % 3;

    const canvas = document.createElement('canvas');
    canvas.width = 560;
    canvas.height = 315;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const videoSamples = [
      {
        bg: '#1e1b4b',
        title: '📺 Bilibili: 【孤獨搖滾】小孤獨在武道館神級吉他獨奏！',
        sub: '字幕：「後藤一里這段滑音太燃了！全場沸騰！」 · 觀看人數 12.5萬',
      },
      {
        bg: '#31102f',
        title: '📺 YouTube: 【美食探店】日本東京深夜排隊博多濃郁豚骨拉麵',
        sub: '字幕：「這塊炙燒叉燒入口即化，半熟溏心蛋太犯規了！」',
      },
      {
        bg: '#0c2d48',
        title: '📺 Netflix 動畫: 《葬送的芙莉蓮》芙莉蓮掉進寶箱怪被咬頭',
        sub: '字幕：「好黑喔！快拉我出來～這裡面有99%是魔導書！」',
      },
    ];

    const gamingSamples = [
      {
        bg: '#0f172a',
        title: '🎮 Steam: 《黑神話：悟空》二郎神楊戩最終決戰',
        sub: '畫面：玩家僅剩 8% 血量，葫蘆已喝光，二郎神正在開天眼放萬劍歸宗！',
      },
      {
        bg: '#1f122b',
        title: '🎮 《艾爾登法環》女武神瑪蓮妮亞：水鳥亂舞發動！',
        sub: '畫面：螢幕中央大字「YOU DIED (落命)」· 已經連續挑戰第 38 次',
      },
      {
        bg: '#082f49',
        title: '🎮 《英雄聯盟 LoL》大龍團戰五殺 Penta Kill 瞬間',
        sub: '畫面：隊友瘋狂打問號 Ping 燈 · 敵方水晶主堡即將爆炸！',
      },
    ];

    const chatSamples = [
      {
        bg: '#064e3b',
        title: '💬 LINE 聊天視窗：老闆半夜傳訊「明天早上順便交簡報」',
        sub: '對方訊息：「這份企劃小改一下很快吧？」 · 輸入框：「收到...」',
      },
      {
        bg: '#134e4a',
        title: '💬 LINE 死黨群組：週末要去吃麻辣火鍋還是燒肉？',
        sub: '阿明：「我投和牛燒肉一票！」 · 未讀訊息 18 則',
      },
      {
        bg: '#1e293b',
        title: '💬 Discord 遊戲語音群：今晚八點五排缺一！快上線！',
        sub: '頻道狀態：4 人已在語音房等待主人加入',
      },
    ];

    const codingSamples = [
      {
        bg: '#18181b',
        title: '💻 VS Code: 正在調試 Gemini AI 雙子星貓視覺神經網路',
        sub: 'Terminal: TypeError: Cannot read properties of undefined (reading "nya")',
      },
      {
        bg: '#090d16',
        title: '💻 GitHub Pull Request: 準備合併 1,240 行重構程式碼',
        sub: '狀態：All checks have passed · 等待部署上線',
      },
      {
        bg: '#1e1e2e',
        title: '💻 LeetCode Hard 演算法題：動態規劃解不出來卡關中',
        sub: '執行結果：Time Limit Exceeded (TLE) · 已思考 45 分鐘',
      },
    ];

    const pool =
      type === 'video'
        ? videoSamples
        : type === 'gaming'
          ? gamingSamples
          : type === 'chatting'
            ? chatSamples
            : codingSamples;

    const sample = pool[idx];

    ctx.fillStyle = sample.bg;
    ctx.fillRect(0, 0, 560, 315);
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 540, 295);

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(sample.title, 26, 95);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.fillText(sample.sub, 26, 155);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(`Frame Timestamp: ${new Date().toLocaleTimeString()}`, 26, 250);

    const mockImg = canvas.toDataURL('image/jpeg', 0.8);
    analyzeScreenshot(mockImg, `${sample.title} - ${sample.sub}`);
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
              {remainingCooldownSec > 0
                ? `下次自動觸發冷卻: ${formatCooldown(remainingCooldownSec)}`
                : '已就緒（偵測到換片即自動觸發）'}
            </span>
            <select
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200"
            >
              <option value={300}>最短每 5 分鐘觸發</option>
              <option value={600}>最短每 10 分鐘觸發</option>
              <option value={900}>最短每 15 分鐘觸發</option>
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
              點擊「授權螢幕共享」：第一次切換時會立即主動吐槽，之後最短每 5 分鐘才自動觸發一次，不頻繁打擾！
            </span>
          </div>
        </div>
      )}

      {/* Dynamic Multi-Video / Multi-Game Test Buttons */}
      <div className="pt-2 border-t border-slate-800/70">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            手動切換場景測試（點擊立即觸發一次 Gemini 視覺分析）：
          </span>
          {isAnalyzing && (
            <span className="text-[11px] text-pink-300 font-semibold animate-pulse">
              ⚡ Gemini 正在分析畫面（隨時可在右側輸入打斷）...
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => simulateScenario('video')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-amber-200 transition-colors border border-amber-500/30"
          >
            <Tv className="w-3.5 h-3.5 text-amber-400" />
            <span>切換不同影片</span>
          </button>
          <button
            onClick={() => simulateScenario('gaming')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-rose-200 transition-colors border border-rose-500/30"
          >
            <Gamepad2 className="w-3.5 h-3.5 text-rose-400" />
            <span>切換不同遊戲</span>
          </button>
          <button
            onClick={() => simulateScenario('chatting')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-emerald-200 transition-colors border border-emerald-500/30"
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
            <span>切換不同 LINE</span>
          </button>
          <button
            onClick={() => simulateScenario('coding')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-sky-200 transition-colors border border-sky-500/30"
          >
            <Code2 className="w-3.5 h-3.5 text-sky-400" />
            <span>切換不同工作</span>
          </button>
        </div>
      </div>
    </div>
  );
};
