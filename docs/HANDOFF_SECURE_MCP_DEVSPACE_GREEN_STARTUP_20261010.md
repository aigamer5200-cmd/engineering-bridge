# HANDOFF — Green Secure MCP cold-start timeout and diagnostics

Date: 2026-10-10
Scope: **Green DevSpace startup controller only**. No Bridge, GOAL, Blue, or tunnel-client protocol changes.

## Incident evidence

- 2026-10-09 23:27 local time: Windows Event 1074 and 6006 show a normal shutdown; tunnel-client logged its OnStop sequence.
- 2026-10-10 07:39:57: `SecureMcpDevSpace.ps1 -Action Start` began after reboot.
- 2026-10-10 07:40:00: Green DevSpace node process began; the launcher exited 07:40:45 before Guard and Tunnel were started.
- 2026-10-10 07:41:12: Green DevSpace finally reported listening on `7689`, about 72 seconds after process creation; original wait was 45 seconds.
- A later warm restart of only the missing Green components returned `SECURE_MCP_DEVSPACE_START_PASS`; direct `DevSpace_SecureTunnel` workspace/exec calls succeeded. Blue never stopped.

## Patch and behavior

- Canonical repository file: `ops/windows/recovery/SecureMcpDevSpace.ps1`.
- Deployed runtime copy (must be synchronized only after Owner I/W authorization):
  `D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control\SecureMcpDevSpace.ps1`.
- Explicit Green DevSpace listener wait increased **45 → 120 seconds**. Guard stays 30 seconds and Tunnel 45 seconds.
- Each startup stage (`preflight`, `green_devspace`, `green_guard`, `green_tunnel`, `verification`) emits machine-readable `STARTED`, `READY` / `REUSED`, or `FAILED` with elapsed milliseconds.
- Diagnostic log: `D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\logs\green-startup-events.jsonl` (runtime only, not Git).
- Failures are rethrown after a bounded **reason category** is logged; arbitrary exception text or API keys are **not** persisted.
- A healthy already-running Green is reused. `Assert-Blue`, PID/owner safety checks, and Green-only STOP/ROLLBACK remain unchanged.

## Verification completed before checkpoint

- PowerShell `Parser.ParseFile`: PASS, zero syntax errors.
- Focused startup and dual-lane unit tests: **9/9 PASS**.
- Full `npm test`: **432 total; 427 PASS, 5 SKIP, 0 FAIL**.
- Isolated runtime helper smoke test: emitted `STARTED`/`READY`/`FAILED`, measured elapsed milliseconds, classified a synthetic error, and did **not** persist a synthetic credential. The temporary test log was deleted.
- Live status (read-only): Blue `7677/7679` READY; Green `7688/7689` READY; Tunnel `18080/readyz` HTTP 200. No live service was stopped or restarted for this change.
- `git diff --check`: PASS; verify again after final staging.

## Repository and checkpoint

- Repository: `D:\Engineering_Bridge_System\engineering-bridge`; branch: `main` at time of task.
- Phase checkpoint reference: the Git commit containing **this handoff** (find with `git log -1 -- docs/HANDOFF_SECURE_MCP_DEVSPACE_GREEN_STARTUP_20261010.md`).
- No isolated development WT was created; this is a narrowly scoped controller hotfix, not a Bridge runtime version change.
- The `main` baseline and working-tree cleanliness must be reconfirmed at handoff or I/W time.

## Boundaries and next step

- Do not restart/stop Blue, rewrite keys/profiles, or change GOAL/Bridge routing.
- Do not force a full cold restart of a healthy Green merely to test a timeout.
- Verify PowerShell parse, focused Node unit tests, clean diff, and idempotent Green status before deployment.
- **Pending Owner I/W**: deploy only the verified controller file after SHA/canonical-source preflight and backup existing runtime copy. A live cold-start acceptance may be scheduled separately; avoid interrupting active sessions without approval.
- Next session can resume from this handoff + current Git state; no previous Codex thread is needed.
