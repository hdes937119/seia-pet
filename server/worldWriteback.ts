/**
 * 聊天即興內容寫回世界紀錄。
 *
 * 西雅跟主人聊鎮上的事時，常常會隨口補細節（「米拉其實有個妹妹在星港工作」「今天小卡又把貨送錯了」）。
 * 這些話主人已經聽到了，如果沒記下來，下次說書人可能寫出矛盾的劇情。
 * 所以她每次講到鎮上的事，就在背景請 Gemini 把「新的、之後要保持一致的設定」抽出來，寫進世界紀錄：
 *   - facts：之後要一直成立的設定（人物背景、喜好、習慣、地點特徵…）
 *   - events：她說「今天 / 剛剛」鎮上發生、但紀錄裡沒有的小事（記成已經跟主人說過）
 * 跟已經確定的設定矛盾的不寫（記在 log 裡）。只在回覆有提到鎮上的人或地方時才跑，而且有冷卻時間。
 */
import type { World } from './world';

const COOLDOWN_MS = 60 * 1000;
const MAX_FACTS = 2;

let lastRunAt = 0;
let running = false;

function bigrams(t: string) {
  const c = String(t).replace(/[^\p{L}\p{N}]/gu, '');
  const out = new Set<string>();
  for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
  return out;
}

/** 兩句話是不是在講同一件事（字的重疊比例） */
export function similar(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return hit / Math.min(x.size, y.size);
}

/** 她的回覆有沒有講到鎮上的人或地方 */
export function mentionsTown(world: World, text: string): boolean {
  const st = world.snapshot();
  const words = [
    st.town.name,
    '鎮上',
    '觀測站',
    '官邸',
    ...st.residents.map((r) => r.name),
    ...st.places.map((p) => p.name),
  ].filter((w) => w && w.length >= 2);
  return words.some((w) => text.includes(w));
}

function buildPrompt(world: World, userText: string, reply: string) {
  const st = world.snapshot();
  return `你在幫一個故事世界「${st.town.name}」維護設定紀錄。西雅（貓娘，鎮上的實習觀測員）剛剛跟她的主人聊天，她可能隨口補了一些鎮上的細節。
請找出她（或主人說、她也接受的）「新的、之後要保持一致」的內容。

【居民】${st.residents.map((r) => `${r.id}｜${r.name}｜${r.role}`).join('；')}
【地點】${st.places.map((p) => `${p.id}｜${p.name}`).join('；')}
【已經確定的設定】
${world.liveFacts().slice(-40).map((f) => `- ${f.key ? `［${f.key}］` : ''}${f.subject}：${f.text}`).join('\n') || '（還沒有）'}
【紀錄裡最近發生的事】
${st.events.slice(-10).map((e) => `- ${e.title}：${e.summary}`).join('\n') || '（還沒有）'}

【這次的對話】
主人：${userText.slice(0, 400)}
西雅：${reply.slice(0, 800)}

規則：
1. facts 只收「之後要一直成立」的具體設定：人物背景、家人、喜好、習慣、外表、地點的特徵等。不要收玩笑、比喻、假設、問句、情緒，也不要收已經有的設定。最多 ${MAX_FACTS} 條，每條 40 字內。
   每條加上 key「對象.面向」（例如「米拉.家人」「凱恩.怕的東西」），同一件事用同一個 key。
   byMaster：這條是主人說的（或主人糾正、她也接受）就填 true；她自己隨口說的填 false。
2. events 只收她說「今天 / 剛剛 / 昨天」鎮上發生、但紀錄裡沒有的事，最多 1 件。
3. 跟已經確定的設定矛盾的，不要放進 facts 或 events，改寫在 conflicts。
4. 什麼都沒有就回傳空陣列。只能用上面列出的居民和地點 id。

只輸出一份 JSON：
{ "facts": [{ "subject": "居民 id 或地點 id", "key": "對象.面向", "text": "…", "byMaster": false }], "events": [{ "title": "8～16 字", "summary": "40～80 字", "place": "地點 id 或空字串", "involves": ["居民 id 或 seia"], "when": "today" }], "conflicts": ["…"] }`;
}

export interface WritebackDeps {
  generateJson: (prompt: string) => Promise<any>;
  log?: (msg: string) => void;
}

/** 聊完之後在背景呼叫（不用等） */
export async function writebackFromChat(world: World, deps: WritebackDeps, userText: string, reply: string, now = Date.now()) {
  const text = String(reply || '');
  if (!text || running || now - lastRunAt < COOLDOWN_MS || !mentionsTown(world, text)) return;
  running = true;
  lastRunAt = now;
  try {
    const out = await deps.generateJson(buildPrompt(world, String(userText || ''), text));
    const st = world.snapshot();
    const validWho = (id: unknown) => id === 'seia' || st.residents.some((r) => r.id === id || r.name === id);
    const validSubject = (s: unknown) => validWho(s) || st.places.some((p) => p.id === s || p.name === s) || s === st.town.name;

    for (const f of Array.isArray(out?.facts) ? out.facts.slice(0, MAX_FACTS) : []) {
      const factText = String(f?.text || '').trim().slice(0, 60);
      if (!factText || !validSubject(f?.subject)) continue;
      // 已經有差不多的設定就不重複記
      if (world.liveFacts().some((x) => similar(x.text, factText) >= 0.6)) continue;
      // 同一個 key 已經有設定：主人說的才能取代（主人說了算）；她自己隨口說的不能推翻已經定下的設定
      const byMaster = f.byMaster === true;
      const old = f.key ? world.factByKey(String(f.key)) : undefined;
      const saved = world.addFact(String(f.subject), factText, byMaster ? 'master' : 'chat', { key: f.key, replace: byMaster });
      if (saved && old && saved.id !== old.id) deps.log?.(`[河木鎮] 主人更新了設定：${old.text} → ${saved.text}`);
      else if (saved) deps.log?.(`[河木鎮] 記下聊天時說的設定：${saved.subject}：${saved.text}`);
      else if (old) deps.log?.(`[河木鎮] ⚠️ 她剛剛說的「${factText}」跟已定的「${old.text}」不一樣，沒有記下`);
    }

    const ev = Array.isArray(out?.events) ? out.events[0] : null;
    if (ev?.title && ev?.summary && !st.events.slice(-15).some((e) => similar(e.title + e.summary, ev.title + ev.summary) >= 0.5)) {
      const place = st.places.find((p) => p.id === ev.place || p.name === ev.place)?.id;
      const at = ev.when === 'yesterday' ? now - 24 * 60 * 60 * 1000 : now - 30 * 60 * 1000;
      world.addEvent({
        at,
        title: String(ev.title).slice(0, 24),
        summary: String(ev.summary).slice(0, 160),
        place,
        involves: (Array.isArray(ev.involves) ? ev.involves : []).filter(validWho),
        importance: 1,
        kind: 'chat',
        told: true,
      });
      deps.log?.(`[河木鎮] 記下她聊天時說的事：${ev.title}`);
    }

    for (const c of Array.isArray(out?.conflicts) ? out.conflicts.slice(0, 2) : []) {
      deps.log?.(`[河木鎮] ⚠️ 她剛剛說的跟設定矛盾，沒有記下：${String(c).slice(0, 80)}`);
    }
  } catch (err: any) {
    deps.log?.(`[河木鎮] 整理聊天設定失敗：${err?.status || err?.message}`);
  } finally {
    running = false;
  }
}
