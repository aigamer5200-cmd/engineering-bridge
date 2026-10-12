# HANDOFF — Blue/Green startup latency reduction (2026-10-12)

## Objective and non-disruption boundary

- Owner requested safer, faster first-click launch without disturbing currently running DS.
- Repository: `D:\Engineering_Bridge_System\engineering-bridge`.
- Isolated WT: `D:\WORKTREE_ZONE\engineering-bridge-90683a01`.
- Branch: `feat/bridge-green-startup-fastpath-20261012`.
- Base: `8133103df23d636e37252e61772fff1e752dc80a` (previous 240-second Green DevSpace cold-start checkpoint, still **pending Owner Git I/W**; formal main stays at `5d60a59`).
- No live start/stop/restart, no connector reconnect, no deployed BAT/PS1 mutation, no key/auth/GOAL/Bridge binary/Blue runtime changes in this phase.
- This handoff plus Git state supports a fresh Codex account/session without prior native thread.

## Bottlenecks and scoped improvement

1. `ops/windows/recovery/SecureMcpDevSpace.ps1` previously scanned all three Green listener owners four times during Start: preflight, immediately before Guard, immediately before Tunnel, and final verification. Warm reuse logs showed 8–9 seconds spent in each unnecessary intermediate scan on 2026-10-12.
2. The Green startup now retains its preflight ownership-validated snapshot for intermediate stage decisions. Newly spawned upstream, Guard and Tunnel listeners are still individually verified via `Wait-ExpectedListener`, and their validated owner references are added to the snapshot. Full `Get-GreenStatus` is retained at both **preflight and final verification** (two scans), including Tunnel `/readyz` and Guard HTTP check. Unexpected pre-existing port owners still fail closed.
3. `ops/windows/recovery/START_ENGINEERING_BRIDGE_ALL.bat` previously invoked a full `STATUS_Secure_MCP_Bridge.bat` immediately after `START_Secure_MCP_Bridge.bat`. The Start controller already verifies listener identity, Blue fallback and `/readyz` HTTP 200. Remove that redundant second Bridge scan; the canonical root `START_ALL_CHANNELS.bat` still runs the final fail-closed `CHECK_CHANNELS.bat`.
4. Do not reduce Green DevSpace 240s bounded cold-start allowance, Guard/Tunnel listener timeouts, startup stage logs, Blue identity checks, STOP/ROLLBACK safeguards or whole-stack final health gate. No background unbounded retries or altered concurrency.

## Validation — isolated, non-disruptive

- Windows PowerShell AST parser: PASS.
- `git diff --check`: PASS.
- Focused native TS tests: **15/15 PASS**, including the new snapshot/verification regression and dual-lane ordering assertions.
- Full official `npm test` after isolated build: **433 tests; 428 PASS, 5 SKIP, 0 FAIL**, exit 0 (build also PASS).
- Isolated WT reuses existing production-repo `node_modules` through a local junction for test dependencies; only the isolated WT `dist` is built, and no live service is restarted or written.
- Live end-to-end cold/warm launch-time acceleration is **not yet measured**. The deterministic improvement is fewer expensive full ownership/HTTP scans per invocation, not a guarantee of a specific number of seconds.

## Checkpoint and next steps

- Phase branch contains controller, Bridge launcher, unit tests and this HANDOFF. The specific commit hash is the latest `git log -1` on this branch after checkpoint.
- Main/origin/main were not merged or pushed. Runtime copy `D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control\SecureMcpDevSpace.ps1` remains at the previously deployed 240-second fix; root `D:\Engineering_Bridge_System\control` launcher scripts remain unchanged.
- **Owner Human Gate:** request I/W only after review. Upon authorization, integrate both prerequisite and speed-up commits in order, back up **only** the affected live controller/BAT, verify reviewed hashes, and deploy without restarting running DS. Avoid overwriting any source edited since snapshot.
- At the next naturally scheduled full start, record durations and first-try health of Blue/Green, Bridge, Tunnel and Recovery. If unexpectedly slow, investigate cold-start cleanup and real service health separately instead of further guessing or removing safety checks.
- Known unrelated pending: Codex CLI `sentry_goal` OAuth refresh warning previously observed; CLI itself passed `gpt-6.1-sol` execution check on 2026-10-12. Do not touch credentials in this task.

## Owner-approved I/W and live script deployment — 2026-10-12

- Owner explicitly authorized **I/W**. After `git fetch origin main`, canonical local `main` and GitHub `origin/main` both matched the clean `5d60a59` baseline; the isolated branch was a straight two-commit descendant.
- Fast-forward integrated `8133103` then `268504b` onto local `main`; `git push origin main` succeeded, and `git ls-remote origin refs/heads/main` confirmed **`268504b24e553123bac82a3a15e8d45beb48a22a`**.
- Confirmed the pre-deploy Green controller SHA-256 `27B98D2FBD6B772755FCDD2FD960C3B74BD0D94FEB5055B73B790A40CA200BDF` and Bridge launcher SHA-256 `974036952DEACE69232F8FFD6E744D5C278D89AF7E1B7493E686AF844BDCDFC7`.
- Verified backup copies for **both** affected live files at `D:\Engineering_Bridge_System\backups\control\startup-fastpath-20261012-20261012-145020`. The attempted `.NET File.Replace` operation failed without changing either live target; a checksum re-check confirmed both were still their original versions.
- Completed a safe backup-backed overwrite using `Copy-Item -Force`, with immediate post-write SHA-256 verification and a bounded rollback path on failure. Both files were successfully updated **without stopping, restarting or reconnecting DS / Bridge / either Tunnel**:
  - Green runtime controller: `D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control\SecureMcpDevSpace.ps1` = SHA-256 `60C34557EA9A555A93E86877CB4528A02213B9E9263EA5C3D2F929B985DBE567`.
  - Bridge dual-lane launcher: `D:\Engineering_Bridge_System\control\START_ENGINEERING_BRIDGE_ALL.bat` = SHA-256 `7C73B34F7924A2EF59A6B40BA8E0DBC115CF57F802F62516FA34DB622A632307`.
- Deployed Green controller also passed PowerShell AST syntax parsing. These updated scripts will affect **subsequent starts**, not existing listener processes.
- Read-only post-deploy canonical `D:\Engineering_Bridge_System\control\CHECK_CHANNELS.bat` returned **exit 0**: DevSpace Blue/Green, Tunnel 18080 `/readyz`, Bridge Blue/Green, Bridge Tunnel 18081 `/readyz`, local/public OAuth, tunnel metrics and Engineering Recovery all reported **READY**.
- The next natural startup remains the authoritative cold/warm **latency and first-try success** acceptance; no production cold restart was performed as part of this I/W.
