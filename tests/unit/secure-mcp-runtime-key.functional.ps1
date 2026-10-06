$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repo 'ops\windows\recovery\SecureMcpRuntimeKey.ps1')
$directory = Join-Path $repo ('.dpapi-test-' + [Guid]::NewGuid().ToString('N'))
$path = Join-Path $directory 'credential.dpapi'
$oldKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY', 'Process')
$secret = $null
$stage = 0
try {
    $env:CONTROL_PLANE_API_KEY = $null
    if (Test-SecureMcpRuntimeKey -SecretPath $path) { throw 'Missing check failed.' }
    $failed = $false
    try { Resolve-SecureMcpRuntimeKey -SecretPath $path | Out-Null } catch { $failed = $_.Exception.Message -match 'SET_Secure_MCP_Runtime_API_Key.bat' }
    if (-not $failed) { throw 'Missing resolution must fail without prompt.' }
    $dummy = [Guid]::NewGuid().ToString('N')
    $secret = ConvertTo-SecureString $dummy -AsPlainText -Force
    $stage = 1
    Save-SecureMcpRuntimeKey -Secret $secret -SecretPath $path
    $stage = 2
    if ((Load-SecureMcpRuntimeKey -SecretPath $path) -cne $dummy) { throw 'Roundtrip failed.' }
    $stage = 3
    if (-not (Test-SecureMcpRuntimeKey -SecretPath $path)) { throw 'Check failed.' }
    $stage = 4
    $ciphertext = [IO.File]::ReadAllBytes($path)
    if ([Text.Encoding]::Unicode.GetString($ciphertext).Contains($dummy)) { throw 'Ciphertext boundary failed.' }
    $stage = 1
    Save-SecureMcpRuntimeKey -Secret $secret -SecretPath $path
    $stage = 5
    if ((Resolve-SecureMcpRuntimeKey -SecretPath $path) -cne $dummy) { throw 'Atomic replacement failed.' }
    $stage = 6
    $override = [Guid]::NewGuid().ToString('N')
    $env:CONTROL_PLANE_API_KEY = $override
    [IO.File]::WriteAllBytes($path, (New-Object byte[] 4))
    $stage = 5
    if ((Resolve-SecureMcpRuntimeKey -SecretPath $path) -cne $override) { throw 'Env precedence failed.' }
    $env:CONTROL_PLANE_API_KEY = $null
    if (Test-SecureMcpRuntimeKey -SecretPath $path) { throw 'Corruption must fail closed.' }
    $failed = $false
    try { Load-SecureMcpRuntimeKey -SecretPath $path | Out-Null } catch { $failed = $_.Exception.Message -match 'store unavailable' }
    if (-not $failed) { throw 'Corrupt load must fail bounded.' }
    $stage = 8
    $setter = Join-Path $repo 'ops\windows\recovery\SetSecureMcpRuntimeKey.ps1'
    Remove-Item -LiteralPath $path -Force
    $env:CONTROL_PLANE_API_KEY = $dummy
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setter -SecretPath $path -IfMissing *> $null
    if ($LASTEXITCODE -ne 0 -or (Load-SecureMcpRuntimeKey -SecretPath $path) -cne $dummy) { throw 'Env-backed setter failed.' }
    $env:CONTROL_PLANE_API_KEY = $override
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setter -SecretPath $path -IfMissing *> $null
    if ($LASTEXITCODE -ne 0 -or (Load-SecureMcpRuntimeKey -SecretPath $path) -cne $dummy) { throw 'IfMissing overwrote store.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setter -SecretPath $path -Check *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Setter check failed.' }
    [IO.File]::WriteAllBytes($path, (New-Object byte[] 4))
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setter -SecretPath $path -IfMissing *> $null
    if ($LASTEXITCODE -eq 0) { throw 'Setter must reject corrupt existing store.' }
    $stage = 7
    # Parse changed scripts without executing either real controller.
    foreach ($name in @('SecureMcpRuntimeKey.ps1','SetSecureMcpRuntimeKey.ps1','SecureMcpBridge.ps1','SecureMcpDevSpace.ps1','SetupSecureMcpBridge.ps1')) {
        $tokens = $null; $parseErrors = $null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "ops\windows\recovery\$name"), [ref]$tokens, [ref]$parseErrors) | Out-Null
        if ($parseErrors.Count -ne 0) { throw 'PowerShell parse failed.' }
    }
    Write-Output 'SECURE_MCP_DPAPI_TEST_PASS'
} catch {
    Write-Output ("SECURE_MCP_DPAPI_TEST_FAIL stage=" + $stage)
    exit 1
} finally {
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY', $oldKey, 'Process')
    if ($null -ne $secret) { $secret.Dispose() }
    $dummy = $null; $override = $null
    if (Test-Path -LiteralPath $directory) {
        # Checked local test directory under this worktree only.
        if ((Split-Path $directory -Parent) -ne $repo -or (Split-Path $directory -Leaf) -notlike '.dpapi-test-*') { throw 'Unsafe test cleanup path.' }
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
}
