@echo off
setlocal EnableExtensions
title GPT Engineering Channels - Master Launcher
set "CONTROL=D:\Engineering_Bridge_System\control"

echo Starting Secure MCP DevSpace and Engineering Bridge Green+Blue...
echo.

call "%CONTROL%\START_DS_CHANNEL.bat"
if errorlevel 1 (
  echo [FAIL] DevSpace channel failed to start.
  exit /b 70
)

call "%CONTROL%\START_BRIDGE_CHANNEL.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Bridge Blue rollback failed to start.
  exit /b 72
)

call "%CONTROL%\START_Secure_MCP_Bridge.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Bridge Secure MCP Green failed to start.
  echo Blue rollback remains the last-known-good lane.
  exit /b 75
)

call "%CONTROL%\START_RECOVERY_WATCHDOG.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Recovery Watchdog failed to start.
  exit /b 71
) else (
  echo Engineering Recovery Watchdog : READY
)

call "%CONTROL%\CHECK_CHANNELS.bat"
if errorlevel 1 (
  echo [FAIL] Engineering channel health check failed.
  exit /b 73
)

echo.
echo Secure MCP DevSpace Green and Engineering Bridge Secure MCP Green are ready.
echo Cloudflare Bridge Blue and DevSpace Blue remain available as rollback.
echo Codex Observer UI is OFF by default. Use OPEN_BRIDGE_OBSERVER.bat on demand.
powershell -NoProfile -Command Start-Sleep -Seconds 2
exit /b 0
