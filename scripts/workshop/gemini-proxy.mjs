// 西雅工坊：dsh ↔ Gemini 的小轉接站（只聽 127.0.0.1）
// Gemini 3 呼叫工具時會附上 thought_signature，下一輪必須原封不動送回去；
// dsh 走 OpenAI 相容介面時會把它弄丟，所以這裡把簽章記下來（依 tool_call id），送回去時再補上。
// 找不到簽章時，補上 Google 文件寫的略過值（模型品質可能稍差，但不會整個失敗）。
//
// 金鑰代填（11/4）：工坊裡的 dsh 只拿到一把假金鑰；桌寵開工時把真金鑰從標準輸入交給這個轉接站（不寫進任何檔案），
// 11/5 起轉接站自己從標準輸入讀（SEIA_KEY_STDIN=1），不放在環境變數裡，所以 /proc/<pid>/environ 也看不到；舊的 SEIA_REAL_KEY 仍可用。
// 轉接站送出請求前才換成真的。另外只放行 Gemini API 的路徑、只允許指定的模型（SEIA_ALLOWED_MODELS），
// 這件工作累計的 token 超過 SEIA_MAX_TOKENS 就擋下（429）。
// 11/11：快取命中的 prompt token 只算 SEIA_CACHE_WEIGHT（預設 0.25）——每一步都會把前面的對話重送一次，
// 重送的部分大多是快取、實際便宜很多，全額算會讓「讀程式再改」的工作還沒動手就用完額度。
import http from 'node:http';

const PORT = Number(process.env.SEIA_PROXY_PORT || 8787);
const UPSTREAM = process.env.SEIA_UPSTREAM || 'https://generativelanguage.googleapis.com';
const SKIP = 'skip_thought_signature_validator';
/** 從標準輸入讀第一行（金鑰），最多等 3 秒；讀完就關掉標準輸入 */
function readKeyFromStdin(ms = 3000) {
  return new Promise((resolve) => {
    let buf = '';
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      try { process.stdin.destroy(); } catch {}
      resolve(buf.split(/\r?\n/)[0] || '');
    };
    const timer = setTimeout(done, ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) done();
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}
const REAL_KEY = process.env.SEIA_KEY_STDIN === '1' ? String(await readKeyFromStdin()).trim() : String(process.env.SEIA_REAL_KEY || '').trim();
delete process.env.SEIA_REAL_KEY;
const ALLOWED_MODELS = String(process.env.SEIA_ALLOWED_MODELS || '')
  .split(',')
  .map((m) => m.trim().replace(/^models\//, ''))
  .filter(Boolean);
const MAX_TOKENS = Number(process.env.SEIA_MAX_TOKENS) || 0;
const CACHE_WEIGHT = (() => {
  const w = Number(process.env.SEIA_CACHE_WEIGHT);
  return Number.isFinite(w) && w >= 0 && w <= 1 ? w : 0.25;
})();
const deny = (res, code, message) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message: `seia proxy: ${message}` } }));
};
const sigs = new Map(); // tool_call id → extra_content

// 用量：把每次回應的 usage 加總，寫到 SEIA_USAGE_FILE（桌寵用來記帳、算預算）
import fs from 'node:fs';
const USAGE_FILE = process.env.SEIA_USAGE_FILE || '';
const total = { calls: 0, prompt: 0, cached: 0, output: 0, counted: 0, model: '', capped: false, keyMode: REAL_KEY ? 'proxy' : 'passthrough' };
/** 算進額度的量：沒快取的 prompt 全算、快取的打折、output 全算 */
const counted = () => Math.round(Math.max(0, total.prompt - total.cached) + total.cached * CACHE_WEIGHT + total.output);
function addUsage(u, model) {
  if (!u || typeof u !== 'object') return;
  total.calls++;
  total.prompt += Number(u.prompt_tokens) || 0;
  total.cached += Number(u.prompt_tokens_details?.cached_tokens) || 0;
  total.output += (Number(u.completion_tokens) || 0);
  total.counted = counted();
  if (model) total.model = model;
  if (USAGE_FILE) try { fs.writeFileSync(USAGE_FILE, JSON.stringify(total)); } catch {}
}

function remember(obj) {
  // 在回應（含串流片段）裡找 tool_calls 的 extra_content
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) return obj.forEach(remember);
  if (obj.extra_content && obj.id) sigs.set(obj.id, obj.extra_content);
  for (const v of Object.values(obj)) if (v && typeof v === 'object') remember(v);
}
// 串流時 id 只出現在第一個片段、簽章可能在後面的片段：用 index 對回 id
function rememberStream(chunk, byIndex) {
  for (const c of chunk?.choices || []) {
    for (const tc of c?.delta?.tool_calls || []) {
      const i = tc.index ?? 0;
      if (tc.id) byIndex.set(i, tc.id);
      const id = tc.id || byIndex.get(i);
      if (id && tc.extra_content) sigs.set(id, tc.extra_content);
    }
  }
  remember(chunk);
}

function patchRequest(body) {
  delete body.store;
  for (const m of body.messages || []) {
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    m.tool_calls.forEach((tc, i) => {
      if (tc.extra_content) return;
      const saved = sigs.get(tc.id);
      if (saved) tc.extra_content = saved;
      else if (i === 0) tc.extra_content = { google: { thought_signature: SKIP } };
    });
  }
  if (sigs.size > 2000) sigs.clear();
  return body;
}

http
  .createServer(async (req, res) => {
    if (req.url === '/__health') {
      res.writeHead(200);
      return res.end('ok');
    }
    // 只放行 Gemini API 的路徑
    if (!/^\/v1(beta)?\//.test(String(req.url || ''))) return deny(res, 403, 'path not allowed');
    // 這件工作的額度用完了
    if (MAX_TOKENS && counted() >= MAX_TOKENS) {
      if (!total.capped) {
        total.capped = true;
        if (USAGE_FILE) try { fs.writeFileSync(USAGE_FILE, JSON.stringify(total)); } catch {}
      }
      return deny(res, 429, `token budget for this job is used up (${MAX_TOKENS}; cached tokens counted at ${CACHE_WEIGHT})`);
    }
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let raw = Buffer.concat(chunks);
      if (raw.length && String(req.headers['content-type'] || '').includes('json')) {
        let body = null;
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {}
        if (body && typeof body === 'object') {
          const model = String(body.model || '').replace(/^models\//, '');
          if (ALLOWED_MODELS.length && model && !ALLOWED_MODELS.includes(model)) return deny(res, 403, `model not allowed: ${model}`);
          raw = Buffer.from(JSON.stringify(patchRequest(body)));
        }
      }
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!['host', 'content-length', 'connection', 'accept-encoding'].includes(k)) headers[k] = v;
      }
      let url = String(req.url);
      if (REAL_KEY) {
        // 假金鑰換成真的（OpenAI 相容介面用 Authorization: Bearer）
        delete headers['x-goog-api-key'];
        headers['authorization'] = `Bearer ${REAL_KEY}`;
        url = url.replace(/([?&])key=[^&]*&?/, '$1').replace(/[?&]$/, '');
      }
      const up = await fetch(UPSTREAM + url, { method: req.method, headers, body: raw.length ? raw : undefined });
      const outHeaders = {};
      up.headers.forEach((v, k) => {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) outHeaders[k] = v;
      });
      res.writeHead(up.status, outHeaders);
      const isStream = String(up.headers.get('content-type') || '').includes('event-stream');
      const dec = new TextDecoder();
      const byIndex = new Map();
      let lastUsage = null;
      let lastModel = '';
      let buf = '';
      let whole = '';
      for await (const part of up.body) {
        res.write(part);
        const t = dec.decode(part, { stream: true });
        if (isStream) {
          buf += t;
          let n;
          while ((n = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, n).trim();
            buf = buf.slice(n + 1);
            if (line.startsWith('data:') && line !== 'data: [DONE]') {
              try {
                const chunk = JSON.parse(line.slice(5));
                rememberStream(chunk, byIndex);
                if (chunk?.usage) lastUsage = chunk.usage;
                if (chunk?.model) lastModel = chunk.model;
              } catch {}
            }
          }
        } else whole += t;
      }
      if (!isStream && whole) try {
        const j = JSON.parse(whole);
        remember(j);
        lastUsage = j?.usage || null;
        lastModel = j?.model || '';
      } catch {}
      if (lastUsage) addUsage(lastUsage, lastModel);
      res.end();
    } catch (err) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `seia proxy: ${err?.message || err}` } }));
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`[工坊轉接站] http://127.0.0.1:${PORT}（金鑰：${REAL_KEY ? '轉接站代填' : '照 dsh 傳來的'}；模型：${ALLOWED_MODELS.join(',') || '不限'}；上限：${MAX_TOKENS || '不限'} tokens，快取算 ${CACHE_WEIGHT}）`);
    if (USAGE_FILE) try { fs.writeFileSync(USAGE_FILE, JSON.stringify(total)); } catch {}
  });
