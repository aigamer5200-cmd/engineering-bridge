@echo off
setlocal EnableExtensions
set "SCRIPT=D:\Engineering_Bridge_System\control\SetSecureMcpRuntimeKey.ps1"
if not exist "%SCRIPT%" (
  echo [FAIL] Deploy the split Runtime API keys setup helper first.
  exit /b 90
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Purpose All -IfMissing
exit /b %ERRORLEVEL%
