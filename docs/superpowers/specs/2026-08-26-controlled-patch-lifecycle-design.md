# Engineering Bridge Controlled Patch Lifecycle Design

## Design Status

This document records the approved minimum architecture for the controlled-patch task/proposal lifecycle at baseline `d0e0af9c7affe7d1c132fe8bc288621fd710f723`. It is an architecture contract, not an implementation plan. It preserves the current public behavior while correcting one durability ordering defect and removing repeated retention work during startup restoration.

## 1. Scope

This design covers only:

- durable `applied` proposal state before task pin release;
- bulk hydration of retained controlled-patch task records;
- preservation of the existing durable-before-visible terminal barrier;
- explicit ownership between `ControlledPatchService` and `RegisteredWorkspaceTaskService`.

This design does not cover:

- interactive task lifecycle refactoring or unification with legacy/controlled-patch tasks;
- persistence revisions, snapshot coalescing, durable revision waiters, or stale-snapshot arbitration;
- active proposal cleanup, expiry, TTL, or discard semantics;
- output or evidence bounds;
- child shutdown or orphan cleanup;
- the controlled-patch clean-worktree gate;
- persisted observability;
- Long Task behavior;
- public MCP API changes;
- a database, scheduler, state machine, watchdog, or new subsystem.

## 2. Lifecycle Ownership

`ControlledPatchService` remains the proposal domain owner. It owns proposal metadata, output, provenance, persistence, applying/applied recovery, proposal retention policy, and the lifecycle decision to pin or release a task.

`RegisteredWorkspaceTaskService` remains the task execution and presentation owner. It owns executor scheduling and control, task state and views, terminal publication, mechanical storage of task pins, and generic task-history retention.

The task service does not infer proposal lifecycle state. The proposal service decides whether a controlled-patch task must remain pinned and invokes the task service's existing mechanical pin/release capability. Interactive and legacy/controlled-patch task models remain separate.

## 3. Durable-Before-Visible Terminal Invariant

The existing terminal ordering is a required regression invariant:

```text
executor terminal
  -> proposal domain state durable
  -> task terminal visible/ready
```

The awaited terminal callback already expresses this barrier. While proposal completion persistence is pending, the task remains non-terminal and `ready:false`. If proposal completion cannot be made durable, the task must not expose an unretained completed proposal; it reaches the existing safe failed terminal result instead.

This contract is recorded as:

```text
RED-5a
existing GREEN invariant:
durable proposal completion precedes task terminal visibility
```

No `DomainCommitBarrier` class, `terminalizing` state, or other public or private lifecycle state is introduced.

## 4. Applied Durability Before Task Release

The current defect is an ordering problem: in-memory applied metadata is updated, the task is unpinned, and only then is final applied metadata persisted. Generic retention can therefore release or evict a task before the proposal lifecycle state that justifies that release is durable.

The required order is:

```text
durable applying
  -> preflight
  -> git apply
  -> update in-memory applied metadata/history
  -> persist final applied metadata
  -> unpin task
  -> return applied
```

The governing invariant is:

```text
durable proposal lifecycle state must never lag behind task release/retention state
```

This contract is recorded as:

```text
RED-5b
correctness:
durable applied state precedes task unpin/release
```

While final applied persistence is pending, the task remains pinned and queryable. If final applied persistence fails, the task must not enter a state where it has been released because of an `applied` transition that is not durable. Existing final-persistence error and recovery behavior remains authoritative; this design changes only the point at which unpin is allowed.

The existing `applying` crash-recovery contract does not change:

- a crash before the patch changes the worktree can recover `applying` to `proposed` when the forward apply check succeeds;
- a crash after the patch changes the worktree can recover `applying` to `applied` when the reverse apply check succeeds;
- an ambiguous worktree remains `recovery_conflict` and is not re-applicable;
- a crash after final `applied` persistence but before in-memory unpin is safe, because restart restores the durable applied proposal as an unpinned terminal task.

No additional lifecycle state is needed for any of these windows.

## 5. Bulk Retained-Task Hydration

The retained-state parser already validates the state envelope and proposal records as a collection. Startup restoration should continue that batch-oriented flow instead of invoking global task-history retention after every restored record.

The required restoration flow is:

```text
parse and validate retained state
  -> reconcile all applying records
  -> build the complete task restoration batch
  -> validate the batch in the task service
  -> install the complete batch
  -> run one generic retention phase
```

The task service may gain one internal bulk restore/hydration API. This design intentionally does not prescribe its method name or require a supporting class.

The batch contract is:

- validate the complete batch before installing any member;
- do not leave a partially installed task batch if validation fails;
- preserve the task result, output, executor identity, and submitted/generated provenance of every accepted record;
- keep active pinned proposal tasks reachable through generic task retention;
- apply the existing terminal-history cap and ordering to unpinned terminal tasks;
- preserve current `proposed`, `applied`, and `recovery_conflict` task-view semantics;
- preserve state-file version 1 compatibility.

Running generic retention once after the batch is installed is an implementation target that removes the deterministic `1 + 2 + ... + P` restoration scans. It is not a public correctness state and must not be enforced by a production counter or test-only production hook.

This contract is recorded as:

```text
PERF-RESTORE-1
bulk retained controlled-patch task hydration avoids repeated global retention
```

## 6. Persistence Contract

The persistence design remains unchanged:

- state-file version 1;
- full-state snapshots;
- the existing serialized persistence queue;
- atomic temporary-file replacement;
- the existing applying/applied recovery rules;
- the existing applied-history cap.

The proposal map and retained state file remain the proposal-domain source of truth. Task pins are derived runtime retention controls, not a second durable proposal lifecycle record.

No state-file migration is required. Reordering final persistence before unpin changes no serialized fields, and bulk hydration changes only how already parsed records are installed in memory.

## 7. Failure and Visibility Semantics

Proposal completion and APPLY have distinct visibility boundaries:

- proposal completion becomes task-terminal only after its proposal output and metadata are durable;
- APPLY may change the worktree after durable `applying`, but may release the retained task only after durable `applied`;
- persistence failure before terminal publication produces the existing safe failed task result rather than a completed task with missing durable proposal data;
- persistence failure after `git apply` never authorizes early unpin; existing retry and restart recovery determine the durable proposal outcome;
- batch hydration validation failure installs no portion of the task batch.

These rules do not add a public transitional state. Callers continue to observe only the existing task and proposal results.

## 8. Performance Boundaries

Controlled-patch proposal completion and ordinary interactive execution have different terminal paths and must remain separate measurements:

```text
PERF-1
controlled-patch executor terminal
  -> durable proposal
  -> task terminal
```

```text
PERF-2
Codex turn/completed
  -> waiting_for_supervisor_review
```

PERF-1 includes the proposal durability barrier. PERF-2 does not use the controlled-patch proposal persistence path. Results from one metric must not be attributed to the other.

Persistence queue amplification remains only a future diagnostic candidate. It may re-enter architecture design only after a deterministic benchmark or reproduction attributes material PERF-1 latency to redundant queued full-snapshot writes and demonstrates that any replacement can preserve caller-specific durability acknowledgement.

Active proposal cleanup remains a future product-design question. It may re-enter only after the product defines when a proposal that can still be refined or applied becomes invalid and specifies the resulting `task_result`, refine, APPLY, and restart semantics. The current applied-history cap remains in force.

## 9. Behavioral Verification Boundaries

Future implementation tests must verify behavior and data-integrity boundaries rather than private helper names or pin-set internals.

### RED-5b: durable applied before release

When final applied persistence is deferred:

- the proposal task remains queryable through the existing task view/result surface;
- the task remains retained even when generic terminal history is at its cap;
- successful final persistence is the earliest point at which release is allowed;
- failed final persistence cannot produce the inconsistent combination of non-durable `applied` metadata and a task already released by retention.

The test observes task reachability and the durable retained state. It must not inspect the private pin set.

### RED-5a: preserve the existing terminal barrier

Regression coverage must continue to prove that a pending proposal completion callback leaves the task non-terminal and not ready, that successful durability precedes completed visibility, and that persistence failure does not expose an unretained completed proposal. This is already GREEN behavior; implementation must not replace it with a new state or barrier object.

### PERF-RESTORE-1: preserve restoration semantics while batching

Restoration coverage must use a mixed retained set containing:

- `proposed`, `applied`, and `recovery_conflict` records;
- generated and submitted provenance;
- retained executor identity and source semantics.

After hydration:

- active pinned proposal tasks remain reachable;
- unpinned terminal history follows the existing cap and ordering;
- task results, proposal output, executor identity, and source provenance match current behavior;
- state-file version 1 records remain compatible;
- recovery-conflict tasks remain failed and non-applicable.

No production instrumentation is added to count retention invocations. The one-phase retention objective is verified by the implementation structure, while tests protect the externally observable restoration result.

## 10. Rejected / Deferred Architecture

- **New class:** rejected because the current proven correctness and restoration defects can be fixed inside the two existing owners without another class.
- **New lifecycle state:** rejected because the current proven defects can be fixed with ordering and batching while preserving the existing task and proposal states.
- **Database:** rejected because the current proven defects can be fixed with the existing version 1 state file and in-process services.
- **State migration:** rejected because the current proven defects require no serialized-field or version change.
- **Revisioned persistence:** rejected because the current proven defects can be fixed without durable revisions, revision waiters, or stale-snapshot arbitration.
- **Snapshot coalescing:** deferred because the current proven defects can be fixed without it and no deterministic evidence identifies queued snapshot amplification as the active bottleneck.
- **Persistence coordinator class:** rejected because the current proven defects can be fixed while retaining the existing serialized persistence queue and atomic replacement path.
- **Task model unification:** rejected because the current proven defects are confined to the legacy/controlled-patch seam and do not require changing interactive lifecycle behavior.
- **Cleanup TTL or discard policy:** deferred because the current proven defects can be fixed without cleanup and no product contract defines when an active proposal expires.
- **Public API change:** rejected because the current proven defects can be fixed without changing MCP tools, schemas, task states, or returned lifecycle semantics.
