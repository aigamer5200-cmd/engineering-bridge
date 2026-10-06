@echo off
setlocal EnableExtensions
set "CONTROL=D:\Engineering_Bridge_System\control"
set "SECURE_CONTROL=D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control"

call "%CONTROL%\START_DS_BLUE_CHANNEL.bat"
if errorlevel 1 (
  echo [FAIL] Blue rollback DevSpace failed to become ready.
  exit /b 10
)

call "%SECURE_CONTROL%\START_Secure_MCP_DevSpace.bat"
if errorlevel 1 (
  echo [FAIL] Secure MCP DevSpace Green failed to become ready.
  echo        Logs: D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\logs
  exit /b 11
)

echo DevSpace Secure MCP Green : READY
echo DevSpace Blue rollback    : READY
exit /b 0
