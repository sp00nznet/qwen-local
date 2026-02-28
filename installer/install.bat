@echo off
title qwen-local Installer
echo.
echo   Starting qwen-local installer...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
