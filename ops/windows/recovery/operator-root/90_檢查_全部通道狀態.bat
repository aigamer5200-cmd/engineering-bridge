@echo off
setlocal EnableExtensions
set "SCRIPT=%~dp0control\CHECK_CHANNELS.bat"
if not exist "%SCRIPT%" exit /b 60
call "%SCRIPT%"
exit /b %ERRORLEVEL%
