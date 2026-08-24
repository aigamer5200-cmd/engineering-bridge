param(
    [switch]$Once,
    [switch]$ForceSessionRecovery,
    [switch]$NoBrowser,
    [int]$IntervalSeconds = 15,
    [int]$FailureThreshold = 3,
    [int]$CooldownSeconds = 60
)

$ErrorActionPreference = "Stop"

$SystemRoot = "D:\Engineering_Bridge_System"
$ControlRoot = Join-Path $SystemRoot "control"
$RuntimeRoot = Join-Path $SystemRoot "runtime"
$LogRoot = Join-Path $RuntimeRoot "logs"
$LogFile = Join-Path $LogRoot "recovery-watchdog.log"
$PidFile = Join-Path $RuntimeRoot "recovery-watchdog.pid"
$HandoffFile = Join-Path $RuntimeRoot "recovery-handoff.txt"
$StateFile = Join-Path $RuntimeRoot "recovery-state.json"
$OpenRecoveryScript = Join-Path $ControlRoot "OPEN_CHATGPT_RECOVERY.ps1"
$StartDs = Join-Path $ControlRoot "START_DS_CHANNEL.bat"
$RestartDs = Join-Path $ControlRoot "RESTART_DS_CHANNEL.bat"
$RestartBridge = Join-Path $ControlRoot "RESTART_BRIDGE_CHANNEL.bat"
$AuthReady = Join-Path $RuntimeRoot "PUBLIC_AUTH_READY.flag"
$TunnelToken = Join-Path $RuntimeRoot "secrets\cloudflared-bridge-token.txt"
$DsMaintenance = Join-Path $RuntimeRoot "maintenance-devspace.flag"
$BridgeMaintenance = Join-Path $RuntimeRoot "maintenance-bridge.flag"

if (-not (Test-Path $LogRoot)) {
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
}

function Write-RecoveryLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Get-ListenerProcess([int]$Port) {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $connection) {
        return $null
    }

    return Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess)
}

function Test-HttpResponding([string]$Url) {
    try {
        Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 3 -MaximumRedirection 0 -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        # HTTP 4xx/5xx still proves the expected local HTTP service answered.
        if ($null -ne $_.Exception.Response) {
            return $true
        }
        return $false
    }
}

function Get-DsHealth {
    if (Test-Path $DsMaintenance) {
        return [pscustomobject]@{ Healthy = $true; Repairable = $false; Reason = "maintenance-suppressed" }
    }

    $process = Get-ListenerProcess 7677
    if ($null -eq $process) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $true; Reason = "listener-missing" }
    }

    $command = [string]$process.CommandLine
    if (($process.Name -ne "node.exe") -or
        ($command -notmatch "DevSpace\\versions\\[^\\]+\\node_modules\\@waishnav\\devspace\\dist\\cli\.js serve")) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $false; Reason = "unexpected-owner:$($process.ProcessId):$($process.Name)" }
    }

    if (-not (Test-HttpResponding "http://127.0.0.1:7677/")) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $true; Reason = "listener-present-http-unresponsive" }
    }

    return [pscustomobject]@{ Healthy = $true; Repairable = $false; Reason = "ready" }
}

function Get-BridgeHealth {
    if (Test-Path $BridgeMaintenance) {
        return [pscustomobject]@{ Healthy = $true; Repairable = $false; Reason = "maintenance-suppressed" }
    }

    $gateway = Get-ListenerProcess 8768
    if ($null -eq $gateway) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $true; Reason = "gateway-listener-missing" }
    }

    $gatewayCommand = [string]$gateway.CommandLine
    if (($gateway.Name -ne "python.exe") -or
        ($gatewayCommand -notmatch "mcp-stdio\.exe.*serve.*--port 8768")) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $false; Reason = "gateway-unexpected-owner:$($gateway.ProcessId):$($gateway.Name)" }
    }

    if (-not (Test-HttpResponding "http://127.0.0.1:8768/mcp")) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $true; Reason = "gateway-listener-present-http-unresponsive" }
    }

    $tunnelRequired = (Test-Path $AuthReady) -and (Test-Path $TunnelToken)
    if (-not $tunnelRequired) {
        return [pscustomobject]@{ Healthy = $true; Repairable = $false; Reason = "gateway-ready-tunnel-not-required" }
    }

    $tunnel = Get-ListenerProcess 20242
    if ($null -eq $tunnel) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $true; Reason = "tunnel-listener-missing" }
    }

    $tunnelCommand = [string]$tunnel.CommandLine
    if (($tunnel.Name -ne "cloudflared.exe") -or
        ($tunnelCommand -notmatch "--metrics 127\.0\.0\.1:20242")) {
        return [pscustomobject]@{ Healthy = $false; Repairable = $false; Reason = "tunnel-unexpected-owner:$($tunnel.ProcessId):$($tunnel.Name)" }
    }

    return [pscustomobject]@{ Healthy = $true; Repairable = $false; Reason = "ready" }
}

function Get-ChannelHealth {
    return [pscustomobject]@{
        DevSpace = Get-DsHealth
        Bridge = Get-BridgeHealth
    }
}

function Invoke-ControlBat([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Control BAT missing: $Path"
    }

    # Do not use Start-Process -Wait here. On Windows it can wait for the whole
    # descendant process tree; DevSpace intentionally leaves its long-running
    # node.exe child alive, which would deadlock the watchdog after a successful
    # recovery. Wait only for the immediate cmd.exe wrapper to exit.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "cmd.exe"
    $startInfo.Arguments = "/d /c call `"$Path`""
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw "Failed to start control BAT: $Path"
    }

    if (-not $process.WaitForExit(30000)) {
        try { $process.Kill() } catch { }
        throw "Control BAT did not return within 30 seconds: $Path"
    }

    return $process.ExitCode
}

function Write-RecoveryHandoff([string]$Reason, $Before, $After) {
    $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
    $text = @"
Engineering Environment Recovery
Time: $timestamp
Reason: $Reason

Before:
- DevSpace: healthy=$($Before.DevSpace.Healthy), reason=$($Before.DevSpace.Reason)
- Engineering Bridge: healthy=$($Before.Bridge.Healthy), reason=$($Before.Bridge.Reason)

After:
- DevSpace: healthy=$($After.DevSpace.Healthy), reason=$($After.DevSpace.Reason)
- Engineering Bridge: healthy=$($After.Bridge.Healthy), reason=$($After.Bridge.Reason)

Recovery instruction for the new ChatGPT window:
Continue the latest frozen /GOAL and checkpoint in the current project. Do not re-plan already-settled architecture. First recover/verify the authoritative Shoestring GOAL runtime state for the current worktree, then verify DevSpace and Engineering Bridge availability. Treat the previous Bridge task/thread as stale after recovery: do not continue an old task_id; start a fresh run_task so Codex gets a new native thread/session, then resume from the latest accepted checkpoint. If the current project already contains a handoff or frozen GOAL, use that as the authority.

Mandatory TG stop rule: unless the Owner explicitly asks to pause, stop, not continue, or abort, any reason that causes forward execution to stop must proactively notify the Owner through Telegram before yielding or waiting. This includes tool/runtime/Bridge/DS/Codex failures, no-safe-path conditions, unresolved material ambiguity, authorization boundaries, and owner-only decision waits. For a recoverable interruption, use the shared Shoestring GOAL interruption path, notify first, then recover and continue automatically when safe. An explicit Owner-requested pause/stop is exempt from this interruption notification.

核心規則：除非 Owner 明確要求暫停或停止，否則任何原因造成執行流程停下來，都必須先主動用 TG 通知 Owner。
"@

    Set-Content -LiteralPath $HandoffFile -Value $text -Encoding UTF8

    $state = [ordered]@{
        timestamp = $timestamp
        reason = $Reason
        force_new_codex_thread = $true
        devspace_before = @{ healthy = [bool]$Before.DevSpace.Healthy; reason = [string]$Before.DevSpace.Reason }
        bridge_before = @{ healthy = [bool]$Before.Bridge.Healthy; reason = [string]$Before.Bridge.Reason }
        devspace_after = @{ healthy = [bool]$After.DevSpace.Healthy; reason = [string]$After.DevSpace.Reason }
        bridge_after = @{ healthy = [bool]$After.Bridge.Healthy; reason = [string]$After.Bridge.Reason }
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Open-RecoveryWindow {
    if ($NoBrowser) {
        return
    }
    if (-not (Test-Path $OpenRecoveryScript)) {
        Write-RecoveryLog "WARN open-recovery-script-missing path=$OpenRecoveryScript"
        return
    }

    Write-RecoveryLog "ACTION open-recovery-window"
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$OpenRecoveryScript`""
    ) -WindowStyle Hidden | Out-Null
    Write-RecoveryLog "RESULT open-recovery-window launched"
}

function Repair-DevSpace([string]$Reason) {
    $bat = if ($Reason -eq "listener-missing") { $StartDs } else { $RestartDs }
    $action = if ($Reason -eq "listener-missing") { "devspace-start" } else { "devspace-restart" }
    Write-RecoveryLog "ACTION $action reason=$Reason"
    $rc = Invoke-ControlBat $bat
    Write-RecoveryLog "RESULT $action exit=$rc"
    return $rc
}

function Repair-Bridge {
    Write-RecoveryLog "ACTION bridge-restart"
    $rc = Invoke-ControlBat $RestartBridge
    Write-RecoveryLog "RESULT bridge-restart exit=$rc"
    return $rc
}

$mutex = $null
$ownsMutex = $false
$lastRecovery = [datetime]::MinValue

try {
    if (-not $Once -and -not $ForceSessionRecovery) {
        $mutex = New-Object System.Threading.Mutex($false, "Local\EngineeringBridgeSystemRecoveryWatchdog")
        $ownsMutex = $mutex.WaitOne(0)
        if (-not $ownsMutex) {
            exit 0
        }
        Set-Content -LiteralPath $PidFile -Value $PID -Encoding ASCII
    }

    Write-RecoveryLog "START once=$Once forceSession=$ForceSessionRecovery interval=$IntervalSeconds threshold=$FailureThreshold cooldown=$CooldownSeconds"

    $dsFailures = 0
    $bridgeFailures = 0

    while ($true) {
        $before = Get-ChannelHealth

        if ($before.DevSpace.Healthy) { $dsFailures = 0 } else { $dsFailures++ }
        if ($before.Bridge.Healthy) { $bridgeFailures = 0 } else { $bridgeFailures++ }

        $forceNow = [bool]$ForceSessionRecovery
        $repairDs = (-not $before.DevSpace.Healthy) -and $before.DevSpace.Repairable -and ($forceNow -or $dsFailures -ge $FailureThreshold)
        $repairBridge = (-not $before.Bridge.Healthy) -and $before.Bridge.Repairable -and ($forceNow -or $bridgeFailures -ge $FailureThreshold)
        $blockedDs = (-not $before.DevSpace.Healthy) -and (-not $before.DevSpace.Repairable)
        $blockedBridge = (-not $before.Bridge.Healthy) -and (-not $before.Bridge.Repairable)

        if ($blockedDs) {
            Write-RecoveryLog "FAIL_CLOSED devspace reason=$($before.DevSpace.Reason)"
        }
        if ($blockedBridge) {
            Write-RecoveryLog "FAIL_CLOSED bridge reason=$($before.Bridge.Reason)"
        }

        $cooldownReady = ((Get-Date) - $lastRecovery).TotalSeconds -ge $CooldownSeconds
        $performedRecovery = $false

        if ($forceNow -or (($repairDs -or $repairBridge) -and $cooldownReady)) {
            Write-RecoveryLog "RECOVERY_BEGIN ds=$($before.DevSpace.Reason) bridge=$($before.Bridge.Reason) force=$forceNow"

            if ($repairDs) {
                [void](Repair-DevSpace $before.DevSpace.Reason)
            }
            if ($repairBridge) {
                [void](Repair-Bridge)
            }

            Start-Sleep -Seconds 2
            $after = Get-ChannelHealth
            $reason = if ($forceNow -and $before.DevSpace.Healthy -and $before.Bridge.Healthy) {
                "client-session-recovery-services-were-healthy"
            } elseif ($forceNow) {
                "forced-session-recovery-with-service-repair"
            } else {
                "automatic-service-recovery"
            }

            Write-RecoveryHandoff -Reason $reason -Before $before -After $after
            Write-RecoveryLog "RECOVERY_END ds=$($after.DevSpace.Reason) bridge=$($after.Bridge.Reason)"
            $lastRecovery = Get-Date
            $performedRecovery = $true

            if ($after.DevSpace.Healthy -and $after.Bridge.Healthy) {
                Open-RecoveryWindow
            } else {
                Write-RecoveryLog "RECOVERY_INCOMPLETE browser-not-opened"
            }

            $dsFailures = 0
            $bridgeFailures = 0
        }

        if ($Once -or $ForceSessionRecovery) {
            if (-not $performedRecovery) {
                $after = Get-ChannelHealth
                Write-RecoveryHandoff -Reason "health-check-only" -Before $before -After $after
            }
            break
        }

        Start-Sleep -Seconds ([Math]::Max(5, $IntervalSeconds))
    }
}
catch {
    Write-RecoveryLog "ERROR $($_.Exception.Message)"
    throw
}
finally {
    if ($ownsMutex -and $null -ne $mutex) {
        try { $mutex.ReleaseMutex() } catch { }
        $mutex.Dispose()
    }
    if (Test-Path $PidFile) {
        try {
            $pidText = (Get-Content -LiteralPath $PidFile -ErrorAction Stop | Select-Object -First 1).Trim()
            if ($pidText -eq [string]$PID) {
                Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
            }
        } catch { }
    }
    Write-RecoveryLog "STOP"
}
