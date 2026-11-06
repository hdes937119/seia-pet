@echo off
rem ===== LINE tunnel (ngrok) that restarts itself =====
rem Started by start-pet.bat. If ngrok stops (network drop, sleep, or the domain is still
rem held by a previous session for a few seconds), it waits and tries again.
rem Close this window (or run stop-pet.bat) to turn the LINE connection off.
title LINE Tunnel

set "NGROK_EXE=ngrok"
if exist "%~dp0..\ngrok.exe" set "NGROK_EXE=%~dp0..\ngrok.exe"

:loop
rem Read the domain and (optional) authtoken each time, so fixing a file takes effect on the next retry
set "NGROK_DOMAIN="
if exist "%~dp0..\ngrok-domain.txt" for /f "usebackq tokens=1" %%d in ("%~dp0..\ngrok-domain.txt") do set "NGROK_DOMAIN=%%d"
set "NGROK_TOKEN="
if exist "%~dp0..\ngrok-authtoken.txt" for /f "usebackq tokens=1" %%t in ("%~dp0..\ngrok-authtoken.txt") do set "NGROK_TOKEN=%%t"

if not defined NGROK_DOMAIN (
  echo [LINE Tunnel] ngrok-domain.txt was not found in the pet folder.
) else if defined NGROK_TOKEN (
  "%NGROK_EXE%" http 127.0.0.1:3001 --url=%NGROK_DOMAIN% --authtoken %NGROK_TOKEN% --log stdout
) else (
  "%NGROK_EXE%" http 127.0.0.1:3001 --url=%NGROK_DOMAIN% --log stdout
)
echo.
echo [LINE Tunnel] ngrok stopped - trying again in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
