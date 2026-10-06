# Engineering Environment Recovery

This directory is the Git-tracked canonical source for the Windows recovery layer deployed under `D:\Engineering_Bridge_System\control`.

The recovery layer deliberately lives outside the Engineering Bridge MCP process at runtime. That separation allows it to restart Bridge even when Bridge itself is down, and it keeps the nine-tool MCP surface unchanged.

## Runtime behavior

### Engineering Bridge ingress: Secure MCP Green primary + Cloudflare Blue rollback

Engineering Bridge production ingress now includes an OpenAI Secure MCP Tunnel
Green lane that terminates directly into the existing local STDIO Bridge runner:

ChatGPT -> Secure MCP Tunnel -> RUN_ENGINEERING_BRIDGE_STDIO.bat ->
Engineering Bridge -> codex app-server --stdio.

This path is deliberately independent from the DevSpace Secure Tunnel profile
and from the existing Cloudflare Bridge lane. It does not reuse the DevSpace
tunnel ID/profile, does not alter the Codex app-server transport, and does not
require the existing HTTP/OAuth gateway on port 8768 for Green traffic. The
Cloudflare gateway/tunnel remains the Blue rollback and is required to stay
healthy in parallel with Green.

Canonical Bridge Secure MCP controls:

- SetupSecureMcpBridge.ps1
- SecureMcpBridge.ps1
- SETUP_Secure_MCP_Bridge.bat
- START_Secure_MCP_Bridge.bat
- STOP_Secure_MCP_Bridge.bat
- STATUS_Secure_MCP_Bridge.bat
- ROLLBACK_Secure_MCP_Bridge.bat

Canonical interactive Engineering Bridge dual-lane helpers:

- `START_ENGINEERING_BRIDGE_ALL.bat`
- `STOP_ENGINEERING_BRIDGE_ALL.bat`
- `RESTART_ENGINEERING_BRIDGE_ALL.bat`

Interactive Owner-facing Bridge controls use these dual-lane helpers to manage
Green primary and Blue rollback as one unit. After Owner I/W, deploy the helpers
to the control directory and point the root Owner-facing Bridge stop/restart BATs
to them. START reads `D:\Engineering_Bridge_System\runtime\bridge-current-version.txt`
at invocation, starts Blue before Green, and verifies Green status before READY.
Green startup/status failure leaves Blue untouched. STOP stops Green first and
aborts before stopping Blue if Green stop fails. RESTART stops both lanes, waits
two seconds, then starts them; Green startup resolves the Runtime API key without
prompting after the one-time DPAPI setup described below.

`RESTART_BRIDGE_CHANNEL.bat` remains Blue-only for unattended recovery and must
not be repointed to the interactive dual-lane restart. `START_BRIDGE_CHANNEL.bat`
also remains Blue-only. The watchdog must never acquire a Runtime API key prompt
through these adapters. These source changes do not deploy or change production.

The dedicated runtime root is D:\Engineering_Bridge_System\BridgeSecureTunnel,
the profile name is engineering-bridge, and the fixed local tunnel health port
is 18081. Setup copies the already-validated tunnel-client v0.0.15 binary into
the Bridge-owned runtime root so future DevSpace tunnel upgrades cannot
silently change the Bridge transport.

The source candidate uses a shared Windows DPAPI CurrentUser encrypted-at-rest
store; the profile still stores only `env:CONTROL_PLANE_API_KEY`. Normal Start
never prompts: explicit process environment takes precedence, otherwise the
controller decrypts the local store, otherwise it fails with setup instructions.

The one account-scoped prerequisite is a dedicated remote Tunnel ID created in
OpenAI Tunnels management (or by tunnel-client admin tunnels create with a
separate admin key). Once that ID exists,
SETUP_Secure_MCP_Bridge.bat <tunnel_id> materializes the local STDIO profile
and prints the Connector resource URL. The ID must match the tunnel-client
format `tunnel_` plus exactly 32 lowercase alphanumeric characters. Do not reuse
the DevSpace Tunnel ID.

The accepted production ChatGPT connector is `Engineering Bridge SecureTunnel`.
Its tool catalog exposes the Bridge control surface and has been validated
end-to-end through Codex. Green stop/start reconnects the existing connector;
the connector does not need to be recreated. Explicit rollback stops only Green
and leaves Blue available.

### One-time Runtime API keys setup (split source candidate; pending Owner I/W)

Two distinct keys and two distinct stores are required:

- DevSpace: `D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-devspace-runtime-api-key.dpapi`
- Bridge: `D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-bridge-runtime-api-key.dpapi`

After authorized deployment, run central
`D:\Engineering_Bridge_System\control\SET_Secure_MCP_Runtime_API_Keys.bat`
once as the controller Windows user. It invokes
`SetSecureMcpRuntimeKey.ps1 -Purpose All -IfMissing`, securely prompts for
DevSpace Runtime API Key, then Bridge Runtime API Key using `Read-Host
-AsSecureString`. Valid existing stores are retained by default; only missing
stores prompt. Unreadable existing stores fail closed. Setup never reuses a
single process env key for both purposes. The old singular BAT is a compatibility
wrapper to this plural setup only.

For independent setup/check use `-Purpose DevSpace`, `-Purpose Bridge`, or
`-Purpose All`; `-Check` reports availability only. Deliberate rotation or repair
requires `-Purpose DevSpace -Force` or `-Purpose Bridge -Force` and a secure prompt.
`-Force` cannot combine with `-Check` or `-IfMissing`. No key is a command argument.

Both controllers load generic `SecureMcpRuntimeKey.ps1` from central control.
The path selector requires a purpose; save/load/check/resolve require an explicit
SecretPath, with no ambiguous fallback. DevSpace resolves only its own store;
Bridge resolves only its own store. Normal Start uses deliberately supplied
process `CONTROL_PLANE_API_KEY` first, otherwise its own DPAPI store, otherwise
bounded setup failure. Explicit empty env input fails closed.

Stores are local-only, encrypted with Windows DPAPI CurrentUser, written via
same-directory atomic rename/replace with best-effort ACL for current user,
SYSTEM and Administrators. Plaintext stays transient in process env/memory;
byte/BSTR buffers are cleared. No plaintext goes into BAT/Git/YAML/log/manifest
or command line. No secret extraction from process memory is permitted.

Current deployed shared-store controllers are untouched by this candidate.
The obsolete shared store is unseeded and must not be used. Deploy and seed the
split design only after Owner I/W; see
`docs/HANDOFF_SECURE_MCP_SPLIT_DPAPI_KEYS_20261007.md` for deployment and fresh
session resume. Live cold lifecycle and Green/Blue acceptance remain UNVERIFIED.

After deployment and seeding, total stop/start/restart no longer prompts after one-time setup.
Missing/unreadable credentials fail with setup instructions; normal Start never
prompts or persists plaintext. Profiles remain env-only. Tunnel-client inherits
the transient env value; the controller restores its prior process env in
`finally`. Bridge doctor diagnostics are suppressed to avoid credential-bearing
output. Existing client logs must remain credential-free; live validation is
pending and must not collect or display raw secret-bearing diagnostics.

Despite removal of prompts, unattended recovery remains Blue-only. This change
adds no Green watchdog recovery authority and preserves Green/Blue rollback
boundaries. No source changes here have been deployed. See
`docs/HANDOFF_SECURE_MCP_DPAPI_RUNTIME_KEY_20261007.md` for the deployment plan.

### DevSpace ingress: Secure MCP Green + Cloudflare Blue rollback

The canonical DevSpace ingress is now OpenAI Secure MCP Tunnel ->
127.0.0.1:7688 GOAL Development Guard Proxy -> 127.0.0.1:7689 DevSpace
v1.1.0-beta.4. The former Cloudflare -> 7677 Guard -> 7679 DevSpace v1.0.8
path remains online as the last-known-good Blue rollback.

`START_DS_CHANNEL.bat` is therefore a composite launcher. It first ensures the
Blue rollback is healthy, then starts or adopts Secure MCP Green. Green lifecycle
logic lives in `SecureMcpDevSpace.ps1`; the Owner-facing BAT wrappers are:

- `START_Secure_MCP_DevSpace.bat`
- `STOP_Secure_MCP_DevSpace.bat`
- `STATUS_Secure_MCP_DevSpace.bat`
- `ROLLBACK_Secure_MCP_DevSpace.bat`
- `00_啟動_新版_Secure_MCP_DS.bat`

Green stop/rollback never stops Blue. DevSpace uses the same central DPAPI helper
and encrypted store as Bridge. Plaintext exists only transiently in process
memory/environment during tunnel-client launch; it is never written to BAT,
config, log, manifest, or Git.

The status path reports tunnel `/readyz` as HTTP-200 READY without echoing the
response body. A healthy tunnel-client may mention an expected unauthenticated MCP
initialize rejection in that body; printing it in the Owner launcher made a
healthy startup look like an error even though readiness had passed.

- The legacy watchdog checks Blue DevSpace on port `7677` and Engineering Bridge on `8768` every 15 seconds. It is not the Secure MCP Green health authority.
- Blue port `7677` may be owned either by the legacy direct `@waishnav/devspace` CLI process or by the guarded `devspace_development_guard_proxy.mjs`; any other Blue listener still fails closed. Green has its own strict 7688/7689/tunnel-client owner checks.
- `devspace_development_guard_proxy.mjs` is Git-tracked here as the canonical source and synchronized to `D:\\Engineering_Bridge_System\\DevSpace` before Blue/Green startup. Unknown workspace IDs must match the normal `ws_...` identifier shape before they may be used as unresolved-workspace directory names. Invalid IDs return a guard failure and are caught inside the heartbeat path; they must never terminate the proxy process.
- `TEST_DevSpace_Guard_Invalid_Workspace.ps1` is the live regression for that boundary: the malformed request must be rejected with HTTP 503 while the Guard PID remains unchanged.
- Health requires the expected listener owners plus real local HTTP/readiness responses. Bridge public tunnel health is checked independently through the dedicated `20242` cloudflared metrics listener when public auth is enabled.
- Three consecutive repairable failures are required before automatic recovery.
- Unexpected processes owning a managed port are fail-closed: Recovery logs the condition and does not kill the process.
- The legacy watchdog still repairs the Blue `7677` lane through the existing DS start/restart adapters; Green startup itself is owned by the Secure MCP controller. Bridge unattended recovery intentionally keeps using the Blue-only `RESTART_BRIDGE_CHANNEL.bat`, so it never blocks waiting for a Runtime API key.
- The critical deployed BAT surface is tracked here as canonical recovery/startup source: `START_ALL_CHANNELS.bat`, `STOP_ALL_CHANNELS.bat`, `RESTART_ALL_CHANNELS.bat`, `START_DS_CHANNEL.bat`, `STOP_DS_CHANNEL.bat`, `START_BRIDGE_CHANNEL.bat`, `START_Secure_MCP_Bridge.bat`, `STOP_Secure_MCP_Bridge.bat`, `STATUS_Secure_MCP_Bridge.bat`, `ROLLBACK_Secure_MCP_Bridge.bat`, `CHECK_CHANNELS.bat`, and `START_RECOVERY_WATCHDOG.bat`.
- `START_DS_BLUE_CHANNEL.bat` owns the legacy Blue/Cloudflared checks. `START_DS_CHANNEL.bat` composes Blue readiness with idempotent Secure MCP Green startup and returns success only when both lanes are safe.
- `START_BRIDGE_CHANNEL.bat` remains the Blue-only Bridge launcher. Once Bridge public auth is provisioned, it fails closed if the dedicated Cloudflare runner/token is missing and requires both the local OAuth metadata endpoint and public OAuth metadata endpoint to be healthy before returning success.
- `START_ALL_CHANNELS.bat` delegates Bridge startup to `START_ENGINEERING_BRIDGE_ALL.bat`, which starts/adopts Blue first, then starts/adopts Secure MCP Green and verifies Green status. If Green must launch, the Runtime API key is resolved from process env or the Bridge-specific DPAPI store without prompting. A Green startup failure leaves Blue untouched.
- `STOP_ALL_CHANNELS.bat` stops Bridge Green before the legacy Bridge Blue lane. `RESTART_ALL_CHANNELS.bat` therefore performs a full stack restart without recurring key entry after one-time setup.
- `CHECK_CHANNELS.bat` validates DevSpace Secure MCP, Bridge Secure MCP Green, Bridge Blue rollback, Bridge local/public OAuth, Bridge tunnel ownership, and the separate Engineering Recovery Watchdog. This Recovery Watchdog remains a required health component.
- `START_RECOVERY_WATCHDOG.bat` verifies that the PID file resolves to the expected watchdog process instead of treating PID-file creation alone as readiness.
- Recovery waits only for the immediate control BAT wrapper to return. It deliberately does **not** use PowerShell `Start-Process -Wait`, because that can wait for the long-running DevSpace `node.exe` descendant and deadlock the watchdog after a successful restart.
- Successful automatic service recovery writes `runtime\recovery-handoff.txt` and `runtime\recovery-state.json`, then opens a fresh ChatGPT browser window and copies the handoff text to the clipboard.
- A recovered Bridge task/thread is considered stale. The next ChatGPT window must start a fresh `run_task`; that creates a new native Codex thread instead of resuming an old Bridge task id.
- The recovery handoff also carries the current Shoestring GOAL stop-notification invariant: **any reason that makes forward execution stop must notify the Owner through Telegram before the recovered workflow yields or waits**. Recoverable system stops notify first and then continue recovery; owner-only decision/authorization waits also notify before waiting. An Owner-requested pause/stop is not classified as a system `INTERRUPTED` event, but it still sends the dedicated pause Telegram before yielding.
- Checkpoints are split explicitly: intermediate C/P remains silent and resumes the Frozen GOAL, while a final verified C/P whose only next step is the Owner deciding whether to authorize I/W must send Telegram after the checkpoint is durable and then wait for that decision.

## Live fault validation

On 2026-08-22 the production watchdog was validated with a real unexpected DevSpace process termination rather than the maintenance-aware stop path.

- The first live test proved that the watchdog detected the missing `7677` listener and automatically restored DevSpace, but also exposed a control-wait deadlock after the service came back.
- The wait implementation was corrected so only the immediate `cmd.exe` wrapper is awaited.
- A second live test then passed end-to-end: DevSpace PID `49912` was forcibly terminated, the listener disappearance was observed, DevSpace recovered as PID `19960` in 40.7 seconds, local HTTP became responsive, `RECOVERY_END` was written, `runtime\recovery-state.json` recorded `automatic-service-recovery`, and the fresh ChatGPT recovery-window launcher was logged as launched.

The destructive test driver itself is not retained in the production control directory; only the runtime validation logs are retained as operational evidence.

## Client-session recovery boundary

The local watchdog cannot independently know that a particular ChatGPT browser conversation has lost its connector/tool session while both local services remain healthy. There is no trustworthy local heartbeat from an idle browser conversation that distinguishes "session broken" from "user is not calling tools".

For that branch, `06_Engineering_Recovery.bat` is the safe fallback. It performs a non-destructive health check, prepares the same handoff, opens a new ChatGPT window, and does not restart healthy DS/Bridge services.

If a surviving tool channel can still execute local commands, it may invoke the same recovery script on behalf of the user. If the browser session cannot call any local tool at all, a browser extension/UI automation layer would be required for fully automatic detection; that is intentionally not a dependency of this production recovery layer.

## Production integration

The deployed master launcher still starts/verifies the **Engineering Recovery
Watchdog** after DS and Bridge become ready. Do not confuse it with the separate
legacy **development-guard watchdog** referenced by the DevSpace production
runtime manifest. A stale development-guard watchdog is a separate bounded
maintenance concern: preflight stale development-guard records before restoring
it so historical notification state cannot be replayed accidentally.

Individual DS/Bridge stop paths also create maintenance suppression flags. Start paths remove those flags. This lets a user intentionally stop one channel while leaving the watchdog running for the other channel without the stopped service being automatically resurrected.

`runtime\chatgpt-recovery-url.txt` may contain a `https://chatgpt.com/...` URL. When present, Recovery opens that target in a new Chrome window; otherwise it opens the ChatGPT home page.

`OPEN_CHATGPT_RECOVERY.ps1` also accepts optional `-ClipboardFile` and `-UrlFile`
arguments. Recovery keeps using its original defaults, while preventive GOAL
rollover may reuse the same opener without copying its generated bootstrap into
the Engineering Recovery runtime directory.

All live ChatGPT window opens now share a durable cooldown at
`runtime\chatgpt-window-cooldown.json`. The default is 180 seconds, so GOAL
rollover, Engineering Recovery, and notification/control-center windows cannot
automatically open more than one new ChatGPT window within three minutes. The
timestamp is recorded before Chrome is launched, which also throttles immediate
retry storms when a later UIA/submit step fails. `-NoBrowser` validation does
not consume the cooldown. Callers may supply a different `-CooldownStateFile`
for isolated tests; production uses the shared default so separate workflows
still respect the same rate-limit guard.

`OPEN_GOAL_ROLLOVER.ps1 -ControlRoot <path>` is the preventive-rollover adapter.
It fail-closes unless `CURRENT_HANDOFF`, the referenced handoff, and
`NEXT_WINDOW_BOOTSTRAP.txt` all exist under the supplied control root. It then
uses the shared ChatGPT opener to copy only the bootstrap to the clipboard and
open a fresh browser window. The handoff remains the authority.

Both opener scripts support `-NoBrowser` for non-destructive validation. This
still exercises pointer/bootstrap validation and clipboard preparation without
opening Chrome.

`OPEN_GOAL_ROLLOVER.ps1 -AutoSubmit` is an explicit live-browser mode. The
shared ChatGPT opener snapshots existing Chrome top-level windows, requires one
new ChatGPT window from the current launch, uniquely locates its Chromium UIA
`ProseMirror` composer and `composer-submit-btn`, writes the bootstrap through
`ValuePattern`, invokes the submit button through `InvokePattern`, and verifies
that the submitted text left the composer. A project conversation commonly
clears the composer after submit, while the ordinary ChatGPT new-chat surface
may keep the same UIA element and replace its value with short default text;
both are accepted only when the original submitted payload no longer remains.
It fails closed if the new window or either UI element cannot be identified
uniquely. `-AutoSubmit` cannot be used with `-NoBrowser` and is not supported
for non-Chrome fallback browsers.

For GOAL rollover AutoSubmit, the adapter creates a temporary transport payload
containing the concise bootstrap followed by a verbatim copy of the already
validated authoritative handoff. The durable handoff file remains the sole
authority; the transport copy exists only long enough to deliver complete state
into the fresh browser session and is deleted immediately after the opener
returns.
