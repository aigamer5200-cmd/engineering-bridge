param(
    [Parameter(Mandatory = $true)]
    [string]$ControlRoot,
    [string]$UrlFile = "D:\Engineering_Bridge_System\runtime\chatgpt-recovery-url.txt",
    [switch]$NoBrowser,
    [switch]$AutoSubmit
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath $ControlRoot).Path
$pointer = Join-Path $root "CURRENT_HANDOFF"
$bootstrap = Join-Path $root "NEXT_WINDOW_BOOTSTRAP.txt"
$opener = "D:\Engineering_Bridge_System\control\OPEN_CHATGPT_RECOVERY.ps1"

if (-not (Test-Path $pointer)) {
    throw "CURRENT_HANDOFF not found: $pointer"
}
if (-not (Test-Path $bootstrap)) {
    throw "NEXT_WINDOW_BOOTSTRAP.txt not found: $bootstrap"
}
if (-not (Test-Path $opener)) {
    throw "ChatGPT opener not found: $opener"
}

$relative = (Get-Content -LiteralPath $pointer -ErrorAction Stop | Select-Object -First 1).Trim()
if (-not $relative) {
    throw "CURRENT_HANDOFF is empty"
}

$handoff = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
$rootWithSeparator = $root.TrimEnd('\') + '\'
if (($handoff -ne $root) -and (-not $handoff.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "CURRENT_HANDOFF escapes ControlRoot"
}
if (-not (Test-Path $handoff)) {
    throw "Referenced handoff not found: $handoff"
}

$openerArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $opener,
    "-UrlFile", $UrlFile
)

$payloadFile = $null
if ($AutoSubmit) {
    $payloadFile = [System.IO.Path]::GetTempFileName()
    $bootstrapText = Get-Content -LiteralPath $bootstrap -Raw -ErrorAction Stop
    $handoffText = Get-Content -LiteralPath $handoff -Raw -ErrorAction Stop
    $payload = @"
$bootstrapText

--- AUTHORITATIVE HANDOFF TRANSPORT COPY ---
Source: $handoff
The durable handoff file named above remains the sole authority. The text below
is a verbatim transport copy created only so this fresh browser session can
continue without separately reading a machine-local runtime path.

$handoffText
--- END AUTHORITATIVE HANDOFF TRANSPORT COPY ---
"@
    Set-Content -LiteralPath $payloadFile -Value $payload -Encoding UTF8
    $openerArgs += @("-ClipboardFile", $payloadFile)
} else {
    $openerArgs += @("-ClipboardFile", $bootstrap)
}
if ($NoBrowser) {
    $openerArgs += "-NoBrowser"
}
if ($AutoSubmit) {
    $openerArgs += "-AutoSubmit"
}
try {
    & powershell.exe @openerArgs
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if ($payloadFile -and (Test-Path $payloadFile)) {
        Remove-Item -LiteralPath $payloadFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "GOAL rollover window opened."
Write-Host "Authority: $handoff"
if ($AutoSubmit) {
    Write-Host "Bootstrap + authoritative handoff transport copy auto-submitted."
} else {
    Write-Host "Bootstrap copied from: $bootstrap"
}
