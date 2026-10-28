import React, { useState } from 'react';
import { Loader2, Music2, Pause, Play, Search, SkipBack, SkipForward, Square, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { MusicPlayerApi } from '../hooks/useMusicPlayer';

/**
 * 迷你音樂播放器：浮在立繪左邊。
 * 有在放歌、或從右鍵選單打開時才顯示；隱藏時 iframe 仍保留（只是看不到），不會中斷播放器。
 */

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

export const MusicPlayer: React.FC<MusicPlayerProps> = ({ music, open, onClose }) => {
  const { state, track } = music;
  const [query, setQuery] = useState('');
  const active = state.status !== 'idle';
  const visible = open || active;
  const VolIcon = state.volume === 0 ? VolumeX : state.volume < 50 ? Volume1 : Volume2;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) void music.play(query);
  };

  const btn =
    'w-7 h-7 rounded-full flex items-center justify-center text-slate-200 hover:bg-purple-600/60 disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div
      className={`absolute z-30 left-2 bottom-2 w-[min(230px,calc(100%-var(--pet-w)-24px))] rounded-2xl bg-slate-950/90 border border-purple-400/40 shadow-2xl backdrop-blur-md overflow-hidden transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'
      }`}
    >
      {/* 標題列 */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] text-purple-200">
        <Music2 className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold flex-1">貓貓點唱機</span>
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

      {/* YouTube 影片（官方規定播放器要看得到，所以保留小畫面） */}
      <div
        className={`relative mx-2 rounded-lg overflow-hidden bg-black ${
          active && (track || state.status === 'loading') ? 'aspect-video' : 'h-0'
        }`}
      >
        <div ref={music.hostRef} className="absolute inset-0" />
        {state.status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] text-slate-200 gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" /> 找歌中…
          </div>
        )}
      </div>

      {/* 歌名 */}
      {track && active && (
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
      {active && (
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

      {state.message && <p className="px-2.5 pb-2 -mt-1 text-[10px] text-amber-300">{state.message}</p>}
      {!active && !state.message && (
        <p className="px-2.5 pb-2 -mt-1 text-[10px] text-slate-500">也可以直接跟貓貓說「放點 lofi」「下一首」「小聲一點」</p>
      )}
    </div>
  );
};
