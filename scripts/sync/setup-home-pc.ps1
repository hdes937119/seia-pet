<#
  同步初次設定（老家電腦，只要做一次）——這個檔案（setup-home-pc.ps1）放在 Google 雲端硬碟的「西雅同步」資料夾裡，雙擊旁邊的「老家初次設定.bat」。
    1. 先關桌寵，整個桌寵資料夾備份一份（不含 node_modules）
    2. 把桌寵資料夾接上 GitHub，換成最新的程式（.env、聲音模型路徑、ngrok 設定都會留著）
    3. npm install
    4. 從雲端拿最新的記憶（這台一週前的記憶會先備份起來）
  做完之後照常用 start-pet.bat 開桌寵、stop-pet.bat 關桌寵。
#>
$ErrorActionPreference = 'Continue'
$RepoUrl = 'https://github.com/hdes937119/seia-pet.git'
$Cloud = $PSScriptRoot
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Fail($m) { Say $m Red; Read-Host '按 Enter 關閉'; exit 1 }

Say "`n=== 西雅的同步：老家電腦初次設定 ===" Cyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '找不到 git，請先安裝 Git for Windows。' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail '找不到 Node.js（npm），請先安裝 Node.js。' }

$Pet = Join-Path ([Environment]::GetFolderPath('Desktop')) '桌寵'
if (-not (Test-Path (Join-Path $Pet 'package.json'))) {
  $Pet = Read-Host '找不到桌面上的「桌寵」資料夾。請貼上這台電腦桌寵資料夾的完整路徑'
  if (-not $Pet -or -not (Test-Path (Join-Path $Pet 'package.json'))) { Fail '那裡找不到桌寵（package.json）。' }
}
Say "桌寵資料夾：$Pet" Green

# 1. 關桌寵、備份
if (Test-Path (Join-Path $Pet 'stop-pet.bat')) { & cmd.exe /c "`"$(Join-Path $Pet 'stop-pet.bat')`"" | Out-Null }
$backup = Join-Path (Join-Path $env:LOCALAPPDATA '西雅同步備份') ("$(Get-Date -Format 'yyyyMMdd-HHmmss')-老家初次設定")
Say "備份整個桌寵資料夾到 $backup …" Cyan
& robocopy $Pet $backup /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP /XD node_modules | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "備份失敗（robocopy 結束碼 $LASTEXITCODE），先不繼續。" }

# 2. 接上 GitHub、換成最新程式（.gitignore 裡的 .env、data、sovits-dir.txt、ngrok 都不會被動到）
Push-Location $Pet
try {
  if (-not (Test-Path '.git')) { git init -q }
  if (git remote | Select-String -SimpleMatch 'origin') { git remote set-url origin $RepoUrl } else { git remote add origin $RepoUrl }
  Say '從 GitHub 拿最新程式（第一次會跳出瀏覽器請你登入 GitHub）…' Cyan
  git fetch origin
  if ($LASTEXITCODE -ne 0) { Fail '從 GitHub 拿程式失敗（網路或登入問題）。原本的資料夾沒有被改動。' }
  git checkout -f -B main origin/main
  if ($LASTEXITCODE -ne 0) { Fail "換成最新程式失敗。備份在 $backup。請把上面的訊息貼給 Claude。" }
  git branch -u origin/main main | Out-Null
  if (-not (git config user.email)) { git config user.email 'hdes937119@users.noreply.github.com' }
  if (-not (git config user.name)) { git config user.name 'seia-pet' }
  Say '程式已經是最新的了。' Green

  Say 'npm install（第一次要幾分鐘）…' Cyan
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Say '⚠️ npm install 失敗，等一下請在桌寵資料夾手動執行 npm install。' Yellow }
} finally { Pop-Location }

# 3. 記雲端資料夾、拿最新的記憶
[IO.File]::WriteAllText((Join-Path $Pet 'sync-dir.txt'), $Cloud, (New-Object Text.UTF8Encoding($false)))
Say '從雲端拿最新的記憶…' Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pet 'scripts\sync\seia-sync.ps1') -Mode Pull
# Pull 會放「使用中」的鎖；這裡還沒真的開桌寵，先拿掉
$lockPath = Join-Path $Cloud 'lock.json'
if (Test-Path $lockPath) {
  try { if ((Get-Content -Raw -Encoding UTF8 $lockPath | ConvertFrom-Json).machine -eq $env:COMPUTERNAME) { Remove-Item -Force $lockPath } } catch { }
}

Say "`n✅ 完成。之後照常用 start-pet.bat 開桌寵、stop-pet.bat 關桌寵就會自動同步。" Green
Say "原本的桌寵資料夾備份在：$backup" Green
Say '如果這台的工坊（WSL）還沒裝，之後可以跑 scripts\workshop\workshop-setup.bat。' Gray
Read-Host '按 Enter 關閉'
