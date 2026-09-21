# GOAL Codex Convergence Repair — Current Status

Date: 2026-09-21

## Current task

Prevent a DS-preflight GOAL Codex child from consuming an open-ended sequence
of repository search/read commands after the bounded seam is already known.

## Repository state

- Repo: D:\Engineering_Bridge_System\engineering-bridge
- Isolated WT: D:\WORKTREE_ZONE\engineering-bridge-bb6eecf7
- Branch: fix/goal-codex-convergence-20260921
- Base: main@ce5b88b539641b17dceff01afc5263447383eb7a
- Candidate version: 1.4.2-biaogu.11
- First source checkpoint: 932342353048afa4e1169bb65a20091ca2317b8f
- This HANDOFF is committed with the phase checkpoint containing the
  convergence repair.

## Root cause

The Bridge protocol-inactivity watchdog only detects silence. A Codex turn that
keeps issuing valid commandExecution events is considered active even when it
is semantically wandering through repeated rg/Get-Content/search/read work.

The completed Knowledge Preflight Receipt already disables automatic memory and
automatic Skill instructions, but repo_discovery=bounded was previously only a
text instruction. There was no executor-level mechanical delivery budget.

## Implemented

Completed DS-preflight Codex turns now have an executor-level bounded delivery
budget:

- 8 completed commandExecution items without file-change delivery:
  automatic STEER_TO_DELIVER;
- 14 completed commandExecution items:
  automatic HARD_DELIVER;
- 20 completed commandExecution items:
  terminate the turn with EXECUTOR_NONCONVERGENT.

Any completed fileChange resets the current command budget and convergence
intervention stage, allowing productive implementation to continue.

The budget is enabled only when Codex receives bootstrap mode ds_preflight,
which is derived from a completed Knowledge Preflight Receipt. Legacy/non-GOAL
Codex tasks retain their existing behavior and do not receive this budget.

Knowledge Preflight text now also states:

- delivery_mode: immediate
- convergence: bounded command budget; stop broad search after supervisor steer

New safe error:

- EXECUTOR_NONCONVERGENT
- message: The executor exceeded the bounded delivery budget without
  converging.

This is intentionally distinct from EXECUTOR_STALLED. The former means there
was activity but no bounded delivery convergence; the latter still means
protocol activity stopped.

## Verification

Local install:

    npm ci

Focused validation:

    npm run typecheck
    npm run build
    node --test dist/tests/unit/executors/codex-executor.test.js dist/tests/unit/errors.test.js dist/tests/unit/tasks/knowledge-preflight-receipt.test.js

Result:

- focused: 72 tests
- focused: 72 pass
- 0 fail

Full Bridge regression:

    npm test

Result:

- 429 total
- 424 pass
- 0 fail
- 5 skipped

New tests prove:

- DS-preflight command loop gets STEER then HARD_DELIVER then
  EXECUTOR_NONCONVERGENT;
- a completed fileChange resets the exploration budget;
- non-DS-preflight Codex tasks keep the legacy unlimited command behavior;
- new error remains allowlisted/safe;
- Knowledge Preflight exposes immediate delivery/convergence semantics.

## Cross-repo continuation

Shoestring GOAL must consume this candidate behavior so:

1. every real bounded task starts with cycle-begin;
2. successful Bridge execution is durably bound with cycle-execution;
3. DS independent verification calls cycle-verify;
4. accepted or repaired disposition calls cycle-disposition;
5. EXECUTOR_NONCONVERGENT is always classified as task-local recoverable,
   emits the required interruption notification only if forward execution
   actually yields, and starts a fresh narrower Bridge task;
6. a new child does not repeat broad repo archaeology already covered by DS.

That work is tracked in:

- Repo: D:\shoestring-goal
- Branch: fix/goal-production-execution-loop-20260921
- HANDOFF:
  docs/HANDOFF_GOAL_PRODUCTION_EXECUTION_LOOP_REPAIR_CURRENT_STATUS.md

## Do not touch

- no production activation / install from this feature branch yet;
- no MCP reconnect yet;
- no main integration without Owner I/W authorization;
- no change to non-GOAL Codex semantics;
- no automatic Astra routing;
- no weakening of Bridge workspace, sandbox, TG, or controlled-write
  authority.

## Continuation

A fresh Web GPT / Codex session can continue from this HANDOFF and the branch
without the interrupted Codex native thread that exposed the original problem.
