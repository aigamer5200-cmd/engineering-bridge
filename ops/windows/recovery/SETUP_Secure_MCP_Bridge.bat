@echo off
setlocal EnableExtensions
set "SCRIPT=D:\Engineering_Bridge_System\control\SetupSecureMcpBridge.ps1"
if not exist "%SCRIPT%" (
  echo [FAIL] Secure MCP Bridge setup controller not found: %SCRIPT%
  exit /b 90
)
set "TUNNEL_ID=%~1"
if not defined TUNNEL_ID (
  set /p "TUNNEL_ID=Paste dedicated Engineering Bridge Tunnel ID: "
)
if not defined TUNNEL_ID exit /b 91
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -TunnelId "%TUNNEL_ID%"
exit /b %ERRORLEVEL%
