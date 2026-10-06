# HANDOFF — Engineering Bridge Dedicated Secure MCP Tunnel

Date: 2026-10-06
Status: dedicated Bridge Tunnel ID supplied and formal local profile materialized; Blue validation repaired; Green startup now waits only for local Runtime API Key input

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

The dedicated Bridge Tunnel ID is complete. The only remaining startup
credential is a Runtime API Key with access to the same OpenAI organization.
Do not ask the Owner to paste that key into chat. `START_Secure_MCP_Bridge.bat`
must collect it locally through the secure prompt, after which the key exists
only in the tunnel-client process environment/memory and is not written to Git,
BAT, YAML, manifest, or log.

## Next action after Owner has a Runtime API Key available locally

1. Refresh/fetch and verify branch HEAD still matches the C/P checkpoint.
2. Sync the committed candidate controls to the candidate control location
   without switching the master launcher.
3. Start the dedicated Bridge Green launcher and enter the Runtime API Key only
   in the local secure prompt.
4. Let startup run tunnel-client doctor/readiness.
5. Start Green while keeping Blue online.
6. Create/scan the ChatGPT Connector for the dedicated Bridge Tunnel.
7. Verify tool catalog.
8. Run minimal Green E2E:
   ChatGPT -> Secure MCP Tunnel -> Bridge -> Codex, returning
   `BRIDGE_SECURE_MCP_OK`.
9. Verify `bind_project`, `run_task`, `task_result`, and Codex
   thread/result return.
10. Re-verify Blue remains READY in parallel.
11. Test Green stop/start/reconnect and rollback without stopping Blue.
12. Update this handoff/runtime evidence and create the next C/P.
13. Only after explicit Owner `I/W` may master launcher / production docs /
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
