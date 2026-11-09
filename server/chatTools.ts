/**
 * 聊天的工具呼叫（11/6，取代 WORK／COMMISSION／CFEEDBACK 隱藏標記）。
 *
 * 她手上有一排工具，看主人的話自己決定要不要用、用哪個、或先問主人。
 * 一輪回覆最多用 MAX_ROUNDS 次工具；用了工具之後，這一輪固定同一個模型（Gemini 3 的思考簽章要原封不動傳回去）。
 *
 * 這裡只放：工具宣告、跑工具的循環（串流和非串流）。真正執行工具的程式在 server.ts（要用到很多模組）。
 */

export const MAX_ROUNDS = 3;

export const CHAT_TOOL_DECLS = [
  {
    name: 'start_workshop_work',
    description:
      '主人明確要你在工坊做一個「單一網頁」的小作品（小遊戲、小工具、小動畫）時用。只是聊到、問你會不會、或你自己想做，都不要用。要花好幾天、要累積資料、要分階段的大東西用 create_commission。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '作品名（12 字內）' },
        brief: { type: 'string', description: '寫給工坊助手的具體說明：做成什麼樣子、怎麼玩、你想加的小細節（60～150 字）' },
      },
      required: ['title', 'brief'],
    },
  },
  {
    name: 'create_commission',
    description:
      '主人明確把一個比較大、要花好幾天慢慢做的東西交給你（委託、長期計畫、要分階段、要累積資料的系統或工具）時用。呼叫之前先簡短說一句（例如「好，我先把計畫寫出來，等我一下」）；工具會寫好計畫和階段交回給你，你再用自己的話告訴主人重點、問他同不同意（完整計畫在設定面板）。主人還在挑方向（例如叫你「先列清單給我選」）時不要用：先在回覆裡列選項問他，等他選好再用，把他選的寫進 direction。不確定主人是不是要委託，就先問。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '委託名稱（12 字內）' },
        direction: { type: 'string', description: '主人要的東西，照主人的話寫清楚（目標、成品樣子、用途、他選了哪些）' },
        constraints: { type: 'string', description: '主人說的限制（沒有就空字串）' },
      },
      required: ['title', 'direction'],
    },
  },
  {
    name: 'reply_commission',
    description:
      '主人對某個委託給回覆時用：approve＝主人明確同意正在等他的計畫或階段成果（或從你列的選項裡選好了）；changes＝要你改；note＝其他意見；pause／resume／drop＝主人明確說暫停、繼續、不做了。不確定主人是不是同意，就先問，不要用 approve。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '委託 id（不知道就空字串，會找最近在等回覆的）' },
        decision: { type: 'string', enum: ['approve', 'changes', 'note', 'pause', 'resume', 'drop'] },
        note: { type: 'string', description: '主人的意見或選擇，照他的意思寫清楚' },
      },
      required: ['decision', 'note'],
    },
  },
  {
    name: 'commission_status',
    description: '主人問委託做得怎樣、計畫是什麼、上次報告了什麼時，用它查清楚再回答（不要憑印象講）。',
    parametersJsonSchema: { type: 'object', properties: { id: { type: 'string', description: '委託 id（空字串＝最近的）' } } },
  },
  {
    name: 'plan_actions',
    description:
      '主人要你在他電腦上做事（例如「幫我裝 OBS」「把那個檔案下載下來」）時，照順序列出步驟送成行動提案；主人要在電腦前的設定面板按同意才會執行，同意後就不能改。步驟只能用：{"type":"winget","id":"套件 ID"}、{"type":"download","url":"公開網址","filename":"檔名"}、{"type":"open","target":"下載\\\\西雅 裡的檔名或公開網址"}、{"type":"write_file","folder":"工作桌（或主人借的可新增檔案的資料夾）","path":"相對路徑","content":"內容"}。不確定套件 ID 就照實說，不要亂猜。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        why: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['winget', 'download', 'open', 'write_file'] },
              id: { type: 'string' },
              url: { type: 'string' },
              filename: { type: 'string' },
              target: { type: 'string' },
              folder: { type: 'string' },
              path: { type: 'string' },
              content: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['type'],
          },
        },
      },
      required: ['title', 'why', 'steps'],
    },
  },
  {
    name: 'my_desk',
    description:
      '看你和主人共用的「西雅的工作桌」（桌寵資料夾裡）：你做好的作品（成品）、委託的網頁和報告（委託）會自動放上去；主人想給你看的檔案放在「給西雅」。不給 file＝看工作桌上有什麼；file＝讀「給西雅」裡的一個文字檔（相對路徑）。主人說「我放了東西給你」「你看一下工作桌」時用。',
    parametersJsonSchema: { type: 'object', properties: { file: { type: 'string' } } },
  },
  {
    name: 'propose_widget',
    description:
      '申請把你做好的工坊作品或委託網頁「裝成配件」，放進主人的桌寵（圓形選單「配件」），像鬧鐘、計時器、提醒小工具。主人在設定面板同意才會裝。配件可以要的權限：say（讓你在桌面上說一句話）、notify（Windows 通知）、remind（定時提醒，時間到你會提醒主人）。只要真的用得到的權限。作品要先做好、而且程式裡用 window.seia 才能用這些權限（沒用的話它就只是一個小視窗）。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '作品 id（w-…）、委託 id（c-…），或作品／委託的名字' },
        title: { type: 'string', description: '配件名稱（10 字內）' },
        why: { type: 'string', description: '為什麼適合當配件、主人怎麼用（80 字內）' },
        perms: { type: 'array', items: { type: 'string', enum: ['say', 'notify', 'remind'] } },
      },
      required: ['source', 'why'],
    },
  },
  {
    name: 'my_tools',
    description: '看你的工具箱：你自己做出來、可以直接跑的工具（不花 AI 額度）。想到「我好像做過能做這件事的工具」時先看一下。',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_my_tool',
    description: '跑你工具箱裡的一個工具（例如主人問價格，就跑你做的抓價工具），結果交回給你再告訴主人。要等幾十秒，跑之前先跟主人說一聲。tool＝工具 id 或名稱；note＝（可省略）這次用完你對這個工具的一句心得。',
    parametersJsonSchema: { type: 'object', properties: { tool: { type: 'string' }, note: { type: 'string' } }, required: ['tool'] },
  },
];

export const CHAT_TOOL_NAMES = CHAT_TOOL_DECLS.map((t) => t.name);

/** 工具執行器：回傳給她看的文字 */
export type ToolRunner = (name: string, args: any) => Promise<string>;

/** 一次串流的結果：文字已經交給 onText；parts 是這一輪模型完整的輸出（含思考簽章、工具呼叫） */
export interface StreamRound {
  parts: any[];
  meta?: any;
}

/**
 * 串流版：每一輪把文字即時交給 onText；有工具呼叫就執行、把結果接回去再串流下一輪。
 * streamOnce(contents) 負責真的呼叫模型（第一輪可以輪替模型，之後固定同一個）。
 */
export async function runToolLoopStream(
  contents: any[],
  streamOnce: (contents: any[], round: number, onText: (t: string) => void) => Promise<StreamRound>,
  onText: (t: string) => void,
  runTool: ToolRunner,
  log: (m: string) => void = console.log
): Promise<{ fullText: string; calls: string[] }> {
  let fullText = '';
  const calls: string[] = [];
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    let roundText = '';
    const wrapped = (t: string) => {
      if (!t) return;
      // 第二輪以後的文字跟前面的隔一行，才不會黏在一起
      if (!roundText && fullText && !/\n$/.test(fullText)) {
        fullText += '\n';
        onText('\n');
      }
      roundText += t;
      fullText += t;
      onText(t);
    };
    const r = await streamOnce(contents, round, wrapped);
    const fcs = r.parts.filter((p) => p && p.functionCall);
    if (!fcs.length || round === MAX_ROUNDS) {
      if (fcs.length) log(`[聊天工具] 工具呼叫超過 ${MAX_ROUNDS} 次，停下來`);
      break;
    }
    contents.push({ role: 'model', parts: r.parts });
    const responses: any[] = [];
    for (const p of fcs) {
      const fc = p.functionCall;
      calls.push(fc.name);
      let result = '';
      try {
        result = await runTool(fc.name, fc.args || {});
      } catch (err: any) {
        result = `工具出錯：${String(err?.message || err).slice(0, 200)}`;
      }
      log(`[聊天工具] ${fc.name} ${JSON.stringify(fc.args || {}).slice(0, 120)} → ${result.replace(/\s+/g, ' ').slice(0, 80)}`);
      responses.push({ functionResponse: { name: fc.name, id: fc.id, response: { result: String(result).slice(0, 6000) } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { fullText, calls };
}

/** 非串流版（LINE）：generateOnce 回傳一輪的 parts */
export async function runToolLoop(
  contents: any[],
  generateOnce: (contents: any[], round: number) => Promise<StreamRound>,
  runTool: ToolRunner,
  log: (m: string) => void = console.log
): Promise<{ fullText: string; calls: string[] }> {
  let fullText = '';
  const calls: string[] = [];
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const r = await generateOnce(contents, round);
    const text = r.parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
    if (text) fullText += (fullText && !/\n$/.test(fullText) ? '\n' : '') + text;
    const fcs = r.parts.filter((p) => p && p.functionCall);
    if (!fcs.length || round === MAX_ROUNDS) break;
    contents.push({ role: 'model', parts: r.parts });
    const responses: any[] = [];
    for (const p of fcs) {
      const fc = p.functionCall;
      calls.push(fc.name);
      let result = '';
      try {
        result = await runTool(fc.name, fc.args || {});
      } catch (err: any) {
        result = `工具出錯：${String(err?.message || err).slice(0, 200)}`;
      }
      log(`[聊天工具] (LINE) ${fc.name} ${JSON.stringify(fc.args || {}).slice(0, 120)} → ${result.replace(/\s+/g, ' ').slice(0, 80)}`);
      responses.push({ functionResponse: { name: fc.name, id: fc.id, response: { result: String(result).slice(0, 6000) } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { fullText, calls };
}
