$ErrorActionPreference = "Stop"

$RuntimeRoot = "D:\Engineering_Bridge_System\runtime"
$UrlFile = Join-Path $RuntimeRoot "chatgpt-recovery-url.txt"
$HandoffFile = Join-Path $RuntimeRoot "recovery-handoff.txt"
$DefaultUrl = "https://chatgpt.com/"

$url = $DefaultUrl
if (Test-Path $UrlFile) {
    $configured = (Get-Content -LiteralPath $UrlFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($configured -match '^https://chatgpt\.com/') {
        $url = $configured
    }
}

if (Test-Path $HandoffFile) {
    try {
        Get-Content -LiteralPath $HandoffFile -Raw | Set-Clipboard
    } catch {
        # Clipboard support is best-effort; opening the recovery window is still useful.
    }
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
