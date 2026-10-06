@echo off
setlocal EnableExtensions
set "SECURE_STATUS=D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control\STATUS_Secure_MCP_DevSpace.bat"
set "BRIDGE_SECURE_STATUS=D:\Engineering_Bridge_System\control\STATUS_Secure_MCP_Bridge.bat"

echo.
echo ============================================================
echo   Engineering Channels Status
echo ============================================================

if not exist "%SECURE_STATUS%" (
  echo Secure MCP DevSpace       : DOWN - status launcher missing
  exit /b 74
)

call "%SECURE_STATUS%"
if errorlevel 1 exit /b 74

if not exist "%BRIDGE_SECURE_STATUS%" (
  echo Secure MCP Bridge         : DOWN - status launcher missing
  exit /b 75
)

call "%BRIDGE_SECURE_STATUS%"
if errorlevel 1 exit /b 75

powershell -NoProfile -ExecutionPolicy Bypass -Command "$bad=$false; function Listener($port){$c=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){return $null}; Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue}; $br=Listener 8768; $brc=[string]$br.CommandLine; $brOwner=$br -and ($brc -match 'mcp-stdio\.exe.*serve.*--port 8768'); try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8768/.well-known/oauth-authorization-server' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; $brHttp=[int]$r.StatusCode -eq 200}catch{$brHttp=$false}; $brReady=$brOwner -and $brHttp; if(-not $brReady){$bad=$true}; Write-Host ('Bridge local 8768         : '+$(if($brReady){'READY'}else{'DOWN/INVALID'})); $auth=Test-Path 'D:\Engineering_Bridge_System\runtime\PUBLIC_AUTH_READY.flag'; $token=Test-Path 'D:\Engineering_Bridge_System\runtime\secrets\cloudflared-bridge-token.txt'; if($auth){$bt=Listener 20242; $btc=[string]$bt.CommandLine; $btOwner=$bt -and $bt.Name -eq 'cloudflared.exe' -and ($btc -match '--metrics 127\.0\.0\.1:20242'); try{$r=Invoke-WebRequest -Uri 'https://bridge.twmarketlab.com/.well-known/oauth-authorization-server' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; $public=[int]$r.StatusCode -eq 200}catch{$public=$false}; $btReady=$token -and $btOwner -and $public; if(-not $btReady){$bad=$true}; Write-Host ('Bridge public auth        : '+$(if($token){'READY'}else{'TOKEN MISSING'})); Write-Host ('Bridge tunnel metrics     : '+$(if($btOwner){'READY'}else{'DOWN/INVALID'})); Write-Host ('Bridge public OAuth       : '+$(if($public){'READY'}else{'DOWN'}))}else{Write-Host 'Bridge public auth        : PENDING - tunnel not required'; Write-Host 'Bridge tunnel metrics     : NOT REQUIRED'; Write-Host 'Bridge public OAuth       : NOT REQUIRED'}; $pidFile='D:\Engineering_Bridge_System\runtime\recovery-watchdog.pid'; $wd=$false; if(Test-Path $pidFile){$id=(Get-Content $pidFile | Select-Object -First 1).Trim(); if($id -match '^\d+$'){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction SilentlyContinue; $wd=$p -and ([string]$p.CommandLine -match 'engineering_recovery_watchdog\.ps1')}}; if(-not $wd){$bad=$true}; Write-Host ('Engineering Recovery      : '+$(if($wd){'READY'}else{'DOWN/STALE'})); if($bad){exit 1}else{exit 0}"
set "RC=%ERRORLEVEL%"
echo ============================================================
exit /b %RC%
