/**
 * 處理「假透明」立繪：很多網路上 / AI 生成的「透明 PNG」其實把灰白或黑白棋盤格直接畫進圖裡，
 * 常常還帶一圈白色貼紙描邊。
 *
 * 做法：
 * 1. 從圖片四邊找出背景的主要顏色（棋盤格的兩色，或單色底）。
 * 2. 背景像素 = 接近背景色，或（背景偏亮時）任何「低彩度又夠亮」的像素
 *    → 一併吃掉白色貼紙描邊、JPG 壓縮雜訊、淡化的網格。
 * 3. 從邊緣 + 「被角色圍起來的方形網格」開始 flood fill，遇到有顏色的線稿就停。
 * 4. 清掉貼著透明區、殘留的淺色雜邊。
 *
 * 另外會把過大的圖縮到 MAX_DIM，減少儲存空間。
 */

const MAX_DIM = 1024;
const COLOR_TOLERANCE = 60; // 與背景色的 RGB 差距總和上限（JPG 雜訊需要寬一點）
const NEUTRAL_SATURATION = 22; // 視為「無色（灰/白）」的最大彩度
const MAX_BG_SATURATION = 40; // 背景本身必須是低彩度，避免誤刪彩色背景
const MIN_BORDER_COVERAGE = 0.75; // 邊緣像素至少 75% 屬於背景色才處理

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

export interface RemoveOptions {
  /** 是否清除「被圍住的純白區塊」（貼紙底色）。角色本身有大面積純白衣服時請關掉 */
  removeWhitePockets?: boolean;
}

export async function removeFakeTransparency(
  srcDataUrl: string,
  { removeWhitePockets = true }: RemoveOptions = {}
): Promise<ProcessedImage> {
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
  const N = w * h;
  const keepAsIs = () => ({ dataUrl: canvas.toDataURL('image/png'), removedBackground: false });

  // ---- 1. 邊緣像素與背景主色 ----
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  // 已經是真透明（邊緣大多透明）→ 不需要處理
  const transparentBorder = border.filter((i) => px[i * 4 + 3] < 200).length;
  if (transparentBorder / border.length > 0.5) return keepAsIs();

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
  const refs = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((bk) => ({ count: bk.count, r: bk.r / bk.count, g: bk.g / bk.count, b: bk.b / bk.count }));

  // 只用佔邊緣夠多的顏色（單色底時第二名可能只是雜訊）
  const bgRefs = refs.filter((c) => c.count / border.length > 0.08);
  const coverage = bgRefs.reduce((sum, c) => sum + c.count, 0) / border.length;
  const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);
  const lowSaturation = bgRefs.every((c) => sat(c.r, c.g, c.b) <= MAX_BG_SATURATION);
  if (bgRefs.length === 0 || coverage < MIN_BORDER_COVERAGE || !lowSaturation) return keepAsIs();

  // 背景都偏亮（灰白網格 / 白底）時，任何「無色且夠亮」的像素都視為背景：
  // 這樣能一併吃掉白色貼紙描邊、淡化的網格與 JPG 雜訊
  const lum = (c: { r: number; g: number; b: number }) => (c.r + c.g + c.b) / 3;
  const minRefLum = Math.min(...bgRefs.map(lum));
  const lightBackground = minRefLum >= 150;
  const lightThreshold = minRefLum - 18;

  const isBg = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    let bg = bgRefs.some(
      (c) => Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b) <= COLOR_TOLERANCE
    );
    if (!bg && lightBackground) {
      bg = sat(r, g, b) <= NEUTRAL_SATURATION && (r + g + b) / 3 >= lightThreshold;
    }
    isBg[i] = bg ? 1 : 0;
  }

  // ---- 2. 種子：邊緣 + 被角色圍住的「方形網格塊」 ----
  const visited = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (i: number) => {
    if (!visited[i] && isBg[i]) {
      visited[i] = 1;
      stack[sp++] = i;
    }
  };
  border.forEach(push);

  // 被角色圍住的網格碰不到邊緣，所以另外找種子：
  // 只要某點周圍 (2R+1)² 的方塊全是「較深那一色」（例如灰格），就視為網格的一部分。
  // 只在亮色網格時啟用，避免黑白網格時把角色身上的大塊黑色當成背景。
  if (bgRefs.length >= 2 && lightBackground) {
    const dark = bgRefs.reduce((a, b) => (lum(a) < lum(b) ? a : b));
    const R = 3;
    // 積分圖：快速計算任意方塊內有幾個灰格色像素
    const integral = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const isDark =
          Math.abs(px[o] - dark.r) + Math.abs(px[o + 1] - dark.g) + Math.abs(px[o + 2] - dark.b) <=
          COLOR_TOLERANCE / 2;
        rowSum += isDark ? 1 : 0;
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
      }
    }
    const full = (2 * R + 1) * (2 * R + 1);
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const x0 = x - R, y0 = y - R, x1 = x + R + 1, y1 = y + R + 1;
        const count =
          integral[y1 * (w + 1) + x1] -
          integral[y0 * (w + 1) + x1] -
          integral[y1 * (w + 1) + x0] +
          integral[y0 * (w + 1) + x0];
        if (count === full) push(y * w + x);
      }
    }
  }

  // ---- 3. Flood fill（4 方向）----
  let removed = 0;
  while (sp > 0) {
    const i = stack[--sp];
    px[i * 4 + 3] = 0;
    removed++;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < N - w) push(i + w);
  }

  // ---- 3.5 被頭髮等圍住、填滿純白的貼紙底色小區塊 ----
  // 這些區塊跟外面不相連、裡面也沒有灰格，所以上面清不到。
  // 白色衣服通常有陰影（不是純白），細長的高光也會被尺寸條件排除。
  if (removed > 0 && lightBackground && removeWhitePockets) {
    const isPureWhite = (i: number) => {
      const o = i * 4;
      if (px[o + 3] === 0) return false;
      const r = px[o], g = px[o + 1], b = px[o + 2];
      return Math.min(r, g, b) >= 238 && sat(r, g, b) <= 12;
    };
    const seen = new Uint8Array(N);
    const comp = new Int32Array(N);
    const maxPocket = N * 0.02;
    for (let start = 0; start < N; start++) {
      if (seen[start] || !isPureWhite(start)) continue;
      let cn = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      seen[start] = 1;
      comp[cn++] = start;
      for (let k = 0; k < cn; k++) {
        const i = comp[k];
        const x = i % w, y = (i / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const nbs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const n of nbs) {
          if (n >= 0 && !seen[n] && isPureWhite(n)) {
            seen[n] = 1;
            comp[cn++] = n;
          }
        }
      }
      const thick = Math.min(maxX - minX + 1, maxY - minY + 1) >= 8;
      if (cn >= 80 && cn <= maxPocket && thick) {
        for (let k = 0; k < cn; k++) px[comp[k] * 4 + 3] = 0;
        removed += cn;
      }
    }
  }

  // ---- 4. 清掉貼著透明區的淺色雜邊（JPG 壓縮造成的光暈），做兩輪 ----
  if (removed > 0 && lightBackground) {
    for (let pass = 0; pass < 2; pass++) {
      const toClear: number[] = [];
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        if (px[o + 3] === 0) continue;
        const x = i % w;
        const nearClear =
          (x > 0 && px[(i - 1) * 4 + 3] === 0) ||
          (x < w - 1 && px[(i + 1) * 4 + 3] === 0) ||
          (i >= w && px[(i - w) * 4 + 3] === 0) ||
          (i < N - w && px[(i + w) * 4 + 3] === 0);
        if (!nearClear) continue;
        const r = px[o], g = px[o + 1], b = px[o + 2];
        if (sat(r, g, b) <= 45 && (r + g + b) / 3 >= lightThreshold - 10) toClear.push(i);
      }
      for (const i of toClear) px[i * 4 + 3] = 0;
      removed += toClear.length;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), removedBackground: removed > 0 };
}
