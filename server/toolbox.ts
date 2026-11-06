/**
 * 她的工具箱（11/6）：她自己做出來、可以直接拿來用的工具。
 *
 * 現在收的是「委託做出來的工具」（工作區的 TOOL.json：一個不用 AI 就能跑的指令＋報告／網頁）。
 * 這些工具原本是做給主人按的；現在她自己也能在聊天、研究裡選來用（例如主人問 PoE 價格，就去跑自己做的抓價工具），
 * 不用每次重新查。這裡記錄每個工具她用了幾次、成功幾次、最近一次的結果，給她判斷哪個好用。
 *
 * 技能庫的零件（工坊網頁用的程式片段）不在這裡：那些是工坊開工時自動帶給助手的，不是能直接執行的工具。
 */
import fs from 'fs';
import path from 'path';

export interface ToolStat {
  uses: number;
  ok: number;
  lastAt?: number;
  lastOk?: boolean;
  /** 最近一次執行的摘要（她看的） */
  last?: string;
  /** 她自己對這個工具的一句心得 */
  note?: string;
}

export interface ToolEntry {
  id: string;
  title: string;
  desc: string;
  from: string;
  report?: string;
  page?: string;
  stat: ToolStat;
}

export interface ToolboxSource {
  /** 目前有哪些工具（例如每個有 TOOL.json 的委託） */
  list: () => Array<{ id: string; title: string; desc: string; from: string; report?: string; page?: string }>;
  /** 執行；回傳是否成功、輸出、報告內容 */
  run: (id: string, by: string) => Promise<{ ok: boolean; reason?: string; output?: string; report?: string }>;
}

export function createToolbox(dataDir: string, source: ToolboxSource, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'toolbox', 'stats.json');
  let stats: Record<string, ToolStat> = {};
  try {
    if (fs.existsSync(file)) stats = JSON.parse(fs.readFileSync(file, 'utf8')).stats || {};
  } catch {
    stats = {};
  }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ stats }, null, 2));
    } catch (err: any) {
      log(`[工具箱] 儲存失敗：${err?.message}`);
    }
  };

  function list(): ToolEntry[] {
    return source
      .list()
      .map((t) => ({ ...t, stat: stats[t.id] || { uses: 0, ok: 0 } }))
      .sort((a, b) => (b.stat.ok || 0) - (a.stat.ok || 0) || (b.stat.lastAt || 0) - (a.stat.lastAt || 0));
  }

  /** 找工具：id 或名稱（她可能只記得名字） */
  function find(key: string): ToolEntry | undefined {
    const k = String(key || '').trim();
    const all = list();
    return all.find((t) => t.id === k) || all.find((t) => t.title === k) || all.find((t) => k && (t.title.includes(k) || k.includes(t.title)));
  }

  async function run(key: string, by: string): Promise<string> {
    const t = find(key);
    if (!t) return `工具箱裡沒有「${key}」。可以用的：${list().map((x) => `${x.id}「${x.title}」`).join('、') || '（還沒有）'}`;
    log(`[工具箱] 她拿「${t.title}」來用（${by}）`);
    const r = await source.run(t.id, by);
    const st = (stats[t.id] ||= { uses: 0, ok: 0 });
    st.uses++;
    st.lastAt = Date.now();
    st.lastOk = r.ok;
    if (r.ok) st.ok++;
    st.last = String(r.ok ? r.report || r.output || '' : r.reason || r.output || '').replace(/\s+/g, ' ').slice(0, 200);
    save();
    if (!r.ok) return `「${t.title}」這次沒跑成功：${r.reason || ''}\n${String(r.output || '').slice(-1200)}`;
    return `「${t.title}」跑完了（不花 AI 額度）。\n${r.report ? `報告：\n${r.report.slice(0, 3500)}` : `輸出：\n${String(r.output || '').slice(-2500)}`}`;
  }

  function setNote(key: string, note: string): boolean {
    const t = find(key);
    if (!t) return false;
    (stats[t.id] ||= { uses: 0, ok: 0 }).note = String(note || '').slice(0, 120);
    save();
    return true;
  }

  /** 給她看（聊天的「工具箱」區塊、研究開場、my_tools 工具） */
  function describe(max = 8): string {
    const all = list().slice(0, max);
    if (!all.length) return '';
    return `你的工具箱（你自己做出來、可以直接跑的工具，用 run_my_tool；跑一次不花 AI 額度，但要等幾十秒）：\n${all
      .map(
        (t) =>
          `- ${t.id}「${t.title}」：${t.desc}（出自${t.from}）${t.stat.uses ? `；用過 ${t.stat.uses} 次、成功 ${t.stat.ok} 次${t.stat.lastAt ? `，上次 ${new Date(t.stat.lastAt).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${t.stat.lastOk ? '成功' : '失敗'}` : ''}` : '；還沒用過'}${t.stat.note ? `；你的心得：${t.stat.note}` : ''}`
      )
      .join('\n')}`;
  }

  function mentioned(text: string): boolean {
    const t = String(text || '');
    return list().some((x) => x.title.length >= 2 && t.includes(x.title.slice(0, Math.min(4, x.title.length))));
  }

  function snapshot() {
    return { tools: list() };
  }

  return { list, find, run, setNote, describe, mentioned, snapshot };
}

export type Toolbox = ReturnType<typeof createToolbox>;
