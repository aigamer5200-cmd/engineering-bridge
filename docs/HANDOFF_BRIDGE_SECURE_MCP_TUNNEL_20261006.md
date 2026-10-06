# HANDOFF — Engineering Bridge Dedicated Secure MCP Tunnel

Date: 2026-10-06
Status: candidate reconciled to current main and verified through the account boundary; dedicated Bridge Tunnel ID is still required before Green setup/activation

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

- `D:\Engineering_Bridge_System\BridgeSecureTunnel` does not exist.
- Real `%APPDATA%\tunnel-client\engineering-bridge.yaml` does not exist.
- No dedicated Bridge Tunnel ID has been supplied.
- No Runtime API key was requested or persisted.
- Existing Bridge Cloudflare / :8768 Blue remains the active rollback lane.
- Existing Bridge -> Codex executor remains unchanged.
- Master launcher remains unchanged.

## Account boundary / Human Gate

The only missing account-scoped prerequisite for the next Green step is a
dedicated OpenAI Tunnel ID for Engineering Bridge:

```text
tunnel_<32 lowercase alphanumeric characters>
```

Do not reuse the DevSpace Tunnel ID. The Owner may provide only the Tunnel ID.
Do not ask the Owner to paste a Runtime API key into chat; when startup requires
that key, collect it locally through the secure prompt so it remains process
memory only.

## Next action after Owner supplies the Bridge Tunnel ID

1. Refresh/fetch and verify branch HEAD still matches the C/P checkpoint.
2. Sync the committed candidate controls to the candidate control location
   without switching the master launcher.
3. Run dedicated Bridge profile setup with the supplied Tunnel ID.
4. Run tunnel-client doctor/readiness.
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
