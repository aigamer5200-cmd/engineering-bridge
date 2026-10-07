param(
    [Parameter(Mandatory = $true)][string]$Runner,
    [string]$LogPath
)
$ErrorActionPreference = 'Stop'
# Paths only: never pass keys or token values to this launcher.
foreach ($path in @($Runner, $LogPath)) {
    if ($path -and ($path -match '["%\r\n]' -or -not [IO.Path]::IsPathRooted($path))) {
        throw 'Runner/log paths must be absolute and safe for cmd quoting.'
    }
}
if (-not (Test-Path -LiteralPath $Runner -PathType Leaf) -or
    [IO.Path]::GetExtension($Runner) -ne '.bat') { throw 'BAT runner missing.' }
$redirect = '>nul 2>&1'
if ($LogPath) { $redirect = '>> "' + $LogPath + '" 2>&1' }
$arguments = '/d /s /c "call "' + $Runner + '" ' + $redirect + '"'
# No -Wait: service descendants must outlive this short launcher process.
Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory (Split-Path -Parent $Runner) -ErrorAction Stop
exit 0
