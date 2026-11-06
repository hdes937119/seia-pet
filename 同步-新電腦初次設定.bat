@echo off
rem Seia sync - one-time setup on THIS (new) computer: GitHub + Google Drive.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync\setup-new-pc.ps1"
