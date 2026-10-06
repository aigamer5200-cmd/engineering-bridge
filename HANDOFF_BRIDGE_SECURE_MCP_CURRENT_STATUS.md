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
- `START_Secure_MCP_Bridge.bat` — starts/adopts Green; prompts locally for the
  Runtime API key only when launch is required.
- `STOP_Secure_MCP_Bridge.bat` — stops Green only and verifies Blue remains ready.
- `ROLLBACK_Secure_MCP_Bridge.bat` — explicit Green -> Blue rollback.
- `STATUS_Secure_MCP_Bridge.bat` — reports Green + Blue health.
- `STOP_ALL_CHANNELS.bat` / `RESTART_ALL_CHANNELS.bat` — full interactive stack
  lifecycle; restart may require local Runtime API key input.

`START_BRIDGE_CHANNEL.bat` and `RESTART_BRIDGE_CHANNEL.bat` remain Blue-only by
design because the unattended Recovery Watchdog must never wait for interactive
secret input.

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
