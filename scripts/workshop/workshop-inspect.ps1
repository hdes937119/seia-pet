<#
  西雅的工坊：只看不改的檢查。
  看 dsh 沙盒的預設（能不能連網、看得到哪些路徑）、drvfs 手動掛載行不行、沙盒裡讀不讀得到 /mnt/seia。
  不會改工坊設定、不會呼叫 Gemini（不花錢）；只會在 Windows 暫存資料夾建一個測試資料夾，做完刪掉。
  結果存到 桌寵\data\workshop\inspect-<時間>.txt，把那個檔案給 Claude 看。
#>
$ErrorActionPreference = 'Continue'
$Distro = 'seia-workshop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:WSL_UTF8 = '1'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

$here = (Resolve-Path $PSScriptRoot).Path
$proj = (Resolve-Path (Join-Path $here '..\..')).Path
$outDir = Join-Path $proj 'data\workshop'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("inspect-" + (Get-Date -Format 'yyyyMMdd-HHmm') + '.txt')

Say "`n=== 西雅的工坊：檢查（只看不改）===" Cyan

# 測試用的 Windows 資料夾（放一個小檔案，做完刪掉）
$testDir = Join-Path $env:TEMP 'seia-inspect'
New-Item -ItemType Directory -Force -Path $testDir | Out-Null
Set-Content -Path (Join-Path $testDir 'hello.txt') -Value 'seia inspect test' -Encoding ASCII
$pathB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($testDir))

# 檢查腳本用 base64 送進工坊（工坊看不到 C 槽）
$sh = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $here 'inspect-workshop.sh')))
$put = "f=/tmp/seia-inspect-`$(id -u).sh; echo $sh | base64 -d | tr -d '\r' > `$f"

$log = New-Object System.Collections.Generic.List[string]
$log.Add("西雅工坊檢查 $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
function Step($label, $user, $args2) {
  Say "[檢查] $label…"
  $wslArgs = @('-d', $Distro)
  if ($user -eq 'root') { $wslArgs += @('-u', 'root') }
  $wslArgs += @('-e', 'bash', '-c', "$put && bash `$f $args2")
  $out = & wsl.exe @wslArgs 2>&1 | ForEach-Object { "$_" }
  foreach ($line in $out) { $script:log.Add($line) }
  if ($LASTEXITCODE -ne 0) { $script:log.Add("（這一步的結束代碼：$LASTEXITCODE）") }
}

Step '基本資料' 'user' 'user'
Step 'dsh 設定' 'user' 'config'
Step 'dsh 沙盒程式' 'user' 'source'
Step '手動掛載測試資料夾' 'root' "mount $pathB64"
Step '一般身分與沙盒裡讀資料夾、連網' 'user' 'check'
Step '卸下測試資料夾' 'root' 'unmount'

[IO.File]::WriteAllLines($outFile, $log, (New-Object Text.UTF8Encoding($false)))
Remove-Item -Recurse -Force $testDir -ErrorAction SilentlyContinue

Say "`n✅ 檢查完成，結果存在：" Green
Say "   $outFile" Green
Say '把這個檔案的位置告訴 Claude 就可以了（裡面沒有金鑰）。' Green
Read-Host '按 Enter 關閉'
