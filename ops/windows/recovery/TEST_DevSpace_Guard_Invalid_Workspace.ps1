param(
    [int]$GuardPort = 7688,
    [string]$InvalidWorkspaceId = "ws_guard_invalid?"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-GuardPid {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $GuardPort -ErrorAction Stop |
        Select-Object -First 1
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess) -ErrorAction Stop
    if (
        $process.Name -ne "node.exe" -or
        [string]$process.CommandLine -notmatch "devspace_development_guard_proxy\.mjs"
    ) {
        throw "Port $GuardPort is not owned by the DevSpace guard proxy."
    }
    return [int]$connection.OwningProcess
}

$before = Get-GuardPid
$payload = @{
    jsonrpc = "2.0"
    id = 1
    method = "tools/call"
    params = @{
        name = "read"
        arguments = @{
            workspace_id = $InvalidWorkspaceId
            path = "README.md"
        }
    }
} | ConvertTo-Json -Compress -Depth 8

$status = $null
try {
    $response = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$GuardPort/mcp" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{ Accept = "application/json" } `
        -Body $payload `
        -UseBasicParsing `
        -TimeoutSec 10 `
        -ErrorAction Stop
    $status = [int]$response.StatusCode
} catch {
    if ($null -eq $_.Exception.Response) { throw }
    $status = [int]$_.Exception.Response.StatusCode
}

Start-Sleep -Milliseconds 500
$after = Get-GuardPid

if ($status -ne 503) {
    throw "Expected guard rejection HTTP 503, got $status."
}
if ($after -ne $before) {
    throw "Guard proxy restarted/crashed during invalid workspace-id probe. Before=$before After=$after"
}

Write-Host "Guard invalid workspace ID : REJECTED (HTTP 503)"
Write-Host "Guard PID                  : STABLE ($after)"
Write-Host "DEVSPACE_GUARD_INVALID_WORKSPACE_TEST_PASS"
