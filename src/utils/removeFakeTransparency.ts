/**
 * 處理「假透明」立繪：很多網路上的「透明 PNG」其實把灰白 / 黑白棋盤格直接畫進圖裡。
 * 做法：從圖片四邊找出背景的主要顏色（棋盤格的兩色，或單色底），
 * 再從邊緣做 flood fill，只把「跟邊緣相連」的背景像素變透明，角色本體不受影響。
 *
 * 另外會把過大的圖縮到 MAX_DIM，避免存進 localStorage 時超出容量。
 */

const MAX_DIM = 1024;
const COLOR_TOLERANCE = 40; // 與背景色的 RGB 差距總和上限
const MAX_BG_SATURATION = 40; // 背景必須是低彩度（灰 / 白 / 黑），避免誤刪彩色背景
const MIN_BORDER_COVERAGE = 0.8; // 邊緣像素至少要有 80% 屬於背景色才處理

export interface ProcessedImage {
  dataUrl: string;
  removedBackground: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片讀取失敗'));
    img.src = src;
  });
}

export async function removeFakeTransparency(srcDataUrl: string): Promise<ProcessedImage> {
  const img = await loadImage(srcDataUrl);
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { dataUrl: srcDataUrl, removedBackground: false };
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;

  // 1. 收集邊緣像素
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  // 已經是真透明（邊緣大多透明）→ 不需要處理
  const transparentBorder = border.filter((i) => px[i * 4 + 3] < 200).length;
  if (transparentBorder / border.length > 0.5) {
    return { dataUrl: canvas.toDataURL('image/png'), removedBackground: false };
  }

  // 2. 把邊緣顏色量化分桶，找出最多的兩種顏色（棋盤格的兩色）
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const i of border) {
    const o = i * 4;
    const key = ((px[o] >> 4) << 8) | ((px[o + 1] >> 4) << 4) | (px[o + 2] >> 4);
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += px[o];
    bucket.g += px[o + 1];
    bucket.b += px[o + 2];
    buckets.set(key, bucket);
  }
  const top = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((bk) => ({ count: bk.count, r: bk.r / bk.count, g: bk.g / bk.count, b: bk.b / bk.count }));

  const coverage = top.reduce((sum, c) => sum + c.count, 0) / border.length;
  const lowSaturation = top.every(
    (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= MAX_BG_SATURATION
  );
  if (coverage < MIN_BORDER_COVERAGE || !lowSaturation) {
    return { dataUrl: canvas.toDataURL('image/png'), removedBackground: false };
  }

  const isBackground = (i: number) => {
    const o = i * 4;
    return top.some(
      (c) =>
        Math.abs(px[o] - c.r) + Math.abs(px[o + 1] - c.g) + Math.abs(px[o + 2] - c.b) <=
        COLOR_TOLERANCE
    );
  };

  // 3. 從邊緣開始 flood fill（4 方向），只清除跟邊緣相連的背景
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  for (const i of border) {
    if (!visited[i] && isBackground(i)) {
      visited[i] = 1;
      stack[sp++] = i;
    }
  }
  let removed = 0;
  while (sp > 0) {
    const i = stack[--sp];
    px[i * 4 + 3] = 0;
    removed++;
    const x = i % w;
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      i >= w ? i - w : -1,
      i < w * (h - 1) ? i + w : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && !visited[n] && isBackground(n)) {
        visited[n] = 1;
        stack[sp++] = n;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), removedBackground: removed > 0 };
}
