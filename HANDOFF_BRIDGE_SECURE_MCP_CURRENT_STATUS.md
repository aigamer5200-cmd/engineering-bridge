# Engineering Bridge Secure MCP — Current Production Status

Updated: 2026-10-06

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
