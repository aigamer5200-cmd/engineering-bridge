@echo off
setlocal EnableExtensions
set "CONTROL=D:\Engineering_Bridge_System\control"

call "%CONTROL%\STOP_DS_CHANNEL.bat"
if errorlevel 1 exit /b %ERRORLEVEL%

powershell -NoProfile -Command Start-Sleep -Seconds 2
call "%CONTROL%\START_DS_CHANNEL.bat"
exit /b %ERRORLEVEL%
