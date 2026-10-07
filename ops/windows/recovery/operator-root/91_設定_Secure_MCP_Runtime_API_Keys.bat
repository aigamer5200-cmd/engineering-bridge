@echo off
setlocal EnableExtensions
set "SCRIPT=%~dp0control\SET_Secure_MCP_Runtime_API_Keys.bat"
if not exist "%SCRIPT%" exit /b 60
call "%SCRIPT%"
exit /b %ERRORLEVEL%
