/**
 * 西雅的自主行動：想 → 做 → 看 → 記。
 *   看：做完她自己檢查成品（server.ts 的 reviewDraft／onWorkDone），不滿意就照自己寫的修改重做（最多 AUTONOMY_MAX_RETRY 次，預設 1；重做不算成品數）。
 *   記：結果、她的心得、學到的事寫回這裡（lessons），下次想的時候看得到；日記也會寫進她自己的時間做了什麼。
 *   研究：想深入了解、要查資料、要反覆試驗的事，她選 research，開新題目或接續研究筆記本裡的題目（見 server/research.ts，
 *         一輪多步的研究循環在 server.ts 的 runResearchCycle）。碰到沙盒外的事，研究的結果會變成「提案」（附方法和需要什麼）。
 *
 * 不再一個功能一個「想點子」程式、由程式替她挑重點。她看到跟聊天時一樣完整的自己
 * （記憶、話頭裡她想要的和約好的事、往事、目標、需求、興趣、最近逛到的東西、鎮上的事、做過的作品和筆記、額度），
 * 再看一份「我會的事」工具清單，自己決定：做一件事（用哪個工具、做什麼、為什麼）、記下一個現在做不到的願望，或什麼都不做。
 *
 * 加新能力＝往工具清單註冊一項（register），不用為了某個願望改程式。
 * 主人的角色是把關：成品要主人同意才會真的用上（換立繪、放進貼圖、讓作品展示…），不是出點子。
 *
 * 記在 data/world/autonomy.json（最近的決定、她的願望清單）。
 */
import fs from 'fs';
import path from 'path';

export interface Plan {
  tool: string;
  title: string;
  detail: string;
  why: string;
  /** 工具需要的額外選項（例如畫圖的 kind、pose） */
  options: Record<string, string>;
  /** 開工時跟主人說的話（可以沒有） */
  say?: string;
  /** 做好時跟主人說的話 */
  doneSay?: string;
}

export interface Tool {
  id: string;
  /** 給她看的說明：這個工具能做什麼、成品怎麼用上 */
  describe: () => string;
  /** 現在能不能用（不能就寫原因，她會看到） */
  available: () => { ok: boolean; reason?: string };
  /** 照她的計畫開工（不等做完） */
  run: (plan: Plan) => { ok: boolean; reason?: string };
}

export interface Decision {
  at: number;
  action: 'make' | 'wish' | 'rest' | 'research';
  tool?: string;
  title?: string;
  why?: string;
  result?: string;
}

export interface Wish {
  at: number;
  text: string;
  why: string;
  status: 'open' | 'done' | 'dropped';
  /** 提案：她查到的做法 */
  method?: string;
  /** 提案：需要主人幫忙的事（裝什麼、開什麼權限） */
  need?: string;
  /** 從哪個研究題目來的 */
  project?: string;
}

export interface Lesson {
  at: number;
  tool: string;
  title: string;
  text: string;
}

interface State {
  decisions: Decision[];
  wishes: Wish[];
  lessons?: Lesson[];
}

export interface AutonomyDeps {
  /** 她的完整現況（跟聊天背景一樣） */
  selfContext: () => string;
  /** 她的身分和性格 */
  persona: () => string;
  /** 叫模型回 JSON */
  decide: (prompt: string) => Promise<any>;
  /** 研究筆記本的目錄（每個題目一行） */
  researchIndex?: () => string;
  /** 翻舊筆記看到的幾段（找靈感用；沒有就空陣列） */
  inspiration?: () => string[];
  /** 開始一輪研究（不等做完） */
  startResearch?: (req: { project?: string; title: string; question: string; why: string; say?: string }) => { ok: boolean; reason?: string };
  /** 研究現在能不能做 */
  researchAvailable?: () => { ok: boolean; reason?: string };
  log?: (m: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const ago = (ms: number, now: number) => {
  const h = Math.round((now - ms) / 3_600_000);
  return h < 1 ? '剛剛' : h < 48 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`;
};

export function createAutonomy(dataDir: string, deps: AutonomyDeps) {
  const file = path.join(dataDir, 'world', 'autonomy.json');
  const log = deps.log || console.log;
  let st: State = { decisions: [], wishes: [] };
  try {
    if (fs.existsSync(file)) st = { decisions: [], wishes: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(st, null, 2));
    } catch (err: any) {
      log(`[自主] 儲存失敗：${err?.message}`);
    }
  };

  const tools = new Map<string, Tool>();
  function register(tool: Tool) {
    tools.set(tool.id, tool);
  }

  let deciding = false;
  const decisionsToday = (now = Date.now()) => st.decisions.filter((d) => dayKey(d.at) === dayKey(now)).length;
  const lastDecisionAt = () => st.decisions.slice(-1)[0]?.at || 0;

  function prompt(now = Date.now()) {
    const toolLines = [...tools.values()].map((t) => {
      const a = t.available();
      return `- ${t.id}：${t.describe()}${a.ok ? '' : `【現在不能用：${a.reason}】`}`;
    });
    const recent = st.decisions
      .slice(-10)
      .map(
        (d) =>
          `${ago(d.at, now)}：${
            d.action === 'rest' ? '決定先不做' : d.action === 'wish' ? `記下願望「${d.title}」` : d.action === 'research' ? `研究「${d.title}」` : `用 ${d.tool} 做「${d.title}」`
          }${d.result ? `（${d.result}）` : ''}`
      );
    const wishes = st.wishes.filter((w) => w.status === 'open').map((w) => `「${w.text}」${w.method ? '（已附做法的提案）' : ''}`);
    const rIndex = deps.researchIndex?.() || '';
    const rAvail = deps.researchAvailable?.() || { ok: Boolean(deps.startResearch) };
    const sparks = deps.inspiration?.() || [];
    const lessons = (st.lessons || []).slice(-8).map((l) => `${l.text}（${l.tool}「${l.title}」）`);
    return `${deps.persona()}

下面是你現在的完整狀況（跟你平常聊天時看到的一樣）：
${deps.selfContext()}

【你會的事（工具清單）】
${toolLines.join('\n')}

【你的研究筆記本（目錄）】${rAvail.ok ? '' : `【現在不能研究：${rAvail.reason}】`}
${rIndex || '（還沒有任何題目）'}
${sparks.length ? `\n【你剛剛翻舊筆記時看到的】\n${sparks.map((x) => `- ${x}`).join('\n')}\n（看看有沒有讓你想到什麼新問題、或跟別的東西連起來；沒有就算了）\n` : ''}
${recent.length ? `【你最近自己決定過的事】\n${recent.join('\n')}\n` : ''}${lessons.length ? `【你自己做東西時學到的】\n${lessons.map((l) => `- ${l}`).join('\n')}\n` : ''}${wishes.length ? `【你記下來、現在還做不到的願望】${wishes.join('、')}\n` : ''}
現在是你自己的時間。想想你現在想不想做點什麼：
- 想法要從你自己來：你說過想要的東西、跟主人約好的事、最近逛到或看到覺得有趣的東西、你的目標和興趣、鎮上發生的事、季節。不要為了做而做；不想做就選 rest，這很正常。
- 想深入了解某件事、需要先查資料找方法、或要反覆試驗驗證想法 → action 選 research：可以接續目錄裡的題目（project 填它的 id），也可以開新題目（project 填 "new"）。研究時你可以查網路、讀網頁、翻筆記、在工坊做實驗、畫圖，一切都會記進筆記本。
- 想做、馬上就能用工具做好的小東西 → action 選 make，一次只做一件，要具體。
- 想做，但沒有任何工具能做（例如想親自玩某個遊戲）→ 通常先 research 查查看怎麼做，研究完會變成附做法的提案；真的只是隨口的願望才選 wish。
- 不要重複最近做過、或還在等主人看的東西。成品都要主人同意才會真的用上，所以你可以放心試。
只輸出 JSON：
{
  "action": "make" | "research" | "wish" | "rest",
  "tool": "工具 id（make 才要）",
  "project": "research 才要：接續的題目 id，開新題目給 \"new\"",
  "options": { 工具需要的選項，照工具說明填，沒有就給 {} },
  "title": "要做的東西、研究題目或願望的名字（15 字內）",
  "detail": "make：具體要做成什麼樣子（30～150 字，寫給負責做的助手看）；research：你想弄清楚的問題和這一輪想先做什麼（30～200 字）；wish：一句話",
  "why": "你為什麼想做（20 字內，你自己的口吻）",
  "say": "開始做的時候跟主人說的一句話（25 字內，不想說就給空字串）",
  "doneSay": "做好時跟主人說的一句話（25 字內，請主人看看）"
}`;
  }

  /** 讓她想一想、決定要不要做點什麼。回傳這次的決定（或為什麼沒有想） */
  async function think(now = Date.now()): Promise<{ decision?: Decision; plan?: Plan; skipped?: string }> {
    if (deciding) return { skipped: '正在想' };
    deciding = true;
    try {
      const out = await deps.decide(prompt(now));
      const action = ['make', 'wish', 'rest', 'research'].includes(out?.action) ? out.action : 'rest';
      const title = String(out?.title || '').trim().slice(0, 30);
      const why = String(out?.why || '').trim().slice(0, 60);
      const decision: Decision = { at: now, action, title: title || undefined, why: why || undefined };
      let plan: Plan | undefined;
      if (action === 'research') {
        const question = String(out?.detail || '').trim().slice(0, 400);
        const avail = deps.researchAvailable?.() || { ok: Boolean(deps.startResearch) };
        if (!deps.startResearch || !title || !question) {
          decision.action = 'rest';
          decision.result = '想研究的東西沒想清楚';
        } else if (!avail.ok) {
          decision.result = `沒研究成：${avail.reason}`;
        } else {
          const proj = String(out?.project || 'new');
          const r = deps.startResearch({ project: proj === 'new' ? undefined : proj, title, question, why, say: String(out?.say || '').trim().slice(0, 50) || undefined });
          decision.result = r.ok ? '開始研究' : `沒研究成：${r.reason}`;
        }
        log(`[自主] 她決定研究「${title}」（${why}）→ ${decision.result}`);
      } else if (action === 'wish' && title) {
        st.wishes.push({ at: now, text: title, why, status: 'open' });
        st.wishes = st.wishes.slice(-30);
        log(`[自主] 她記下一個願望：${title}（${why}）`);
      } else if (action === 'make') {
        const tool = tools.get(String(out?.tool || ''));
        const detail = String(out?.detail || '').trim().slice(0, 400);
        if (!tool || !title || !detail) {
          decision.action = 'rest';
          decision.result = '想做的東西沒想清楚';
        } else {
          decision.tool = tool.id;
          const a = tool.available();
          if (!a.ok) {
            decision.result = `沒做成：${a.reason}`;
          } else {
            const options: Record<string, string> = {};
            for (const [k, v] of Object.entries(out?.options || {})) options[k] = String(v).slice(0, 60);
            plan = {
              tool: tool.id,
              title,
              detail,
              why,
              options,
              say: String(out?.say || '').trim().slice(0, 50) || undefined,
              doneSay: String(out?.doneSay || '').trim().slice(0, 50) || undefined,
            };
            const r = tool.run(plan);
            decision.result = r.ok ? '開工了' : `沒做成：${r.reason}`;
            if (!r.ok) plan = undefined;
          }
          log(`[自主] 她決定用 ${tool.id} 做「${title}」（${why}）→ ${decision.result}`);
        }
      } else {
        log(`[自主] 她想了想，決定先不做${why ? `（${why}）` : ''}`);
      }
      st.decisions.push(decision);
      st.decisions = st.decisions.slice(-60);
      save();
      return { decision, plan };
    } finally {
      deciding = false;
    }
  }

  /** 做好之後回填結果（給下次想的時候看） */
  function noteResult(title: string, result: string) {
    const d = [...st.decisions].reverse().find((x) => x.action === 'make' && x.title === title);
    if (d) {
      d.result = result.slice(0, 80);
      save();
    }
  }

  /** 記一條學到的事（跟最近 10 條太像的不重複） */
  function addLesson(tool: string, title: string, text: string) {
    const t = String(text || '').trim().slice(0, 80);
    if (!t) return;
    const key = (x: string) => x.replace(/[\s，。、！？,.!?]/g, '').slice(0, 12);
    const lessons = st.lessons || [];
    if (lessons.slice(-10).some((l) => key(l.text) === key(t))) return;
    lessons.push({ at: Date.now(), tool, title: String(title).slice(0, 30), text: t });
    st.lessons = lessons.slice(-40);
    save();
  }

  /** 某一天她自己的時間做了什麼（給日記） */
  function dayRecap(date: string): string[] {
    return st.decisions
      .filter((d) => dayKey(d.at) === date && d.action !== 'rest')
      .map((d) =>
        d.action === 'wish'
          ? `記下願望「${d.title}」（${d.why || ''}）`
          : d.action === 'research'
          ? `自己決定研究「${d.title}」：${d.result || ''}`
          : `自己決定用 ${d.tool} 做「${d.title}」：${d.result || '還在做'}`
      );
  }

  /** 研究得出的提案：附做法和需要主人幫忙的事 */
  function addProposal(p: { text: string; why: string; method: string; need: string; project?: string }) {
    st.wishes.push({ at: Date.now(), text: String(p.text).slice(0, 40), why: String(p.why).slice(0, 80), method: String(p.method).slice(0, 600), need: String(p.need).slice(0, 300), project: p.project, status: 'open' });
    st.wishes = st.wishes.slice(-30);
    save();
    log(`[自主] 她提出提案：${p.text}（需要：${String(p.need).slice(0, 60)}）`);
  }

  function setWish(index: number, status: Wish['status']) {
    const w = st.wishes[index];
    if (!w) return null;
    w.status = status;
    save();
    return w;
  }

  /** 給聊天：她最近自己決定做的事、還做不到的願望 */
  function describeForChat(now = Date.now()): string {
    const parts: string[] = [];
    const made = st.decisions.filter((d) => d.action === 'make' && now - d.at < 24 * 3600 * 1000).slice(-3);
    if (made.length) parts.push(`你今天自己決定做的事：${made.map((d) => `「${d.title}」${d.result ? `（${d.result}）` : ''}`).join('；')}。`);
    const wishes = st.wishes.filter((w) => w.status === 'open').slice(-3);
    if (wishes.length)
      parts.push(
        `你想做但現在還做不到的事：${wishes.map((w) => `「${w.text}」${w.need ? `（你提的方案需要主人：${w.need.slice(0, 50)}）` : ''}`).join('、')}（主人問起或聊到相關的事時可以提，提案的話可以說明你查到的做法）。`
      );
    return parts.length ? `【你自己的時間】${parts.join('')}` : '';
  }

  function snapshot() {
    return {
      tools: [...tools.values()].map((t) => ({ id: t.id, describe: t.describe(), available: t.available() })),
      decisionsToday: decisionsToday(),
      decisions: [...st.decisions].reverse(),
      wishes: st.wishes.map((w, i) => ({ ...w, index: i })).reverse(),
      lessons: [...(st.lessons || [])].reverse(),
    };
  }

  return { register, think, noteResult, addLesson, addProposal, dayRecap, setWish, describeForChat, snapshot, decisionsToday, lastDecisionAt, prompt };
}

export type Autonomy = ReturnType<typeof createAutonomy>;
