# Handoff — Bridge Task-Local Service Tier (2026-09-11)

## Owner routing contract

```text
Bridge global default / ordinary executor route
  gpt-5.6-luna / max / priority

GOAL Child A or explicit A代理 caller override
  gpt-6-astra / low / standard

GOAL B/C/D executor route
  gpt-5.6-luna / max / priority
```

Bridge Core does not infer GOAL. It preserves the global profile when routing
fields are omitted and accepts exact task-local routing when the caller supplies
it.

## Implemented

- `run_task.service_tier` added as Codex-only `standard | priority`.
- Explicit service tier is forwarded to native Codex
  `thread/start.serviceTier` and `turn/start.serviceTier`.
- DSH + service tier fails closed with the existing Codex-only routing guard.
- Task views and durable execution receipts preserve explicit non-secret
  `service_tier` provenance.
- Existing omitted-field behavior is unchanged.
- AGENTS, architecture and tool docs are aligned to the caller/global boundary.

## Verification

```text
npm run typecheck: PASS
npm run build: PASS
focused affected tests: 113 PASS / 0 FAIL
full npm test: 383 tests / 378 PASS / 0 FAIL / 5 platform skips
```

## Feature checkpoint

```text
WT     = D:\WORKTREE_ZONE\engineering-bridge-profile-routing-20260911
branch = feature/bridge-goal-routing-profile-20260911
base   = origin/main@6a43f4a33f6d4860f29c939c7e8a40f4054cee47
```

At handoff-writing time the feature commit is pending C/P. After C/P, Git HEAD
is authoritative.

## Production constraint

Current live Bridge is `1.4.2-biaogu.2` from commit
`6a741c7ca914354bdaab9ac508a8cada6515ae51`, which is not an ancestor of current
source `origin/main`. Do not replace production directly from source main or the
existing biaogu.2 full-access/runtime delta would be lost.

Production promotion must create the next release from the live biaogu.2 source,
apply this service-tier contract on top, verify it, then promote through the
existing painless-upgrade path. After promotion, set the machine-global Bridge
profile to exact Luna/MAX/priority at an I/W boundary and verify both:

- ordinary/B-C-D route -> Luna/MAX/priority;
- explicit A-agent route -> Astra/LOW/standard.

Owner has already authorized C/P/I/W for this bounded alignment. A fresh
session can continue from this handoff plus repository/runtime state without any
prior Codex thread.
