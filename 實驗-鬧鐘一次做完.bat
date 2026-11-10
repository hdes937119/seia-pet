@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 鬧鐘實驗：同一個 Gemini 一次做到通過驗收（大約 5～30 分鐘，桌寵開著也可以）
node scripts\experiment\run-alarm.mjs
echo.
pause
