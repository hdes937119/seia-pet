#!/usr/bin/env bash
# 西雅的工坊：只看不改的檢查（由 workshop-inspect.ps1 呼叫）。
# 用法：bash inspect-workshop.sh user|config|source|mount <base64 路徑>|check|unmount
# 不讀、不印任何金鑰；dsh 的設定裡如果出現像金鑰的字串會被遮掉。
set -uo pipefail
MP=/mnt/seia/_inspect
hdr() { printf '\n===== %s =====\n' "$1"; }
redact() { sed -E 's/AIza[0-9A-Za-z_-]{20,}/<已遮蔽>/g; s/((api[_-]?key|token|secret|password)["'"'"']?[[:space:]]*[:=][[:space:]]*)[^[:space:],}]+/\1<已遮蔽>/Ig'; }
loadnode() { export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true; }

case "${1:-}" in
user)
  hdr "1. 基本資料（一般身分）"
  echo "使用者：$(whoami)  uid=$(id -u) gid=$(id -g)"
  uname -r
  loadnode
  echo "node $(node -v 2>&1)"; echo "dsh $(dsh --version 2>&1 | head -n1)"
  echo "bwrap $(bwrap --version 2>&1 | head -n1)"
  echo "--- /etc/wsl.conf ---"; cat /etc/wsl.conf 2>&1
  echo "--- /mnt 底下 ---"; ls -la /mnt 2>&1
  echo "--- 目前掛載的 Windows 磁碟（drvfs/9p）---"; mount | grep -Ei 'drvfs|9p' || echo "（沒有）"
  echo "--- 一般網路（沙盒外）---"
  curl -sS -o /dev/null -m 8 -w 'example.com → HTTP %{http_code}\n' https://example.com 2>&1
  ;;
config)
  loadnode
  mkdir -p "$HOME/workshop/inspect"
  OUT="$HOME/workshop/inspect/dsh-config.txt"
  dsh --profile headless --patch "$HOME/workshop/seia.patch.yml" --dump-config 2>&1 | redact > "$OUT"
  hdr "2. dsh 實際設定（headless＋西雅的 patch）裡跟沙盒、權限、網路、路徑有關的部分"
  echo "（完整內容存在工坊的 ~/workshop/inspect/dsh-config.txt，共 $(wc -l < "$OUT") 行）"
  grep -n -i -E -B1 -A3 'sandbox|bwrap|bubblewrap|network|net[A-Z_-]|permission|allow|deny|readable|writable|read[A-Z_-]|write[A-Z_-]|mount|bind|path|workspace|home|proxy|timeout|exec|shell' "$OUT" | head -n 400
  hdr "3. dsh --help"
  head -n 80 "$HOME/workshop/dsh-help.txt" 2>/dev/null || dsh --help 2>&1 | head -n 80
  ;;
source)
  loadnode
  ROOT="$(npm root -g 2>/dev/null)/@deepseek-ai"
  hdr "4. dsh 程式裡 bubblewrap 的參數（看沙盒預設怎麼開）"
  echo "套件位置：$ROOT"; ls "$ROOT" 2>&1
  echo "--- 出現 bwrap 參數的檔案 ---"
  grep -rlE -- "--unshare-net|--share-net|--ro-bind|--unshare-all|bwrap" "$ROOT" --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null | head -n 20
  echo "--- 參數出現次數 ---"
  grep -rhoE -- "--(unshare-[a-z]+|share-net|ro-bind(-try)?|bind(-try)?|dev-bind|tmpfs|die-with-parent|new-session|clearenv|setenv|chdir|proc|dev)\b" "$ROOT" --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null | sort | uniq -c | sort -rn | head -n 30
  echo "--- 前後文（每個檔案最多 6 處）---"
  for f in $(grep -rlE -- "--unshare-net|--share-net|--ro-bind" "$ROOT" --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null | head -n 6); do
    echo "## ${f#$ROOT/}"
    grep -noE -- ".{0,160}(--unshare-net|--share-net|--ro-bind|allowNetwork|network[A-Za-z]*).{0,160}" "$f" 2>/dev/null | head -n 6 | cut -c1-400
  done
  echo "--- 說明文件裡的沙盒段落 ---"
  for d in "$ROOT"/*/; do
    for doc in "$d"SAFETY.md "$d"SANDBOX.md "$d"README.md; do
      [ -f "$doc" ] && grep -n -i -E -A2 'sandbox|bubblewrap|network|沙盒' "$doc" | head -n 40 && echo "（以上：${doc#$ROOT/}）"
    done
  done
  ;;
mount)   # root 身分
  hdr "5. 用 drvfs 手動掛一個測試資料夾（工坊關掉自動掛載時能不能掛）"
  SRC=$(echo "${2:-}" | base64 -d)
  DEFUSER=$(getent passwd 1000 | cut -d: -f1)
  echo "uid 1000 的使用者：${DEFUSER:-（沒有）}"
  umount "$MP" 2>/dev/null; mkdir -p "$MP"
  if mount -t drvfs "$SRC" "$MP" -o ro,uid=1000,gid=1000 2>&1; then echo "✅ 掛載成功（唯讀）：$MP"; else echo "❌ 掛載失敗"; fi
  mount | grep " $MP " || true
  ;;
check)   # 一般身分
  hdr "6. 一般身分看得到測試資料夾嗎？"
  ls -la "$MP" 2>&1
  if touch "$MP/.write-test" 2>/dev/null; then echo "⚠️ 寫得進去（不應該）"; rm -f "$MP/.write-test"; else echo "✅ 寫不進去（唯讀正常）"; fi
  hdr "7. bubblewrap 沙盒裡（模擬 dsh：整個系統唯讀綁進去）"
  echo "--- 沙盒裡看 $MP ---"
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --die-with-parent -- ls -la "$MP" 2>&1 | head -n 10
  echo "--- 沙盒裡連網（不加 --unshare-net）---"
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --die-with-parent -- curl -sS -o /dev/null -m 8 -w 'HTTP %{http_code}\n' https://example.com 2>&1
  echo "--- 沙盒裡連網（加 --unshare-net，應該失敗）---"
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --unshare-net --die-with-parent -- curl -sS -o /dev/null -m 8 -w 'HTTP %{http_code}\n' https://example.com 2>&1
  echo "--- 沙盒裡看得到工坊的 .dsh/.env 嗎（只列檔名，不讀內容）---"
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --die-with-parent -- ls -la "$HOME/.dsh/.env" 2>&1
  ;;
unmount) # root 身分
  hdr "8. 卸下測試資料夾"
  umount "$MP" 2>&1 && echo "✅ 已卸下" || echo "（本來就沒掛著）"
  rmdir "$MP" 2>/dev/null; true
  ;;
*) echo "用法：$0 user|config|source|mount <b64>|check|unmount"; exit 2 ;;
esac
