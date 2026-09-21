# Codex Bootstrap / Memory Preflight Slimming Handoff

## 2026-09-21 `.10` Owner-authorized I/W and Production acceptance

- Owner explicitly authorized I/W for the GOAL missing-preflight-receipt guard.
- Feature checkpoint `13cb1f2a4ce6d99affff2b567db182886d2cce8a` was integrated into canonical
  `main` as `999f3f9042d1bd74790ba9aacd3bbd1fd54e5e3a`.
- Release checkpoint `921be9b07799d9ee9c41b4d397fd48b85e1b8105` bumped the Bridge package to
  `1.4.2-biaogu.10`, updated release notes, and was pushed to `origin/main`.
- Immutable runtime preparation PASS:
  - root: `D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.10`
  - commit: `921be9b07799d9ee9c41b4d397fd48b85e1b8105`
  - package-lock SHA256:
    `421BA1BBB5D582E0E60A666B3845C0CF75A8230A5A9B2397FFABDE177490049A`
  - `npm ci` / typecheck / full `npm test` / build: PASS
- Canary PASS on exact machine profile
  `gpt-5.6-luna / max / priority`; sandbox unchanged and the expected 14-tool
  surface including `notify_development_stop` was preserved.
- Guarded Production switch PASS:
  - current: `1.4.2-biaogu.10`
  - current root: `D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.10`
  - immediate rollback: `1.4.2-biaogu.9`
  - local MCP no-auth: 401
  - local OAuth metadata: 200
  - public MCP no-auth: 401
  - public OAuth metadata: 200
- Production live smoke A (missing receipt): PASS. On the active GOAL-managed
  Shared Strength Tracking WT, `run_task` returned
  `KNOWLEDGE_PREFLIGHT_REQUIRED` immediately and did not create a Codex task.
- Production live smoke B (completed receipt): PASS.
  - task: `6c182bfb-f93c-4a2b-bb43-6d71c1779731`
  - route: `gpt-5.6-luna / max / priority / read-only`
  - final output: `PROD_HEALTH_OK b99334d`
  - evidence contained only the single bounded `git rev-parse --short HEAD`
    command; no Memory, Skills, GOAL Skill, Handoff, or repo-archaeology reads
    appeared.
  - supervisor acceptance completed the task.
- The command-evidence item was marked `failed` by the native event while the
  Codex turn still returned the expected bounded output and completed normally.
  This is recorded as a non-blocking observer/evidence-status quirk; it is not
  the repeated-bootstrap failure class and did not trigger any extra discovery.
- No Codex account/auth/profile/global config mutation occurred.
- No product repo / LINE / R2 / GCP mutation occurred during this Bridge I/W.

This closes the 2026-09-21 CODEX "鬼打牆" regression at source, mainline,
immutable runtime, Canary, and Production levels. GOAL callers that provide the
required DS preflight receipt execute normally; a caller that omits it now fails
immediately instead of silently re-entering native Memory/Skills bootstrap.

The paused Shared Strength Tracking real-context task may now resume from its
durable checkpoint without depending on any previous Codex native thread.

## 2026-09-21 GOAL missing-receipt regression guard checkpoint

- Owner reported a fresh repeated-bootstrap / "鬼打牆" symptom during the
  Shared Strength Tracking real-context task.
- Live Bridge task evidence proved the affected ordinary `run_task` entered
  Codex native bootstrap again: it read `~/.codex/memories`, rollout summaries,
  GOAL Skill, development-stop Skill, and project Skills before implementation.
- A same-session read-only Luna/MAX smoke with a completed structured
  `preflight_receipt` executed only the single requested Git command and showed
  no Memory/Skills archaeology. Controlled-patch generation also completed
  normally. This isolates the defect to the ordinary GOAL `run_task` path when
  the caller omits the structured receipt; it is not a Luna model failure.
- The development guard already returns durable state `goal_delegated` for a
  GOAL-managed worktree. The repair therefore uses that existing authority
  instead of trying to infer GOAL from prompt text or repository names.
- New fail-closed rule in this branch:
  - when the development guard says `goal_delegated` and executor=`codex`,
    `run_task` requires a completed Knowledge Preflight Receipt before Codex is
    launched;
  - a missing receipt or explicit `preflight_completed=false` returns
    `KNOWLEDGE_PREFLIGHT_REQUIRED` before native Codex bootstrap can start;
  - stale-schema receipts that omit `preflight_completed` remain compatible and
    are still treated as completed DS preflight, matching the accepted `.8/.9`
    behavior;
  - non-GOAL tasks are unchanged because the hard gate activates only on the
    guard's exact `goal_delegated` state.
- This closes the dangerous silent fallback from "DS already did preflight" to
  "Codex independently redoes Memory/Skills/repo archaeology". A caller bug now
  fails immediately and visibly instead of consuming a long Luna/MAX task.

### Current implementation checkpoint

- Repo: `D:\Engineering_Bridge_System\engineering-bridge`
- Isolated WT: `D:\WORKTREE_ZONE\engineering-bridge-goal-preflight-guard-20260921`
- Feature branch: `fix/goal-preflight-receipt-guard-20260921`
- Feature checkpoint: `13cb1f2a4ce6d99affff2b567db182886d2cce8a`
- Owner-authorized integration to canonical `main`:
  `999f3f9042d1bd74790ba9aacd3bbd1fd54e5e3a`
- Release target: `1.4.2-biaogu.10`
- Files changed:
  - `src/core/development-execution-guard-client.ts`
  - `src/core/errors.ts`
  - `src/mcp-stdio.ts`
  - `tests/unit/development-execution-guard-client.test.ts`
  - `tests/unit/errors.test.ts`
- Validation:
  - `npm run typecheck` -> PASS
  - focused guard/error tests -> `9/9 PASS`
  - full `npm test` -> `426 total / 421 PASS / 0 FAIL / 5 SKIP`
  - real guard classification smoke on the active Shared Strength Tracking WT:
    `guard_ok=true`, `goal_delegated=true`,
    `missing_receipt_blocked=true`, `stale_schema_receipt_allowed=true`,
    `explicit_false_blocked=true`
- Existing dependency audit remains `2 moderate / 1 high`; no unrelated
  dependency remediation was attempted.
- No Codex account/auth/profile/global config mutation.
- No Shoestring GOAL runtime implementation mutation.
- No product repo / LINE / R2 / GCP mutation.
- No Production Bridge runtime switch is part of this checkpoint.

### Historical pending from the feature checkpoint

The five items originally listed here (Owner I/W, main integration, immutable
runtime preparation, guarded Production switch, and the two live GOAL smokes)
were all completed by the `.10` Production acceptance section above. They are
no longer pending.

Fresh Web GPT/Codex sessions can continue from this HANDOFF + Git checkpoint;
no prior native Codex thread is required.

## 2026-09-17 `.8` Production acceptance and main authority convergence

- Compatibility repair commits:
  - `623335d0c6dff86a39b6a94229be5bc586626e2a` — stale/cached Connector schemas now activate bounded DS-preflight bootstrap suppression when a valid `preflight_receipt` is present and `preflight_completed` is omitted.
  - `dd193fbc59dfa219356b189ffe02bc0f9c462bbb` — release checkpoint for `1.4.2-biaogu.8`.
- Source branch was pushed and the Production source authority
  `origin/fix/codex-protocol-astra-20260912` now points at exact `.8` release
  commit `dd193fb`.
- Immutable candidate runtime:
  `D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.8`.
- Candidate preparation revalidated `npm ci`, typecheck, full unit regression,
  and build: PASS.
- Canary on `gpt-5.6-luna / max / priority`, explicit account A: PASS; exact
  13-tool surface, real Codex thread, and sandbox invariance all PASS.
- Owner-authorized guarded Production switch completed:
  - current runtime: `1.4.2-biaogu.8`;
  - previous / immediate rollback runtime: `1.4.2-biaogu.7`;
  - local/public MCP unauthenticated status: 401 as expected;
  - local/public OAuth metadata: 200;
  - production verification: PASS.
- A second real Production smoke was deliberately sent through the already-open
  ChatGPT conversation whose cached `run_task` schema still lacks the newer
  `preflight_completed / memory_required / required_skills` fields. The task
  completed with one bounded `package.json` read and no Memory, Skills, GOAL,
  or repository-archaeology command evidence. This verifies the `.8`
  compatibility repair works for the exact stale-schema caller that reproduced
  the remaining loop symptom; opening a new ChatGPT window is no longer needed
  merely to activate the bootstrap suppression.
- `main` had diverged historically by two commits while the accepted Production
  source lineage carried the newer protocol, quota/failover, bootstrap, and `.8`
  fixes. Owner had already authorized C/P/I/W, so a dedicated integration
  Worktree was created from `origin/main` and reconciled with the `.8`
  Production source branch.
- Merge-conflict policy:
  - current `.8` Production source wins for runtime code, tests, AGENTS, and
    current architecture/tool documentation;
  - the older `2026-09-06` main-I/W historical record is retained explicitly;
  - the main-only task-local service-tier handoff remains in history/source;
  - no older implementation was allowed to overwrite the accepted `.8`
    runtime behavior.
- Post-reconciliation validation:
  - `git diff --check` -> PASS;
  - `npm ci` -> PASS;
  - `npm run typecheck` -> PASS;
  - full `npm test` -> `421 total / 416 PASS / 0 FAIL / 5 SKIP`.

This closes the Bridge/Codex repeated-bootstrap repair as a source + runtime +
stale-client acceptance checkpoint. Future reports of "鬼打牆" should first be
classified by concrete executor evidence; ordinary Luna/MAX reasoning latency
without Memory/Skills/repo-archaeology commands is not this bug class.

## 2026-09-17 stale-schema compatibility repair / Owner-authorized C/P + I/W

- Owner reported that Bridge -> Codex still occasionally looked like the old repeated bootstrap loop after the `.7` repair and explicitly authorized direct repair plus C/P/I/W.
- Live Production authority was re-read before modification: runtime=`1.4.2-biaogu.7`, source branch=`fix/codex-protocol-astra-20260912`, source tip=`c4803fa1da9e2f913b76c5954f00da68ac6f4d69`. The `.7` immutable runtime remains the rollback candidate until the successor passes Canary and Production smoke.
- Exact remaining defect: `.7` correctly added `preflight_completed / memory_required / required_skills`, and fresh MCP discovery exposes those fields, but an already-open Web ChatGPT Connector may retain the older `preflight_receipt` schema and therefore cannot send `preflight_completed=true`. In that stale-schema path the receipt still reached Bridge, but `codexBootstrapPolicy()` returned `undefined`, so native Codex memory / automatic skill instructions were not suppressed. The `.7` fix existed but could not be activated by that caller.
- Real stale-schema reproduction on current Production `.7` used the tool surface visible to the existing ChatGPT session and a bounded `package.json` Luna/MAX/priority smoke. It completed with one file-read command, proving transport/runtime health; independently, the exposed `run_task` schema was verified to omit all three `.7` activation fields. No current `CODEX_PROTOCOL_ERROR` / `CODEX_EXECUTION_FAILED` regression was observed in the current gateway log.
- Compatibility rule is now fail-safe and caller-version tolerant:
  - no `preflight_receipt` => legacy no-receipt path stays byte-for-byte unchanged;
  - valid `preflight_receipt` + omitted `preflight_completed` => treat it as a completed DS preflight and apply native `ds_preflight` bootstrap suppression;
  - `memory_required` omitted => false, so native memories are disabled;
  - `required_skills` omitted => no automatic skill catalogue and no required skills;
  - explicit `preflight_completed=false` => deliberate forward-compatible opt-out preserving text-only receipt behavior.
- This is intentionally a narrow Bridge compatibility repair. It does not mutate global `C:\Users\User\.codex\config.toml`, credentials, account routing, model/reasoning/service tier, sandbox authority, GOAL runtime, Product repos, LINE, R2, GCP, or any production product surface.
- Validation on the isolated source Worktree:
  - targeted stale/new-schema bootstrap regression=`10/10 PASS`;
  - `npm run typecheck`=`PASS`;
  - full `npm test`=`421 total / 416 pass / 0 fail / 5 skip`;
  - existing dependency audit observation remains `2 moderate / 1 high`; no unrelated `npm audit fix` was run.
- Release successor is `1.4.2-biaogu.8`. Promotion must remain side-by-side: immutable candidate -> Canary -> guarded Production switch -> fresh MCP + real Codex smoke. `.7` remains intact for rollback.

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
