@echo off
chcp 65001 >nul
cd /d "%~dp0"
set /p SYNC=<sync-dir.txt
set "SRC=%SYNC%\desk\委託\西雅牌防發呆鬧鐘"
set "DST=data\commissions\c-20261109-122809\ws\_old"
if not exist "%SRC%\index.html" (echo 找不到雲端的舊版：%SRC%\index.html & pause & exit /b 1)
mkdir "%DST%" 2>nul
copy /y "%SRC%\index.html" "%DST%\index.html" >nul
if exist "%SRC%\script.js" copy /y "%SRC%\script.js" "%DST%\script.js" >nul
copy /y "scripts\experiment\old-alarm-README.md" "%DST%\README.md" >nul
echo 舊版鬧鐘已經放進委託工作區的 _old\ 了：
dir /b "%DST%"
pause
