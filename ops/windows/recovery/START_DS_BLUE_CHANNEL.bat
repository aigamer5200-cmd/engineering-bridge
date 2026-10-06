@echo off
setlocal EnableExtensions
set "DS_START=D:\Engineering_Bridge_System\DevSpace\START_DS.bat"
set "MAINTENANCE_FLAG=D:\Engineering_Bridge_System\runtime\maintenance-devspace.flag"

if not exist "%DS_START%" exit /b 10

del /q "%MAINTENANCE_FLAG%" >nul 2>&1

sc query Cloudflared | find /I "RUNNING" >nul 2>&1
if errorlevel 1 (
  sc start Cloudflared >nul 2>&1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -State Listen -LocalPort 7677 -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){exit 1}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; $cmd=[string]$p.CommandLine; $direct=$cmd -match 'D:\\Engineering_Bridge_System\\DevSpace\\versions\\.+\\node_modules\\@waishnav\\devspace\\dist\\cli\.js serve'; $guard=$cmd -match 'D:\\Engineering_Bridge_System\\DevSpace\\devspace_development_guard_proxy\.mjs'; if(-not ($p -and $p.Name -eq 'node.exe' -and ($direct -or $guard))){exit 2}; try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:7677/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; exit 0}catch{if($_.Exception.Response){exit 0}else{exit 1}}"
set "PORT_RC=%ERRORLEVEL%"
if "%PORT_RC%"=="2" exit /b 12
if "%PORT_RC%"=="0" goto ds_already_ready

call "%DS_START%"
set "DS_RC=%ERRORLEVEL%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..40 | ForEach-Object { $c=Get-NetTCPConnection -State Listen -LocalPort 7677 -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess) -ErrorAction SilentlyContinue; $cmd=[string]$p.CommandLine; $direct=$cmd -match 'D:\\Engineering_Bridge_System\\DevSpace\\versions\\.+\\node_modules\\@waishnav\\devspace\\dist\\cli\.js serve'; $guard=$cmd -match 'D:\\Engineering_Bridge_System\\DevSpace\\devspace_development_guard_proxy\.mjs'; if($p -and $p.Name -eq 'node.exe' -and ($direct -or $guard)){ try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:7677/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; $ok=$true}catch{$ok=$null -ne $_.Exception.Response}; if($ok){break} } }; Start-Sleep -Milliseconds 500 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 exit /b 11
goto verify_service

:ds_already_ready
set "DS_RC=0"

:verify_service
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..20 | ForEach-Object { $s=Get-Service -Name Cloudflared -ErrorAction SilentlyContinue; if($s -and $s.Status -eq 'Running'){$ok=$true; break}; Start-Sleep -Milliseconds 250 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 exit /b 13

if not "%DS_RC%"=="0" exit /b %DS_RC%
exit /b 0
