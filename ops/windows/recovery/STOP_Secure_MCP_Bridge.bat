@echo off
setlocal EnableExtensions
set "SCRIPT=D:\Engineering_Bridge_System\control\SecureMcpBridge.ps1"
if not exist "%SCRIPT%" exit /b 92
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action Stop
exit /b %ERRORLEVEL%
