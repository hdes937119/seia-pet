/**
 * 說話範例池：她以前說過、主人有反應的話（主人笑了、說可愛、說謝謝…），
 * 每次聊天隨機抽 2～3 句「不同風格」的放進提示詞，當她自己說話方式的參考。
 *
 * 跟「把高分句型固定下來」相反：一直輪換（用過次數少的優先、開頭不同的才一起出現），
 * 不讓同一種說法、同一個梗被強化成口頭禪。主人拒絕過的稱呼不會被抽到。
 *
 * 存在 data/memories/voice.json（最多 80 句，舊的先丟）。
 */
import fs from 'fs';
import path from 'path';

export interface VoiceSample {
  text: string;
  at: number;
  /** 主人當時的反應（截短） */
  reaction: string;
  uses: number;
}

const MAX = 80;
const REACT_WINDOW_MS = 15 * 60 * 1000;
/** 主人有正面反應 */
const POSITIVE = /(哈哈|笑死|笑爛|XD|xd|LOL|lol|ww|🤣|😂|😆|好可愛|可愛|好好笑|太好笑|好耶|讚|喜歡妳|喜歡你|愛妳|愛你|謝謝妳|謝謝你|謝啦|好棒|厲害|妳懂我|你懂我)/;
/** 明顯是反話或不喜歡 */
const NEGATIVE = /(不好笑|沒有好笑|不可愛|別再|不要再|無聊|好煩|閉嘴)/;

export function createVoicePool(dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'memories', 'voice.json');
  let samples: VoiceSample[] = [];
  try {
    if (fs.existsSync(file)) samples = JSON.parse(fs.readFileSync(file, 'utf8'))?.samples || [];
  } catch {
    samples = [];
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ samples }, null, 2));
      } catch {
        // 不影響聊天
      }
    }, 1000);
  };

  /** 這句話適合當範例嗎（不收螢幕吐槽模板、分享卡片、貼圖、太短太長的） */
  function usable(text: string): string {
    const t = String(text || '')
      .replace(/\[\[NEXT\]\]/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length < 6 || t.length > 120) return '';
    if (t.startsWith('👀') || t.includes('【') || t.includes('（分享了') || t.includes('[[STICKER')) return '';
    return t;
  }

  /** 主人說了一句話：如果是在回應她 15 分鐘內的上一句、而且是正面反應 → 收進範例池 */
  function noteReaction(petText: string, petAt: number, masterText: string, masterAt = Date.now()): boolean {
    const m = String(masterText || '');
    if (!petAt || masterAt - petAt > REACT_WINDOW_MS || masterAt < petAt) return false;
    if (!POSITIVE.test(m) || NEGATIVE.test(m)) return false;
    const t = usable(petText);
    if (!t || samples.some((s) => s.text === t)) return false;
    samples.push({ text: t, at: petAt, reaction: m.replace(/\s+/g, ' ').slice(0, 30), uses: 0 });
    if (samples.length > MAX) samples = samples.slice(-MAX);
    save();
    log(`[範例池] 主人對「${t.slice(0, 24)}」有反應（${m.slice(0, 12)}），收進說話範例`);
    return true;
  }

  /** 抽 n 句：用過次數少的優先、隨機、開頭不同；含被拒稱呼的不抽 */
  function pick(n = 3, avoid: string[] = []): VoiceSample[] {
    const ok = samples.filter((s) => !avoid.some((a) => a.length >= 2 && s.text.includes(a)));
    const shuffled = ok
      .map((s) => ({ s, r: Math.random() }))
      .sort((a, b) => a.s.uses - b.s.uses || a.r - b.r)
      .map((x) => x.s);
    const out: VoiceSample[] = [];
    for (const s of shuffled) {
      if (out.length >= n) break;
      const head = s.text.slice(0, 4);
      if (out.some((o) => o.text.slice(0, 4) === head)) continue;
      out.push(s);
    }
    return out;
  }

  /** 給聊天提示詞：至少有 2 句才放 */
  function describeForChat(avoid: string[] = []): string {
    const list = pick(3, avoid);
    if (list.length < 2) return '';
    for (const s of list) s.uses++;
    save();
    return `【你以前說過、主人有反應的話（只是讓你記得自己說話的感覺；不要照抄句子，也不要重複裡面的梗）】\n${list.map((s) => `「${s.text}」`).join('\n')}`;
  }

  function remove(text: string) {
    const before = samples.length;
    samples = samples.filter((s) => s.text !== text);
    if (samples.length !== before) save();
    return samples.length !== before;
  }

  function snapshot() {
    return { count: samples.length, samples: [...samples].reverse() };
  }

  return { noteReaction, pick, describeForChat, remove, snapshot };
}

export type VoicePool = ReturnType<typeof createVoicePool>;
