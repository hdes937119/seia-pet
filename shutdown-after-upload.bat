@echo off
rem Shut down the PC after the cloud upload finishes (upload speed stays low for 10 minutes)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\shutdown-after-upload.ps1" %*
