<#
  西雅的工坊：在 Windows 專業版上用 WSL2 建一個跟你的電腦隔離的 Linux，裡面裝 DeepSeek Harness（dsh）。
  第一次執行：安裝 WSL2 和專用的 Ubuntu（需要系統管理員，可能要重新開機）
  重新開機、建立 Ubuntu 帳號密碼後再執行一次：安裝 Node.js、dsh、設定 Gemini、試做一個小東西、最後把工坊跟 C 槽隔開
#>
$ErrorActionPreference = 'Stop'
$Distro = 'seia-workshop'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Distros { @((wsl.exe -l -q 2>$null) | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ }) }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Say "`n=== 西雅的工坊 ===" Cyan
$have = $false
try { $have = (Distros) -contains $Distro } catch { $have = $false }

if (-not $have) {
  if (-not $isAdmin) {
    Say '第一次安裝需要系統管理員權限，馬上會跳出確認視窗。' Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
  }
  # Windows 內建的舊版 wsl.exe 不認得 --name（也沒有 --version）：先升級成新版 WSL，重開機後再裝 Ubuntu
  wsl.exe --version *> $null
  if ($LASTEXITCODE -ne 0) {
    Say '[更新] 你的 WSL 是 Windows 內建的舊版，先升級成新版（會從網路下載，約 1～3 分鐘）…'
    wsl.exe --update
    if ($LASTEXITCODE -ne 0) { wsl.exe --install --no-distribution --web-download }
    wsl.exe --version *> $null
    if ($LASTEXITCODE -ne 0) {
      Say "`nWSL 升級好了（或已經開啟虛擬化功能），請【重新開機】，再用系統管理員身分執行一次這個檔案。" Yellow
      Read-Host '按 Enter 關閉'
      exit 0
    }
    Say 'WSL 已經是新版了。' Green
  }
  Say '[安裝] WSL2 和專用的 Ubuntu 24.04（名稱 seia-workshop，跟你其他的 WSL 分開）…'
  wsl.exe --install -d Ubuntu-24.04 --name $Distro
  if ($LASTEXITCODE -ne 0) {
    Say '安裝沒有完成。如果剛剛是第一次啟用 WSL，請重新開機後再執行一次這個檔案。' Yellow
    Say '如果錯誤訊息說不認得 --name，請先執行 wsl --update 再試一次。' Yellow
    Read-Host '按 Enter 關閉'
    exit 1
  }
  Say "`n安裝完成。如果 Windows 要求重新開機，請重新開機。" Green
  Say '接著會出現 Ubuntu 視窗，請建立一組帳號和密碼（密碼要記住，等一下會用到），然後關掉那個視窗，' Green
  Say '再執行一次這個檔案，就會進行第二階段。' Green
  Read-Host '按 Enter 關閉'
  exit 0
}

Say "[設定] 在 $Distro 裡安裝 dsh、設定 Gemini、試做一個小東西…"
$here = (Resolve-Path $PSScriptRoot).Path
# 把安裝腳本複製進工坊（用 base64，不靠掛載 C 槽，隔離之後也能重跑；也不會被 Windows 換行和編碼弄亂）
$bytes = [IO.File]::ReadAllBytes((Join-Path $here 'setup-workshop.sh'))
$b64 = [Convert]::ToBase64String($bytes)
wsl.exe -d $Distro --cd '~' -- bash -c "echo $b64 | base64 -d > ~/setup-workshop.sh && chmod +x ~/setup-workshop.sh"
if ($LASTEXITCODE -ne 0) { Say '複製安裝腳本失敗。' Red; Read-Host '按 Enter 關閉'; exit 1 }
# 11/4 起工坊裡不放真金鑰（由桌寵開工時交給轉接站代填），這裡不再要求輸入金鑰
if ($false) {
  Say '請貼上 Gemini API 金鑰（Ctrl+V 或滑鼠右鍵都可以；畫面會顯示成 *****），然後按 Enter：' Cyan
  $sec = Read-Host -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
  if ($key.Length -lt 20 -or $key -match '\s') { Say "金鑰看起來不完整（只收到 $($key.Length) 個字），先跳過。" Yellow }
  else {
    # 用 base64 放在參數裡傳進去（從 PowerShell 用管線傳給 wsl.exe 會掉資料）
    $kb = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($key))
    wsl.exe -d $Distro --cd '~' -- bash -c "mkdir -p ~/.dsh && touch ~/.dsh/.env && chmod 600 ~/.dsh/.env && sed -i '/^GEMINI_API_KEY=/d' ~/.dsh/.env && printf 'GEMINI_API_KEY=%s\n' `$(echo $kb | base64 -d) >> ~/.dsh/.env && grep -q '^GEMINI_API_KEY=[A-Za-z0-9._-]\{20,\}' ~/.dsh/.env"
    Remove-Variable kb
    Remove-Variable key
    if ($LASTEXITCODE -eq 0) { Say '金鑰已經存進工坊。' Green } else { Say '金鑰存入失敗。' Red }
  }
}
# 互動執行（sudo 密碼在這個視窗裡輸入）
wsl.exe -d $Distro --cd '~' -- bash setup-workshop.sh
if ($LASTEXITCODE -ne 0) {
  Say "`n設定失敗。請把上面的訊息貼給 Claude。" Red
  Read-Host '按 Enter 關閉'
  exit 1
}
wsl.exe --terminate $Distro | Out-Null
Say "`n✅ 工坊準備好了，而且已經跟你的 C 槽隔開。" Green
Say "工坊的檔案在：\\wsl.localhost\$Distro\home\（你的 Ubuntu 帳號）\workshop" Green
Read-Host '按 Enter 關閉'
