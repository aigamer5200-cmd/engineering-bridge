param(
    [string]$SystemRoot = 'D:\Engineering_Bridge_System',
    [switch]$OwnerIWApproved
)
$ErrorActionPreference = 'Stop'
if (-not $OwnerIWApproved) { throw 'Requires separate Owner I/W authorization.' }
$names = @(
    '00_總啟動_開發雙通道.bat',
    '01_總關閉_開發雙通道.bat',
    '02_總重啟_開發雙通道.bat',
    '90_檢查_全部通道狀態.bat',
    '91_設定_Secure_MCP_Runtime_API_Keys.bat',
    '99_Engineering_Recovery.bat'
)
$obsolete = @('HANDOFF_BRIDGE_SECURE_MCP_CURRENT_STATUS.md', 'HANDOFF_BRIDGE_SECURE_MCP_TUNNEL_20261006.md')
$source = Join-Path $PSScriptRoot 'operator-root'
$root = Get-Item -LiteralPath $SystemRoot
if (-not $root.PSIsContainer) { throw 'System root must exist.' }
$SystemRoot = $root.FullName
# Reject redirected ancestors before any mutation, including backup destinations.
function AssertPlainPath([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Reparse points are not supported.'
            }
        }
        $cursor = Split-Path -Parent $cursor
    }
}
AssertPlainPath $SystemRoot
AssertPlainPath $source
$sourceFiles = @(Get-ChildItem -LiteralPath $source -Force)
if ($sourceFiles.Count -ne 6 -or @(Compare-Object $names $sourceFiles.Name).Count) { throw 'Unexpected source wrapper set.' }
$hashes = @{}
foreach ($name in $names) {
    $path = Join-Path $source $name
    AssertPlainPath $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Wrapper must be a file.' }
    $hashes[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
if (-not (Test-Path -LiteralPath (Join-Path $SystemRoot 'control') -PathType Container)) { throw 'Canonical control directory missing.' }
$oldFiles = @(Get-ChildItem -LiteralPath $SystemRoot -File -Force | Where-Object {
    $_.Extension -ieq '.bat' -or $_.Name -in $obsolete
})
foreach ($file in $oldFiles) { AssertPlainPath $file.FullName }
foreach ($name in @($names) + @($obsolete)) {
    $path = Join-Path $SystemRoot $name
    if (Test-Path -LiteralPath $path -PathType Container) { throw 'Root filename collides with a directory.' }
}
$backup = Join-Path $SystemRoot ('runtime\painless-upgrade\owner-root-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N'))
AssertPlainPath $backup
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($file in $oldFiles) {
    $copy = Join-Path $backup $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination $copy
    if ((Get-FileHash -LiteralPath $copy).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw 'Backup verification failed; root unchanged.' }
}
try {
    # Direct files only; never recurse or modify control/runtime binaries.
    foreach ($file in $oldFiles) { Remove-Item -LiteralPath $file.FullName -Force }
    foreach ($name in $names) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $SystemRoot $name)
    }
    $actual = @(Get-ChildItem -LiteralPath $SystemRoot -File -Force | Where-Object { $_.Extension -ieq '.bat' })
    if ($actual.Count -ne 6 -or @(Compare-Object $names $actual.Name).Count) { throw 'Root wrapper set verification failed.' }
    foreach ($name in $names) {
        if ((Get-FileHash -LiteralPath (Join-Path $SystemRoot $name)).Hash -ne $hashes[$name]) { throw 'Wrapper hash verification failed.' }
    }
    foreach ($name in $obsolete) {
        if (Test-Path -LiteralPath (Join-Path $SystemRoot $name)) { throw 'Obsolete handoff remains.' }
    }
} catch {
    # Restore the pre-run root surface; retain backup even on failure.
    foreach ($name in $names) {
        $path = Join-Path $SystemRoot $name
        if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    }
    foreach ($file in $oldFiles) { Copy-Item -LiteralPath (Join-Path $backup $file.Name) -Destination $file.FullName -Force }
    throw
}
Write-Output "Owner root verified; rollback backup: $backup"
