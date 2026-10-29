<#
  桌寵搬家還原：在新電腦上把搬家包還原。

  1. 把 project\ 複製到目標資料夾（預設：桌面\桌寵）
  2. 把瀏覽器端記憶放回 %APPDATA%\<套件名稱>\Local Storage（原本有的會先備份）
  3. 執行 npm install

  用法：解壓縮搬家包後雙擊「還原桌寵.cmd」
        或 powershell -ExecutionPolicy Bypass -File project\scripts\restore-migration.ps1 -PackageDir 解壓縮的資料夾 [-Target 安裝位置] [-Force] [-SkipInstall]
#>
param(
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$Target = (Join-Path ([Environment]::GetFolderPath('Desktop')) '桌寵'),
  [switch]$Force, # 目標資料夾已經有東西時，仍然覆蓋（會先備份 data 和 .env）
  [switch]$SkipInstall, # 不執行 npm install
  [string]$StorageDir = '' # 瀏覽器端記憶要放的位置（預設 %APPDATA%\<套件名稱>\Local Storage；測試用）
)

$ErrorActionPreference = 'Stop'
function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

$PackageDir = (Resolve-Path $PackageDir).Path
$projectSrc = Join-Path $PackageDir 'project'
$storageSrc = Join-Path $PackageDir 'electron-local-storage'

Say "`n=== 桌寵搬家還原 ===" Cyan
if (-not (Test-Path (Join-Path $projectSrc 'package.json'))) {
  Say "在 $PackageDir 裡找不到 project\package.json，請確認是解壓縮後的搬家包資料夾。" Red
  exit 1
}
$AppName = (Get-Content -Raw -Encoding UTF8 (Join-Path $projectSrc 'package.json') | ConvertFrom-Json).name
$storageDst = if ($StorageDir) { [IO.Path]::GetFullPath($StorageDir) } else { Join-Path $env:APPDATA "$AppName\Local Storage" }

# 桌寵開著的話，瀏覽器端記憶會被鎖住或被覆蓋回去
$running = Get-Process -Name electron -ErrorAction SilentlyContinue
if ($running) {
  Say '偵測到有 Electron 程式在執行（可能是桌寵），請先關掉再還原。' Yellow
  exit 1
}

# 1. 專案檔案
$Target = [IO.Path]::GetFullPath($Target)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ((Test-Path $Target) -and (Get-ChildItem $Target -Force | Select-Object -First 1)) {
  if (-not $Force) {
    Say "目標資料夾已經有東西：$Target" Yellow
    Say '要覆蓋請加上 -Force（會先備份原本的 data 和 .env），或用 -Target 指定別的位置。' Yellow
    exit 1
  }
  $backup = "$Target-還原前備份-$stamp"
  New-Item -ItemType Directory -Path $backup | Out-Null
  foreach ($item in @('data', '.env')) {
    $p = Join-Path $Target $item
    if (Test-Path $p) { Copy-Item $p -Destination $backup -Recurse -Force }
  }
  Say "原本的 data 和 .env 已備份到：$backup"
}
Say "還原專案到：$Target"
robocopy $projectSrc $Target /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Say "複製專案失敗（robocopy 結束碼 $LASTEXITCODE）" Red; exit 1 }

# 2. 瀏覽器端記憶
if (Test-Path $storageSrc) {
  if (Test-Path $storageDst) {
    $old = "$storageDst-還原前備份-$stamp"
    Move-Item $storageDst $old
    Say "這台電腦原本的瀏覽器端記憶已備份到：$old"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $storageDst) | Out-Null
  robocopy $storageSrc $storageDst /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Say "還原瀏覽器端記憶失敗（robocopy 結束碼 $LASTEXITCODE）" Red; exit 1 }
  Say "瀏覽器端記憶已還原到：$storageDst"
} else {
  Say '搬家包裡沒有瀏覽器端記憶，略過（她會記得事件日記和心情好感度，但喜好關鍵字和聊天紀錄會是空的）。' Yellow
}

# 3. npm install
if (-not $SkipInstall) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Say "`n這台電腦還沒有安裝 Node.js，請到 https://nodejs.org 安裝後，在 $Target 執行 npm install。" Yellow
  } else {
    Say "`n安裝套件（npm install，第一次要幾分鐘）…"
    Push-Location $Target
    try {
      npm install
      if ($LASTEXITCODE -ne 0) { Say 'npm install 失敗，請檢查網路後在專案資料夾重跑一次。' Red }
    } finally {
      Pop-Location
    }
  }
}

Say "`n還原完成！" Green
if (-not (Test-Path (Join-Path $Target '.env'))) {
  Say '注意：沒有 .env，請照 .env.example 建立並填入 GEMINI_API_KEY。' Yellow
}
Say '接下來：'
Say '  1. 把 GPT-SoVITS 語音包搬過來並啟動它的 API（127.0.0.1:9880）；路徑不同的話在 .env 設定 SOVITS_REF_AUDIO 等（參考 .env.example）'
Say "  2. 在 $Target 執行 npm run electron:dev 啟動桌寵"
Say '  3. 網址請維持 http://localhost:3000，瀏覽器端記憶才讀得到'
