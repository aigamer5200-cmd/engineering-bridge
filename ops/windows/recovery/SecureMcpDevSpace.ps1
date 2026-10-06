param(
    [ValidateSet("Start","Stop","Status","Rollback")]
    [string]$Action = "Status",
    [string]$Root = "D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta",
    [string]$Profile = "devspace-canary",
    [string]$TunnelId = "tunnel_6ac461f81ed08191a912d3ed551de286",
    [string]$TunnelResourceUrl = "https://tunnel-service.gateway.unified-0.internal.api.openai.org/v1/mcp/tunnel_6ac461f81ed08191a912d3ed551de286",
    [int]$BlueProxyPort = 7677,
    [int]$BlueUpstreamPort = 7679,
    [int]$GreenProxyPort = 7688,
    [int]$GreenUpstreamPort = 7689,
    [int]$TunnelHealthPort = 18080
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceRoot = Join-Path $Root "source"
$configRoot = Join-Path $Root "config"
$stateRoot = Join-Path $Root "state"
$runtimeRoot = Join-Path $Root "runtime"
$logsRoot = Join-Path $Root "logs"
$configPath = Join-Path $configRoot "config.jsonc"
$authPath = Join-Path $configRoot "auth.json"
$dbPath = Join-Path $stateRoot "devspace.sqlite"
$cliPath = Join-Path $sourceRoot "bin\devspace.js"
$runtimeManifest = Join-Path $runtimeRoot "secure-mcp-runtime.json"
$blueManifestPath = "D:\Engineering_Bridge_System\DevSpace\runtime\painless-upgrade\runtime_production.json"
$proxyJsCanonical = Join-Path $PSScriptRoot "devspace_development_guard_proxy.mjs"
$proxyJs = "D:\Engineering_Bridge_System\DevSpace\devspace_development_guard_proxy.mjs"
$guardPython = "D:\shoestring-goal\.venv\Scripts\python.exe"
$guardScript = "D:\shoestring-goal\scripts\development_execution_guard.py"
$guardRuntime = "D:\ShoestringGoalData\development-execution-guard"
$tunnelClient = Join-Path $Root "tunnel-client\v0.0.15\tunnel-client.exe"
$tunnelProfile = Join-Path $env:APPDATA "tunnel-client\$Profile.yaml"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Sync-GuardProxySource {
    if (-not (Test-Path -LiteralPath $proxyJsCanonical -PathType Leaf)) {
        throw "Missing canonical DevSpace guard proxy: $proxyJsCanonical"
    }
    $canonicalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $proxyJsCanonical).Hash
    $deployedHash = if (Test-Path -LiteralPath $proxyJs -PathType Leaf) {
        (Get-FileHash -Algorithm SHA256 -LiteralPath $proxyJs).Hash
    } else {
        $null
    }
    if ($canonicalHash -ne $deployedHash) {
        Copy-Item -LiteralPath $proxyJsCanonical -Destination $proxyJs -Force
    }
}

function Get-Listener([int]$Port) {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $connection) { return $null }
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess) -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    return [pscustomobject]@{
        Port = $Port
        Pid = [int]$connection.OwningProcess
        Name = [string]$process.Name
        CommandLine = [string]$process.CommandLine
    }
}

function Assert-ExpectedListener(
    [int]$Port,
    [string]$Label,
    [string]$ExpectedName,
    [string]$CommandPattern
) {
    $listener = Get-Listener $Port
    if ($null -eq $listener) { throw "$Label is not listening on port $Port." }
    if ($listener.Name -ne $ExpectedName -or $listener.CommandLine -notmatch $CommandPattern) {
        throw "$Label port $Port is owned by unexpected process PID $($listener.Pid) $($listener.Name)."
    }
    return $listener
}

function Test-HttpReachable([string]$Uri, [int]$TimeoutSec = 3) {
    try {
        Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $null -ne $_.Exception.Response
    }
}

function Test-Readyz {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelHealthPort/readyz" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        return [int]$response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-ExpectedListener(
    [int]$Port,
    [string]$ExpectedName,
    [string]$CommandPattern,
    [int]$Seconds = 45
) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $listener = Get-Listener $Port
        if ($null -ne $listener -and $listener.Name -eq $ExpectedName -and $listener.CommandLine -match $CommandPattern) {
            return $listener
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Assert-Files {
    foreach ($path in @($sourceRoot,$configRoot,$stateRoot,$runtimeRoot,$logsRoot)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Missing directory: $path" }
    }
    foreach ($path in @($configPath,$authPath,$dbPath,$cliPath,$proxyJsCanonical,$proxyJs,$guardPython,$guardScript,$tunnelClient,$tunnelProfile)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
    }
}

function Assert-Config {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ([int]$config.server.port -ne $GreenUpstreamPort) { throw "config server.port is not $GreenUpstreamPort." }
    if ([string]$config.server.publicBaseUrl -ne "http://127.0.0.1:$GreenProxyPort") { throw "config publicBaseUrl is not Green proxy $GreenProxyPort." }
    if (@($config.oauth.allowedResourceUrls) -notcontains $TunnelResourceUrl) { throw "Tunnel resource URL is missing from oauth.allowedResourceUrls." }
    $profileRaw = Get-Content -LiteralPath $tunnelProfile -Raw
    if ($profileRaw -notmatch [regex]::Escape('api_key: "env:CONTROL_PLANE_API_KEY"')) {
        throw "Tunnel profile does not use environment-only runtime API key."
    }
    if ($profileRaw -notmatch [regex]::Escape($TunnelId)) { throw "Tunnel profile does not contain expected Tunnel ID." }
    if ($profileRaw -notmatch [regex]::Escape("http://127.0.0.1:$GreenProxyPort/mcp")) { throw "Tunnel profile does not target Green proxy $GreenProxyPort." }
}

function Assert-Blue {
    $blueProxy = Assert-ExpectedListener -Port $BlueProxyPort -Label "Blue Guard" -ExpectedName "node.exe" -CommandPattern "DevSpace\\devspace_development_guard_proxy\.mjs"
    $blueUpstream = Assert-ExpectedListener -Port $BlueUpstreamPort -Label "Blue DevSpace 1.0.8" -ExpectedName "node.exe" -CommandPattern "DevSpace\\versions\\1\.0\.8\\node_modules\\@waishnav\\devspace\\dist\\cli\.js serve"
    if (-not (Test-HttpReachable "http://127.0.0.1:$BlueProxyPort/" 3)) { throw "Blue Guard HTTP probe failed on $BlueProxyPort." }
    if (Test-Path -LiteralPath $blueManifestPath) {
        $blueManifest = Get-Content -LiteralPath $blueManifestPath -Raw | ConvertFrom-Json
        if ([int]$blueManifest.pid -ne $blueProxy.Pid -or [int]$blueManifest.upstream_pid -ne $blueUpstream.Pid) {
            throw "Blue listener PIDs do not match the current production manifest."
        }
    }
    return [pscustomobject]@{ Proxy = $blueProxy; Upstream = $blueUpstream }
}

function Get-GreenStatus {
    $proxy = Get-Listener $GreenProxyPort
    $upstream = Get-Listener $GreenUpstreamPort
    $tunnel = Get-Listener $TunnelHealthPort
    $proxyOk = $null -ne $proxy -and $proxy.Name -eq "node.exe" -and $proxy.CommandLine -match "DevSpace\\devspace_development_guard_proxy\.mjs"
    $upstreamOk = $null -ne $upstream -and $upstream.Name -eq "node.exe" -and $upstream.CommandLine -match "secure-tunnel-beta\\source\\bin\\devspace\.js serve"
    $tunnelOk = $null -ne $tunnel -and $tunnel.Name -eq "tunnel-client.exe" -and $tunnel.CommandLine -match "run\s+--profile\s+$([regex]::Escape($Profile))"
    $ready = $tunnelOk -and (Test-Readyz)
    return [pscustomobject]@{
        Proxy = $proxy
        Upstream = $upstream
        Tunnel = $tunnel
        ProxyOk = $proxyOk
        UpstreamOk = $upstreamOk
        TunnelOk = $tunnelOk
        Readyz = $ready
    }
}

function Save-RuntimeManifest($Blue, $Green) {
    $manifest = [ordered]@{
        schema_version = "secure_mcp_devspace_runtime_v1"
        written_at_utc = [DateTime]::UtcNow.ToString("o")
        profile = $Profile
        tunnel_id = $TunnelId
        tunnel_resource_url = $TunnelResourceUrl
        target = "http://127.0.0.1:$GreenProxyPort/mcp"
        blue_proxy_port = $BlueProxyPort
        blue_proxy_pid = $Blue.Proxy.Pid
        blue_upstream_port = $BlueUpstreamPort
        blue_upstream_pid = $Blue.Upstream.Pid
        green_proxy_port = $GreenProxyPort
        green_proxy_pid = $Green.Proxy.Pid
        green_upstream_port = $GreenUpstreamPort
        green_upstream_pid = $Green.Upstream.Pid
        tunnel_health_port = $TunnelHealthPort
        tunnel_pid = $Green.Tunnel.Pid
    }
    Write-Utf8NoBom $runtimeManifest (($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
}

function Start-Green {
    Sync-GuardProxySource
    Assert-Files
    Assert-Config
    $blue = Assert-Blue

    $green = Get-GreenStatus
    if ($null -ne $green.Upstream -and -not $green.UpstreamOk) { throw "Green upstream port $GreenUpstreamPort is occupied by an unexpected process." }
    if ($null -ne $green.Proxy -and -not $green.ProxyOk) { throw "Green proxy port $GreenProxyPort is occupied by an unexpected process." }
    if ($null -ne $green.Tunnel -and -not $green.TunnelOk) { throw "Tunnel health port $TunnelHealthPort is occupied by an unexpected process." }

    if (-not $green.UpstreamOk) {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) { throw "node not found in PATH." }
        $stdout = Join-Path $logsRoot "green-production-upstream.stdout.log"
        $stderr = Join-Path $logsRoot "green-production-upstream.stderr.log"
        $oldConfig = $env:DEVSPACE_CONFIG_DIR
        try {
            $env:DEVSPACE_CONFIG_DIR = $configRoot
            Start-Process -FilePath $nodeCommand.Source -ArgumentList @($cliPath,"serve") -WorkingDirectory $sourceRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
        } finally {
            if ($null -eq $oldConfig) { Remove-Item Env:\DEVSPACE_CONFIG_DIR -ErrorAction SilentlyContinue } else { $env:DEVSPACE_CONFIG_DIR = $oldConfig }
        }
        $listener = Wait-ExpectedListener -Port $GreenUpstreamPort -ExpectedName "node.exe" -CommandPattern "secure-tunnel-beta\\source\\bin\\devspace\.js serve"
        if ($null -eq $listener) { throw "Green DevSpace failed to listen on $GreenUpstreamPort. Inspect $stderr" }
    }

    $green = Get-GreenStatus
    if (-not $green.ProxyOk) {
        $stdout = Join-Path $logsRoot "green-production-guard.stdout.log"
        $stderr = Join-Path $logsRoot "green-production-guard.stderr.log"
        $names = @("DEVSPACE_GUARD_PROXY_HOST","DEVSPACE_GUARD_PROXY_PORT","DEVSPACE_GUARD_UPSTREAM_HOST","DEVSPACE_GUARD_UPSTREAM_PORT","DEVSPACE_GUARD_PYTHON","DEVSPACE_GUARD_SCRIPT","DEVSPACE_GUARD_RUNTIME_ROOT","DEVSPACE_GUARD_WORKSPACE_DB","DEVSPACE_GUARD_LEASE_SECONDS")
        $oldEnv = @{}
        foreach ($name in $names) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name,"Process") }
        try {
            $env:DEVSPACE_GUARD_PROXY_HOST = "127.0.0.1"
            $env:DEVSPACE_GUARD_PROXY_PORT = [string]$GreenProxyPort
            $env:DEVSPACE_GUARD_UPSTREAM_HOST = "127.0.0.1"
            $env:DEVSPACE_GUARD_UPSTREAM_PORT = [string]$GreenUpstreamPort
            $env:DEVSPACE_GUARD_PYTHON = $guardPython
            $env:DEVSPACE_GUARD_SCRIPT = $guardScript
            $env:DEVSPACE_GUARD_RUNTIME_ROOT = $guardRuntime
            $env:DEVSPACE_GUARD_WORKSPACE_DB = $dbPath
            $env:DEVSPACE_GUARD_LEASE_SECONDS = "180"
            Start-Process -FilePath node -ArgumentList @($proxyJs) -WorkingDirectory (Split-Path $proxyJs -Parent) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
        } finally {
            foreach ($name in $names) {
                if ($null -eq $oldEnv[$name]) { Remove-Item ("Env:\" + $name) -ErrorAction SilentlyContinue }
                else { [Environment]::SetEnvironmentVariable($name,[string]$oldEnv[$name],"Process") }
            }
        }
        $listener = Wait-ExpectedListener -Port $GreenProxyPort -ExpectedName "node.exe" -CommandPattern "DevSpace\\devspace_development_guard_proxy\.mjs" -Seconds 30
        if ($null -eq $listener) { throw "Green Guard failed to listen on $GreenProxyPort. Inspect $stderr" }
    }

    $green = Get-GreenStatus
    if (-not $green.TunnelOk) {
        $version = (& $tunnelClient --version 2>&1 | Out-String).Trim()
        if ($version -notmatch "0\.0\.15") { throw "Unexpected tunnel-client version: $version" }
        $keyHelper = "D:\Engineering_Bridge_System\control\SecureMcpRuntimeKey.ps1"
        if (-not (Test-Path -LiteralPath $keyHelper -PathType Leaf)) {
            throw "Runtime key helper missing. Deploy SecureMcpRuntimeKey.ps1 and run SET_Secure_MCP_Runtime_API_Keys.bat once."
        }
        . $keyHelper
        $runtimeKey = Resolve-SecureMcpRuntimeKey -SecretPath (Get-SecureMcpRuntimeKeyPath -Purpose DevSpace)

        $stdout = Join-Path $logsRoot "green-production-tunnel.stdout.log"
        $stderr = Join-Path $logsRoot "green-production-tunnel.stderr.log"
        $oldKey = $env:CONTROL_PLANE_API_KEY
        $oldPlain = $env:HARPOON_ALLOW_PLAINTEXT_HTTP
        try {
            $env:CONTROL_PLANE_API_KEY = $runtimeKey
            $env:HARPOON_ALLOW_PLAINTEXT_HTTP = "true"
            Start-Process -FilePath $tunnelClient -ArgumentList @("run","--profile",$Profile) -WorkingDirectory (Split-Path $tunnelClient -Parent) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
        } finally {
            $runtimeKey = $null
            if ($null -eq $oldKey) { Remove-Item Env:\CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue } else { $env:CONTROL_PLANE_API_KEY = $oldKey }
            if ($null -eq $oldPlain) { Remove-Item Env:\HARPOON_ALLOW_PLAINTEXT_HTTP -ErrorAction SilentlyContinue } else { $env:HARPOON_ALLOW_PLAINTEXT_HTTP = $oldPlain }
        }
        $listener = Wait-ExpectedListener -Port $TunnelHealthPort -ExpectedName "tunnel-client.exe" -CommandPattern "run\s+--profile\s+$([regex]::Escape($Profile))"
        if ($null -eq $listener) { throw "tunnel-client failed to expose health port $TunnelHealthPort. Inspect $stderr" }
    }

    $green = Get-GreenStatus
    if (-not $green.UpstreamOk -or -not $green.ProxyOk -or -not $green.TunnelOk -or -not $green.Readyz) { throw "Green Secure MCP runtime did not reach READY state." }
    if (-not (Test-HttpReachable "http://127.0.0.1:$GreenProxyPort/" 3)) { throw "Green Guard HTTP probe failed on $GreenProxyPort." }

    Save-RuntimeManifest -Blue $blue -Green $green
    Write-Host "Secure MCP DevSpace Green : READY"
    Write-Host "Blue rollback             : READY ($BlueProxyPort -> $BlueUpstreamPort)"
    Write-Host "Green runtime             : READY ($GreenProxyPort -> $GreenUpstreamPort)"
    Write-Host "Tunnel readyz             : READY (HTTP 200)"
    Write-Host "SECURE_MCP_DEVSPACE_START_PASS"
}

function Get-RuntimeManifest {
    if (-not (Test-Path -LiteralPath $runtimeManifest -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $runtimeManifest -Raw | ConvertFrom-Json
}

function Stop-VerifiedListener([int]$Port, [int]$ExpectedPid, [string]$ExpectedName, [string]$CommandPattern, [string]$Label) {
    $listener = Get-Listener $Port
    if ($null -eq $listener) { return }
    if ($listener.Pid -ne $ExpectedPid -or $listener.Name -ne $ExpectedName -or $listener.CommandLine -notmatch $CommandPattern) {
        throw "Refusing to stop $Label on ${Port}: listener does not match runtime manifest/expected owner."
    }
    Stop-Process -Id $listener.Pid -Force
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if ($null -eq (Get-Listener $Port)) { return }
    }
    throw "$Label did not release port $Port."
}

function Stop-Green {
    $blueBefore = Assert-Blue
    $manifest = Get-RuntimeManifest
    $green = Get-GreenStatus
    if ($null -eq $manifest) {
        if ($null -ne $green.Proxy -or $null -ne $green.Upstream -or $null -ne $green.Tunnel) {
            throw "Runtime manifest missing; refusing to stop existing Green listeners."
        }
        Write-Host "Secure MCP DevSpace Green : already stopped"
        return
    }

    Stop-VerifiedListener -Port $TunnelHealthPort -ExpectedPid ([int]$manifest.tunnel_pid) -ExpectedName "tunnel-client.exe" -CommandPattern "run\s+--profile\s+$([regex]::Escape($Profile))" -Label "Tunnel"
    Stop-VerifiedListener -Port $GreenProxyPort -ExpectedPid ([int]$manifest.green_proxy_pid) -ExpectedName "node.exe" -CommandPattern "DevSpace\\devspace_development_guard_proxy\.mjs" -Label "Green Guard"
    Stop-VerifiedListener -Port $GreenUpstreamPort -ExpectedPid ([int]$manifest.green_upstream_pid) -ExpectedName "node.exe" -CommandPattern "secure-tunnel-beta\\source\\bin\\devspace\.js serve" -Label "Green DevSpace"

    $blueAfter = Assert-Blue
    if ($blueAfter.Proxy.Pid -ne $blueBefore.Proxy.Pid -or $blueAfter.Upstream.Pid -ne $blueBefore.Upstream.Pid) { throw "Blue rollback listeners changed during Green stop." }
    Write-Host "Secure MCP DevSpace Green : STOPPED"
    Write-Host "Blue rollback             : READY / UNCHANGED"
    Write-Host "SECURE_MCP_DEVSPACE_STOP_PASS"
}

function Show-Status {
    $bad = $false
    $blue = $null
    try { $blue = Assert-Blue } catch { $bad = $true }
    $green = Get-GreenStatus
    if (-not $green.ProxyOk -or -not $green.UpstreamOk -or -not $green.TunnelOk -or -not $green.Readyz) { $bad = $true }

    Write-Host "============================================================"
    Write-Host "  Secure MCP DevSpace Status"
    Write-Host "============================================================"
    Write-Host ("Blue rollback {0}->{1} : {2}" -f $BlueProxyPort,$BlueUpstreamPort,$(if($null -ne $blue){"READY"}else{"DOWN/INVALID"}))
    Write-Host ("Green Guard {0}       : {1}" -f $GreenProxyPort,$(if($green.ProxyOk){"READY PID "+$green.Proxy.Pid}else{"DOWN/INVALID"}))
    Write-Host ("Green DevSpace {0}    : {1}" -f $GreenUpstreamPort,$(if($green.UpstreamOk){"READY PID "+$green.Upstream.Pid}else{"DOWN/INVALID"}))
    Write-Host ("Tunnel health {0}      : {1}" -f $TunnelHealthPort,$(if($green.TunnelOk){"READY PID "+$green.Tunnel.Pid}else{"DOWN/INVALID"}))
    Write-Host ("Tunnel readyz          : {0}" -f $(if($green.Readyz){"READY (HTTP 200)"}else{"DOWN"}))
    Write-Host "Profile                : $Profile"
    Write-Host "Target                 : http://127.0.0.1:$GreenProxyPort/mcp"
    Write-Host "Config                 : $configPath"
    Write-Host "Tunnel resource        : $TunnelResourceUrl"
    Write-Host "============================================================"
    if ($bad) { exit 1 }
}

switch ($Action) {
    "Start" { Start-Green; break }
    "Stop" { Stop-Green; break }
    "Status" { Assert-Files; Assert-Config; Show-Status; break }
    "Rollback" {
        Stop-Green
        Assert-Blue | Out-Null
        Write-Host "ROLLBACK PASS: Blue Cloudflare/DevSpace remains the last-known-good path."
        Write-Host "Green config/state were preserved."
        break
    }
}
