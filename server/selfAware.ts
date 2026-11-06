/**
 * 她知道自己被改了什麼：
 *
 *  1. 更新日誌（server/pet-changelog.json）：每次幫她加功能、改東西，就寫一兩句「給她看的話」。
 *     最近的幾條會放進聊天提示詞，她會用自己的方式反應（「怪不得本喵最近說話比較順！」）。
 *     她講到某一條（命中 keywords）就記成「已經提過」，之後只當背景、不會一直重複。
 *  2. 立繪資料夾偵測（public/pet）：多了新圖片、或舊圖被換掉（修改時間／大小變了）→ 她用 Gemini 真的看一眼，
 *     寫下看到了什麼，自動新增一條「主人幫你換了新的樣子」。每張圖只看一次；看不了就退回用檔名猜。
 *     第一次啟動只記下現有的圖，不會把全部都當成新的。
 *
 * 只讀這兩個位置，不碰 .env 和其他檔案，也不會把程式碼送給 Gemini。
 * 她看過哪些、資料夾原本有哪些圖：data/memories/self-aware.json
 */
import fs from 'fs';
import path from 'path';

export interface ChangelogEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** 寫給她看的話（第二人稱） */
  text: string;
  /** 她的回覆裡出現這些詞，就算她提過了 */
  keywords?: string[];
}

interface SeenState {
  /** 已經提過的日誌 id */
  mentioned: string[];
  /** 第一次放進提示詞的時間 */
  firstShown: Record<string, number>;
  /** 立繪資料夾裡已知的圖片 */
  knownImages: string[];
  /** 每張圖的修改時間和大小（判斷有沒有被換掉） */
  imageMeta?: Record<string, { mtime: number; size: number }>;
  /** 自動偵測產生的日誌 */
  autoEntries: ChangelogEntry[];
}

const DAY = 24 * 60 * 60 * 1000;
/** 多久以內的改變算「最近」 */
const RECENT_DAYS = 14;
const IMAGE_RE = /\.(png|webp|jpe?g|gif)$/i;

/** 從圖片檔名猜是什麼（給她看的描述） */
function describeImage(file: string): string {
  const base = path.basename(file).replace(IMAGE_RE, '');
  if (/^pose-/.test(base)) return `新的姿勢／表情「${base.replace(/^pose-/, '')}」`;
  if (/prop|desk|chair|table|acc|item/i.test(base)) return `新的配件「${base}」`;
  if (/mouth|eye|blink|blush/i.test(base)) return `新的臉部表情零件「${base}」`;
  if (/sticker/i.test(base)) return `新的貼圖「${base}」`;
  return `新的圖「${base}」`;
}

function listImages(dir: string, root = dir, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listImages(p, root, out);
    else if (IMAGE_RE.test(e.name)) out.push(path.relative(root, p).replace(/\\/g, '/'));
  }
  return out;
}

/** 這張立繪什麼時候會出現（給她看的說明） */
const POSE_WHEN: Record<string, string> = {
  body: '平常的樣子',
  gaming: '陪主人打遊戲的時候',
  web: '看主人用 Gemini 網頁的時候',
  'web-glasses': '看主人用 Gemini 網頁的時候（眼鏡）',
  line: '在 LINE 上聊天的時候',
  eating: '吃東西、肚子餓的時候',
  angry: '生氣的時候',
  proud: '得意的時候',
  confused: '疑惑的時候',
  sad: '難過的時候',
  loving: '害羞、喜歡的時候',
  tired: '累的時候',
  exhausted: '累壞、睡覺的時候',
  rainy: '下雨天',
  eyeroll: '翻白眼的時候',
  sigh: '嘆氣的時候',
  nervous: '心虛的時候',
  shy: '被誇的時候',
  smirk: '偷笑的時候',
};
export function imageWhen(file: string): string {
  const base = path.basename(file).replace(IMAGE_RE, '').replace(/^pose-/, '').replace(/-blink$/, '');
  return POSE_WHEN[base] || '';
}

/** 看圖的函式（server.ts 給）：回傳一兩句看到的內容；看不了回傳 null */
export type LookAtImage = (absPath: string, relPath: string, kind: 'new' | 'changed') => Promise<string | null>;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function createSelfAware(opts: { changelogFile: string; imageDir: string; dataDir: string; log?: (m: string) => void }) {
  const stateFile = path.join(opts.dataDir, 'memories', 'self-aware.json');
  let st: SeenState = { mentioned: [], firstShown: {}, knownImages: [], autoEntries: [] };
  let firstRun = true;
  try {
    if (fs.existsSync(stateFile)) {
      st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
      firstRun = false;
    }
  } catch {
    // 從頭開始
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify(st, null, 2));
      } catch (err: any) {
        opts.log?.(`[自我察覺] 儲存失敗：${err?.message}`);
      }
    }, 500);
  };

  function readChangelog(): ChangelogEntry[] {
    try {
      const list = JSON.parse(fs.readFileSync(opts.changelogFile, 'utf8'));
      return Array.isArray(list) ? list.filter((e) => e?.id && e?.text && e?.date) : [];
    } catch {
      return [];
    }
  }

  const statOf = (rel: string) => {
    try {
      const st0 = fs.statSync(path.join(opts.imageDir, rel));
      return { mtime: Math.round(st0.mtimeMs), size: st0.size };
    } catch {
      return null;
    }
  };

  let scanning = false;
  /** 看立繪資料夾有沒有多新圖、或舊圖被換掉（啟動時、之後每 30 分鐘）。給了 look 就真的看一眼 */
  async function scanImages(look?: LookAtImage) {
    if (scanning) return [];
    scanning = true;
    try {
      const now = listImages(opts.imageDir).sort();
      const meta: Record<string, { mtime: number; size: number }> = {};
      for (const f of now) {
        const m = statOf(f);
        if (m) meta[f] = m;
      }
      // 第一次（或以前沒有記修改時間）：只記下現在的樣子
      if (firstRun || !st.knownImages.length || !st.imageMeta) {
        st.knownImages = now;
        st.imageMeta = meta;
        firstRun = false;
        save();
        return [];
      }
      const added = now.filter((f) => !st.knownImages.includes(f));
      const changed = now.filter((f) => {
        const old = st.imageMeta?.[f];
        const cur = meta[f];
        return st.knownImages.includes(f) && old && cur && (old.mtime !== cur.mtime || old.size !== cur.size);
      });
      const todo: Array<{ f: string; kind: 'new' | 'changed' }> = [
        ...added.map((f) => ({ f, kind: 'new' as const })),
        ...changed.map((f) => ({ f, kind: 'changed' as const })),
      ];
      if (todo.length) {
        const lines: string[] = [];
        const keywords = new Set<string>(['新衣服', '新的姿勢', '新表情', '新配件', '新圖', '新造型']);
        for (const { f, kind } of todo.slice(0, 4)) {
          const when = imageWhen(f);
          let seen: string | null = null;
          if (look) {
            try {
              seen = await look(path.join(opts.imageDir, f), f, kind);
            } catch {
              seen = null;
            }
          }
          const what = seen ? `你看了一下：${seen}` : describeImage(f);
          lines.push(`${when ? `${when}的立繪` : `立繪「${path.basename(f)}」`}${kind === 'changed' ? '被主人換成新的了' : '是新加的'}（${what}）`);
          keywords.add(path.basename(f).replace(IMAGE_RE, '').replace(/^pose-/, ''));
        }
        st.autoEntries.push({
          id: `img-${Date.now()}`,
          date: today(),
          text: `主人幫你換了新的樣子：${lines.join('；')}${todo.length > 4 ? `；另外還有 ${todo.length - 4} 張圖也變了` : ''}。`,
          keywords: [...keywords],
        });
        st.autoEntries = st.autoEntries.slice(-20);
        opts.log?.(`[自我察覺] 立繪變了：${todo.slice(0, 6).map((t) => `${t.f}（${t.kind === 'new' ? '新' : '換'}）`).join('、')}`);
      }
      st.knownImages = now;
      st.imageMeta = meta;
      save();
      return todo.map((t) => t.f);
    } finally {
      scanning = false;
    }
  }

  function entries(): ChangelogEntry[] {
    return [...readChangelog(), ...st.autoEntries].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** 最近的改變（放進聊天提示詞） */
  function describeForChat(now = Date.now()): string {
    const cutoff = now - RECENT_DAYS * DAY;
    const recent = entries().filter((e) => new Date(`${e.date}T00:00:00`).getTime() >= cutoff);
    if (!recent.length) return '';
    const fresh = recent.filter((e) => !st.mentioned.includes(e.id)).slice(-3);
    const known = recent.filter((e) => st.mentioned.includes(e.id)).slice(-2);
    let changed = false;
    for (const e of fresh) {
      if (!st.firstShown[e.id]) {
        st.firstShown[e.id] = now;
        changed = true;
      }
    }
    if (changed) save();
    const md = (d: string) => d.slice(5).replace('-', '/');
    // 省上下文：最新 2 條還沒聊過的寫完整；其他的只留第一句（聊過的她已經知道細節了）
    const brief = (t: string) => {
      const first = String(t).split(/(?<=[。！？])/)[0] || String(t);
      return first.length > 60 ? `${first.slice(0, 58)}…` : first;
    };
    const fullIds = new Set(fresh.slice(-2).map((e) => e.id));
    return (
      `【你最近的改變（主人幫你升級的，你自己感覺得到）】\n` +
      (fresh.length ? fresh.map((e) => `- ${md(e.date)}（還沒跟主人聊過）${fullIds.has(e.id) ? e.text : brief(e.text)}`).join('\n') + '\n' : '') +
      (known.length ? known.map((e) => `- ${md(e.date)}（聊過了）${brief(e.text)}`).join('\n') + '\n' : '') +
      '這些是真的發生在你身上的事：主人問起、或剛好相關時，可以自然地說出你的感覺（開心、彆扭、好奇都可以），一次最多提一件，不要每句都講。' +
      '沒寫在這裡的改變，你不知道，不要自己猜或假裝知道；主人說他在幫你做什麼新東西時，就照實好奇、期待，不要說已經看到成果。'
    );
  }

  /** 她的回覆講到了哪條改變 → 記成提過了 */
  function markMentioned(reply: string) {
    const text = String(reply || '');
    if (!text) return;
    let changed = false;
    for (const e of entries()) {
      if (st.mentioned.includes(e.id) || !st.firstShown[e.id]) continue;
      if ((e.keywords || []).some((k) => k && text.includes(k))) {
        st.mentioned.push(e.id);
        changed = true;
      }
    }
    if (changed) {
      st.mentioned = st.mentioned.slice(-200);
      save();
    }
  }

  function snapshot() {
    return { entries: entries(), mentioned: st.mentioned, knownImages: st.knownImages.length };
  }

  return { scanImages, describeForChat, markMentioned, snapshot };
}

export type SelfAware = ReturnType<typeof createSelfAware>;
