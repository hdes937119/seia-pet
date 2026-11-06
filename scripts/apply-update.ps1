<#
  桌寵套用更新：把更新包的程式碼套用到這台電腦已經裝好的桌寵。

  會保留這台電腦自己的：
    .env（API 金鑰、語音設定）、data\（立繪、事件日記、心情好感度）、瀏覽器端記憶（喜好關鍵字、聊天紀錄…）

  步驟：
    1. 把目前的程式碼（含 data、.env）備份到「桌寵-更新前備份-日期」
    2. 用更新包的程式碼覆蓋（不動 data、.env、node_modules）
    3. 舊版語音設定寫在程式裡的，自動搬到 .env，更新後聲音不會變
    4. 找這台電腦的 GPT-SoVITS 資料夾，讓 start-pet.bat 能啟動它
    5. npm install

  用法：解壓縮更新包後雙擊「套用更新.cmd」
        或 powershell -ExecutionPolicy Bypass -File project\scripts\apply-update.ps1 -PackageDir 解壓縮的資料夾 [-Target 桌寵位置] [-SkipInstall]
#>
param(
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$Target = (Join-Path ([Environment]::GetFolderPath('Desktop')) '桌寵'),
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

$PackageDir = (Resolve-Path $PackageDir).Path
$projectSrc = Join-Path $PackageDir 'project'
$Target = [IO.Path]::GetFullPath($Target)

Say "`n=== 桌寵套用更新 ===" Cyan
if (-not (Test-Path (Join-Path $projectSrc 'package.json'))) {
  Say "在 $PackageDir 裡找不到 project\package.json，請確認是解壓縮後的更新包資料夾。" Red
  exit 1
}
if (-not (Test-Path (Join-Path $Target 'package.json'))) {
  Say "在 $Target 找不到已安裝的桌寵。" Red
  Say '桌寵裝在別的地方的話，請用 -Target 指定位置；這台電腦還沒裝過的話，請改用搬家包（npm run pack:migrate）。' Yellow
  exit 1
}

# 桌寵開著的話，檔案可能被鎖住
$running = Get-Process -Name electron -ErrorAction SilentlyContinue
if ($running) {
  Say '偵測到桌寵（Electron）還開著，請先把桌寵視窗和 Desktop Pet 視窗都關掉再更新。' Yellow
  exit 1
}

# 讀出 server.ts 裡寫死的語音預設值（SOVITS_xxx || '預設值'）
function Get-SovitsDefaults([string]$file) {
  $map = @{}
  if (-not (Test-Path $file)) { return $map }
  $text = Get-Content -Raw -Encoding UTF8 $file
  if (-not $text) { return $map }
  foreach ($m in [regex]::Matches($text, "process\.env\.(SOVITS_[A-Z_]+)\s*\|\|\s*'([^']*)'")) {
    $map[$m.Groups[1].Value] = $m.Groups[2].Value
  }
  return $map
}
$oldDefaults = Get-SovitsDefaults (Join-Path $Target 'server.ts')
$newDefaults = Get-SovitsDefaults (Join-Path $projectSrc 'server.ts')

# 1. 備份
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Target-更新前備份-$stamp"
Say "備份目前的桌寵到：$backup"
robocopy $Target $backup /E /XD node_modules TTS "GPT-SoVITS*" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Say "備份失敗（robocopy 結束碼 $LASTEXITCODE），沒有做任何更新。" Red; exit 1 }

# 2. 覆蓋程式碼（不動記憶、金鑰、套件、這台電腦的語音資料夾設定）
Say '套用新的程式碼…'
robocopy $projectSrc $Target /E /XD data logs node_modules /XF .env .env.local sovits-dir.txt ngrok-domain.txt ngrok-authtoken.txt ngrok.exe /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Say "套用失敗（robocopy 結束碼 $LASTEXITCODE）。可以從 $backup 復原。" Red; exit 1 }

# 3. 語音設定：舊版寫在程式裡、.env 沒寫的，搬進 .env，這台電腦的聲音才不會變
$envPath = Join-Path $Target '.env'
$envText = ''
if (Test-Path $envPath) {
  $envText = Get-Content -Raw -Encoding UTF8 $envPath
  if (-not $envText) { $envText = '' }
} else {
  Say '注意：這台電腦沒有 .env（Gemini API 金鑰），請照 .env.example 建立並填入 GEMINI_API_KEY。' Yellow
}
$existing = @{}
foreach ($m in [regex]::Matches($envText, '(?m)^\s*(SOVITS_[A-Z_]+)\s*=')) { $existing[$m.Groups[1].Value] = $true }

$lines = @()
foreach ($key in ($oldDefaults.Keys | Sort-Object)) {
  if ($existing.ContainsKey($key)) { continue }
  if ($newDefaults.ContainsKey($key) -and $newDefaults[$key] -eq $oldDefaults[$key]) { continue }
  $lines += "$key=$($oldDefaults[$key])"
}
if ($lines.Count -gt 0) {
  $block = ''
  if ($envText -and -not $envText.EndsWith("`n")) { $block += "`r`n" }
  $block += "`r`n# 更新前這台電腦的語音設定（套用更新時自動保留）`r`n" + ($lines -join "`r`n") + "`r`n"
  [IO.File]::AppendAllText($envPath, $block, (New-Object Text.UTF8Encoding $false))
  Say "已把這台電腦原本的語音設定寫進 .env（$($lines.Count) 項），聲音會跟更新前一樣。" Green
} else {
  Say '語音設定不用調整。'
}

# 4. 找這台電腦的 GPT-SoVITS 資料夾（有 api_v2.py 的那個），給 start-pet.bat 用
$sovitsTxt = Join-Path $Target 'sovits-dir.txt'
$desktop = [Environment]::GetFolderPath('Desktop')
$defaultSovits = Join-Path $desktop 'GPT-SoVITS-v2pro-20250604'
if ((Test-Path $sovitsTxt) -or (Test-Path (Join-Path $defaultSovits 'api_v2.py'))) {
  Say 'GPT-SoVITS 位置不用調整。'
} else {
  $roots = @($Target, (Join-Path $Target 'TTS'), $desktop, 'C:\', 'D:\', 'C:\TTS', 'D:\TTS') | Where-Object { Test-Path $_ }
  $found = @()
  foreach ($r in $roots) {
    if (Test-Path (Join-Path $r 'api_v2.py')) { $found += Get-Item $r }
    $found += Get-ChildItem $r -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'api_v2.py') }
  }
  $found = $found | Sort-Object FullName -Unique |
    Sort-Object @{ Expression = { $_.Name -match 'v2pro' }; Descending = $true }, @{ Expression = { $_.LastWriteTime }; Descending = $true }
  if ($found) {
    $pick = @($found)[0].FullName
    # cmd 用主控台字碼頁讀檔，中文路徑才不會變亂碼
    try {
      $enc = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
    } catch {
      $enc = [Text.Encoding]::Default
    }
    [IO.File]::WriteAllText($sovitsTxt, $pick, $enc)
    Say "找到 GPT-SoVITS：$pick（已寫進 sovits-dir.txt，start-pet.bat 會用它）" Green
    if (@($found).Count -gt 1) {
      Say '另外還找到這些，如果要用別的，直接改 sovits-dir.txt 的內容：' Yellow
      @($found) | Select-Object -Skip 1 | ForEach-Object { Say "  $($_.FullName)" }
    }
  } else {
    Say '找不到 GPT-SoVITS 資料夾。請在桌寵資料夾建立 sovits-dir.txt，裡面寫一行 GPT-SoVITS 資料夾的完整路徑（有 api_v2.py 的那個）。' Yellow
  }
}

# 5. npm install（套件版本可能有更新）
if (-not $SkipInstall) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Say "`n這台電腦沒有 Node.js，請到 https://nodejs.org 安裝後，在 $Target 執行 npm install。" Yellow
  } else {
    Say "`n更新套件（npm install，可能要幾分鐘）…"
    Push-Location $Target
    try {
      npm install
      if ($LASTEXITCODE -ne 0) { Say 'npm install 失敗，請檢查網路後在桌寵資料夾重跑一次 npm.cmd install。' Red }
    } finally {
      Pop-Location
    }
  }
}

Say "`n更新完成！" Green
Say '這台電腦的記憶、API 金鑰、語音設定都保留著。'
Say "舊版備份在：$backup（確認新版沒問題後可以刪掉）"
Say '啟動：雙擊桌寵資料夾裡的 start-pet.bat'
