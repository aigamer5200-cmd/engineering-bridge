# RED-5b Durable Applied Before Unpin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a controlled-patch task remains pinned and queryable until the proposal's final `applied` metadata is durably persisted, including while the existing recovery retry is pending.

**Architecture:** Keep the existing `ControlledPatchService` and `RegisteredWorkspaceTaskService` ownership split. Change only the ordering inside `ControlledPatchService.apply()`: update in-memory applied metadata/history, complete the existing final persistence attempt or recovery retry, then invoke the existing task unpin operation. The existing states, persistence queue, state-file schema, crash recovery, return shapes, and public APIs remain unchanged.

**Tech Stack:** TypeScript 5.8, Node.js 22 built-in test runner and strict assertions, existing real Git fixture, existing JSON state-file persistence.

**Spec:** `docs/superpowers/specs/2026-08-26-controlled-patch-lifecycle-design.md` (especially Sections 4, 6, 7, and 9; contract `RED-5b`)

## Global Constraints

- Implement only `RED-5b`: durable final `applied` persistence must precede task unpin/release.
- Required order: durable `applying` -> preflight -> `git apply` -> update in-memory applied metadata/history -> persist final applied metadata -> unpin task -> return applied.
- While final applied persistence is pending or has failed and the existing retry is pending, the proposal task must remain reachable through `taskView()` and `result()` under generic terminal-history pressure.
- Preserve the current applying crash-recovery behavior and the existing metadata-recovery retry/response behavior.
- Do not add a lifecycle state, class, helper service, state-file field/version, public API, persistence revision, snapshot coalescing, or queue optimization.
- Do not change `RegisteredWorkspaceTaskService`, its retention cap, or its pin mechanics; it remains the mechanical retention owner.
- Do not inspect private `pinnedTaskIds` in tests. Assert observable worktree state, durable JSON state, and task reachability instead.
- Do not include PERF-RESTORE-1/bulk hydration, RED-5a, proposal cleanup, RED-6, Long Task, clean-worktree gates, observability, migrations, interactive lifecycle work, or unrelated refactoring.
- Modify only the two files named below. Do not create production abstractions or test helpers for a single ordering gate.
- Do not stage, commit, amend, or push. Every commit step is replaced by the repository's explicit commit gate.

---

## File Map

- Modify: `tests/unit/tasks/controlled-patch-service.test.ts:2116` — add one observable RED-5b timing regression immediately before the existing metadata-recovery test; keep that existing test unchanged.
- Modify: `src/tasks/controlled-patch-service.ts:234-255` — move the existing unpin calls to the two paths that have successfully completed final applied persistence.
- Read-only reference: `src/tasks/registered-workspace-task-service.ts:125-132,384-422` — `unpinTask()` immediately runs legacy terminal retention, whose cap is 100; no edit is planned here.
- No files are created, and no other source or test file is modified.

## Interfaces

- Consumes: `ControlledPatchService.apply(request: { patch_task_id: string; confirmation: string }): Promise<{ patch_task_id: Id; applied: true; changed_paths: string[] }>` and its existing runtime-compatible `metadata_recovered` recovery response.
- Consumes: `RegisteredWorkspaceTaskService.runTask()`, `taskView()`, and `result()` as existing observable retention/query surfaces.
- Produces: no new function, type, state, field, helper, class, or public interface. Only the time at which the existing `unpinTask(taskId)` is called changes.

---

### Task 1: Persist final applied metadata before releasing the task

**Files:**

- Modify: `tests/unit/tasks/controlled-patch-service.test.ts:2116`
- Modify: `src/tasks/controlled-patch-service.ts:234-255`
- Test: `tests/unit/tasks/controlled-patch-service.test.ts`
- Regression reference: `tests/unit/tasks/registered-workspace-task-service.test.ts:807-856`

**Interfaces:**

- Consumes: the existing `fixture()`, `terminal()`, `retainedStateFile()`, actual Git repository fixture, actual state-file writer, and public `taskView()` / `result()` query surfaces.
- Produces: the invariant that every successful path out of the final applied persistence block calls `unpinTask()` only after a durable `applied` snapshot; a failed retry exits without unpinning.

- [ ] **Step 1: Add the focused pending-final-persistence RED-5b regression**

Insert the following test immediately before the existing `reports metadata recovery when final persistence fails after APPLY executes` test. Keep that existing recovery test byte-for-byte unchanged. The fixture has no injected persistence seam, so this test temporarily wraps the current private `replaceStateFile(contents)` method only to delay the first outgoing snapshot in which the target proposal is `applied`. It restores the original method in `finally`, adds no production hook, and makes every correctness assertion through the actual worktree, durable JSON file, `taskView()`, or `result()`.

```ts
test("keeps the task retained while final applied persistence is pending", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const current = fixture(
    root,
    async () => ({ kind: "completed", output: validPatch }),
    undefined,
    stateFilePath
  );
  const generated = await current.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note"
  });
  await terminal(current.tasks, generated.taskId);

  let signalFinalPersistStarted!: () => void;
  const finalPersistStarted = new Promise<void>((resolve) => { signalFinalPersistStarted = resolve; });
  let releaseFinalPersist!: () => void;
  const finalPersistRelease = new Promise<void>((resolve) => { releaseFinalPersist = resolve; });
  const persistence = current.controlled as unknown as {
    replaceStateFile(contents: string): Promise<void>;
  };
  const originalReplaceStateFile = persistence.replaceStateFile;
  persistence.replaceStateFile = async (contents) => {
    const pending = JSON.parse(contents) as {
      proposals: Array<{ task_id: string; state: string }>;
    };
    if (pending.proposals.find(({ task_id }) => task_id === generated.taskId)?.state === "applied") {
      signalFinalPersistStarted();
      await finalPersistRelease;
    }
    await originalReplaceStateFile.call(current.controlled, contents);
  };

  let applyPromise: ReturnType<ControlledPatchService["apply"]> | undefined;
  try {
    applyPromise = current.controlled.apply({
      patch_task_id: generated.taskId,
      confirmation: "APPLY"
    });
    await finalPersistStarted;

    assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
    const durableWhilePending = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
      proposals: Array<{ task_id: string; state: string }>;
    };
    assert.equal(
      durableWhilePending.proposals.find(({ task_id }) => task_id === generated.taskId)?.state,
      "applying"
    );

    const terminalTaskIds = Array.from({ length: 100 }, () =>
      current.tasks.runTask({
        workspace_id: "workspace",
        instruction: "terminal history pressure"
      }).taskId
    );
    await Promise.all(terminalTaskIds.map((taskId) => terminal(current.tasks, taskId)));

    assert.deepEqual(current.tasks.taskView(generated.taskId), {
      taskId: generated.taskId,
      state: "completed",
      executor: "codex",
      ready: true,
      output: validPatch
    });
    assert.deepEqual(current.tasks.result(generated.taskId), {
      id: generated.taskId,
      state: "completed",
      output: validPatch
    });

    releaseFinalPersist();
    assert.deepEqual(await applyPromise, {
      patch_task_id: generated.taskId,
      applied: true,
      changed_paths: ["note.txt"]
    });

    const durableAfterApply = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
      proposals: Array<{ task_id: string; state: string }>;
    };
    assert.equal(
      durableAfterApply.proposals.find(({ task_id }) => task_id === generated.taskId)?.state,
      "applied"
    );
  } finally {
    releaseFinalPersist();
    await applyPromise?.catch(() => undefined);
    persistence.replaceStateFile = originalReplaceStateFile;
  }
});
```

Why this is the minimum distinguishing RED:

- `git apply` has completed because `note.txt` already contains `after\n`.
- The intercepted first outgoing `applied` snapshot proves the in-memory metadata/history path has advanced, while the wrapper blocks before the real writer runs.
- The on-disk state remains `applying`, proving final applied durability has not completed.
- The target plus 100 later generic terminal tasks creates retention pressure at the current cap. Under the current order, `unpinTask()` has already made the target eligible for generic eviction; it is the oldest eligible terminal task, so the later completions evict it and `taskView()` / `result()` return `undefined`.
- Under the required order, final persistence is still pending, so the target remains pinned and is filtered out of the generic eviction candidates. Both public query surfaces continue to return it. This distinguishes `persist -> unpin` from the current `unpin -> persist` without reading `pinnedTaskIds`.
- Releasing the gate invokes the real writer, APPLY returns the ordinary success response, and the durable JSON advances to `applied`; this RED never enters metadata recovery.
- The separate existing `reports metadata recovery when final persistence fails after APPLY executes` test remains unchanged and continues to prove the first-write-failure/retry outcome. The production change places unpin after successful durable completion on both the ordinary-success and recovered-success exits, while a failed retry reaches no unpin call.

- [ ] **Step 2: Build and run the focused test to verify the intended RED failure**

Run:

```bash
npm run build
node --test --test-concurrency=1 --test-name-pattern="keeps the task retained while final applied persistence is pending" dist/tests/unit/tasks/controlled-patch-service.test.js
```

Expected on baseline `18d2ac2875a1745017bd68bd98f747d47d944fa8`: the test fails at the `taskView()` reachability assertion because the actual value is `undefined`. The worktree assertion and durable `applying` assertion pass first, showing that the failure is specifically the early unpin/retention ordering defect rather than Git, persistence, or recovery-path setup.

If the focused run fails earlier, do not change production code. Fix only a compile or fixture mistake until the test reaches this exact observable RED failure, then rerun and record the failing assertion.

- [ ] **Step 3: Make the minimal ordering change in `ControlledPatchService.apply()`**

In `src/tasks/controlled-patch-service.ts:239-255`, keep the current in-memory state/history updates and replace the region from `this.trimAppliedProposals()` through the normal return with:

```ts
        this.trimAppliedProposals();
        try {
          await this.persist();
        } catch {
          await this.persist();
          this.tasks.unpinTask(request.patch_task_id as Id);
          return {
            patch_task_id: request.patch_task_id as Id,
            applied: true,
            changed_paths: targets.map(({ path }) => path),
            state: "applied",
            metadata_recovered: true
          };
        }
        this.tasks.unpinTask(request.patch_task_id as Id);
        return { patch_task_id: request.patch_task_id as Id, applied: true, changed_paths: targets.map(({ path }) => path) };
```

Do not change the surrounding durable-`applying` persist, preflight, Git invocation, state/history mutation, outer catch, lock, trim logic, persistence queue, response shapes, or recovery logic. The duplicated unpin at the two successful exits is intentional and smaller than introducing a new flag/helper or restructuring the existing responses:

- first final persist succeeds -> unpin -> normal applied response;
- first final persist fails and retry succeeds -> unpin -> existing `metadata_recovered` response;
- retry fails -> control exits through the existing error path without any unpin;
- failures while state is still `applying` retain the existing rollback-to-`proposed` behavior.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run:

```bash
npm run build
node --test --test-concurrency=1 --test-name-pattern="keeps the task retained while final applied persistence is pending" dist/tests/unit/tasks/controlled-patch-service.test.js
```

Expected: PASS. Before the final-persistence gate is released, Git is applied, disk remains `applying`, and both task query surfaces retain the proposal. After release, the real writer persists `applied`, then unpin occurs, and APPLY returns the ordinary success response. The unchanged recovery test separately continues to pass with its existing `metadata_recovered` response.

- [ ] **Step 5: Run the relevant controlled-patch and task-retention test files**

Run:

```bash
node --test --test-concurrency=1 dist/tests/unit/tasks/controlled-patch-service.test.js dist/tests/unit/tasks/registered-workspace-task-service.test.js
```

Expected: PASS. This checks the full controlled-patch lifecycle file and the unchanged generic retention/pin mechanics together.

- [ ] **Step 6: Run final repository verification**

Run the repository build and the package test payload serially:

```bash
npm run build
node --test --test-concurrency=1 "dist/tests/unit/**/*.test.js"
git diff --check
git status --porcelain=v1
```

Expected:

- build succeeds;
- the complete serial unit suite passes with no failures, cancellations, skips, or unfinished tests unless the baseline already records an independently verified exception;
- `git diff --check` reports no whitespace errors;
- `git status --porcelain=v1` lists only `src/tasks/controlled-patch-service.ts` and `tests/unit/tasks/controlled-patch-service.test.ts` as implementation changes. The plan file may also be present if execution occurs in this planning worktree.

- [ ] **Step 7: STOP AT COMMIT GATE**

Report the focused RED evidence, focused GREEN evidence, relevant-file results, build result, full serial-suite result, `git diff --check`, complete diff, and `git status --porcelain=v1`.

Do not run `git add`, `git commit`, `git commit --amend`, or `git push`. Do not stage or commit until the user explicitly says `COMMIT`.

---

## Plan Self-Review Record

- Spec coverage: the task implements only Sections 4, 6, 7, and the RED-5b boundary in Section 9; the durable-before-visible RED-5a path and applying crash recovery are preserved, not redesigned.
- Concrete coverage: every edit names a current file and region, and every code-edit step includes the exact code or test body.
- Interface consistency: the plan uses current method names and signatures from baseline HEAD; it adds no interface or serialized field.
- Test validity: the RED assertion observes `taskView()`/`result()` reachability plus durable state and actual worktree content; private `pinnedTaskIds` is neither read nor asserted.
- Failure coverage: the new RED covers only pending normal final persistence; the unchanged existing recovery test separately covers first-write failure, successful retry, durable `applied`, and the `metadata_recovered` outcome. The production snippet puts unpin after durable success on both exits and contains no unpin when the retry throws.
- Scope containment: no bulk hydration, performance work, persistence revision/coalescing, cleanup, lifecycle expansion, migration, task-service edit, or interactive-task change is included.
- YAGNI result: no proposed abstraction remains. Removing any new helper/class is moot because none is proposed; the complete fix is the relocation of the existing unpin calls plus one focused regression in the existing test file.
- Reviewability: one reviewer can independently accept or reject the single production ordering change and its observable regression without approving any future architecture.
