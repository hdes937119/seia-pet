import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Maximize2, Minimize2, Music2, Pause, Play, Search, SkipBack, SkipForward, Square, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { MusicPlayerApi } from '../hooks/useMusicPlayer';

/**
 * 迷你音樂播放器：浮在立繪左邊。
 * 有在放歌、或從右鍵選單打開時才顯示；隱藏時 iframe 仍保留（只是看不到），不會中斷播放器。
 * 可以縮成一條小橫條（記住上次的狀態）。縮小時影片還是留一個小畫面：
 * YouTube 規定不能把影片藏起來只放聲音，所以不會整個隱藏。
 */

const MINIMIZED_KEY = 'gemini_twin_cat_music_minimized';

function readMinimized(): boolean {
  try {
    return localStorage.getItem(MINIMIZED_KEY) === '1';
  } catch {
    return false;
  }
}

interface MusicPlayerProps {
  music: MusicPlayerApi;
  open: boolean; // 從右鍵選單打開（還沒放歌也顯示，可以自己搜）
  onClose: () => void;
}

const fmt = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

/** YouTube 帳號登入狀態（只有 Electron 桌寵有；一般瀏覽器回傳 canLogin = false） */
function useYouTubeAccount(onChanged: () => void) {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const canLogin = Boolean(api?.youtubeLogin);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const prevRef = useRef<boolean | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!canLogin) return;
    let alive = true;
    const apply = (v: boolean) => {
      if (!alive) return;
      // 登入狀態真的變了（不是第一次讀取）→ 重建播放器套用新帳號
      if (prevRef.current !== null && prevRef.current !== v) onChangedRef.current();
      prevRef.current = v;
      setLoggedIn(v);
    };
    api.getYouTubeLoginStatus?.().then((v: boolean) => apply(Boolean(v))).catch(() => undefined);
    const off = api.onYouTubeLoginChanged?.((v: boolean) => apply(Boolean(v)));
    return () => {
      alive = false;
      off?.();
    };
  }, [api, canLogin]);

  return {
    canLogin,
    loggedIn,
    login: () => api?.youtubeLogin?.(),
    logout: () => api?.youtubeLogout?.(),
  };
}

export const MusicPlayer: React.FC<MusicPlayerProps> = ({ music, open, onClose }) => {
  const { state, track } = music;
  const [query, setQuery] = useState('');
  const yt = useYouTubeAccount(music.resetPlayer);
  const [minimized, setMinimized] = useState(readMinimized);
  const toggleMinimized = () =>
    setMinimized((m) => {
      try {
        localStorage.setItem(MINIMIZED_KEY, m ? '0' : '1');
      } catch {
        // ignore
      }
      return !m;
    });
  const active = state.status !== 'idle';
  const visible = open || active;
  const VolIcon = state.volume === 0 ? VolumeX : state.volume < 50 ? Volume1 : Volume2;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) void music.play(query);
  };

  const miniBtn =
    'w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-slate-200 hover:bg-purple-600/60 disabled:opacity-40 disabled:hover:bg-transparent';
  const btn =
    'w-7 h-7 rounded-full flex items-center justify-center text-slate-200 hover:bg-purple-600/60 disabled:opacity-40 disabled:hover:bg-transparent';

  const showVideo = active && (track || state.status === 'loading');

  return (
    <div
      className={`absolute z-30 left-2 bottom-2 bg-slate-950/90 border border-purple-400/40 shadow-2xl backdrop-blur-md overflow-hidden transition-opacity duration-200 ${
        minimized
          ? 'flex items-center gap-1 rounded-xl w-[min(230px,calc(100%-var(--pet-w)-24px))] p-1'
          : 'rounded-2xl w-[min(230px,calc(100%-var(--pet-w)-24px))]'
      } ${visible ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'}`}
    >
      {/* 標題列（展開時） */}
      {!minimized && (
        <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] text-purple-200">
          <Music2 className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold flex-1">貓貓點唱機</span>
          <button
            type="button"
            title="縮小"
            onClick={toggleMinimized}
            className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-slate-700"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            title="關掉音樂並收起"
            onClick={() => {
              music.stop();
              onClose();
            }}
            className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-slate-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* YouTube 影片：展開時是正常大小，縮小時是一個小畫面（同一個元素，切換時不會中斷播放） */}
      <div
        className={`relative rounded-lg overflow-hidden bg-black shrink-0 ${
          minimized ? (showVideo ? 'w-16 aspect-video' : 'w-0 h-0') : `mx-2 ${showVideo ? 'aspect-video' : 'h-0'}`
        }`}
      >
        <div ref={music.hostRef} className="absolute inset-0" />
        {state.status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] text-slate-200 gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" />
            {!minimized && ' 找歌中…'}
          </div>
        )}
      </div>

      {/* 縮小時：歌名 + 播放 / 下一首 + 展開 */}
      {minimized && (
        <>
          <div className="flex-1 min-w-0 px-1">
            <p className="text-[10px] font-semibold text-slate-100 truncate" title={track?.title}>
              {track && active ? track.title : '貓貓點唱機'}
            </p>
            <p className="text-[9px] text-slate-400 truncate">
              {state.message || (track && active ? track.author : '展開來點歌')}
            </p>
          </div>
          {active && (
            <>
              <button type="button" title={state.status === 'playing' ? '暫停' : '播放'} className={miniBtn} onClick={music.toggle}>
                {state.status === 'playing' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                title="下一首"
                className={miniBtn}
                onClick={music.next}
                disabled={state.index >= state.queue.length - 1}
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button type="button" title="展開" className={miniBtn} onClick={toggleMinimized}>
            <Maximize2 className="w-3 h-3" />
          </button>
        </>
      )}

      {/* 歌名 */}
      {!minimized && track && active && (
        <div className="px-2.5 pt-1.5">
          <p className="text-[11px] font-semibold text-slate-100 leading-snug line-clamp-2" title={track.title}>
            {track.title}
          </p>
          <p className="text-[10px] text-slate-400 truncate">
            {track.author} · {fmt(track.seconds)} · {state.index + 1}/{state.queue.length}
          </p>
        </div>
      )}

      {/* 控制鈕 + 音量 */}
      {!minimized && active && (
        <div className="flex items-center gap-0.5 px-1.5 pt-1">
          <button type="button" title="上一首" className={btn} onClick={music.previous} disabled={state.index === 0}>
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button type="button" title={state.status === 'playing' ? '暫停' : '播放'} className={btn} onClick={music.toggle}>
            {state.status === 'playing' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            type="button"
            title="下一首"
            className={btn}
            onClick={music.next}
            disabled={state.index >= state.queue.length - 1}
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          <button type="button" title="停止" className={btn} onClick={music.stop}>
            <Square className="w-3 h-3" />
          </button>
          <VolIcon className="w-3.5 h-3.5 ml-1 text-slate-400 shrink-0" />
          <input
            type="range"
            min={0}
            max={100}
            value={state.volume}
            onChange={(e) => music.setVolume(Number(e.target.value))}
            title={`音量 ${state.volume}`}
            className="flex-1 min-w-0 h-1 accent-purple-400"
          />
        </div>
      )}

      {/* 搜尋 */}
      {!minimized && (
        <form onSubmit={submit} className="flex items-center gap-1 px-2 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={active ? '換別首…' : '想聽什麼？例如 lofi'}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-purple-400"
          />
          <button type="submit" title="搜尋並播放" className={btn} disabled={!query.trim()}>
            <Search className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {!minimized && state.message && <p className="px-2.5 pb-2 -mt-1 text-[10px] text-amber-300">{state.message}</p>}
      {!minimized && !active && !state.message && (
        <p className="px-2.5 pb-2 -mt-1 text-[10px] text-slate-500">也可以直接跟貓貓說「放點 lofi」「下一首」「小聲一點」</p>
      )}

      {/* YouTube 帳號：登入後用主人的帳號播放（Premium 免廣告、記在播放紀錄） */}
      {!minimized && yt.canLogin && yt.loggedIn !== null && (
        <div className="flex items-center gap-1 px-2.5 pb-2 text-[10px] text-slate-400 border-t border-slate-800 pt-1.5">
          <span className="flex-1 truncate">{yt.loggedIn ? 'YouTube：用你的帳號播放' : 'YouTube：未登入（訪客播放）'}</span>
          <button
            type="button"
            onClick={() => (yt.loggedIn ? yt.logout() : yt.login())}
            className="text-purple-300 hover:text-purple-100 hover:underline shrink-0"
          >
            {yt.loggedIn ? '登出' : '登入'}
          </button>
        </div>
      )}
    </div>
  );
};
