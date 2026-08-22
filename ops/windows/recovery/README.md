# Engineering Environment Recovery

This directory is the Git-tracked canonical source for the Windows recovery layer deployed under `D:\Engineering_Bridge_System\control`.

The recovery layer deliberately lives outside the Engineering Bridge MCP process at runtime. That separation allows it to restart Bridge even when Bridge itself is down, and it keeps the nine-tool MCP surface unchanged.

## Runtime behavior

- The watchdog checks DevSpace on port `7677` and Engineering Bridge on `8768` every 15 seconds.
- Health requires the expected listener owner plus a real local HTTP response. Bridge public tunnel health is also checked through the dedicated `20242` cloudflared metrics listener when public auth is enabled.
- Three consecutive repairable failures are required before automatic recovery.
- Unexpected processes owning a managed port are fail-closed: Recovery logs the condition and does not kill the process.
- Missing DevSpace listeners reuse `START_DS_CHANNEL.bat`; an HTTP-unresponsive DevSpace uses `RESTART_DS_CHANNEL.bat`. Bridge recovery reuses `RESTART_BRIDGE_CHANNEL.bat`.
- Successful automatic service recovery writes `runtime\recovery-handoff.txt` and `runtime\recovery-state.json`, then opens a fresh ChatGPT browser window and copies the handoff text to the clipboard.
- A recovered Bridge task/thread is considered stale. The next ChatGPT window must start a fresh `run_task`; that creates a new native Codex thread instead of resuming an old Bridge task id.

## Client-session recovery boundary

The local watchdog cannot independently know that a particular ChatGPT browser conversation has lost its connector/tool session while both local services remain healthy. There is no trustworthy local heartbeat from an idle browser conversation that distinguishes "session broken" from "user is not calling tools".

For that branch, `06_Engineering_Recovery.bat` is the safe fallback. It performs a non-destructive health check, prepares the same handoff, opens a new ChatGPT window, and does not restart healthy DS/Bridge services.

If a surviving tool channel can still execute local commands, it may invoke the same recovery script on behalf of the user. If the browser session cannot call any local tool at all, a browser extension/UI automation layer would be required for fully automatic detection; that is intentionally not a dependency of this production recovery layer.

## Production integration

The deployed master launcher starts the watchdog after DS and Bridge are started. The master stop path stops the watchdog before intentionally stopping either service, preventing an intentional shutdown from being mistaken for a failure.

Individual DS/Bridge stop paths also create maintenance suppression flags. Start paths remove those flags. This lets a user intentionally stop one channel while leaving the watchdog running for the other channel without the stopped service being automatically resurrected.

`runtime\chatgpt-recovery-url.txt` may contain a `https://chatgpt.com/...` URL. When present, Recovery opens that target in a new Chrome window; otherwise it opens the ChatGPT home page.
