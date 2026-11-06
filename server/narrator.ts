/**
 * 河木鎮的說書人：每隔幾個小時，把「上次寫到現在」這段時間鎮上發生的事寫出來。
 *
 *  素材：她陪主人逛到的東西（explore）＋她自己隨便逛的 Reddit 熱門文章（own）。
 *        素材會被「轉化」成鎮上的事（常常是凱恩攔截到的外地消息、貨船帶來的東西），並記下真的來源。
 *  時間：西雅照主人班表在鎮上上班；不在鎮上的時候發生的事，她是之後聽別人說的。
 *  一致性：每次都把居民現況、關係、進行中的劇情、最近的事、已確定的設定給說書人，寫完再檢查一遍
 *          （不准出現新居民、不准把西雅放在她不在的時間、重要度和數量有上限）。
 *
 *  主人上班時電腦開著（LINE 要用），背景會定期推進；電腦關機的話，下次開機一次補算（最多補 36 小時）。
 */
import { isWorkTime, type Inspiration, type World, type TownEventKind } from './world';
import { inObservationNight, upcomingEvent, OBSERVATION_START_H, OBSERVATION_END_H } from './sky';

const HOUR = 60 * 60 * 1000;
/** 至少隔這麼久才寫一次 */
const MIN_GAP_MS = 4 * HOUR;
/** 關機很久的話，最多補這麼久 */
const MAX_CATCHUP_MS = 36 * HOUR;

/** 她自己會逛的地方（跟主人的興趣無關，讓鎮上的故事有她自己的味道） */
const OWN_SUBREDDITS = [
  'space', 'Astronomy', 'astrophotography', 'interestingasfuck', 'mildlyinteresting', 'todayilearned',
  'cats', 'Cooking', 'gardening', 'CozyPlaces', 'Damnthatsinteresting', 'oddlysatisfying', 'Steampunk', 'trains',
];

export interface NarratorDeps {
  /** 呼叫 Gemini，回傳解析好的 JSON */
  generateJson: (prompt: string) => Promise<any>;
  /** 抓某個 subreddit 的熱門文章 */
  redditHot: (sub: string, limit: number) => Promise<Array<{ title: string; url: string; snippet?: string }>>;
  isRaining: () => Promise<boolean>;
  log?: (msg: string) => void;
  /** 她自己逛到東西時（給興趣系統當「她自己的」觀察） */
  onOwnFind?: (title: string) => void;
  /** 鎮上發生事情時（給興趣系統當「在河木鎮碰到的」觀察） */
  onTownEvent?: (text: string, involvesSeia: boolean) => void;
  /** 西雅自己的目標（「id｜今天／長期｜內容｜進度」一行一個） */
  goals?: () => string;
  /** 說書人回報她的目標有進展 */
  onGoalProgress?: (id: string, progress: number, note?: string) => void;
}

export interface NarrateResult {
  ran: boolean;
  reason?: string;
  events?: Array<{ title: string; at: number }>;
}

/**
 * 寬鬆地解析 JSON：模型偶爾會在 JSON 後面多寫東西（第二份 JSON、說明文字），
 * 這時只取第一個完整的 { … }。
 */
export function parseLooseJson(raw: string): any {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // 找第一個 {，照括號層數找到對應的 }（略過字串裡的括號）
    const start = text.indexOf('{');
    if (start < 0) throw new Error('說書人回傳的不是 JSON');
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
    throw new Error('說書人回傳的 JSON 不完整');
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const label = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 這個時間點西雅在不在河木鎮（上班時段，或特殊觀測夜在觀測站值夜） */
export function seiaInTown(world: World, ms: number): boolean {
  return isWorkTime(world.snapshot().schedule, ms) || Boolean(inObservationNight(ms));
}

/** 這段時間裡，西雅在鎮上的時段（文字描述給說書人看） */
function workSegments(world: World, from: number, to: number): string[] {
  const segs: string[] = [];
  let start: number | null = null;
  const step = 15 * 60 * 1000;
  for (let t = from; t <= to; t += step) {
    const working = seiaInTown(world, t);
    if (working && start === null) start = t;
    if ((!working || t + step > to) && start !== null) {
      segs.push(`${label(start)}～${label(Math.min(t, to))}`);
      start = null;
    }
  }
  return segs;
}

/** 解析說書人給的時間（「11/2 15:30」或「15:30」），落在範圍外就平均分配 */
function parseTime(raw: unknown, from: number, to: number, index: number, total: number): number {
  const s = String(raw || '');
  const m = s.match(/(?:(\d{1,2})\/(\d{1,2})\D*)?(\d{1,2}):(\d{2})/);
  if (m) {
    const d = new Date(to);
    if (m[1] && m[2]) d.setMonth(Number(m[1]) - 1, Number(m[2]));
    d.setHours(Number(m[3]), Number(m[4]), 0, 0);
    let t = d.getTime();
    // 只給時間、沒給日期：如果比結束時間晚，就是前一天
    if (!m[1] && t > to) t -= 24 * HOUR;
    if (t >= from && t <= to) return t;
  }
  return Math.round(from + ((index + 1) / (total + 1)) * (to - from));
}

const DAY = 24 * HOUR;
/** 同時進行中的劇情線最多幾條 */
const MAX_ACTIVE_ARCS = 2;

/**
 * 導演：看最近一週鎮上的事，給說書人這次的方向，避免故事變得公式化。
 *  - 誰很久沒出場 → 讓他出來
 *  - 最近都是小事 → 來一件有點分量的；最近都是大事 → 讓大家喘口氣
 *  - 劇情線太久沒動 → 推一步；拖太久 → 收尾；伏筆一週最多推一小步
 *  - 特殊觀測夜（真實流星雨）前幾天開始鋪陳，當晚一定要寫
 */
export function directorNotes(world: World, from: number, to: number): string[] {
  const st = world.snapshot();
  const notes: string[] = [];
  const week = st.events.filter((e) => to - e.at < 7 * DAY);

  // 出場次數
  const counts = new Map<string, number>();
  for (const r of st.residents) if (!r.occasional) counts.set(r.id, 0);
  for (const e of week) for (const id of e.involves) if (counts.has(id)) counts.set(id, (counts.get(id) || 0) + 1);
  const quiet = [...counts.entries()].sort((a, b) => a[1] - b[1]).filter(([, n]) => n <= 1).slice(0, 2);
  if (week.length >= 3 && quiet.length) notes.push(`最近很少出場的是 ${quiet.map(([id]) => world.nameOf(id)).join('、')}，這次讓至少一位出來。`);
  const captainSeen = week.some((e) => e.involves.includes('captain'));
  if (!captainSeen && Math.random() < 0.15) notes.push('貨船船長很久沒來了，可以讓他的船這次停靠（帶來奇怪的貨）。');

  // 節奏：最近 3 件的分量
  const last3 = st.events.slice(-3);
  if (last3.length === 3 && last3.every((e) => e.importance <= 2)) notes.push('最近都是小事，這次至少一件要有點分量（importance 3～4）：小意外、居民之間的爭執、驚喜。');
  if (last3.length === 3 && last3.filter((e) => e.importance >= 4).length >= 2) notes.push('最近大事很多，這次讓大家喘口氣，寫輕鬆的日常。');
  const conflicts = week.filter((e) => /吵|爭|生氣|摩擦|誤會|搞砸|失敗|抱怨/.test(e.title + e.summary)).length;
  if (week.length >= 4 && conflicts === 0) notes.push('這週太和平了，安排一個小摩擦或誤會（之後可以和好）。');

  // 劇情線
  const active = st.arcs.filter((a) => a.status === 'active');
  for (const a of active) {
    const age = to - a.startedAt;
    const idle = to - a.updatedAt;
    if (a.beats.length >= 5 || age > 10 * DAY) notes.push(`劇情線「${a.title}」（${a.id}）已經拖太久了，這次幫它收尾（填 resolveArcs）。`);
    else if (idle > 2 * DAY) notes.push(`劇情線「${a.title}」（${a.id}）已經 ${Math.round(idle / DAY)} 天沒進展，這次推一步。`);
  }
  const dormant = st.arcs.filter((a) => a.status === 'dormant' || (a.id === 'tower-signal' && a.status === 'active'));
  for (const a of dormant) {
    const lastBeat = a.beats.length ? a.beats[a.beats.length - 1].at : a.startedAt;
    if (to - lastBeat < 7 * DAY) notes.push(`伏筆「${a.title}」（${a.id}）最近才有動靜，這次不要碰它。`);
    else if (Math.random() < 0.3) notes.push(`伏筆「${a.title}」（${a.id}）可以推一小步（只給一點線索，不要揭曉）。`);
  }
  const recentStart = st.arcs.some((a) => to - a.startedAt < 3 * DAY);
  if (active.length >= MAX_ACTIVE_ARCS || recentStart) notes.push('這次不要開新的劇情線（newArc 保持 null）。');
  else if (active.length === 0) notes.push('目前沒有進行中的劇情線，可以開一條新的（跨好幾天的小事件）。');

  // 真實天象
  const soon = upcomingEvent(to, 3);
  if (soon) notes.push(`真實世界再過 ${soon.inDays} 天是${soon.event.name}的極大期（${soon.event.note}）。鎮上的觀測站開始準備，可以寫一點鋪陳（例如西雅在調望遠鏡、居民在問那天能不能一起看）。`);
  for (let t = from; t <= to; t += HOUR) {
    const e = inObservationNight(t);
    if (e) {
      notes.push(
        `${label(t)} 起是${e.name}的極大期夜晚（${e.note}）：西雅那晚留在舊港區官邸、在觀測站值夜（${OBSERVATION_START_H}:00 到隔天 ${OBSERVATION_END_H}:00 她都在鎮上）。這次一定要寫一件她值夜觀測的事（kind 填 special，importance ${e.major ? 5 : 4}），可以有居民跑來一起看。`
      );
      break;
    }
  }
  return notes;
}

async function gatherInspirations(world: World, deps: NarratorDeps): Promise<Inspiration[]> {
  // 自己逛一下：隨機挑 2 個她喜歡的 subreddit，各拿一篇還沒用過的熱門文章
  // 一次只逛一個（Reddit 很容易因為連續請求回 429）；逛不到就用之前存下來還沒用過的
  const picks = [...OWN_SUBREDDITS].sort(() => Math.random() - 0.5).slice(0, 1);
  for (const sub of picks) {
    try {
      const posts = (await deps.redditHot(sub, 15)).filter((p) => !/\[?mod\]?|announcement|rules|megathread/i.test(p.title));
      const post = posts[Math.floor(Math.random() * Math.min(posts.length, 8))];
      if (post) {
        world.addInspiration({ title: post.title, url: post.url, source: `r/${sub}`, snippet: post.snippet, from: 'own' });
        deps.onOwnFind?.(`${post.title}（r/${sub}）`);
      }
    } catch (err: any) {
      deps.log?.(`[河木鎮] 這次逛不到 r/${sub}（${err?.status || err?.message}），用之前存的素材`);
    }
  }
  const all = world.unusedInspirations();
  // 陪主人逛到的最多 2 個、自己逛的最多 2 個（不要讓鎮上變成主人興趣的鏡子）
  const explore = all.filter((i) => i.from === 'explore').slice(-2);
  const own = all.filter((i) => i.from === 'own').slice(-2);
  return [...own, ...explore];
}

function buildPrompt(world: World, from: number, to: number, count: number, items: Inspiration[], raining: boolean, notes: string[] = [], goals = '') {
  const st = world.snapshot();
  const residents = st.residents
    .map((r) => `- ${r.id}｜${r.name}｜${r.role}｜個性：${r.personality}｜說話：${r.speech || ''}${r.status ? `｜最近：${r.status}` : ''}${r.occasional ? '｜（不定期才出現）' : ''}`)
    .join('\n');
  const bonds = st.bonds.map((b) => `- ${world.nameOf(b.a)}↔${world.nameOf(b.b)}：${b.value}（${b.note}）`).join('\n');
  const arcs = st.arcs
    .filter((a) => a.status !== 'resolved')
    .map((a) => `- ${a.id}｜${a.status === 'dormant' ? '伏筆（還沒浮上檯面）' : '進行中'}｜「${a.title}」${a.summary}${a.beats.length ? `｜進展：${a.beats.slice(-3).map((b) => b.text).join(' → ')}` : ''}`)
    .join('\n');
  const recent = st.events
    .slice(-12)
    .map((e) => `- ${label(e.at)} ${e.title}：${e.summary}`)
    .join('\n');
  const facts = world
    .liveFacts()
    .slice(-30)
    .map((f) => `- ${f.key ? `［${f.key}］` : ''}${f.subject}：${f.text}`)
    .join('\n');
  const segs = workSegments(world, from, to);
  const material = items
    .map((it, i) => `${i}. ${it.title}${it.snippet ? `（${it.snippet.slice(0, 120)}）` : ''}［${it.source || ''}］`)
    .join('\n');

  return `你是「河木鎮」的說書人，負責寫出鎮上這段時間發生的事。這些事之後會由西雅（雙子星貓，傲嬌貓娘，鎮上的實習觀測員兼領航員）跟她的主人分享。

【世界】
${st.town.name}：${st.town.desc}
西雅：${st.seia.home}；工作地點${st.seia.workplace}；${st.seia.lodging}。主人住在${st.master.home}。
地點（place 只能用這些 id）：${st.places.map((p) => `${p.id}｜${p.name}`).join('、')}

【居民（只能用這些人，絕對不能新增居民）】
${residents}

【關係】
${bonds}

【劇情線】
${arcs || '（目前沒有）'}

【最近發生過的事（不要重複類似的事）】
${recent || '（還沒有）'}

【已經確定的設定（不能矛盾）】
${facts || '（還沒有）'}

【這次要寫的時間】${label(from)} ～ ${label(to)}
西雅在鎮上的時段（上班或值夜）：${segs.length ? segs.join('；') : '這段時間她都不在鎮上（休假或在泰拉）'}
→ 只有在這些時段發生的事，西雅才能在場（involves 才能有 seia）；其他時間發生的事，她是之後聽別人說的。
天氣：${raining ? '外面在下雨（西雅超討厭下雨）' : '沒下雨'}

【這次的素材（她逛到的真實文章／影片）】
${material || '（這次沒有素材，就寫日常小事）'}
素材的用法：把它「轉化」成鎮上合理會發生的事，例如凱恩在通訊台攔截到外地的消息、貨船帶來的怪東西、某個居民看到後跑去試。不要照搬現實的人名、品牌、地名；有用到素材就填 inspiration（素材編號），沒用到填 -1。不一定每個素材都要用。

${goals ? `【西雅自己的目標（她自己想做的事）】\n${goals}\n她在鎮上的時段，可以寫一件她為這些目標努力的事（有進展、卡關或意外的發現都可以），並在 goalProgress 回報新的進度（0～100，做完就是 100）；沒寫到就不用回報。\n\n` : ''}${notes.length ? `【導演這次的要求（優先遵守）】\n${notes.map((n) => `- ${n}`).join('\n')}\n\n` : ''}【寫作規則】
1. 寫 ${count} 件事，彼此不同類型（日常趣事、居民之間的互動或摩擦、工作上的事、劇情線的進展…），不要全部都是好事，要有一點小麻煩或小衝突。
2. 溫馨、帶點幽默；不寫沉重的悲劇、不寫死亡和重傷。
3. 居民有自己的生活和煩惱，不要繞著西雅的主人轉。
4. 可以推進進行中的劇情線（填 arcId）；伏筆劇情線很久才推一小步，不要急著揭曉。最多開 1 條新的劇情線（跨好幾天的小事件，例如準備祭典、某人在搞神秘計畫）。
5. 每件事 summary 40～90 字，用第三人稱、繁體中文。
6. 居民狀況有改變才更新（statusUpdates）；關係有變化才調整（bondChanges，delta 在 -10～10）；寫到新的、之後要保持一致的設定才放進 newFacts。

只輸出 JSON：
{
  "events": [
    { "time": "M/D HH:MM", "title": "8～16 字的標題", "summary": "…", "place": "地點 id", "involves": ["居民 id 或 seia"], "importance": 2, "kind": "daily", "arcId": "", "inspiration": -1 }
  ],
  "statusUpdates": [{ "resident": "居民 id", "status": "20 字內" }],
  "bondChanges": [{ "a": "id", "b": "id", "delta": 0, "note": "20 字內" }],
  "newFacts": [{ "subject": "居民 id 或地點名", "key": "對象.面向", "text": "一句話", "replace": false }],
  "newArc": null,
  "resolveArcs": [],
  "goalProgress": []
}
欄位說明：importance 是 1～5；kind 是 daily、arc 或 special；arcId 是劇情線 id（沒有就空字串）；inspiration 是素材編號（沒用素材填 -1）；
delta 是 -10～10 的整數；要開新劇情線時 newArc 改成 { "title": "…", "summary": "…", "involves": ["id"] }，不開就保持 null；
newFacts 的 key 是「對象.面向」（例如「米拉.家人」「溫室.管理者」）；故事發展讓舊設定改變了（例如搬家、換工作）才把 replace 設成 true，取代同一個 key 的舊設定；
goalProgress：[{ "id": "目標 id", "progress": 0～100, "note": "15 字內的進展" }]；
要收尾的劇情線放進 resolveArcs：[{ "id": "劇情線 id", "ending": "一句話結局" }]（收尾那件事也要寫進 events、填同一個 arcId）。
只輸出一份 JSON，JSON 後面不要再寫任何東西。`;
}

/** 檢查時間到了沒（電腦一直開著時，大約每 4 小時寫一次；深夜不寫） */
export function narrationDue(world: World, now = Date.now()): boolean {
  const h = new Date(now).getHours();
  if (h < 7) return false;
  const last = world.snapshot().narratedUntil;
  return !last || now - last >= MIN_GAP_MS;
}

let running = false;

export async function narrate(world: World, deps: NarratorDeps, opts: { force?: boolean } = {}, now = Date.now()): Promise<NarrateResult> {
  if (running) return { ran: false, reason: '說書人已經在寫了' };
  if (!opts.force && !narrationDue(world, now)) return { ran: false, reason: '還不到時間' };
  running = true;
  try {
    const last = world.snapshot().narratedUntil;
    const from = Math.max(last || now - 8 * HOUR, now - MAX_CATCHUP_MS);
    const to = now;
    const hours = (to - from) / HOUR;
    const count = Math.max(1, Math.min(3, Math.round(hours / 5)));

    const items = await gatherInspirations(world, deps);
    const raining = await deps.isRaining().catch(() => false);
    const notes = directorNotes(world, from, to);
    if (notes.length) deps.log?.(`[河木鎮] 導演：${notes.map((n) => n.split('：')[0].slice(0, 30)).join('｜')}`);
    const plan = await deps.generateJson(buildPrompt(world, from, to, count, items, raining, notes, deps.goals?.() || ''));

    const st = world.snapshot();
    const validId = (id: unknown) => id === 'seia' || st.residents.some((r) => r.id === id || r.name === id);
    const placeOf = (p: unknown) => st.places.find((x) => x.id === p || x.name === p)?.id;
    const rawEvents: any[] = Array.isArray(plan?.events) ? plan.events.slice(0, 3) : [];

    // 新劇情線先建，事件才能掛上去
    let newArcId = '';
    const activeArcs = st.arcs.filter((a) => a.status === 'active').length;
    if (plan?.newArc?.title && plan?.newArc?.summary && activeArcs < MAX_ACTIVE_ARCS) {
      const arc = world.startArc(plan.newArc.title, plan.newArc.summary, (plan.newArc.involves || []).filter(validId));
      newArcId = arc.id;
      deps.log?.(`[河木鎮] 新劇情線：${arc.title}`);
    }

    const used = new Set<Inspiration>();
    const written: Array<{ title: string; at: number }> = [];
    rawEvents.forEach((e, i) => {
      const title = String(e?.title || '').trim();
      const summary = String(e?.summary || '').trim();
      if (!title || !summary) return;
      const at = parseTime(e.time, from, to, i, rawEvents.length);
      let involves: string[] = (Array.isArray(e.involves) ? e.involves : []).filter(validId);
      // 西雅不在鎮上的時間，不能讓她在場
      if (involves.includes('seia') && !seiaInTown(world, at)) involves = involves.filter((x) => x !== 'seia');
      const arcId = e.arcId && st.arcs.some((a) => a.id === e.arcId) ? e.arcId : e.arcId && newArcId ? newArcId : undefined;
      const insp = Number.isInteger(e.inspiration) ? items[e.inspiration] : undefined;
      if (insp) used.add(insp);
      const kind: TownEventKind = ['daily', 'arc', 'special'].includes(e.kind) ? e.kind : arcId ? 'arc' : 'daily';
      world.addEvent({
        at,
        title: title.slice(0, 24),
        summary: summary.slice(0, 160),
        place: placeOf(e.place),
        involves,
        importance: Number(e.importance) || 2,
        kind,
        arcId,
        inspiration: insp ? { title: insp.title, url: insp.url, source: insp.source } : undefined,
      });
      written.push({ title, at });
      deps.onTownEvent?.(`${title}：${summary.slice(0, 80)}`, involves.includes('seia'));
    });

    for (const u of Array.isArray(plan?.statusUpdates) ? plan.statusUpdates.slice(0, 4) : []) {
      if (u?.resident && u?.status) world.setStatus(u.resident, u.status);
    }
    for (const b of Array.isArray(plan?.bondChanges) ? plan.bondChanges.slice(0, 4) : []) {
      if (validId(b?.a) && validId(b?.b) && b.a !== b.b) world.adjustBond(b.a, b.b, Math.max(-10, Math.min(10, Number(b.delta) || 0)), b.note);
    }
    for (const f of Array.isArray(plan?.newFacts) ? plan.newFacts.slice(0, 3) : []) {
      if (f?.subject && f?.text) world.addFact(f.subject, f.text, 'narrator', { key: f.key, replace: f.replace === true });
    }
    for (const g of Array.isArray(plan?.goalProgress) ? plan.goalProgress.slice(0, 3) : []) {
      if (g?.id && Number.isFinite(Number(g.progress))) deps.onGoalProgress?.(String(g.id), Number(g.progress), g.note);
    }
    for (const r of Array.isArray(plan?.resolveArcs) ? plan.resolveArcs.slice(0, 2) : []) {
      const arc = st.arcs.find((a) => a.id === r?.id && a.status !== 'resolved');
      // 伏筆不准被說書人自己收掉
      if (arc && arc.id !== 'tower-signal' && world.resolveArc(arc.id, String(r.ending || ''))) deps.log?.(`[河木鎮] 劇情線結束：${arc.title}`);
    }

    world.markInspirationsUsed([...used]);
    world.setNarratedUntil(to);
    for (const w of written) deps.log?.(`[河木鎮] ${label(w.at)} ${w.title}`);
    return { ran: true, events: written };
  } finally {
    running = false;
  }
}
