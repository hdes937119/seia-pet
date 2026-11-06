#!/usr/bin/env bash
# 西雅的工坊（在 WSL 的 Linux 裡）：安裝 DeepSeek Harness（dsh），接上 Gemini，並跟你的 Windows 隔離開來。
# 由 workshop-2-setup.bat 呼叫；也可以在工坊的 Ubuntu 裡自己執行：bash setup-workshop.sh
set -euo pipefail

say() { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }

say "1/5 安裝系統套件（bubblewrap 是 dsh 的沙盒；會要你輸入 Ubuntu 的密碼）"
sudo apt-get update -y
sudo apt-get install -y bubblewrap curl git ca-certificates

say "2/5 安裝 Node.js 24（dsh 需要 24.9 以上）"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
node -v

say "3/5 安裝 DeepSeek Harness（dsh）"
# dsh 需要幾個套件的安裝腳本（建 node-pty、koffi、子程序小幫手），新版 npm 預設不跑，要明確允許
if command -v dsh >/dev/null 2>&1 && [ "${DSH_REINSTALL:-0}" != 1 ]; then
  echo "dsh 已經裝好了，跳過（要重裝就先 export DSH_REINSTALL=1）"
else
  npm install -g --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs @deepseek-ai/dsh
fi
dsh --version

say "4/5 設定模型（Gemini，經過工坊轉接站）"
mkdir -p "$HOME/.dsh" "$HOME/workshop"
touch "$HOME/.dsh/.env"
chmod 600 "$HOME/.dsh/.env"
# 工坊裡不放真金鑰：dsh 只拿到假的，真的由桌寵開工時交給轉接站代填（11/4 起）
sed -i '/^GEMINI_API_KEY=/d' "$HOME/.dsh/.env"
printf 'GEMINI_API_KEY=%s\n' 'seia-proxy-fills-the-real-key' >> "$HOME/.dsh/.env"
# 工坊專用的設定覆蓋檔：每次叫 dsh 時用 --patch 帶上，不改 dsh 本身的設定
cat > "$HOME/workshop/seia.patch.yml" <<'YAML'
# 西雅工坊的模型設定（dsh 的 --patch 覆蓋檔）
- id: llm-pi-ai
  config:
    providers:
      gemini:
        apiKeyEnv: GEMINI_API_KEY
        # 經過工坊裡的小轉接站（gemini-proxy.mjs）：幫 Gemini 3 保留工具呼叫的 thought_signature
        api: openai-completions
        baseURL: http://127.0.0.1:8787/v1beta/openai/
        defaultInput: [text, image]
        compat:
          supportsStore: false
          supportsDeveloperRole: false
          supportsStrictMode: false
          maxTokensField: max_tokens
        models:
          - id: gemini-3.1-flash-lite-preview
          - id: gemini-3-flash-preview
- id: agent-default-model
  config:
    provider: gemini
    model: gemini-3.1-flash-lite-preview
YAML
echo "已寫入 ~/workshop/seia.patch.yml"
cat > "$HOME/workshop/gemini-proxy.mjs" <<'JS'
// 西雅工坊：dsh ↔ Gemini 的小轉接站（只聽 127.0.0.1）
// Gemini 3 呼叫工具時會附上 thought_signature，下一輪必須原封不動送回去；
// dsh 走 OpenAI 相容介面時會把它弄丟，所以這裡把簽章記下來（依 tool_call id），送回去時再補上。
// 找不到簽章時，補上 Google 文件寫的略過值（模型品質可能稍差，但不會整個失敗）。
import http from 'node:http';

const PORT = Number(process.env.SEIA_PROXY_PORT || 8787);
const UPSTREAM = process.env.SEIA_UPSTREAM || 'https://generativelanguage.googleapis.com';
const SKIP = 'skip_thought_signature_validator';
const sigs = new Map(); // tool_call id → extra_content

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
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let raw = Buffer.concat(chunks);
      if (raw.length && String(req.headers['content-type'] || '').includes('json')) {
        try {
          raw = Buffer.from(JSON.stringify(patchRequest(JSON.parse(raw.toString('utf8')))));
        } catch {}
      }
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!['host', 'content-length', 'connection', 'accept-encoding'].includes(k)) headers[k] = v;
      }
      const up = await fetch(UPSTREAM + req.url, { method: req.method, headers, body: raw.length ? raw : undefined });
      const outHeaders = {};
      up.headers.forEach((v, k) => {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) outHeaders[k] = v;
      });
      res.writeHead(up.status, outHeaders);
      const isStream = String(up.headers.get('content-type') || '').includes('event-stream');
      const dec = new TextDecoder();
      const byIndex = new Map();
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
              try { rememberStream(JSON.parse(line.slice(5)), byIndex); } catch {}
            }
          }
        } else whole += t;
      }
      if (!isStream && whole) try { remember(JSON.parse(whole)); } catch {}
      res.end();
    } catch (err) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `seia proxy: ${err?.message || err}` } }));
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[工坊轉接站] http://127.0.0.1:${PORT}`));
JS
echo "已寫入 ~/workshop/gemini-proxy.mjs（Gemini 轉接站）"

say "5/5 檢查（不呼叫 Gemini）"
# 11/7：以前這一步用 dsh 實際試做一個網頁，但 11/4 起工坊裡只有假金鑰（真的由桌寵開工時交給轉接站），
# 在這裡試做一定失敗，還害後面的隔離沒做。改成只檢查工具都在；真正的試做請在桌寵的工坊面板按「去做吧」。
dsh --help > "$HOME/workshop/dsh-help.txt" 2>&1 || true
CHECK_OK=1
command -v bwrap >/dev/null 2>&1 && bwrap --version || { echo "⚠️ 找不到 bubblewrap（dsh 的沙盒）"; CHECK_OK=0; }
node -v || CHECK_OK=0
dsh --version || CHECK_OK=0
node --check "$HOME/workshop/gemini-proxy.mjs" && echo "轉接站語法 OK" || CHECK_OK=0
[ -s "$HOME/workshop/seia.patch.yml" ] && echo "模型設定 OK" || CHECK_OK=0

say "隔離：讓工坊看不到你的 C 槽、也不能執行 Windows 程式"
sudo tee /etc/wsl.conf > /dev/null <<'CONF'
# 西雅的工坊：跟 Windows 隔離
[automount]
enabled = false
mountFsTab = false
[interop]
enabled = false
appendWindowsPath = false
CONF
echo "已寫入 /etc/wsl.conf（關掉 WSL 之後生效）"

if [ "$CHECK_OK" = 1 ]; then
  echo "✅ 工坊測試成功（工具都在；真正的試做請重開桌寵後在工坊面板按「去做吧」）"
else
  echo "❌ 工坊測試失敗：有工具沒裝好，把上面的訊息貼給 Claude"
  exit 1
fi
