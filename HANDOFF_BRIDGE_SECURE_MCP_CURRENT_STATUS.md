# Engineering Bridge Secure MCP — Current Production Status

Updated: 2026-10-06
Production I/W: completed

This is the short current-state knowledge handoff for Engineering Bridge ingress.
Detailed implementation and validation evidence lives in
`docs/HANDOFF_BRIDGE_SECURE_MCP_TUNNEL_20261006.md`.

## Canonical architecture

Primary Green:

```text
ChatGPT Web
-> Engineering Bridge SecureTunnel connector
-> OpenAI Secure MCP Tunnel
-> local STDIO Engineering Bridge
-> official Codex app-server --stdio
-> Codex
```

Rollback Blue:

```text
ChatGPT Web
-> Cloudflare
-> mcp-stdio HTTP/OAuth gateway :8768
-> local STDIO Engineering Bridge
-> official Codex app-server --stdio
-> Codex
```

Bridge -> Codex remains the native local STDIO/app-server executor path. Only the
ChatGPT -> Bridge ingress differs between Green and Blue.

## Accepted production state

- Bridge runtime version remains `1.4.2-biaogu.15`; this ingress integration is
  not an upstream Bridge binary upgrade.
- The accepted Secure MCP ingress candidate was integrated into local `main`
  by fast-forward after final lifecycle acceptance.
- The Git-tracked recovery/control source was synchronized to
  `D:\Engineering_Bridge_System\control` with a pre-I/W backup retained under
  `D:\Engineering_Bridge_System\backups\control`.
- The deployed knowledge mirror is
  `D:\Engineering_Bridge_System\HANDOFF_BRIDGE_SECURE_MCP_CURRENT_STATUS.md`.
- Green profile: `engineering-bridge`.
- Green local health port: `18081`.
- Green runtime root: `D:\Engineering_Bridge_System\BridgeSecureTunnel`.
- Green ChatGPT connector: `Engineering Bridge SecureTunnel`.
- Blue local gateway: `127.0.0.1:8768`.
- Blue Cloudflare metrics: `127.0.0.1:20242`.
- Runtime API key is process-memory only and must never be stored in Git, BAT,
  YAML, manifest, or logs.
- DevSpace Secure MCP production is independent and must not reuse the Bridge
  Tunnel ID/profile/health port.

## Final acceptance evidence

All of the following passed before production I/W:

- Green initial E2E -> `BRIDGE_SECURE_MCP_OK`.
- Green stop while Blue remained usable -> `BRIDGE_BLUE_AFTER_GREEN_STOP_OK`.
- Green restart/reconnect -> `BRIDGE_SECURE_MCP_RESTART_OK`.
- Explicit rollback preserved Blue -> `BRIDGE_ROLLBACK_BLUE_OK`.
- Final Green restore E2E -> `BRIDGE_SECURE_MCP_FINAL_OK`.
- Green `/readyz` returned HTTP 200 after final restore.
- Blue Cloudflare metrics returned HTTP 200 after final restore.
- After production control synchronization, the real
  `D:\Engineering_Bridge_System\control\START_ALL_CHANNELS.bat` completed with
  exit 0 while DevSpace Green, DevSpace Blue, Bridge Green, Bridge Blue,
  Bridge public OAuth, Cloudflare metrics, and Engineering Recovery were all
  reported READY.

## Canonical controls

Under `D:\Engineering_Bridge_System\control`:

- `START_ALL_CHANNELS.bat` — starts/adopts DevSpace, Bridge Blue, Bridge Green,
  then Recovery Watchdog and validates all channels.
- `CHECK_CHANNELS.bat` — requires both Bridge Green and Blue to be healthy.
- `START_Secure_MCP_Bridge.bat` — starts/adopts Green and resolves the
  Bridge-specific Runtime API key from its independent DPAPI CurrentUser store.
- `STOP_Secure_MCP_Bridge.bat` — stops Green only and verifies Blue remains ready.
- `ROLLBACK_Secure_MCP_Bridge.bat` — explicit Green -> Blue rollback.
- `STATUS_Secure_MCP_Bridge.bat` — reports Green + Blue health.
- `STOP_ALL_CHANNELS.bat` / `RESTART_ALL_CHANNELS.bat` — full interactive stack
  lifecycle; normal start/restart is non-interactive after the split DPAPI stores
  have been seeded.

`START_BRIDGE_CHANNEL.bat` and `RESTART_BRIDGE_CHANNEL.bat` remain Blue-only by
design because the unattended Recovery Watchdog must never wait for interactive
secret input.

## FINAL ACCEPTED — 2026-10-07

Canonical production runtime remains `1.4.2-biaogu.16`. Tunnel IDs, Cloudflare
Blue, Secure MCP Green, Codex auth/profile and GOAL routing remain unchanged.

Final Owner lifecycle policy:

- `00_總啟動_開發雙通道.bat` is the canonical full-stack START entry.
- `01_總關閉_開發雙通道.bat` is the canonical full-stack STOP entry.
- When a restart is needed, use `01` -> allow the stack to stop -> `00`.
- `02_總重啟_開發雙通道.bat` is retained as an Owner convenience file only.
  It is **not** a production acceptance gate and is not required for normal
  operation because live testing showed that an immediate one-shot restart can
  leave external ChatGPT MCP connector sessions stale even when local health
  reports READY.
- `90_檢查_全部通道狀態.bat` is the canonical Owner status entry. It preserves
  the health-check return code, prints PASS/FAIL, and waits for a keypress so a
  double-clicked window does not immediately close.

Final live acceptance evidence:

- Owner performed `01` followed by `00`; no architecture/routing/auth change
  was required.
- Fresh ChatGPT MCP verification after that lifecycle:
  - DevSpace Blue: AVAILABLE.
  - DevSpace Secure MCP Green: AVAILABLE.
  - Engineering Bridge Blue: AVAILABLE and bind succeeded.
  - Engineering Bridge Secure MCP Green: AVAILABLE and bind succeeded.
- Real deployed `90_檢查_全部通道狀態.bat` / `CHECK_CHANNELS.bat` completed
  with exit 0 and reported DevSpace Blue/Green, Bridge Blue/Green, Bridge local
  OAuth, Bridge public OAuth, dedicated Cloudflare metrics and Engineering
  Recovery Watchdog READY. The root launcher reached its keypress hold.
- Root `D:\Engineering_Bridge_System` contains exactly the six Owner BAT
  entries:
  `00_總啟動_開發雙通道.bat`,
  `01_總關閉_開發雙通道.bat`,
  `02_總重啟_開發雙通道.bat`,
  `90_檢查_全部通道狀態.bat`,
  `91_設定_Secure_MCP_Runtime_API_Keys.bat`,
  `99_Engineering_Recovery.bat`.
- Secure MCP Green -> Engineering Bridge -> official Codex app-server E2E
  completed successfully with task output
  `SECURE_MCP_BRIDGE_CODEX_E2E_OK`; the task was explicitly read-only.
- Split DevSpace / Bridge DPAPI stores remain the canonical Runtime API key
  source for normal non-interactive startup. No plaintext key persistence was
  introduced.

Disposition: **FINAL ACCEPTED** for the supported production lifecycle
`01 STOP -> 00 START`, current four-lane MCP availability, Owner status surface,
split-DPAPI startup and Secure MCP -> Bridge -> Codex E2E. The one-shot `02`
restart convenience is explicitly outside the acceptance gate.

Historical candidate/restart notes below are retained only as implementation
history and are superseded by this FINAL ACCEPTED section wherever they conflict.

## 2026-10-07 DevSpace Blue residual Windows Terminal hotfix

After the FINAL ACCEPTED lifecycle, Owner reported that one Windows Terminal
window still remained visible after `00_總啟動_開發雙通道.bat`.

Live process inspection identified the visible terminal as the console inherited
by the DevSpace Blue development-guard watchdog:

- `D:\shoestring-goal\.venv\Scripts\python.exe`
- `development_execution_guard.py ... watchdog --poll-seconds 5.0`

Bridge Blue hidden runners, Bridge Green tunnel-client and the Engineering
Recovery Watchdog were not the visible-window owner.

Per the existing production-manager safety rule, the older manager was **not**
copied over production. Only this minimal production patch was applied to:

`D:\Engineering_Bridge_System\DevSpace\manage_devspace_painless_upgrade.py`

The helper-only Windows creation flags changed from:

`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`

to:

`CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`

This affects `start_detached_helper()`, which launches the development-guard
watchdog/proxy. The normal DevSpace runtime launch path and its existing
`DETACHED_PROCESS` behavior were left unchanged.

Validation before cycling production:

- manager `py_compile`: PASS;
- helper flags: `0x08000200`;
- isolated 4-second Python child smoke with the same flags created zero new
  `WindowsTerminal.exe` processes;
- patched production manager SHA256:
  `9AC69F3C49046DBA8527DC7BC8036B6FABA5CD19B269AE4A2D58C3502A8924E2`.

The currently visible terminal belongs to the watchdog started before this
patch and therefore will remain until the next canonical `01 -> 00` lifecycle.
Final live acceptance for this hotfix is: after `01` then `00`, all four MCP
lanes remain AVAILABLE and no new residual Windows Terminal window remains.

Live acceptance completed after Owner performed the canonical `01 -> 00`
lifecycle:

- DevSpace Blue: AVAILABLE;
- DevSpace Secure MCP Green: AVAILABLE;
- Engineering Bridge Blue: AVAILABLE / bind PASS;
- Engineering Bridge Secure MCP Green: AVAILABLE / bind PASS;
- deployed `90_檢查_全部通道狀態.bat`: exit 0 with all channels READY and
  keypress hold reached;
- development-guard watchdog remains running in the background as expected,
  with no visible main-window title;
- no `WindowsTerminal.exe` process remained after startup.

Disposition: **NO-WINDOW HOTFIX FINAL ACCEPTED**.

## 2026-10-07 restart race hardening / Owner status hold

Functional checkpoint: `8a6c112` on `main` (pushed to `origin/main`).

Observed production behavior:

- A direct `02_總重啟_開發雙通道.bat` could leave the fresh ChatGPT MCP
  connectors unavailable even though local STOP/START logic returned.
- A manual `01_總關閉_開發雙通道.bat` followed later by
  `00_總啟動_開發雙通道.bat` restored all local channel health.
- After that manual stop/start, the real deployed `CHECK_CHANNELS.bat`
  returned exit 0 with DevSpace Blue/Green, Bridge Blue/Green, public OAuth,
  Cloudflare metrics and Recovery Watchdog all READY.

Bounded repair:

- `RESTART_ALL_CHANNELS.bat` no longer uses a fixed two-second STOP -> START
  delay.
- New `WAIT_ALL_CHANNELS_STOPPED.ps1` requires the managed ports
  `7677/7679/7688/7689/8768/18080/18081/20242`, the targeted DevSpace /
  Bridge tunnel and gateway processes, and the Recovery Watchdog to be gone;
  the DevSpace Cloudflared service must also be stopped.
- That zero-runtime state must remain stable for eight seconds before START is
  allowed. Restart then waits five seconds and runs a second
  `CHECK_CHANNELS.bat` verification before reporting PASS.
- The deployed root Owner entry
  `90_檢查_全部通道狀態.bat` now preserves the health-check exit code, prints a
  final PASS/FAIL line, and pauses for Owner input so a double-clicked status
  window does not immediately close.

Validation completed without intentionally cycling the live stack:

- Both source and deployed `WAIT_ALL_CHANNELS_STOPPED.ps1` parse cleanly.
- With the stack intentionally still running, the new stop gate correctly
  failed closed and enumerated all active managed listeners/processes instead
  of allowing a premature restart.
- The deployed root `90_檢查_全部通道狀態.bat` completed the real health check
  with exit 0 / all READY and reached its pause prompt.

Acceptance disposition:

- Live `02` testing demonstrated that one-shot restart is not a reliable
  external connector lifecycle boundary. Per Owner decision it is therefore
  non-gating and normal restart operation is the proven `01 -> 00` sequence.

## Rollback rule

Never delete or disable the Cloudflare/:8768 Blue lane as part of Secure MCP
maintenance. Green can be stopped or rolled back independently; Blue remains the
last-known-good recovery path.

## Deferred work

The separate upstream Engineering Bridge v1.5.0 audit/upgrade is not part of this
integration and must be handled as a new bounded phase after this state is closed.

## Historical shared DPAPI candidate (obsolete; superseded by split keys)

Branch: `feature/secure-mcp-dpapi-runtime-key-20261007`; base checkpoint:
`910c27c5c3d6b1048e71b9e5a54c3599cf011ad6`. Changes are uncommitted/unpushed.
The earlier acceptance and prompt/process-memory descriptions above are
historical production evidence, not acceptance of this new source candidate.
The requested runtime baseline is `1.4.2-biaogu.16`; no runtime/version or
routing/GOAL changes are made by this candidate.

Both source Green controllers now use process env -> shared DPAPI CurrentUser
store -> bounded setup failure, with no recurring Start prompt. Profiles remain
`env:CONTROL_PLANE_API_KEY`; no plaintext persistence is allowed. Unattended
recovery remains Blue-only. Production/deployed files and the actual secret
store remain untouched. Owner I/W and live lifecycle validation are pending.
See `docs/HANDOFF_SECURE_MCP_DPAPI_RUNTIME_KEY_20261007.md` for changed files,
tests and exact deployment/resume steps. A fresh account-bound session can
resume from that durable HANDOFF and branch without the prior native thread.

## Current 2026-10-07 split DPAPI source candidate

Branch `feature/secure-mcp-split-dpapi-keys-20261007`; base
`4c072dd4699dd8af09c83c1716276649a59dd574`. Changes remain uncommitted/unpushed;
no new checkpoint exists and no I/W/deployed-file mutation occurred.
DevSpace and Bridge now require two distinct keys and two distinct stores.
Both normal Starts remain non-interactive and use their own DPAPI store after
explicit process env. The plural setup preserves valid stores and prompts only
for missing purposes by default. Current production/deployed shared-store
controllers are untouched; the obsolete shared store is unseeded and must not
be used. Runtime `1.4.2-biaogu.16`, tunnel IDs, routing, GOAL, Cloudflare Blue and
Recovery Blue-only boundary are unchanged. No secret extraction from process
memory. Live cold stop/start/restart and both Green/Blue health remain UNVERIFIED.

Fresh account-bound sessions resume from
`docs/HANDOFF_SECURE_MCP_SPLIT_DPAPI_KEYS_20261007.md` plus repo state without
the prior native thread. Next task is supervisor review of the source diff and
validation, then separately authorized checkpoint/Owner I/W/deployment.
