@echo off
setlocal EnableExtensions
set "CONTROL=D:\Engineering_Bridge_System\control"

call "%CONTROL%\CLOSE_BRIDGE_OBSERVER.bat"
set "OBSERVER_RC=%ERRORLEVEL%"

call "%CONTROL%\STOP_RECOVERY_WATCHDOG.bat"
set "WATCHDOG_RC=%ERRORLEVEL%"

call "%CONTROL%\STOP_Secure_MCP_Bridge.bat"
set "BRIDGE_GREEN_RC=%ERRORLEVEL%"

call "%CONTROL%\STOP_BRIDGE_CHANNEL.bat"
set "BRIDGE_BLUE_RC=%ERRORLEVEL%"

call "%CONTROL%\STOP_DS_CHANNEL.bat"
set "DS_RC=%ERRORLEVEL%"

if not "%OBSERVER_RC%"=="0" exit /b %OBSERVER_RC%
if not "%WATCHDOG_RC%"=="0" exit /b %WATCHDOG_RC%
if not "%BRIDGE_GREEN_RC%"=="0" exit /b %BRIDGE_GREEN_RC%
if not "%BRIDGE_BLUE_RC%"=="0" exit /b %BRIDGE_BLUE_RC%
if not "%DS_RC%"=="0" exit /b %DS_RC%
exit /b 0
