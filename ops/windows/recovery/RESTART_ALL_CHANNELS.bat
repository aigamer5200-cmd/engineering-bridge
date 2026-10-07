@echo off
setlocal EnableExtensions
set "CONTROL=D:\Engineering_Bridge_System\control"
set "WAIT_STOPPED=%CONTROL%\WAIT_ALL_CHANNELS_STOPPED.ps1"
set "CHECK_CHANNELS=%CONTROL%\CHECK_CHANNELS.bat"

if not exist "%WAIT_STOPPED%" exit /b 77
if not exist "%CHECK_CHANNELS%" exit /b 77

call "%CONTROL%\STOP_ALL_CHANNELS.bat"
if errorlevel 1 exit /b %ERRORLEVEL%

powershell -NoProfile -ExecutionPolicy Bypass -File "%WAIT_STOPPED%" -TimeoutSeconds 45 -StableSeconds 8
if errorlevel 1 (
  echo [FAIL] Channels did not reach a clean stopped state before restart.
  exit /b 78
)

call "%CONTROL%\START_ALL_CHANNELS.bat"
if errorlevel 1 exit /b %ERRORLEVEL%

rem Let external tunnel/session registration settle, then verify again.
powershell -NoProfile -Command "Start-Sleep -Seconds 5"
call "%CHECK_CHANNELS%"
if errorlevel 1 (
  echo [FAIL] Channels failed post-restart stabilization verification.
  exit /b 79
)

echo.
echo Engineering channels restart : PASS
exit /b 0
