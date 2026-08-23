param(
    [string]$ClipboardFile = "",
    [string]$UrlFile = "",
    [switch]$NoBrowser,
    [switch]$AutoSubmit,
    [int]$AutoSubmitTimeoutSeconds = 25
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

if ($AutoSubmitTimeoutSeconds -lt 5 -or $AutoSubmitTimeoutSeconds -gt 120) {
    throw "AutoSubmitTimeoutSeconds must be between 5 and 120"
}

if ($AutoSubmit -and $NoBrowser) {
    throw "AutoSubmit cannot be used with NoBrowser"
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

$autoSubmitText = $null
if ($AutoSubmit) {
    if (-not (Test-Path $ClipboardFile)) {
        throw "AutoSubmit requires ClipboardFile: $ClipboardFile"
    }
    $autoSubmitText = Get-Content -LiteralPath $ClipboardFile -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($autoSubmitText)) {
        throw "AutoSubmit requires non-empty ClipboardFile"
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
    if ($AutoSubmit) {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ChatGptWindowNative {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

        $beforeHandles = @{}
        $beforeWindows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition
        )
        foreach ($window in $beforeWindows) {
            if ($window.Current.ClassName -eq "Chrome_WidgetWin_1") {
                $beforeHandles[[int]$window.Current.NativeWindowHandle] = $true
            }
        }
    }

    Start-Process -FilePath $chrome -ArgumentList @("--new-window", $url) | Out-Null

    if ($AutoSubmit) {
        $deadline = (Get-Date).AddSeconds($AutoSubmitTimeoutSeconds)
        $targetWindow = $null
        $composer = $null

        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
            $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
                [System.Windows.Automation.TreeScope]::Children,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            $candidates = @()
            foreach ($window in $windows) {
                $handle = [int]$window.Current.NativeWindowHandle
                if (($window.Current.ClassName -ne "Chrome_WidgetWin_1") -or $beforeHandles.ContainsKey($handle)) {
                    continue
                }
                if ($window.Current.Name -notmatch "ChatGPT") {
                    continue
                }
                $candidates += $window
            }
            if ($candidates.Count -eq 1) {
                $targetWindow = $candidates[0]
                break
            }
        }

        if ($null -eq $targetWindow) {
            throw "AutoSubmit could not uniquely locate the new ChatGPT window before timeout"
        }

        $targetHandle = [IntPtr]([int]$targetWindow.Current.NativeWindowHandle)
        [ChatGptWindowNative]::ShowWindowAsync($targetHandle, 9) | Out-Null
        [ChatGptWindowNative]::SetForegroundWindow($targetHandle) | Out-Null

        $composerDeadline = (Get-Date).AddSeconds($AutoSubmitTimeoutSeconds)
        while ((Get-Date) -lt $composerDeadline) {
            Start-Sleep -Milliseconds 200
            $edits = $targetWindow.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                (New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                ))
            )
            $composerCandidates = @()
            foreach ($edit in $edits) {
                if ([string]$edit.Current.ClassName -like "ProseMirror*") {
                    $composerCandidates += $edit
                }
            }
            if ($composerCandidates.Count -eq 1) {
                $composer = $composerCandidates[0]
                break
            }
        }
        if ($null -eq $composer) {
            throw "AutoSubmit could not uniquely locate the new ChatGPT composer after foreground activation"
        }

        $valuePatternObject = $null
        if (-not $composer.TryGetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern,
            [ref]$valuePatternObject
        )) {
            throw "AutoSubmit composer does not support ValuePattern"
        }
        $valuePattern = [System.Windows.Automation.ValuePattern]$valuePatternObject
        $valuePattern.SetValue($autoSubmitText)
        $submittedComposerValue = $valuePattern.Current.Value
        if ([string]::IsNullOrWhiteSpace($submittedComposerValue)) {
            throw "AutoSubmit composer did not retain the submitted payload before send"
        }

        $submitButton = $null
        $buttonDeadline = (Get-Date).AddSeconds([Math]::Min(10, $AutoSubmitTimeoutSeconds))
        while ((Get-Date) -lt $buttonDeadline) {
            Start-Sleep -Milliseconds 100
            $buttons = $targetWindow.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                (New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Button
                ))
            )
            $matchingButtons = @()
            foreach ($button in $buttons) {
                if ($button.Current.ClassName -like "*composer-submit-btn*") {
                    $matchingButtons += $button
                }
            }
            if ($matchingButtons.Count -eq 1) {
                $submitButton = $matchingButtons[0]
                break
            }
        }
        if ($null -eq $submitButton) {
            throw "AutoSubmit could not uniquely locate the submit button after filling the composer"
        }

        $invokePatternObject = $null
        if (-not $submitButton.TryGetCurrentPattern(
            [System.Windows.Automation.InvokePattern]::Pattern,
            [ref]$invokePatternObject
        )) {
            throw "AutoSubmit submit button does not support InvokePattern"
        }
        $invokePattern = [System.Windows.Automation.InvokePattern]$invokePatternObject

        $sendDeadline = (Get-Date).AddSeconds([Math]::Min(10, $AutoSubmitTimeoutSeconds))
        while ((Get-Date) -lt $sendDeadline -and -not $submitButton.Current.IsEnabled) {
            Start-Sleep -Milliseconds 100
        }
        if (-not $submitButton.Current.IsEnabled) {
            throw "AutoSubmit submit button did not become enabled"
        }

        $invokePattern.Invoke()

        $verified = $false
        $verifyDeadline = (Get-Date).AddSeconds([Math]::Min(10, $AutoSubmitTimeoutSeconds))
        while ((Get-Date) -lt $verifyDeadline) {
            Start-Sleep -Milliseconds 100
            try {
                $currentComposerValue = $valuePattern.Current.Value
                if (
                    [string]::IsNullOrWhiteSpace($currentComposerValue) -or
                    ($currentComposerValue -ne $submittedComposerValue)
                ) {
                    $verified = $true
                    break
                }
            } catch {
                # The composer may be replaced after submit; either way the old
                # element is no longer carrying the submitted bootstrap.
                $verified = $true
                break
            }
        }
        if (-not $verified) {
            throw "AutoSubmit could not verify that the submitted payload left the composer"
        }

        Write-Host "ChatGPT bootstrap auto-submitted."
        Write-Host "Window handle: $($targetWindow.Current.NativeWindowHandle)"
    }
} else {
    if ($AutoSubmit) {
        throw "AutoSubmit requires Google Chrome so the new window can be targeted safely"
    }
    Start-Process $url | Out-Null
}
