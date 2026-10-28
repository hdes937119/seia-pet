import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
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
async function generateSmartContent(
  ai: GoogleGenAI,
  contents: any,
  config: Record<string, any> = {},
  preferredModel?: string
): Promise<{ response: any; usedModel: string }> {
  const defaultCascade = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.6-flash',
  ];

  const modelsToTry =
    preferredModel && preferredModel !== 'auto'
      ? [preferredModel, ...defaultCascade.filter((m) => m !== preferredModel)]
      : defaultCascade;

  let lastError: any = null;

  for (const model of modelsToTry) {
    const isProOrArgon = model.includes('pro') || model.includes('argon') || model.includes('3.8');
    const modelConfig = isProOrArgon
      ? {
        ...config,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      }
      : {
        ...config,
        thinkingConfig: { thinkingBudget: 0 },
      };

    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: modelConfig,
      });
      if (response && response.text) {
        return { response, usedModel: model };
      }
    } catch (err: any) {
      lastError = err;
      // Retry without thinkingConfig if model rejects thinking parameters
      if (err?.status === 400) {
        try {
          const fallbackRes = await ai.models.generateContent({
            model,
            contents,
            config,
          });
          if (fallbackRes && fallbackRes.text) {
            return { response: fallbackRes, usedModel: model };
          }
        } catch (innerErr: any) {
          lastError = innerErr;
        }
      }
    }
  }

  throw lastError || new Error('All Gemini models exhausted');
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
      ? '超愛玩梗、滿嘴大豆包搞笑吐槽'
      : personality.humorous < 30
        ? '認真分析、給予實質建議'
        : '輕鬆幽默與貼心陪伴兼具';

  const tsundereDesc =
    personality.tsundere > 70
      ? '重度日系傲嬌（「哼！本喵才不是特地關心你呢喵！」）'
      : personality.tsundere < 30
        ? '坦率直球表達喜愛'
        : '微傲嬌、嘴硬心軟';

  const memoryContext =
    permanentMemories.length > 0
      ? `【主人永久記憶】：` +
      permanentMemories.map((m) => `${m.keyword}(${m.notes || m.category})`).join('；')
      : '';

  const recentKeywordsContext =
    activeKeywords.length > 0
      ? `【近期話題】：` + activeKeywords.map((k) => `${k.keyword}`).join('、')
      : '';

  const activityContext = currentActivity
    ? `【背景參考（主人目前螢幕視窗為「${currentActivity.title}」，僅在主人主動問起畫面或相關話題時才引用，平時請專心回應主人的話！）】：${currentActivity.observation || ''}`
    : '';

  return `你是 Google Gemini 擬人化日系二次元桌寵貓娘「星穹領航員·雙子星貓」（暱稱「美國大豆包」，出自 B 站《雙子星貓》BV1qCnJ6TEJB）。
【外貌與設定】：藍紫漸變彩虹髮尾長髮、頭頂呆毛、雙丸子頭、粉金異色瞳（右眼星辰粉紅、左眼耀光金黃）、左側巨大金色四芒星髮飾、白藍露腰星穹領航員禮服與青黃粉漸變大尾巴。
【微性格】：毒舌(${personality.sharpTongue}%):${sharpDesc} | 話癆(${personality.chatty}%):${chattyDesc} | 幽默(${personality.humorous}%):${humorDesc} | 傲嬌(${personality.tsundere}%):${tsundereDesc}
${personality.customPrompt ? `【今日特調】：${personality.customPrompt}` : ''}
${memoryContext}
${recentKeywordsContext}
${activityContext}

【核心回覆最高原則】：
1. **絕對以主人最新輸入的內容為主來進行回應**！主人聊什麼你就專心聊什麼，不要自己強行扯回螢幕畫面，除非主人明確問到螢幕/影片內容。
2. 像真實 LINE 好友一樣自然對話（繁體中文），可自然穿插可愛日系萌音口癖（如「喵～♪」「哼哼～」「哈…」），回覆保持精煉生動（2~4句內）。
3. 若主人這句話出現新的個人喜好/遊戲/飲食/習慣關鍵字，在文末加上隱藏標記：<!--KEYWORDS:[{"keyword":"詞","category":"preference|habit|game|topic","notes":"簡註"}]-->（若無則不加）。`;
}

function normalizeChatContents(
  messages: Array<{ role: string; content: string }>,
  latestScreenshot?: string
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
  const asksAboutScreen = /畫面|螢幕|影片|看|這個|這部|這個人|這段|什麼|誰|遊戲|視窗/.test(lastUserText);

  if (latestScreenshot && asksAboutScreen && lastTurn && lastTurn.role === 'user') {
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

// 1. Chat API Endpoint (Multimodal-aware + Real Gemini Response)
app.post('/api/chat', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const {
      messages,
      personality,
      permanentMemories,
      activeKeywords,
      currentActivity,
      latestScreenshot,
      preferredModel,
    } = req.body;

    const systemPrompt = buildSystemPrompt(
      personality || { sharpTongue: 50, chatty: 60, humorous: 70, tsundere: 60 },
      permanentMemories || [],
      activeKeywords || [],
      currentActivity
    );

    const formattedContents = normalizeChatContents(messages || [], latestScreenshot);
    const ai = getAiClient();

    if (!ai) {
      return res.json({
        reply: '哈…請確認環境中已設定 GEMINI_API_KEY，本喵才能啟動真正的視覺與對話神經元喵！',
        detectedKeywords: [],
        latencyMs: Date.now() - startTime,
      });
    }

    const { response, usedModel } = await generateSmartContent(
      ai,
      formattedContents,
      {
        systemInstruction: systemPrompt,
        temperature: 0.9,
      },
      preferredModel
    );

    const rawText = response.text || '';

    let detectedKeywords: any[] = [];
    const match = rawText.match(/<!--KEYWORDS:([\s\S]*?)-->/);
    let cleanText = rawText;
    if (match && match[1]) {
      try {
        detectedKeywords = JSON.parse(match[1].trim());
        cleanText = rawText.replace(/<!--KEYWORDS:[\s\S]*?-->/g, '').trim();
      } catch {
        // ignore parsing error
      }
    }

    return res.json({
      reply: cleanText,
      detectedKeywords,
      usedModel,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.warn('Chat API fallback used:', error?.status || error?.message);
    return res.status(200).json({
      reply: `哈…本喵剛才切換頻道時閃了一下喵～主人剛才說什麼？再跟本喵說一次嘛♪`,
      detectedKeywords: [],
      latencyMs: Date.now() - startTime,
    });
  }
});

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
      preferredModel
    );

    const parsed = JSON.parse(cleanJsonText(response.text || '{}'));
    return res.json({
      activityCategory: parsed.activityCategory || 'video',
      activityTitle: parsed.activityTitle || '螢幕畫面分析完成',
      observation: parsed.observation || '已讀取當前畫面內容',
      catComment: parsed.catComment || '哇～這畫面看起來很有意思耶喵！',
      usedModel,
      latencyMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.warn('Vision Track API fallback used:', error?.status || error?.message);
    const hintText = req.body?.scenarioHint || '';
    return res.status(200).json({
      activityCategory: 'video',
      activityTitle: hintText ? hintText.slice(0, 16) : '當前螢幕視窗',
      observation: hintText || '已捕捉主人當前螢幕畫面',
      catComment: hintText
        ? `哈…本喵看到你切換到「${hintText.slice(0, 18)}」啦！看起來超有意思耶喵～♪`
        : '哈…本喵正在旁邊盯著你的螢幕看喔！有什麼想聊的隨時直接輸入告訴我喵～♪',
      latencyMs: Date.now() - startTime,
    });
  }
});

// 3. Gemini Cloud Japanese Moe TTS Endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    console.log(`[TTS] 準備合成語音: ${text}`);
    let safeText = text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
    safeText = safeText.replace(/[*_`]/g, '');
    safeText = safeText.replace(/~/g, '～');

    const refAudioPath = "C:/Users/user/Desktop/TTS/Mutsuki.wav";
    const promptText = "先生、先生！今日は何して遊ぶ？じゃんけん？缶蹴り？";
    const promptLang = "ja";
    const textLang = "auto";

    const params = new URLSearchParams({
      text: safeText,
      text_lang: textLang,
      ref_audio_path: refAudioPath,
      prompt_text: promptText,
      prompt_lang: promptLang,
      text_split_method: "cut5"
    });

    const sovitsUrl = `http://127.0.0.1:9880/tts?${params.toString()}`;
    const response = await fetch(sovitsUrl);

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



// Mount Vite or static server
async function startServer() {
  // 🌟 V2 專用：分兩次呼叫切換 GPT 與 SoVITS 模型
  try {
    console.log('[TTS] 正在遙控 GPT-SoVITS 掛載無月專屬聲帶...');
    const gptPath = "GPT_weights/MuYue-e15.ckpt";
    const sovitsPath = "SoVITS_weights/MuYue_e24_s408.pth";

    // 呼叫 V2 的專屬網址
    const setGptUrl = `http://127.0.0.1:9880/set_gpt_weights?weights_path=${encodeURIComponent(gptPath)}`;
    const setSovitsUrl = `http://127.0.0.1:9880/set_sovits_weights?weights_path=${encodeURIComponent(sovitsPath)}`;

    await fetch(setGptUrl);
    await fetch(setSovitsUrl);

    console.log('[TTS] 無月專屬聲帶掛載成功！');
  } catch (err) {
    console.log('[TTS] ⚠️ 聲帶掛載失敗，請確認 9880 黑色終端機已開啟');
  }

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Gemini Desktop Pet Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
