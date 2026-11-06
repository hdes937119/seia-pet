<#
  桌寵更新包：只打包「程式碼」，給另一台已經裝好桌寵的電腦更新用。

  跟搬家包（pack-migration.ps1）不同：
    不包含 .env（API 金鑰、語音設定）、data\（立繪、事件日記、心情好感度）、瀏覽器端記憶
    → 套用到另一台電腦時，那台電腦自己的記憶和設定都會保留。

  包含：
    project\        專案程式碼（含 .git 歷史）
    套用更新.cmd    在另一台電腦上雙擊套用
    更新說明.txt

  用法：npm run pack:update
        或 powershell -ExecutionPolicy Bypass -File scripts\pack-update.ps1 [-OutDir 輸出資料夾]
#>
param(
  [string]$OutDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

Say "`n=== 桌寵更新包 ===" Cyan
Say "專案位置：$ProjectRoot"

# 1. 複製程式碼到暫存資料夾（排除記憶、金鑰、語音包、可以重新產生的東西）
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$staging = Join-Path ([IO.Path]::GetTempPath()) "pet-update-$stamp"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Say "`n複製程式碼…"
$projectOut = Join-Path $staging 'project'
# robocopy：/E 含子資料夾，/XD 排除資料夾，/XF 排除檔案；結束碼 0~7 代表成功
robocopy $ProjectRoot $projectOut /E `
  /XD node_modules data logs TTS dist build coverage .cache "GPT-SoVITS*" `
  /XF .env .env.local sovits-dir.txt ngrok-domain.txt ngrok-authtoken.txt ngrok.exe *.log *.tmp `
  /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Say "複製程式碼失敗（robocopy 結束碼 $LASTEXITCODE）" Red; exit 1 }

# 保險：確認沒有把金鑰或記憶包進去
foreach ($p in @('.env', 'data')) {
  if (Test-Path (Join-Path $projectOut $p)) { Remove-Item (Join-Path $projectOut $p) -Recurse -Force }
}

# 雙擊套用用的啟動檔（內容只用英文，避免 cmd 編碼問題）
$cmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0project\scripts\apply-update.ps1`" -PackageDir `"%~dp0.`" %*`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $staging '套用更新.cmd'), $cmd, [Text.Encoding]::ASCII)

$readme = @"
桌寵更新包（$stamp 打包）

只有程式碼。那台電腦自己的記憶（事件日記、心情好感度、喜好關鍵字、聊天紀錄、摸魚手帳）、
API 金鑰和語音設定都會保留，不會被這台電腦的蓋掉。

【在要更新的電腦上】
1. 關掉桌寵（桌寵視窗、Desktop Pet 視窗都關掉）。
2. 把這個 zip 解壓縮到任何地方（例如桌面）。
3. 雙擊「套用更新.cmd」。
   預設更新「桌面\桌寵」。桌寵裝在別的地方的話：在這個資料夾開 PowerShell，執行
   powershell -ExecutionPolicy Bypass -File project\scripts\apply-update.ps1 -PackageDir . -Target "D:\桌寵"
   更新前會自動把舊的程式碼備份到「桌寵-更新前備份-日期」。
4. 照畫面上的提示完成（例如語音資料夾的位置），再雙擊桌寵資料夾裡的 start-pet.bat 啟動。
"@
[IO.File]::WriteAllText((Join-Path $staging '更新說明.txt'), $readme, (New-Object Text.UTF8Encoding $true))

# 2. 壓縮（用 UTF-8 檔名，中文檔名在另一台電腦解壓才不會變亂碼）
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zipPath = Join-Path $OutDir "桌寵更新包-$stamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Say '壓縮中…'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
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
Say '內容：只有程式碼（不含 API 金鑰、記憶、語音包），用隨身碟或雲端搬到另一台電腦，雙擊「套用更新.cmd」即可。'
