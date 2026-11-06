/**
 * 用量觀測與每日預算（借 astrbot private_companion 的「真實觀測，不造假數據」）。
 *
 *  - 每次呼叫 Gemini 都記下：哪個任務、哪個模型、輸入 / 快取命中 / 輸出 token、耗時（串流記首字耗時）。
 *    token 數一律用 Gemini 回傳的 usageMetadata；沒回傳的就記「不知道」，不會當成 0。
 *  - 依模型價目表估算費用（美元 → 台幣，匯率可在 .env 設 USAGE_TWD_RATE，預設 32）。
 *  - 每日預算（.env 的 DAILY_BUDGET_TWD，預設 60 元）：超過之後，背景任務（說書人、目標、主動搭話、
 *    聊天設定整理、興趣整理、自己閒逛、Gemini 網頁吐槽…）先停，聊天和 LINE 永遠不擋。
 *  - 任務名稱用 AsyncLocalStorage 自動帶：路由會自動標記，背景任務用 usageTask('narrator', fn) 包起來。
 *
 * 存在 data/memories/usage.json（保留 35 天）。
 */
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

/** 每百萬 token 的價格（美元）：輸入、快取命中的輸入、輸出（思考 token 算輸出） */
const PRICES: Array<{ match: RegExp; input: number; cached: number; output: number }> = [
  // 繪圖模型：輸出的圖片 token 很貴（Pro Image 1K 一張約 1120 token ≈ 0.13 美元；估算值）
  { match: /image/i, input: 2.0, cached: 0.2, output: 120.0 },
  { match: /flash-lite/i, input: 0.25, cached: 0.025, output: 1.5 },
  { match: /3\.8-flash/i, input: 0.75, cached: 0.075, output: 3.75 },
  { match: /pro/i, input: 2.0, cached: 0.2, output: 12.0 },
  { match: /flash/i, input: 0.5, cached: 0.05, output: 3.0 },
];
const DEFAULT_PRICE = { input: 0.5, cached: 0.05, output: 3.0 };

/** 會被每日預算擋下的背景任務 */
export const BACKGROUND_TASKS = new Set([
  'narrator',
  'core-memory',
  'event-verify',
  'goals',
  'nudge',
  'writeback',
  'reflect',
  'explore-idle',
  'gemini-web',
  'curiosity',
  'diary',
  'workshop',
  'autonomy',
  'wardrobe',
  'research',
  'threads',
  'busy',
]);

interface TaskStat {
  calls: number;
  prompt: number;
  cached: number;
  output: number;
  costUsd: number;
  /** 有幾次呼叫沒有回報 token（不知道用了多少） */
  unknown: number;
  ms: number;
}

interface DayStat {
  tasks: Record<string, TaskStat>;
  /** 聊天串流的首字耗時（毫秒），最多留 50 筆 */
  ttft: number[];
}

const als = new AsyncLocalStorage<{ task: string }>();

/** 用某個任務名稱執行（裡面所有 Gemini 呼叫都記在這個任務底下） */
export function usageTask<T>(task: string, fn: () => T): T {
  return als.run({ task }, fn);
}

export function currentTask(): string {
  return als.getStore()?.task || 'other';
}

const dayKey = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function createUsage(dataDir: string, log: (m: string) => void = console.log) {
  const file = path.join(dataDir, 'memories', 'usage.json');
  let days: Record<string, DayStat> = {};
  try {
    if (fs.existsSync(file)) days = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    days = {};
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const keep = Object.keys(days).sort().slice(-35);
        days = Object.fromEntries(keep.map((k) => [k, days[k]]));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(days));
      } catch (err: any) {
        log(`[用量] 儲存失敗：${err?.message}`);
      }
    }, 2000);
  };

  const rate = () => Number(process.env.USAGE_TWD_RATE) || 32;
  const budgetTwd = () => {
    const v = Number(process.env.DAILY_BUDGET_TWD);
    return Number.isFinite(v) && v > 0 ? v : 60;
  };

  function day(ms = Date.now()): DayStat {
    const k = dayKey(ms);
    if (!days[k]) days[k] = { tasks: {}, ttft: [] };
    return days[k];
  }

  /** 記一次呼叫（usageMetadata 直接傳 Gemini 回來的物件） */
  function record(model: string, meta: any, ms: number, task = currentTask()) {
    const d = day();
    const t = (d.tasks[task] ||= { calls: 0, prompt: 0, cached: 0, output: 0, costUsd: 0, unknown: 0, ms: 0 });
    t.calls++;
    t.ms += Math.max(0, ms);
    const prompt = Number(meta?.promptTokenCount);
    if (!Number.isFinite(prompt)) {
      t.unknown++;
      save();
      return;
    }
    const cached = Number(meta?.cachedContentTokenCount) || 0;
    const output = (Number(meta?.candidatesTokenCount) || 0) + (Number(meta?.thoughtsTokenCount) || 0);
    const price = PRICES.find((p) => p.match.test(model)) || DEFAULT_PRICE;
    const cost = ((prompt - cached) * price.input + cached * price.cached + output * price.output) / 1e6;
    t.prompt += prompt;
    t.cached += cached;
    t.output += output;
    t.costUsd += cost;
    save();
  }

  function recordTtft(ms: number) {
    const d = day();
    d.ttft = [...d.ttft, Math.round(ms)].slice(-50);
    save();
  }

  function todayCostTwd(ms = Date.now()) {
    const d = days[dayKey(ms)];
    if (!d) return 0;
    return Object.values(d.tasks).reduce((a, t) => a + t.costUsd, 0) * rate();
  }

  let warnedDate = '';
  /** 背景任務可以跑嗎（今天的花費還沒超過預算） */
  function backgroundAllowed(task: string): boolean {
    if (!BACKGROUND_TASKS.has(task)) return true;
    const ok = todayCostTwd() < budgetTwd();
    if (!ok && warnedDate !== dayKey()) {
      warnedDate = dayKey();
      log(`[用量] 今天已經花了約 NT$${todayCostTwd().toFixed(1)}，超過每日預算 NT$${budgetTwd()}，背景任務先休息到明天（聊天不受影響）`);
    }
    return ok;
  }

  function overBudget() {
    return todayCostTwd() >= budgetTwd();
  }

  /** 給設定面板 / 除錯 */
  function summary(ms = Date.now()) {
    const d = days[dayKey(ms)] || { tasks: {}, ttft: [] };
    const r = rate();
    const tasks = Object.entries(d.tasks)
      .map(([task, t]) => ({
        task,
        calls: t.calls,
        prompt: t.prompt,
        cached: t.cached,
        output: t.output,
        cacheHitRate: t.prompt ? Math.round((t.cached / t.prompt) * 100) : null,
        costTwd: Math.round(t.costUsd * r * 100) / 100,
        unknown: t.unknown,
        avgMs: t.calls ? Math.round(t.ms / t.calls) : 0,
        background: BACKGROUND_TASKS.has(task),
      }))
      .sort((a, b) => b.costTwd - a.costTwd);
    const totalPrompt = tasks.reduce((a, t) => a + t.prompt, 0);
    const totalCached = tasks.reduce((a, t) => a + t.cached, 0);
    const ttft = [...d.ttft].sort((a, b) => a - b);
    const last7 = Object.keys(days)
      .sort()
      .slice(-7)
      .map((k) => ({ date: k, costTwd: Math.round(Object.values(days[k].tasks).reduce((a, t) => a + t.costUsd, 0) * r * 100) / 100 }));
    const monthKey = dayKey(ms).slice(0, 7);
    const monthTwd = Object.keys(days)
      .filter((k) => k.startsWith(monthKey))
      .reduce((a, k) => a + Object.values(days[k].tasks).reduce((x, t) => x + t.costUsd, 0) * r, 0);
    return {
      date: dayKey(ms),
      budgetTwd: budgetTwd(),
      todayTwd: Math.round(todayCostTwd(ms) * 100) / 100,
      monthTwd: Math.round(monthTwd * 100) / 100,
      overBudget: overBudget(),
      cacheHitRate: totalPrompt ? Math.round((totalCached / totalPrompt) * 100) : null,
      ttftMedianMs: ttft.length ? ttft[Math.floor(ttft.length / 2)] : null,
      tasks,
      last7,
      note: '費用是依公開價目表估算，實際以 Google 帳單為準；token 數來自 Gemini 回報，沒回報的記在 unknown。',
    };
  }

  /** 今天（或某一天）用了多少額度 */
  function budgetStatus(ms = Date.now()) {
    const spent = todayCostTwd(ms);
    const budget = budgetTwd();
    return { spentTwd: Math.round(spent * 10) / 10, budgetTwd: budget, ratio: budget ? spent / budget : 0 };
  }

  /**
   * 讓她知道自己今天的額度（借小肥魚「帳本公開」：預算不只是閘門，也是她的處境）。
   * 用不到一半什麼都不說，免得提示詞變胖。
   */
  function describeForChat(ms = Date.now()): string {
    const { ratio } = budgetStatus(ms);
    if (ratio < 0.5) return '';
    const pct = Math.min(100, Math.round(ratio * 100));
    const state =
      ratio >= 1
        ? `已經用完了（約 ${pct}%）：工坊、自己閒逛、說書這些背景的事要休息到明天，跟主人聊天不受影響`
        : ratio >= 0.85
        ? `快用完了（約 ${pct}%）：你決定今天先不去工坊、也少到處逛`
        : `用了一半多（約 ${pct}%）：想做什麼要挑一下`;
    return `【今天的額度】主人每天給你一筆 Gemini 額度（你思考、說話、做東西都會用到）。今天${state}。這是你自己的處境，不用一直提；主人問起、或要解釋為什麼今天不去工坊時再自然說一句。不要跟主人討額度，也不要怪主人。`;
  }

  return { record, recordTtft, backgroundAllowed, overBudget, todayCostTwd, summary, budgetStatus, describeForChat };
}

export type Usage = ReturnType<typeof createUsage>;
