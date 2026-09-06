# Controlled COMMIT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one narrow `commit_controlled_patch` capability that creates exactly one Git commit from one already-APPLYed retained controlled-patch proposal without staging unrelated files or pushing.

**Architecture:** Keep COMMIT inside the existing `ControlledPatchService`. Reuse retained proposal output, `parsePatch()`, `detectBase()`, reverse `applyCheck()`, `withApplyLock()`, and bounded Git execution. Extract only the workspace-root identity portion of `verifyWorkspace()` because the existing helper intentionally rejects the dirty tracked worktree that APPLY produces.

**Tech Stack:** TypeScript, Node.js `node:test`, MCP SDK, Zod, Git via existing `runBoundedGit()`.

**Spec:** `docs/superpowers/specs/2026-08-30-exact-upstream-bootstrap-and-controlled-commit-design.md`

## Global Constraints

- Public surface: `commit_controlled_patch({ patch_task_id, message, confirmation: "COMMIT" })`.
- Only retained proposals in state `applied` are committable.
- Exact `COMMIT` is independent from APPLY; APPLY still never stages, commits, or pushes.
- Controlled-write authorization is rechecked at COMMIT time.
- V1 COMMIT supports proposals whose original base is a commit; unborn proposals fail closed.
- Current HEAD must still equal the proposal's original base commit.
- Index must be empty before Bridge stages anything.
- Current dirty path set must equal the proposal target path set exactly, including untracked added files.
- Reverse apply must prove the retained patch is still present.
- Bridge stages only the exact proposal target paths.
- Message normalization: `trim()`, non-empty, one line, at most 200 Unicode code points.
- Missing Git author/committer identity fails closed without changing Git config.
- Commit disables hooks and automatic signing and supplies `-m`, so no editor is invoked.
- If commit fails after staging, Bridge unstages only the paths it staged and never discards worktree content.
- Success advances HEAD by exactly one commit, leaves index/worktree clean, returns the commit SHA, and never pushes.
- Proposal state remains `applied`; do not add a `committed` state or persistence migration.
- No generic Git argv tool, shell, amend, rebase, tag, PUSH, or bootstrap behavior.
- `bootstrap_project` is implemented under a separate plan after this capability passes real fresh-Chat acceptance.

---

### Task 1: Add the service contract with RED coverage

**Files:**
- Modify: `tests/unit/tasks/controlled-patch-service.test.ts`
- Modify: `src/tasks/controlled-patch-service.ts`

**Interfaces:**
- Consumes: existing `repository()`, `fixture()`, `terminal()`, `expectCode()`, `validPatch`, `additionPatch`.
- Produces: `ControlledPatchService.commit()` returning `{ patch_task_id, committed: true, commit_sha }`.

- [ ] **Step 1: Add one exact test helper for an already-APPLYed proposal**

Place beside the existing patch fixtures:

```ts
async function appliedFixture(
  root: string,
  patch: string = validPatch,
  startProcess?: GitStarter
): Promise<{
  controlled: ControlledPatchService;
  tasks: RegisteredWorkspaceTaskService;
  taskId: string;
}> {
  const current = fixture(
    root,
    async () => ({ kind: "completed", output: patch }),
    startProcess
  );
  const generated = await current.controlled.generate({
    workspace_id: "workspace",
    change_request: "apply then commit"
  });
  await terminal(current.tasks, generated.taskId);
  await current.controlled.apply({
    patch_task_id: generated.taskId,
    confirmation: "APPLY"
  });
  return { ...current, taskId: generated.taskId };
}
```

- [ ] **Step 2: Add RED tests for the gate and applied-state requirement**

```ts
test("COMMIT requires exact confirmation and an applied proposal", async () => {
  const root = repository();
  try {
    const current = fixture(root, async () => ({ kind: "completed", output: validPatch }));
    const generated = await current.controlled.generate({
      workspace_id: "workspace",
      change_request: "change note"
    });
    await terminal(current.tasks, generated.taskId);

    await expectCode(
      () => current.controlled.commit({
        patch_task_id: generated.taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "INVALID_STATE_TRANSITION"
    );

    await current.controlled.apply({
      patch_task_id: generated.taskId,
      confirmation: "APPLY"
    });

    await expectCode(
      () => current.controlled.commit({
        patch_task_id: generated.taskId,
        message: "feat: commit patch",
        confirmation: "commit"
      }),
      "INVALID_STATE_TRANSITION"
    );

    await expectCode(
      () => current.controlled.commit({
        patch_task_id: "00000000-0000-0000-0000-000000000000",
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "INVALID_STATE_TRANSITION"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add RED tests for message normalization and repository preconditions**

Use `appliedFixture()` in each case.

```ts
test("COMMIT trims one-line messages and rejects empty multiline and overlong messages", async () => {
  for (const message of ["", "   ", "line one\nline two", "x".repeat(201)]) {
    const root = repository();
    try {
      const { controlled, taskId } = await appliedFixture(root);
      await expectCode(
        () => controlled.commit({
          patch_task_id: taskId,
          message,
          confirmation: "COMMIT"
        }),
        "WORKSPACE_PRECONDITION_FAILED"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
```

Add three separate tests with fresh repositories:

```ts
test("COMMIT rejects a changed base HEAD", async () => {
  const root = repository();
  try {
    const { controlled, taskId } = await appliedFixture(root);
    writeFileSync(join(root, "other.txt"), "other\n");
    git(root, "add", "other.txt");
    git(root, "commit", "-qm", "advance head");

    await expectCode(
      () => controlled.commit({
        patch_task_id: taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

```ts
test("COMMIT rejects a nonempty index before staging", async () => {
  const root = repository();
  try {
    const { controlled, taskId } = await appliedFixture(root);
    writeFileSync(join(root, "other.txt"), "other\n");
    git(root, "add", "other.txt");

    await expectCode(
      () => controlled.commit({
        patch_task_id: taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
    assert.equal(git(root, "diff", "--cached", "--name-only").trim(), "other.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

```ts
test("COMMIT rejects unrelated tracked or untracked dirt", async () => {
  for (const kind of ["tracked", "untracked"] as const) {
    const root = repository();
    try {
      if (kind === "tracked") {
        writeFileSync(join(root, "other.txt"), "base\n");
        git(root, "add", "other.txt");
        git(root, "commit", "-qm", "add other");
      }
      const { controlled, taskId } = await appliedFixture(root);
      writeFileSync(join(root, "other.txt"), "dirty\n");

      await expectCode(
        () => controlled.commit({
          patch_task_id: taskId,
          message: "feat: commit patch",
          confirmation: "COMMIT"
        }),
        "WORKSPACE_PRECONDITION_FAILED"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
```

Add authorization recheck coverage with retained-state reload:

```ts
test("COMMIT rechecks write authorization after APPLY", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  try {
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
    await current.controlled.apply({
      patch_task_id: generated.taskId,
      confirmation: "APPLY"
    });

    const readOnlyRegistry = new RegisteredWorkspaceRegistry([]);
    readOnlyRegistry.registerManaged("workspace", root);
    const readOnlyTasks = new RegisteredWorkspaceTaskService(
      readOnlyRegistry,
      () => ({
        execute: async () => ({ kind: "completed", output: validPatch })
      })
    );
    const reloaded = new ControlledPatchService(
      readOnlyRegistry,
      readOnlyTasks,
      undefined,
      stateFilePath
    );
    await reloaded.load();

    await expectCode(
      () => reloaded.commit({
        patch_task_id: generated.taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stateFilePath, { force: true });
  }
});
```

Add retained-patch integrity coverage. The dirty path remains exactly `note.txt`, so only reverse-apply verification can reject the tampering:

```ts
test("COMMIT rejects an applied path whose retained patch content no longer matches", async () => {
  const root = repository();
  try {
    const { controlled, taskId } = await appliedFixture(root);
    writeFileSync(join(root, "note.txt"), "tampered\n");

    await expectCode(
      () => controlled.commit({
        patch_task_id: taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
    assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "tampered\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run RED**

```bash
npm run build
node --test dist/tests/unit/tasks/controlled-patch-service.test.js
```

Expected: build/typecheck fails because `ControlledPatchService.commit` does not exist. This is the required RED; do not weaken the tests.

- [ ] **Step 5: Add the minimal service API and message normalization**

In `src/tasks/controlled-patch-service.ts` add:

```ts
async commit(request: {
  patch_task_id: string;
  message: string;
  confirmation: string;
}): Promise<{
  patch_task_id: Id;
  committed: true;
  commit_sha: string;
}> {
  if (request.confirmation !== "COMMIT") {
    throw new CoreError("INVALID_STATE_TRANSITION");
  }

  const proposal = this.proposals.get(request.patch_task_id as Id);
  if (proposal === undefined || proposal.state !== "applied") {
    throw new CoreError("INVALID_STATE_TRANSITION");
  }

  const message = normalizeCommitMessage(request.message);

  return this.withApplyLock(proposal.workspaceRoot, async () => {
    if (proposal.state !== "applied") {
      throw new CoreError("INVALID_STATE_TRANSITION");
    }
    if (this.registry.resolveWritable(proposal.workspaceId) !== proposal.workspaceRoot) {
      throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
    }
    if (proposal.base.kind !== "commit") {
      throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
    }

    return this.commitAppliedProposal(
      request.patch_task_id as Id,
      proposal,
      message
    );
  });
}
```

Add:

```ts
function normalizeCommitMessage(value: string): string {
  const message = value.trim();
  if (
    message.length === 0 ||
    message.includes("\n") ||
    message.includes("\r") ||
    [...message].length > 200
  ) {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }
  return message;
}
```

Do not persist or mutate proposal state.

- [ ] **Step 6: Extract only workspace-root identity verification**

The existing `verifyWorkspace()` cannot be called after APPLY because it requires tracked status to be clean. Extract its root/canonicalization lines into:

```ts
private async verifyWorkspaceRoot(workspaceRoot: string): Promise<void> {
  const topLevel = (await this.git(workspaceRoot, [
    "rev-parse",
    "--show-toplevel"
  ])).trim();

  let canonicalTopLevel: string;
  let canonicalWorkspaceRoot: string;
  try {
    [canonicalTopLevel, canonicalWorkspaceRoot] = await Promise.all([
      realpath(resolve(topLevel)),
      realpath(resolve(workspaceRoot))
    ]);
  } catch {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

  if (canonicalTopLevel !== canonicalWorkspaceRoot) {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }
}
```

Then make existing `verifyWorkspace()` call `await this.verifyWorkspaceRoot(workspaceRoot)` before its unchanged clean-status check. This is a helper extraction only; all existing generation/APPLY behavior must remain unchanged.

- [ ] **Step 7: Implement exact COMMIT preflight without parsing porcelain status**

Implement `commitAppliedProposal()`.

Start with identity and base:

```ts
private async commitAppliedProposal(
  taskId: Id,
  proposal: RetainedProposal,
  message: string
): Promise<{
  patch_task_id: Id;
  committed: true;
  commit_sha: string;
}> {
  await this.verifyWorkspaceRoot(proposal.workspaceRoot);

  const currentBase = await this.detectBase(proposal.workspaceRoot);
  if (!sameBase(currentBase, proposal.base) || proposal.base.kind !== "commit") {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

  const stagedBefore = splitNul(await this.git(proposal.workspaceRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z"
  ]));
  if (stagedBefore.length !== 0) {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

  const targets = parsePatch(proposal.output).map(({ path }) => path).sort();
  const trackedDirty = splitNul(await this.git(proposal.workspaceRoot, [
    "diff",
    "--name-only",
    "-z",
    "--"
  ]));
  const untrackedDirty = splitNul(await this.git(proposal.workspaceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--"
  ]));
  const actualDirty = [...new Set([...trackedDirty, ...untrackedDirty])].sort();

  if (!sameStrings(actualDirty, targets)) {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

  if (!(await this.applyCheck(proposal.workspaceRoot, proposal.output, true))) {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

  await this.git(proposal.workspaceRoot, ["var", "GIT_AUTHOR_IDENT"]);
  await this.git(proposal.workspaceRoot, ["var", "GIT_COMMITTER_IDENT"]);
```

Add two small local helpers:

```ts
function splitNul(value: string): string[] {
  if (value.length === 0) return [];
  const parts = value.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  if (parts.some((part) => part.length === 0)) failPatch();
  return parts;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
```

- [ ] **Step 8: Stage exact targets, commit non-interactively, clean only the index on failure, and verify success**

Continue `commitAppliedProposal()`:

```ts
  await this.git(proposal.workspaceRoot, ["add", "--", ...targets]);

  const stagedAfter = splitNul(await this.git(proposal.workspaceRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z"
  ])).sort();

  if (!sameStrings(stagedAfter, targets)) {
    await this.unstageCommittedPaths(proposal.workspaceRoot, targets);
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

let commitError: unknown;
try {
  await this.git(proposal.workspaceRoot, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--no-verify",
    "-m",
    message
  ]);
} catch (error) {
  commitError = error;
}

// Reconcile from repository state even when the subprocess reported failure:
// a timeout/late process error can occur after Git has already advanced HEAD.
const commitSha = (await this.git(proposal.workspaceRoot, [
  "rev-parse",
  "HEAD"
])).trim();

if (commitSha === proposal.base.head) {
  await this.unstageCommittedPaths(proposal.workspaceRoot, targets);
  if (commitError !== undefined) throw commitError;
  throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
}

const parentSha = (await this.git(proposal.workspaceRoot, [
  "rev-parse",
  "HEAD^"
])).trim();

if (
  !/^[0-9a-f]{40,64}$/u.test(commitSha) ||
  parentSha !== proposal.base.head
) {
  // History has moved in an unproven way. Do not rewrite/reset history.
  throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
}

const committedPaths = splitNul(await this.git(proposal.workspaceRoot, [
  "diff-tree",
  "--no-commit-id",
  "--name-only",
  "-r",
  "-z",
  "HEAD"
])).sort();
const committedSubject = (await this.git(proposal.workspaceRoot, [
  "log",
  "-1",
  "--format=%s"
])).trim();

if (
  !sameStrings(committedPaths, targets) ||
  committedSubject !== message
) {
  throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
}

  const stagedFinal = splitNul(await this.git(proposal.workspaceRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z"
  ]));
  const trackedFinal = splitNul(await this.git(proposal.workspaceRoot, [
    "diff",
    "--name-only",
    "-z",
    "--"
  ]));
  const untrackedFinal = splitNul(await this.git(proposal.workspaceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--"
  ]));

  if (
    stagedFinal.length !== 0 ||
    trackedFinal.length !== 0 ||
    untrackedFinal.length !== 0
  ) {
    throw new CoreError("WORKSPACE_PRECONDITION_FAILED");
  }

  return {
    patch_task_id: taskId,
    committed: true,
    commit_sha: commitSha
  };
}
```

Add:

```ts
private async unstageCommittedPaths(
  workspaceRoot: string,
  paths: readonly string[]
): Promise<void> {
  await this.git(workspaceRoot, ["reset", "-q", "HEAD", "--", ...paths]);
}
```

This reset is permitted only because the index was proven empty before Bridge staged the exact target set. It must never use `--hard`, checkout, restore, clean, stash, or any worktree-mutating cleanup.

- [ ] **Step 9: Add GREEN tests for identity, exact argv, failure cleanup, added files, and success**

Add:

```ts
test("COMMIT creates one commit from exactly the applied proposal paths", async () => {
  const root = repository();
  const gitCalls: Array<{ executable: string; args: readonly string[]; shell: unknown }> = [];
  const starter: GitStarter = (executable, args, options) => {
    gitCalls.push({ executable, args, shell: options.shell });
    return spawn(executable, args, options);
  };

  try {
    const { controlled, taskId } = await appliedFixture(root, validPatch, starter);
    const beforeHead = git(root, "rev-parse", "HEAD").trim();

    const result = await controlled.commit({
      patch_task_id: taskId,
      message: "  feat: commit applied patch  ",
      confirmation: "COMMIT"
    });

    assert.equal(result.patch_task_id, taskId);
    assert.equal(result.committed, true);
    assert.match(result.commit_sha, /^[0-9a-f]{40,64}$/u);
    assert.equal(git(root, "rev-parse", "HEAD").trim(), result.commit_sha);
    assert.equal(git(root, "rev-parse", "HEAD^").trim(), beforeHead);
    assert.equal(
      git(root, "log", "-1", "--format=%s").trim(),
      "feat: commit applied patch"
    );
    assert.equal(git(root, "status", "--porcelain"), "");

    const commitCall = gitCalls.find(({ args }) => args.includes("commit"));
    assert.ok(commitCall);
    assert.equal(commitCall.shell, false);
    assert.ok(commitCall.args.includes("core.hooksPath=/dev/null"));
    assert.ok(commitCall.args.includes("commit.gpgSign=false"));
    assert.ok(commitCall.args.includes("--no-verify"));
    assert.equal(gitCalls.some(({ args }) => args.includes("push")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Add deterministic identity failure without depending on the developer machine's global Git config:

```ts
test("COMMIT fails closed on missing Git identity without editing config", async () => {
  const root = repository();
  const starter: GitStarter = (executable, args, options) => {
    if (args[0] === "var" && args[1] === "GIT_AUTHOR_IDENT") {
      return spawn(process.execPath, ["-e", "process.exit(1)"], options);
    }
    return spawn(executable, args, options);
  };

  try {
    const { controlled, taskId } = await appliedFixture(root, validPatch, starter);
    const beforeConfig = git(root, "config", "--local", "--list");

    await expectCode(
      () => controlled.commit({
        patch_task_id: taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );

    assert.equal(git(root, "config", "--local", "--list"), beforeConfig);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Add deterministic commit failure and index-only cleanup:

```ts
test("COMMIT failure unstages only Bridge paths and preserves modified worktree content", async () => {
  const root = repository();
  const starter: GitStarter = (executable, args, options) => {
    if (args.includes("commit")) {
      return spawn(process.execPath, ["-e", "process.exit(1)"], options);
    }
    return spawn(executable, args, options);
  };

  try {
    const { controlled, taskId } = await appliedFixture(root, validPatch, starter);
    const beforeHead = git(root, "rev-parse", "HEAD").trim();

    await expectCode(
      () => controlled.commit({
        patch_task_id: taskId,
        message: "feat: commit patch",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );

    assert.equal(git(root, "diff", "--cached", "--name-only"), "");
    assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
    assert.equal(git(root, "rev-parse", "HEAD").trim(), beforeHead);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Add the same cleanup proof for an APPLYed added file:

```ts
test("COMMIT failure leaves an added proposal file present and untracked after cleanup", async () => {
  const root = repository();
  const starter: GitStarter = (executable, args, options) => {
    if (args.includes("commit")) {
      return spawn(process.execPath, ["-e", "process.exit(1)"], options);
    }
    return spawn(executable, args, options);
  };

  try {
    const { controlled, taskId } = await appliedFixture(root, additionPatch, starter);

    await expectCode(
      () => controlled.commit({
        patch_task_id: taskId,
        message: "feat: commit added file",
        confirmation: "COMMIT"
      }),
      "WORKSPACE_PRECONDITION_FAILED"
    );

    assert.equal(readFileSync(join(root, "added.txt"), "utf8"), "added\n");
    assert.equal(git(root, "diff", "--cached", "--name-only"), "");
    assert.match(git(root, "status", "--porcelain"), /^\?\? added\.txt\n?$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Add ambiguous subprocess-finalization recovery coverage. The wrapper executes the real Git commit successfully and then deliberately exits nonzero; Bridge must reconcile from HEAD and return success instead of reporting a false failure:

```ts
test("COMMIT recovers success when the subprocess reports failure after HEAD advances exactly once", async () => {
  const root = repository();
  const starter: GitStarter = (executable, args, options) => {
    if (args.includes("commit")) {
      return spawn(process.execPath, [
        "-e",
        "const cp=require('node:child_process');const [git,argsJson]=process.argv.slice(1);const r=cp.spawnSync(git,JSON.parse(argsJson),{cwd:process.cwd(),stdio:'inherit',shell:false});process.exit(r.status===0?1:(r.status??1));",
        executable,
        JSON.stringify(args)
      ], options);
    }
    return spawn(executable, args, options);
  };

  try {
    const { controlled, taskId } = await appliedFixture(root, validPatch, starter);
    const beforeHead = git(root, "rev-parse", "HEAD").trim();

    const result = await controlled.commit({
      patch_task_id: taskId,
      message: "feat: reconcile committed result",
      confirmation: "COMMIT"
    });

    assert.equal(result.committed, true);
    assert.equal(git(root, "rev-parse", "HEAD").trim(), result.commit_sha);
    assert.equal(git(root, "rev-parse", "HEAD^").trim(), beforeHead);
    assert.equal(git(root, "status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 10: Run the service suite GREEN**

```bash
npm run build
node --test dist/tests/unit/tasks/controlled-patch-service.test.js
```

Expected: PASS.

Then:

```bash
node --test dist/tests/unit/tasks/*.test.js
```

Expected: PASS.

---

### Task 2: Expose the exact COMMIT MCP gate and run end-to-end regression

**Files:**
- Modify: `src/mcp-stdio.ts`
- Modify: `tests/unit/mcp-stdio.test.ts`

**Interfaces:**
- Consumes: `ControlledPatchService.commit()`.
- Produces: MCP tool `commit_controlled_patch`.

- [ ] **Step 1: Add the MCP registration**

Place beside `apply_controlled_patch`:

```ts
server.registerTool("commit_controlled_patch", {
  description: "Create one Git commit containing only an already-APPLYed controlled patch after exact COMMIT confirmation. Never pushes.",
  inputSchema: {
    patch_task_id: z.string().min(1),
    message: z.string().min(1),
    confirmation: z.literal("COMMIT")
  }
}, async ({ patch_task_id, message, confirmation }) => jsonContent(
  await controlledPatches.commit({
    patch_task_id,
    message,
    confirmation
  })
));
```

Keep the canonical message-length and newline checks in the service so MCP and any future internal caller share one rule.

- [ ] **Step 2: Update tool catalog and end-to-end MCP tests**

In the exact `listTools()` assertion, add `commit_controlled_patch`; the expected catalog becomes thirteen tools at this intermediate stage.

Extend the existing `submit_controlled_patch registers a submitted proposal...` flow after APPLY:

```ts
const committed = await call("commit_controlled_patch", {
  patch_task_id: submitted.body.patch_task_id,
  message: "feat: commit submitted patch",
  confirmation: "COMMIT"
});

assert.equal(committed.isError, false);
assert.equal(committed.body.patch_task_id, submitted.body.patch_task_id);
assert.equal(committed.body.committed, true);
assert.match(String(committed.body.commit_sha), /^[0-9a-f]{40,64}$/u);
assert.equal(
  git(workspaceRoot, "log", "-1", "--format=%s").trim(),
  "feat: commit submitted patch"
);
assert.equal(git(workspaceRoot, "status", "--porcelain"), "");
```

Before the successful call, call the tool once with `confirmation: "commit"` and assert MCP schema rejection. Also call exact COMMIT before APPLY in a fresh proposal and assert an error result.

- [ ] **Step 3: Run MCP and full regression**

```bash
npm run build
node --test dist/tests/unit/mcp-stdio.test.js
npm run typecheck
npm test
git diff --check
git status --short
```

Expected:

- MCP test PASS with thirteen tools.
- typecheck PASS.
- full suite PASS.
- `git diff --check` PASS.
- only these four implementation files changed:
  - `src/tasks/controlled-patch-service.ts`
  - `src/mcp-stdio.ts`
  - `tests/unit/tasks/controlled-patch-service.test.ts`
  - `tests/unit/mcp-stdio.test.ts`
- no docs/version/bootstrap/PUSH changes.

- [ ] **Step 4: Stop at the user COMMIT gate**

Do not stage, commit, or push from the implementation worker.

This implementation itself still requires the pre-existing reviewed commit path after the user says exact `COMMIT`, because the running personal Bridge does not yet contain this new tool.
