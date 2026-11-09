@echo off
rem RESCUE 2: copy the memory restored in Google Drive back to this computer (backs up this computer first)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0data\_claude_tmp\rescue-20261109\force-pull.ps1"
pause
