# HANDOFF — Engineering Bridge Dedicated Secure MCP Tunnel

Date: 2026-10-06
Status: PRODUCTION I/W COMPLETED — dedicated Bridge Secure MCP Green connector, Codex E2E, stop/start/reconnect, rollback, master-launcher integration, and post-sync production smoke all passed; Green and Blue remain live in parallel

## Repo / branch / WT

```text
repo = D:\Engineering_Bridge_System\engineering-bridge
worktree = D:\WORKTREE_ZONE\engineering-bridge-fe7838c8
branch = feat/bridge-secure-mcp-tunnel
base = main/origin-main@524caca1dbd969cbb43816e3e380bacf5b89dc21
rebased candidate commit = 2530854
pre-rebase backup ref = backup/bridge-secure-mcp-aa7321f-20261006 -> aa7321f
```

This handoff plus repository/runtime state is sufficient for a fresh Web GPT,
DS, or Codex session. No prior native Codex thread is required.

## Architecture boundary

Target Green:

```text
ChatGPT Web
-> OpenAI Secure MCP Tunnel
-> local STDIO Engineering Bridge
-> codex app-server --stdio
-> Codex
```

Blue rollback remains:

```text
ChatGPT
-> Cloudflare
-> mcp-stdio HTTP/OAuth gateway :8768
-> local STDIO Engineering Bridge
-> codex app-server --stdio
-> Codex
```

The Secure MCP Tunnel replaces only Web GPT -> Bridge ingress. Bridge -> Codex
remains the existing local native STDIO/app-server path.

## Reconcile completed

- Fetched current origin/upstream before reconciling.
- Confirmed current main/origin-main is exactly
  `524caca1dbd969cbb43816e3e380bacf5b89dc21`.
- Confirmed old candidate was `aa7321f` and divergence was main +2 / candidate
  +1.
- Preserved the old candidate as local backup ref
  `backup/bridge-secure-mcp-aa7321f-20261006`.
- Rebased `feat/bridge-secure-mcp-tunnel` cleanly onto current main with no
  conflict; rebased candidate commit is `2530854`.
- Verified the DevSpace malformed-workspace Guard hardening remains present:
  canonical proxy source, regression test, and README documentation all survived
  the reconcile.
- No DevSpace Secure MCP production runtime was modified.

## Candidate controls

Git-tracked candidate:

- `ops/windows/recovery/SetupSecureMcpBridge.ps1`
- `ops/windows/recovery/SecureMcpBridge.ps1`
- `ops/windows/recovery/SETUP_Secure_MCP_Bridge.bat`
- `ops/windows/recovery/START_Secure_MCP_Bridge.bat`
- `ops/windows/recovery/STOP_Secure_MCP_Bridge.bat`
- `ops/windows/recovery/STATUS_Secure_MCP_Bridge.bat`
- `ops/windows/recovery/ROLLBACK_Secure_MCP_Bridge.bat`

Expected dedicated runtime:

```text
root = D:\Engineering_Bridge_System\BridgeSecureTunnel
profile = engineering-bridge
health port = 18081
MCP transport = local STDIO
Bridge runner = D:\Engineering_Bridge_System\runtime\RUN_ENGINEERING_BRIDGE_STDIO.bat
Runtime API key = env:CONTROL_PLANE_API_KEY / process memory only
```

The control directory already contains earlier candidate copies, but the master
launcher has not been switched to Green. Do not treat those copies as production
authority. Sync from the C/P checkpoint before account-bound setup/activation.

## Validation and repair in this phase

- `git diff --check`: PASS.
- `SetupSecureMcpBridge.ps1` PowerShell parse: PASS.
- `SecureMcpBridge.ps1` PowerShell parse: PASS.
- Isolated setup smoke used a temporary APPDATA/profile/runtime root and did not
  touch the real `engineering-bridge` profile: PASS.
- Generated isolated profile preserved local STDIO Bridge command and
  `env:CONTROL_PLANE_API_KEY` only: PASS.
- Temporary smoke runtime/profile was removed afterward.

The isolated smoke exposed one candidate validation defect: the PowerShell
`TunnelId` validator previously accepted arbitrary mixed-case alphanumeric
suffixes, while tunnel-client requires exactly 32 lowercase alphanumeric
characters after `tunnel_`. The candidate now enforces
`^tunnel_[a-z0-9]{32}$` before invoking tunnel-client, and README documents the
same boundary.

After the Owner supplied the dedicated Bridge Tunnel ID, formal setup created:

```text
profile = %APPDATA%\tunnel-client\engineering-bridge.yaml
runtime root = D:\Engineering_Bridge_System\BridgeSecureTunnel
health port = 18081
transport = local STDIO
Bridge runner = D:\Engineering_Bridge_System\runtime\RUN_ENGINEERING_BRIDGE_STDIO.bat
```

The first formal STATUS run exposed a second candidate-only validation defect:
`Ensure-Blue` incorrectly required the 8768 listener process name to be
`mcp-stdio.exe`. Current production intentionally launches the Python entry
point, so the real owner is `python.exe` with a command line containing
`.venv\Scripts\mcp-stdio.exe serve --port 8768`. The candidate was aligned to
the canonical Engineering Recovery Watchdog logic, now accepts that production
owner shape (while retaining direct `mcp-stdio.exe` compatibility), and also
requires an actual HTTP response from `http://127.0.0.1:8768/mcp`. Re-validation
reports Blue READY while Green remains stopped, as expected.

The first real Green startup then exposed a Windows command-tokenization defect
after doctor had already returned `RESULT ok`: the YAML double-quoted command
correctly contained escaped backslashes, but the tunnel-client STDIO command
parser treated the resulting Windows backslashes as escape characters and tried
to execute `D:Engineering_Bridge_SystemruntimeRUN_ENGINEERING_BRIDGE_STDIO.bat`.
The underlying BAT itself is healthy. A bounded local smoke proved that
`cmd.exe /d /c D:/Engineering_Bridge_System/runtime/RUN_ENGINEERING_BRIDGE_STDIO.bat`
starts correctly, so setup now normalizes only the command-line copy of the
Bridge runner path to forward slashes. The canonical filesystem path and
Bridge -> Codex transport are otherwise unchanged.

## Blue rollback live verification

Blue was not stopped or reconfigured.

- Cloudflare metrics on port 20242 returned HTTP 200.
- Port 8768 root returning HTTP 404 was correctly treated as non-authoritative;
  it is not itself a Bridge failure.
- A real current Engineering Bridge MCP call reached Bridge policy.
- The canonical repo path was rejected by configured project-root policy, which
  proves the request reached Bridge rather than failing at transport.
- Repeating against the allowed WT under `D:\WORKTREE_ZONE` succeeded:
  `bind_project -> run_task -> task_result`.
- Codex child returned exactly `BRIDGE_BLUE_OK`.
- This proves the current Blue ChatGPT -> Bridge -> Codex execution chain is
  live end-to-end.

## Current production truth

Bridge Green is running as a development candidate and is now reachable from
ChatGPT through the dedicated custom Tunnel connector. It is not yet integrated
into the production/master launcher and main remains unchanged.

At this checkpoint:

- `D:\Engineering_Bridge_System\BridgeSecureTunnel` exists as the candidate
  runtime root created by formal setup.
- Real `%APPDATA%\tunnel-client\engineering-bridge.yaml` exists and points to
  the dedicated Bridge Tunnel ID.
- Dedicated Bridge Tunnel ID =
  `tunnel_6ac4db29ebec8191bfd84fe7069d4d5a`.
- Runtime API key was entered locally only and was not persisted.
- Existing Bridge Cloudflare / :8768 Blue remains online as the active rollback
  lane in parallel with Green.
- Existing Bridge -> Codex executor remains unchanged.
- Master launcher remains unchanged.
- Green tunnel process is running and healthy on 18081.

## Runtime-key Human Gate

The Owner created the dedicated Runtime API Key and entered it only into the
local secure prompt. `tunnel-client doctor` returned `RESULT ok` and the runtime
started successfully. The key was not pasted into ChatGPT and remains outside
Git/BAT/YAML/manifest/log; only the environment-backed
`env:CONTROL_PLANE_API_KEY` reference exists in the profile.

Independent post-start verification (not relying on launcher output):

```text
Secure MCP Bridge Green = READY
tunnel-client PID = 27368
18081 /readyz = HTTP 200
STATUS_Secure_MCP_Bridge.bat = exit 0
Blue 8768 gateway = READY (python.exe -> mcp-stdio.exe serve)
Blue 20242 Cloudflare metrics listener = READY
Green stderr tail = empty after successful restart
```

Launcher terminal evidence also reported:

```text
Secure MCP Bridge Green : READY
Blue Bridge rollback : READY / UNCHANGED
Transport : OpenAI Secure MCP Tunnel -> local STDIO Bridge
Tunnel readyz : READY (HTTP 200)
SECURE_MCP_BRIDGE_START_PASS
```

## ChatGPT Connector + Green E2E verification

The Owner linked the dedicated Tunnel to the only available ChatGPT workspace,
saved it, and then created the custom MCP connector:

```text
connector name = Engineering Bridge SecureTunnel
connection = Tunnel
authentication = no authentication
tunnel id = tunnel_6ac4db29ebec8191bfd84fe7069d4d5a
```

ChatGPT reported the connector as connected. The live tool catalog exposed the
expected four Bridge tools:

- `bind_project`
- `run_task`
- `task_result`
- `control_task`

Real Green E2E was then executed through the new
`Engineering_Bridge_SecureTunnel` connector against the allowed WT under
`D:\WORKTREE_ZONE`:

```text
bind_project -> workspace_id aa46d2a3-40b1-441a-a11d-b997024c553a
run_task -> task_id ae2533f4-6ec0-4bfd-b3c1-358f94f982c7
task_result -> completed
Codex thread_id = 01a11122-2b0f-7d71-a59d-7faa77d87100
output = BRIDGE_SECURE_MCP_OK
```

This proves the complete Green chain is live:

```text
ChatGPT Web
-> Engineering Bridge SecureTunnel connector
-> OpenAI Secure MCP Tunnel
-> local STDIO Engineering Bridge
-> official Codex app-server --stdio
-> Codex
-> task_result back to ChatGPT
```

Immediately after the Green E2E, independent local verification still reported:

```text
Blue Bridge rollback = READY
Green tunnel health 18081 = READY PID 27368
Green readyz = HTTP 200
STATUS_Secure_MCP_Bridge.bat = exit 0
Blue Cloudflare metrics 20242 = HTTP 200
```

## Lifecycle / rollback final acceptance

The lifecycle and rollback phase was executed deliberately against the live
candidate with Blue kept online throughout.

### 1. Green STOP validation

- Precheck: feature HEAD matched origin and both Blue/Green were READY.
- `STOP_Secure_MCP_Bridge.bat` completed with:

```text
Secure MCP Bridge Green : STOPPED
Blue Bridge rollback     : READY / UNCHANGED
SECURE_MCP_BRIDGE_STOP_PASS
```

- The ChatGPT `Engineering_Bridge_SecureTunnel` connector then failed as
  expected with `McpServerError: Session terminated`.
- The legacy/Blue `Engineering_Bridge` connector remained reachable and could
  still bind the same WT.
- A real Blue -> Codex task completed with exact output:

```text
BRIDGE_BLUE_AFTER_GREEN_STOP_OK
```

This proves Green failure/stop does not remove the last-known-good Blue lane.

### 2. Green restart / reconnect validation

- Owner re-entered the Runtime API Key only in the local secure prompt.
- Green restarted on a new tunnel-client PID and independently reported:

```text
STATUS_EXIT=0
18081 /readyz = HTTP 200
Blue Bridge rollback = READY
```

- The existing ChatGPT SecureTunnel connector recovered without being recreated.
- A new Green -> Codex task completed with exact output:

```text
BRIDGE_SECURE_MCP_RESTART_OK
```

This proves stop/start does not require rebuilding the ChatGPT connector and the
Tunnel/Bridge/Codex path reconnects correctly.

### 3. Explicit ROLLBACK validation

- `ROLLBACK_Secure_MCP_Bridge.bat` intentionally stopped only Green and printed:

```text
ROLLBACK PASS: Cloudflare Engineering Bridge remains the last-known-good lane.
Green profile/setup were preserved.
```

- SecureTunnel connector again became unavailable as expected.
- Blue connector remained usable and a real Blue -> Codex task completed with
  exact output:

```text
BRIDGE_ROLLBACK_BLUE_OK
```

- Blue Cloudflare metrics remained HTTP 200.

This proves the explicit rollback controller preserves the old production lane
and keeps the Green setup/profile available for restoration.

### 4. Final Green restore

- Owner re-entered the Runtime API Key locally one final time.
- Launcher reported `SECURE_MCP_BRIDGE_START_PASS`.
- Independent final verification reported:

```text
Blue Bridge rollback = READY
Green tunnel health 18081 = READY PID 33064
Green readyz = HTTP 200
STATUS_Secure_MCP_Bridge.bat = exit 0
Blue Cloudflare metrics 20242 = HTTP 200
```

- The existing ChatGPT `Engineering_Bridge_SecureTunnel` connector again
  recovered automatically.
- Final end-to-end SecureTunnel -> Bridge -> Codex smoke completed with exact
  output:

```text
BRIDGE_SECURE_MCP_FINAL_OK
```

Final lifecycle acceptance result: **PASS**.

## Next action: Owner I/W gate

Owner explicitly authorized `I/W` after final candidate acceptance. Production
integration was then performed without changing the Bridge binary version.

Production I/W actions completed:

- Added Bridge Secure MCP Green to the canonical `START_ALL_CHANNELS.bat` flow
  after Blue rollback readiness.
- Added Bridge Secure MCP status to `CHECK_CHANNELS.bat`.
- Added Git-tracked `STOP_ALL_CHANNELS.bat` and `RESTART_ALL_CHANNELS.bat` so
  the deployed full-stack lifecycle no longer exists only as local drift.
- Kept `START_BRIDGE_CHANNEL.bat` / unattended Bridge recovery Blue-only by
  design so Recovery never waits for interactive secret input.
- Synchronized the committed recovery/control files to
  `D:\Engineering_Bridge_System\control` after creating a rollback backup.
- Synchronized the short current-status knowledge mirror to
  `D:\Engineering_Bridge_System\HANDOFF_BRIDGE_SECURE_MCP_CURRENT_STATUS.md`.
- Fast-forwarded local `main` from the pre-I/W base to the accepted production
  integration history.
- Ran the deployed master launcher after sync; it exited 0 with DevSpace Green,
  DevSpace Blue, Bridge Green, Bridge Blue, Bridge public OAuth, Cloudflare
  metrics, and Engineering Recovery all READY.

Bridge production binary remains `1.4.2-biaogu.15`. This phase changes ingress
and recovery/control-plane authority only; it does not perform the deferred
upstream v1.5.0 audit/upgrade.

Current accepted production state:

- Green Secure MCP Tunnel: READY and left online.
- Blue Cloudflare/:8768 rollback lane: READY and left online.
- ChatGPT SecureTunnel connector: connected and verified through Codex.
- stop/start/reconnect: PASS.
- explicit rollback to Blue: PASS.
- Runtime API Key persistence: intentionally disabled.
- DevSpace Secure MCP production: untouched.
- upstream v1.5.0 upgrade audit: not started.

This migration is closed after final Git/ref/knowledge synchronization and one
last post-I/W Green+Blue health/E2E check. The separate upstream v1.5.0 audit is
the next bounded phase, not part of this I/W.

Do not begin the upstream v1.5.0 upgrade audit until Bridge Secure MCP Green has
completed production acceptance. Upstream fetch currently exposes v1.5.0 /
`33904f3`, but it is intentionally outside this phase.

## Do not touch

- Do not delete or disable Bridge Cloudflare Blue.
- Do not break or remove :8768.
- Do not change Bridge -> Codex native STDIO/app-server transport.
- Do not modify the completed DevSpace Secure MCP production runtime.
- Do not reuse the DevSpace Tunnel ID/profile/health port.
- Do not persist Runtime API keys or other secret material.
- Do not integrate to main or production without explicit Owner `I/W`.
