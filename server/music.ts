/**
 * 桌寵內建音樂播放器（後端部分）
 *
 *  - searchMusic：用 yt-search 搜 YouTube，回傳可以給前端 IFrame 播放器播的影片清單
 *  - extractMusicCommand：從聊天回覆的隱藏標記 <!--MUSIC:{...}--> 取出播放指令
 *  - describeMusicState：把前端播放器現在的狀態寫進聊天提示詞，讓她知道正在放什麼
 */
import ytSearch from 'yt-search';

export interface MusicTrack {
  videoId: string;
  title: string;
  author: string;
  seconds: number;
  thumbnail: string;
}

export type MusicAction = 'play' | 'pause' | 'resume' | 'next' | 'previous' | 'stop' | 'volume';

export interface MusicCommand {
  action: MusicAction;
  query?: string;
  volume?: number; // 0 ~ 100
}

export interface MusicState {
  status?: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  title?: string;
  author?: string;
  volume?: number;
}

const ACTIONS: MusicAction[] = ['play', 'pause', 'resume', 'next', 'previous', 'stop', 'volume'];

const cache = new Map<string, { at: number; tracks: MusicTrack[] }>();
const CACHE_MS = 30 * 60 * 1000;

export async function searchMusic(query: string, limit = 12): Promise<MusicTrack[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tracks;

  const r = await ytSearch(q);
  const tracks = r.videos
    // 去掉 Shorts（太短）和超過 3 小時的；長的 lofi / 作業用 BGM 合輯保留
    .filter((v) => v.seconds >= 60 && v.seconds <= 3 * 60 * 60)
    .slice(0, limit)
    .map((v) => ({
      videoId: v.videoId,
      title: v.title,
      author: v.author?.name ?? '',
      seconds: v.seconds,
      thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    }));
  cache.set(q, { at: Date.now(), tracks });
  if (cache.size > 100) cache.delete(cache.keys().next().value as string);
  return tracks;
}

/** 從模型回覆裡取出 <!--MUSIC:{...}-->；格式不對就當作沒有 */
export function extractMusicCommand(rawText: string): MusicCommand | null {
  const m = rawText.match(/<!--\s*MUSIC:\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    const action = String(obj.action || '').toLowerCase() as MusicAction;
    if (!ACTIONS.includes(action)) return null;
    const cmd: MusicCommand = { action };
    if (typeof obj.query === 'string' && obj.query.trim()) cmd.query = obj.query.trim().slice(0, 100);
    const vol = Number(obj.volume);
    if (Number.isFinite(vol)) cmd.volume = Math.max(0, Math.min(100, Math.round(vol)));
    if (action === 'play' && !cmd.query) return null;
    if (action === 'volume' && cmd.volume === undefined) return null;
    return cmd;
  } catch {
    return null;
  }
}

const STATUS_TEXT: Record<string, string> = {
  idle: '沒有在放音樂',
  loading: '正在找歌',
  playing: '正在播放',
  paused: '暫停中',
  error: '剛剛播放失敗',
};

/** 給聊天提示詞用：音樂播放器的使用規則 + 目前狀態 */
export function describeMusicState(state?: MusicState): string {
  const s = state || {};
  const status = STATUS_TEXT[s.status || 'idle'] || STATUS_TEXT.idle;
  const now =
    s.title && (s.status === 'playing' || s.status === 'paused' || s.status === 'loading')
      ? `${status}：「${s.title}」${s.author ? `（${s.author}）` : ''}`
      : status;
  return `6. 你可以控制桌寵內建的 YouTube 音樂播放器（目前狀態：${now}；音量 ${s.volume ?? 60}）。
只有主人「明確要你」放音樂、換歌、暫停、繼續、停止或調音量時，才在文末加上隱藏標記：<!--MUSIC:{"action":"動作","query":"搜尋字","volume":數字}-->
- play：放新的音樂，query 必填，寫成在 YouTube 好搜到的關鍵字（例如「lofi hip hop」「YOASOBI 夜に駆ける」「Path of Exile 戰鬥 BGM」）。主人沒指定就依他的喜好和現在在做的事挑。
- pause（暫停）、resume（繼續）、next（下一首 / 換一首）、previous（上一首）、stop（關掉音樂）：不用 query。
- volume：volume 填 0~100。「大聲一點」= 目前音量 +15，「小聲一點」= 目前音量 -15。
- 文字回覆要像朋友一樣自然回應（例如「好～來點 lofi 陪你讀書」），不要提到標記、程式或播放器設定。
- 主人只是聊到音樂、問歌名、沒有要你播的時候，不要加 MUSIC 標記；問「這首是什麼」就直接用上面的目前狀態回答。`;
}
