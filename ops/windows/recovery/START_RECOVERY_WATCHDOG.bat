@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT=D:\Engineering_Bridge_System\control\engineering_recovery_watchdog.ps1"
set "PID_FILE=D:\Engineering_Bridge_System\runtime\recovery-watchdog.pid"

if not exist "%SCRIPT%" exit /b 50

if exist "%PID_FILE%" (
  set /p WATCHDOG_PID=<"%PID_FILE%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=!WATCHDOG_PID!' -ErrorAction SilentlyContinue; if($p -and ([string]$p.CommandLine -match 'engineering_recovery_watchdog\.ps1')){exit 0}else{exit 1}"
  if not errorlevel 1 exit /b 0
  del /q "%PID_FILE%" >nul 2>&1
)

start "Engineering Recovery Watchdog" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..20 | ForEach-Object { if(Test-Path '%PID_FILE%'){$ok=$true; break}; Start-Sleep -Milliseconds 250 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 exit /b 51
exit /b 0
