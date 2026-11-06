@echo off
rem Double-click to build the migration package (close the pet first with stop-pet.bat)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pack-migration.ps1" %*
pause
