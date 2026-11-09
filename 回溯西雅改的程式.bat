@echo off
rem ===== Roll back code changes Seia made to herself (see scripts\self\rollback.ts) =====
chcp 65001 >nul
cd /d "%~dp0"
call npx.cmd tsx scripts\self\rollback.ts %*
echo.
pause
