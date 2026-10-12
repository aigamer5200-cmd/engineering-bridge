# HANDOFF — Green Secure MCP delayed cold start (2026-10-12)

## Scope and authority

- Repair the DevSpace **Green** Secure MCP startup timeout and verify local Codex CLI.
- Blue Cloudflare/DevSpace, Bridge runtime, Codex auth/profile, GOAL routing and API keys are **out of scope**.
- Working source: `D:\Engineering_Bridge_System\engineering-bridge` at `5d60a59`.
- Isolated working tree: `D:\WORKTREE_ZONE\engineering-bridge-33b8f81f` (create a feature branch/checkpoint; do not fast-forward or push main without the Owner's I/W).
- This record plus the Git diff are sufficient for a fresh account or session to resume; no prior Codex thread is required.

## Observed incident

- 2026-10-12 local 08:48:03: controller launched Green DevSpace upstream.
- 08:50:04: the existing 120-second listener deadline expired; stage diagnostic `LISTENER_TIMEOUT_OR_FAILED`.
- 08:50:35: DevSpace started listening on `127.0.0.1:7689`, **after** the controller had already abandoned the startup.
- As a result, Green Guard `7688` and Tunnel `18080` were left down while Blue remained ready.
- The upstream stdout includes a `managed_worktree_cleanup` event with 36 removed, 32 recovery refs; this is a possible cold-start cost, **not proven as the only cause**. Do not change cleanup behavior in this fix.

## Repair and rollback

- Runtime was first recovered without disruption by running the existing Green controller `-Action Start`, which reused DevSpace and started the missing Guard/Tunnel. Returned `SECURE_MCP_DEVSPACE_START_PASS`.
- Minimal source change: `ops/windows/recovery/SecureMcpDevSpace.ps1` defines `$greenDevSpaceStartupTimeoutSeconds = 240` and reuses it consistently for listener wait, error and stage detail. Guard remains 30s; Tunnel remains 45s.
- Regression test updated: `tests/unit/secure-mcp-devspace-startup.test.ts`.
- Prior to operational runtime repair, original controller SHA-256 `9876832A62287955D588DC7DA95DAFCF7A9E725C7AC8629BA02B852FB657CD32` was checked and backed up at:
  `D:\Engineering_Bridge_System\backups\control\green-coldstart-240s-20261012-133326\SecureMcpDevSpace.predeploy.ps1`.
- Only the DevSpace Green runtime controller at
  `D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control\SecureMcpDevSpace.ps1`
  was patched. Its SHA-256 matches the reviewed isolated source:
  `27B98D2FBD6B772755FCDD2FD960C3B74BD0D94FEB5055B73B790A40CA200BDF`.
- Rollback, only if needed: restore the backed-up controller after verifying expected identity; leave Blue untouched. No forced cold restart of currently healthy Green services.

## Verification

- PowerShell parser: PASS. `git diff --check`: PASS.
- Focused startup and Owner launcher tests, Node 24 native TypeScript loader: **8/8 PASS**.
- Green startup returned `SECURE_MCP_DEVSPACE_START_PASS`; Blue `7677/7679` READY, Green `7688/7689` READY, Tunnel health `18080/readyz` HTTP 200.
- An actual `DevSpace_SecureTunnel` MCP `open_workspace` call to Engineering Bridge succeeded after recovery.
- Codex CLI: `codex-cli 0.159.2`; `codex login status` reports ChatGPT login.
- Codex CLI real read-only, ephemeral task with configured model `gpt-6.1-sol` and reasoning `medium`: output `CODEX_CLI_SMOKE_OK`, exit code 0.
- The separate requested model alias `gpt-6.1` **is not supported** for this ChatGPT CLI account (HTTP 400); it is not the configured `gpt-6.1-sol`, which works. No model defaults were changed.
- The CLI logs a nonblocking `sentry_goal` MCP OAuth `invalid_grant` refresh error. Treat as independent pending authentication/connection follow-up; do not modify credentials as part of this repair.

## Additional whole-stack status finding

- The post-deployment whole-stack `CHECK_CHANNELS.bat` initially returned exit 75 because the **separate Engineering Bridge Green** tunnel on port 18081 was down; Bridge Blue was still READY.
- Its previous tunnel log shows a graceful `OnStop` sequence on 2026-10-11 22:07 local. No controller or credential change was required: the existing `D:\Engineering_Bridge_System\control\SecureMcpBridge.ps1 -Action Start` restored the tunnel and returned `SECURE_MCP_BRIDGE_START_PASS` and `readyz` HTTP 200.
- `Engineering Bridge SecureTunnel` was then reached through the ChatGPT MCP connector and successfully registered the previously allowed `E:\ALEX_REPOS\decide-for-me` checkout. An attempt to bind the Bridge repository itself was rightly refused by its existing configured root allowlist; the allowlist was **not** expanded.
- This is a runtime recovery of the separate Bridge Green, not a further source patch. All Blue paths remained untouched.
- The first whole-stack rerun also found `Engineering Recovery : DOWN/STALE`: PID file referenced an absent watchdog process. The installed `START_RECOVERY_WATCHDOG.bat` was invoked to start its existing hidden watchdog, and the new PID was verified alive with the expected command line. The launcher/checker patterns were inspected and require **no source fix**.
- **Final whole-stack acceptance**: `D:\Engineering_Bridge_System\control\CHECK_CHANNELS.bat` exited **0**. DevSpace Blue/Green, Bridge Blue/Green (including 18081/readyz HTTP 200), Bridge local/public OAuth, Bridge tunnel metrics and Engineering Recovery all reported READY.

## Next steps / pending

- Confirm the **post-deployment idempotent** Green start and status still return PASS, with startup event `timeout=240s` and the same Blue listeners.
- The 240-second cold-start path should be checked during the next **natural** Windows reboot; do not force a service disruption only for this test.
- Once local checkpoint is reviewed, seek Owner authorization for Git I/W (integrate branch into main and sync remote), if required. Runtime hotfix does **not** by itself constitute repository I/W.
- Update this handoff if any final verification fails. Keep repository clean and preserve the isolated checkpoint for the next window.

## I/W resolved (2026-10-12)

- The earlier "seek Owner authorization" note above is historical: Owner approved I/W in the follow-up startup-speed phase.
- Both this prerequisite checkpoint `8133103` and the dependent fastpath checkpoint `268504b` were fast-forward integrated into local `main` and pushed to GitHub `origin/main`.
- The live DevSpace Green controller now contains the 240-second cold-start allowance **and** the startup fastpath. Backup, deployed hashes, no-restart mechanics and the full post-deployment channel PASS are recorded in `docs/HANDOFF_BRIDGE_STARTUP_FASTPATH_20261012.md`.
- Still pending until the next naturally scheduled startup: real cold-start duration / first-attempt reliability. Do not force a stop or restart of currently active DS purely for benchmarking.
