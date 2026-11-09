@echo off
rem ===== RESCUE 1: Close the desktop pet WITHOUT syncing. Close the desktop pet, GPT-SoVITS API and the LINE tunnel (they run in the background) =====
echo Closing the desktop pet, GPT-SoVITS API and the LINE tunnel...

rem 1. The background helpers first (otherwise the tunnel helper would just restart ngrok)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like '*line-tunnel.bat*' -or $_.CommandLine -like '*electron:dev*' -or $_.CommandLine -like '*wait-on http://127.0.0.1:3000*' -or $_.CommandLine -like '*tsx*server.ts*' -or $_.CommandLine -like '*npx.cmd electron*' -or $_.CommandLine -like '*api_v2.py*' -or $_.CommandLine -like '*seia-sync.ps1*Watch*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

rem 2. The programs themselves
taskkill /IM ngrok.exe /T /F >nul 2>&1
taskkill /IM electron.exe /T /F >nul 2>&1

rem 3. Windows from older versions of the launcher
taskkill /FI "WINDOWTITLE eq Desktop Pet*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GPT-SoVITS API*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq LINE Tunnel*" /T /F >nul 2>&1

rem 4. Anything still holding the pet's ports (3000 pet, 3001 LINE, 9880 GPT-SoVITS)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"127.0.0.1:3000 .*LISTENING" /C:"127.0.0.1:3001 .*LISTENING" /C:"127.0.0.1:9880 .*LISTENING"') do taskkill /PID %%p /T /F >nul 2>&1

rem (rescue version: does NOT upload her memory to Google Drive)

echo Done.
timeout /t 2 /nobreak >nul
