@echo off
rem ===== Desktop pet one-click launcher =====
rem Starts GPT-SoVITS API (port 9880), the desktop pet (port 3000) and the LINE tunnel
rem in the background - no extra windows. Their output goes to the "logs" folder
rem (open it with show-logs.bat). Safe to run again: anything already running is skipped.

rem Keep this launcher itself out of the way (it closes by itself when done)
if /i not "%~1"=="min" (
  start "" /min cmd /c call "%~f0" min
  exit /b
)

set "PET_DIR=%~dp0"
set "LOG_DIR=%~dp0logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

rem ---------- 0. Sync: latest code from GitHub, her memory from Google Drive ----------
rem (skipped when the pet is already running; see scripts\sync\seia-sync.ps1 and logs\sync.log)
curl -s -o nul http://127.0.0.1:3000/api/relationship
if %errorlevel%==0 goto sync_done
if not exist "%~dp0scripts\sync\seia-sync.ps1" goto sync_done
echo [0/3] Syncing code and memory...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync\seia-sync.ps1" -Mode Pull
if %errorlevel%==2 exit
:sync_done
set "PYTHONUNBUFFERED=1"
rem Logs go to a file, so make Python write UTF-8 there (otherwise Japanese/Chinese text crashes TTS with a cp950 error)
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "SOVITS_DIR=%USERPROFILE%\Desktop\GPT-SoVITS-v2pro-20250604"
rem Other computers: put the GPT-SoVITS folder path in sovits-dir.txt (next to this file)
if exist "%~dp0sovits-dir.txt" for /f "usebackq delims=" %%a in ("%~dp0sovits-dir.txt") do set "SOVITS_DIR=%%a"

rem ---------- 1. GPT-SoVITS API ----------
curl -s -o nul http://127.0.0.1:9880/docs
if %errorlevel%==0 goto sovits_ready
if not exist "%SOVITS_DIR%\api_v2.py" goto sovits_missing
echo [1/3] Starting GPT-SoVITS API...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c call ' + [char]34 + (Join-Path $env:SOVITS_DIR 'runtime\python.exe') + [char]34 + ' api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml > ' + [char]34 + (Join-Path $env:LOG_DIR 'gpt-sovits.log') + [char]34 + ' 2>&1') -WorkingDirectory $env:SOVITS_DIR -WindowStyle Hidden"

rem Wait for port 9880 (max about 3 minutes) so her voice is ready when she starts
set /a TRIES=0
:wait_sovits
curl -s -o nul http://127.0.0.1:9880/docs
if %errorlevel%==0 goto sovits_ready
set /a TRIES+=1
if %TRIES% GEQ 90 goto sovits_ready
timeout /t 2 /nobreak >nul
goto wait_sovits
:sovits_ready

rem ---------- 2. Desktop pet (backend + window) ----------
set "BACKEND_UP=0"
curl -s -o nul http://127.0.0.1:3000/api/relationship
if %errorlevel%==0 set "BACKEND_UP=1"
set "WINDOW_UP=0"
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if %errorlevel%==0 set "WINDOW_UP=1"

if "%BACKEND_UP%%WINDOW_UP%"=="11" goto pet_ready
if "%BACKEND_UP%"=="1" goto pet_window_only
echo [2/3] Starting the desktop pet...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c npm.cmd run electron:dev > ' + [char]34 + (Join-Path $env:LOG_DIR 'pet.log') + [char]34 + ' 2>&1') -WorkingDirectory $env:PET_DIR -WindowStyle Hidden"
goto pet_ready
:pet_window_only
echo [2/3] Reopening the pet window...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c npx.cmd electron . > ' + [char]34 + (Join-Path $env:LOG_DIR 'pet-window.log') + [char]34 + ' 2>&1') -WorkingDirectory $env:PET_DIR -WindowStyle Hidden"
:pet_ready

rem Upload a memory snapshot to Google Drive every 30 minutes while the pet runs (stop-pet.bat ends it)
if not exist "%~dp0scripts\sync\seia-sync.ps1" goto watch_done
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*seia-sync.ps1*Watch*' }) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto watch_done
powershell -NoProfile -Command "Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + [char]34 + (Join-Path $env:PET_DIR 'scripts\sync\seia-sync.ps1') + [char]34 + ' -Mode Watch') -WindowStyle Hidden"
:watch_done

rem ---------- 3. LINE tunnel (only if ngrok-domain.txt exists) ----------
if not exist "%~dp0ngrok-domain.txt" goto done
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*line-tunnel.bat*' }) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto done
echo [3/3] Starting the LINE tunnel...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c call ' + [char]34 + (Join-Path $env:PET_DIR 'scripts\line-tunnel.bat') + [char]34 + ' > ' + [char]34 + (Join-Path $env:LOG_DIR 'line-tunnel.log') + [char]34 + ' 2>&1') -WorkingDirectory $env:PET_DIR -WindowStyle Hidden"
goto done

:sovits_missing
powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('GPT-SoVITS was not found. Put the full path of your GPT-SoVITS folder into sovits-dir.txt next to start-pet.bat.', 'Desktop pet')"
exit /b 1

:done
exit
