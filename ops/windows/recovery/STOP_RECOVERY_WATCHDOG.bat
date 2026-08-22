@echo off
setlocal EnableExtensions
set "PID_FILE=D:\Engineering_Bridge_System\runtime\recovery-watchdog.pid"

if not exist "%PID_FILE%" exit /b 0
set /p WATCHDOG_PID=<"%PID_FILE%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%WATCHDOG_PID%' -ErrorAction SilentlyContinue; if(-not $p){exit 0}; if(([string]$p.CommandLine -notmatch 'engineering_recovery_watchdog\.ps1')){exit 2}; Stop-Process -Id %WATCHDOG_PID% -Force; exit 0"
set "RC=%ERRORLEVEL%"
if "%RC%"=="2" exit /b 52

del /q "%PID_FILE%" >nul 2>&1
exit /b 0
