/**
 * 體力與晝夜節律：她不是隨時完美待命的機器。
 *
 *  體力 energy（0 ~ 100）：
 *    - 每次陪主人聊天會消耗：訊息越長、丟圖片、叫她上網找東西，耗越多；連續聊越久耗越快
 *    - 主人不理她時慢慢恢復（每小時 +15）；摸頭可以補一點
 *  晝夜節律：再乘上時段係數（深夜、清晨特別沒精神，午飯後會想睡）
 *
 *  有效體力 = 體力 × 時段係數 →
 *    精神好（≥ 60）：平常的她
 *    累了（35 ~ 60）：回覆短一點，偶爾打哈欠、碎念
 *    沒力（< 35）：很短、有點敷衍，會抱怨想休息；長篇的東西會撒嬌說明天再看
 *  例外：主人說很急、很重要 → 一定幫，只是邊幫邊碎念。
 *
 *  強度（設定面板）：off 關閉 / light 輕微（耗得慢）/ normal 正常。
 *  存在 data/memories/stamina.json。
 */
import fs from 'fs';
import path from 'path';

export type StaminaMode = 'off' | 'light' | 'normal';
export type StaminaTier = 'fresh' | 'tired' | 'exhausted';

interface StaminaState {
  energy: number;
  updatedAt: number;
  sessionStart: number; // 這一輪連續聊天從什麼時候開始
  lastChatAt: number;
  mode: StaminaMode;
}

const HOUR = 60 * 60 * 1000;
const RECOVER_PER_HOUR = 15;
const SESSION_GAP_MS = 10 * 60 * 1000; // 隔 10 分鐘沒聊就算新的一輪
const URGENT_RE = /急|拜託|拜托|重要|馬上|趕快|快點|求你|求求|deadline|救命|來不及|緊急/i;

/** 時段係數：深夜、清晨沒精神；午飯後想睡 */
export function circadian(hour: number): { factor: number; label: string } {
  if (hour >= 1 && hour < 6) return { factor: 0.5, label: '深夜（本來該睡覺的時間）' };
  if (hour >= 23 || hour < 1) return { factor: 0.7, label: '很晚了' };
  if (hour >= 6 && hour < 8) return { factor: 0.75, label: '一大早還沒完全醒' };
  if (hour >= 13 && hour < 15) return { factor: 0.85, label: '午飯後想睡' };
  return { factor: 1, label: '' };
}

export function createStamina(dataDir: string) {
  const dir = path.join(dataDir, 'memories');
  const file = path.join(dir, 'stamina.json');
  let st: StaminaState = { energy: 100, updatedAt: Date.now(), sessionStart: 0, lastChatAt: 0, mode: 'normal' };
  try {
    if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // 從滿體力開始
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(st, null, 2));
      } catch (err: any) {
        console.warn('[體力] 儲存失敗：', err?.message);
      }
    }, 500);
  };

  /** 把「上次到現在」的休息時間換成恢復量 */
  function settle(now = Date.now()) {
    const hours = Math.max(0, (now - st.updatedAt) / HOUR);
    // 正在連續聊天的時候不算休息
    const resting = now - st.lastChatAt > SESSION_GAP_MS;
    if (resting && hours > 0) st.energy = Math.min(100, st.energy + hours * RECOVER_PER_HOUR);
    st.updatedAt = now;
  }

  function setMode(mode: unknown) {
    if (mode === 'off' || mode === 'light' || mode === 'normal') {
      if (st.mode !== mode) {
        st.mode = mode;
        save();
      }
    }
  }

  /** 有效體力（含時段係數） */
  function effective(now = Date.now()): { value: number; tier: StaminaTier; timeLabel: string } {
    settle(now);
    const { factor, label } = circadian(new Date(now).getHours());
    // 輕微模式：時段影響也減半
    const f = st.mode === 'light' ? 1 - (1 - factor) / 2 : factor;
    const value = Math.round(st.energy * f);
    const tier: StaminaTier = st.mode === 'off' ? 'fresh' : value >= 60 ? 'fresh' : value >= 35 ? 'tired' : 'exhausted';
    return { value, tier, timeLabel: label };
  }

  /**
   * 陪主人聊完一次：依這次的負擔扣體力。
   * @param userText 主人這句話
   * @param extra 額外負擔（看圖、上網找東西…）
   */
  function spend(userText: string, extra = 0, now = Date.now()) {
    if (st.mode === 'off') return;
    settle(now);
    if (now - st.lastChatAt > SESSION_GAP_MS) st.sessionStart = now;
    const sessionMin = (now - st.sessionStart) / 60000;
    const len = String(userText || '').length;
    let cost = 0.6 + Math.min(3.5, len / 400) + extra;
    // 連續聊越久越累（聊超過 45 分鐘開始加成）
    cost *= 1 + Math.max(0, sessionMin - 45) / 60;
    if (st.mode === 'light') cost *= 0.5;
    st.energy = Math.max(0, st.energy - cost);
    st.lastChatAt = now;
    save();
  }

  /** 摸頭補一點 */
  function pat(now = Date.now()) {
    settle(now);
    st.energy = Math.min(100, st.energy + 3);
    save();
  }

  /** 給提示詞 */
  function describe(userText = '', now = Date.now()): string {
    if (st.mode === 'off') return '';
    const { value, tier, timeLabel } = effective(now);
    if (tier === 'fresh') return '';
    const sessionMin = st.lastChatAt && now - st.lastChatAt < SESSION_GAP_MS ? Math.round((now - st.sessionStart) / 60000) : 0;
    const why = [sessionMin >= 30 ? `已經連續陪主人聊了大約 ${sessionMin} 分鐘` : '', timeLabel].filter(Boolean).join('、') || '今天陪主人做了很多事';
    const urgent = URGENT_RE.test(userText);
    if (tier === 'tired') {
      return `【你現在的體力：有點累（${value}/100，因為${why}）】回覆比平常短一點，可以偶爾打個哈欠、碎念一句想休息，但還是會好好回答。${
        urgent ? '主人說這件事很急或很重要 → 認真幫他，只是可以邊幫邊小聲抱怨。' : ''
      }`;
    }
    return `【你現在的體力：快沒電了（${value}/100，因為${why}）】你很累：回覆盡量短（1~2 句），可以有點敷衍、會抱怨想休息（例如「我有點運算疲勞了…」）；主人丟長篇內容或複雜的事，可以撒嬌說「明天再看好不好」。${
      urgent
        ? '但主人說這件事很急或很重要 → 你一定要撐著認真幫完，只是可以邊做邊碎念「真是的…看在你這麼急的份上」。'
        : '不過如果主人堅持或說很急，還是要幫。'
    }`;
  }

  function snapshot(now = Date.now()) {
    const e = effective(now);
    return { energy: Math.round(st.energy), effective: e.value, tier: e.tier, mode: st.mode, time: e.timeLabel };
  }

  return { setMode, spend, pat, describe, effective, snapshot };
}

export type Stamina = ReturnType<typeof createStamina>;
