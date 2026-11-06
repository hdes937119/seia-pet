/**
 * 語音合成的語言分段：讓她回覆裡的日文（えへへ、ありがとう）用日文念，中文、英文照舊。
 *
 * 不用 GPT-SoVITS 內建的 auto（它逐字猜，漢字很容易被當成日文念）。這裡的規則很保守：
 *  - 以標點切成一小句一小句
 *  - 這一小句裡有「平假名 / 片假名」才算日文 → 用 ja 念（整小句，包含裡面的漢字，像「大好き」）
 *  - 其他全部用 zh（GPT-SoVITS 的 zh = 中英混合，英文單字照樣會念英文）
 *  - 中文網路用語「主人の貓」這種只有一個「の」的 → 當中文，「の」念成「的」
 */

export type TtsLang = 'zh' | 'ja';
export interface TtsPart {
  lang: TtsLang;
  text: string;
}

const KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/g;
const KANA_TEST = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/;
const HAN = /[㐀-鿿豈-﫿]/;

/** 一小句 = 文字 + 後面跟著的標點 / 空白 */
const CLAUSE = /[^，,。．.！!？?、；;：:…～~\s]+[，,。．.！!？?、；;：:…～~\s]*|[，,。．.！!？?、；;：:…～~\s]+/g;

function clauseLang(clause: string): TtsLang {
  const kana = clause.match(KANA) || [];
  if (kana.length === 0) return 'zh';
  // 只有「の」夾在中文裡（主人の貓）→ 中文
  if (kana.every((k) => k === 'の') && HAN.test(clause)) return 'zh';
  // 片假名的長音「ー」單獨出現（像「好ー」）不算日文
  if (kana.every((k) => k === 'ー')) return 'zh';
  return 'ja';
}

/** 沒有可以念的字（只有標點、空白） */
const isSilent = (s: string) => !/[\p{L}\p{N}]/u.test(s);

export function splitByLanguage(text: string): TtsPart[] {
  const clauses = text.match(CLAUSE) || [];
  const parts: TtsPart[] = [];
  for (const raw of clauses) {
    let lang: TtsLang = parts.length ? parts[parts.length - 1].lang : 'zh';
    let clause = raw;
    if (!isSilent(raw)) {
      lang = clauseLang(raw);
      if (lang === 'zh' && KANA_TEST.test(raw)) clause = raw.replace(/の/g, '的');
    }
    const prev = parts[parts.length - 1];
    if (prev && (prev.lang === lang || isSilent(clause))) prev.text += clause;
    else parts.push({ lang, text: clause });
  }
  // 只剩標點的段落併到前一段；每段結尾補句號，GPT-SoVITS 才不會吞掉最後一個字
  const out = parts
    .map((p) => ({ ...p, text: p.text.trim() }))
    .filter((p) => !isSilent(p.text));
  for (const p of out) if (!/[。！？!?…]$/.test(p.text)) p.text = p.text.replace(/[，,、；;：:]+$/, '') + '。';
  return out;
}

/* ───────────── 把多段 WAV 接成一個 ───────────── */

interface WavInfo {
  fmt: Buffer; // fmt chunk 內容
  data: Buffer; // PCM
  sampleRate: number;
  blockAlign: number;
}

function readWav(buf: Buffer): WavInfo {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('GPT-SoVITS 回傳的不是 WAV');
  }
  let fmt: Buffer | null = null;
  let data: Buffer | null = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    // 串流產生的 WAV 有時 data 長度寫 0 或超大 → 直接讀到檔尾
    if (id === 'data' && (size === 0 || start + size > buf.length)) size = buf.length - start;
    const body = buf.subarray(start, start + size);
    if (id === 'fmt ') fmt = body;
    else if (id === 'data') data = body;
    pos = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV 缺少 fmt 或 data');
  return { fmt, data, sampleRate: fmt.readUInt32LE(4), blockAlign: fmt.readUInt16LE(12) };
}

/** 依序接起來，中間各插一小段靜音（換語言時有自然的停頓） */
export function concatWavs(buffers: Buffer[], gapMs = 120): Buffer {
  if (buffers.length === 1) return buffers[0];
  const wavs = buffers.map(readWav);
  const { fmt, sampleRate, blockAlign } = wavs[0];
  const gap = Buffer.alloc(Math.round((sampleRate * gapMs) / 1000) * blockAlign);
  const pieces: Buffer[] = [];
  wavs.forEach((w, i) => {
    if (i > 0) pieces.push(gap);
    pieces.push(w.data);
  });
  const data = Buffer.concat(pieces);
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(header.length - 8 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  const d = 20 + fmt.length;
  header.write('data', d, 'ascii');
  header.writeUInt32LE(data.length, d + 4);
  return Buffer.concat([header, data]);
}
