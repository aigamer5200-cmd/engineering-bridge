# HANDOFF — Engineering Bridge Dedicated Secure MCP Tunnel

Date: 2026-10-06
Status: dedicated Bridge Secure MCP Green runtime started successfully and independently verified; next boundary is ChatGPT custom MCP connector creation/tool scan and Green E2E

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

Bridge Green is still NOT activated.

At this checkpoint:

- `D:\Engineering_Bridge_System\BridgeSecureTunnel` exists as the candidate
  runtime root created by formal setup.
- Real `%APPDATA%\tunnel-client\engineering-bridge.yaml` exists and points to
  the dedicated Bridge Tunnel ID.
- Dedicated Bridge Tunnel ID =
  `tunnel_6ac4db29ebec8191bfd84fe7069d4d5a`.
- No Runtime API key was requested or persisted.
- Existing Bridge Cloudflare / :8768 Blue remains the active rollback lane.
- Existing Bridge -> Codex executor remains unchanged.
- Master launcher remains unchanged.
- Green tunnel process is not running yet.

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

## Next action: ChatGPT connector + Green E2E

1. Refresh/fetch and verify branch HEAD still matches the C/P checkpoint.
2. Sync the committed candidate controls to the candidate control location
   without switching the master launcher.
3. Keep Green and Blue running.
4. In ChatGPT Plugins, add a custom MCP server and choose `Tunnel` as the
   connection method. Select or paste the dedicated Bridge Tunnel ID.
5. Scan tools and create the development connector/plugin.
6. Verify tool catalog.
7. Run minimal Green E2E:
   ChatGPT -> Secure MCP Tunnel -> Bridge -> Codex, returning
   `BRIDGE_SECURE_MCP_OK`.
8. Verify `bind_project`, `run_task`, `task_result`, and Codex
   thread/result return.
9. Re-verify Blue remains READY in parallel.
10. Test Green stop/start/reconnect and rollback without stopping Blue.
11. Update this handoff/runtime evidence and create the next C/P.
12. Only after explicit Owner `I/W` may master launcher / production docs /
    main integration be changed.

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
