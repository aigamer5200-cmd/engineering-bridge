param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^tunnel_[a-z0-9]{32}$")]
    [string]$TunnelId,
    [string]$Root = "D:\Engineering_Bridge_System\BridgeSecureTunnel",
    [string]$Profile = "engineering-bridge",
    [int]$TunnelHealthPort = 18081,
    [string]$SourceTunnelClient = "D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\tunnel-client\v0.0.15\tunnel-client.exe",
    [string]$BridgeRunner = "D:\Engineering_Bridge_System\runtime\RUN_ENGINEERING_BRIDGE_STDIO.bat"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$version = "v0.0.15"
$clientDir = Join-Path $Root "tunnel-client\$version"
$runtimeDir = Join-Path $Root "runtime"
$logsDir = Join-Path $Root "logs"
$client = Join-Path $clientDir "tunnel-client.exe"
$profilePath = Join-Path $env:APPDATA "tunnel-client\$Profile.yaml"
$setupManifest = Join-Path $runtimeDir "secure-mcp-bridge-setup.json"
$resourceUrl = "https://tunnel-service.gateway.unified-0.internal.api.openai.org/v1/mcp/$TunnelId"
$mcpCommand = "cmd.exe /d /c $BridgeRunner"

foreach ($path in @($Root, $clientDir, $runtimeDir, $logsDir)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

if (-not (Test-Path -LiteralPath $SourceTunnelClient -PathType Leaf)) {
    throw "Source tunnel-client not found: $SourceTunnelClient"
}
if (-not (Test-Path -LiteralPath $BridgeRunner -PathType Leaf)) {
    throw "Bridge STDIO runner not found: $BridgeRunner"
}

Copy-Item -LiteralPath $SourceTunnelClient -Destination $client -Force
$clientVersion = (& $client --version 2>&1 | Out-String).Trim()
if ($clientVersion -notmatch "0\.0\.15") {
    throw "Unexpected tunnel-client version: $clientVersion"
}

& $client init --sample sample_mcp_stdio_local --profile $Profile --tunnel-id $TunnelId --mcp-command $mcpCommand --health-listen-addr "127.0.0.1:$TunnelHealthPort" --force
if ($LASTEXITCODE -ne 0) {
    throw "tunnel-client profile initialization failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
    throw "Generated profile not found: $profilePath"
}
$profileRaw = Get-Content -LiteralPath $profilePath -Raw
if ($profileRaw -notmatch [regex]::Escape($TunnelId)) {
    throw "Generated profile does not contain expected Tunnel ID."
}
if ($profileRaw -notmatch [regex]::Escape("127.0.0.1:$TunnelHealthPort")) {
    throw "Generated profile does not contain expected health port."
}
if (
    $profileRaw -notmatch [regex]::Escape("cmd.exe /d /c") -or
    $profileRaw -notmatch [regex]::Escape("RUN_ENGINEERING_BRIDGE_STDIO.bat")
) {
    throw "Generated profile does not contain expected Bridge STDIO command."
}
if ($profileRaw -notmatch [regex]::Escape('api_key: "env:CONTROL_PLANE_API_KEY"')) {
    throw "Generated profile does not keep the runtime API key in environment-only mode."
}

$manifest = [ordered]@{
    schema_version = "secure_mcp_bridge_setup_v1"
    written_at_utc = [DateTime]::UtcNow.ToString("o")
    profile = $Profile
    tunnel_id = $TunnelId
    tunnel_resource_url = $resourceUrl
    tunnel_health_port = $TunnelHealthPort
    mcp_transport = "stdio"
    mcp_command = $mcpCommand
    bridge_runner = $BridgeRunner
    tunnel_client = $client
    runtime_api_key_persistence = "none"
    blue_rollback = "Cloudflare Engineering Bridge lane remains unchanged"
}
$json = ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine
[System.IO.File]::WriteAllText($setupManifest, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Secure MCP Bridge profile : READY"
Write-Host "Profile                   : $Profile"
Write-Host "Tunnel ID                  : $TunnelId"
Write-Host "Tunnel resource            : $resourceUrl"
Write-Host "MCP transport              : local STDIO"
Write-Host "Bridge command             : $mcpCommand"
Write-Host "Health port                : $TunnelHealthPort"
Write-Host "Runtime API key            : env/process memory only"
Write-Host "Blue Cloudflare Bridge     : UNCHANGED"
Write-Host "SECURE_MCP_BRIDGE_SETUP_PASS"
