param(
    [ValidateSet("Start","Stop","Status","Rollback")]
    [string]$Action = "Status",
    [string]$Root = "D:\Engineering_Bridge_System\BridgeSecureTunnel",
    [string]$Profile = "engineering-bridge",
    [int]$TunnelHealthPort = 18081,
    [int]$BlueGatewayPort = 8768,
    [int]$BlueTunnelMetricsPort = 20242
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$client = Join-Path $Root "tunnel-client\v0.0.15\tunnel-client.exe"
$runtimeDir = Join-Path $Root "runtime"
$logsDir = Join-Path $Root "logs"
$runtimeManifest = Join-Path $runtimeDir "secure-mcp-bridge-runtime.json"
$setupManifest = Join-Path $runtimeDir "secure-mcp-bridge-setup.json"
$profilePath = Join-Path $env:APPDATA "tunnel-client\$Profile.yaml"
$blueStart = "D:\Engineering_Bridge_System\control\START_BRIDGE_CHANNEL.bat"
$blueStop = "D:\Engineering_Bridge_System\control\STOP_BRIDGE_CHANNEL.bat"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
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

function Test-Readyz {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelHealthPort/readyz" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        return [int]$response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-HttpResponding([string]$Url) {
    try {
        Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 3 -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop | Out-Null
        return $true
    } catch {
        # Any HTTP response (including expected 4xx auth/protocol responses)
        # proves the local gateway answered. Only transport/no-response fails.
        if ($null -ne $_.Exception.Response) { return $true }
        return $false
    }
}

function Wait-Tunnel([int]$Seconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $listener = Get-Listener $TunnelHealthPort
        if (
            $null -ne $listener -and
            $listener.Name -eq "tunnel-client.exe" -and
            $listener.CommandLine -match "run\s+--profile\s+$([regex]::Escape($Profile))"
        ) {
            return $listener
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Assert-Files {
    foreach ($path in @($Root,$runtimeDir,$logsDir)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            throw "Missing directory: $path"
        }
    }
    foreach ($path in @($client,$setupManifest,$profilePath,$blueStart,$blueStop)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Missing file: $path"
        }
    }
}

function Get-Setup {
    $setup = Get-Content -LiteralPath $setupManifest -Raw | ConvertFrom-Json
    if ([string]$setup.profile -ne $Profile) { throw "Setup profile mismatch." }
    if ([int]$setup.tunnel_health_port -ne $TunnelHealthPort) { throw "Setup health-port mismatch." }
    if ([string]$setup.mcp_transport -ne "stdio") { throw "Bridge Green must use STDIO transport." }
    return $setup
}

function Assert-Profile($Setup) {
    $raw = Get-Content -LiteralPath $profilePath -Raw
    if ($raw -notmatch [regex]::Escape([string]$Setup.tunnel_id)) {
        throw "Tunnel profile does not contain expected Tunnel ID."
    }
    if ($raw -notmatch [regex]::Escape("127.0.0.1:$TunnelHealthPort")) {
        throw "Tunnel profile does not contain expected health port."
    }
    if (
        $raw -notmatch [regex]::Escape("cmd.exe /d /c") -or
        $raw -notmatch [regex]::Escape("RUN_ENGINEERING_BRIDGE_STDIO.bat")
    ) {
        throw "Tunnel profile does not contain expected Bridge command."
    }
    if ($raw -notmatch [regex]::Escape('api_key: "env:CONTROL_PLANE_API_KEY"')) {
        throw "Tunnel profile does not use environment-only runtime API key."
    }
}

function Ensure-Blue {
    & cmd.exe /d /c $blueStart
    if ($LASTEXITCODE -ne 0) {
        throw "Blue Engineering Bridge lane failed to reach READY state (exit $LASTEXITCODE)."
    }
    $gateway = Get-Listener $BlueGatewayPort
    $gatewayCommand = if ($null -eq $gateway) { "" } else { [string]$gateway.CommandLine }
    $gatewayOwned = (
        $null -ne $gateway -and
        (
            (
                $gateway.Name -eq "python.exe" -and
                $gatewayCommand -match "mcp-stdio\.exe.*serve.*--port\s+$BlueGatewayPort"
            ) -or
            (
                $gateway.Name -eq "mcp-stdio.exe" -and
                $gatewayCommand -match "serve.*--port\s+$BlueGatewayPort"
            )
        )
    )
    if (-not $gatewayOwned) {
        throw "Blue Bridge gateway is not owned by the expected mcp-stdio runtime."
    }
    if (-not (Test-HttpResponding "http://127.0.0.1:$BlueGatewayPort/mcp")) {
        throw "Blue Bridge gateway listener exists but HTTP is unresponsive."
    }

    $authReady = "D:\Engineering_Bridge_System\runtime\PUBLIC_AUTH_READY.flag"
    if (Test-Path -LiteralPath $authReady -PathType Leaf) {
        $cloudflare = Get-Listener $BlueTunnelMetricsPort
        if (
            $null -eq $cloudflare -or
            $cloudflare.Name -ne "cloudflared.exe" -or
            $cloudflare.CommandLine -notmatch "--metrics\s+127\.0\.0\.1:$BlueTunnelMetricsPort"
        ) {
            throw "Blue Bridge Cloudflare rollback tunnel is not READY."
        }
    }
    return $gateway
}

function Get-GreenStatus {
    $listener = Get-Listener $TunnelHealthPort
    $owned = (
        $null -ne $listener -and
        $listener.Name -eq "tunnel-client.exe" -and
        $listener.CommandLine -match "run\s+--profile\s+$([regex]::Escape($Profile))"
    )
    return [pscustomobject]@{
        Listener = $listener
        Owned = $owned
        Readyz = ($owned -and (Test-Readyz))
    }
}

function Save-RuntimeManifest($Setup, $Green) {
    $manifest = [ordered]@{
        schema_version = "secure_mcp_bridge_runtime_v1"
        written_at_utc = [DateTime]::UtcNow.ToString("o")
        profile = $Profile
        tunnel_id = [string]$Setup.tunnel_id
        tunnel_resource_url = [string]$Setup.tunnel_resource_url
        mcp_transport = "stdio"
        mcp_command = [string]$Setup.mcp_command
        tunnel_health_port = $TunnelHealthPort
        tunnel_pid = [int]$Green.Listener.Pid
        blue_gateway_port = $BlueGatewayPort
        blue_tunnel_metrics_port = $BlueTunnelMetricsPort
    }
    Write-Utf8NoBom $runtimeManifest (($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
}

function Start-Green {
    Assert-Files
    $setup = Get-Setup
    Assert-Profile $setup
    Ensure-Blue | Out-Null

    $green = Get-GreenStatus
    if ($null -ne $green.Listener -and -not $green.Owned) {
        throw "Tunnel health port $TunnelHealthPort is occupied by an unexpected process."
    }
    if (-not $green.Owned) {
        $version = (& $client --version 2>&1 | Out-String).Trim()
        if ($version -notmatch "0\.0\.15") { throw "Unexpected tunnel-client version: $version" }

        $keyHelper = "D:\Engineering_Bridge_System\control\SecureMcpRuntimeKey.ps1"
        if (-not (Test-Path -LiteralPath $keyHelper -PathType Leaf)) {
            throw "Runtime key helper missing. Deploy SecureMcpRuntimeKey.ps1 and run SET_Secure_MCP_Runtime_API_Keys.bat once."
        }
        . $keyHelper
        $runtimeKey = Resolve-SecureMcpRuntimeKey -SecretPath (Get-SecureMcpRuntimeKeyPath -Purpose Bridge)

        $oldKey = $env:CONTROL_PLANE_API_KEY
        try {
            $env:CONTROL_PLANE_API_KEY = $runtimeKey
            & $client doctor --profile $Profile --explain *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "tunnel-client doctor failed with exit code $LASTEXITCODE."
            }

            $stdout = Join-Path $logsDir "green-bridge-tunnel.stdout.log"
            $stderr = Join-Path $logsDir "green-bridge-tunnel.stderr.log"
            Start-Process -FilePath $client -ArgumentList @("run","--profile",$Profile) -WorkingDirectory (Split-Path $client -Parent) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
        } finally {
            $runtimeKey = $null
            if ($null -eq $oldKey) { Remove-Item Env:\CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue }
            else { $env:CONTROL_PLANE_API_KEY = $oldKey }
        }

        $listener = Wait-Tunnel
        if ($null -eq $listener) {
            throw "Bridge Secure MCP tunnel did not expose health port $TunnelHealthPort. Inspect tunnel logs."
        }
    }

    $green = Get-GreenStatus
    if (-not $green.Owned -or -not $green.Readyz) {
        throw "Bridge Secure MCP Green did not reach READY state."
    }
    Save-RuntimeManifest -Setup $setup -Green $green

    Write-Host "Secure MCP Bridge Green : READY"
    Write-Host "Blue Bridge rollback     : READY / UNCHANGED"
    Write-Host "Transport                : OpenAI Secure MCP Tunnel -> local STDIO Bridge"
    Write-Host "Tunnel readyz             : READY (HTTP 200)"
    Write-Host "Profile                   : $Profile"
    Write-Host "Tunnel resource           : $($setup.tunnel_resource_url)"
    Write-Host "SECURE_MCP_BRIDGE_START_PASS"
}

function Stop-Green {
    Assert-Files
    $setup = Get-Setup
    Assert-Profile $setup
    $green = Get-GreenStatus
    if ($null -eq $green.Listener) {
        Write-Host "Secure MCP Bridge Green : already stopped"
        return
    }
    if (-not $green.Owned) {
        throw "Refusing to stop unexpected listener on health port $TunnelHealthPort."
    }

    if (-not (Test-Path -LiteralPath $runtimeManifest -PathType Leaf)) {
        throw "Runtime manifest missing; refusing to stop an existing Green listener."
    }
    $manifest = Get-Content -LiteralPath $runtimeManifest -Raw | ConvertFrom-Json
    if ([int]$manifest.tunnel_pid -ne [int]$green.Listener.Pid) {
        throw "Runtime manifest PID does not match the current tunnel listener."
    }

    & taskkill.exe /PID ([int]$green.Listener.Pid) /T /F | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($null -eq (Get-Listener $TunnelHealthPort)) { break }
        Start-Sleep -Milliseconds 500
    }
    if ($null -ne (Get-Listener $TunnelHealthPort)) {
        throw "Bridge Secure MCP tunnel did not release health port $TunnelHealthPort."
    }

    Ensure-Blue | Out-Null
    Write-Host "Secure MCP Bridge Green : STOPPED"
    Write-Host "Blue Bridge rollback     : READY / UNCHANGED"
    Write-Host "SECURE_MCP_BRIDGE_STOP_PASS"
}

function Show-Status {
    Assert-Files
    $setup = Get-Setup
    Assert-Profile $setup
    $green = Get-GreenStatus
    $blueReady = $true
    try { Ensure-Blue | Out-Null } catch { $blueReady = $false }

    Write-Host "============================================================"
    Write-Host "  Secure MCP Engineering Bridge Status"
    Write-Host "============================================================"
    Write-Host ("Blue Bridge rollback      : {0}" -f $(if($blueReady){"READY"}else{"DOWN/INVALID"}))
    Write-Host ("Green tunnel health {0} : {1}" -f $TunnelHealthPort,$(if($green.Owned){"READY PID "+$green.Listener.Pid}else{"DOWN/INVALID"}))
    Write-Host ("Green tunnel readyz       : {0}" -f $(if($green.Readyz){"READY (HTTP 200)"}else{"DOWN"}))
    Write-Host "Transport                  : local STDIO"
    Write-Host "Profile                    : $Profile"
    Write-Host "Tunnel ID                  : $($setup.tunnel_id)"
    Write-Host "Tunnel resource            : $($setup.tunnel_resource_url)"
    Write-Host "MCP command                : $($setup.mcp_command)"
    Write-Host "============================================================"

    if (-not $blueReady -or -not $green.Owned -or -not $green.Readyz) { exit 1 }
}

switch ($Action) {
    "Start" { Start-Green; break }
    "Stop" { Stop-Green; break }
    "Status" { Show-Status; break }
    "Rollback" {
        Stop-Green
        Ensure-Blue | Out-Null
        Write-Host "ROLLBACK PASS: Cloudflare Engineering Bridge remains the last-known-good lane."
        Write-Host "Green profile/setup were preserved."
        break
    }
}
