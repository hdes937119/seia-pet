import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 內建 YouTube 音樂播放器（YouTube IFrame Player API）。
 *
 *  - play(query)：到後端 /api/music/search 搜歌，排成播放清單從第一首開始放
 *  - 有些影片不允許嵌入播放（錯誤 101 / 150）→ 自動跳下一首
 *  - duck = true（她在說話、或主人在語音輸入）時，音樂自動轉小聲，講完再慢慢回來
 *  - 聊天回覆裡的 <!--MUSIC:{...}--> 指令由 App 轉成 command() 呼叫
 */

export interface MusicTrack {
  videoId: string;
  title: string;
  author: string;
  seconds: number;
  thumbnail: string;
}

export type MusicStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface MusicCommand {
  action: 'play' | 'pause' | 'resume' | 'next' | 'previous' | 'stop' | 'volume';
  query?: string;
  volume?: number;
}

export interface MusicPlayerState {
  status: MusicStatus;
  query: string;
  queue: MusicTrack[];
  index: number;
  volume: number; // 0 ~ 100
  message: string; // 給畫面顯示的提示（找不到歌、播放失敗…）
}

const VOLUME_KEY = 'gemini_twin_cat_music_volume';
const DUCK_RATIO = 0.25; // 說話時音樂剩 25% 音量
const DUCK_RELEASE_MS = 700; // 講完後等一下再把音量拉回來（句子之間的空檔不要忽大忽小）

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;

function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      ytApiPromise = null;
      reject(new Error('YouTube 播放器載入失敗，檢查一下網路'));
    };
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 60;
  } catch {
    return 60;
  }
}

export function useMusicPlayer({ duck }: { duck: boolean }) {
  const [state, setState] = useState<MusicPlayerState>(() => ({
    status: 'idle',
    query: '',
    queue: [],
    index: 0,
    volume: readVolume(),
    message: '',
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const playerReady = useRef<Promise<any> | null>(null);
  const duckRef = useRef(false);
  const failStreak = useRef(0);
  const searchToken = useRef(0);

  const patch = useCallback((p: Partial<MusicPlayerState>) => setState((s) => ({ ...s, ...p })), []);

  const effectiveVolume = useCallback(
    (v = stateRef.current.volume) => Math.round(duckRef.current ? v * DUCK_RATIO : v),
    []
  );

  // 第一次要播的時候才建立播放器（iframe 掛在 hostRef 裡）
  const ensurePlayer = useCallback((): Promise<any> => {
    if (playerReady.current) return playerReady.current;
    playerReady.current = loadYouTubeApi()
      .then(
        (YT) =>
          new Promise((resolve, reject) => {
            const host = hostRef.current;
            if (!host) return reject(new Error('播放器還沒準備好'));
            // YT.Player 會把傳進去的元素整個換成 iframe → 給它一個 React 不管的子元素
            const mount = document.createElement('div');
            host.replaceChildren(mount);
            const player = new YT.Player(mount, {
              width: '100%',
              height: '100%',
              playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
              events: {
                onReady: () => {
                  playerRef.current = player;
                  player.setVolume(effectiveVolume());
                  resolve(player);
                },
                onStateChange: (e: any) => {
                  const S = YT.PlayerState;
                  if (e.data === S.PLAYING) {
                    failStreak.current = 0;
                    patch({ status: 'playing', message: '' });
                  } else if (e.data === S.PAUSED) {
                    patch({ status: 'paused' });
                  } else if (e.data === S.ENDED) {
                    advance(1, true);
                  }
                },
                onError: (e: any) => {
                  // 2 參數錯誤、5 HTML5 錯誤、100 影片不存在、101/150 不允許嵌入 → 換下一首
                  failStreak.current += 1;
                  const blocked = e.data === 101 || e.data === 150;
                  if (failStreak.current >= 5) {
                    failStreak.current = 0;
                    patch({ status: 'error', message: '連續好幾首都放不了，換個關鍵字試試' });
                    return;
                  }
                  patch({ message: blocked ? '這首不能在外部播放，換下一首' : '這首播放失敗，換下一首' });
                  advance(1, true);
                },
              },
            });
          })
      )
      .catch((err) => {
        playerReady.current = null;
        throw err;
      });
    return playerReady.current;
    // advance 在下面定義，但只會在事件觸發時（定義完之後）才呼叫
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, effectiveVolume]);

  const loadTrack = useCallback(
    async (queue: MusicTrack[], index: number) => {
      const track = queue[index];
      if (!track) return;
      patch({ queue, index, status: 'loading' });
      try {
        const player = await ensurePlayer();
        player.setVolume(effectiveVolume());
        player.loadVideoById(track.videoId);
      } catch (err: any) {
        patch({ status: 'error', message: err?.message || '播放器載入失敗' });
      }
    },
    [ensurePlayer, effectiveVolume, patch]
  );

  /** 往前 / 往後跳；auto = 自動接下一首（播完或播放失敗） */
  const advance = useCallback(
    (step: number, auto = false) => {
      const { queue, index } = stateRef.current;
      const next = index + step;
      if (next < 0 || queue.length === 0) return;
      if (next >= queue.length) {
        if (auto) {
          playerRef.current?.stopVideo?.();
          patch({ status: 'idle', message: '這一串播完了，想聽別的再叫我～' });
        }
        return;
      }
      void loadTrack(queue, next);
    },
    [loadTrack, patch]
  );

  const play = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) return;
      const token = ++searchToken.current;
      patch({ status: 'loading', query: q, message: '' });
      // 先把播放器準備好（和搜尋同時進行）
      const ready = ensurePlayer().catch(() => null);
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (token !== searchToken.current) return; // 已經改點別首了
        if (!res.ok) throw new Error(data?.error || '搜尋失敗');
        const tracks: MusicTrack[] = data.tracks || [];
        if (tracks.length === 0) {
          patch({ status: 'error', message: `找不到「${q}」，換個說法試試` });
          return;
        }
        await ready;
        failStreak.current = 0;
        await loadTrack(tracks, 0);
      } catch (err: any) {
        if (token !== searchToken.current) return;
        patch({ status: 'error', message: err?.message || '搜尋失敗' });
      }
    },
    [ensurePlayer, loadTrack, patch]
  );

  const pause = useCallback(() => playerRef.current?.pauseVideo?.(), []);
  const resume = useCallback(() => {
    if (stateRef.current.queue.length === 0) return;
    playerRef.current?.playVideo?.();
  }, []);
  const toggle = useCallback(() => {
    if (stateRef.current.status === 'playing') pause();
    else resume();
  }, [pause, resume]);
  const stop = useCallback(() => {
    searchToken.current++;
    playerRef.current?.stopVideo?.();
    patch({ status: 'idle', message: '' });
  }, [patch]);

  const setVolume = useCallback(
    (v: number) => {
      const volume = Math.max(0, Math.min(100, Math.round(v)));
      patch({ volume });
      playerRef.current?.setVolume?.(effectiveVolume(volume));
      try {
        localStorage.setItem(VOLUME_KEY, String(volume));
      } catch {
        // ignore
      }
    },
    [patch, effectiveVolume]
  );

  /** 聊天回覆裡的 MUSIC 指令 */
  const command = useCallback(
    (cmd: MusicCommand) => {
      switch (cmd.action) {
        case 'play':
          if (cmd.query) void play(cmd.query);
          break;
        case 'pause':
          pause();
          break;
        case 'resume':
          resume();
          break;
        case 'next':
          advance(1);
          break;
        case 'previous':
          advance(-1);
          break;
        case 'stop':
          stop();
          break;
        case 'volume':
          if (typeof cmd.volume === 'number') setVolume(cmd.volume);
          break;
      }
    },
    [play, pause, resume, advance, stop, setVolume]
  );

  // 她說話 / 主人語音輸入時自動轉小聲；講完稍等一下再拉回來
  useEffect(() => {
    if (duck) {
      duckRef.current = true;
      playerRef.current?.setVolume?.(effectiveVolume());
      return;
    }
    const t = window.setTimeout(() => {
      duckRef.current = false;
      playerRef.current?.setVolume?.(effectiveVolume());
    }, DUCK_RELEASE_MS);
    return () => window.clearTimeout(t);
  }, [duck, effectiveVolume]);

  useEffect(
    () => () => {
      playerRef.current?.destroy?.();
    },
    []
  );

  const track = state.queue[state.index] ?? null;

  return {
    state,
    track,
    hostRef,
    play,
    pause,
    resume,
    toggle,
    stop,
    next: () => advance(1),
    previous: () => advance(-1),
    setVolume,
    command,
  };
}

export type MusicPlayerApi = ReturnType<typeof useMusicPlayer>;
