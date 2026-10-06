# HANDOFF — Secure MCP DevSpace Startup Formalization

Date: 2026-10-06
Status: final verification complete; branch HEAD containing this handoff is the intended C/P checkpoint; Owner I/W required afterward

## Repo / branch / WT

```text
repo = D:\Engineering_Bridge_System\engineering-bridge
worktree = D:\WORKTREE_ZONE\engineering-bridge-e05be8e4
branch = feat/secure-mcp-startup-formalization
base = origin/main@0c998c3a3835f51d2f43dc3b03694536737428a3
```

This handoff plus repository/runtime state is sufficient for a fresh Web GPT or
Codex session; no prior native thread is required.

## Current runtime truth

```text
Green:
Web GPT -> OpenAI Secure MCP Tunnel -> 7688 Guard -> 7689 DevSpace v1.1.0-beta.4
tunnel-client health/admin = 18080
profile = devspace-canary

Blue rollback:
Cloudflare -> 7677 Guard -> 7679 DevSpace v1.0.8

Engineering Bridge = 8768 + existing Bridge Cloudflare/public OAuth path
```

Verified live PIDs remained unchanged across idempotent startup smoke:

```text
Blue Guard 7677 = 40756
Blue DevSpace 7679 = 39180
Green Guard 7688 = 29192
Green DevSpace 7689 = 3368
tunnel-client 18080 = 22236
```

## Completed

- Added `SecureMcpDevSpace.ps1` as the bounded Green lifecycle controller.
- Added Owner BAT wrappers for START / STOP / STATUS / ROLLBACK plus the optional
  `00_啟動_新版_Secure_MCP_DS.bat` entry.
- Split the legacy DS start logic into `START_DS_BLUE_CHANNEL.bat` so Blue remains
  explicit and independently verifiable.
- Changed canonical `START_DS_CHANNEL.bat` to ensure Blue first and then
  idempotently start/adopt Green.
- Kept the existing root `00_總啟動_開發雙通道.bat` unchanged; it now reaches the
  new path through deployed `control\START_ALL_CHANNELS.bat`.
- Updated `CHECK_CHANNELS.bat` to make Secure MCP Green + Blue rollback explicit,
  while preserving Bridge local/public validation.
- Preserved the separate Engineering Recovery Watchdog as a required startup/
  health component. Do not confuse it with the stale development-guard watchdog
  PID recorded in the legacy DevSpace production manifest.
- STATUS now reports `/readyz` only as HTTP-200 READY and does not print the
  healthy body containing an unauthenticated MCP initialize rejection.
- Runtime API key remains process-memory only and is securely requested only if
  tunnel-client actually needs to start.
- Green STOP/ROLLBACK is PID/manifest/owner gated and never stops Blue.
- Audited the existing live promotion helper and fixed a stale `$pid` reference
  in `Stop-ListenerPid`; the script had already renamed the variable to
  `$listenerPid`. A pre-change backup exists under
  `D:\Engineering_Bridge_System\backups\control\secure-mcp-formalization-20261006`.

## Live deployment performed for acceptance

Canonical launcher files from this WT were copied to the existing deployment
locations required by the Owner startup BAT:

```text
D:\Engineering_Bridge_System\control
D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control
```

No listener was intentionally stopped. The live runtime was adopted into
`secure-mcp-runtime.json` by idempotent START so future Green STOP has a strict
PID/owner safety manifest.

## Verification

- `SecureMcpDevSpace.ps1` PowerShell parse: PASS.
- Existing PROMOTE / ROLLBACK / STATUS PowerShell parse after audit: PASS.
- Formal STATUS BAT: PASS, exit 0.
- Formal START BAT: PASS twice consecutively, exit 0 both times.
- Master `00_總啟動_開發雙通道.bat`: PASS after deployment.
- Blue 7677/7679: READY and PIDs unchanged.
- Green 7688/7689: READY and PIDs unchanged.
- Tunnel 18080 `/readyz`: HTTP 200.
- Engineering Bridge local/public OAuth: READY.
- Engineering Recovery Watchdog: READY.
- `git diff --check`: PASS.
- diff secret scan: PASS; no Runtime API key/token value added.
- Current Secure Tunnel MCP was used successfully for workspace/read/exec/apply
  operations during this phase, providing live E2E evidence without disrupting
  Green.

## Noise/error findings

The warm-start old launcher itself was reproducibly exit 0. The most material
false-error presentation identified was the healthy tunnel `/readyz` response
body containing the word `Unauthorized`; the new Owner status path suppresses
that body while preserving HTTP-status validation. Expected unauthenticated MCP
401 traffic and occasional client-reset traces remain in runtime logs for
diagnostics and are not hidden as successful requests.

Historical recovery logs also contain old restart failures/repair attempts; they
are not current startup failures and are not emitted by the new launcher.

## Do not touch / pending

- Do not delete or disable Blue 7677/7679 or Cloudflare rollback.
- Current Owner-facing ChatGPT Connector is `DevSpace_SecureTunnel`, bound to
  the already-validated Secure MCP Tunnel backend. The former
  `DevSpace_SecureTunnel_Canary` Connector is temporarily retained only as a
  ChatGPT-side fallback and may be removed later after normal-use confidence;
  removing that duplicate Connector must not delete/rebuild the Tunnel itself.
- Do not put `CONTROL_PLANE_API_KEY` values in BAT/config/log/Git.
- Do not live-test STOP/ROLLBACK merely for ceremony while Green is healthy.
- Do not restart the legacy development-guard watchdog recorded in the DevSpace
  production manifest as part of this task. Its restoration requires separate
  stale-record preflight maintenance.
- I/W is not authorized. After C/P, wait for explicit Owner I/W.

## Next action

Push the branch HEAD containing this handoff as the durable C/P checkpoint, then
stop at the Owner Human Gate. If I/W is authorized later, integrate only that
verified feature checkpoint into the current main after normal fetch/race checks.
