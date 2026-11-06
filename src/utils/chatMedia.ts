/**
 * 聊天框附件（圖片 / 影片）的前處理：
 *  - 圖片：最長邊縮到 1536 px、轉 JPEG（GIF 保留原檔，動圖才看得出在動），另外做一張小縮圖給對話框顯示和存檔
 *  - 影片：15MB 以內直接整段送（Gemini 看得到畫面和聲音）；太大的就平均截 9 張畫面拼成九宮格送
 * 送給 Gemini 的是 data（base64，不含 data: 開頭）；存進聊天紀錄的只有縮圖，免得 localStorage 爆掉。
 */

export interface PreparedMedia {
  kind: 'image' | 'video';
  /** 給 Gemini 的 MIME 與 base64 */
  mime: string;
  data: string;
  /** 對話框顯示用的小縮圖（data URL） */
  thumb: string;
  name?: string;
  durationSec?: number;
  /** 影片太大 → 改送九宮格截圖 */
  mosaic?: boolean;
}

const VIDEO_INLINE_MAX = 15 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1536;
const THUMB_SIDE = 240;

const stripPrefix = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片讀不出來'));
    img.src = src;
  });
}

function drawScaled(source: CanvasImageSource, w: number, h: number, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function prepareImage(file: File): Promise<PreparedMedia> {
  const url = await readAsDataUrl(file);
  const img = await loadImage(url);
  const thumb = drawScaled(img, img.naturalWidth, img.naturalHeight, THUMB_SIDE, 0.7);
  if (file.type === 'image/gif' && file.size <= 8 * 1024 * 1024) {
    return { kind: 'image', mime: 'image/gif', data: stripPrefix(url), thumb, name: file.name };
  }
  const big = drawScaled(img, img.naturalWidth, img.naturalHeight, IMAGE_MAX_SIDE, 0.85);
  return { kind: 'image', mime: 'image/jpeg', data: stripPrefix(big), thumb, name: file.name };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
    setTimeout(done, 3000);
  });
}

async function prepareVideo(file: File): Promise<PreparedMedia> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('影片讀不出來（格式可能不支援）'));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    await seek(video, Math.min(0.5, duration / 2));
    const thumb = drawScaled(video, w, h, THUMB_SIDE, 0.7);

    const mimeOk = /^video\/(mp4|webm|quicktime|x-matroska|mpeg)$/.test(file.type);
    if (mimeOk && file.size <= VIDEO_INLINE_MAX) {
      const url = await readAsDataUrl(file);
      return { kind: 'video', mime: file.type, data: stripPrefix(url), thumb, name: file.name, durationSec: duration };
    }

    // 太大（或格式 Gemini 不收）：平均截 9 張，拼成 3×3
    const cellW = 426;
    const cellH = Math.round((cellW * h) / w);
    const canvas = document.createElement('canvas');
    canvas.width = cellW * 3;
    canvas.height = cellH * 3;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 9; i++) {
      await seek(video, duration ? (duration * (i + 0.5)) / 9 : 0);
      const x = (i % 3) * cellW;
      const y = Math.floor(i / 3) * cellH;
      ctx.drawImage(video, x, y, cellW, cellH);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 4, y + 4, 26, 22);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(String(i + 1), x + 11, y + 21);
    }
    return {
      kind: 'video',
      mime: 'image/jpeg',
      data: stripPrefix(canvas.toDataURL('image/jpeg', 0.82)),
      thumb,
      name: file.name,
      durationSec: duration,
      mosaic: true,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 把使用者選的 / 貼上的 / 拖進來的檔案轉成可以送給她的附件 */
export async function prepareChatMedia(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith('image/')) return prepareImage(file);
  if (file.type.startsWith('video/')) return prepareVideo(file);
  throw new Error('只能傳圖片或影片');
}
