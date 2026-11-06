/**
 * 西雅的畫室（衣櫃）：用 Gemini 繪圖模型（預設 gemini-3-pro-image，.env 的 WARDROBE_MODEL 可改）
 * 拿她自己的立繪當參考圖畫草稿。要畫什麼由她自己決定（見 server/autonomy.ts），或主人在聊天裡跟她提。
 *
 * 能畫的種類：
 *   outfit     配件、搭配（帽子、髮飾、圍巾、換個顏色的外套…），臉和姿勢不動
 *   prop       場景裡的小東西（桌上的杯墊、旁邊的小盆栽…），角色不動
 *   expression 新表情或新姿勢（頭的位置盡量不動，之後才對得上眨眼和說話的圖層）
 *   sticker    聊天貼圖（1:1）
 * 背景一律是純綠 #00FF00（她身上幾乎沒有綠色，之後好去背）。
 *
 * 畫好的是草稿，存在 data/wardrobe/<id>/，不會動到 public/pet 的立繪；主人同意之後才會真的用上（之後的試穿間）。
 * 每日上限只算「畫好的成品」，失敗的不算；另外有嘗試次數的安全上限（成品上限 × 3），避免一直失敗一直花錢。
 */
import fs from 'fs';
import path from 'path';

export type DrawKind = 'outfit' | 'prop' | 'expression' | 'sticker';
export const DRAW_KINDS: DrawKind[] = ['outfit', 'prop', 'expression', 'sticker'];

export interface WardrobeItem {
  id: string;
  kind: DrawKind;
  title: string;
  /** 要畫成什麼樣子（中文描述）；舊資料叫 accessory */
  accessory: string;
  /** 拿哪張立繪當底（例如 body、pose-proud） */
  pose: string;
  by: 'seia' | 'master';
  /** 她為什麼想畫（她自己的話） */
  reason?: string;
  status: 'generating' | 'ready' | 'failed';
  createdAt: number;
  finishedAt?: number;
  model?: string;
  note?: string;
  error?: string;
  file?: string;
  width?: number;
  height?: number;
  /** 她自己看過的心得 */
  review?: { ok: boolean; comment: string };
  /** 她自己覺得不夠好、重畫了（不算成品） */
  superseded?: boolean;
  retryOf?: string;
  attempt?: number;
}

interface State {
  items: WardrobeItem[];
}

export interface GenerateResult {
  data: Buffer;
  mime: string;
  text: string;
  model: string;
}

export interface WardrobeDeps {
  /** 立繪資料夾（public/pet/layered） */
  layeredDir: string;
  /** 呼叫繪圖模型（server.ts 給，含記帳） */
  generate: (prompt: string, image: { mime: string; data: Buffer }, aspectRatio: string) => Promise<GenerateResult>;
  log?: (m: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 從 PNG／JPEG 檔頭讀寬高（不用裝圖片套件） */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

const BASE = `The attached image is the official sprite of an original character: a chibi anime cat girl drawn in a soft watercolor style, on a transparent background.`;
const KEEP_DESIGN = `Keep the character's design identical: face shape, eye colors, hair, cat ears, outfit, line art, colors and shading style.`;
const GREEN = `Replace the background with a perfectly flat, uniform pure green (#00FF00): no gradient, no texture, no floor, no shadow, no other objects. Do not use any green color on the character or on anything you add.`;

export function drawPrompt(kind: DrawKind, detail: string) {
  switch (kind) {
    case 'prop':
      return `${BASE}

Edit it by adding ONLY this object to the scene (described in Chinese): ${detail}

Keep everything else exactly identical to the attached image, including the character's pose, expression, exact position and size in the frame, and any existing furniture or objects. Do not crop, zoom or move anything. The new object must match the existing art style.

${GREEN}

Output exactly one portrait 3:4 image.`;
    case 'expression':
      return `${BASE}

Change it to show this new expression or pose (described in Chinese): ${detail}

${KEEP_DESIGN} Keep the head at exactly the same position, size and angle as in the attached image, and keep the same framing, so the face lines up with the original. Only the expression, and the arms or body if the description asks for it, may change.

${GREEN}

Output exactly one portrait 3:4 image.`;
    case 'sticker':
      return `${BASE}

Draw a chat sticker of this same character (described in Chinese): ${detail}

${KEEP_DESIGN} Make it a cute, expressive chibi pose, clean outline, centered with a small margin. No text unless the description asks for a short word.

${GREEN}

Output exactly one square 1:1 image.`;
    default:
      return `${BASE}

Edit it by adding or changing ONLY this (described in Chinese): ${detail}

${KEEP_DESIGN} Keep the same expression, pose and the character's exact position and size in the frame. Do not crop, zoom, rotate or move the character. Anything added must match the existing art style.

${GREEN}

Output exactly one portrait 3:4 image.`;
  }
}

export function createWardrobe(dataDir: string, deps: WardrobeDeps) {
  const root = path.join(dataDir, 'wardrobe');
  const file = path.join(root, 'wardrobe.json');
  const log = deps.log || console.log;
  let st: State = { items: [] };
  try {
    if (fs.existsSync(file)) st = { items: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  for (const it of st.items) {
    if (it.status === 'generating') Object.assign(it, { status: 'failed', error: '畫到一半桌寵被關掉了' });
    if (!it.kind) it.kind = 'outfit';
    if (!it.title) it.title = it.accessory.slice(0, 15);
  }
  const save = () => {
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(st, null, 2));
    } catch (err: any) {
      log(`[畫室] 儲存失敗：${err?.message}`);
    }
  };

  let busy: string | null = null;
  const dailyMax = () => Number(process.env.WARDROBE_DAILY_MAX) || 6;
  const today = (now: number) => st.items.filter((i) => dayKey(i.createdAt) === dayKey(now));
  /** 今天畫好的成品數（失敗的不算） */
  const productsToday = (now = Date.now()) => today(now).filter((i) => i.status === 'ready').length;

  /** 可以拿來當底的立繪（body 和 pose-*） */
  function poses(): string[] {
    try {
      return fs
        .readdirSync(deps.layeredDir)
        .filter((f) => /^(body|pose-[a-z0-9-]+)\.webp$/i.test(f))
        .map((f) => f.replace(/\.webp$/i, ''))
        .sort();
    } catch {
      return [];
    }
  }

  function canStart(now = Date.now()): { ok: boolean; reason?: string } {
    if (busy) return { ok: false, reason: '正在畫另一張' };
    if (productsToday(now) >= dailyMax()) return { ok: false, reason: `今天已經畫好 ${productsToday(now)} 張，明天再畫` };
    if (today(now).length >= dailyMax() * 3) return { ok: false, reason: '今天失敗太多次了，明天再試' };
    return { ok: true };
  }

  function start(
    req: { kind?: string; title?: string; detail: string; pose?: string; by: WardrobeItem['by']; reason?: string; retryOf?: string; attempt?: number },
    onDone?: (item: WardrobeItem) => void
  ): { ok: true; item: WardrobeItem } | { ok: false; reason: string } {
    const c = canStart();
    if (!c.ok) return { ok: false, reason: c.reason || '不能畫' };
    const detail = String(req.detail || '').trim().slice(0, 600);
    if (!detail) return { ok: false, reason: '要說畫什麼' };
    const kind: DrawKind = DRAW_KINDS.includes(req.kind as DrawKind) ? (req.kind as DrawKind) : 'outfit';
    const pose = String(req.pose || 'body').replace(/\.webp$/i, '');
    if (!poses().includes(pose)) return { ok: false, reason: `沒有這張立繪：${pose}` };
    const d = new Date();
    const item: WardrobeItem = {
      id: `a-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
      kind,
      title: String(req.title || detail).trim().slice(0, 30),
      accessory: detail,
      pose,
      by: req.by,
      reason: req.reason ? String(req.reason).slice(0, 120) : undefined,
      retryOf: req.retryOf,
      attempt: req.attempt || undefined,
      status: 'generating',
      createdAt: Date.now(),
    };
    st.items.push(item);
    st.items = st.items.slice(-80);
    busy = item.id;
    save();
    log(`[畫室] 開始畫（${kind}）：${item.title}（底圖 ${pose}）`);
    void (async () => {
      try {
        const src = fs.readFileSync(path.join(deps.layeredDir, `${pose}.webp`));
        const out = await deps.generate(drawPrompt(kind, detail), { mime: 'image/webp', data: src }, kind === 'sticker' ? '1:1' : '3:4');
        const ext = out.mime.includes('jpeg') ? 'jpg' : 'png';
        const dir = path.join(root, item.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `raw.${ext}`), out.data);
        const size = imageSize(out.data);
        Object.assign(item, { status: 'ready', file: `raw.${ext}`, model: out.model, note: out.text.slice(0, 300), width: size?.width, height: size?.height });
        log(`[畫室] 畫好了：${item.title}（${size ? `${size.width}×${size.height}` : '尺寸不明'}，${out.model}）`);
      } catch (err: any) {
        Object.assign(item, { status: 'failed', error: String(err?.message || err).slice(0, 400) });
        log(`[畫室] 失敗：${item.title}：${item.error}`);
      } finally {
        item.finishedAt = Date.now();
        busy = null;
        save();
      }
      try {
        onDone?.(item);
      } catch (err: any) {
        log(`[畫室] 收尾失敗：${err?.message}`);
      }
    })();
    return { ok: true, item };
  }

  function filePath(id: string): string | null {
    const it = st.items.find((i) => i.id === id);
    if (!it?.file) return null;
    const p = path.join(root, it.id, it.file);
    return fs.existsSync(p) ? p : null;
  }

  function get(id: string) {
    return st.items.find((i) => i.id === id);
  }

  /** 她看過自己的草稿 */
  function setReview(id: string, ok: boolean, comment: string) {
    const it = get(id);
    if (!it) return;
    it.review = { ok, comment: String(comment || '').slice(0, 120) };
    save();
  }

  /** 她覺得不夠好、要重畫：這張不算成品 */
  function supersede(id: string, note: string) {
    const it = get(id);
    if (!it) return;
    Object.assign(it, { status: 'failed', superseded: true, error: String(note || '她自己覺得不夠好，重畫了').slice(0, 200) });
    save();
  }

  /** 某一天畫了什麼（給日記） */
  function dayRecap(date: string): string[] {
    return st.items
      .filter((i) => dayKey(i.createdAt) === date && i.status !== 'generating')
      .map((i) =>
        i.superseded
          ? `「${i.title}」第一版自己看了不滿意，重畫`
          : i.status === 'failed'
          ? `「${i.title}」沒畫成功`
          : `畫好「${i.title}」的草稿${i.review?.comment ? `，你的心得：${i.review.comment}` : ''}`
      );
  }

  const KIND_LABEL: Record<DrawKind, string> = { outfit: '配件／搭配', prop: '場景小東西', expression: '表情／姿勢', sticker: '貼圖' };

  /** 給聊天：最近畫的草稿（還沒用上） */
  function describeForChat(now = Date.now()): string {
    if (busy) {
      const it = st.items.find((i) => i.id === busy);
      if (it) return `【畫室】你正在畫「${it.title}」（${KIND_LABEL[it.kind]}），還沒畫好。`;
    }
    const recent = st.items.filter((i) => i.status === 'ready' && now - (i.finishedAt || i.createdAt) < 2 * 24 * 3600 * 1000).slice(-3);
    if (!recent.length) return '';
    return `【畫室】你最近畫的草稿：${recent
      .map((i) => `「${i.title}」（${KIND_LABEL[i.kind]}${i.by === 'master' ? '，主人提的' : ''}）`)
      .join('；')}。這些都還只是草稿、等主人看，還沒有真的用在你身上，不要說你已經戴著或已經有了。`;
  }

  /** 給自主行動的工具說明 */
  function describeTool(): string {
    return `畫圖：拿你自己的立繪當底，畫一張草稿。options 要填 kind（outfit＝配件或搭配、prop＝場景裡的小東西、expression＝新表情或新姿勢、sticker＝聊天貼圖）和 pose（底圖，從這些挑：${poses().join('、')}）。detail 寫清楚要畫的東西（顏色、材質、樣子），一次一個重點。畫好是草稿，主人同意才會真的用上。今天已畫好 ${productsToday()}／${dailyMax()} 張。`;
  }

  function snapshot() {
    return { busy, dailyMax: dailyMax(), today: productsToday(), canStart: canStart(), poses: poses(), items: [...st.items].reverse() };
  }

  return { start, get, filePath, snapshot, canStart, describeForChat, describeTool, setReview, supersede, dayRecap };
}

export type Wardrobe = ReturnType<typeof createWardrobe>;
