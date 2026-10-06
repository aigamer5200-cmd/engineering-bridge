param(
    [switch]$Check,
    [switch]$IfMissing,
    [string]$SecretPath = 'D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-runtime-api-key.dpapi'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    . (Join-Path $PSScriptRoot 'SecureMcpRuntimeKey.ps1')
    if ($Check) {
        if (Test-SecureMcpRuntimeKey -SecretPath $SecretPath) {
            Write-Host 'Runtime API key store: AVAILABLE for current Windows user.'
            exit 0
        }
        Write-Host 'Runtime API key store: MISSING/UNAVAILABLE. Run SET_Secure_MCP_Runtime_API_Key.bat once.'
        exit 1
    }
    if ($IfMissing -and (Test-Path -LiteralPath $SecretPath)) {
        if (-not (Test-SecureMcpRuntimeKey -SecretPath $SecretPath)) { throw 'Existing store unavailable; no overwrite attempted.' }
        Write-Host 'Existing encrypted store retained.'
        exit 0
    }
    $explicitKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY', 'Process')
    $secure = if ($null -ne $explicitKey) {
        if ([string]::IsNullOrWhiteSpace($explicitKey)) { throw 'Explicit runtime key is empty.' }
        ConvertTo-SecureString -String $explicitKey -AsPlainText -Force
    } else {
        Read-Host 'Enter Runtime API Key (one-time secure setup)' -AsSecureString
    }
    Save-SecureMcpRuntimeKey -Secret $secure -SecretPath $SecretPath
    Write-Host 'Runtime API key saved encrypted with Windows DPAPI CurrentUser. Normal Start will not prompt.'
} catch {
    Write-Host 'Runtime API key setup failed. Check local store access and run as the controller Windows user.'
    exit 1
} finally {
    $explicitKey = $null
    if ($null -ne (Get-Variable secure -ErrorAction SilentlyContinue) -and $null -ne $secure) { $secure.Dispose() }
}
