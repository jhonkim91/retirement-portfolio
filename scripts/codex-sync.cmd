@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex-sync.ps1" -Mode sync
pause
