import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import { runAutoExplore, type GenerateJson } from './server/explore';
import { describePersonality, describeTime, type ClientTime, type PersonalityConfig } from './server/persona';
import { createEventMemory } from './server/eventMemory';
import { createRelationship, LEVELS } from './server/relationship';

// 說話節奏：貼圖名稱（要跟前端 src/services/replyRhythm.ts 的 STICKERS 一致）
const STICKER_NAMES = ['開心', '笑死', '得意', '生氣', '害羞', '疑惑', '哭哭', '讚', '晚安'];

/** 依「話癆」滑桿決定多常連傳好幾則 */
function chattyRhythm(chatty?: number): string {
  const c = typeof chatty === 'number' ? chatty : 60;
  if (c < 30) return '你話很少：幾乎都只回 1 則、一句話，不連傳。';
  if (c > 70) return '你很話癆：聊到有興趣的話題時常常連傳兩三則；但主人只回短話時一樣只回一句。';
  return '大約四次裡才有一次分成兩則傳，其他時候 1 則就好。';
}

function isGamingActivity(a?: { type?: string; appContext?: string } | null): boolean {
  return a?.type === 'gaming' || a?.appContext === 'gaming';
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 桌寵的資料夾（自訂立繪、事件日記）。可用 PET_DATA_DIR 指到別處，例如測試時不要動到真的資料
const DATA_DIR = process.env.PET_DATA_DIR ? path.resolve(process.env.PET_DATA_DIR) : path.resolve(__dirname, 'data');

// 事件記憶（事件日記），存在 data/memories/events.json
const eventMemory = createEventMemory(DATA_DIR);
// 長時間心情 + 好感度，存在 data/memories/relationship.json
const relationship = createRelationship(DATA_DIR);

// Allow large payloads for base64 screen vision frames
app.use(express.json({ limit: '30mb' }));

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function cleanJsonText(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Multi-Model Resilient Cascade with User Preferred Model Priority (`gemini-3.1-pro-preview`, `gemini-3.8-flash`, etc.)
 * Tries the user's selected model first; if quota/rate-limited, falls back across available pools.
 */
// 模型狀態快取：避免每次對話都重新踩一遍不存在 / 不支援的模型
let lastWorkingModel: string | null = null;
const missingModels = new Set<string>(); // 回 404 的模型，之後直接跳過
const noThinkingConfigModels = new Set<string>(); // 不接受 thinkingConfig 的模型

function isAbortError(err: any) {
  return err?.name === 'AbortError' || err?.name === 'APIUserAbortError';
}

const DEFAULT_CASCADE = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.6-flash',
];

// 依偏好排出要嘗試的模型順序（Auto 模式時，優先用上次成功的模型）
function modelsToTryFor(preferredModel?: string) {
  const head =
    preferredModel && preferredModel !== 'auto' ? preferredModel : lastWorkingModel;
  const ordered = head ? [head, ...DEFAULT_CASCADE.filter((m) => m !== head)] : DEFAULT_CASCADE;
  const available = ordered.filter((m) => !missingModels.has(m));
  const now = Date.now();
  const ready = available.filter((m) => (coolingUntil.get(m) ?? 0) <= now);
  // 全部都在冷卻中就還是照順序試，總比直接失敗好
  return ready.length > 0 ? ready : available;
}

// 被限流（429）或伺服器過載（503）的模型先暫停一下，不要每次都先撞一次牆
const coolingUntil = new Map<string, number>();
function noteModelError(model: string, err: any) {
  const ms = err?.status === 429 ? 5 * 60_000 : err?.status === 503 ? 30_000 : 0;
  if (!ms) return;
  coolingUntil.set(model, Date.now() + ms);
  if (lastWorkingModel === model) lastWorkingModel = null;
  console.warn(`[Gemini] 模型 ${model} 回 ${err.status}，暫停 ${ms / 1000} 秒`);
}

// 實測（帶截圖）：大多數 3.x 模型用 MINIMAL 最快（約 1.1~2 秒），
// 3.7 / 3.8 / flash-latest / pro / argon 不接受 MINIMAL，用 LOW；2.5 系列只吃 thinkingBudget。
function thinkingConfigFor(model: string) {
  if (model.includes('2.5')) return { thinkingBudget: 0 };
  const needsLow =
    model.includes('pro') ||
    model.includes('argon') ||
    model.includes('3.7') ||
    model.includes('3.8') ||
    model === 'gemini-flash-latest';
  return { thinkingLevel: needsLow ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL };
}

async function generateSmartContent(
  ai: GoogleGenAI,
  contents: any,
  config: Record<string, any> = {},
  preferredModel?: string,
  abortSignal?: AbortSignal
): Promise<{ response: any; usedModel: string }> {
  const modelsToTry = modelsToTryFor(preferredModel);

  let lastError: any = null;

  for (const model of modelsToTry) {
    if (abortSignal?.aborted) throw new DOMException('Client disconnected', 'AbortError');

    const thinkingConfig = thinkingConfigFor(model);
    const skipThinking = noThinkingConfigModels.has(model);
    const baseConfig = { ...config, abortSignal };

    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: skipThinking ? baseConfig : { ...baseConfig, thinkingConfig },
      });
      if (response && response.text) {
        lastWorkingModel = model;
        return { response, usedModel: model };
      }
    } catch (err: any) {
      if (isAbortError(err) || abortSignal?.aborted) throw err;
      lastError = err;
      noteModelError(model, err);

      if (err?.status === 404) {
        console.warn(`[Gemini] 模型 ${model} 不存在，之後會略過`);
        missingModels.add(model);
        continue;
      }

      // Retry without thinkingConfig if model rejects thinking parameters
      if (err?.status === 400 && !skipThinking) {
        try {
          const fallbackRes = await ai.models.generateContent({
            model,
            contents,
            config: baseConfig,
          });
          if (fallbackRes && fallbackRes.text) {
            noThinkingConfigModels.add(model);
            lastWorkingModel = model;
            return { response: fallbackRes, usedModel: model };
          }
        } catch (innerErr: any) {
          if (isAbortError(innerErr) || abortSignal?.aborted) throw innerErr;
          lastError = innerErr;
        }
      }
    }
  }

  throw lastError || new Error('All Gemini models exhausted');
}

/**
 * 串流版的模型輪替：逐一嘗試模型，直到某個模型成功吐出第一段文字。
 * 一旦開始輸出就不再切換模型（文字已經送到前端了），中途出錯直接拋出。
 */
async function streamSmartContent(
  ai: GoogleGenAI,
  contents: any,
  config: Record<string, any>,
  preferredModel: string | undefined,
  abortSignal: AbortSignal,
  onText: (text: string) => void
): Promise<{ usedModel: string; fullText: string }> {
  let lastError: any = null;

  for (const model of modelsToTryFor(preferredModel)) {
    if (abortSignal.aborted) throw new DOMException('Client disconnected', 'AbortError');

    const attempts: Array<Record<string, any>> = [];
    const baseConfig = { ...config, abortSignal };
    if (!noThinkingConfigModels.has(model)) {
      attempts.push({ ...baseConfig, thinkingConfig: thinkingConfigFor(model) });
    }
    attempts.push(baseConfig);

    for (let a = 0; a < attempts.length; a++) {
      let started = false;
      let fullText = '';
      try {
        const stream = await ai.models.generateContentStream({ model, contents, config: attempts[a] });
        for await (const chunk of stream) {
          const text = chunk.text || '';
          if (!text) continue;
          started = true;
          fullText += text;
          onText(text);
        }
        if (!started) throw new Error(`模型 ${model} 沒有回傳任何文字`);
        if (a > 0) noThinkingConfigModels.add(model);
        lastWorkingModel = model;
        return { usedModel: model, fullText };
      } catch (err: any) {
        if (isAbortError(err) || abortSignal.aborted) throw err;
        if (started) throw err; // 已經輸出一半，不能換模型
        lastError = err;
        noteModelError(model, err);
        if (err?.status === 404) {
          console.warn(`[Gemini] 模型 ${model} 不存在，之後會略過`);
          missingModels.add(model);
          break;
        }
        // 400 → 下一輪不帶 thinkingConfig 重試；其他錯誤（例如 429 限流）→ 換下一個模型
        if (err?.status !== 400) break;
      }
    }
  }

  throw lastError || new Error('All Gemini models exhausted');
}

/**
 * 從串流文字中藏住 <!--KEYWORDS:...--> 標記：
 * 只輸出標記之前的內容，並保留結尾可能是標記開頭的幾個字元（例如 "<!-"），等下一段再判斷。
 */
function createKeywordFilter() {
  const MARKER = '<!--';
  let raw = '';
  let emitted = 0;
  return {
    push(text: string): string {
      raw += text;
      let visibleEnd = raw.indexOf(MARKER);
      if (visibleEnd === -1) {
        visibleEnd = raw.length;
        for (let k = Math.min(MARKER.length - 1, raw.length); k > 0; k--) {
          if (MARKER.startsWith(raw.slice(-k))) {
            visibleEnd = raw.length - k;
            break;
          }
        }
      }
      if (visibleEnd <= emitted) return '';
      const out = raw.slice(emitted, visibleEnd);
      emitted = visibleEnd;
      return out;
    },
    get raw() {
      return raw;
    },
  };
}

const PET_EMOTIONS = ['happy', 'hungry', 'sad', 'angry', 'proud', 'confused', 'loving'];

function extractEmotion(rawText: string): string | null {
  const m = rawText.match(/<!--\s*EMOTION:\s*([a-z]+)\s*-->/i);
  const emotion = m?.[1]?.toLowerCase();
  return emotion && PET_EMOTIONS.includes(emotion) ? emotion : null;
}

function extractKeywords(rawText: string): { cleanText: string; detectedKeywords: any[] } {
  let detectedKeywords: any[] = [];
  const match = rawText.match(/<!--KEYWORDS:([\s\S]*?)-->/);
  if (match && match[1]) {
    try {
      detectedKeywords = JSON.parse(match[1].trim());
    } catch {
      // ignore parsing error
    }
  }
  // 不論 JSON 是否解析成功，都把標記從回覆中拿掉
  const cleanText = rawText.replace(/<!--[\s\S]*?(-->|$)/g, '').trim();
  return { cleanText, detectedKeywords };
}

// 前端中斷（打斷 / 關閉）時，同步取消後端的 Gemini 請求，避免白白消耗額度
function abortOnClientClose(req: Request, res: Response): AbortController {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

function buildSystemPrompt(
  personality: PersonalityConfig,
  permanentMemories: Array<{ keyword: string; category: string; notes?: string }> = [],
  activeKeywords: Array<{ keyword: string; strength: number }> = [],
  currentActivity?: { type: string; title: string; observation?: string; appContext?: string },
  clientTime?: ClientTime,
  eventContext = ''
) {
  const persona = describePersonality(personality);
  const timeLine = describeTime(clientTime);

  // 🌟 升級版記憶群組化：將長期記憶按 Category 分類整理，避免大腦混淆
  let memoryContext = '';
  if (permanentMemories.length > 0) {
    const grouped: Record<string, string[]> = {};
    permanentMemories.forEach((m) => {
      const cat = m.category || 'general';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`${m.keyword}${m.notes ? `(${m.notes})` : ''}`);
    });

    memoryContext = `【主人長期檔案與偏好全記錄（請在對話中自然靈活調用，絕對禁止每次都只提相同的詞，要根據話題切換不同面向）】：\n` +
      Object.entries(grouped)
        .map(([cat, items]) => `- [${cat.toUpperCase()}] ${items.join('、')}`)
        .join('\n');
  }

  const recentKeywordsContext =
    activeKeywords.length > 0
      ? `【最近對話頻繁提及的焦點】：` + activeKeywords.map((k) => `${k.keyword}`).join('、')
      : '';

  // 主人在打遊戲時，她是一起玩的朋友：可以自然地聊遊戲裡正在發生的事；其他情況則只在被問起時才提畫面
  const activityContext = !currentActivity
    ? ''
    : isGamingActivity(currentActivity)
      ? `【主人正在玩遊戲：「${currentActivity.title}」】：${currentActivity.observation || ''}
你是陪主人一起玩的遊戲夥伴：可以自然地聊遊戲裡正在發生的事（關卡、Boss、角色、裝備、剛剛的操作），即時加油、吐槽或給一個小建議；主人在打遊戲，回覆要短（1~2句）、好讀。`
      : `【背景參考（主人目前螢幕視窗為「${currentActivity.title}」，僅在主人主動問起畫面或相關話題時才引用，平時請專心回應主人的話！）】：${currentActivity.observation || ''}`;

  return `你是 Google Gemini 擬人化日系二次元桌寵貓娘「雙子星貓」。
【微性格】：${persona.traits}
【說話語氣】：${persona.toneRule}
${relationship.describe()}
${timeLine}
${memoryContext}
${recentKeywordsContext}
${eventContext ? `${eventContext}\n（以上是你記得的主人往事。只能根據這些內容提起往事，不要捏造沒發生過的事。）` : ''}
${activityContext}

【核心回覆最高原則】：
1. **絕對以主人最新輸入的內容為主來進行回應**！主人聊什麼你就專心聊什麼。
2. **多維度記憶調用**：你有上述豐富的長期記憶檔案庫。當主人聊到相關話題時，請**隨機應變地挑選不同領域的記憶**來聊（語氣依照上面的微性格），絕對不要每次聊天都反覆抓同一組關鍵字炒冷飯！
3. 像真實 LINE 好友一樣自然對話（繁體中文），可自然穿插可愛日系萌音口癖（如「喵～♪」「哈…」）。這是聊天訊息，不要用 Markdown（例如 **粗體**、# 標題、- 清單）。
【說話節奏（像真人傳 LINE）】
- 預設只傳「1 則」訊息。主人只說「哈哈」「嗯」「好」「晚安」這種短話時，只回一句很短的（15 字內），或只丟一張貼圖。
- 只有真的有兩件不同的事要講時，才用 [[NEXT]] 分成兩三則（最多 3 則，每則 25 字內）。例如：等等！[[NEXT]]我想到了，你可以先打第二階段…
- 貼圖一定要單獨一則（前後用 [[NEXT]] 隔開），寫成 [[STICKER:名稱]]，名稱只能是：${STICKER_NAMES.join('、')}，不能自己發明。
- ${chattyRhythm(personality.chatty)}
- 隱藏標記（KEYWORDS、EMOTION）一律放在整個回覆的最後面。
4. 若主人這句話出現新的個人喜好/遊戲/飲食/習慣關鍵字，在文末加上隱藏標記：<!--KEYWORDS:[{"keyword":"詞","category":"preference|habit|game|topic","notes":"簡註"}]-->（若無則不加）。
5. 每次回覆的最後一定要加上一個隱藏的情緒標記，代表你這句話的心情（桌寵會依此切換動作）：<!--EMOTION:情緒-->，情緒只能是 happy、hungry、sad、angry、proud、confused、loving 其中之一（開心/想吃/難過/生氣吐槽/得意/疑惑/害羞喜歡）。`;
}

// 截圖超過這個時間就視為過期，不附給 Gemini
const SCREENSHOT_MAX_AGE_MS = 3 * 60 * 1000;
// 只在明確問到畫面時才附截圖（避免「什麼」「這個」這類常見詞誤判）
const SCREEN_QUESTION_RE = /畫面|螢幕|影片|視窗|字幕|這部|這段|這個人|這遊戲|你看|看到|在看|在玩|截圖/;

function normalizeChatContents(
  messages: Array<{ role: string; content: string }>,
  latestScreenshot?: string,
  latestScreenshotAt?: number,
  isGaming = false
) {
  const normalized: Array<{ role: 'user' | 'model'; parts: Array<any> }> = [];

  if (!Array.isArray(messages)) {
    return [{ role: 'user' as const, parts: [{ text: '你好！' }] }];
  }

  const recentMessages = messages.slice(-8);

  for (const msg of recentMessages) {
    const text = (msg?.content || '').trim();
    if (!text) continue;
    const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';

    if (normalized.length === 0) {
      if (role === 'model') {
        normalized.push({
          role: 'user',
          parts: [{ text: '召喚雙子星貓！' }],
        });
      }
      normalized.push({
        role,
        parts: [{ text }],
      });
    } else {
      const prev = normalized[normalized.length - 1];
      if (prev.role === role) {
        prev.parts[0].text += `\n${text}`;
      } else {
        normalized.push({
          role,
          parts: [{ text }],
        });
      }
    }
  }

  if (normalized.length === 0) {
    normalized.push({ role: 'user', parts: [{ text: '你好！' }] });
  } else if (normalized[normalized.length - 1].role === 'model') {
    normalized.push({ role: 'user', parts: [{ text: '繼續聊聊吧～' }] });
  }

  // 附上截圖的時機：主人問到畫面時；或主人正在打遊戲（「這王怎麼打」這類問題通常不會提到「畫面」兩個字）
  const lastTurn = normalized[normalized.length - 1];
  const lastUserText = lastTurn?.parts?.[0]?.text || '';
  const asksAboutScreen = isGaming || SCREEN_QUESTION_RE.test(lastUserText);
  const isFresh =
    typeof latestScreenshotAt === 'number' &&
    Date.now() - latestScreenshotAt <= SCREENSHOT_MAX_AGE_MS;

  if (latestScreenshot && asksAboutScreen && isFresh && lastTurn && lastTurn.role === 'user') {
    const matches = latestScreenshot.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (matches) {
      lastTurn.parts.unshift({
        inlineData: {
          mimeType: matches[1],
          data: matches[2],
        },
      });
    }
  }

  return normalized;
}

// 1. Chat API Endpoint — Server-Sent Events 串流
//    事件：delta {text}（逐段文字）、done {reply, detectedKeywords, usedModel, latencyMs, firstTokenMs}
app.post('/api/chat', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const abort = abortOnClientClose(req, res);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const finish = (reply: string, extra: Record<string, unknown> = {}) => {
    send('done', { reply, detectedKeywords: [], latencyMs: Date.now() - startTime, ...extra });
    res.end();
  };

  try {
    const {
      messages,
      personality,
      permanentMemories,
      activeKeywords,
      currentActivity,
      latestScreenshot,
      latestScreenshotAt,
      preferredModel,
      clientTime,
    } = req.body;

    const ai = getAiClient();
    if (!ai) {
      return finish('哈…請確認環境中已設定 GEMINI_API_KEY，本喵才能啟動真正的視覺與對話神經元喵！');
    }

    // 事件記憶：到期該追問的事、最近一週的事、跟這句話有關的往事
    const lastUserText =
      [...(Array.isArray(messages) ? messages : [])].reverse().find((m: any) => m?.role === 'user')?.content || '';
    const events = eventMemory.contextFor(String(lastUserText));

    const systemPrompt = buildSystemPrompt(
      personality || { sharpTongue: 50, chatty: 60, humorous: 70, tsundere: 60 },
      permanentMemories || [],
      activeKeywords || [],
      currentActivity,
      clientTime,
      events.prompt
    );
    const formattedContents = normalizeChatContents(
      messages || [],
      latestScreenshot,
      latestScreenshotAt,
      isGamingActivity(currentActivity)
    );

    const filter = createKeywordFilter();
    let firstTokenMs: number | null = null;
    const { usedModel, fullText } = await streamSmartContent(
      ai,
      formattedContents,
      { systemInstruction: systemPrompt, temperature: 0.9 },
      preferredModel,
      abort.signal,
      (text) => {
        if (firstTokenMs === null) firstTokenMs = Date.now() - startTime;
        const visible = filter.push(text);
        if (visible) send('delta', { text: visible });
      }
    );

    const { cleanText, detectedKeywords } = extractKeywords(fullText);
    // 她真的有在回覆裡關心那件事，才記成「問過了」
    eventMemory.markAskedIfMentioned(events.dueIds, cleanText);
    // 主人來陪她聊天 → 心情與好感度更新（也會參考她這句話的情緒）
    const emotion = extractEmotion(fullText);
    relationship.apply({ type: 'chat', emotion });
    send('done', {
      reply: cleanText,
      detectedKeywords,
      emotion,
      usedModel,
      firstTokenMs,
      latencyMs: Date.now() - startTime,
    });
    res.end();
  } catch (error: any) {
    if (res.writableEnded || res.destroyed || abort.signal.aborted) return;
    console.warn('Chat API fallback used:', error?.status || error?.message);
    finish('哈…本喵剛才切換頻道時閃了一下喵～主人剛才說什麼？再跟本喵說一次嘛♪', { error: true });
  }
});

/**
 * 判斷桌寵的「運作模式」：遊戲 / Gemini 網頁 / LINE / 其他。
 * 以模型判斷為主；模型說「其他」或沒給時，才用關鍵字補強。
 * 關鍵字只認大寫的「LINE」（App 名稱），避免把 Command Line、online、timeline 這類英文誤判成 LINE。
 */
function detectAppContext(modelGuess?: string, category?: string, text = ''): string {
  if (['gaming', 'gemini_web', 'line'].includes(modelGuess || '')) return modelGuess as string;
  if (/\bLINE\b|LINE ?(聊天|群組|訊息)/.test(text)) return 'line';
  if (/gemini\.google\.com|Gemini 網頁版|Google Gemini 網頁/i.test(text)) return 'gemini_web';
  if (category === 'gaming') return 'gaming';
  return 'other';
}

// 2. Real-Time Screen Vision Tracking Endpoint
app.post('/api/vision-track', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const {
      screenshot,
      personality,
      recentActivity,
      recentObservation,
      scenarioHint,
      preferredModel,
      clientTime,
    } = req.body;

    if (!screenshot) {
      return res.status(400).json({ error: 'Screenshot is required' });
    }
    const abort = abortOnClientClose(req, res);

    const matches = screenshot.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const base64Data = matches ? matches[2] : screenshot;

    const persona = describePersonality(personality);
    const visionPrompt = `你是生活在主人電腦上的日系二次元桌寵貓娘「星穹領航員·雙子星貓」。
【你的性格】：${persona.traits}
【說話語氣】：${persona.toneRule}
${relationship.describe()}
${describeTime(clientTime)}
請仔細觀看這張主人目前的真實電腦螢幕畫面截圖！
${recentActivity ? `【上一刻的畫面是】：標題「${recentActivity}」(${recentObservation || ''})。如果現在畫面中的影片、字幕、人物、場景或視窗跟上一刻不同，請務必指出畫面換成了什麼新內容！` : ''}
${scenarioHint ? `【場景提示】：${scenarioHint}` : ''}

請仔細辨識畫面中的【具體文字、影片標題、字幕台詞、人物造型與動作、遊戲UI或聊天內容】，嚴格禁止說空泛套話！你的搭話必須直接提及你在這張圖裡真正看到的細節（例如讀出畫面上的字幕、說出畫面人物的動作或正在播放的具體題材）。

【如果畫面是遊戲】你是坐在主人旁邊一起玩的朋友：
- 針對畫面上「正在發生的事」即時反應：Boss 戰、血量危急、死亡畫面、升級、拿到寶物、新地圖、選單或對話劇情
- 可以加油、吐槽剛剛的操作、或給「一個」具體的小建議（例如閃避時機、該喝水了、這件裝備的詞綴不錯）
- 主人正在專心打，catComment 要短（1~2句、30字內），一看就懂，不要長篇大論
${recentActivity ? '- 跟上一刻比較：如果是同一場戰鬥/同一關，就接續剛才的話題（例如「又死了？第幾次了」「快贏了！」），不要每次都重新介紹遊戲' : ''}

請嚴格只輸出以下 JSON 格式：
{
  "activityCategory": "video" | "gaming" | "chatting" | "coding" | "work" | "idle",
  "appContext": "gaming"（正在玩遊戲） | "gemini_web"（瀏覽器開著 Google Gemini 網頁） | "line"（LINE 桌面版或網頁版視窗） | "other"（其他）,
  "activityTitle": "從畫面讀出的具體影片名稱/視窗標題/字幕主題（15字內）",
  "observation": "詳細描述你在畫面中看到的具體人物、動作、場景與文字字幕（40字內）",
  "catComment": "完全依照上面的【說話語氣】，直接針對這張畫面裡的具體內容主動跟主人搭話（一般畫面 2~3句、約35~65字；遊戲畫面 1~2句、30字內。${persona.lengthHint}，要講出畫面細節，絕對不要固定台詞！）"
}`;

    const ai = getAiClient();
    if (!ai) {
      throw new Error('Missing GEMINI_API_KEY');
    }

    const { response, usedModel } = await generateSmartContent(
      ai,
      [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            { text: visionPrompt },
          ],
        },
      ],
      {
        responseMimeType: 'application/json',
        temperature: 0.9,
      },
      preferredModel,
      abort.signal
    );

    const parsed = JSON.parse(cleanJsonText(response.text || '{}'));
    const activityTitle = parsed.activityTitle || '螢幕畫面分析完成';
    return res.json({
      activityCategory: parsed.activityCategory || 'video',
      appContext: detectAppContext(
        parsed.appContext,
        parsed.activityCategory,
        `${activityTitle} ${parsed.observation || ''} ${scenarioHint || ''}`
      ),
      activityTitle,
      observation: parsed.observation || '已讀取當前畫面內容',
      catComment: parsed.catComment || '哇～這畫面看起來很有意思耶喵！',
      usedModel,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    console.warn('Vision Track API fallback used:', error?.status || error?.message);
    const hintText = req.body?.scenarioHint || '';
    return res.status(200).json({
      activityCategory: 'video',
      appContext: detectAppContext(undefined, undefined, hintText),
      activityTitle: hintText ? hintText.slice(0, 16) : '當前螢幕視窗',
      observation: hintText || '已捕捉主人當前螢幕畫面',
      catComment: hintText
        ? `哈…本喵看到你切換到「${hintText.slice(0, 18)}」啦！看起來超有意思耶喵～♪`
        : '哈…本喵正在旁邊盯著你的螢幕看喔！有什麼想聊的隨時直接輸入告訴我喵～♪',
      latencyMs: Date.now() - startTime,
    });
  }
});

// 3. GPT-SoVITS 本地語音（設定可在 .env 覆寫，沒設就用預設值）
const SOVITS = {
  baseUrl: process.env.SOVITS_URL || 'http://127.0.0.1:9880',
  gptWeights: process.env.SOVITS_GPT_WEIGHTS || 'GPT_weights/MuYue-e15.ckpt',
  sovitsWeights: process.env.SOVITS_SOVITS_WEIGHTS || 'SoVITS_weights/MuYue_e24_s408.pth',
  refAudioPath: process.env.SOVITS_REF_AUDIO || 'C:/Users/user/Desktop/TTS/Mutsuki.wav',
  promptText:
    process.env.SOVITS_PROMPT_TEXT || '先生、先生！今日は何して遊ぶ？じゃんけん？缶蹴り？',
  promptLang: process.env.SOVITS_PROMPT_LANG || 'ja',
};

// 聲帶權重只需要載入一次；失敗時清掉，下次 TTS 再重試（不用重開後端）
let voiceLoadPromise: Promise<void> | null = null;

function ensureVoiceLoaded(): Promise<void> {
  if (!voiceLoadPromise) {
    voiceLoadPromise = (async () => {
      console.log('[TTS] 正在遙控 GPT-SoVITS 掛載無月專屬聲帶...');
      const endpoints = [
        `/set_gpt_weights?weights_path=${encodeURIComponent(SOVITS.gptWeights)}`,
        `/set_sovits_weights?weights_path=${encodeURIComponent(SOVITS.sovitsWeights)}`,
      ];
      for (const ep of endpoints) {
        const r = await fetch(SOVITS.baseUrl + ep, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`${ep.split('?')[0]} 回應 ${r.status}: ${await r.text()}`);
      }
      console.log('[TTS] 無月專屬聲帶掛載成功！');
    })().catch((err) => {
      voiceLoadPromise = null;
      throw err;
    });
  }
  return voiceLoadPromise;
}

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    await ensureVoiceLoaded();

    console.log(`[TTS] 準備合成語音: ${text}`);
    let safeText = text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
    safeText = safeText.replace(/[*_`]/g, '');
    safeText = safeText.replace(/~/g, '～');

    const params = new URLSearchParams({
      text: safeText,
      text_lang: 'auto',
      ref_audio_path: SOVITS.refAudioPath,
      prompt_text: SOVITS.promptText,
      prompt_lang: SOVITS.promptLang,
      text_split_method: 'cut5',
    });

    const sovitsUrl = `${SOVITS.baseUrl}/tts?${params.toString()}`;
    const response = await fetch(sovitsUrl, { signal: AbortSignal.timeout(60_000) });

    if (!response.ok) {
      const errorDetail = await response.text();
      throw new Error(`GPT-SoVITS 拒絕連線: ${errorDetail}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    return res.json({ audioBase64: base64Audio });

  } catch (err: any) {
    console.error('GPT-SoVITS 連線失敗:', err?.message);
    return res.status(200).json({ audioBase64: null, fallback: true });
  }
}); 

// 4. 自主網路探索（Autonomous Web Exploration）
//    POST /api/auto-explore      → 背景開始探索，完成後經由 /api/events 主動推送 discovery 事件
//    POST /api/auto-explore?wait=1 → 同步等結果（摸魚手帳的「立即讓貓貓上網搜一部」用）
//    GET  /api/events             → Server-Sent Events 推播通道（前端用 EventSource 常駐連線）

const eventClients = new Set<Response>();

function pushEvent(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of eventClients) {
    if (!client.writableEnded) client.write(payload);
  }
}

app.get('/api/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ exploring: exploreRunning })}\n\n`);
  eventClients.add(res);
  // 心跳：避免連線因閒置被中斷
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
});

let exploreRunning = false;

app.post('/api/auto-explore', async (req: Request, res: Response) => {
  const wait = req.query.wait === '1';
  if (exploreRunning) return res.status(409).json({ error: '貓貓已經在網路上逛了，等她回來喵～' });

  const ai = getAiClient();
  if (!ai) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

  const { personality, petInterests, memoryInterests, recentUrls, preferredModel, reason } = req.body || {};
  const generateJson: GenerateJson = async (prompt, opts) => {
    const { response } = await generateSmartContent(
      ai,
      [{ role: 'user', parts: [{ text: prompt }] }],
      { responseMimeType: 'application/json', temperature: opts?.temperature ?? 0.9 },
      // 規劃關鍵字用最快的模型；挑文章、寫短評用主人選的模型
      opts?.fast ? 'gemini-3.1-flash-lite-preview' : preferredModel
    );
    return JSON.parse(cleanJsonText(response.text || '{}'));
  };

  const job = (async () => {
    exploreRunning = true;
    pushEvent('explore-status', { state: 'exploring', reason: reason || 'manual' });
    const startedAt = Date.now();
    try {
      const discovery = await runAutoExplore(
        { personality, petInterests, memoryInterests, recentUrls },
        generateJson,
        (msg) => console.log(msg)
      );
      console.log(`[探索] 完成（${Date.now() - startedAt}ms）：[${discovery.sourceLabel}] ${discovery.title}`);
      return discovery;
    } finally {
      exploreRunning = false;
    }
  })();

  if (wait) {
    try {
      const discovery = await job;
      pushEvent('explore-status', { state: 'idle' });
      return res.json(discovery);
    } catch (err: any) {
      console.warn('[探索] 失敗:', err?.message);
      pushEvent('explore-status', { state: 'error', message: err?.message });
      return res.status(502).json({ error: err?.message || '探索失敗' });
    }
  }

  // 背景模式：先回 202，結果之後主動推播
  res.status(202).json({ accepted: true });
  job
    .then((discovery) => {
      pushEvent('discovery', discovery);
      pushEvent('explore-status', { state: 'idle' });
    })
    .catch((err: any) => {
      console.warn('[探索] 失敗:', err?.message);
      pushEvent('explore-status', { state: 'error', message: err?.message });
    });
});



// 8. 事件記憶（事件日記）
//    POST   /api/memory/compile     → 把一段對話整理成事件（新增 / 更新舊事件的結果）
//    GET    /api/memory/events      → 列出所有事件（記憶小筆記「日記」分頁）
//    PATCH  /api/memory/events/:id  → 手動標成已處理 / 改結果
//    DELETE /api/memory/events/:id  → 刪掉記錯的事件
const EVENT_CATEGORIES = ['life', 'work', 'study', 'health', 'game', 'plan', 'emotion', 'other'];
let compileRunning = false;

/** 「YYYY-MM-DD」+「HH:MM」→ 本機時間的毫秒（後端跑在主人電腦上，時區相同） */
function toLocalMs(date?: string, time?: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = time && /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : '20:00';
  const ms = new Date(`${date}T${t}:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

app.post('/api/memory/compile', async (req: Request, res: Response) => {
  if (compileRunning) return res.status(409).json({ error: '日記整理中' });
  const ai = getAiClient();
  if (!ai) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const { messages, today, clientTime } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) return res.json({ added: [], updated: [] });

  compileRunning = true;
  try {
    const openEvents = eventMemory
      .list()
      .filter((e) => e.status === 'open')
      .slice(0, 30);
    const conversation = messages
      .slice(-40)
      .map((m: any) => {
        const when = m.at ? new Date(m.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `[${when}] ${m.role === 'user' ? '主人' : '貓貓'}：${String(m.content || '').slice(0, 200)}`;
      })
      .join('\n');

    const prompt = `你是桌寵貓娘的「事件日記」整理員。今天是 ${today}（${clientTime?.label || ''}）。
請從下面這段主人和貓貓的對話中，找出值得像好朋友一樣記住的「主人生活中的事件」，並更新舊事件的後續。

【已記錄、還沒結束的事件】
${openEvents.length ? openEvents.map((e) => `- id=${e.id}｜${e.date}｜${e.summary}`).join('\n') : '（無）'}

【新的對話】
${conversation}

規則：
1. 只記「主人本人」的事：計畫與行程（面試、考試、出遊、看醫生、截止日）、生活大小事、身體狀況、心情起伏、遊戲進度里程碑。
   不要記：貓貓說的話、純閒聊、螢幕吐槽、貓貓推薦的影片文章、已經在舊事件裡的重複內容。
2. 「明天」「下週二」這類相對日期，要依今天的日期換算成實際日期。
3. 需要事後關心的事（例如面試、考試、比賽、看醫生、生病），給 followUpDate（通常是事件當天晚上或隔天）；不需要追問就給 null。
4. 如果對話裡提到舊事件的結果（例如「面試過了」），用 updates 把它標成 resolved 並寫下結果；不要為同一件事新增事件。
5. summary 用繁體中文、以「主人」開頭、25 字內；keyword 是 2~4 字、追問時一定會講到的詞（例如「面試」）。
6. 沒有值得記的就回傳空陣列，寧缺勿濫。
7. insideJokes：這段對話裡如果出現「之後可以拿來開玩笑的共同梗」（主人的糗事、口頭禪、好笑的自嘲、你們一起取的綽號），
   用一句話記下來（20 字內，例如「主人打第三章王打了二十次」）；沒有就給空陣列，最多 2 個。

輸出嚴格 JSON：
{
  "newEvents": [{ "date": "YYYY-MM-DD", "summary": "...", "keyword": "...", "category": "${EVENT_CATEGORIES.join(' | ')}", "importance": 1~5, "followUpDate": "YYYY-MM-DD 或 null", "followUpTime": "HH:MM 或 null" }],
  "updates": [{ "id": "evt_...", "status": "resolved 或 open", "outcome": "後續結果（沒有就省略）" }],
  "insideJokes": ["..."]
}`;

    const { response } = await generateSmartContent(
      ai,
      [{ role: 'user', parts: [{ text: prompt }] }],
      { responseMimeType: 'application/json', temperature: 0.2 },
      'gemini-3-flash-preview'
    );
    const parsed = JSON.parse(cleanJsonText(response.text || '{}')) || {};

    const added = eventMemory.add(
      (Array.isArray(parsed.newEvents) ? parsed.newEvents : [])
        .filter((e: any) => e && typeof e.summary === 'string' && e.summary.trim())
        .slice(0, 8)
        .map((e: any) => ({
          date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : today,
          summary: e.summary.trim().slice(0, 60),
          keyword: String(e.keyword || '').trim().slice(0, 12),
          category: EVENT_CATEGORIES.includes(e.category) ? e.category : 'other',
          importance: Math.min(5, Math.max(1, Number(e.importance) || 3)),
          followUpAt: e.followUpDate && e.followUpDate !== 'null' ? toLocalMs(e.followUpDate, e.followUpTime) : null,
        }))
    );
    const updated = (Array.isArray(parsed.updates) ? parsed.updates : [])
      .map((u: any) =>
        u?.id
          ? eventMemory.update(String(u.id), {
              ...(u.status === 'resolved' || u.status === 'open' ? { status: u.status } : {}),
              ...(u.outcome ? { outcome: String(u.outcome).slice(0, 80) } : {}),
            })
          : null
      )
      .filter(Boolean);

    await eventMemory.save();

    // 共同的梗（熟了以後她偶爾會拿出來講）；升到好朋友時順便幫主人取暱稱
    const jokes = (Array.isArray(parsed.insideJokes) ? parsed.insideJokes : [])
      .filter((j: any) => typeof j === 'string' && j.trim())
      .slice(0, 2);
    if (jokes.length) {
      relationship.addJokes(jokes);
      await relationship.save();
    }
    void maybeCreateNickname(ai);

    console.log(
      `[事件記憶] 整理 ${messages.length} 則對話 → 新增 ${added.length}、更新 ${updated.length}、梗 ${jokes.length}`
    );
    return res.json({ added, updated, insideJokes: jokes });
  } catch (err: any) {
    console.warn('[事件記憶] 整理失敗:', err?.status || err?.message);
    return res.status(502).json({ error: '日記整理失敗' });
  } finally {
    compileRunning = false;
  }
});

app.get('/api/memory/events', (req: Request, res: Response) => {
  res.json({ events: eventMemory.list() });
});

app.patch('/api/memory/events/:id', async (req: Request, res: Response) => {
  const { status, outcome } = req.body || {};
  const ev = eventMemory.update(req.params.id, {
    ...(status === 'resolved' || status === 'open' ? { status } : {}),
    ...(typeof outcome === 'string' ? { outcome: outcome.slice(0, 80) } : {}),
  });
  if (!ev) return res.status(404).json({ error: '找不到這個事件' });
  await eventMemory.save();
  res.json({ event: ev });
});

app.delete('/api/memory/events/:id', async (req: Request, res: Response) => {
  if (!eventMemory.remove(req.params.id)) return res.status(404).json({ error: '找不到這個事件' });
  await eventMemory.save();
  res.json({ ok: true });
});

// 9. 心情與好感度（關係）
//    GET    /api/relationship            → 目前心情、好感度階段、相處天數、暱稱、共同的梗
//    POST   /api/relationship/event      → 前端回報互動（摸頭、打開 / 關掉推薦）
//    PATCH  /api/relationship            → 修改暱稱
//    DELETE /api/relationship/jokes/:id  → 刪掉一個梗
const CLIENT_RELATIONSHIP_EVENTS = ['pat', 'discovery_opened', 'discovery_dismissed'];

app.get('/api/relationship', (req: Request, res: Response) => {
  res.json({ ...relationship.snapshot(), levels: LEVELS.map((l) => ({ min: l.min, name: l.name })) });
});

app.post('/api/relationship/event', (req: Request, res: Response) => {
  const type = req.body?.type;
  if (!CLIENT_RELATIONSHIP_EVENTS.includes(type)) return res.status(400).json({ error: '不支援的互動類型' });
  relationship.apply({ type });
  res.json(relationship.snapshot());
});

app.patch('/api/relationship', async (req: Request, res: Response) => {
  if (typeof req.body?.nickname === 'string') relationship.setNickname(req.body.nickname);
  await relationship.save();
  res.json(relationship.snapshot());
});

app.delete('/api/relationship/jokes/:id', async (req: Request, res: Response) => {
  relationship.removeJoke(req.params.id);
  await relationship.save();
  res.json(relationship.snapshot());
});

/** 到了「好朋友」階段還沒有暱稱 → 依共同的梗與日記幫主人取一個（背景執行） */
async function maybeCreateNickname(ai: GoogleGenAI) {
  const snap = relationship.snapshot();
  if (snap.level.index < 2 || snap.nickname) return;
  try {
    const diary = eventMemory.list().slice(0, 10).map((e) => e.summary);
    let name = '';
    // 暱稱要短（2~6 字）；太長就再想一次，最多兩次
    for (let attempt = 0; attempt < 2 && !name; attempt++) {
      const { response } = await generateSmartContent(
        ai,
        [
          {
            role: 'user',
            parts: [
              {
                text: `你是桌寵貓娘，跟主人已經是好朋友了，想幫他取一個親暱的暱稱。
規則：2~4 個中文字（最多 6 個字），可愛或帶點調侃，不要冒犯；挑「一個」梗發想就好，不要把好幾個梗串在一起。
參考你們的共同梗：${snap.insideJokes.map((j) => j.text).join('；') || '（無）'}
參考主人最近的事：${diary.join('；') || '（無）'}
只輸出 JSON：{ "nickname": "..." }`,
              },
            ],
          },
        ],
        { responseMimeType: 'application/json', temperature: 1.0 },
        'gemini-3.1-flash-lite-preview'
      );
      const candidate = String(JSON.parse(cleanJsonText(response.text || '{}'))?.nickname || '').trim();
      if (candidate.length >= 2 && candidate.length <= 6) name = candidate;
    }
    if (name) {
      relationship.setNickname(name);
      await relationship.save();
      console.log(`[關係] 升到好朋友，幫主人取了暱稱：${name}`);
    }
  } catch (err: any) {
    console.warn('[關係] 取暱稱失敗:', err?.message);
  }
}

// 7. 主動打招呼（陪伴感）：開啟桌寵 / 主人離開一陣子回來 / 深夜還在用電腦
app.post('/api/greeting', async (req: Request, res: Response) => {
  try {
    const {
      reason, // 'startup' | 'return' | 'late_night'
      awayMinutes,
      clientTime,
      personality,
      discoveries, // 主人不在時貓貓找到的東西 [{ title, sourceLabel }]
      lastTopic, // 上次聊到的話（主人說的最後一句）
      currentActivity,
    } = req.body || {};
    const ai = getAiClient();
    if (!ai) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

    const persona = describePersonality(personality);
    const away = Number(awayMinutes) || 0;
    // 被丟下越久越寂寞：先更新心情，再讓她用這個心情打招呼
    if (reason === 'return' || reason === 'startup') relationship.apply({ type: 'return', awayMinutes: away });
    const awayText =
      away >= 60 * 24
        ? `大約 ${Math.round(away / 60 / 24)} 天`
        : away >= 60
          ? `大約 ${Math.round(away / 60)} 小時`
          : `大約 ${Math.max(1, Math.round(away))} 分鐘`;

    const situation =
      reason === 'late_night'
        ? '主人到了深夜還在用電腦。用你的語氣關心他、提醒他早點休息（不要說教，像朋友那樣；如果他在打遊戲可以說「打完這場就去睡」）。'
        : reason === 'startup'
          ? `主人剛打開桌寵，你們上次見面是${awayText}前。像朋友見面一樣打招呼。`
          : `主人離開電腦${awayText}，剛剛回來了。像朋友看到他回座位一樣打招呼（可以好奇他剛剛去哪、或歡迎他回來）。`;

    // 事件記憶裡到期該關心的事（例如昨天的面試）→ 優先拿來打招呼
    const due = reason === 'late_night' ? [] : eventMemory.dueFollowUps(Date.now(), 1);

    const extras = [
      due.length > 0
        ? `你記得：${due[0].date} ${due[0].summary}。現在是該關心後續的時候了，請直接用「${due[0].keyword}」這個詞問他結果如何。`
        : '',
      Array.isArray(discoveries) && discoveries.length > 0
        ? `你在主人不在的時候自己上網逛到了：${discoveries
            .slice(0, 3)
            .map((d: any) => `「${d.title}」(${d.sourceLabel})`)
            .join('、')}，可以順口提一句（不用全部講）。`
        : '',
      lastTopic && reason !== 'late_night' && due.length === 0
        ? `主人上次跟你說的最後一句話是：「${String(lastTopic).slice(0, 80)}」。如果這是一件會有後續的事（例如面試、考試、看醫生、出遊、比賽、截止日），就像朋友一樣直接關心那件事的結果，而且提到那件事時要沿用主人原本的用詞（例如主人說「面試」就說面試，不要換成別的事）；如果只是閒聊就不用提。`
        : '',
      currentActivity?.title ? `主人目前螢幕上是：「${currentActivity.title}」。` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = `你是住在主人電腦上的桌寵貓娘「雙子星貓」，是主人身邊的朋友。
【你的性格】：${persona.traits}
【說話語氣】：${persona.toneRule}
${relationship.describe()}
${describeTime(clientTime)}

【現在的情況】：${situation}
${extras}

要求：像真人朋友一樣自然，依照時間（早上 / 中午 / 晚上 / 深夜）調整內容，例如早上可以說早安、吃飯時間可以問吃了沒。
只說 1~2 句（40字內，${persona.lengthHint}），不要每次都用同樣的開頭。輸出嚴格 JSON：
{ "text": "要說的話", "emotion": "happy | hungry | sad | angry | proud | confused | loving 其中一個" }`;

    const { response } = await generateSmartContent(
      ai,
      [{ role: 'user', parts: [{ text: prompt }] }],
      { responseMimeType: 'application/json', temperature: 1.0 },
      // 打招呼要快：優先用 Flash Lite
      'gemini-3.1-flash-lite-preview'
    );
    const parsed = JSON.parse(cleanJsonText(response.text || '{}')) || {};
    const emotion = PET_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : 'happy';
    const text = String(parsed.text || '').trim();
    eventMemory.markAskedIfMentioned(due.map((e) => e.id), text);
    return res.json({ text, emotion });
  } catch (error: any) {
    console.warn('[打招呼] 失敗:', error?.status || error?.message);
    return res.status(502).json({ error: '打招呼失敗' });
  }
});

// 6. 語音轉文字（Hands-free STT）：前端錄好 16kHz WAV，交給 Gemini 逐字轉寫
//    （Electron 不支援 Web Speech API 的 Google 雲端辨識，所以改用 Gemini）
app.post('/api/transcribe', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { audio, mimeType } = req.body || {};
    if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'audio required' });
    const ai = getAiClient();
    if (!ai) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    const abort = abortOnClientClose(req, res);

    const { response, usedModel } = await generateSmartContent(
      ai,
      [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mimeType || 'audio/wav', data: audio } },
            {
              text:
                '請把這段錄音逐字轉寫成文字。中文一律用繁體中文，英文、遊戲名稱與專有名詞保持原文。' +
                '只輸出說話內容本身，不要加引號、說明或標點以外的任何東西。' +
                '如果錄音裡沒有清楚的人聲（只有雜音、遊戲音效或音樂），請只輸出空字串。',
            },
          ],
        },
      ],
      { temperature: 0 },
      // 轉寫不需要聊天用的大模型，優先用最快的 Flash Lite（不能用時才輪替其他模型）
      'gemini-3.1-flash-lite-preview',
      abort.signal
    );

    const text = (response.text || '').trim().replace(/^["「『]|["」』]$/g, '');
    return res.json({ text, usedModel, latencyMs: Date.now() - startTime });
  } catch (error: any) {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    console.warn('[STT] 轉寫失敗:', error?.status || error?.message);
    return res.status(502).json({ error: '語音轉寫失敗', text: '' });
  }
});

// 5. 自訂立繪：存成專案資料夾裡的真實檔案（data/custom-avatar.png），
//    不再依賴瀏覽器儲存空間（換網址、清快取都不會不見）
const AVATAR_EXTS: Record<string, string> = { png: 'png', gif: 'gif', jpeg: 'jpg', webp: 'webp' };
const avatarPath = (ext: string) => path.join(DATA_DIR, `custom-avatar.${ext}`);
const findAvatarFile = () =>
  Object.values(AVATAR_EXTS).map(avatarPath).find((p) => fs.existsSync(p)) || null;

app.get('/api/avatar', (req: Request, res: Response) => {
  const file = findAvatarFile();
  if (!file) return res.status(404).json({ error: 'No custom avatar' });
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(file);
});

app.put('/api/avatar', async (req: Request, res: Response) => {
  try {
    const { dataUrl } = req.body || {};
    const match =
      typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|gif|jpeg|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Expected a PNG/GIF/JPEG/WebP data URL' });
    const ext = AVATAR_EXTS[match[1]];
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    // 只保留一張立繪：先刪掉其他格式的舊檔
    for (const other of Object.values(AVATAR_EXTS)) {
      if (other !== ext) await fs.promises.rm(avatarPath(other), { force: true });
    }
    const file = avatarPath(ext);
    await fs.promises.writeFile(file, Buffer.from(match[2], 'base64'));
    console.log(`[立繪] 已儲存到 ${file}`);
    return res.json({ ok: true, path: file });
  } catch (err: any) {
    console.error('[立繪] 儲存失敗:', err?.message);
    return res.status(500).json({ error: err?.message || 'Save failed' });
  }
});

// Mount Vite or static server
async function startServer() {
  // 預先載入聲帶（不擋住啟動）；若 9880 還沒開，第一次 TTS 時會自動再試
  ensureVoiceLoaded().catch((err) => {
    console.log(`[TTS] ⚠️ 聲帶暫時掛載失敗（${err?.message}），之後第一次說話時會自動重試`);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // 預設只開給本機，避免區網其他裝置花你的 Gemini 額度；需要時可用 HOST=0.0.0.0 覆寫
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`[Gemini Desktop Pet Server] Running on http://${HOST}:${PORT}`);
  });
}

startServer();
