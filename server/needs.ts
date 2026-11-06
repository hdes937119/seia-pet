/**
 * 需求和目標（人性模擬）：她不是只會被動回應，她自己會「想要」。
 *
 *  需求（0～100，越高越滿足；體力另外由 stamina.ts 管）：
 *    - social 想被陪：主人不理她就慢慢下降（在鎮上上班時有同事，降得慢；深夜睡覺不降）；聊天、摸頭、LINE 會補
 *    - curiosity 好奇心：一直沒看到新東西就下降；上網逛到東西、自己逛到文章會補
 *    - fun 好玩：無聊就下降；鎮上有她參與的事、陪主人打遊戲、逛到有趣的東西會補
 *  需求低的時候：
 *    - 放進聊天提示詞（寂寞、閒得發慌、無聊——用她的方式表現，傲嬌不直說）
 *    - 寂寞又被晾著：主人在電腦前、45 分鐘沒理她 → 主動找主人講話（一天最多 3 次、間隔 2 小時）
 *
 *  目標：
 *    - 每天早上（第一次整理時）依她的興趣、需求、鎮上的劇情、快到的天象，想 1～2 個「今天想做的事」，
 *      並維持 1 個「實習期間的長期目標」。
 *    - 說書人寫鎮上的事時會參考她的目標（進展、挫折、完成），完成的目標會變成鎮上的事件。
 *    - 聊天時她知道自己最近在忙什麼，會自然提到。
 *
 * 存在 data/world/needs.json。
 */
import fs from 'fs';
import path from 'path';

export type NeedId = 'social' | 'curiosity' | 'fun';

export interface Goal {
  id: string;
  text: string;
  kind: 'today' | 'long';
  /** 0～100 */
  progress: number;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'done' | 'dropped';
  /** 最近一次進展的說明 */
  note?: string;
}

interface NeedsState {
  needs: Record<NeedId, number>;
  updatedAt: number;
  goals: Goal[];
  goalsDate: string;
  nudges: { date: string; count: number; lastAt: number };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** 每小時下降多少 */
const DECAY: Record<NeedId, number> = { social: 5, curiosity: 3, fun: 4 };
const LOW = 35;
const NUDGE_IDLE_MS = 45 * 60 * 1000;
const NUDGE_GAP_MS = 2 * HOUR;
const NUDGE_PER_DAY = 3;

const dateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const uid = () => `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export interface NeedsDeps {
  /** 她現在在哪：terra（家）/ town（上班）/ lodging（值夜）/ transit */
  where: () => string;
  /** 主人上一次在電腦前的時間 */
  lastActiveAt: () => number;
  log?: (m: string) => void;
}

export function createNeeds(dataDir: string, deps: NeedsDeps) {
  const file = path.join(dataDir, 'world', 'needs.json');
  let st: NeedsState = {
    needs: { social: 70, curiosity: 70, fun: 70 },
    updatedAt: Date.now(),
    goals: [],
    goalsDate: '',
    nudges: { date: '', count: 0, lastAt: 0 },
  };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(st, null, 2));
      } catch (err: any) {
        deps.log?.(`[需求] 儲存失敗：${err?.message}`);
      }
    }, 500);
  };

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

  /** 把上次到現在的時間換算成下降量 */
  function settle(now = Date.now()) {
    const hours = Math.max(0, Math.min(48, (now - st.updatedAt) / HOUR));
    if (hours <= 0) return;
    const h = new Date(now).getHours();
    const sleeping = h >= 1 && h < 7; // 深夜她也在睡，不會越來越寂寞
    const where = deps.where();
    for (const id of Object.keys(DECAY) as NeedId[]) {
      let rate = DECAY[id];
      if (sleeping) rate *= 0.2;
      // 在鎮上上班時有同事、有事做：不那麼寂寞、不那麼無聊
      if (where === 'town' || where === 'lodging') rate *= id === 'curiosity' ? 1 : 0.4;
      st.needs[id] = clamp(st.needs[id] - rate * hours);
    }
    st.updatedAt = now;
  }

  function satisfy(id: NeedId, amount: number, now = Date.now()) {
    settle(now);
    st.needs[id] = clamp(st.needs[id] + amount);
    save();
  }

  function snapshotNeeds(now = Date.now()) {
    settle(now);
    return { ...st.needs };
  }

  /* ── 目標 ── */

  function activeGoals() {
    return st.goals.filter((g) => g.status === 'active');
  }

  /** 每天第一次：把昨天沒做完的「今天的目標」收掉，需要新目標就回傳 true */
  function needNewGoals(now = Date.now()): boolean {
    if (st.goalsDate === dateKey(now)) return false;
    for (const g of st.goals) {
      if (g.status === 'active' && g.kind === 'today') {
        g.status = 'dropped';
        g.updatedAt = now;
      }
    }
    // 長期目標太久（21 天）沒進展就放下
    for (const g of st.goals) {
      if (g.status === 'active' && g.kind === 'long' && now - g.updatedAt > 21 * DAY) {
        g.status = 'dropped';
        g.updatedAt = now;
      }
    }
    st.goals = st.goals.slice(-40);
    save();
    return new Date(now).getHours() >= 6;
  }

  function setGoals(today: string[], long: string | null, now = Date.now()) {
    st.goalsDate = dateKey(now);
    for (const t of today.slice(0, 2)) {
      const text = String(t || '').trim().slice(0, 40);
      if (text) st.goals.push({ id: uid(), text, kind: 'today', progress: 0, createdAt: now, updatedAt: now, status: 'active' });
    }
    const hasLong = st.goals.some((g) => g.kind === 'long' && g.status === 'active');
    if (long && !hasLong) {
      st.goals.push({ id: uid(), text: String(long).trim().slice(0, 50), kind: 'long', progress: 0, createdAt: now, updatedAt: now, status: 'active' });
    }
    save();
    deps.log?.(`[目標] 西雅今天想做：${activeGoals().map((g) => `${g.kind === 'long' ? '（長期）' : ''}${g.text}`).join('、')}`);
  }

  /** 說書人回報目標進展 */
  function progress(id: string, value: number, note?: string, now = Date.now()): Goal | null {
    const g = st.goals.find((x) => x.id === id && x.status === 'active');
    if (!g) return null;
    g.progress = Math.max(g.progress, Math.max(0, Math.min(100, Math.round(Number(value) || 0))));
    g.updatedAt = now;
    if (note) g.note = String(note).slice(0, 60);
    if (g.progress >= 100) {
      g.status = 'done';
      // 完成目標很有成就感
      st.needs.fun = clamp(st.needs.fun + 20);
      deps.log?.(`[目標] 完成了：${g.text}`);
    }
    save();
    return g;
  }

  /** 想目標用的提示詞（server.ts 交給 Gemini） */
  function goalPrompt(context: { interests: string; arcs: string; sky: string; temperament: string }) {
    const longNow = activeGoals().find((g) => g.kind === 'long');
    const recentDone = st.goals.filter((g) => g.status === 'done').slice(-5).map((g) => g.text);
    const n = snapshotNeeds();
    return `你是桌寵貓娘「西雅」，在河木鎮當實習觀測員兼領航員。今天早上，請想想你自己「今天想做的事」。
你的天性：${context.temperament}
你自己的興趣：${context.interests || '（還沒有特別的）'}
鎮上進行中的事：${context.arcs || '（沒有）'}
快到的天象：${context.sky || '（沒有）'}
你現在的狀態：想被陪 ${n.social}/100、好奇心 ${n.curiosity}/100、好玩 ${n.fun}/100（越低越缺）
${longNow ? `你的長期目標：${longNow.text}（進度 ${longNow.progress}%）` : '你還沒有長期目標，請想一個實習期間（幾週）想完成的事。'}
${recentDone.length ? `最近完成過：${recentDone.join('、')}（不要重複）` : ''}

規則：
- today：1～2 件今天在鎮上（或在家）想做的小事，具體、做得到，跟你的天性或興趣有關（例如「把望遠鏡的濾鏡校好」「想跟朔借溫室的放大鏡看蟲」「研究流星雨為什麼叫雙子座」）。不要是跟主人有關的事。
- long：只有在你還沒有長期目標時才給（例如「實習結束前親眼看到一顆彗星」），否則給 null。
只輸出 JSON：{ "today": ["…"], "long": null }`;
  }

  /* ── 主動找主人 ── */

  /** 主人在電腦前、很久沒理她、她又很寂寞 → 該主動找主人講話了嗎 */
  function shouldNudge(lastChatAt: number, now = Date.now()): boolean {
    settle(now);
    if (st.needs.social >= LOW) return false;
    if (deps.where() !== 'terra') return false;
    if (now - deps.lastActiveAt() > 5 * 60 * 1000) return false; // 主人不在電腦前
    if (now - lastChatAt < NUDGE_IDLE_MS) return false;
    const today = dateKey(now);
    if (st.nudges.date !== today) st.nudges = { date: today, count: 0, lastAt: 0 };
    if (st.nudges.count >= NUDGE_PER_DAY || now - st.nudges.lastAt < NUDGE_GAP_MS) return false;
    return true;
  }

  function noteNudge(now = Date.now()) {
    const today = dateKey(now);
    if (st.nudges.date !== today) st.nudges = { date: today, count: 0, lastAt: 0 };
    st.nudges.count++;
    st.nudges.lastAt = now;
    save();
  }

  /* ── 給聊天提示詞 ── */

  function describeForChat(now = Date.now()): string {
    const n = snapshotNeeds(now);
    const feelings: string[] = [];
    if (n.social < LOW) feelings.push('最近主人比較少陪你，你有點寂寞');
    if (n.curiosity < LOW) feelings.push('最近沒看到什麼新鮮的東西，你有點閒得發慌');
    if (n.fun < LOW) feelings.push('最近沒什麼好玩的事，你有點無聊');
    if (n.social > 85) feelings.push('今天被主人陪得很滿足，心情特別好');
    const goals = activeGoals();
    const goalLines = goals.map(
      (g) => `- ${g.kind === 'long' ? '（長期）' : '（今天）'}${g.text}${g.progress ? `：進度 ${g.progress}%` : ''}${g.note ? `（${g.note}）` : ''}`
    );
    const done = st.goals.filter((g) => g.status === 'done' && now - g.updatedAt < 2 * DAY).map((g) => g.text);
    if (!feelings.length && !goalLines.length && !done.length) return '';
    return (
      (feelings.length ? `【你現在的感覺】${feelings.join('；')}。（要不要表現出來、怎麼表現，由你自己決定）\n` : '') +
      (goalLines.length ? `【你自己最近想做的事（你自己的目標，不是主人交代的）】\n${goalLines.join('\n')}\n` : '') +
      (done.length ? `【你最近完成的事（可以得意一下）】${done.join('、')}\n` : '') +
      '（這些是你自己的生活，相關時或主人問你在忙什麼時自然提到，不要每句都講。）'
    );
  }

  /** 給說書人：她今天的目標（讓鎮上的事有進展或挫折） */
  function describeForNarrator(): string {
    const goals = activeGoals();
    if (!goals.length) return '';
    return goals.map((g) => `- ${g.id}｜${g.kind === 'long' ? '長期' : '今天'}｜${g.text}｜進度 ${g.progress}%`).join('\n');
  }

  function snapshot(now = Date.now()) {
    return { needs: snapshotNeeds(now), goals: st.goals.slice(-15), nudges: st.nudges };
  }

  return {
    satisfy,
    snapshotNeeds,
    needNewGoals,
    setGoals,
    progress,
    goalPrompt,
    activeGoals,
    shouldNudge,
    noteNudge,
    describeForChat,
    describeForNarrator,
    snapshot,
  };
}

export type Needs = ReturnType<typeof createNeeds>;
