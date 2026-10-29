<#
  桌寵搬家打包：把搬到另一台電腦需要的東西打包成一個 zip。

  包含：
    project\                 專案程式碼（含 .git 歷史）、.env（API 金鑰）、data\（立繪、事件日記、心情好感度）
    electron-local-storage\  Electron 裡的瀏覽器端記憶（喜好關鍵字、聊天紀錄、摸魚手帳、各種設定）
    還原桌寵.cmd             在新電腦上雙擊還原
    搬家說明.txt

  不包含：node_modules（新電腦 npm install 重新下載）、TTS\（GPT-SoVITS 語音包，請另外搬）、dist / build。

  用法：npm run pack:migrate
        或 powershell -ExecutionPolicy Bypass -File scripts\pack-migration.ps1 [-OutDir 輸出資料夾]
#>
param(
  [string]$OutDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AppName = (Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json).name
$LocalStorage = Join-Path $env:APPDATA "$AppName\Local Storage"

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

Say "`n=== 桌寵搬家打包 ===" Cyan
Say "專案位置：$ProjectRoot"

# 1. 桌寵開著的話，瀏覽器端記憶的檔案會被鎖住、也可能抄到寫到一半的資料 → 先請主人關掉
$running = Get-Process -Name electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($ProjectRoot, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Say "`n桌寵還開著，請先把桌寵視窗關掉再打包（記憶檔案正在使用中）。" Yellow
  exit 1
}

# 2. 檢查必要的東西
$envFile = Join-Path $ProjectRoot '.env'
$dataDir = Join-Path $ProjectRoot 'data'
if (-not (Test-Path $envFile)) { Say '找不到 .env（API 金鑰），新電腦需要自己重新建立。' Yellow }
if (-not (Test-Path $dataDir)) { Say '找不到 data 資料夾（立繪、事件日記、心情好感度），將不會包含。' Yellow }
$hasLocalStorage = Test-Path $LocalStorage
if (-not $hasLocalStorage) { Say "找不到瀏覽器端記憶（$LocalStorage），將不會包含。" Yellow }

# 3. 複製到暫存資料夾
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$staging = Join-Path ([IO.Path]::GetTempPath()) "pet-migration-$stamp"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Say "`n複製專案檔案…"
$projectOut = Join-Path $staging 'project'
# robocopy：/E 含子資料夾，/XD 排除資料夾，/XF 排除檔案；結束碼 0~7 代表成功
robocopy $ProjectRoot $projectOut /E /XD node_modules TTS dist build coverage .cache /XF *.log *.tmp /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Say "複製專案失敗（robocopy 結束碼 $LASTEXITCODE）" Red; exit 1 }

if ($hasLocalStorage) {
  Say '複製瀏覽器端記憶…'
  robocopy $LocalStorage (Join-Path $staging 'electron-local-storage') /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Say "複製瀏覽器端記憶失敗（robocopy 結束碼 $LASTEXITCODE）" Red; exit 1 }
}

# 雙擊還原用的啟動檔（內容只用英文，避免 cmd 編碼問題）
$cmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0project\scripts\restore-migration.ps1`" -PackageDir `"%~dp0.`" %*`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $staging '還原桌寵.cmd'), $cmd, [Text.Encoding]::ASCII)

$readme = @"
桌寵搬家包（$stamp 打包）

【在新電腦上】
1. 先安裝 Node.js（22 以上）：https://nodejs.org
2. 把這個 zip 解壓縮到任何地方（例如桌面）。
3. 確認舊電腦和新電腦上的桌寵都沒開著，然後雙擊「還原桌寵.cmd」。
   預設會還原到「桌面\桌寵」，並自動執行 npm install。
   想放別的地方：在這個資料夾開 PowerShell，執行
   powershell -ExecutionPolicy Bypass -File project\scripts\restore-migration.ps1 -PackageDir . -Target "D:\桌寵"
4. 另外把 GPT-SoVITS 語音包搬過去並啟動它的 API（127.0.0.1:9880）。
   如果參考音檔或模型路徑跟舊電腦不同，在 .env 加上 SOVITS_REF_AUDIO 等設定（參考 .env.example）。
5. 啟動：在專案資料夾執行 npm run electron:dev

【注意】
- 這個包裡有 .env（Gemini API 金鑰），請不要傳給別人或上傳到公開的地方。
- 網址必須維持 http://localhost:3000，不然瀏覽器端記憶讀不到。
- 不包含：node_modules（會重新下載）、TTS 語音包（請另外搬）。
"@
[IO.File]::WriteAllText((Join-Path $staging '搬家說明.txt'), $readme, (New-Object Text.UTF8Encoding $true))

# 4. 壓縮（用 UTF-8 檔名，中文檔名在新電腦解壓才不會變亂碼）
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zipPath = Join-Path $OutDir "桌寵搬家包-$stamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Say '壓縮中…'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# 逐一寫入，路徑統一用「/」（Windows PowerShell 內建的 CreateFromDirectory 會寫成「\」，不符合 zip 標準）
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create, [Text.Encoding]::UTF8)
try {
  $base = $staging.TrimEnd('\') + '\'
  foreach ($file in Get-ChildItem $staging -Recurse -File -Force) {
    $entryName = $file.FullName.Substring($base.Length).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zip.Dispose()
}
Remove-Item $staging -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Say "`n完成！$zipPath（$sizeMB MB）" Green
Say '內容：專案程式碼、.env（API 金鑰）、data（立繪、事件日記、心情好感度）、瀏覽器端記憶'
Say '提醒：這個 zip 裡有你的 API 金鑰，請用隨身碟或私人雲端搬，不要分享給別人。' Yellow
Say '提醒：GPT-SoVITS 語音包沒有包進去，請另外搬。' Yellow
