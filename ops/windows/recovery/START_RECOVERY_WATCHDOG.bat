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

powershell -NoProfile -ExecutionPolicy Bypass -Command "$psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'; $psi.Arguments='-NoProfile -ExecutionPolicy Bypass -File %SCRIPT%'; $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true; $psi.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $p=[System.Diagnostics.Process]::Start($psi); if($null -eq $p){exit 1}else{exit 0}"\nif errorlevel 1 exit /b 52
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..20 | ForEach-Object { if(Test-Path '%PID_FILE%'){ $id=(Get-Content '%PID_FILE%' | Select-Object -First 1).Trim(); if($id -match '^\d+$'){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction SilentlyContinue; if($p -and ([string]$p.CommandLine -match 'engineering_recovery_watchdog\.ps1')){$ok=$true; break} } }; Start-Sleep -Milliseconds 250 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 exit /b 51
exit /b 0
