# Codex Bootstrap / Memory Preflight Slimming Handoff

## 2026-09-17 Owner-approved I/W / `.7` release integration

- Owner approved I/W after the feature checkpoint acceptance.
- Current real Production authority was re-verified before integration:
  `1.4.2-biaogu.6`, manifest commit
  `862a17b803da9e8271378a08cc6cdf89a4678635`.
- The feature was therefore **not** integrated back onto the old `.3` lineage.
  It was cherry-picked onto the current `.6` source-authority branch
  `fix/codex-protocol-astra-20260912` so the accepted protocol transport,
  quota classification, and A/B failover work is preserved.
- Feature checkpoint `cc7797a85079771a1624bbd4c142ff035e61e88a`
  integrated as `ecef6ba` before the `.7` version checkpoint.
- The only merge conflict was in
  `src/tasks/registered-workspace-task-service.ts`; resolution preserved the
  `.6` quota/failover loop and injects the task-local bootstrap policy into the
  effective Codex execution attempt, including failover retries.
- Integrated validation before release versioning:
  - `npm run typecheck` -> PASS
  - targeted bootstrap / executor / task-service / account-failover regression
    -> `119/119 PASS`
- Release target: `1.4.2-biaogu.7`.
- Previous Production `.6` must remain intact as the rollback runtime; no
  in-place overwrite is allowed.

## `.7` Production promotion and GOAL acceptance

- Release checkpoint: `574d66988f59e31a87b352031e1b386ae52e34cb`.
- Immutable runtime:
  `D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.7`.
- Runtime manifest validation:
  - `npm ci` -> PASS
  - `npm run typecheck` -> PASS
  - `npm test` -> PASS
  - build -> PASS via test/build pipeline
- Canary on exact `gpt-5.6-luna / max / priority`, account A -> PASS.
- Guarded Production switch -> PASS.
- Current Production runtime -> `1.4.2-biaogu.7`.
- Rollback runtime retained -> `1.4.2-biaogu.6`.
- Post-switch Production MCP smoke -> PASS with server version `.7` and no
  sandbox mutation.
- Fresh Production `tools/list` exposes the new receipt fields:
  `preflight_completed`, `memory_required`, and `required_skills`.
- The already-open Web ChatGPT Connector session retained its older cached
  `run_task` schema. This is a client/session schema-cache limitation rather
  than a Production runtime mismatch; a fresh Connector session should
  discover the `.7` schema.

### Real GOAL-managed Luna/MAX smoke

A clean detached smoke worktree was created from the exact `.7` release commit:

```text
worktree: D:\WORKTREE_ZONE\engineering-bridge-goal-smoke-20260917
head: 574d66988f59e31a87b352031e1b386ae52e34cb
GOAL session: Engineering-Bridge-20260917T044425Z-4f2d1489-8db9b9
Bridge workspace: 51466b3a-f19c-4ec3-85a3-7fac545ad079
Bridge task: e8ef7f3e-70ea-4b95-a795-f3a880ec59dd
Codex thread: 01a0adae-e7fb-73e0-8329-bedc5dce7754
route: gpt-5.6-luna / max / priority / read-only
```

DS preflight locked the task to `package.json`. The real Production `.7`
Bridge task received `preflight_completed=true`, `memory_required=false`, and
`required_skills=[]` and returned:

```text
VERSION=1.4.2-biaogu.7
```

Executor evidence contained exactly one command and it read only
`package.json`. Acceptance evidence:

```text
memory_seen=false
skills_seen=false
goal_seen=false
sandbox_unchanged=true
```

This closes the original repeated Memory / automatic Skills / implicit GOAL
bootstrap failure class under real GOAL-managed Luna/MAX execution.

Separate observation: bounded no-tool Luna/MAX smokes through explicit account
A/B routes sometimes spent roughly 50-70 seconds reasoning before returning.
Observer evidence showed no Memory, Skills, or GOAL bootstrap in those turns.
Treat that as model/provider latency rather than reopening the bootstrap bug.

## Current checkpoint

- Date: `2026-09-17`
- Repo: `D:\Engineering_Bridge_System\engineering-bridge`
- Task WT: `D:\WORKTREE_ZONE\engineering-bridge-1c7c1310`
- Branch: `feature/codex-bootstrap-preflight-slim-20260917`
- Production source baseline: `3cedd7442b32a99e34daba0782f7e271a7c3e1df`
- Production runtime version observed at the original feature start:
  `1.4.2-biaogu.3`.
- Later authority review before I/W established that actual current Production
  had already advanced to `.6`; the integration section above supersedes the
  original feature-start runtime snapshot.

## Root cause

The repeated Codex bootstrap delay was not caused by `run_task` performing an explicit Bridge-side `MEMORY.md` search.

The effective machine Codex config had native `features.memories=true`, while the existing Bridge `Knowledge Preflight Receipt` was only attached as text. Therefore a task that had already been narrowed by Web GPT + DS still entered Codex with native memory / automatic skill instruction behavior available.

The Bridge also had no task-local short-circuit that translated a completed DS preflight into native Codex thread config.

## Implemented fix

The existing `preflight_receipt` was extended instead of introducing a second preflight system.

Optional receipt fields:

- `preflight_completed: boolean`
- `memory_required: boolean`
- `required_skills: string[]`

When `preflight_completed=true` for a Codex task, Bridge derives one internal task-local bootstrap policy and passes native Codex `thread/start.config` overrides:

- automatic skill catalogue instructions: disabled with `skills.include_instructions=false`
- memories: disabled with `features.memories=false` unless `memory_required=true`
- existing `web_search` thread config is merged, not overwritten

The rendered receipt also makes the bounded delegation policy explicit:

- `skills: explicit_only`
- `repo_discovery: bounded`
- `goal_autostart: false`
- `required_skills:` explicit list or `none`

Legacy behavior remains unchanged when `preflight_completed` is absent or not true.

## Modified files

- `src/tasks/knowledge-preflight-receipt.ts`
- `src/tasks/registered-workspace-task-service.ts`
- `src/executors/executor.ts`
- `src/executors/codex-executor.ts`
- `tests/unit/tasks/knowledge-preflight-receipt.test.ts`
- `tests/unit/tasks/registered-workspace-task-service.test.ts`
- `tests/unit/executors/codex-executor.test.ts`
- `HANDOFF_CODEX_BOOTSTRAP_PREFLIGHT_CURRENT_STATUS.md`

## Verification

Focused verification:

- `npm run typecheck` -> PASS
- `npm run build` -> PASS
- targeted executor / task-service / preflight suites -> `106/106 PASS`

Full regression:

- `npm test`
- total: `391`
- pass: `386`
- fail: `0`
- skipped: `5`

## Real Luna/MAX smoke evidence

Both smokes used the changed branch build through `CodexExecutor`, with exact `gpt-5.6-luna`, reasoning `max`, service tier `priority`.

### Smoke A: memory not required

Bootstrap:

```text
mode=ds_preflight
memoryRequired=false
```

Instruction was bounded to reading `package.json` only.

Result:

```text
engineering-bridge 1.4.2-biaogu.3
```

Observed executor evidence contained only the bounded `package.json` read. No `MEMORY.md` archaeology occurred.

### Smoke B: memory explicitly required

Bootstrap:

```text
mode=ds_preflight
memoryRequired=true
```

Instruction explicitly requested `C:\Users\User\.codex\memories\MEMORY.md`.

Result successfully returned the requested first heading, proving memory-required tasks remain usable while the default DS-preflight path can skip memory.

## Known non-blocking observations

- One initial real-smoke shell harness attempt failed at PowerShell here-string parsing before Codex launched. The invocation shape was changed immediately; no product/runtime state was affected.
- One read-only smoke process session was lost during DS server turnover (`Unknown process session`). The smoke was replay-safe and only the missing read-only case was rerun.
- `npm ci` reported existing dependency audit findings (`2 moderate`, `1 high`). This phase did not run `npm audit fix` because dependency remediation is unrelated to the bootstrap fix.

## Safety / do-not-touch boundary preserved during feature implementation

- no global `C:\Users\User\.codex\config.toml` mutation
- no permanent `.codex/config.toml` project override
- no production Bridge runtime mutation
- no Shoestring GOAL runtime implementation change
- no account credential / token / auth file change
- no product repo / LINE / R2 / GCP / card-generation change
- no I/W occurred before Owner acceptance; the later Owner-approved I/W is
  recorded in the integration section above

## Next step

The `.7` release, Production promotion, and real GOAL-managed bootstrap smoke
are complete. No further bootstrap repair is required from this checkpoint.
Future GOAL work should use normal DS-first preflight and a fresh Connector
session when the Web UI must expose the new receipt fields. If a later task is
slow, distinguish model/provider reasoning latency from actual Memory/Skills
command evidence before reopening this issue. A fresh Codex account/session can
continue from this HANDOFF + repo state without relying on any previous native
Codex thread.
