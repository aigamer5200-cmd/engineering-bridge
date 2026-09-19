@echo off
setlocal EnableExtensions
set "GATEWAY_RUNNER=D:\Engineering_Bridge_System\runtime\RUN_BRIDGE_GATEWAY.bat"
set "TUNNEL_RUNNER=D:\Engineering_Bridge_System\runtime\START_BRIDGE_TUNNEL.bat"
set "LOG_DIR=D:\Engineering_Bridge_System\runtime\logs"
set "MAINTENANCE_FLAG=D:\Engineering_Bridge_System\runtime\maintenance-bridge.flag"
set "AUTH_READY=D:\Engineering_Bridge_System\runtime\PUBLIC_AUTH_READY.flag"
set "TOKEN_FILE=D:\Engineering_Bridge_System\runtime\secrets\cloudflared-bridge-token.txt"
set "PUBLIC_OAUTH=https://bridge.twmarketlab.com/.well-known/oauth-authorization-server"

if not exist "%GATEWAY_RUNNER%" exit /b 20
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

del /q "%MAINTENANCE_FLAG%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -State Listen -LocalPort 8768 -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){exit 1}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and ([string]$p.CommandLine -match 'mcp-stdio\.exe.*serve.*--port 8768')){exit 0}else{exit 2}"
set "PORT_RC=%ERRORLEVEL%"
if "%PORT_RC%"=="2" exit /b 23
if not "%PORT_RC%"=="0" (
  start "Engineering Bridge Gateway" /min cmd /d /c "call ""%GATEWAY_RUNNER%"" >> ""%LOG_DIR%\bridge-gateway.log"" 2>&1"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..40 | ForEach-Object { $c=Get-NetTCPConnection -State Listen -LocalPort 8768 -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and ([string]$p.CommandLine -match 'mcp-stdio\.exe.*serve.*--port 8768')){$ok=$true; break} }; Start-Sleep -Milliseconds 500 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 exit /b 21

powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8768/.well-known/oauth-authorization-server' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if([int]$r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}"
if errorlevel 1 exit /b 28

rem Public Bridge tunnel is optional only before public auth has been provisioned.
rem Once PUBLIC_AUTH_READY exists, runner/token/connector/public OAuth must all be healthy.
if exist "%AUTH_READY%" (
  if not exist "%TUNNEL_RUNNER%" exit /b 25
  if not exist "%TOKEN_FILE%" exit /b 26

  powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -State Listen -LocalPort 20242 -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){exit 1}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.Name -eq 'cloudflared.exe' -and ([string]$p.CommandLine -match '--metrics 127\.0\.0\.1:20242')){exit 0}else{exit 2}"
  if errorlevel 2 exit /b 24
  if errorlevel 1 (
    start "Engineering Bridge Tunnel" /min cmd /d /c "call ""%TUNNEL_RUNNER%"" >nul 2>&1"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..40 | ForEach-Object { $c=Get-NetTCPConnection -State Listen -LocalPort 20242 -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.Name -eq 'cloudflared.exe' -and ([string]$p.CommandLine -match '--metrics 127\.0\.0\.1:20242')){$ok=$true; break} }; Start-Sleep -Milliseconds 500 }; if($ok){exit 0}else{exit 1}"
    if errorlevel 1 exit /b 22
  )

  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..40 | ForEach-Object { try { $r=Invoke-WebRequest -Uri '%PUBLIC_OAUTH%' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if([int]$r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 exit /b 27
)

exit /b 0
