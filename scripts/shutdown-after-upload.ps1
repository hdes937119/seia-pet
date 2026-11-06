<#
  雲端上傳完自動關機：看這台電腦的「上傳流量」，連續一段時間幾乎沒在上傳，就當作傳完了，自動關機。
  不管是 Google 雲端硬碟、OneDrive 還是其他雲端都適用。

  用法：雙擊桌寵資料夾的 shutdown-after-upload.bat
        或 powershell -ExecutionPolicy Bypass -File scripts\shutdown-after-upload.ps1 [-IdleMinutes 10] [-IdleKBps 50]
  中途想取消：直接關掉這個視窗；已經開始倒數的話，按 Win+R 輸入 shutdown /a
#>
param(
  [int]$IdleMinutes = 10, # 連續幾分鐘沒在上傳才算傳完
  [int]$IdleKBps = 50,    # 上傳速度低於多少 KB/s 算「沒在上傳」
  [int]$CheckSeconds = 30
)

function Get-SentBytes {
  $sum = 0
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up') { continue }
    if ($nic.NetworkInterfaceType -eq 'Loopback' -or $nic.NetworkInterfaceType -eq 'Tunnel') { continue }
    try { $sum += $nic.GetIPStatistics().BytesSent } catch {}
  }
  return [double]$sum
}

$Host.UI.RawUI.WindowTitle = '上傳完自動關機'
Write-Host "`n=== 雲端上傳完自動關機 ===" -ForegroundColor Cyan
Write-Host "上傳速度連續 $IdleMinutes 分鐘低於 $IdleKBps KB/s，就會自動關機。"
Write-Host '想取消：直接關掉這個視窗。' -ForegroundColor Yellow
Write-Host ''

$needed = [math]::Ceiling($IdleMinutes * 60 / $CheckSeconds)
$idleCount = 0
$peak = 0
$last = Get-SentBytes
while ($true) {
  Start-Sleep -Seconds $CheckSeconds
  $now = Get-SentBytes
  $kbps = [math]::Max(0, ($now - $last) / 1024 / $CheckSeconds)
  $last = $now
  if ($kbps -gt $peak) { $peak = $kbps }
  if ($kbps -lt $IdleKBps) { $idleCount++ } else { $idleCount = 0 }
  $speed = if ($kbps -ge 1024) { '{0:N1} MB/s' -f ($kbps / 1024) } else { '{0:N0} KB/s' -f $kbps }
  $state = if ($idleCount -eq 0) { '上傳中' } else { "閒置 {0:N1} / $IdleMinutes 分鐘" -f ($idleCount * $CheckSeconds / 60) }
  Write-Host ("[{0}] 上傳速度 {1,-12} {2}" -f (Get-Date -Format 'HH:mm:ss'), $speed, $state)
  if ($idleCount -ge $needed) { break }
}

Write-Host "`n上傳看起來完成了，2 分鐘後關機。" -ForegroundColor Green
Write-Host '要取消：按 Win+R，輸入 shutdown /a 再按 Enter。' -ForegroundColor Yellow
shutdown /s /t 120 /c "雲端上傳完成，2 分鐘後關機。要取消請按 Win+R 輸入 shutdown /a"
Start-Sleep -Seconds 125
