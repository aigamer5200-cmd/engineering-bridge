param(
    [string]$ClipboardFile = "",
    [string]$UrlFile = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$RuntimeRoot = "D:\Engineering_Bridge_System\runtime"
$DefaultUrlFile = Join-Path $RuntimeRoot "chatgpt-recovery-url.txt"
$DefaultClipboardFile = Join-Path $RuntimeRoot "recovery-handoff.txt"
$DefaultUrl = "https://chatgpt.com/"

if (-not $UrlFile) {
    $UrlFile = $DefaultUrlFile
}
if (-not $ClipboardFile) {
    $ClipboardFile = $DefaultClipboardFile
}

$url = $DefaultUrl
if (Test-Path $UrlFile) {
    $configured = (Get-Content -LiteralPath $UrlFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($configured -match '^https://chatgpt\.com/') {
        $url = $configured
    }
}

if (Test-Path $ClipboardFile) {
    try {
        Get-Content -LiteralPath $ClipboardFile -Raw | Set-Clipboard
    } catch {
        # Clipboard support is best-effort; opening the recovery window is still useful.
    }
}

if ($NoBrowser) {
    exit 0
}

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path $_) }

$chrome = $chromeCandidates | Select-Object -First 1
if ($chrome) {
    Start-Process -FilePath $chrome -ArgumentList @("--new-window", $url) | Out-Null
} else {
    Start-Process $url | Out-Null
}
