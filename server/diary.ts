/**
 * 西雅的日記、夢境和紀念日（借 astrbot private_companion 的「日記、夢境、互動紀念日」）。
 *
 *  - 日記：每晚 23 點後（或隔天早上補寫昨天的）用她的口吻寫一篇短日記：今天鎮上的事、跟主人聊了什麼、
 *    自己的目標有沒有進展、心情。主人問起時她可以讀一段給你聽。
 *  - 夢境：大約四成的夜晚會做夢（把當天的東西用奇怪的方式拼在一起）。早上見面時迷迷糊糊地講給主人聽，講過就不再講。
 *  - 紀念日：
 *      固定的：11/1 主人幫她取名「西雅」、11/2 第一天到河木鎮實習
 *      自動的：寫日記時，從今天跟主人之間的事裡找「第一次」（第一次一起看流星雨、第一次聊到天亮…），
 *              只收真的發生、而且有日期的事
 *    每年同一天是 N 週年；第一年每個月同一天是「滿 N 個月」。當天她會知道，自然地提起。
 *
 * 存在 data/world/diary.json。
 */
import fs from 'fs';
import path from 'path';

export interface DiaryEntry {
  /** YYYY-MM-DD（寫的是哪一天） */
  date: string;
  text: string;
  dream?: string;
  dreamTold?: boolean;
  writtenAt: number;
}

export interface Anniversary {
  id: string;
  /** 發生的日期 YYYY-MM-DD */
  date: string;
  title: string;
  kind: 'seed' | 'auto';
}

interface DiaryState {
  entries: DiaryEntry[];
  anniversaries: Anniversary[];
}

const SEEDS: Anniversary[] = [
  { id: 'seed-name', date: '2026-11-01', title: '主人幫你取名「西雅」', kind: 'seed' },
  { id: 'seed-rivertown', date: '2026-11-02', title: '你第一天到河木鎮實習', kind: 'seed' },
];

const DREAM_CHANCE = 0.4;
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface DiaryInputs {
  /** 那一天鎮上的事（標題：摘要） */
  townEvents: string[];
  /** 那一天跟主人有關的事（事件日記的摘要） */
  masterEvents: string[];
  /** 那一天她的目標（含有沒有完成） */
  goals: string[];
  /** 她現在的心情描述 */
  mood: string;
  /** 她的性格與語氣 */
  persona: string;
  /** 那一天在工坊做的東西（含失敗） */
  workshop?: string[];
  /** 那一天的額度（用得多才有） */
  budget?: string;
  /** 那一天她自己的時間做了什麼（自己決定的事、畫室） */
  ownTime?: string[];
}

export function createDiary(dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'world', 'diary.json');
  let st: DiaryState = { entries: [], anniversaries: [...SEEDS] };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  for (const s of SEEDS) if (!st.anniversaries.some((a) => a.id === s.id)) st.anniversaries.push(s);
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        st.entries = st.entries.slice(-120);
        fs.writeFileSync(file, JSON.stringify(st, null, 2));
      } catch (err: any) {
        log(`[日記] 儲存失敗：${err?.message}`);
      }
    }, 500);
  };

  const entry = (date: string) => st.entries.find((e) => e.date === date);

  /** 現在該寫哪一天的日記（沒有要寫就回傳 null） */
  function due(now = Date.now()): string | null {
    const h = new Date(now).getHours();
    const today = dayKey(now);
    if (h >= 23 && !entry(today)) return today;
    // 早上補寫昨天的（例如昨晚很早就關機）
    if (h >= 5 && h < 23) {
      const y = dayKey(now - 24 * 60 * 60 * 1000);
      if (!entry(y)) return y;
    }
    return null;
  }

  function prompt(date: string, inputs: DiaryInputs, withDream: boolean) {
    return `你是桌寵貓娘「西雅」，在河木鎮當實習觀測員，平常住在主人（在泰拉）家。現在是睡前，請用第一人稱寫 ${date} 的日記。
${inputs.persona}
今天鎮上的事：
${inputs.townEvents.length ? inputs.townEvents.map((t) => `- ${t}`).join('\n') : '（沒什麼特別的）'}
今天跟主人有關的事：
${inputs.masterEvents.length ? inputs.masterEvents.map((t) => `- ${t}`).join('\n') : '（沒有特別記下的）'}
你自己的目標：${inputs.goals.length ? inputs.goals.join('；') : '（沒有）'}
${inputs.ownTime?.length ? `今天你自己的時間：${inputs.ownTime.join('；')}\n` : ''}${inputs.workshop?.length ? `今天在工坊：${inputs.workshop.join('；')}\n` : ''}${inputs.budget ? `今天的額度：${inputs.budget}\n` : ''}你現在的心情：${inputs.mood || '普通'}

規則：
- diary：80～150 字，像真的日記（有自己的感想、小抱怨、傲嬌），只寫上面真的有的事，不要編新的大事。工坊做壞了、目標沒做完就照實寫，可以不甘心，但不要美化成成功。
- ${withDream ? 'dream：今晚你做了一個夢，40～80 字，把今天的東西用奇怪、夢一樣的方式拼在一起（可以荒謬、可愛，不要恐怖）。' : 'dream：今晚沒做夢，給 null。'}
- firsts：只從「今天跟主人有關的事」裡，找出主人和你之間真的「第一次」發生的事（例如第一次一起看流星雨、第一次聊到天亮、第一次一起玩某個遊戲），沒有就給空陣列。每個 15 字內，用「第一次…」開頭。不要從鎮上的事找。
只輸出 JSON：{ "diary": "…", "dream": ${withDream ? '"…"' : 'null'}, "firsts": [] }`;
  }

  /** 寫日記（generateJson 由 server.ts 給） */
  async function write(date: string, inputs: DiaryInputs, generateJson: (p: string) => Promise<any>) {
    if (entry(date)) return null;
    const withDream = Math.random() < DREAM_CHANCE;
    const out = await generateJson(prompt(date, inputs, withDream));
    const text = String(out?.diary || '').trim();
    if (!text) throw new Error('日記是空的');
    const e: DiaryEntry = {
      date,
      text: text.slice(0, 400),
      dream: withDream && out?.dream ? String(out.dream).trim().slice(0, 200) : undefined,
      writtenAt: Date.now(),
    };
    st.entries.push(e);
    for (const f of Array.isArray(out?.firsts) ? out.firsts.slice(0, 2) : []) {
      const title = String(f || '').trim().slice(0, 30);
      if (!title.startsWith('第一次')) continue;
      if (st.anniversaries.some((a) => a.title === title)) continue;
      st.anniversaries.push({ id: `auto-${date}-${st.anniversaries.length}`, date, title, kind: 'auto' });
      log(`[紀念日] 記下了：${date} ${title}`);
    }
    save();
    log(`[日記] 寫好 ${date} 的日記${e.dream ? '（還做了一個夢）' : ''}`);
    return e;
  }

  /** 昨晚的夢（還沒講過）；講了就標記 */
  function takeDream(now = Date.now()): string | null {
    const candidates = [dayKey(now), dayKey(now - 24 * 60 * 60 * 1000)];
    for (const d of candidates) {
      const e = entry(d);
      if (e?.dream && !e.dreamTold && now - e.writtenAt < 16 * 60 * 60 * 1000) {
        e.dreamTold = true;
        save();
        return e.dream;
      }
    }
    return null;
  }

  /** 今天是哪些紀念日（N 週年、第一年的滿 N 個月） */
  function todayAnniversaries(now = Date.now()): string[] {
    const d = new Date(now);
    const out: string[] = [];
    for (const a of st.anniversaries) {
      const [y, m, day] = a.date.split('-').map(Number);
      if (!y || !m || !day) continue;
      const years = d.getFullYear() - y;
      if (d.getMonth() + 1 === m && d.getDate() === day && years >= 1) {
        out.push(`今天是${a.title}的 ${years} 週年`);
        continue;
      }
      const months = years * 12 + (d.getMonth() + 1 - m);
      if (d.getDate() === day && months >= 1 && months < 12) out.push(`今天是${a.title}滿 ${months} 個月`);
    }
    return out;
  }

  /** 還沒講過的夢（不標記） */
  function untoldDream(now = Date.now()): DiaryEntry | null {
    for (const d of [dayKey(now), dayKey(now - 24 * 60 * 60 * 1000)]) {
      const e = entry(d);
      if (e?.dream && !e.dreamTold && now - e.writtenAt < 16 * 60 * 60 * 1000) return e;
    }
    return null;
  }

  /** 她的回覆講到夢了 → 標記講過 */
  function markDreamIfMentioned(reply: string, now = Date.now()) {
    const e = untoldDream(now);
    if (!e || !e.dream) return;
    const text = String(reply || '');
    if (!/夢/.test(text)) return;
    const grams = new Set<string>();
    const c = e.dream.replace(/[^\p{L}\p{N}]/gu, '');
    for (let i = 0; i < c.length - 1; i++) grams.add(c.slice(i, i + 2));
    let hit = 0;
    for (const g of grams) if (text.includes(g)) hit++;
    if (hit >= 2) {
      e.dreamTold = true;
      save();
    }
  }

  /** 給聊天提示詞 */
  function describeForChat(now = Date.now()): string {
    const ann = todayAnniversaries(now);
    const last = [...st.entries].sort((a, b) => a.date.localeCompare(b.date)).pop();
    const parts: string[] = [];
    const dream = untoldDream(now);
    if (dream?.dream && new Date(now).getHours() < 14) parts.push(`【昨晚的夢（還沒跟主人說）】「${dream.dream}」。聊天時找個自然的時機提一下（例如主人問你睡得好不好），像剛醒來記得的片段。`);
    if (ann.length) parts.push(`【今天是紀念日】${ann.join('；')}。你記得這件事，可以找個自然的時機提起（傲嬌也行），不要每句都講。`);
    if (last) parts.push(`【你的日記】你有睡前寫日記的習慣。最近一篇（${last.date}）：「${last.text}」（主人問起你的日記或那天過得怎樣時，才讀一段或轉述，不要主動整篇念出來）`);
    return parts.join('\n');
  }

  function snapshot() {
    return { entries: st.entries.slice(-14), anniversaries: st.anniversaries };
  }

  return { due, write, takeDream, markDreamIfMentioned, todayAnniversaries, describeForChat, snapshot };
}

export type Diary = ReturnType<typeof createDiary>;
