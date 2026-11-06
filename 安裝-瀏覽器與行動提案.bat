@echo off
rem 2026-11-06 Claude: install Seia browser + action plans. Safe to run twice.
cd /d "%~dp0"
echo Installing update into: %CD%
node "data\_claude_tmp\deploy-20261106c\apply.mjs"
echo.
echo Done. If RESULT: OK, run restart-pet.bat. Otherwise send the text above to Claude.
pause
