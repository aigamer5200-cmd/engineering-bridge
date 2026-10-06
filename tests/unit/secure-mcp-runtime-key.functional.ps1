param([string]$SetterHarnessDirectory)
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($SetterHarnessDirectory) {
    # Only repo-contained temporary harness paths may be used, never deployed stores.
    if ((Split-Path $SetterHarnessDirectory -Parent) -ne $repo -or (Split-Path $SetterHarnessDirectory -Leaf) -notlike '.dpapi-test-*') { exit 1 }
    . (Join-Path $SetterHarnessDirectory 'SecureMcpRuntimeKey.ps1')
    $global:secureMcpTestPrompts = @()
    $global:secureMcpTestAnswers = @{ DevSpace = [Guid]::NewGuid().ToString('N'); Bridge = [Guid]::NewGuid().ToString('N') }
    function Read-Host {
        param([string]$Prompt, [switch]$AsSecureString)
        $selected = if ($Prompt -match 'DevSpace') { 'DevSpace' } elseif ($Prompt -match 'Bridge') { 'Bridge' } else { throw 'Unknown prompt.' }
        if (-not $AsSecureString) { throw 'Insecure prompt.' }
        $global:secureMcpTestPrompts += $selected
        ConvertTo-SecureString $global:secureMcpTestAnswers[$selected] -AsPlainText -Force
    }
    $setter = Join-Path $SetterHarnessDirectory 'SetSecureMcpRuntimeKey.ps1'
    & $setter *> $null
    if (($global:secureMcpTestPrompts -join ',') -ne 'DevSpace,Bridge') { exit 11 }
    foreach ($selected in @('DevSpace','Bridge')) {
        if ((Load-SecureMcpRuntimeKey -SecretPath (Get-SecureMcpRuntimeKeyPath -Purpose $selected)) -cne $global:secureMcpTestAnswers[$selected]) { exit 12 }
    }
    $global:secureMcpTestPrompts = @()
    & $setter *> $null
    if ($global:secureMcpTestPrompts.Count -ne 0) { exit 13 }
    Remove-Item -LiteralPath (Get-SecureMcpRuntimeKeyPath -Purpose Bridge) -Force
    & $setter *> $null
    if (($global:secureMcpTestPrompts -join ',') -ne 'Bridge') { exit 14 }
    $global:secureMcpTestPrompts = @()
    Remove-Item -LiteralPath (Get-SecureMcpRuntimeKeyPath -Purpose DevSpace) -Force
    & $setter *> $null
    if (($global:secureMcpTestPrompts -join ',') -ne 'DevSpace') { exit 16 }
    $global:secureMcpTestPrompts = @()
    $global:secureMcpTestAnswers.DevSpace = [Guid]::NewGuid().ToString('N')
    & $setter -Purpose DevSpace -Force *> $null
    if (($global:secureMcpTestPrompts -join ',') -ne 'DevSpace') { exit 15 }
    foreach ($selected in @('DevSpace','Bridge')) {
        if ((Load-SecureMcpRuntimeKey -SecretPath (Get-SecureMcpRuntimeKeyPath -Purpose $selected)) -cne $global:secureMcpTestAnswers[$selected]) { exit 17 }
    }
    & $setter -Check *> $null
    exit 0
}
. (Join-Path $repo 'ops\windows\recovery\SecureMcpRuntimeKey.ps1')
$directory = Join-Path $repo ('.dpapi-test-' + [Guid]::NewGuid().ToString('N'))
$paths = @{ DevSpace = (Join-Path $directory 'devspace.dpapi'); Bridge = (Join-Path $directory 'bridge.dpapi') }
$oldKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY', 'Process')
$secret = $null
$stage = 0
try {
    $env:CONTROL_PLANE_API_KEY = $null
    $forbiddenPath = Join-Path $directory ('secure-mcp-' + 'runtime-api-key.dpapi')
    $rejected = $false
    try { Assert-SecureMcpKeyPath $forbiddenPath } catch { $rejected = $true }
    if (-not $rejected -or (Test-Path -LiteralPath $forbiddenPath)) { throw 'Obsolete store must be forbidden.' }
    $dummy = @{ DevSpace = [Guid]::NewGuid().ToString('N'); Bridge = [Guid]::NewGuid().ToString('N') }
    if ($dummy.DevSpace -ceq $dummy.Bridge) { throw 'Dummy collision.' }
    foreach ($selected in @('DevSpace','Bridge')) {
        $path = $paths[$selected]
        $stage = 1
        if (Test-SecureMcpRuntimeKey -SecretPath $path) { throw 'Missing check failed.' }
        $failed = $false
        try { Resolve-SecureMcpRuntimeKey -SecretPath $path | Out-Null } catch { $failed = $_.Exception.Message -match 'SET_Secure_MCP_Runtime_API_Keys.bat' }
        if (-not $failed) { throw 'Missing resolution must fail without prompt.' }
        $secret = ConvertTo-SecureString $dummy[$selected] -AsPlainText -Force
        Save-SecureMcpRuntimeKey -Secret $secret -SecretPath $path
        $stage = 2
        if ((Load-SecureMcpRuntimeKey -SecretPath $path) -cne $dummy[$selected]) { throw 'Roundtrip failed.' }
        if (-not (Test-SecureMcpRuntimeKey -SecretPath $path)) { throw 'Check failed.' }
        $ciphertext = [IO.File]::ReadAllBytes($path)
        if ([Text.Encoding]::Unicode.GetString($ciphertext).Contains($dummy[$selected])) { throw 'Ciphertext boundary failed.' }
        Save-SecureMcpRuntimeKey -Secret $secret -SecretPath $path
        $secret.Dispose(); $secret = $null
        if ((Resolve-SecureMcpRuntimeKey -SecretPath $path) -cne $dummy[$selected]) { throw 'Atomic replacement failed.' }
    }
    $stage = 3
    if ((Load-SecureMcpRuntimeKey -SecretPath $paths.Bridge) -ceq $dummy.DevSpace -or (Load-SecureMcpRuntimeKey -SecretPath $paths.DevSpace) -ceq $dummy.Bridge) { throw 'Cross-store separation failed.' }
    $override = [Guid]::NewGuid().ToString('N')
    $env:CONTROL_PLANE_API_KEY = $override
    [IO.File]::WriteAllBytes($paths.DevSpace, (New-Object byte[] 4))
    if ((Resolve-SecureMcpRuntimeKey -SecretPath $paths.DevSpace) -cne $override) { throw 'Env precedence failed.' }
    $env:CONTROL_PLANE_API_KEY = $null
    if (Test-SecureMcpRuntimeKey -SecretPath $paths.DevSpace) { throw 'Corruption must fail closed.' }
    $failed = $false
    try { Load-SecureMcpRuntimeKey -SecretPath $paths.DevSpace | Out-Null } catch { $failed = $_.Exception.Message -match 'store unavailable' }
    if (-not $failed) { throw 'Corrupt load must fail bounded.' }
    # Staged helper maps only to the two temporary files. No real secret path is used.
    Remove-Item -LiteralPath $paths.DevSpace,$paths.Bridge -Force
    $helper = Get-Content -Raw (Join-Path $repo 'ops\windows\recovery\SecureMcpRuntimeKey.ps1')
    foreach ($selected in @('DevSpace','Bridge')) { $helper = $helper.Replace((Get-SecureMcpRuntimeKeyPath -Purpose $selected), $paths[$selected]) }
    [IO.File]::WriteAllText((Join-Path $directory 'SecureMcpRuntimeKey.ps1'), $helper)
    Copy-Item -LiteralPath (Join-Path $repo 'ops\windows\recovery\SetSecureMcpRuntimeKey.ps1') -Destination $directory
    $stage = 4
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -SetterHarnessDirectory $directory *> $null
    if ($LASTEXITCODE -ne 0) { $stage = '4.' + $LASTEXITCODE; throw 'Independent setter/preservation checks failed.' }
    [IO.File]::WriteAllBytes($paths.DevSpace, (New-Object byte[] 4))
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $directory 'SetSecureMcpRuntimeKey.ps1') -Purpose DevSpace -IfMissing *> $null
    if ($LASTEXITCODE -eq 0) { throw 'Setter must reject corrupt existing store.' }
    $stage = 5
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
        if ((Split-Path $directory -Parent) -ne $repo -or (Split-Path $directory -Leaf) -notlike '.dpapi-test-*') { throw 'Unsafe test cleanup path.' }
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
}
