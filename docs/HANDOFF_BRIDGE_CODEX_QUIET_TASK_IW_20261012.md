# Bridge Codex quiet-task health｜Source I/W closeout（2026-10-12）

## Authority / scope

- Source canonical repo: D:/Engineering_Bridge_System/engineering-bridge
- Source base at phase start: main and origin/main = 17999a2b333d8d79a8bb1e6c280c945109642eaf
- Feature branch: fix/bridge-codex-idle-watch-20261012; feature commit e12199fb71c30cecfde987e926e288b282a83c98
- Integration Worktree: D:/WORKTREE_ZONE/engineering-bridge-idle-watch-iw-20261012
- Integration branch: integration/bridge-codex-idle-watch-20261012
- Integration cherry-pick: b45920e (content-equivalent feature patch; branch SHA is distinct)
- Owner explicit authorization: I/W. This document records **source integration only**; no Production runtime switch or restart is implied.

## Immutable operational boundaries

- The active runtime version remains 1.4.2-biaogu.16, rooted under D:/Engineering_Bridge_System/BridgeVersions/1.4.2-biaogu.16.
- Current primary Secure MCP Green, rollback Blue, DS tunnels, Cloudflare, ports, secrets, Codex account/model/reasoning selectors, GOAL, task contents, and authentication were not changed.
- The proposed fixed source replaces the thin Codex App Server transport's fixed 120-second idle killer with an observation-only local 180-second sampling interval. Quiet is not an error. Existing RPC handshake timeouts, malformed-protocol failure paths, true process exits, explicit interruption, and process cleanup remain.
- New optional task_result.health surfaces last protocol event, process exit observation, quiet age, sample count and ambiguous quiet status without exposing model prompts or credentials.
- This does not modify legacy src/executors/codex-executor.ts execution timeout policy; scope is thin MCP run_task transport.

## Independent I/W and Canary acceptance

- Clean independent integration checkout from exact origin/main.
- Cherry-pick of feature commit: no conflicts.
- npm ci --offline --ignore-scripts --no-audit --no-fund: PASS, isolated Worktree only.
- npm run typecheck: PASS.
- npm test: **435 total, 430 PASS, 0 FAIL, 5 SKIP**, around 91 seconds.
- Candidate real Codex App Server smoke: **PASS**; exact route GPT-6.1 Sol / Medium; output BRIDGE_CANDIDATE_APP_SERVER_OK; candidate transport health state completed. No tools or file changes requested.
- Candidate real-wall silence test: **125,007 ms** elapsed; at about 122 seconds of silence, task state still running, two observer samples, no termination signal; subsequently returned LONG_QUIET_CANARY_OK. This is a synthetic Codex protocol with actual elapsed time and no provider/network calls, NOT a real 125-second Codex reasoning session.
- Tests/canary/codex-app-server-real-smoke.mjs and tests/canary/codex-quiet-real-clock.mjs are opt-in and excluded from default npm test suite.
- Final git diff --check, status, exact commits, main/remote sync must be checked before closeout.

## Pending / next gate

- Do not call the fix 'deployed' yet; active Bridge still uses the prior 120-second idle killer until a guarded immutable candidate is built and promoted to Production.
- On separate explicit Production deployment authorization: create immutable versioned candidate (bump .17 or appropriate version), keep .16 verified as previous, exercise dedicated Blue and Green ingress before guarded switch, ensure no active Codex turns are interrupted, and preserve rollback.
- A real Codex reasoning task lasting over 120 seconds with no protocol messages is not directly proven; synthetic real-clock test covers the transport timing condition and real smoke covers actual app-server compatibility independently.
- No need to recreate GOAL or modify DS; new ChatGPT/Codex sessions can resume using this document and main checkpoint without old thread memory.

## Completion record

This section is updated after final integration commit/push is verified: see the active main/origin/main checkpoint at handoff time. Do not equate integration source SHA with the immutable live runtime.
