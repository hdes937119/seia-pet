<#
  桌寵搬家還原：在新電腦上把搬家包還原。

  1. 把 project\ 複製到目標資料夾（預設：桌面\桌寵）
  2. 把瀏覽器端記憶放回 %APPDATA%\<套件名稱>\Local Storage（原本有的會先備份）
  3. 語音：GPT-SoVITS 資料夾放到桌面（或 -VoiceTarget），模型 / 參考音檔放到 桌寵\voice-files，
     並把 .env 裡的路徑改成新電腦的位置、寫好 sovits-dir.txt
  4. 執行 npm install

  用法：在新電腦雙擊搬家包裡的「還原桌寵.cmd」
        或 powershell -ExecutionPolicy Bypass -File project\scripts\restore-migration.ps1 -PackageDir 搬家包資料夾
             [-Target 安裝位置] [-VoiceTarget GPT-SoVITS要放的資料夾] [-Force] [-SkipInstall]
#>
param(
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$Target = (Join-Path ([Environment]::GetFolderPath('Desktop')) '桌寵'),
  [string]$VoiceTarget = [Environment]::GetFolderPath('Desktop'),
  [switch]$Force, # 目標資料夾已經有東西時，仍然覆蓋（會先備份 data 和 .env）
  [switch]$SkipInstall, # 不執行 npm install
  [string]$StorageDir = '' # 瀏覽器端記憶要放的位置（預設 %APPDATA%\<套件名稱>\Local Storage；測試用）
)

$ErrorActionPreference = 'Stop'
function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Copy-Tree($from, $to) {
  & robocopy $from $to /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "複製失敗：$from → $to（robocopy 結束碼 $LASTEXITCODE）" }
}

$PackageDir = (Resolve-Path $PackageDir).Path
$projectSrc = Join-Path $PackageDir 'project'
$storageSrc = Join-Path $PackageDir 'electron-local-storage'
$infoFile = Join-Path $PackageDir 'pack-info.json'
$info = if (Test-Path $infoFile) { Get-Content -Raw -Encoding UTF8 $infoFile | ConvertFrom-Json } else { $null }

Say "`n=== 桌寵搬家還原 ===" Cyan
if (-not (Test-Path (Join-Path $projectSrc 'package.json'))) {
  Say "在 $PackageDir 裡找不到 project\package.json，請確認是完整的搬家包資料夾（zip 的話要先解壓縮）。" Red
  exit 1
}
$AppName = (Get-Content -Raw -Encoding UTF8 (Join-Path $projectSrc 'package.json') | ConvertFrom-Json).name
$storageDst = if ($StorageDir) { [IO.Path]::GetFullPath($StorageDir) } else { Join-Path $env:APPDATA "$AppName\Local Storage" }

# 桌寵開著的話，瀏覽器端記憶會被鎖住或被覆蓋回去
if (Get-Process -Name electron -ErrorAction SilentlyContinue) {
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
Say "[1/4] 還原專案到：$Target"
Copy-Tree $projectSrc $Target

# 2. 瀏覽器端記憶
Say '[2/4] 還原瀏覽器端記憶…'
if (Test-Path $storageSrc) {
  if (Test-Path $storageDst) {
    $old = "$storageDst-還原前備份-$stamp"
    Move-Item $storageDst $old
    Say "  這台電腦原本的瀏覽器端記憶已備份到：$old"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $storageDst) | Out-Null
  Copy-Tree $storageSrc $storageDst
  Say "  已還原到：$storageDst"
} else {
  Say '  搬家包裡沒有瀏覽器端記憶，略過（事件日記、心情好感度還在，但喜好關鍵字和聊天紀錄會是空的）。' Yellow
}

# 3. 語音
Say '[3/4] 還原語音…'
$sovitsDir = $null
$sovitsSrc = Join-Path $PackageDir 'voice\GPT-SoVITS'
if (Test-Path (Join-Path $sovitsSrc 'api_v2.py')) {
  $name = if ($info -and $info.sovitsName) { $info.sovitsName } else { 'GPT-SoVITS' }
  $sovitsDir = Join-Path ([IO.Path]::GetFullPath($VoiceTarget)) $name
  if (Test-Path (Join-Path $sovitsDir 'api_v2.py')) {
    Say "  $sovitsDir 已經有 GPT-SoVITS 了，補上缺的檔案…"
  } else {
    Say "  複製 GPT-SoVITS 到 $sovitsDir（檔案很大，要幾分鐘）…"
  }
  Copy-Tree $sovitsSrc $sovitsDir
} else {
  # 搬家包沒帶語音包：找這台電腦現有的
  $desktop = [Environment]::GetFolderPath('Desktop')
  $roots = @($VoiceTarget, $desktop, $Target, 'C:\', 'D:\', 'C:\TTS', 'D:\TTS') | Where-Object { $_ -and (Test-Path $_) }
  $found = @()
  foreach ($r in $roots) {
    if (Test-Path (Join-Path $r 'api_v2.py')) { $found += Get-Item $r }
    $found += Get-ChildItem $r -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'api_v2.py') }
  }
  $found = @($found | Sort-Object FullName -Unique |
    Sort-Object @{ Expression = { $info -and $_.Name -eq $info.sovitsName }; Descending = $true },
      @{ Expression = { $_.Name -match 'v2pro' }; Descending = $true }, @{ Expression = { $_.LastWriteTime }; Descending = $true })
  if ($found.Count) {
    $sovitsDir = $found[0].FullName
    Say "  搬家包沒有語音包，使用這台電腦的 GPT-SoVITS：$sovitsDir"
  } else {
    Say '  搬家包沒有語音包，這台電腦也找不到 GPT-SoVITS（她會沒有聲音）。之後裝好的話，在桌寵資料夾建立 sovits-dir.txt，寫一行 GPT-SoVITS 資料夾路徑。' Yellow
  }
}

if ($sovitsDir) {
  # start-pet.bat 用主控台字碼頁讀這個檔，中文路徑才不會變亂碼
  try { $oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage) } catch { $oem = [Text.Encoding]::Default }
  [IO.File]::WriteAllText((Join-Path $Target 'sovits-dir.txt'), $sovitsDir, $oem)
}

# 模型權重、參考音檔：放到新位置，再把 .env 的路徑改過來
$newPaths = [ordered]@{}
if ($info -and $info.voiceFiles) {
  foreach ($prop in $info.voiceFiles.PSObject.Properties) {
    $key = $prop.Name; $e = $prop.Value; $new = $null
    if ($e.inSovits -and $sovitsDir) {
      $cand = Join-Path $sovitsDir $e.inSovits
      if (Test-Path -LiteralPath $cand) { $new = $cand }
    } elseif ($e.packed) {
      $src = Join-Path $PackageDir $e.packed
      if (Test-Path -LiteralPath $src) {
        $dstDir = Join-Path $Target "voice-files\$key"
        New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
        Copy-Item -LiteralPath $src $dstDir -Force
        $new = Join-Path $dstDir (Split-Path $src -Leaf)
      }
    }
    if ($new) { $newPaths[$key] = $new.Replace('\', '/') }
    else { Say "  找不到 $key 的檔案（舊電腦：$($e.old)），這項設定沒有改。" Yellow }
  }
}

$envPath = Join-Path $Target '.env'
if ($newPaths.Count) {
  $envText = if (Test-Path $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
  $added = @()
  foreach ($key in $newPaths.Keys) {
    $line = "$key=`"$($newPaths[$key])`""
    $re = "(?m)^[ \t]*$key[ \t]*=.*$"
    if ([regex]::IsMatch($envText, $re)) {
      $envText = [regex]::Replace($envText, $re, { param($m) $line }.GetNewClosure())
    } else {
      $added += $line
    }
  }
  if ($added.Count) {
    if ($envText -and -not $envText.EndsWith("`n")) { $envText += "`r`n" }
    $envText += "`r`n# 搬家時自動設定的語音檔案位置`r`n" + ($added -join "`r`n") + "`r`n"
  }
  [IO.File]::WriteAllText($envPath, $envText, (New-Object Text.UTF8Encoding $false))
  Say "  已把 .env 裡的語音檔案路徑改成這台電腦的位置（$($newPaths.Count) 項）。" Green
}

# 4. npm install
if (-not $SkipInstall) {
  Say '[4/4] 安裝套件（npm install，第一次要幾分鐘）…'
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Say "  這台電腦還沒有安裝 Node.js。請到 https://nodejs.org 安裝後，在 $Target 開命令提示字元執行 npm install。" Yellow
  } else {
    Push-Location $Target
    try {
      & npm.cmd install
      if ($LASTEXITCODE -ne 0) { Say '  npm install 失敗，請檢查網路後在桌寵資料夾重跑一次 npm install。' Red }
    } finally { Pop-Location }
  }
}

Say "`n還原完成！" Green
if (-not (Test-Path $envPath)) { Say '注意：沒有 .env，請照 .env.example 建立並填入 GEMINI_API_KEY。' Yellow }
Say "啟動：雙擊 $Target\start-pet.bat"
Say '提醒：'
Say '  - LINE 同一時間只能有一台電腦連線，舊電腦就不要再開桌寵了。'
Say '  - 瀏覽器的 Gemini 網頁連動：裝 Tampermonkey 後打開 http://127.0.0.1:3000/gemini-web-sync.user.js 重新安裝。'
Say '  - 確認新電腦沒問題後，可以刪掉搬家包（裡面有 API 金鑰）。'
