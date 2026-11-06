@echo off
rem ===== Restart everything (use after an update or after editing .env) =====
call "%~dp0stop-pet.bat"
rem give ngrok's servers a moment to release the domain
timeout /t 8 /nobreak >nul
call "%~dp0start-pet.bat"
