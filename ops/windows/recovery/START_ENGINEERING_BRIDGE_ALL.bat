@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Engineering Bridge - Green Primary + Blue Rollback
set "CONTROL=D:\Engineering_Bridge_System\control"
set "VERSION_FILE=D:\Engineering_Bridge_System\runtime\bridge-current-version.txt"
set "BRIDGE_VERSION="

if not exist "%VERSION_FILE%" (
  echo [FAIL] Bridge runtime version file not found: %VERSION_FILE%
  exit /b 74
)
set /p "BRIDGE_VERSION=" < "%VERSION_FILE%"
if not defined BRIDGE_VERSION (
  echo [FAIL] Bridge runtime version file is empty.
  exit /b 74
)
echo Current Bridge runtime version: %BRIDGE_VERSION%
echo Starting Engineering Bridge Green primary + Blue rollback...

call "%CONTROL%\START_BRIDGE_CHANNEL.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Bridge Blue rollback failed to start.
  exit /b 72
)

call "%CONTROL%\START_Secure_MCP_Bridge.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Bridge Secure MCP Green failed to start.
  echo Blue rollback remains untouched as the last-known-good lane.
  exit /b 75
)

rem START_Secure_MCP_Bridge already validates expected owner and HTTP readyz.
rem Do not repeat its full status scan here. The master START_ALL_CHANNELS
rem runs CHECK_CHANNELS after the watchdog, preserving the final health gate.

echo Engineering Bridge Secure MCP Green primary : READY
echo Engineering Bridge Cloudflare Blue rollback : READY
exit /b 0
