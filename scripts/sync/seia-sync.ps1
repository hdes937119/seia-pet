<#
  西雅的同步：兩台電腦用「交接」的方式共用同一個西雅。

  程式碼：GitHub 私人 repo（開桌寵前 git pull；關桌寵後自動提交、push）
  記憶：Google 雲端硬碟的「西雅同步」資料夾
        - 關桌寵（stop-pet.bat）後：把 data\（不含 _claude_tmp）和瀏覽器端的 Local Storage 上傳，記下哪台、幾點交接
        - 開桌寵（start-pet.bat）前：雲端上是另一台留下、而且比這台上次同步還新的 → 先備份這台，再拿回來
        - 開著的時候每 30 分鐘把 data\ 快照上傳一次（停電、直接關機時不會停在好幾個小時前）
        - 開著的時候在雲端放「使用中」的鎖；另一台開機看到會先問你
  不在雲端硬碟裡直接執行桌寵：程式一直在寫的檔案邊寫邊同步，容易壞掉或產生衝突副本。

  用法：powershell -ExecutionPolicy Bypass -File seia-sync.ps1 -Mode Pull|Push|Watch|Status
  結束碼：0 正常；2 主人選擇這次不要開桌寵
  記錄：logs\sync.log
#>
param([ValidateSet('Pull', 'Push', 'Watch', 'Status')][string]$Mode = 'Status')

$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Me = $env:COMPUTERNAME
$StateFile = Join-Path $Root 'sync-state.json'
$DirFile = Join-Path $Root 'sync-dir.txt'
$AppName = (Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'package.json') | ConvertFrom-Json).name
$LocalStorage = Join-Path $env:APPDATA "$AppName\Local Storage"
$BackupRoot = Join-Path $env:LOCALAPPDATA '西雅同步備份'
$LogDir = Join-Path $Root 'logs'
$Desk = Join-Path $Root '西雅的工作桌'
$LogFile = Join-Path $LogDir 'sync.log'

function Log($msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [$Mode] $msg"
  Write-Host $line
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
}
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Fmt([int64]$ms) {
  if ($ms -le 0) { return '（不明）' }
  [DateTimeOffset]::FromUnixTimeMilliseconds($ms).ToLocalTime().ToString('M/d HH:mm')
}
function Read-Json($path) {
  if (-not (Test-Path $path)) { return $null }
  try { return (Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json) } catch { return $null }
}
function Write-Json($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
}
function Ask($text) {
  Add-Type -AssemblyName PresentationFramework
  return ([System.Windows.MessageBox]::Show($text, '西雅的同步', 'YesNo', 'Question') -eq 'Yes')
}
function Tell($text) {
  Add-Type -AssemblyName PresentationFramework
  [void][System.Windows.MessageBox]::Show($text, '西雅的同步', 'OK', 'Information')
}

# ---------- 雲端資料夾 ----------
function Find-CloudDir {
  if (Test-Path $DirFile) {
    $p = (Get-Content -Raw -Encoding UTF8 $DirFile).Trim()
    if ($p) { return $p }
  }
  $cands = @()
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    try { if (-not $d.IsReady) { continue } } catch { continue }
    foreach ($n in @('我的雲端硬碟', 'My Drive')) { $cands += (Join-Path $d.RootDirectory.FullName $n) }
  }
  foreach ($n in @('我的雲端硬碟', 'My Drive', 'Google Drive')) { $cands += (Join-Path $env:USERPROFILE $n) }
  foreach ($c in $cands) {
    if (Test-Path $c) {
      $dir = Join-Path $c '西雅同步'
      [IO.File]::WriteAllText($DirFile, $dir, (New-Object Text.UTF8Encoding($false)))
      Log "找到 Google 雲端硬碟：$dir（記在 sync-dir.txt）"
      return $dir
    }
  }
  return $null
}

# ---------- 複製 ----------
function Mirror($from, $to, [string[]]$xd = @()) {
  if (-not (Test-Path $from)) { return $false }
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $rc = @($from, $to, '/MIR', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($xd.Count) { $rc += '/XD'; $rc += $xd }
  & robocopy @rc | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "複製失敗：$from → $to（robocopy 結束碼 $LASTEXITCODE）" }
  return $true
}
function Copy-Tree($from, $to, [string[]]$xd = @()) {
  if (-not (Test-Path $from)) { return }
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $rc = @($from, $to, '/E', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($xd.Count) { $rc += '/XD'; $rc += $xd }
  & robocopy @rc | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "備份失敗：$from（robocopy 結束碼 $LASTEXITCODE）" }
}

# 這台電腦的記憶最後一次被寫入的時間（data\ 和 Local Storage 裡最新的檔案）
function Newest-Local {
  $t = [int64]0
  foreach ($base in @((Join-Path $Root 'data'), $LocalStorage)) {
    if (-not (Test-Path $base)) { continue }
    $f = Get-ChildItem -Path $base -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\_claude_tmp\\' } |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($f) {
      $ms = [DateTimeOffset]::new($f.LastWriteTimeUtc).ToUnixTimeMilliseconds()
      if ($ms -gt $t) { $t = $ms }
    }
  }
  return $t
}

# 備份：這台的記憶（拿雲端的之前）或雲端的記憶（選擇留這台的時候）；只留最近 10 份
function Backup-Set($label, $dataDir, $lsDir, $deskDir = '') {
  $dest = Join-Path $BackupRoot ("$(Get-Date -Format 'yyyyMMdd-HHmmss')-$label")
  Copy-Tree $dataDir (Join-Path $dest 'data') @('_claude_tmp')
  Copy-Tree $lsDir (Join-Path $dest 'localstorage')
  if ($deskDir) { Copy-Tree $deskDir (Join-Path $dest 'desk') }
  Log "備份到 $dest"
  try {
    Get-ChildItem -Path $BackupRoot -Directory | Sort-Object Name -Descending | Select-Object -Skip 10 |
      ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
  } catch { }
}

# ---------- git ----------
function Git-Ok { return ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $Root '.git'))) }
function Git-Pull {
  if (-not (Git-Ok)) { Log '沒有 git 或還沒接上 GitHub，跳過程式碼更新'; return }
  Push-Location $Root
  try {
    $before = (git rev-parse HEAD 2>$null)
    $out = (git pull --ff-only 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Log "⚠️ 拿最新程式失敗（先用這台現有的程式）：$($out.Trim())"; return }
    $after = (git rev-parse HEAD 2>$null)
    if ($before -ne $after) {
      Log "程式更新了：$($before.Substring(0,7)) → $($after.Substring(0,7))"
      $changed = @(git diff --name-only $before $after 2>$null)
      if ($changed -contains 'package.json' -or $changed -contains 'package-lock.json') {
        Log '套件有變，執行 npm install…'
        & npm.cmd install --no-audit --no-fund 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Log '⚠️ npm install 失敗，請手動執行一次' } else { Log 'npm install 完成' }
      }
    } else { Log '程式已經是最新的' }
  } finally { Pop-Location }
}
function Git-Push {
  if (-not (Git-Ok)) { return }
  Push-Location $Root
  try {
    if (-not (git config user.email 2>$null)) { git config user.email 'hdes937119@users.noreply.github.com' }
    if (-not (git config user.name 2>$null)) { git config user.name 'seia-pet' }
    git add -A 2>&1 | Out-Null
    git diff --cached --quiet 2>$null
    if ($LASTEXITCODE -ne 0) {
      git commit -q -m "自動同步 $(Get-Date -Format 'yyyy-MM-dd HH:mm') $Me" 2>&1 | Out-Null
      Log '程式改動已提交'
    }
    $out = (git pull --rebase --quiet 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
      git rebase --abort 2>&1 | Out-Null
      Log "⚠️ 跟 GitHub 上的程式合併失敗，這次先不推送：$($out.Trim())"
      return
    }
    $out = (git push --quiet 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Log "⚠️ 推送到 GitHub 失敗（可能沒網路）：$($out.Trim())" } else { Log '程式碼已推送到 GitHub' }
  } finally { Pop-Location }
}

# ---------- 交接 ----------
# 11/9：記下「拿過哪一台的哪一份記憶」，上傳時一起寫進 handoff.json；另一台拿記憶時就知道兩邊有沒有分岔
function Seen-Map($obj) {
  $m = @{}
  if ($obj -and $obj.seen) { foreach ($p in $obj.seen.PSObject.Properties) { $m[$p.Name] = [int64]$p.Value } }
  return $m
}
function Save-State([int64]$lastSyncAt, $seen, [int64]$lastPushAt) {
  Write-Json $StateFile @{ lastSyncAt = $lastSyncAt; machine = $Me; seen = $seen; lastPushAt = $lastPushAt }
}
function Write-Lock($cloud) {
  Write-Json (Join-Path $cloud 'lock.json') @{ machine = $Me; since = (NowMs) }
}

function Do-Pull {
  Git-Pull
  $cloud = Find-CloudDir
  if (-not $cloud) {
    Log '⚠️ 找不到 Google 雲端硬碟，這次不同步記憶（請確認 Google 雲端硬碟電腦版有開，或把「西雅同步」資料夾的完整路徑寫進 sync-dir.txt）'
    return 0
  }
  if (-not (Test-Path $cloud)) {
    New-Item -ItemType Directory -Force -Path $cloud | Out-Null
    Log '雲端還沒有記憶（第一次），關桌寵時會上傳'
    Write-Lock $cloud
    return 0
  }
  $lock = Read-Json (Join-Path $cloud 'lock.json')
  if ($lock -and $lock.machine -and $lock.machine -ne $Me) {
    $ok = Ask ("「$($lock.machine)」從 $(Fmt ([int64]$lock.since)) 開始使用西雅，好像還沒有正常關閉（或那台現在還開著）。`n`n" +
      "要繼續在這台開桌寵嗎？會用雲端上最後一次的快照，那台之後就不會再上傳、不會蓋掉這台的記憶。")
    if (-not $ok) { Log '主人選擇先不開（另一台使用中）'; return 2 }
    Log "另一台（$($lock.machine)）的鎖還在，主人選擇繼續"
  }
  $h = Read-Json (Join-Path $cloud 'handoff.json')
  $st = Read-Json $StateFile
  $last = if ($st -and $st.lastSyncAt) { [int64]$st.lastSyncAt } else { [int64]0 }
  if ($h -and $h.machine -and $h.machine -ne $Me -and [int64]$h.at -gt $last) {
    $cloudAt = [int64]$h.at
    $localNewest = Newest-Local
    $useCloud = $true
    # 11/9：這台上傳過的記憶，另一台沒拿過就接著用、又上傳了 → 兩邊分岔，問主人（不默默蓋掉這台）
    $myPush = if ($st -and $st.lastPushAt) { [int64]$st.lastPushAt } elseif ($st) { $last } else { [int64]0 }
    $theySaw = (Seen-Map $h)[$Me]
    if (-not $theySaw) { $theySaw = [int64]0 }
    if ($myPush -gt 0 -and $theySaw -lt $myPush) {
      $useCloud = Ask ("兩台的記憶分岔了：雲端上是「$($h.machine)」在 $(Fmt $cloudAt) 留下的，但它沒有拿到這台 $(Fmt $myPush) 上傳的記憶就接著用了。兩邊沒辦法合併。`n`n" +
        "是＝用雲端的（這台的會先備份）`n否＝用這台的（雲端的會先備份，下次關桌寵時上傳這台的）")
    } elseif ($st -and $localNewest -gt ($last + 120000)) {
      $useCloud = Ask ("雲端上有「$($h.machine)」在 $(Fmt $cloudAt) 留下的記憶，這台電腦在上次同步（$(Fmt $last)）之後也有新的記憶（$(Fmt $localNewest)）。兩邊沒辦法合併。`n`n" +
        "是＝用雲端的（這台的會先備份）`n否＝用這台的（雲端的會先備份，下次關桌寵時上傳這台的）")
    } elseif (-not $st -and $localNewest -gt $cloudAt) {
      $useCloud = Ask ("這台電腦第一次同步。這台的記憶（$(Fmt $localNewest)）比雲端上「$($h.machine)」的（$(Fmt $cloudAt)）還新。`n`n" +
        "是＝用雲端的（這台的會先備份）`n否＝用這台的（雲端的會先備份，下次關桌寵時上傳這台的）")
    }
    try {
      if ($useCloud) {
        Backup-Set 'before-pull' (Join-Path $Root 'data') $LocalStorage $Desk
        [void](Mirror (Join-Path $cloud 'data') (Join-Path $Root 'data') @('_claude_tmp'))
        if (Test-Path (Join-Path $cloud 'localstorage')) { [void](Mirror (Join-Path $cloud 'localstorage') $LocalStorage) }
        if (Test-Path (Join-Path $cloud 'desk')) { [void](Mirror (Join-Path $cloud 'desk') $Desk) }
        Log "已從雲端拿回「$($h.machine)」$(Fmt $cloudAt) 的記憶（$($h.kind)）"
      } else {
        Backup-Set 'cloud-kept-local' (Join-Path $cloud 'data') (Join-Path $cloud 'localstorage') (Join-Path $cloud 'desk')
        Log '保留這台的記憶，雲端的已備份'
      }
      $seen = Seen-Map $st
      $seen[$h.machine] = $cloudAt
      $lp = if ($st -and $st.lastPushAt) { [int64]$st.lastPushAt } else { [int64]0 }
      Save-State $cloudAt $seen $lp
    } catch {
      Log "⚠️ $($_.Exception.Message)"
      Tell "同步記憶時出了問題：$($_.Exception.Message)`n`n這次先用這台現有的記憶開桌寵；備份在 $BackupRoot。"
    }
  } elseif ($h) {
    Log "雲端的記憶（$($h.machine) $(Fmt ([int64]$h.at))）沒有比這台新，不用拿"
  }
  Write-Lock $cloud
  return 0
}

function Do-Push([bool]$snapshot) {
  $cloud = Find-CloudDir
  if (-not $cloud) { Log '⚠️ 找不到 Google 雲端硬碟，這次不上傳記憶'; if (-not $snapshot) { Git-Push }; return }
  New-Item -ItemType Directory -Force -Path $cloud | Out-Null
  $lock = Read-Json (Join-Path $cloud 'lock.json')
  if ($lock -and $lock.machine -and $lock.machine -ne $Me) {
    Log "「$($lock.machine)」正在使用西雅，這台先不上傳記憶（避免蓋掉那台的）"
    if (-not $snapshot) { Git-Push }
    return
  }
  # 11/9：雲端上有另一台留下、這台還沒拿過的記憶 → 不上傳（之前老家電腦把一週前的記憶蓋掉了新電腦的）
  $h = Read-Json (Join-Path $cloud 'handoff.json')
  $st = Read-Json $StateFile
  $last = if ($st -and $st.lastSyncAt) { [int64]$st.lastSyncAt } else { [int64]0 }
  if ($h -and $h.machine -and $h.machine -ne $Me -and [int64]$h.at -gt $last) {
    Log "⚠️ 雲端上有「$($h.machine)」$(Fmt ([int64]$h.at)) 留下、這台還沒拿過的記憶，這台先不上傳（避免蓋掉）"
    if (-not $snapshot) {
      Tell ("雲端上有「$($h.machine)」在 $(Fmt ([int64]$h.at)) 留下的記憶，這台電腦還沒拿過，所以這次不上傳這台的記憶（避免把比較新的蓋掉）。`n`n" +
        "下次用 start-pet.bat 開桌寵時會先問你要用哪一邊。程式碼照常推送到 GitHub。")
      Git-Push
    }
    return
  }
  try {
    [void](Mirror (Join-Path $Root 'data') (Join-Path $cloud 'data') @('_claude_tmp'))
    if (-not $snapshot -and (Test-Path $LocalStorage)) { [void](Mirror $LocalStorage (Join-Path $cloud 'localstorage')) }
    if (-not $snapshot -and (Test-Path $Desk)) { [void](Mirror $Desk (Join-Path $cloud 'desk')) }
    $now = NowMs
    $seen = Seen-Map $st
    Write-Json (Join-Path $cloud 'handoff.json') @{ machine = $Me; at = $now; kind = $(if ($snapshot) { 'snapshot' } else { 'stop' }); seen = $seen }
    Save-State $now $seen $now
    Log $(if ($snapshot) { '記憶快照已上傳' } else { '記憶已交接到雲端' })
  } catch {
    Log "⚠️ 上傳記憶失敗：$($_.Exception.Message)"
  }
  if (-not $snapshot) {
    $lockPath = Join-Path $cloud 'lock.json'
    $lock = Read-Json $lockPath
    if ($lock -and $lock.machine -eq $Me) { Remove-Item -Force $lockPath -ErrorAction SilentlyContinue }
    Git-Push
  }
}

function Backend-Up {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 'http://127.0.0.1:3000/api/relationship' | Out-Null; return $true } catch { return $false }
}

switch ($Mode) {
  'Pull' { $code = Do-Pull; exit $code }
  'Push' { Do-Push $false; exit 0 }
  'Watch' {
    Log '開始：每 30 分鐘上傳一次記憶快照'
    while ($true) {
      Start-Sleep -Seconds 1800
      if (-not (Backend-Up)) { Log '桌寵已經關了，停止快照'; break }
      Do-Push $true
    }
    exit 0
  }
  'Status' {
    $cloud = Find-CloudDir
    "這台：$Me"
    "雲端資料夾：$cloud"
    if ($cloud) {
      $h = Read-Json (Join-Path $cloud 'handoff.json'); $l = Read-Json (Join-Path $cloud 'lock.json')
      if ($h) { "最後交接：$($h.machine) $(Fmt ([int64]$h.at))（$($h.kind)）" }
      if ($l) { "使用中：$($l.machine)（從 $(Fmt ([int64]$l.since))）" }
    }
    $st = Read-Json $StateFile
    if ($st) { "這台上次同步：$(Fmt ([int64]$st.lastSyncAt))" }
    "這台記憶最新：$(Fmt (Newest-Local))"
    exit 0
  }
}
