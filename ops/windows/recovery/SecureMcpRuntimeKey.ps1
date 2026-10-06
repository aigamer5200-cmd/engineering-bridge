# Generic local-only credential helper; callers must select a purpose/path. Never emit secret-bearing diagnostics.
function Get-SecureMcpRuntimeKeyPath {
    param([Parameter(Mandatory)][ValidateSet('DevSpace', 'Bridge')][string]$Purpose)
    switch ($Purpose) {
        'DevSpace' { return 'D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-devspace-runtime-api-key.dpapi' }
        'Bridge' { return 'D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-bridge-runtime-api-key.dpapi' }
    }
}

function Assert-SecureMcpKeyPath([string]$SecretPath) {
    if ($env:OS -ne 'Windows_NT' -or $SecretPath -notmatch '^[A-Za-z]:\\') {
        throw 'Runtime key store requires a local Windows drive path.'
    }
    # Reserve the secure-mcp namespace for the two unambiguous canonical stores.
    $storeName = [IO.Path]::GetFileName($SecretPath)
    if ($storeName -like 'secure-mcp-*' -and $storeName -notmatch '^secure-mcp-(devspace|bridge)-runtime-api-key\.dpapi$') {
        throw 'Ambiguous legacy store is obsolete and forbidden; select DevSpace or Bridge.'
    }
    Add-Type -AssemblyName System.Security -ErrorAction Stop
}

function Set-SecureMcpKeyAcl([string]$Path, [bool]$Directory = $false) {
    try {
        $acl = if ($Directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
        $acl.SetAccessRuleProtection($true, $false)
        $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $identities = @($user, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
        foreach ($identity in $identities) {
            $rule = if ($Directory) {
                New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            } else {
                New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
            }
            $acl.AddAccessRule($rule)
        }
        if ($Directory) { [System.IO.Directory]::SetAccessControl($Path, $acl) }
        else { [System.IO.File]::SetAccessControl($Path, $acl) }
    } catch {
        Write-Warning 'Runtime key ACL hardening unavailable; DPAPI CurrentUser encryption remains required.'
    }
}

function Save-SecureMcpRuntimeKey {
    param([Parameter(Mandatory)][Security.SecureString]$Secret,
          [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$SecretPath)
    $buffer = $null
    $bstr = [IntPtr]::Zero
    $temporary = $null
    try {
        Assert-SecureMcpKeyPath $SecretPath
        if ($Secret.Length -eq 0) { throw 'Empty credential.' }
        $parent = Split-Path -Parent $SecretPath
        [System.IO.Directory]::CreateDirectory($parent) | Out-Null
        Set-SecureMcpKeyAcl $parent $true
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
        $buffer = New-Object byte[] ($Secret.Length * 2)
        [Runtime.InteropServices.Marshal]::Copy($bstr, $buffer, 0, $buffer.Length)
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($buffer, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $temporary = Join-Path $parent ([System.IO.Path]::GetRandomFileName())
        [System.IO.File]::WriteAllBytes($temporary, $encrypted)
        Set-SecureMcpKeyAcl $temporary
        # Same-directory rename/replace: readers see either complete old or new ciphertext.
        if ([System.IO.File]::Exists($SecretPath)) {
            [System.IO.File]::Replace($temporary, $SecretPath, [NullString]::Value)
        } else {
            [System.IO.File]::Move($temporary, $SecretPath)
        }
        Set-SecureMcpKeyAcl $SecretPath
    } catch {
        throw 'Runtime API key encrypted save failed; no plaintext was persisted.'
    } finally {
        if ($null -ne $buffer) { [Array]::Clear($buffer, 0, $buffer.Length) }
        if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if ($temporary -and [System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
    }
}

function Load-SecureMcpRuntimeKey {
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$SecretPath)
    $buffer = $null
    try {
        Assert-SecureMcpKeyPath $SecretPath
        if (-not [System.IO.File]::Exists($SecretPath)) { return $null }
        $encrypted = [System.IO.File]::ReadAllBytes($SecretPath)
        $buffer = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $value = [System.Text.Encoding]::Unicode.GetString($buffer)
        if ([string]::IsNullOrWhiteSpace($value)) { throw 'Empty credential.' }
        return $value
    } catch {
        throw 'Runtime API key store unavailable for this Windows user. Run SET_Secure_MCP_Runtime_API_Keys.bat once as the controller user.'
    } finally {
        $value = $null
        if ($null -ne $buffer) { [Array]::Clear($buffer, 0, $buffer.Length) }
    }
}

function Test-SecureMcpRuntimeKey {
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$SecretPath)
    try { return $null -ne (Load-SecureMcpRuntimeKey -SecretPath $SecretPath) }
    catch { return $false }
}

function Resolve-SecureMcpRuntimeKey {
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$SecretPath)
    $explicitKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY', 'Process')
    if ($null -ne $explicitKey) {
        if ([string]::IsNullOrWhiteSpace($explicitKey)) { throw 'Explicit CONTROL_PLANE_API_KEY is empty.' }
        return $explicitKey
    }
    $storedKey = Load-SecureMcpRuntimeKey -SecretPath $SecretPath
    if ($null -ne $storedKey) { return $storedKey }
    throw 'Runtime API key missing. Run SET_Secure_MCP_Runtime_API_Keys.bat once as the controller user; normal Start never prompts.'
}
