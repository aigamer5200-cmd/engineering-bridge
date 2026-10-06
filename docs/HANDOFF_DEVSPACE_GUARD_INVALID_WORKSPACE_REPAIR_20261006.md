# HANDOFF ??DevSpace Guard Invalid Workspace Repair

Updated: 2026-10-06

## Root cause

OpenAI Secure MCP Tunnel and DevSpace beta4 remained alive, but Green Guard
Proxy port 7688 crashed after receiving a malformed workspace ID containing
`?`. The proxy used an unknown workspace ID directly as a Windows directory
name under the unresolved-workspaces root. `mkdirSync()` raised ENOENT and the
exception escaped the heartbeat path, terminating Node.

Observed failure:

`D:\\ShoestringGoalData\\development-execution-guard\\unresolved-workspaces\\ws_4bb?`

## Repair

- Added a strict unresolved workspace-ID shape check:
  `^ws_[A-Za-z0-9_-]{1,120}$`.
- Invalid unknown IDs return `DEVSPACE_GUARD_INVALID_WORKSPACE_ID`.
- Wrapped heartbeat preparation/spawn in a catch boundary so filesystem or
  helper launch errors become per-call guard failures rather than process
  termination.
- Added the guard proxy itself to Git-tracked recovery source.
- Blue/Green startup sources synchronize the tracked proxy to the deployed
  DevSpace runtime before future starts.
- Added `TEST_DevSpace_Guard_Invalid_Workspace.ps1` as a live regression probe.

## Live verification

- Deployed patched proxy to
  `D:\\Engineering_Bridge_System\\DevSpace\\devspace_development_guard_proxy.mjs`.
- Green Guard restored on port 7688.
- Green DevSpace 7689 and Secure Tunnel 18080 stayed on their existing PIDs.
- Blue rollback 7677/7679 stayed online and was not restarted.
- Replayed malformed `ws_4bb?` request:
  - HTTP 503 as expected;
  - Guard PID remained stable;
  - no process crash.
- `DevSpace_SecureTunnel` then completed a real `open_workspace` +
  `exec_command` smoke test successfully.
- Engineering Bridge repository regression:
  365 passed, 5 skipped, 0 failed.

## Current integration state

- Owner-authorized I/W completed on 2026-10-06.
- Cloud and physical local `main` are aligned to the integrated repair.
- Canonical recovery source has been redeployed to the active Blue/Green
  control locations.
- Live runtime hotfix remains active and matches the Git-tracked canonical
  guard proxy.
- Do not restart or replace Blue rollback solely for this repair.
