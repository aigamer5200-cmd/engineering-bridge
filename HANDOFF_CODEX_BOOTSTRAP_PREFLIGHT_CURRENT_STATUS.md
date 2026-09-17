# Codex Bootstrap / Memory Preflight Slimming Handoff

## Current checkpoint

- Date: `2026-09-17`
- Repo: `D:\Engineering_Bridge_System\engineering-bridge`
- Task WT: `D:\WORKTREE_ZONE\engineering-bridge-1c7c1310`
- Branch: `feature/codex-bootstrap-preflight-slim-20260917`
- Production source baseline: `3cedd7442b32a99e34daba0782f7e271a7c3e1df`
- Production runtime version observed before this change: `1.4.2-biaogu.3`
- Production runtime was not modified or restarted in this phase.
- I/W was not performed in this phase.

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

## Safety / do-not-touch boundary preserved

- no global `C:\Users\User\.codex\config.toml` mutation
- no permanent `.codex/config.toml` project override
- no production Bridge runtime mutation
- no Shoestring GOAL runtime implementation change
- no account credential / token / auth file change
- no product repo / LINE / R2 / GCP / card-generation change
- no I/W

## Next step

After this feature branch is committed and pushed, the next step is review / acceptance of this checkpoint.

Only after acceptance should I/W be considered against the current Bridge / GOAL integration authority. A fresh Codex account/session can resume from this HANDOFF + branch state without relying on the interrupted Luna thread.
