param(
    [ValidateRange(5, 180)]
    [int]$TimeoutSeconds = 45,
    [ValidateRange(1, 30)]
    [int]$StableSeconds = 8
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ports = @(7677, 7679, 7688, 7689, 8768, 18080, 18081, 20242)

function Get-ResidualProcesses {
    $rows = @()
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        $name = [string]$process.Name
        $cmd = [string]$process.CommandLine
        $match = $false

        if ($name -eq "tunnel-client.exe" -and
            $cmd -match "run\s+--profile\s+(devspace-canary|engineering-bridge)") {
            $match = $true
        } elseif ($name -eq "cloudflared.exe" -and
            $cmd -match "--metrics\s+127\.0\.0\.1:20242") {
            $match = $true
        } elseif (($name -eq "python.exe" -or $name -eq "mcp-stdio.exe") -and
            $cmd -match "mcp-stdio\.exe.*serve.*--port\s+8768") {
            $match = $true
        } elseif ($name -eq "node.exe" -and (
            $cmd -match "D:\\Engineering_Bridge_System\\DevSpace\\devspace_development_guard_proxy\.mjs" -or
            $cmd -match "D:\\Engineering_Bridge_System\\DevSpace\\versions\\.+\\node_modules\\@waishnav\\devspace\\dist\\cli\.js serve" -or
            $cmd -match "D:\\Engineering_Bridge_System\\DevSpace\\canary\\secure-tunnel-beta\\source\\bin\\devspace\.js serve"
        )) {
            $match = $true
        } elseif (($name -eq "powershell.exe" -or $name -eq "pwsh.exe") -and
            $cmd -match "engineering_recovery_watchdog\.ps1") {
            $match = $true
        }

        if ($match) {
            $rows += [pscustomobject]@{
                Pid = [int]$process.ProcessId
                Name = $name
                CommandLine = $cmd
            }
        }
    }
    return @($rows)
}

function Get-StopState {
    $listeners = @(
        foreach ($port in $ports) {
            foreach ($connection in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
                [pscustomobject]@{
                    Port = $port
                    Pid = [int]$connection.OwningProcess
                }
            }
        }
    )

    $processes = @(Get-ResidualProcesses)
    $cloudflaredService = Get-Service -Name Cloudflared -ErrorAction SilentlyContinue
    $serviceStopped = ($null -eq $cloudflaredService -or $cloudflaredService.Status -eq "Stopped")

    return [pscustomobject]@{
        Clean = ($listeners.Count -eq 0 -and $processes.Count -eq 0 -and $serviceStopped)
        Listeners = $listeners
        Processes = $processes
        CloudflaredService = if ($null -eq $cloudflaredService) { "ABSENT" } else { [string]$cloudflaredService.Status }
    }
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$stableSince = $null
$last = $null

while ([DateTime]::UtcNow -lt $deadline) {
    $last = Get-StopState
    if ($last.Clean) {
        if ($null -eq $stableSince) {
            $stableSince = [DateTime]::UtcNow
        }
        if (([DateTime]::UtcNow - $stableSince).TotalSeconds -ge $StableSeconds) {
            Write-Host ("Clean stopped state stable for {0}s." -f $StableSeconds)
            exit 0
        }
    } else {
        $stableSince = $null
    }
    Start-Sleep -Milliseconds 500
}

Write-Host "[FAIL] Timed out waiting for all Engineering channels to remain stopped."
if ($null -ne $last) {
    Write-Host ("Cloudflared service: {0}" -f $last.CloudflaredService)
    foreach ($listener in @($last.Listeners)) {
        Write-Host ("Listener remains: port={0} pid={1}" -f $listener.Port, $listener.Pid)
    }
    foreach ($process in @($last.Processes)) {
        Write-Host ("Process remains: pid={0} name={1} cmd={2}" -f $process.Pid, $process.Name, $process.CommandLine)
    }
}
exit 1
