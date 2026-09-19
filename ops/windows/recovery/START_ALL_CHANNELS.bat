@echo off
setlocal EnableExtensions
title GPT Engineering Channels - Master Launcher
set "CONTROL=D:\Engineering_Bridge_System\control"

echo Starting DevSpace and Engineering Bridge independently...
echo.

call "%CONTROL%\START_DS_CHANNEL.bat"
if errorlevel 1 (
  echo ERROR: DevSpace channel failed to start.
  exit /b 70
)

call "%CONTROL%\START_BRIDGE_CHANNEL.bat"
if errorlevel 1 (
  echo ERROR: Engineering Bridge channel failed to start.
  exit /b 72
)

call "%CONTROL%\START_RECOVERY_WATCHDOG.bat"
if errorlevel 1 (
  echo ERROR: Recovery Watchdog failed to start.
  exit /b 71
) else (
  echo Recovery Watchdog          : READY
)

call "%CONTROL%\CHECK_CHANNELS.bat"
if errorlevel 1 (
  echo ERROR: Engineering channel health check failed.
  exit /b 73
)

echo.
echo Both channels are launched as separate processes.
echo A failure or restart on one side does not stop the other side.
echo Codex Observer UI is OFF by default. Use OPEN_BRIDGE_OBSERVER.bat on demand.
powershell -NoProfile -Command Start-Sleep -Seconds 3
exit /b 0
