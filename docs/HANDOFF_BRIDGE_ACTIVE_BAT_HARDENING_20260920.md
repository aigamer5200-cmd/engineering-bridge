# Engineering Bridge Active BAT Hardening Handoff — 2026-09-20

## Scope

This checkpoint hardens the active Windows BAT control surface under `D:\Engineering_Bridge_System` after the Bridge Tunnel Error 1033 incident.

The audit covered 43 active/user-facing BAT files in the root, `control`, `DevSpace`, and current `runtime` directories. Historical `BridgeVersions/*`, painless-upgrade staging/canary snapshots, and `.venv\Scripts` BAT files were inspected as non-authoritative artifacts and were intentionally not rewritten, because changing version snapshots or third-party environment scripts would corrupt rollback/reference state.

## Root issues found and repaired

1. DevSpace `7677` guarded production owner drift:
   - active owner is allowed to be `devspace_development_guard_proxy.mjs`;
   - old direct `@waishnav/devspace ... cli.js serve` remains accepted;
   - unexpected owners still fail closed.

2. `START_DS_CHANNEL.bat` false-success paths:
   - expected owner alone is no longer enough;
   - local HTTP must answer;
   - Cloudflared Windows service must be running;
   - startup waits validate owner + HTTP before success.

3. `START_BRIDGE_CHANNEL.bat` false-success paths:
   - local gateway owner must be valid;
   - local OAuth metadata must return HTTP 200;
   - after `PUBLIC_AUTH_READY.flag` exists, missing tunnel runner or token is a hard failure rather than a silent skip;
   - dedicated `20242` tunnel metrics listener must be owned by the expected cloudflared process;
   - public OAuth metadata at `bridge.twmarketlab.com` must return HTTP 200;
   - tunnel child stdout/stderr is detached from the caller to reduce misleading console attachment.

4. `CHECK_CHANNELS.bat` false READY:
   - replaced port-presence-only checks with owner + local HTTP/OAuth + public OAuth + service + watchdog validation;
   - now returns nonzero when a required component is unhealthy.

5. `START_ALL_CHANNELS.bat` sequencing:
   - Recovery Watchdog starts before the final health gate;
   - failed `CHECK_CHANNELS.bat` now fails the master launcher with a nonzero code.

6. Recovery Watchdog startup:
   - PID-file existence alone is no longer readiness;
   - PID must resolve to the expected watchdog command line.

7. `STOP_DS_CHANNEL.bat`:
   - intentional stop now waits for the Cloudflared Windows service to actually reach `Stopped`;
   - failure is surfaced instead of silently returning success.

8. Bridge helper BAT exit-code preservation:
   - `BRIDGE_VERSION_STATUS.bat`
   - `VERIFY_BRIDGE.bat`
   - `UPDATE_BRIDGE_TO_VERSION.bat`
   - `ROLLBACK_BRIDGE.bat`
   - `BRIDGE_CODEX_PROFILE_STATUS.bat`
   - `SET_BRIDGE_CODEX_PROFILE.bat`
   now preserve the real command result across `pause` instead of returning the `pause` result.
   The bridge painless-upgrade BAT generator was updated so future `install-controls` does not restore the old behavior.

9. DevSpace version-control BAT prerequisites:
   - `START_DS.bat`, `START_DS_1.0.4.bat`, `START_DS_1.0.4_LEGACY.bat`, `START_DS_1.0.7.bat`, `START_DS_1.0.8.bat`, and `VERIFY_DS.bat` all validate the expected Python and manager paths before execution;
   - the DevSpace painless-upgrade generator was updated and `install-controls` rerun so generated BAT files remain aligned.

## Live verification

- `START_DS_CHANNEL.bat`: PASS, exit 0.
- `START_BRIDGE_CHANNEL.bat`: PASS, exit 0.
- `START_RECOVERY_WATCHDOG.bat`: PASS, exit 0.
- `CHECK_CHANNELS.bat`: PASS, exit 0.
- root `00_總啟動_開發雙通道.bat`: PASS, exit 0.
- final health output:
  - DevSpace local 7677: READY
  - Bridge local 8768: READY
  - DevSpace tunnel service: READY
  - Bridge public auth: READY
  - Bridge tunnel metrics: READY
  - Bridge public OAuth: READY
  - Recovery watchdog: READY
- `VERIFY_DS.bat`: PASS; production `1.0.8`, guarded production active, local/public probes healthy, runtimes `1.0.4/1.0.7/1.0.8` ready.
- `SET_BRIDGE_CODEX_PROFILE.bat` negative boundary test: input other than `IW` returns exit 3 without mutation.
- `UPDATE_BRIDGE_TO_VERSION.bat` negative boundary test: input other than `IW` returns exit 3 without mutation.
- Bridge-only live restart restored gateway, dedicated tunnel, and public OAuth successfully while DevSpace remained healthy.
- Full Engineering Bridge regression: `npm test` -> 425 tests, 420 pass, 0 fail, 5 skipped.

## Non-blocking observation

When a long-lived cloudflared tunnel is spawned through a BAT under the DevSpace MCP command runner, that runner may keep the command session marked as running while the descendant tunnel process remains alive even though the BAT has already restored all services. This is a command-runner process-tree observation, not a Bridge/Tunnel health failure; the live health checks above remain authoritative. Do not redesign the production launcher solely to satisfy this diagnostic runner behavior.

## Boundaries preserved

- No 飆股獵人 GCP / Scheduler / Cloud Run / R2 / card / Production changes.
- No OAuth architecture rebuild.
- No user-account deletion/recreation.
- No Codex account/auth/profile mutation during the audit.
- No Cloudflare Tunnel credential replacement or disclosure.
- Historical version snapshots and `.venv` BAT files were not mutated.

## Next gate

After this checkpoint is committed/pushed and runtime canonical copies are verified equal, the remaining human step is ChatGPT Engineering Bridge `重新連線` / `重新整理` UI verification. Expected result: no Error 1033 and MCP schema remains 14 tools including `notify_development_stop`.
