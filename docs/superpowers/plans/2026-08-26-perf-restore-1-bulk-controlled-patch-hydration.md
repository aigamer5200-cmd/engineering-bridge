# PERF-RESTORE-1 Bulk Controlled-Patch Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore all retained controlled-patch tasks as one validated batch so startup performs one generic legacy-terminal retention phase instead of one growing global scan per retained proposal.

**Architecture:** `ControlledPatchService.load()` continues to own version-1 parsing, quarantine, applying-state reconciliation, proposal state, and the decision to pin each task. It builds a complete in-memory task restoration batch and passes it once to a small internal `RegisteredWorkspaceTaskService.restoreControlledPatchTasks(...)` operation, which validates every ID before mutation, installs the whole batch, and invokes the existing retention policy once. No public API, persisted field, lifecycle state, class, rollback framework, or retention instrumentation is added.

**Tech Stack:** TypeScript 5.8, Node.js 22 built-in test runner, existing `Map`/`Set` task storage, existing version-1 JSON retained state.

**Spec:** `docs/superpowers/specs/2026-08-26-controlled-patch-lifecycle-design.md`

## Global Constraints

- Baseline is clean `HEAD 6e26288250cecfe8666b4cdbca7cd5ab272cc259`.
- Implement only `PERF-RESTORE-1`: bulk retained controlled-patch task hydration avoids repeated global retention.
- Do not reopen or change RED-5b or RED-5a.
- Preserve state-file version 1, full-state snapshots, the existing persistence queue, atomic replacement, applying/applied recovery, and the applied-history cap.
- Preserve the durable-before-visible terminal barrier and the durable-applied-before-unpin ordering already present at this baseline.
- Do not add a production counter, public hook, test-only production API, instrumentation state, or benchmark framework to count retention calls.
- Do not add a database, class, subsystem, lifecycle state, migration, public MCP API, interactive lifecycle unification, persistence revision/coalescing, persistence-queue redesign, cleanup/TTL, output/evidence bounds, child shutdown/orphan cleanup, Long Task work, clean-worktree work, or unrelated refactoring.
- Implementation scope is exactly two source files and two unit-test files listed below.
- Every task stops at the commit gate. Do not stage or commit until the user explicitly says `COMMIT`.

---

## Current Source Facts at the Baseline

1. `ControlledPatchService.load()` parses the version-1 envelope as a collection, reconciles retained `applying` records, and then loops over `retainedState.proposals` (`src/tasks/controlled-patch-service.ts:88-149`). Inside that loop it immediately mutates `this.proposals` and calls either `restoreControlledPatchTaskFailure(...)` or `restoreControlledPatchTask(...)` once per retained proposal.
2. Both singular restore operations append one ID to `legacyTerminalTaskIds` and immediately call `trimLegacyTerminalTasks()` (`src/tasks/registered-workspace-task-service.ts:134-169`). The trim filters the complete legacy terminal ID list, filters it again for unpinned IDs, deletes the oldest overflow, and rebuilds the ID list (`src/tasks/registered-workspace-task-service.ts:410-422`). Restoring `P` retained records therefore scans growing global histories after records 1 through `P`, producing the deterministic `1 + 2 + ... + P` work.
3. A restored successful task is installed as a completed `RegisteredWorkspaceTaskResult` whose output is the retained proposal output. A restored recovery conflict is installed as a failed result with serialized `APPLY_RECOVERY_CONFLICT`.
4. The current retained-state-to-task mapping is:

| Retained proposal fact | Restored task fact |
|---|---|
| `proposed` | completed result with retained output; pinned |
| reconciled `applying -> proposed` | completed result with retained output; pinned |
| `applied` or reconciled `applying -> applied` | completed result with retained output; unpinned |
| `recovery_conflict` or reconciled `applying -> recovery_conflict` | failed result with `APPLY_RECOVERY_CONFLICT`; unpinned and not re-applicable |
| generated record with `executor: "codex" | "dsh"` | same executor identity; no `source` field |
| legacy generated record with no executor field | `executor: "codex"` |
| submitted record with `source: "submitted"` and no executor | `source: "submitted"`; no executor property |

5. The generic legacy terminal cap is exactly 100 **unpinned** terminal records. Pinned terminal tasks do not consume that allowance. Among unpinned terminal tasks, insertion order is authoritative and the oldest overflow is evicted. Queued/running legacy records and all interactive records use separate paths and are not candidates in this trim.
6. Collision handling is currently per singular call: either an existing legacy task ID or an existing interactive task ID throws `INTERNAL_ERROR`. `parseRetainedState(...)` already rejects duplicate proposal IDs inside a valid retained file, but the task service has no batch preflight. With a future naive loop-based batch, a later collision could be discovered after earlier records were installed. The minimal protection is a single validation pass over the complete batch, including a local `Set` for duplicate batch IDs, before any task, pin, or history mutation. No rollback or state machine is necessary because the install loop has no expected failure after validation.
7. Existing tests separately cover single restored generated output, dsh/codex identity, submitted provenance, version-1 validation/quarantine, applying recovery in all three outcomes, recovery-conflict rejection, and generic cap behavior. They do not characterize one mixed retained load above the cap, and they do not cover all-or-nothing validation of a bulk task restore operation.

## File Map

- Modify `src/tasks/registered-workspace-task-service.ts:40-176,410-422` — define the small internal batch input, validate it completely, install it, and invoke existing retention once.
- Modify `src/tasks/controlled-patch-service.ts:15-18,88-149` — build the complete reconciled proposal/task batches and call the plural restore operation once.
- Modify `tests/unit/tasks/registered-workspace-task-service.test.ts:807-881,980-1017` — add the RED all-or-nothing collision test and retain the existing single-restore compatibility assertions.
- Modify `tests/unit/tasks/controlled-patch-service.test.ts:1112-1132,2258-2340` — add the mixed version-1 hydration characterization/regression while keeping the existing applying-recovery tests.
- Read only `docs/superpowers/specs/2026-08-26-controlled-patch-lifecycle-design.md` — authoritative contract; do not modify it.

---

### Task 1: Characterize the Mixed Version-1 Restore Semantics

**Files:**
- Test: `tests/unit/tasks/controlled-patch-service.test.ts:1112-1132,2258-2340`
- Reference: `src/tasks/controlled-patch-service.ts:88-149`
- Reference: `src/tasks/registered-workspace-task-service.ts:134-169,410-422`

**Interfaces:**
- Consumes: existing `retainedRecord(...)`, `writeRetainedState(...)`, `ControlledPatchService.load()`, `taskView(...)`, `result(...)`, and `apply(...)`.
- Produces: one behavior-level test that remains valid before and after the performance refactor and deliberately does not observe private retention invocation counts.

- [ ] **Step 1: Add a deterministic retained-task ID helper near `retainedRecord(...)`**

```ts
function retainedTaskId(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}
```

The fixed UUID-v4 prefix keeps every generated test ID valid under `isId(...)`, while the numeric suffix makes retention order readable.

- [ ] **Step 2: Add a passing characterization for a mixed retained batch above the generic terminal cap**

Add a test named:

```ts
test("bulk hydration preserves mixed retained task semantics and terminal ordering", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();

  const oldestAppliedId = retainedTaskId(1);
  const oldestConflictId = retainedTaskId(2);
  const appliedTaskIds = [
    oldestAppliedId,
    ...Array.from({ length: 99 }, (_, index) => retainedTaskId(index + 3))
  ];
  const recentDshAppliedId = appliedTaskIds.at(-2)!;
  const recentSubmittedAppliedId = appliedTaskIds.at(-1)!;
  const proposedDshId = retainedTaskId(102);
  const proposedSubmittedId = retainedTaskId(103);
  const recentConflictId = retainedTaskId(104);

  const appliedRecords = appliedTaskIds.map((taskId) => retainedRecord(taskId, root, head, {
    state: "applied",
    output: `applied:${taskId}\n`
  }));
  appliedRecords[appliedRecords.length - 2] = retainedRecord(recentDshAppliedId, root, head, {
    state: "applied",
    executor: "dsh",
    output: "dsh applied output\n"
  });
  appliedRecords[appliedRecords.length - 1] = retainedRecord(recentSubmittedAppliedId, root, head, {
    state: "applied",
    executor: undefined,
    source: "submitted",
    output: "submitted applied output\n"
  });

  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: appliedTaskIds,
    proposals: [
      appliedRecords[0]!,
      retainedRecord(oldestConflictId, root, head, {
        state: "recovery_conflict",
        output: "old conflict output\n"
      }),
      ...appliedRecords.slice(1),
      retainedRecord(proposedDshId, root, head, {
        executor: "dsh",
        output: "dsh proposed output\n"
      }),
      retainedRecord(proposedSubmittedId, root, head, {
        executor: undefined,
        source: "submitted",
        output: "submitted proposed output\n"
      }),
      retainedRecord(recentConflictId, root, head, {
        state: "recovery_conflict",
        executor: "dsh",
        output: "recent conflict output\n"
      })
    ]
  });
  const originalState = readFileSync(stateFilePath, "utf8");
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => { throw new Error("restored tasks must not execute"); }
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);

  await controlled.load();

  // There are 102 unpinned terminal records. Existing ordering evicts the
  // oldest applied record and oldest conflict, leaving exactly the newest 100.
  assert.equal(tasks.taskView(oldestAppliedId), undefined);
  assert.equal(tasks.result(oldestAppliedId), undefined);
  assert.equal(tasks.taskView(oldestConflictId), undefined);
  for (const taskId of appliedTaskIds.slice(1)) assert.notEqual(tasks.taskView(taskId), undefined);

  // Proposed tasks are pinned before retention and remain reachable above cap.
  assert.deepEqual(tasks.taskView(proposedDshId), {
    taskId: proposedDshId,
    state: "completed",
    executor: "dsh",
    ready: true,
    output: "dsh proposed output\n"
  });
  assert.deepEqual(tasks.result(proposedDshId), {
    id: proposedDshId,
    state: "completed",
    output: "dsh proposed output\n"
  });
  assert.deepEqual(tasks.taskView(proposedSubmittedId), {
    taskId: proposedSubmittedId,
    state: "completed",
    source: "submitted",
    ready: true,
    output: "submitted proposed output\n"
  });
  assert.equal("executor" in (tasks.taskView(proposedSubmittedId) ?? {}), false);

  // Unpinned retained records preserve output and provenance when they survive.
  assert.equal(tasks.taskView(recentDshAppliedId)?.executor, "dsh");
  assert.equal(tasks.taskView(recentDshAppliedId)?.output, "dsh applied output\n");
  assert.equal(tasks.taskView(recentSubmittedAppliedId)?.source, "submitted");
  assert.equal("executor" in (tasks.taskView(recentSubmittedAppliedId) ?? {}), false);
  assert.deepEqual(tasks.result(recentSubmittedAppliedId), {
    id: recentSubmittedAppliedId,
    state: "completed",
    output: "submitted applied output\n"
  });

  assert.deepEqual(tasks.taskView(recentConflictId), {
    taskId: recentConflictId,
    state: "failed",
    executor: "dsh",
    ready: true,
    error: {
      code: "APPLY_RECOVERY_CONFLICT",
      message: "The applied patch state could not be recovered safely."
    }
  });
  assert.equal(tasks.result(recentConflictId)?.state, "failed");
  await expectCode(
    () => controlled.apply({ patch_task_id: recentConflictId, confirmation: "APPLY" }),
    "INVALID_STATE_TRANSITION"
  );

  // No applying record exists, so load must accept version 1 without migration
  // or a compatibility rewrite.
  assert.equal(readFileSync(stateFilePath, "utf8"), originalState);
});
```

- [ ] **Step 3: Run the characterization before changing production code**

Run:

```bash
npm run build
node --test --test-name-pattern="bulk hydration preserves mixed retained task semantics and terminal ordering" dist/tests/unit/tasks/controlled-patch-service.test.js
```

Expected: PASS on the existing singular restore implementation. This is intentionally a GREEN characterization: PERF-RESTORE-1 is a complexity refactor, not a fabricated correctness defect.

- [ ] **Step 4: STOP AT COMMIT GATE**

```text
STOP AT COMMIT GATE
Report diff/tests/status.
Do not stage or commit until explicit COMMIT.
```

---

### Task 2: Add One Validate-Then-Install Task-Service Batch Operation

**Files:**
- Test: `tests/unit/tasks/registered-workspace-task-service.test.ts:858-881,980-1017`
- Modify: `src/tasks/registered-workspace-task-service.ts:40-176,410-422`

**Interfaces:**
- Consumes: `RegisteredWorkspaceTaskResult`, `ExecutorName`, existing `tasks`, `interactive`, `pinnedTaskIds`, `legacyTerminalTaskIds`, and `trimLegacyTerminalTasks()`.
- Produces: `ControlledPatchTaskRestore` and `restoreControlledPatchTasks(restorations: readonly ControlledPatchTaskRestore[]): void`.
- Preserves: `restoreControlledPatchTask(...)` as the one-record completed wrapper used by `submitControlledPatchTask(...)`.

- [ ] **Step 1: Write the RED atomic-validation test**

Add this next to the existing singular restore tests:

```ts
test("bulk controlled-patch restore validates the complete batch before installing any task", () => {
  const service = new RegisteredWorkspaceTaskService(registry(), () => {
    throw new Error("restored tasks must not execute");
  });
  const existingId = "00000000-0000-4000-8000-000000000001" as Id;
  const freshId = "00000000-0000-4000-8000-000000000002" as Id;
  service.restoreControlledPatchTask(existingId, "existing output", true, "codex");

  assert.throws(
    () => service.restoreControlledPatchTasks([
      {
        result: { id: freshId, state: "completed", output: "fresh output" },
        pinned: true,
        executor: "dsh"
      },
      {
        result: {
          id: existingId,
          state: "failed",
          error: { code: "APPLY_RECOVERY_CONFLICT", message: "conflict" }
        },
        pinned: false,
        executor: "codex"
      }
    ]),
    (error: unknown) => error instanceof CoreError && error.code === "INTERNAL_ERROR"
  );

  assert.equal(service.taskView(freshId), undefined);
  assert.equal(service.result(freshId), undefined);
  assert.deepEqual(service.taskView(existingId), {
    taskId: existingId,
    state: "completed",
    executor: "codex",
    ready: true,
    output: "existing output"
  });
});
```

This uses a real later collision with an already installed legacy task. The same prevalidation pass must also reject an ID already present in `interactive` and duplicate IDs inside the incoming batch; those are branches of the same ID-availability predicate, not separate transaction machinery.

- [ ] **Step 2: Run the RED test and verify the expected failure**

Run:

```bash
npm run build
```

Expected: FAIL with TypeScript reporting that `restoreControlledPatchTasks` does not exist. This is the only new correctness boundary: a batch operation must not partially install when a late member collides.

- [ ] **Step 3: Add the smallest batch input type**

Place this beside the existing task result and executor types:

```ts
export type ControlledPatchTaskRestore = {
  readonly result: RegisteredWorkspaceTaskResult;
  readonly pinned: boolean;
  readonly executor?: ExecutorName | undefined;
  readonly source?: "submitted" | undefined;
};
```

The type carries only values already required to reproduce the current task record. Do not add proposal state, workspace metadata, callbacks, counters, or retention policy to it; those remain owned by `ControlledPatchService` or the existing task-service retention code.

- [ ] **Step 4: Implement complete validation, complete installation, then one trim**

Add the plural operation and make both existing singular restores one-element wrappers so this task remains independently buildable:

```ts
restoreControlledPatchTasks(restorations: readonly ControlledPatchTaskRestore[]): void {
  if (restorations.length === 0) return;
  const batchTaskIds = new Set<Id>();
  for (const { result } of restorations) {
    if (batchTaskIds.has(result.id) || this.tasks.has(result.id) || this.interactive.has(result.id)) {
      throw new CoreError("INTERNAL_ERROR");
    }
    batchTaskIds.add(result.id);
  }

  for (const { result, pinned, executor, source } of restorations) {
    const restoredExecutor = source === "submitted" ? undefined : executor ?? "codex";
    const record: TaskRecord = result.state === "completed"
      ? {
        state: "completed",
        executor: restoredExecutor,
        ...(source === undefined ? {} : { source }),
        result
      }
      : {
        state: "failed",
        executor: restoredExecutor,
        ...(source === undefined ? {} : { source }),
        result
      };
    this.tasks.set(result.id, record);
    this.legacyTerminalTaskIds.push(result.id);
    if (pinned) this.pinnedTaskIds.add(result.id);
  }
  this.trimLegacyTerminalTasks();
}

restoreControlledPatchTask(
  taskId: Id,
  output: string,
  pinned: boolean,
  executor: ExecutorName | undefined = "codex",
  source?: "submitted"
): void {
  this.restoreControlledPatchTasks([{
    result: { id: taskId, state: "completed", output },
    pinned,
    executor,
    source
  }]);
}

restoreControlledPatchTaskFailure(
  taskId: Id,
  error: SerializedError,
  executor: ExecutorName | undefined = "codex",
  source?: "submitted"
): void {
  this.restoreControlledPatchTasks([{
    result: { id: taskId, state: "failed", error },
    pinned: false,
    executor,
    source
  }]);
}
```

The empty-batch return preserves the current no-op behavior of loading an empty retained proposal collection; every non-empty batch reaches exactly one trim. The failure wrapper is temporary compatibility for the current `load()` caller; Task 3 removes it as soon as the load path uses the plural method. Do not add a skip-retention flag, rollback path, helper class, or separate validation abstraction. The preflight loop is the atomicity boundary; after it succeeds, installation consists only of in-memory `Map`, array, and `Set` mutations followed by the existing trim.

- [ ] **Step 5: Run the task-service test file**

```bash
npm run build
node --test dist/tests/unit/tasks/registered-workspace-task-service.test.js
```

Expected: PASS, including the new no-partial-install test and existing cap, executor, submitted-source, `taskView()`, and `result()` tests.

- [ ] **Step 6: STOP AT COMMIT GATE**

```text
STOP AT COMMIT GATE
Report diff/tests/status.
Do not stage or commit until explicit COMMIT.
```

---

### Task 3: Build and Install One Reconciled Restore Batch in `load()`

**Files:**
- Modify: `src/tasks/controlled-patch-service.ts:15-18,88-149`
- Test: `tests/unit/tasks/controlled-patch-service.test.ts:1112-1132,2258-2340`
- Test: `tests/unit/tasks/registered-workspace-task-service.test.ts:858-881,980-1017`

**Interfaces:**
- Consumes: `ControlledPatchTaskRestore`, `restoreControlledPatchTasks(...)`, `parseRetainedState(...)`, `applyCheck(...)`, `serializeError(...)`, and the existing proposal/apply-history fields.
- Produces: a `load()` path with one task-service hydration call after all applying records are reconciled.
- Preserves: the existing persisted proposal representation, reconciliation persistence, proposal map semantics, applied-history ordering, task results, output, executor/source provenance, and pin decisions.

- [ ] **Step 1: Import the batch input type and build local complete batches**

Change the task-service import to include the new type:

```ts
import {
  RegisteredWorkspaceTaskService,
  type ControlledPatchTaskRestore,
  type ExecutorName
} from "./registered-workspace-task-service.js";
```

After parsing retained state, keep reconciliation in the same proposal order but accumulate locally:

```ts
const appliedProposalTaskIds = new Set(retainedState.appliedTaskIds);
const restoredProposals: Array<readonly [Id, Proposal]> = [];
const restoredTasks: ControlledPatchTaskRestore[] = [];
let reconciledApplyingProposal = false;

for (const { taskId, output, ...proposal } of retainedState.proposals) {
  let restoredState = proposal.state;
  if (proposal.state === "applying") {
    reconciledApplyingProposal = true;
    if (await this.applyCheck(proposal.workspaceRoot, output, false)) {
      restoredState = "proposed";
      appliedProposalTaskIds.delete(taskId);
    } else if (await this.applyCheck(proposal.workspaceRoot, output, true)) {
      restoredState = "applied";
      appliedProposalTaskIds.add(taskId);
    } else {
      restoredState = "recovery_conflict";
      appliedProposalTaskIds.delete(taskId);
    }
  }

  restoredProposals.push([taskId, { ...proposal, state: restoredState, output }]);
  const provenance = proposal.executor === undefined
    ? { executor: undefined, source: "submitted" as const }
    : { executor: proposal.executor };
  restoredTasks.push(restoredState === "recovery_conflict"
    ? {
      result: {
        id: taskId,
        state: "failed",
        error: serializeError(new CoreError("APPLY_RECOVERY_CONFLICT"))
      },
      pinned: false,
      ...provenance
    }
    : {
      result: { id: taskId, state: "completed", output },
      pinned: restoredState !== "applied",
      ...provenance
    });
}
```

Do not call either singular restore operation inside this loop. Do not mutate `this.proposals` inside this loop; the locally complete arrays make the later task-service validation boundary explicit.

- [ ] **Step 2: Install once, then publish the restored proposal map and existing applied history**

Immediately after the loop:

```ts
this.tasks.restoreControlledPatchTasks(restoredTasks);
for (const [taskId, proposal] of restoredProposals) this.proposals.set(taskId, proposal);
this.appliedProposalTaskIds = [...appliedProposalTaskIds];
if (reconciledApplyingProposal) await this.persist();
```

The task service validates the complete batch before installing any member. A collision therefore leaves its task map, pin set, and legacy terminal history untouched. The proposal service also has not published any restored proposal before task validation succeeds. No rollback is required because all fallible reconciliation work and all collision validation occur before publication; the subsequent proposal `Map.set(...)` loop has no expected validation failure.

Keep the existing post-reconciliation `persist()` exactly where its semantics require it: after task/proposal hydration when at least one retained `applying` record was reconciled. Persistence queue behavior and recovery rules are outside PERF-RESTORE-1.

- [ ] **Step 3: Remove the obsolete failure-only singular restore operation**

Confirm the plural path is the only recovery-conflict hydration caller, then remove `restoreControlledPatchTaskFailure(...)` from `registered-workspace-task-service.ts`.

Run:

```bash
rg -n "restoreControlledPatchTaskFailure" src tests
```

Expected: no matches. Keep `restoreControlledPatchTask(...)` because `submitControlledPatchTask(...)` still uses it for a real one-record runtime registration.

- [ ] **Step 4: Run focused restoration and recovery tests**

Run:

```bash
npm run build
node --test --test-name-pattern="restore|retained|recovery|bulk hydration" dist/tests/unit/tasks/controlled-patch-service.test.js
node --test dist/tests/unit/tasks/registered-workspace-task-service.test.js
```

Expected: PASS. In particular:

- the new mixed version-1 characterization passes;
- active proposed generated/submitted tasks remain reachable above the unpinned cap;
- the oldest unpinned terminal tasks are evicted and the newest 100 survive in insertion order;
- dsh/codex/submitted identity and output are unchanged in both `taskView()` and `result()`;
- recovery conflicts remain failed with `APPLY_RECOVERY_CONFLICT` and reject APPLY;
- all three existing applying-reconciliation tests pass without state or persistence changes;
- the batch collision test proves no partial task installation.

- [ ] **Step 5: Perform the structural PERF-RESTORE-1 acceptance check**

Review `ControlledPatchService.load()` and `restoreControlledPatchTasks(...)` directly. The accepted structure must show:

```text
one proposal reconciliation/build loop
-> one restoreControlledPatchTasks(restoredTasks) call
-> one installation loop inside the task service
-> one trimLegacyTerminalTasks() call after that loop
```

Use:

```bash
rg -n "restoreControlledPatchTasks|restoreControlledPatchTask\(|trimLegacyTerminalTasks" src/tasks/controlled-patch-service.ts src/tasks/registered-workspace-task-service.ts
```

Acceptance is code-review structural evidence, not a runtime call-count assertion. The load path must contain exactly one plural hydration call and no singular restore call in its proposal loop. The plural method must contain one retention call after installation. Other legitimate runtime sites (`unpinTask`, terminal completion, the one-record submit wrapper) continue to invoke retention as before.

If performance diagnostics are desired after implementation, use a one-off local timing or CPU profile against synthetic version-1 state sizes and report it as non-gating evidence. Do not add benchmark files, dependencies, counters, hooks, or timing thresholds for this item.

- [ ] **Step 6: STOP AT COMMIT GATE**

```text
STOP AT COMMIT GATE
Report diff/tests/status.
Do not stage or commit until explicit COMMIT.
```

---

### Task 4: Full Verification and Scope Audit

**Files:**
- Verify: `src/tasks/registered-workspace-task-service.ts`
- Verify: `src/tasks/controlled-patch-service.ts`
- Verify: `tests/unit/tasks/registered-workspace-task-service.test.ts`
- Verify: `tests/unit/tasks/controlled-patch-service.test.ts`

**Interfaces:**
- Consumes: the completed changes from Tasks 1-3.
- Produces: final build/test/diff/status evidence without staging or committing.

- [ ] **Step 1: Run type and behavior verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: both commands exit 0 and the complete unit suite passes.

- [ ] **Step 2: Audit formatting, scope, and forbidden additions**

Run:

```bash
git diff --check
git diff -- src/tasks/registered-workspace-task-service.ts src/tasks/controlled-patch-service.ts tests/unit/tasks/registered-workspace-task-service.test.ts tests/unit/tasks/controlled-patch-service.test.ts
git status --porcelain=v1
```

Expected:

- `git diff --check` exits 0;
- the implementation diff contains only the two source files and two test files;
- no production counter, hook, instrumentation field, benchmark framework, new class, state, migration, database, public MCP change, persistence redesign, RED-5a/RED-5b change, or unrelated refactor appears;
- the plan file may remain as the only additional documentation path from the planning turn;
- nothing is staged.

- [ ] **Step 3: Re-run the YAGNI challenge**

For every new line or type, verify its present job:

- `ControlledPatchTaskRestore` exists only to carry the current result/pin/provenance fields across the one internal batch seam.
- `restoreControlledPatchTasks(...)` exists only because the deterministic repeated-retention defect cannot be removed while `load()` calls the singular trim-owning method per record.
- the validation pass exists only to guarantee validate-entire-batch before install and covers existing legacy/interactive collisions plus same-batch duplicates.
- local `restoredProposals` and `restoredTasks` exist only to finish reconciliation before publication and to make the complete-batch boundary explicit.
- every other proposed abstraction or helper is absent.

If any added abstraction is not required by one of those statements, remove it and rerun Step 1.

- [ ] **Step 4: STOP AT COMMIT GATE**

```text
STOP AT COMMIT GATE
Report diff/tests/status.
Do not stage or commit until explicit COMMIT.
```

The final implementation report must include the exact test commands and outcomes, the structural one-retention-phase evidence, the complete file list, `git diff --check`, and raw `git status --porcelain=v1`. Stop there; do not stage, commit, or push.
