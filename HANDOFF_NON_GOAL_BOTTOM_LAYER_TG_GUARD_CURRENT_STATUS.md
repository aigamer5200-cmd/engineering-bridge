# HANDOFF — Engineering Bridge Non-GOAL Bottom-Layer TG Guard

status = INTEGRATED_MAIN_AWAITING_PRODUCTION_ACTIVATION

date = 2026-09-18

## Branch / WT

- WT: `D:\WORKTREE_ZONE\engineering-bridge-nongoal-tg-runtime`
- branch: `feature/non-goal-tg-runtime`
- base: `origin/main@37d4b44cc999f9e9f44b6844b9b74fc7f4be621d`
- checkpoint ref: `refs/heads/feature/non-goal-tg-runtime` (this phase-complete C/P)
- integrated source commit: `922ac45d1bdadf62e58860eab3ba9d7936cc56f1`
- candidate version: `1.4.2-biaogu.9`

## Implemented

- optional `DevelopmentExecutionGuardClient`;
- optional `DevelopmentExecutionGuardSupervisor`;
- registered `run_task` pre-dispatch heartbeat;
- queued/running periodic heartbeat;
- terminal child-state short grace lease;
- `DEVELOPMENT_EXECUTION_GUARD_UNAVAILABLE` safe error;
- notification-only `notify_development_stop` MCP tool;
- tool/schema/docs/version/release metadata update;
- no Codex account/auth/profile changes.

## Runtime boundary

The guard is disabled unless the production wrapper supplies the sanctioned
`ENGINEERING_BRIDGE_DEVELOPMENT_GUARD*` environment profile.

Guard disabled:

- no helper process invocation;
- existing Bridge task path remains unchanged.

Guard enabled:

- registered task dispatch is fail-closed on initial heartbeat;
- active child task periodically renews the shared Shoestring worktree lease;
- terminal child state shortens the lease but does not independently declare a
  user-visible stop;
- explicit `notify_development_stop` succeeds only from the shared guard's
  delivered receipt.

## Verification

- `npm ci --no-audit --no-fund`: PASS in isolated WT.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- focused guard/error/MCP: 19/19 PASS.
- full `npm test`: 425 total / 420 PASS / 0 FAIL / 5 SKIP.
- `git diff --check`: PASS.

## Shoestring companion

Companion WT:
`D:\WORKTREE_ZONE\shoestring-goal-nongoal-tg-runtime`

Companion branch:
`feature/non-goal-tg-runtime`

Shoestring owns the durable guard state machine, watchdog/CLI, Telegram sender
delegation, DS guard proxy, DevSpace guarded topology, GOAL duplicate
suppression, and activation/rollback contract.

## Not performed

- no production Bridge prepare/promote;
- no production guard environment profile;
- no Bridge MCP restart/reconnect;
- no Codex account/auth/profile mutation;

## Next gate

Source I/W is complete and full main regression passed. Production activation
remains a separate explicit Owner authorization.

After authorized production activation:

1. prepare immutable Bridge `1.4.2-biaogu.9`;
2. install the non-secret guard runtime profile in the external Bridge wrapper;
3. enable DevSpace guarded mode through its production config;
4. controlled restart/reconnect the affected MCP channels;
5. run live DS, DS+Codex, explicit-stop, lease-expiry, and GOAL no-duplicate
   canaries;
6. rollback the optional module if any canary fails.
