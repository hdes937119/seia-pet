/**
 * 西雅的配件（2026-11-09）：她做的工坊作品／委託網頁，申請「裝成配件」，主人同意後放進桌寵。
 *
 *  - 她用 propose_widget 申請（研究、委託、聊天都能用），寫清楚要哪些權限；主人在設定面板「探索 → 西雅的配件」安裝或拒絕。
 *  - 配件開成獨立的小視窗（Electron），一樣在離線沙盒裡跑；多了一條受限的「對講機」window.seia：
 *      say（讓西雅說一句話）、notify（Windows 通知）、remind（定時提醒：存在後端，時間到由桌寵提醒，配件關著也會響）。
 *    每個動作都要主人安裝時給過權限，而且有頻率上限。
 *  - 安裝時記下主要檔案的 md5；內容之後被改過，就要主人重新同意。
 *
 * 存在 data/widgets/state.json。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type WidgetPerm = 'say' | 'notify' | 'remind';
export const WIDGET_PERMS: Record<WidgetPerm, string> = {
  say: '讓西雅在桌面上說一句話',
  notify: '跳出 Windows 通知',
  remind: '登記定時提醒（時間到西雅會提醒你，配件關著也會響）',
};
const PERM_LIST = Object.keys(WIDGET_PERMS) as WidgetPerm[];

export interface WidgetSource {
  kind: 'work' | 'commission';
  id: string;
  entry: string;
}

export interface Widget {
  id: string;
  title: string;
  why: string;
  source: WidgetSource;
  perms: WidgetPerm[];
  status: 'pending' | 'installed' | 'rejected' | 'removed';
  /** 安裝後內容被改過，要主人重新同意 */
  changed?: boolean;
  from: string;
  requestedAt: number;
  decidedAt?: number;
  note?: string;
  hash?: string;
}

export interface Reminder {
  id: string;
  widgetId: string;
  widgetTitle: string;
  at: number;
  text: string;
  repeat?: 'daily';
  createdAt: number;
}

export interface WidgetDeps {
  /** 找來源：工坊作品 w-… 或委託 c-…（也可以用名字找）；回傳來源資料夾和主要檔案 */
  resolve: (ref: string) => null | { source: WidgetSource; title: string; dir: string };
  /** 來源資料夾（之後打開時用） */
  sourceDir: (s: WidgetSource) => string | null;
  log?: (m: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};
const md5 = (p: string) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const safeRel = (rel: string) => Boolean(rel) && !rel.includes('..') && !/^[\\/]/.test(rel) && !/^[a-zA-Z]:/.test(rel);

export function createWidgets(dataDir: string, deps: WidgetDeps) {
  const root = path.join(dataDir, 'widgets');
  const file = path.join(root, 'state.json');
  const log = deps.log || console.log;
  let st: { widgets: Widget[]; reminders: Reminder[] } = { widgets: [], reminders: [] };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從頭開始
  }
  const save = () => {
    try {
      fs.mkdirSync(root, { recursive: true });
      st.widgets = st.widgets.slice(-60);
      fs.writeFileSync(file, JSON.stringify(st, null, 2));
    } catch (err: any) {
      log(`[配件] 儲存失敗：${err?.message}`);
    }
  };
  const get = (id: string) => st.widgets.find((w) => w.id === id);
  const installed = () => st.widgets.filter((w) => w.status === 'installed');
  const lastCall = new Map<string, number>();

  function entryPath(w: Widget): string | null {
    const dir = deps.sourceDir(w.source);
    if (!dir || !safeRel(w.source.entry)) return null;
    const p = path.normalize(path.join(dir, w.source.entry));
    return p.startsWith(path.normalize(dir) + path.sep) && fs.existsSync(p) ? p : null;
  }

  /** 她申請把一件作品裝成配件 */
  function propose(input: { source: string; title?: string; why?: string; perms?: string[]; from: string }): { ok: boolean; reason?: string; widget?: Widget } {
    const r = deps.resolve(String(input.source || '').trim());
    if (!r) return { ok: false, reason: '找不到這個作品或委託網頁（要給作品 id、委託 id，或完整的名字；作品要做好、有網頁才行）' };
    const perms = [...new Set((input.perms || []).map(String))].filter((p): p is WidgetPerm => (PERM_LIST as string[]).includes(p));
    const dup = st.widgets.find((w) => w.source.kind === r.source.kind && w.source.id === r.source.id && (w.status === 'pending' || w.status === 'installed'));
    if (dup && dup.status === 'installed' && !dup.changed && perms.every((p) => dup.perms.includes(p)))
      return { ok: false, reason: `「${dup.title}」已經裝成配件了` };
    if (st.widgets.filter((w) => w.status === 'pending').length >= 5 && !dup) return { ok: false, reason: '已經有 5 個配件在等主人決定，先等主人看完' };
    const w: Widget = dup || {
      id: `g-${stamp()}`,
      title: '',
      why: '',
      source: r.source,
      perms: [],
      status: 'pending',
      from: input.from,
      requestedAt: Date.now(),
    };
    w.title = String(input.title || r.title).trim().slice(0, 20) || r.title.slice(0, 20);
    w.why = String(input.why || '').trim().slice(0, 300);
    w.perms = perms;
    w.source = r.source;
    w.status = 'pending';
    w.requestedAt = Date.now();
    w.from = input.from;
    if (!dup) st.widgets.push(w);
    save();
    log(`[配件] 她申請把「${w.title}」（${w.source.id}）裝成配件，權限：${w.perms.join('、') || '（不用）'}`);
    return { ok: true, widget: w };
  }

  /** 主人安裝或拒絕 */
  function decide(id: string, approve: boolean, note = ''): { ok: boolean; reason?: string; widget?: Widget } {
    const w = get(id);
    if (!w || w.status !== 'pending') return { ok: false, reason: '這個配件沒有在等你決定' };
    if (approve) {
      const p = entryPath(w);
      if (!p) return { ok: false, reason: '找不到配件的網頁檔（作品可能被刪了）' };
      w.hash = md5(p);
      w.status = 'installed';
      w.changed = false;
    } else w.status = 'rejected';
    w.decidedAt = Date.now();
    w.note = String(note || '').slice(0, 300) || undefined;
    save();
    log(`[配件] 主人${approve ? '安裝了' : '沒有裝'}「${w.title}」${note ? `：${note.slice(0, 60)}` : ''}`);
    return { ok: true, widget: w };
  }

  function remove(id: string) {
    const w = get(id);
    if (!w || w.status === 'removed') return false;
    w.status = 'removed';
    w.decidedAt = Date.now();
    st.reminders = st.reminders.filter((r) => r.widgetId !== id);
    save();
    log(`[配件] 主人移除了「${w.title}」`);
    return true;
  }

  /** 打開配件用的檔案：只限已安裝的；主要檔案內容變了 → 回到等主人同意 */
  function pageFile(id: string, rel: string): { path?: string; reason?: string } {
    const w = get(id);
    if (!w || w.status !== 'installed') return { reason: '這個配件沒有安裝' };
    const dir = deps.sourceDir(w.source);
    const want = rel || w.source.entry;
    if (!dir || !safeRel(want)) return { reason: '路徑不對' };
    const p = path.normalize(path.join(dir, want));
    if (!p.startsWith(path.normalize(dir) + path.sep) || !fs.existsSync(p)) return { reason: '找不到檔案' };
    if (want === w.source.entry && w.hash && md5(p) !== w.hash) {
      w.status = 'pending';
      w.changed = true;
      w.requestedAt = Date.now();
      save();
      log(`[配件] 「${w.title}」的內容跟安裝時不一樣，改回等主人重新同意`);
      return { reason: '配件的內容跟你安裝時不一樣了，要在設定面板重新同意才能打開' };
    }
    return { path: p };
  }

  const tooFast = (key: string, ms: number) => {
    const now = Date.now();
    if (now - (lastCall.get(key) || 0) < ms) return true;
    lastCall.set(key, now);
    return false;
  };

  /** 對講機：配件呼叫 window.seia.* → 這裡檢查權限和頻率。回傳給配件的結果，另外附上要桌寵做的事 */
  function bridge(id: string, action: string, args: any): { ok: boolean; reason?: string; say?: string; notify?: { title: string; body: string }; [k: string]: any } {
    const w = get(id);
    if (!w || w.status !== 'installed') return { ok: false, reason: '配件沒有安裝' };
    const a = args || {};
    const need: Record<string, WidgetPerm> = { say: 'say', notify: 'notify', remind: 'remind', reminders: 'remind', cancel: 'remind' };
    const perm = need[action];
    if (!perm) return { ok: false, reason: `沒有這個動作：${action}` };
    if (!w.perms.includes(perm)) return { ok: false, reason: `主人安裝時沒有給「${WIDGET_PERMS[perm]}」的權限` };
    if (action === 'say') {
      const text = String(a.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!text) return { ok: false, reason: '沒有要說的話' };
      if (tooFast(`${id}:say`, 30_000)) return { ok: false, reason: '說話太頻繁了（每 30 秒最多一次）' };
      return { ok: true, say: text };
    }
    if (action === 'notify') {
      const title = String(a.title || w.title).trim().slice(0, 30);
      const body = String(a.body || '').trim().slice(0, 120);
      if (!body) return { ok: false, reason: '通知沒有內容' };
      if (tooFast(`${id}:notify`, 10_000)) return { ok: false, reason: '通知太頻繁了（每 10 秒最多一次）' };
      return { ok: true, notify: { title, body } };
    }
    if (action === 'remind') {
      const text = String(a.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!text) return { ok: false, reason: '提醒沒有內容' };
      const now = Date.now();
      let at = NaN;
      if (a.inMinutes !== undefined) at = now + Number(a.inMinutes) * 60_000;
      else if (typeof a.at === 'number') at = a.at;
      else if (a.at) at = Date.parse(String(a.at));
      if (!Number.isFinite(at)) return { ok: false, reason: '時間看不懂（用 inMinutes: 分鐘數，或 at: "2026-11-09T08:00:00+08:00"）' };
      if (at < now + 55_000) return { ok: false, reason: '提醒至少要在 1 分鐘之後' };
      if (at > now + 30 * 86_400_000) return { ok: false, reason: '提醒最多只能設在 30 天內' };
      if (st.reminders.filter((r) => r.widgetId === id).length >= 20) return { ok: false, reason: '這個配件的提醒已經有 20 個了' };
      if (tooFast(`${id}:remind`, 2_000)) return { ok: false, reason: '設定太快了，等一下再試' };
      const r: Reminder = { id: `r-${stamp()}-${Math.floor(Math.random() * 1000)}`, widgetId: id, widgetTitle: w.title, at, text, repeat: a.repeat === 'daily' ? 'daily' : undefined, createdAt: now };
      st.reminders.push(r);
      save();
      log(`[配件] 「${w.title}」登記提醒：${new Date(at).toLocaleString('zh-TW', { hour12: false })}「${text}」${r.repeat ? '（每天）' : ''}`);
      return { ok: true, id: r.id, at: r.at };
    }
    if (action === 'reminders') return { ok: true, reminders: st.reminders.filter((r) => r.widgetId === id).map((r) => ({ id: r.id, at: r.at, text: r.text, repeat: r.repeat || null })) };
    if (action === 'cancel') {
      const before = st.reminders.length;
      st.reminders = st.reminders.filter((r) => !(r.widgetId === id && r.id === String(a.id || '')));
      save();
      return before === st.reminders.length ? { ok: false, reason: '找不到這個提醒' } : { ok: true };
    }
    return { ok: false, reason: '沒有這個動作' };
  }

  /** 到時間的提醒（每天重複的排到明天，其他的刪掉）；桌寵關著時錯過的，開機後 6 小時內還會補提醒 */
  function due(now = Date.now()): Reminder[] {
    const out: Reminder[] = [];
    let dirty = false;
    for (const r of [...st.reminders]) {
      if (r.at > now) continue;
      const w = get(r.widgetId);
      if (w && w.status === 'installed' && now - r.at < 6 * 3_600_000) out.push({ ...r });
      if (r.repeat === 'daily') {
        while (r.at <= now) r.at += 86_400_000;
      } else st.reminders = st.reminders.filter((x) => x !== r);
      dirty = true;
    }
    if (dirty) save();
    return out;
  }

  function cancelReminder(rid: string) {
    const before = st.reminders.length;
    st.reminders = st.reminders.filter((r) => r.id !== rid);
    save();
    return before !== st.reminders.length;
  }

  /** 給她看（工具結果、研究開場）：自己的配件狀態 */
  function describe(): string {
    const list = st.widgets.filter((w) => w.status !== 'removed').slice(-8);
    if (!list.length) return '';
    const label = { pending: '等主人決定', installed: '已安裝', rejected: '主人沒裝', removed: '移除了' };
    return `你的配件：\n${list.map((w) => `- ${w.id}「${w.title}」：${w.changed ? '內容改過、等主人重新同意' : label[w.status]}${w.perms.length ? `（權限：${w.perms.join('、')}）` : ''}${w.note ? `；主人說：${w.note}` : ''}`).join('\n')}`;
  }

  function snapshot() {
    return {
      perms: WIDGET_PERMS,
      widgets: [...st.widgets].reverse().filter((w) => w.status !== 'removed'),
      reminders: [...st.reminders].sort((a, b) => a.at - b.at),
    };
  }

  return { propose, decide, remove, get, installed, pageFile, bridge, due, cancelReminder, describe, snapshot };
}

export type Widgets = ReturnType<typeof createWidgets>;
