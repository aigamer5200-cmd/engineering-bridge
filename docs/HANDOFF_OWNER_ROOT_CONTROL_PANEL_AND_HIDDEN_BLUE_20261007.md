# Owner root control panel and hidden Blue launch — 2026-10-07

## Durable source state

- Worktree: `D:\WORKTREE_ZONE\engineering-bridge-f5c0681f`.
- Branch: `feature/operator-root-cleanup-hidden-blue-20261007`.
- Base/checkpoint reference: `87ba5759dd3ea7283cfddb8402b12449a7647b96`.
- Candidate is uncommitted/unpushed; no new checkpoint commit exists.
- Initial worktree was clean. Only the files listed below belong to this change.
- Current Bridge runtime remains `1.4.2-biaogu.16`.
- No production/root deployment, process restart, commit, push, or I/W occurred.
- Internal Codex child returns evidence to the outer supervisor; it sends no
  Telegram. The outer supervisor owns user-visible stop delivery.

## Completed scope and files

`ops/windows/recovery/operator-root/` holds exactly six thin Owner wrappers:

| Wrapper | Target under the adjacent canonical `control` directory |
| --- | --- |
| `00_總啟動_開發雙通道.bat` | `START_ALL_CHANNELS.bat` |
| `01_總關閉_開發雙通道.bat` | `STOP_ALL_CHANNELS.bat` |
| `02_總重啟_開發雙通道.bat` | `RESTART_ALL_CHANNELS.bat` |
| `90_檢查_全部通道狀態.bat` | `CHECK_CHANNELS.bat` |
| `91_設定_Secure_MCP_Runtime_API_Keys.bat` | `SET_Secure_MCP_Runtime_API_Keys.bat` |
| `99_Engineering_Recovery.bat` | `engineering_recovery_watchdog.ps1 -Once -ForceSessionRecovery` |

Each wrapper propagates the called command's exit code; absent targets return
60. The Recovery wrapper matches the internal legacy 06 wrapper, with only its
control path resolved relative to the root BAT. Contents are ASCII/CRLF.

Other candidate files:

- `ops/windows/recovery/DeployOwnerRootControlPanel.ps1`: UTF-8 BOM deployment
  utility, kept outside root. Requires explicit `-OwnerIWApproved` after real
  Owner I/W. Validates source names/files, backs up every existing direct root
  BAT and the two obsolete root HANDOFFs, checks backup hashes, replaces the BAT
  surface, deletes the obsolete root HANDOFFs, and verifies exact names/SHA-256.
  Reparse paths and named-directory collisions fail before replacement. No
  recursive root delete is used. Replacement failure restores pre-run files.
- `ops/windows/recovery/StartHiddenBridgeRunner.ps1`: short detached hidden
  `cmd.exe` launcher, with quoted absolute BAT/log paths and no descendant wait.
  Receives paths only, reads no secrets, preserves gateway append-log output
  and tunnel null-output redirection.
- `ops/windows/recovery/START_BRIDGE_CHANNEL.bat`: replaces the Gateway/Tunnel
  titled minimized `start` calls with the helper. Missing helper/Gateway launch
  failure returns 29; Tunnel launch failure returns 30. Existing listener owner,
  PID command identity, local OAuth, provisioned public-auth runner/token,
  metrics owner, bounded polling and public OAuth gates remain intact.
- `tests/unit/owner-root-control-panel.test.ts`: exact mappings, hidden-launch
  structure and Blue gates, isolated deployment/redeployment/backup tests,
  and harmless hidden BAT execution with spaced paths and redirected output.
- `ops/windows/recovery/README.md` and this HANDOFF: source/deployment boundary,
  control panel mapping, verification, rollback and fresh-session instructions.

## Validation

Commands run from the worktree:

```powershell
npm run build
npm run typecheck
node --test dist/tests/unit/owner-root-control-panel.test.js dist/tests/unit/bridge-dual-lane-startup.test.js dist/tests/unit/recovery-handoff.test.js dist/tests/unit/secure-mcp-runtime-key.test.js
git diff --check
```

Build and typecheck passed. Focused suite passed 16/16 tests with no skips.
Windows deployment tests used temporary fixture roots inside this worktree,
never `D:\Engineering_Bridge_System`. They prove authorization-flag denial,
backup fidelity, removal of old root BATs/HANDOFFs, exact replacement bytes,
preservation of control/runtime sentinels and directories, and a safe second run.
The hidden helper executed a harmless BAT in a spaced path and produced its
expected log. Existing total-stop Green, Blue-only recovery and DPAPI contract
regressions passed. `git diff --check` must remain clean at supervisor review.

These are source and fixture results. Production hidden-console behavior,
startup/stop/restart and local/public health acceptance remain UNVERIFIED.

## Deployment plan — only after Owner I/W

1. Review the candidate diff and retain this durable HANDOFF in any later
   authorized checkpoint. Do not infer C/P or I/W authority from this child task.
2. Preflight the production root/control state without collecting secrets.
   Confirm the existing total-stop DevSpace Green fix and required canonical
   targets remain present. Do not overwrite unrelated control files.
3. Back up the existing control `START_BRIDGE_CHANNEL.bat` and any existing
   `StartHiddenBridgeRunner.ps1` to a timestamped painless-upgrade backup,
   recording whether the helper previously existed. Deploy only these two
   reviewed Blue launch files into `control` as a pair. Compare source hashes.
   No runtime binary upgrade or version change is part of this deployment.
4. Keep the deployment utility and adjacent `operator-root/` in the approved
   source checkout/staging directory, outside the production root. Invoke:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\recovery\DeployOwnerRootControlPanel.ps1 -SystemRoot D:\Engineering_Bridge_System -OwnerIWApproved
   ```

5. Retain the utility's reported
   `runtime\painless-upgrade\owner-root-<timestamp>-<unique-id>` backup path.
   The root must now have exactly the six approved BAT files. Root
   `HANDOFF_BRIDGE_SECURE_MCP_CURRENT_STATUS.md` and
   `HANDOFF_BRIDGE_SECURE_MCP_TUNNEL_20261006.md` must be absent. Historical and
   canonical repo documents stay unchanged; `control` remains canonical.
6. Perform separately authorized live total-stop/start/restart and status
   acceptance. Verify DevSpace Green/Blue and Bridge Green/Blue, watchdog and
   local/public OAuth, plus no persistent Gateway/Tunnel console windows when
   Blue processes actually launch. Adopting already-running Blue does not prove
   hidden launch. Keep logs credential-free and Recovery Blue-only.

## Rollback

Keep the first pre-cleanup root backup even after successful reruns. Each run
creates a separate backup; a later run backs up the already-clean six-wrapper
surface. To restore the original UI after separately authorized rollback,
remove only direct root BAT files, copy the backed-up root BAT/HANDOFF files
back to root, and compare their hashes. Preserve directories and unrelated
files. Restore the separately backed-up control launcher/helper pair; if the
helper was originally absent, remove only that newly deployed helper. Do not
replace all of control or any runtime binaries. An interrupted deploy needs a
fresh root inspection and backup-based repair; do not assume atomic completion.

## Pending and prohibited scope

Pending: outer-supervisor review, any separately authorized checkpoint,
Owner I/W, deployment and live acceptance. No known source-test failure remains.
Do not change DPAPI stores, keys, Tunnel IDs/profiles, model routing, GOAL,
runtime version, watchdog Recovery behavior or the total-stop DevSpace Green
fix. Do not move canonical BATs out of control or put deployment helpers at root.
No production mutation is authorized by this HANDOFF.

## Fresh-session resume

A new account/session can resume entirely from this HANDOFF and repository
state without the previous native Codex session. Create a new account-bound
native thread; do not resume an old account's thread. Confirm worktree/branch,
base HEAD, `git status --short`, candidate files and tests above. Preserve the
uncommitted candidate and any newly discovered unrelated edits. Then report
the source candidate to the outer supervisor or execute only the next step
explicitly authorized by Owner. Production verification remains pending until
actual live evidence is collected.

## Outer-supervisor review checkpoint

Independent supervisor review on 2026-10-07 passed:

- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- Supervisor focused suite (`owner-root-control-panel` + `bridge-dual-lane-startup`): 10/10 PASS.
- Full `npm test`: 428 total / 423 PASS / 0 FAIL / 5 SKIP, duration about 89.8 seconds.
- `git diff --check`: PASS.
- Candidate scope remains limited to the Owner root-control panel templates/deployer, hidden Blue launcher path, tests, README, and this HANDOFF.
- No production/root/control mutation occurred during candidate review.

Next Human Gate: Owner I/W authorizes main integration, deployed hidden Blue launcher/control update, exact six-file root panel cleanup, removal of the two obsolete root HANDOFF copies, and live cold lifecycle acceptance.
