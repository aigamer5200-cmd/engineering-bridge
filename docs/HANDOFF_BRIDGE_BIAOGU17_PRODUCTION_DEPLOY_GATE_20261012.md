# Bridge 1.4.2-biaogu.17｜Production Deploy Gate (2026-10-12)

## Release and intent

- Owner explicitly approved formal Production deployment after source I/W.
- Canonical source main release commit: aafd08aa61e94d32feef413b1a8f95f8cb060801
- Release version: 1.4.2-biaogu.17.
- Intended fix: replace thin Codex app-server 120-second silent-turn termination with 180-second observation-only health sampling. No change to model/account routing, existing Blue/Green ingress, GOAL, DS, OAuth, or credentials.

## PREPARED / CANARY-PASS (not yet switched)

- Immutable candidate root: D:/Engineering_Bridge_System/BridgeVersions/1.4.2-biaogu.17
- Manifest commit: aafd08aa61e94d32feef413b1a8f95f8cb060801
- Manifest lock SHA256: 2DBE59CAD9E03068EA97ED5E0E5240CAE488E8573A65E5ABAE11B40826DC39E1
- Version manager prepare: npm ci PASS, typecheck PASS, npm test PASS, build PASS.
- Version manager canary: PASS, four MCP tools, real Codex tasks, sandbox unchanged, loopback-only port 8769.
- Prior source-integration tests: 430 PASS / 0 FAIL / 5 SKIP, candidate real app-server smoke PASS, 125-second wall-clock silent protocol simulation PASS.
- Existing immutable 1.4.2-biaogu.16 remains the current production root and future immediate rollback candidate. The manager's pre-switch state still lists .15 as the previous version until the authorized switch succeeds.

## DEPLOYMENT BLOCKED BY ACTIVE-PROCESS SAFETY GATE

- Blue had an app-server process tree with node PID 41012 -> codex PID 5496 (started ~13:29 Taiwan).
- Green had an app-server process tree with node PID 41056 -> codex PID 45896 (started ~13:37 Taiwan).
- Independent ChatGPT desktop Codex PID 40020 was deliberately excluded from any Bridge control.
- Both Bridge app-server trees remained present on repeated read-only checks, with nearly unchanged CPU usage. Low CPU is NOT sufficient evidence that a task finished.
- Existing thin Bridge interface has no cross-session task-enumeration or guaranteed drain proof; no safe conclusion can be made that these long-running app servers are idle/orphaned.
- To honor the Owner's no-interruption objective, DID NOT run version-manager switch, stop/start Bridge, force-kill, change runtime pointers, alter tunnels, or change current auth/profile.

## Current verified live health

- Current runtime / pointer: 1.4.2-biaogu.16
- Version manager production verify: PASS. Local /mcp unauth 401; local OAuth 200; public /mcp unauth 401; public OAuth 200.
- Secure MCP Green /readyz HTTP 200.
- Candidate 1.4.2-biaogu.17 canary report: PASS and commit/lock bound.

## Next gate — no silent override

1. Determine that every affected Bridge-backed Codex turn has ended by authoritative task result / Owner confirmation; process presence alone must not be interpreted as safe to kill.
2. Verify no new Bridge task dispatch and Blue/Green active sessions drained before cutover.
3. Run the existing version manager switch using target 1.4.2-biaogu.17 and exact confirmation SWITCH.
4. Verify local/public OAuth, Bridge Blue and Secure MCP Green path, authenticated real Codex task, task_result.health and optional long-task semantics. If the Green bridge was kept live across pointer switch, arrange a guarded Green lifecycle with no active turns to ensure it actually loads .17. Do not claim both lanes updated based on pointer alone.
5. On verified regression, immediately use the preserved .16 rollback candidate and relevant native control scripts; never restart an active turn without explicit authorization.

This is an honest partial deployment checkpoint: RELEASE BUILT and CANARY ACCEPTED, PRODUCTION SWITCH NOT EXECUTED.
