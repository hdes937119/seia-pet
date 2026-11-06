@echo off
rem ===== Open the pet's logs (what the old windows used to show) =====
rem pet.log         - the pet and her backend: LINE pairing code, [LINE] and calendar messages, errors
rem line-tunnel.log - ngrok (the LINE connection)
rem gpt-sovits.log  - her voice
if not exist "%~dp0logs\pet.log" (
  echo No logs yet - start the pet first with start-pet.bat
  timeout /t 3 /nobreak >nul
  exit /b
)
start "" notepad "%~dp0logs\pet.log"
if exist "%~dp0logs\line-tunnel.log" start "" notepad "%~dp0logs\line-tunnel.log"
