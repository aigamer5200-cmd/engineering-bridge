@echo off
setlocal EnableExtensions
set "SCRIPT=D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control\SecureMcpDevSpace.ps1"
if not exist "%SCRIPT%" (
  echo [FAIL] Secure MCP controller not found: %SCRIPT%
  exit /b 80
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action Rollback
exit /b %ERRORLEVEL%
