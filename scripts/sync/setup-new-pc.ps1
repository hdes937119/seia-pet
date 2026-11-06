<#
  同步初次設定（新電腦，只要做一次）：
    1. 找到 Google 雲端硬碟，建立「西雅同步」資料夾
    2. 把這一週還沒提交的改動提交，接上 GitHub 私人 repo 並推上去
    3. 把「老家初次設定」放進雲端資料夾（回老家時雙擊它）
    4. 關掉桌寵，第一次把記憶交接到雲端
  做完之後照常用 start-pet.bat 開桌寵。
#>
$ErrorActionPreference = 'Continue'
$RepoUrl = 'https://github.com/hdes937119/seia-pet.git'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Fail($m) { Say $m Red; Read-Host '按 Enter 關閉'; exit 1 }

Say "`n=== 西雅的同步：新電腦初次設定 ===" Cyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '找不到 git，請先安裝 Git for Windows。' }

# 1. Google 雲端硬碟
$dirFile = Join-Path $Root 'sync-dir.txt'
$cloud = $null
if (Test-Path $dirFile) { $cloud = (Get-Content -Raw -Encoding UTF8 $dirFile).Trim() }
if (-not $cloud) {
  $cands = @()
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    try { if (-not $d.IsReady) { continue } } catch { continue }
    foreach ($n in @('我的雲端硬碟', 'My Drive')) { $cands += (Join-Path $d.RootDirectory.FullName $n) }
  }
  foreach ($n in @('我的雲端硬碟', 'My Drive', 'Google Drive')) { $cands += (Join-Path $env:USERPROFILE $n) }
  foreach ($c in $cands) { if (Test-Path $c) { $cloud = Join-Path $c '西雅同步'; break } }
}
if (-not $cloud) {
  Say '找不到 Google 雲端硬碟（「我的雲端硬碟」資料夾）。' Yellow
  $base = Read-Host '請貼上「我的雲端硬碟」的完整路徑（例如 G:\我的雲端硬碟）'
  if (-not $base -or -not (Test-Path $base)) { Fail '路徑不存在。請先安裝並登入 Google 雲端硬碟電腦版。' }
  $cloud = Join-Path $base '西雅同步'
}
New-Item -ItemType Directory -Force -Path $cloud | Out-Null
[IO.File]::WriteAllText($dirFile, $cloud, (New-Object Text.UTF8Encoding($false)))
Say "雲端資料夾：$cloud" Green

# 2. GitHub
Push-Location $Root
try {
  if (-not (git config user.email)) { git config user.email 'hdes937119@users.noreply.github.com' }
  if (-not (git config user.name)) { git config user.name 'seia-pet' }
  # 不上傳的東西先從 git 裡拿掉（檔案本身留著）
  git rm -r -q --cached --ignore-unmatch '.aistudio' 'server - 備份.ts' 2>&1 | Out-Null
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -q -m "同步前整理：11/3～11/6 的改動（核心記憶、工坊實驗室、事件結案檢查、同步腳本…）"
    Say '這一週的改動已提交。' Green
  }
  git branch -M main
  if (git remote | Select-String -SimpleMatch 'origin') { git remote set-url origin $RepoUrl } else { git remote add origin $RepoUrl }
  Say '推送到 GitHub（第一次會跳出瀏覽器請你登入 GitHub）…' Cyan
  git push -u origin main
  if ($LASTEXITCODE -ne 0) {
    Say '直接推送失敗，可能是 GitHub 上建立 repo 時多了 README，先合併再推一次…' Yellow
    git fetch origin
    git merge origin/main --allow-unrelated-histories -X ours -m '合併 GitHub 上建立 repo 時的初始檔案'
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { Fail '推送到 GitHub 失敗。請把上面的訊息貼給 Claude。' }
  }
  Say '程式碼已經在 GitHub 上了。' Green
} finally { Pop-Location }

# 3. 老家初次設定放進雲端
foreach ($f in @('setup-home-pc.ps1', '老家初次設定.bat')) {
  Copy-Item -Force (Join-Path $PSScriptRoot $f) (Join-Path $cloud $f)
}
Say "已把「老家初次設定」放進 $cloud（回老家時雙擊 老家初次設定.bat）" Green

# 4. 關桌寵＋第一次交接記憶
Say '關閉桌寵並第一次把記憶交接到雲端…' Cyan
& cmd.exe /c "`"$(Join-Path $Root 'stop-pet.bat')`""
Say "`n✅ 完成。之後照常用 start-pet.bat 開桌寵、stop-pet.bat 關桌寵就會自動同步。" Green
Say '記得把 Google 雲端硬碟裡的「西雅同步」資料夾設成「可離線使用」（右鍵 → 離線存取），開機同步會比較快。' Green
Read-Host '按 Enter 關閉'
