@echo off
setlocal EnableExtensions
set "CONTROL=D:\Engineering_Bridge_System\control"

call "%CONTROL%\STOP_ENGINEERING_BRIDGE_ALL.bat"
if errorlevel 1 exit /b %ERRORLEVEL%

powershell -NoProfile -Command Start-Sleep -Seconds 2
if errorlevel 1 exit /b %ERRORLEVEL%
call "%CONTROL%\START_ENGINEERING_BRIDGE_ALL.bat"
exit /b %ERRORLEVEL%
