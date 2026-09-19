@echo off
setlocal EnableExtensions
set "DS_STOP=D:\Engineering_Bridge_System\DevSpace\stop_devspace_twmarketlab.bat"
set "MAINTENANCE_FLAG=D:\Engineering_Bridge_System\runtime\maintenance-devspace.flag"

if not exist "%DS_STOP%" exit /b 10

>"%MAINTENANCE_FLAG%" echo intentional-stop

call "%DS_STOP%"
set "DS_RC=%ERRORLEVEL%"

sc query Cloudflared | find /I "RUNNING" >nul 2>&1
if not errorlevel 1 (
  sc stop Cloudflared >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..40 | ForEach-Object { $s=Get-Service -Name Cloudflared -ErrorAction SilentlyContinue; if(-not $s -or $s.Status -eq 'Stopped'){$ok=$true; break}; Start-Sleep -Milliseconds 250 }; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    del /q "%MAINTENANCE_FLAG%" >nul 2>&1
    exit /b 12
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..30 | ForEach-Object { if(-not (Get-NetTCPConnection -State Listen -LocalPort 7677 -ErrorAction SilentlyContinue)){$ok=$true; break}; Start-Sleep -Milliseconds 250 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
  del /q "%MAINTENANCE_FLAG%" >nul 2>&1
  exit /b 11
)

if not "%DS_RC%"=="0" (
  del /q "%MAINTENANCE_FLAG%" >nul 2>&1
  exit /b %DS_RC%
)
exit /b 0
