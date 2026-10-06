# Bridge dual-lane startup handoff — 2026-10-06

## Objective and scope

Centralize interactive Owner-facing Engineering Bridge startup, stop, and restart
around Secure MCP Green primary + Cloudflare Blue rollback, while preserving
Blue-only unattended recovery. Source-only implementation in:

- Worktree: `D:\WORKTREE_ZONE\engineering-bridge-46480670`
- Branch: `feature/bridge-dual-lane-user-launchers-20261006`
- Base checkpoint HEAD: `978f3c26fbcf42e09adfe4737db290018353b30b`
- Candidate checkpoint: the next commit containing this HANDOFF will be the
  candidate checkpoint. Its SHA is pending commit creation; no SHA is assigned
  in this pre-C/P state. All seven intended changes remain unstaged/uncommitted.

Current production runtime `1.4.2-biaogu.16` is unchanged. This is the Owner's
provided production baseline; no live runtime probe or production mutation was
performed. Deployed controls and root Owner BATs remain untouched. No commit,
push, Owner I/W, or deployment has occurred yet.

The total/master startup already supports Green + Blue. This candidate
centralizes that behavior and adds explicit Owner-facing Bridge-only dual-lane
helpers, while preserving unattended `RESTART_BRIDGE_CHANNEL.bat` as Blue-only.

## Completed / files changed

- `ops/windows/recovery/START_ENGINEERING_BRIDGE_ALL.bat`: reads and prints the
  runtime version dynamically from `runtime\bridge-current-version.txt`; missing
  or empty version fails before startup (74). Starts deployed Blue (failure 72),
  then Green (failure 75), then verifies Green status (failure 76). Green failure
  leaves Blue untouched. READY names Green primary and Blue rollback.
- `ops/windows/recovery/STOP_ENGINEERING_BRIDGE_ALL.bat`: stops Green first;
  aborts and preserves Blue on Green stop failure; then stops Blue. Propagates
  child failure codes.
- `ops/windows/recovery/RESTART_ENGINEERING_BRIDGE_ALL.bat`: stop helper, bounded
  two-second pause, start helper; aborts on stop or pause failure.
- `ops/windows/recovery/START_ALL_CHANNELS.bat`: delegates Bridge startup to the
  new helper and propagates failure before starting the recovery watchdog.
  Existing DS, watchdog, and final channel checks retain their order.
- `ops/windows/recovery/README.md`: canonical helper list, interactive control
  deployment intent, and explicit Blue-only recovery boundary.
- `tests/unit/bridge-dual-lane-startup.test.ts`: five focused static tests for
  delegation, ordering, dynamic version, status/READY, failure guards, restart
  composition, and README/watchdog recovery boundary.
- `docs/HANDOFF_BRIDGE_DUAL_LANE_STARTUP_20261006.md`: this durable handoff.

## Validation

- Initial `npm run build`: exit 1; `tsc` unavailable because this isolated
  worktree had no `node_modules`.
- `npm ci --ignore-scripts`: exit 0; installed existing locked dependencies.
  Package/lockfile unchanged.
- `npm run build` after dependency installation: exit 0.
- `npm run typecheck`: exit 0.
- `node --test dist/tests/unit/bridge-dual-lane-startup.test.js`: exit 0;
  5 tests passed, 0 failed/skipped/cancelled.
- `git diff --check`: exit 0.
- Supervisor independently reran `npm run build`: PASS.
- Supervisor independently reran `npm run typecheck`: PASS.
- Supervisor independently reran the focused suite: 5/5 PASS.
- Supervisor independently reran `git diff --check`: PASS.
- Supervisor independently ran full `npm test`: 418 total / 413 PASS / 0 FAIL /
  5 SKIP; duration approximately 88.1 seconds.

Static acceptance does not prove live lifecycle behavior. BATs were not executed,
since their fixed paths target deployed controls. Live idempotent start/status
validation is pending authorized deployment.

## Candidate checkpoint and next Human Gate

The next commit containing this HANDOFF will be the candidate checkpoint.
Source scope remains exactly the seven intended files listed above. The next
Human Gate is Owner I/W authorizing main integration, deployed control/root BAT
updates, and live idempotent lifecycle validation. None has occurred yet.

1. Create the candidate checkpoint with this HANDOFF under the supervisor
   workflow, then obtain Owner I/W before main integration or deployed-file
   changes.
2. Copy the three canonical dual-lane BAT helpers and updated
   `START_ALL_CHANNELS.bat` to `D:\Engineering_Bridge_System\control`.
3. Update root Owner-facing Bridge stop/restart BATs to delegate to the dual-lane
   stop/restart helpers. Keep recovery `RESTART_BRIDGE_CHANNEL.bat` Blue-only;
   never repoint it to the interactive dual-lane restart.
4. Validate idempotent start/adoption and Green status with Blue rollback healthy;
   verify runtime version output follows the current-version pointer. Record
   sanitized results without Runtime API keys or credential material.
5. Record deployment evidence, refresh this HANDOFF with the actual repo/runtime
   state, then C/P that evidence under the supervisor's authorized workflow.

## Known boundaries and resume instructions

No unresolved source validation failure. Live deployment/lifecycle evidence is
pending. Do not change the production runtime version, deployed controls, root
Owner BATs, legacy recovery adapter, watchdog, or other worktrees in this task.
The new helpers are interactive: Green launch can request a secure Runtime API
key. They must not become unattended recovery entry points.

The worktree began clean and now contains only the seven intended source/doc/test
changes above, plus ignored local dependencies/build output. No staged changes
or checkpoint commit have been created yet; the next commit containing this
HANDOFF will establish the candidate checkpoint. Inspect `git status --short` and this handoff
before resuming; do not discard unrelated changes that may appear later.

A fresh Codex account/session can resume from this durable HANDOFF and the
`feature/bridge-dual-lane-user-launchers-20261006` branch without the prior native
thread. Start a new account-bound native session;
do not resume another account's thread. The next task is the candidate checkpoint
followed by the Owner I/W Human Gate for main integration, deployed control/root
BAT updates, and live idempotent lifecycle validation above. This executor is an internal
child; notification ownership remains with the outer supervisor.

## Owner I/W + deployed control integration result — 2026-10-07

- Owner explicitly authorized `I/W`.
- `main` fast-forwarded from `978f3c26fbcf42e09adfe4737db290018353b30b` to candidate checkpoint `e8457ded400416ecfa4e5febe7493a9f3d8e50ec`; no merge rewrite or conflict.
- Post-integration build PASS and focused dual-lane startup suite 5/5 PASS on `main`.
- Deployed canonical control files from `ops/windows/recovery` to `D:/Engineering_Bridge_System/control`:
  - `START_ALL_CHANNELS.bat`
  - `START_ENGINEERING_BRIDGE_ALL.bat`
  - `STOP_ENGINEERING_BRIDGE_ALL.bat`
  - `RESTART_ENGINEERING_BRIDGE_ALL.bat`
- Deployed-file SHA256 readback matched the canonical repo copies for all four files.
- Root Owner-facing Engineering Bridge stop/restart BAT wrappers were updated to delegate to `STOP_ENGINEERING_BRIDGE_ALL.bat` / `RESTART_ENGINEERING_BRIDGE_ALL.bat`. Their original copies are backed up under `D:/Engineering_Bridge_System/runtime/painless-upgrade/control-backups/bridge-dual-lane-startup-20261007`.
- Deployment readback caught an initial wrapper-generation issue where CMD expanded `0` to `0`; the wrappers were repaired before acceptance so they now preserve `exit /b 0` exactly. This did not affect the running Bridge runtime.
- Unattended `control/RESTART_BRIDGE_CHANNEL.bat` remains unchanged and Blue-only by design, so Engineering Recovery never depends on a Secure MCP Runtime API-key prompt.
- Live idempotent `START_ENGINEERING_BRIDGE_ALL.bat` PASS: dynamic current runtime printed `1.4.2-biaogu.16`; Green primary READY; Blue rollback READY.
- `STATUS_Secure_MCP_Bridge.bat` PASS: Green health `18081` HTTP 200 and Blue READY.
- `CHECK_CHANNELS.bat` PASS: DevSpace Green/Blue, Bridge Green/Blue, Bridge public OAuth/tunnel metrics, and Engineering Recovery all READY.
- Live Secure MCP Bridge -> Codex smoke PASS with exact `gpt-5.6-luna` / `max` / `priority` routing and marker `BRIDGE_DUAL_LANE_STARTUP_IW_OK`; sandbox Git state remained clean.
- Production Bridge binary/runtime remains `1.4.2-biaogu.16`; this I/W changed startup/control integration only.
- No Secure MCP profile, Tunnel ID, Cloudflare routing, OAuth credential, Runtime API key storage, or production Bridge binary was changed.

### Final operational rule

Owner-facing manual Bridge operation now treats Secure MCP Green primary + Cloudflare Blue rollback as one dual-lane Bridge unit. The master `START_ALL_CHANNELS.bat` delegates Bridge startup to the dual-lane helper. Unattended Engineering Recovery intentionally continues to use the legacy Blue-only `RESTART_BRIDGE_CHANNEL.bat`.

A fresh account/session can continue from this HANDOFF plus current `main` without relying on the prior thread.
