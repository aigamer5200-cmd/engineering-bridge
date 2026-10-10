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
- Deployed runtime copy (Owner-authorized I/W completed on 2026-10-10):
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
- `git diff --check`: PASS.

## Owner-authorized I/W and live deployment (2026-10-10)

- Owner explicitly authorized **I/W + deployment** after the initial checkpoint `0e4d70b8d778c3641849c629f1fdd7826c0196ab`.
- Git origin/main fast-forward push succeeded; local and remote HEAD matched that checkpoint before deployment.
- Backed up the existing deployed controller, and verified its SHA-256, at:
  `D:\Engineering_Bridge_System\backups\control\green-startup-hardening-20261010-20261010-084313\SecureMcpDevSpace.predeploy.ps1`.
- Atomically replaced **only** the Green `SecureMcpDevSpace.ps1` controller after verifying the staged script parses successfully and matches the reviewed source SHA-256:
  `9876832A62287955D588DC7DA95DAFCF7A9E725C7AC8629BA02B852FB657CD32`.
- Idempotent production `-Action Start` returned `SECURE_MCP_DEVSPACE_START_PASS`, without restarting running Green components. The new runtime JSONL contains exactly 10 events for all five stages (`STARTED` and `READY` / `REUSED`) with measured elapsed time.
- Post-deploy PIDs preserved: Blue Guard `7677=16256`, Blue DevSpace `7679=19792`; Green Guard `7688=44876`, Green DevSpace `7689=8744`, tunnel-client `18080=34940`. Tunnel `/readyz` remained HTTP 200.
- `DevSpace_SecureTunnel` formal connector successfully executed `git status` and `git rev-parse` in `decide-for-me` Phase 1B WT after deployment.
- No production Bridge binary, GOAL routing, Cloudflare Blue channel, DPAPI key store, or tunnel configuration was modified. The **120-second cold-start** branch has static tests but was intentionally not exercised by forcibly restarting healthy services.

## Repository and checkpoint

- Repository: `D:\Engineering_Bridge_System\engineering-bridge`; branch: `main` at time of task.
- Phase checkpoint reference: the Git commit containing **this handoff** (find with `git log -1 -- docs/HANDOFF_SECURE_MCP_DEVSPACE_GREEN_STARTUP_20261010.md`).
- No isolated development WT was created; this is a narrowly scoped controller hotfix, not a Bridge runtime version change.
- `main` was clean and synchronized with GitHub when the runtime deployment was verified. This record update will be submitted in a separate documentation-only commit; reconfirm both heads at next handoff.

## Boundaries and next step

- Do not restart/stop Blue, rewrite keys/profiles, or change GOAL/Bridge routing.
- Do not force a full cold restart of a healthy Green merely to test a timeout.
- **I/W complete**; no additional deployment is pending for this controller hotfix.
- Pending only if requested later: optional cold-boot E2E acceptance after a normal future reboot, rather than disrupting active sessions now. On next reboot, confirm the diagnostic JSONL records all stages and the launcher returns READY.
- Next session can resume from this handoff + current Git state; no previous Codex thread is needed.
