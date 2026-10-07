@echo off
setlocal EnableExtensions
set "SCRIPT=%~dp0control\RESTART_ALL_CHANNELS.bat"
if not exist "%SCRIPT%" exit /b 60
call "%SCRIPT%"
exit /b %ERRORLEVEL%
