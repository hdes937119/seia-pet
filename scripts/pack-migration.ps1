<#
  桌寵搬家打包：把「整隻桌寵」打包成一個資料夾，搬到新電腦雙擊就能還原。

  包含：
    project\                 專案程式碼（含 .git 歷史、立繪）、.env（API 金鑰、LINE、行事曆）、data\（事件日記、
                             心情好感度、體力、她長出來的興趣、LINE 綁定、Gemini 網頁問答）、ngrok 設定與 ngrok.exe
    electron-local-storage\  Electron 裡的瀏覽器端記憶（喜好關鍵字、聊天紀錄、摸魚手帳、各種設定）
    voice\GPT-SoVITS\        GPT-SoVITS 語音包（含她的聲音模型；很大，用 -NoVoice 可以不包）
    voice\files\             GPT-SoVITS 資料夾外面的模型權重、參考音檔（她的聲音樣本）
    pack-info.json           舊電腦上的路徑（新電腦還原時用來自動改設定）
    還原桌寵.cmd             在新電腦上雙擊還原
    搬家說明.txt

  不包含：node_modules（新電腦自動重新下載）、logs、dist / build。

  用法：npm run pack:migrate
        或 powershell -ExecutionPolicy Bypass -File scripts\pack-migration.ps1 [-OutDir 輸出資料夾] [-NoVoice]
#>
param(
  [string]$OutDir = [Environment]::GetFolderPath('Desktop'),
  [switch]$NoVoice # 不包 GPT-SoVITS 語音包（新電腦已經有了，或要另外搬）
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AppName = (Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json).name
$LocalStorage = Join-Path $env:APPDATA "$AppName\Local Storage"

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Copy-Tree($from, $to, [string[]]$excludeDirs = @(), [string[]]$excludeFiles = @()) {
  $rcArgs = @($from, $to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($excludeDirs.Count) { $rcArgs += '/XD'; $rcArgs += $excludeDirs }
  if ($excludeFiles.Count) { $rcArgs += '/XF'; $rcArgs += $excludeFiles }
  & robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "複製失敗：$from（robocopy 結束碼 $LASTEXITCODE）" }
}

Say "`n=== 桌寵搬家打包 ===" Cyan
Say "專案位置：$ProjectRoot"

# 1. 桌寵開著的話，記憶檔案會被鎖住、也可能抄到寫到一半的資料
$running = Get-Process -Name electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($ProjectRoot, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Say "`n桌寵還開著，請先執行 stop-pet.bat 把桌寵關掉，再重新打包。" Yellow
  exit 1
}

# 2. 讀 .env，找出語音相關的路徑
$envFile = Join-Path $ProjectRoot '.env'
$envText = if (Test-Path $envFile) { Get-Content -Raw -Encoding UTF8 $envFile } else { '' }
if (-not $envText) { Say '找不到 .env（API 金鑰），新電腦需要自己重新建立。' Yellow }
function Get-EnvValue($name) {
  $m = [regex]::Match($envText, "(?m)^\s*$name\s*=\s*(.+?)\s*$")
  if ($m.Success) { return $m.Groups[1].Value.Trim('"', "'") } else { return $null }
}

# GPT-SoVITS 資料夾：sovits-dir.txt > 桌面預設位置
$sovitsDir = $null
$sovitsTxt = Join-Path $ProjectRoot 'sovits-dir.txt'
if (Test-Path $sovitsTxt) { $sovitsDir = (Get-Content $sovitsTxt -TotalCount 1).Trim() }
if (-not $sovitsDir) { $sovitsDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'GPT-SoVITS-v2pro-20250604' }
if (-not (Test-Path (Join-Path $sovitsDir 'api_v2.py'))) { $sovitsDir = $null }

# 語音用到的檔案（模型權重、參考音檔）：.env 的 SOVITS_xxx > server.ts 裡的預設值
$voicePaths = [ordered]@{}
$serverText = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot 'server.ts')
foreach ($m in [regex]::Matches($serverText, "process\.env\.(SOVITS_[A-Z_]+)\s*\|\|\s*'([^']*)'")) {
  $voicePaths[$m.Groups[1].Value] = $m.Groups[2].Value
}
foreach ($k in @($voicePaths.Keys)) { $v = Get-EnvValue $k; if ($v) { $voicePaths[$k] = $v } }
# 只留「真的存在的絕對路徑檔案」（網址、文字、語言代碼、相對路徑都不用搬）
$voiceFiles = [ordered]@{}
foreach ($k in $voicePaths.Keys) {
  $v = [string]$voicePaths[$k]
  if ($v -match '^[A-Za-z]:[\\/]' -and (Test-Path -LiteralPath $v.Replace('/', '\') -PathType Leaf)) { $voiceFiles[$k] = $v.Replace('/', '\') }
}

# 3. 輸出資料夾
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$pkg = Join-Path $OutDir "桌寵搬家包-$stamp"
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
New-Item -ItemType Directory -Path $pkg | Out-Null

Say "`n[1/4] 複製專案（程式、立繪、記憶、設定）…"
Copy-Tree $ProjectRoot (Join-Path $pkg 'project') `
  @('node_modules', 'TTS', 'dist', 'build', 'coverage', '.cache', 'logs', '_claude_tmp', 'GPT-SoVITS*') `
  @('*.log', '*.tmp', 'sovits-dir.txt')

# ngrok.exe：專案資料夾沒有的話，從系統 PATH 找一份放進去（新電腦不用再裝）
$ngrokInPkg = Join-Path $pkg 'project\ngrok.exe'
if (-not (Test-Path $ngrokInPkg)) {
  $ng = Get-Command ngrok -ErrorAction SilentlyContinue
  $copied = $false
  # Microsoft Store 版的 ngrok 在 WindowsApps 裡只是捷徑，不能複製 → 略過，新電腦重新安裝就好
  if ($ng -and $ng.Source -and (Test-Path $ng.Source) -and $ng.Source -notmatch '\\WindowsApps\\') {
    try {
      Copy-Item $ng.Source $ngrokInPkg -ErrorAction Stop
      Say "  已附上 ngrok.exe（$($ng.Source)）"
      $copied = $true
    } catch {
      Say "  ngrok.exe 複製不了（$($_.Exception.Message)），略過。" Yellow
    }
  }
  if (-not $copied) {
    Say '  沒有附上 ngrok.exe：新電腦要用 LINE 的話，請另外安裝 ngrok（設定檔會跟著搬過去，不用重設）。' Yellow
  }
}

Say '[2/4] 複製瀏覽器端記憶（喜好關鍵字、聊天紀錄、設定）…'
if (Test-Path $LocalStorage) {
  Copy-Tree $LocalStorage (Join-Path $pkg 'electron-local-storage')
} else {
  Say "  找不到瀏覽器端記憶（$LocalStorage），略過。" Yellow
}

Say '[3/4] 複製語音…'
$voiceInfo = @{ sovitsDir = $null; sovitsName = $null }
if ($NoVoice) {
  Say '  已指定 -NoVoice：不包 GPT-SoVITS 語音包（保留路徑資訊供新電腦自動對齊）。' Yellow
  if ($sovitsDir) { $voiceInfo.sovitsDir = $sovitsDir; $voiceInfo.sovitsName = Split-Path $sovitsDir -Leaf }
} elseif (-not $sovitsDir) {
  Say '  找不到 GPT-SoVITS 資料夾（有 api_v2.py 的那個），略過；新電腦要另外搬。' Yellow
} else {
  $sizeGB = [math]::Round(((Get-ChildItem $sovitsDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1GB, 1)
  Say "  GPT-SoVITS：$sovitsDir（約 $sizeGB GB，需要幾分鐘）"
  Copy-Tree $sovitsDir (Join-Path $pkg 'voice\GPT-SoVITS') @('TEMP', 'logs', 'output', '__pycache__')
  $voiceInfo.sovitsDir = $sovitsDir
  $voiceInfo.sovitsName = Split-Path $sovitsDir -Leaf
}
# 模型權重、參考音檔：在 GPT-SoVITS 資料夾裡的會跟著資料夾走，其餘的單獨複製
$fileMap = [ordered]@{}
foreach ($k in $voiceFiles.Keys) {
  $f = $voiceFiles[$k]
  $entry = [ordered]@{ old = $f; inSovits = $null; packed = $null }
  if ($voiceInfo.sovitsDir -and $f.StartsWith($voiceInfo.sovitsDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    $entry.inSovits = $f.Substring($voiceInfo.sovitsDir.TrimEnd('\').Length + 1)
  } else {
    $dst = Join-Path $pkg "voice\files\$k"
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -LiteralPath $f $dst
    $entry.packed = "voice\files\$k\" + (Split-Path $f -Leaf)
    Say "  $k：$f"
  }
  $fileMap[$k] = $entry
}
if (-not $voiceFiles.Count) { Say '  沒有找到語音用的模型 / 參考音檔路徑，略過。' Yellow }

Say '[4/4] 寫入還原工具…'
$info = [ordered]@{
  packedAt = (Get-Date).ToString('s')
  projectDir = $ProjectRoot
  sovitsDir = $voiceInfo.sovitsDir
  sovitsName = $voiceInfo.sovitsName
  voiceFiles = $fileMap
}
[IO.File]::WriteAllText((Join-Path $pkg 'pack-info.json'), ($info | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

# 雙擊還原用的啟動檔（內容只用英文，避免 cmd 編碼問題）
$cmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0project\scripts\restore-migration.ps1`" -PackageDir `"%~dp0.`" %*`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $pkg '還原桌寵.cmd'), $cmd, [Text.Encoding]::ASCII)

$readme = @"
桌寵搬家包（$stamp 打包）

【在新電腦上】
1. 先安裝 Node.js（22 以上）：https://nodejs.org
2. 把整個「桌寵搬家包」資料夾複製到新電腦（隨身碟或外接硬碟；語音包很大，不建議用雲端）。
3. 雙擊資料夾裡的「還原桌寵.cmd」，它會自動：
   - 把桌寵放到「桌面\桌寵」、語音包放到桌面
   - 放回她的記憶（聊天紀錄、喜好、事件日記、心情、體力、興趣…）
   - 依新電腦的位置自動修改語音設定
   - 安裝套件（npm install，第一次要幾分鐘）
4. 雙擊「桌面\桌寵\start-pet.bat」啟動。

想放別的地方：在這個資料夾開 PowerShell，執行
  powershell -ExecutionPolicy Bypass -File project\scripts\restore-migration.ps1 -PackageDir . -Target "D:\桌寵" -VoiceTarget "D:\"

【注意】
- 這個資料夾裡有 .env（Gemini API 金鑰、LINE 金鑰、行事曆網址），請不要傳給別人或上傳到公開的地方。
- LINE 同一時間只能有一台電腦連線：新電腦開始用之後，舊電腦就不要再開桌寵（或先執行 stop-pet.bat）。
- 防毒軟體（例如 McAfee）可能會把 ngrok.exe 當成可疑檔案刪掉，被刪的話請加入排除清單。
- 瀏覽器的 Gemini 網頁連動腳本要在新電腦的瀏覽器重新安裝：
  啟動桌寵後打開 http://127.0.0.1:3000/gemini-web-sync.user.js（需要先裝 Tampermonkey）。
"@
[IO.File]::WriteAllText((Join-Path $pkg '搬家說明.txt'), $readme, (New-Object Text.UTF8Encoding $true))

$sizeMB = [math]::Round(((Get-ChildItem $pkg -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 0)
Say "`n完成！$pkg（約 $sizeMB MB）" Green
Say '把整個資料夾複製到新電腦，雙擊「還原桌寵.cmd」就可以了。'
Say '提醒：這個資料夾裡有你的 API 金鑰和 LINE 金鑰，請用隨身碟或私人硬碟搬，不要分享給別人。' Yellow
