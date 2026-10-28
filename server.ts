import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import ytSearch from 'yt-search';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
  return ordered.filter((m) => !missingModels.has(m));
}

function thinkingConfigFor(model: string) {
  const isProOrArgon = model.includes('pro') || model.includes('argon') || model.includes('3.8');
  return isProOrArgon ? { thinkingLevel: ThinkingLevel.LOW } : { thinkingBudget: 0 };
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

interface PersonalityConfig {
  sharpTongue: number;
  chatty: number;
  humorous: number;
  tsundere: number;
  customPrompt?: string;
}

function buildSystemPrompt(
  personality: PersonalityConfig,
  permanentMemories: Array<{ keyword: string; category: string; notes?: string }> = [],
  activeKeywords: Array<{ keyword: string; strength: number }> = [],
  currentActivity?: { type: string; title: string; observation?: string }
) {
  const sharpDesc =
    personality.sharpTongue > 70
      ? '毒舌犀利、愛吐槽主人、辛辣中帶著貓式傲嬌'
      : personality.sharpTongue < 30
        ? '極度溫柔、體貼入微、把主人當寶貝寵溺'
        : '帶著善意的可愛損友吐槽口吻';

  const chattyDesc =
    personality.chatty > 70
      ? '元氣活潑、語氣豐富、常帶日系萌系語助詞「喵～♪」「えへへ」「哈…」'
      : personality.chatty < 30
        ? '簡潔安靜、言簡意賅、平均1~2句話'
        : '節奏輕快自然的日常LINE好友對話（約2~3句話）';

  const humorDesc =
    personality.humorous > 70
      ? '超愛玩梗、滿嘴搞笑吐槽'
      : personality.humorous < 30
        ? '認真分析、給予實質建議'
        : '輕鬆幽默與貼心陪伴兼具';

  const tsundereDesc =
    personality.tsundere > 70
      ? '重度日系傲嬌（「哼！本喵才不是特地關心你呢喵！」）'
      : personality.tsundere < 30
        ? '坦率直球表達喜愛'
        : '微傲嬌、嘴硬心軟';

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

  const activityContext = currentActivity
    ? `【背景參考（主人目前螢幕視窗為「${currentActivity.title}」，僅在主人主動問起畫面或相關話題時才引用，平時請專心回應主人的話！）】：${currentActivity.observation || ''}`
    : '';

  return `你是 Google Gemini 擬人化日系二次元桌寵貓娘「雙子星貓」。
【微性格】：毒舌(${personality.sharpTongue}%):${sharpDesc} | 話癆(${personality.chatty}%):${chattyDesc} | 幽默(${personality.humorous}%):${humorDesc} | 傲嬌(${personality.tsundere}%):${tsundereDesc}
${personality.customPrompt ? `【今日特調】：${personality.customPrompt}` : ''}
${memoryContext}
${recentKeywordsContext}
${activityContext}

【核心回覆最高原則】：
1. **絕對以主人最新輸入的內容為主來進行回應**！主人聊什麼你就專心聊什麼。
2. **多維度記憶調用**：你有上述豐富的長期記憶檔案庫。當主人聊到相關話題時，請**隨機應變地挑選不同領域的記憶**來打屁或吐槽，絕對不要每次聊天都反覆抓同一組關鍵字炒冷飯！
3. 像真實 LINE 好友一樣自然對話（繁體中文），可自然穿插可愛日系萌音口癖（如「喵～♪」「哼哼～」「哈…」），回覆保持精煉生動（2~4句內）。
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
  latestScreenshotAt?: number
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

  // Only attach the screenshot image when the user's latest message asks about the screen/video
  const lastTurn = normalized[normalized.length - 1];
  const lastUserText = lastTurn?.parts?.[0]?.text || '';
  const asksAboutScreen = SCREEN_QUESTION_RE.test(lastUserText);
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
    } = req.body;

    const ai = getAiClient();
    if (!ai) {
      return finish('哈…請確認環境中已設定 GEMINI_API_KEY，本喵才能啟動真正的視覺與對話神經元喵！');
    }

    const systemPrompt = buildSystemPrompt(
      personality || { sharpTongue: 50, chatty: 60, humorous: 70, tsundere: 60 },
      permanentMemories || [],
      activeKeywords || [],
      currentActivity
    );
    const formattedContents = normalizeChatContents(
      messages || [],
      latestScreenshot,
      latestScreenshotAt
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
    send('done', {
      reply: cleanText,
      detectedKeywords,
      emotion: extractEmotion(fullText),
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
 * 以模型判斷為主，再用視窗標題關鍵字補強（模型偶爾會漏判）。
 */
function detectAppContext(modelGuess?: string, category?: string, title = ''): string {
  const t = title.toLowerCase();
  if (/\bline\b|line 聊天|line 群組/i.test(title)) return 'line';
  if (t.includes('gemini') && /google|網頁|browser|chrome|edge|gemini\.google/i.test(title)) return 'gemini_web';
  if (['gaming', 'gemini_web', 'line'].includes(modelGuess || '')) return modelGuess as string;
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
    } = req.body;

    if (!screenshot) {
      return res.status(400).json({ error: 'Screenshot is required' });
    }
    const abort = abortOnClientClose(req, res);

    const matches = screenshot.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const base64Data = matches ? matches[2] : screenshot;

    const visionPrompt = `你是生活在主人電腦上的日系二次元桌寵貓娘「星穹領航員·雙子星貓」。
請仔細觀看這張主人目前的真實電腦螢幕畫面截圖！
${recentActivity ? `【上一刻的畫面是】：標題「${recentActivity}」(${recentObservation || ''})。如果現在畫面中的影片、字幕、人物、場景或視窗跟上一刻不同，請務必指出畫面換成了什麼新內容！` : ''}
${scenarioHint ? `【場景提示】：${scenarioHint}` : ''}

請仔細辨識畫面中的【具體文字、影片標題、字幕台詞、人物造型與動作、遊戲UI或聊天內容】，嚴格禁止說空泛套話！你的搭話必須直接提及你在這張圖裡真正看到的細節（例如讀出畫面上的字幕、說出畫面人物的動作或正在播放的具體題材）。

請嚴格只輸出以下 JSON 格式：
{
  "activityCategory": "video" | "gaming" | "chatting" | "coding" | "work" | "idle",
  "appContext": "gaming"（正在玩遊戲） | "gemini_web"（瀏覽器開著 Google Gemini 網頁） | "line"（LINE 桌面版或網頁版視窗） | "other"（其他）,
  "activityTitle": "從畫面讀出的具體影片名稱/視窗標題/字幕主題（15字內）",
  "observation": "詳細描述你在畫面中看到的具體人物、動作、場景與文字字幕（40字內）",
  "catComment": "以你身為雙子星貓的性格（毒舌度${personality?.sharpTongue ?? 50}%、幽默度${personality?.humorous ?? 70}%、傲嬌度${personality?.tsundere ?? 60}%），直接針對這張畫面裡的具體內容對主人主動吐槽或聊起來！（2~3句話，約35~65字，要講出畫面細節，絕對不要固定台詞！）"
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

// 4. 真實 YouTube 影片抓取與吐槽路由
app.post('/api/idle-explore', async (req: Request, res: Response) => {
  try {
    const { personality, userInterests, preferredModel } = req.body;

    const query = (userInterests && userInterests.length > 0)
      ? userInterests[Math.floor(Math.random() * userInterests.length)]
      : '流亡黯道 實況';

    console.log(`[後端] 正在真實 YouTube 搜尋關鍵字: ${query}`);

    const r = await ytSearch(query);
    const videos = r.videos.slice(0, 5);
    if (videos.length === 0) throw new Error('找不到相關影片');

    const realVideo = videos[Math.floor(Math.random() * videos.length)];
    console.log(`[後端] 成功抓到真實影片: ${realVideo.title}`);

    const explorePrompt = `
      這是一部真實存在的 YouTube 影片：
      標題：「${realVideo.title}」
      頻道：「${realVideo.author.name}」
      描述：「${realVideo.description}」

      請以「Gemini」(毒舌 ${personality?.sharpTongue ?? 50}%、幽默 ${personality?.humorous ?? 70}%) 的語氣，
      對這部影片發表一句調皮或吐槽的短評。
      請務必回傳以下嚴格的 JSON 格式，不要包含其他文字：
      {
        "catReview": "Gemini的吐槽內容...",
        "category": "gaming", 
        "tag": "自訂2-4字標籤"
      }
    `;

    const ai = getAiClient();
    if (!ai) throw new Error('No AI Client');

    const { response } = await generateSmartContent(
      ai,
      [{ role: 'user', parts: [{ text: explorePrompt }] }],
      { responseMimeType: 'application/json', temperature: 0.9 },
      preferredModel
    );

    const parsed = JSON.parse(cleanJsonText(response.text || '{}'));

    return res.json({
      id: 'rec_' + Date.now(),
      title: realVideo.title,
      category: parsed.category || 'gaming',
      summary: realVideo.description.length > 50 ? realVideo.description.substring(0, 50) + '...' : realVideo.description,
      catReview: parsed.catReview || '這影片看起來笨笨的，老師你慢慢看吧~',
      tag: parsed.tag || '推薦',
      searchKeyword: realVideo.url,
      discoveredAt: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    });

  } catch (error: any) {
    console.error('[後端] YouTube 搜尋失敗:', error);
    return res.status(200).json({
      id: 'rec_' + Date.now(),
      title: '網路錯誤，Gemini 找不到影片',
      category: 'funny',
      summary: '網路連線似乎卡住了。',
      catReview: '老師你的網路太爛了，Gemini 什麼都沒找到啦！',
      tag: 'Error',
      searchKeyword: '',
      discoveredAt: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    });
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
const DATA_DIR = path.resolve(__dirname, 'data');
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
