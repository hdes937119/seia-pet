/**
 * 讀取後端 /api/chat 的 Server-Sent Events 串流。
 * （瀏覽器內建的 EventSource 只支援 GET，這裡用 fetch + ReadableStream 自己解析，才能 POST 對話內容。）
 */

export interface ChatDonePayload {
  reply: string;
  detectedKeywords?: Array<{ keyword: string; category?: any; notes?: string }>;
  emotion?: string | null; // 桌寵情緒：happy / hungry / sad / angry / proud / confused / loving
  // 音樂播放器指令（主人叫她放歌、切歌、調音量時才有）
  music?: {
    action: 'play' | 'pause' | 'resume' | 'next' | 'previous' | 'stop' | 'volume';
    query?: string;
    volume?: number;
  } | null;
  usedModel?: string;
  latencyMs?: number;
  firstTokenMs?: number | null;
  error?: boolean;
  attachments?: Array<{ type: 'image' | 'link'; url: string; link?: string; title?: string }>; // 她真的上網找到的東西
  petStatus?: { tier: 'fresh' | 'tired' | 'exhausted'; raining: boolean }; // 聊完之後的體力與天氣
}

export async function streamChat(
  body: unknown,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onEvent?: (event: string, data: any) => void // 其他事件（例如 act：微表情）
): Promise<ChatDonePayload> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`對話連線異常（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: ChatDonePayload | null = null;

  const handleEvent = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = JSON.parse(dataLines.join('\n'));
    if (event === 'delta' && data.text) onDelta(data.text);
    else if (event === 'done') done = data;
    else onEvent?.(event, data);
  };

  while (true) {
    const { value, done: streamEnded } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    // SSE 事件之間以空行分隔
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      handleEvent(buffer.slice(0, sep).replace(/\r/g, ''));
      buffer = buffer.slice(sep + 2);
    }
    if (streamEnded) break;
  }
  if (buffer.trim()) handleEvent(buffer.replace(/\r/g, ''));

  if (!done) throw new Error('對話串流意外中斷');
  return done;
}

/**
 * 把串流文字切成「完整的句子」，讓語音可以一句一句先講。
 * 太短的句子（例如「哈…」）會跟下一句合併，避免語音斷斷續續。
 */
export function createSentenceSplitter(minLength = 8) {
  let pending = '';
  const END = /[。！？!?♪\n]|…+|～+(?=\s|[^～])/g;
  return {
    push(text: string): string[] {
      pending += text;
      const out: string[] = [];
      let lastCut = 0;
      let m: RegExpExecArray | null;
      END.lastIndex = 0;
      while ((m = END.exec(pending)) !== null) {
        const cut = m.index + m[0].length;
        const sentence = pending.slice(lastCut, cut);
        if (sentence.trim().length >= minLength) {
          out.push(sentence.trim());
          lastCut = cut;
        }
      }
      pending = pending.slice(lastCut);
      return out;
    },
    flush(): string {
      const rest = pending.trim();
      pending = '';
      return rest;
    },
  };
}
