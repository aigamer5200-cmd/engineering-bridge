@echo off
setlocal EnableExtensions
set "SCRIPT=D:\Engineering_Bridge_System\control\engineering_recovery_watchdog.ps1"

if not exist "%SCRIPT%" exit /b 60
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Once -ForceSessionRecovery
exit /b %ERRORLEVEL%
