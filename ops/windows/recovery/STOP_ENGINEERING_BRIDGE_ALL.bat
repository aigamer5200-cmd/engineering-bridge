@echo off
setlocal EnableExtensions
set "CONTROL=D:\Engineering_Bridge_System\control"

call "%CONTROL%\STOP_Secure_MCP_Bridge.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Bridge Secure MCP Green failed to stop.
  echo Blue rollback remains untouched; dual-lane stop aborted.
  exit /b %ERRORLEVEL%
)

call "%CONTROL%\STOP_BRIDGE_CHANNEL.bat"
if errorlevel 1 (
  echo [FAIL] Engineering Bridge Blue rollback failed to stop.
  exit /b %ERRORLEVEL%
)

echo Engineering Bridge Green and Blue : STOPPED
exit /b 0
