param(
    [ValidateSet('DevSpace', 'Bridge', 'All')][string]$Purpose = 'All',
    [switch]$Check,
    [switch]$Force,
    [switch]$IfMissing,
    # Explicit single-purpose override for isolated tests/local tooling only.
    [string]$SecretPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$secure = $null
try {
    . (Join-Path $PSScriptRoot 'SecureMcpRuntimeKey.ps1')
    if ($SecretPath -and $Purpose -eq 'All') { throw 'Explicit path requires a single purpose.' }
    if ($Force -and ($Check -or $IfMissing)) { throw 'Force cannot combine with Check/IfMissing.' }
    $purposes = if ($Purpose -eq 'All') { @('DevSpace', 'Bridge') } else { @($Purpose) }
    $unavailable = $false
    foreach ($selected in $purposes) {
        $path = if ($SecretPath) { $SecretPath } else { Get-SecureMcpRuntimeKeyPath -Purpose $selected }
        Assert-SecureMcpKeyPath $path
        $valid = Test-SecureMcpRuntimeKey -SecretPath $path
        if ($Check) {
            if ($valid) { Write-Host "$selected Runtime API key store: AVAILABLE for current Windows user." }
            else { Write-Host "$selected Runtime API key store: MISSING/UNAVAILABLE. Run SET_Secure_MCP_Runtime_API_Keys.bat once."; $unavailable = $true }
            continue
        }
        if (-not $Force -and (Test-Path -LiteralPath $path)) {
            if (-not $valid) { throw 'Existing store unavailable; explicit Force rotation required.' }
            Write-Host "$selected existing encrypted store retained."
            continue
        }
        # Never reuse CONTROL_PLANE_API_KEY across purposes during setup.
        $secure = Read-Host "Enter $selected Runtime API Key (one-time secure setup)" -AsSecureString
        Save-SecureMcpRuntimeKey -Secret $secure -SecretPath $path
        $secure.Dispose(); $secure = $null
        Write-Host "$selected Runtime API key saved encrypted with Windows DPAPI CurrentUser. Normal Start will not prompt."
    }
    if ($unavailable) { exit 1 }
} catch {
    Write-Host 'Runtime API key setup failed. Check controller Windows user/store access; unreadable existing stores require explicit -Purpose DevSpace or Bridge -Force rotation.'
    exit 1
} finally {
    if ($null -ne $secure) { $secure.Dispose() }
}
