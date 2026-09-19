# Engineering Bridge Tunnel 1033 Repair Handoff — 2026-09-20

## Checkpoint

- Canonical repo: `D:\Engineering_Bridge_System\engineering-bridge`
- Branch: `main`
- Base before this repair: `5960549344f4ffe7c17aad6356023579e7829e82`
- Checkpoint reference: commit containing this handoff and message `fix: accept guarded DevSpace runtime in recovery startup`
- Production package version remains `1.4.2-biaogu.9`; this repair changes Windows startup/recovery control only.

## Root cause

`00_總啟動_開發雙通道.bat` called `START_DS_CHANNEL.bat` first. After DevSpace guarded production was enabled, port `7677` was correctly owned by `D:\Engineering_Bridge_System\DevSpace\devspace_development_guard_proxy.mjs`, but the launcher and Engineering Recovery watchdog still accepted only the legacy direct `@waishnav/devspace ... cli.js serve` owner.

The stale owner check returned a DevSpace channel failure and the master launcher stopped before `START_BRIDGE_CHANNEL.bat`. As a result, Bridge gateway `8768` and the dedicated Bridge cloudflared metrics listener `20242` were not restored after their prior shutdown, so `bridge.twmarketlab.com` had no live Tunnel connector and Cloudflare returned Error 1033.

This was not a Cloudflare Tunnel credential, hostname route, OAuth architecture, Codex account, or Codex token root cause.

## Repair

- Added a tracked canonical `ops/windows/recovery/START_DS_CHANNEL.bat`.
- DevSpace health/start checks now accept either:
  - legacy direct DevSpace CLI runtime; or
  - `devspace_development_guard_proxy.mjs` guarded production runtime.
- Updated `ops/windows/recovery/engineering_recovery_watchdog.ps1` with the same owner rule.
- Updated recovery README to document the guarded-runtime owner contract.
- Deployed the corrected `START_DS_CHANNEL.bat` and watchdog to `D:\Engineering_Bridge_System\control`.
- Restarted the Recovery Watchdog so production runtime is using the corrected script.

## Verification

- Master launcher live rerun: PASS.
  - DevSpace `7677`: READY
  - Bridge `8768`: READY
  - Bridge Tunnel metrics `20242`: READY
  - DevSpace Cloudflared service: READY
  - Bridge public auth flag: READY
  - Recovery Watchdog: READY
- Local OAuth metadata: `http://127.0.0.1:8768/.well-known/oauth-authorization-server` -> HTTP 200.
- Public OAuth metadata: `https://bridge.twmarketlab.com/.well-known/oauth-authorization-server` -> HTTP 200.
- Public `/mcp` -> HTTP 401 without bearer auth, proving the public route reaches Bridge rather than Cloudflare 1033.
- Watchdog restarted after deployment and no new `unexpected-owner` entries appeared after the new START record.
- MCP schema visible from ChatGPT: 14 tools, including `notify_development_stop`.
- Live Bridge read-only Codex smoke:
  - task id `af671eab-78f4-4a61-a7ee-2519b3c1be0c`
  - `run_task` created successfully
  - native Codex thread created
  - `task_result` returned `HEAD=574d66988f59e31a87b352031e1b386ae52e34cb` and `STATUS=CLEAN`
  - task accepted to `completed`
- DSH smoke separately returned `DSH_UNAVAILABLE`; this is not the Bridge/Tunnel/OAuth root cause and does not block the restored Codex path.
- PowerShell parser check for the canonical watchdog: PASS.
- Full repository regression: `npm test` -> 425 tests, 420 pass, 0 fail, 5 skipped.

## Pending / Human verification

The remaining check is ChatGPT UI OAuth refresh/reconnect behavior. Owner should use Engineering Bridge `重新連線` if needed and then the plugin-page `重新整理`. Expected result: no Cloudflare Error 1033, connection completes, and the refreshed schema remains 14 tools including `notify_development_stop`.

## Boundaries preserved

- No 飆股獵人 GCP / Scheduler / Cloud Run / R2 / card / Production mutation.
- No OAuth architecture rebuild.
- No user-account deletion/recreation.
- No Codex account/auth/profile change.
- No Tunnel credential/token disclosure or replacement.
