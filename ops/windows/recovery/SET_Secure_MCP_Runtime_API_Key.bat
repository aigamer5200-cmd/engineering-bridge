@echo off
setlocal EnableExtensions
echo [INFO] Compatibility entry: setup now uses separate DevSpace and Bridge keys/stores.
call "%~dp0SET_Secure_MCP_Runtime_API_Keys.bat"
exit /b %ERRORLEVEL%
