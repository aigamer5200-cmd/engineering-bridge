import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CoreError } from "../../../src/core/errors.js";
import type { Executor, ExecutorResult } from "../../../src/executors/executor.js";
import { ControlledPatchService } from "../../../src/tasks/controlled-patch-service.js";
import type { GitStarter } from "../../../src/tasks/controlled-patch-service.js";
import { RegisteredWorkspaceTaskService } from "../../../src/tasks/registered-workspace-task-service.js";
import { ManagedWorkspaceCatalog } from "../../../src/workspaces/managed-workspace-catalog.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";
import { WorkspaceOnboardingService } from "../../../src/workspaces/workspace-onboarding-service.js";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function initGit(root: string): void {
  git(root, "init", "-q");
  // These fixtures assert exact LF bytes. Keep the temporary repositories
  // independent from a developer's global Windows autocrlf setting.
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "core.eol", "lf");
}

function repository(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-patch-")));
  initGit(root);
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "note.txt"), "before\n");
  git(root, "add", "note.txt");
  git(root, "commit", "-qm", "base");
  return root;
}

function fixture(
  root: string,
  execute: Executor["execute"],
  startProcess?: GitStarter,
  stateFilePath?: string
): {
  controlled: ControlledPatchService;
  tasks: RegisteredWorkspaceTaskService;
} {
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({ execute }));
  const controlled = stateFilePath === undefined
    ? startProcess === undefined
      ? new ControlledPatchService(registry, tasks)
      : new ControlledPatchService(registry, tasks, startProcess)
    : new ControlledPatchService(registry, tasks, startProcess ?? spawn, stateFilePath);
  return { controlled, tasks };
}

function retainedStateFile(): string {
  return join(mkdtempSync(join(tmpdir(), "engineering-bridge-state-")), "controlled-patches.json");
}

async function terminal(tasks: RegisteredWorkspaceTaskService, taskId: string): Promise<void> {
  while (["queued", "running"].includes(tasks.status(taskId)?.state ?? "")) {
    await new Promise<void>((done) => setImmediate(done));
  }
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof CoreError && error.code === code);
}

const validPatch = `diff --git a/note.txt b/note.txt
index 90be1f3..3b18e51 100644
--- a/note.txt
+++ b/note.txt
@@ -1 +1 @@
-before
+after
`;

const preflightReceipt = {
  knowledge_base_path: "D:/AI_Knowledge_Base",
  knowledge_base_head: "670414561cb44acfd79bc1d5e858ee814a09a240",
  project_profile: "wiki/projects/biaogu-hunter/PROJECT_PROFILE.md",
  goal_id: "bridge-preflight-v1",
  goal_summary: "Carry bounded current knowledge into a patch delegation.",
  acceptance_criteria: ["Return a complete controlled patch."],
  relevant_topics: ["wiki/global/KNOWLEDGE_PREFLIGHT_PROTOCOL.md"],
  critical_boundaries: ["Patch generation remains read-only."]
};

const additionPatch = `diff --git a/added.txt b/added.txt
new file mode 100644
index 0000000..3e75765
--- /dev/null
+++ b/added.txt
@@ -0,0 +1 @@
+added
`;

const markdownFencePatch = [
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,7 +1,7 @@",
  " # Example",
  " ",
  " ```sh",
  " echo ok",
  " ```",
  " ",
  "-before",
  "+after",
  ""
].join("\n");

const staleHunkCountPatch = [
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -4,7 +4,7 @@ echo ok",
  " ```",
  " ",
  "-before",
  "+after",
  ""
].join("\n");

const zeroContextPatch = [
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -7 +7 @@",
  "-before",
  "+after",
  ""
].join("\n");

test("restores a completed generated proposal for task_result after restart", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const first = fixture(
    root,
    async () => ({ kind: "completed", output: validPatch }),
    undefined,
    stateFilePath
  );
  const generated = await first.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note"
  });
  await terminal(first.tasks, generated.taskId);

  const restarted = fixture(
    root,
    async () => { throw new Error("restored tasks must not execute"); },
    undefined,
    stateFilePath
  );
  await restarted.controlled.load();

  assert.deepEqual(restarted.tasks.taskView(generated.taskId), {
    taskId: generated.taskId,
    state: "completed",
    executor: "codex",
    ready: true,
    output: validPatch
  });
});

test("refines a restored proposal with its parent relationship and original base HEAD retained", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const first = fixture(
    root,
    async () => ({ kind: "completed", output: validPatch }),
    undefined,
    stateFilePath
  );
  const source = await first.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note"
  });
  await terminal(first.tasks, source.taskId);

  const refinedPatch = validPatch.replace("+after", "+refined after");
  const restarted = fixture(
    root,
    async () => ({ kind: "completed", output: refinedPatch }),
    undefined,
    stateFilePath
  );
  await restarted.controlled.load();
  const refined = await restarted.controlled.refine({
    patch_task_id: source.taskId,
    change_request: "improve wording"
  });
  await terminal(restarted.tasks, refined.taskId);

  assert.equal(refined.baseHead, source.baseHead);
  assert.deepEqual(restarted.tasks.result(source.taskId), {
    id: source.taskId,
    state: "completed",
    output: validPatch
  });
  const state = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
    proposals: Array<{ task_id: string; base_head: string; parent_task_id?: string }>;
  };
  const retainedSource = state.proposals.find(({ task_id }) => task_id === source.taskId);
  const retainedRefinement = state.proposals.find(({ task_id }) => task_id === refined.taskId);
  assert.equal(retainedSource?.base_head, source.baseHead);
  assert.equal(retainedRefinement?.base_head, source.baseHead);
  assert.equal(retainedRefinement?.parent_task_id, source.taskId);
});

test("applies a refined proposal after restart without rerunning generation", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  let executions = 0;
  const refinedPatch = validPatch.replace("+after", "+refined after");
  const first = fixture(
    root,
    async () => ({ kind: "completed", output: executions++ === 0 ? validPatch : refinedPatch }),
    undefined,
    stateFilePath
  );
  const source = await first.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note"
  });
  await terminal(first.tasks, source.taskId);
  const refined = await first.controlled.refine({
    patch_task_id: source.taskId,
    change_request: "improve wording"
  });
  await terminal(first.tasks, refined.taskId);

  const restarted = fixture(
    root,
    async () => { throw new Error("restored tasks must not execute"); },
    undefined,
    stateFilePath
  );
  await restarted.controlled.load();
  const applied = await restarted.controlled.apply({
    patch_task_id: refined.taskId,
    confirmation: "APPLY"
  });

  assert.deepEqual(applied.changed_paths, ["note.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "refined after\n");
});

test("fails safely on malformed retained state", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  writeFileSync(stateFilePath, "{not json}\n");
  const restarted = fixture(
    root,
    async () => ({ kind: "completed", output: validPatch }),
    undefined,
    stateFilePath
  );

  await expectCode(() => restarted.controlled.load(), "INTERNAL_ERROR");
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "before\n");
  assert.equal(readFileSync(stateFilePath, "utf8"), "{not json}\n");
});

test("reports a retention write failure instead of exposing an unretained completed proposal", async () => {
  const root = repository();
  const stateFilePath = join(retainedStateFile(), "missing", "controlled-patches.json");
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

  assert.deepEqual(current.tasks.result(generated.taskId), {
    id: generated.taskId,
    state: "failed",
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed."
    }
  });
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "before\n");
});

test("recovers an interrupted applying proposal as retryable after restart", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const first = fixture(
    root,
    async () => ({ kind: "completed", output: validPatch }),
    undefined,
    stateFilePath
  );
  const generated = await first.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note"
  });
  await terminal(first.tasks, generated.taskId);

  const state = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
    proposals: Array<{ task_id: string; state: string }>;
  };
  const retainedProposal = state.proposals.find(({ task_id }) => task_id === generated.taskId);
  assert.ok(retainedProposal);
  retainedProposal.state = "applying";
  writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`);

  const restarted = fixture(
    root,
    async () => { throw new Error("restored tasks must not execute"); },
    undefined,
    stateFilePath
  );
  await restarted.controlled.load();
  const proposals = (restarted.controlled as unknown as {
    proposals: Map<string, { state: string }>;
  }).proposals;
  assert.equal(proposals.get(generated.taskId)?.state, "proposed");

  const applied = await restarted.controlled.apply({
    patch_task_id: generated.taskId,
    confirmation: "APPLY"
  });
  assert.deepEqual(applied.changed_paths, ["note.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
});

test("generation records base metadata, binds the task, and keeps Codex instruction read-only", async () => {
  const root = repository();
  let instruction = "";
  const gitCalls: Array<{ executable: string; args: readonly string[]; shell: unknown }> = [];
  const starter: GitStarter = (executable, args, options) => {
    gitCalls.push({ executable, args, shell: options.shell });
    return spawn(executable, args, options);
  };
  const { controlled, tasks } = fixture(root, async (request) => {
    instruction = request.instruction;
    return { kind: "completed", output: validPatch };
  }, starter);
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });
  assert.equal(generated.baseHead, git(root, "rev-parse", "HEAD").trim());
  await Promise.resolve();
  assert.match(instruction, /Return only a unified textual Git diff/);
  await terminal(tasks, generated.taskId);
  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });
  assert.deepEqual(applied.changed_paths, ["note.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
  assert.ok(gitCalls.every((call) => call.executable === "git" && call.shell === false));
  assert.deepEqual(gitCalls.slice(-2).map((call) => call.args), [
    ["apply", "--check", "--recount", "--unidiff-zero"],
    ["apply", "--recount", "--unidiff-zero"]
  ]);
  await expectCode(
    () => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }),
    "INVALID_STATE_TRANSITION"
  );
});

test("refines a complete multi-file proposal without changing its source and applies the complete replacement", async () => {
  const root = repository();
  const sourcePatch = `${validPatch}${additionPatch}`;
  const refinedPatch = sourcePatch
    .replace("+after\n", "+refined\n")
    .replace("+added\n", "+refined added\n");
  const instructions: string[] = [];
  const { controlled, tasks } = fixture(root, async (request) => {
    instructions.push(request.instruction);
    return { kind: "completed", output: instructions.length === 1 ? sourcePatch : refinedPatch };
  });

  const source = await controlled.generate({ workspace_id: "workspace", change_request: "implement original multi-file change" });
  await terminal(tasks, source.taskId);
  const sourceResult = tasks.result(source.taskId);
  const refined = await controlled.refine({
    patch_task_id: source.taskId,
    change_request: "fix note wording"
  });
  await terminal(tasks, refined.taskId);

  assert.notEqual(refined.taskId, source.taskId);
  assert.equal(refined.baseHead, source.baseHead);
  const refinementInstruction = instructions[1]!;
  assert.ok(refinementInstruction.includes(sourcePatch));
  assert.match(refinementInstruction, /Treat the source proposal below as the reviewed baseline/);
  assert.match(refinementInstruction, /Fix only the requested issues and preserve all unrelated proposal semantics/);
  assert.match(refinementInstruction, /COMPLETE final unified diff relative to the SAME original base_head/);
  assert.match(refinementInstruction, /not an incremental patch against the source proposal/);
  assert.doesNotMatch(refinementInstruction, /implement original multi-file change/);
  assert.deepEqual(tasks.result(source.taskId), sourceResult);

  const applied = await controlled.apply({ patch_task_id: refined.taskId, confirmation: "APPLY" });
  assert.deepEqual(applied.changed_paths, ["note.txt", "added.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "refined\n");
  assert.equal(readFileSync(join(root, "added.txt"), "utf8"), "refined added\n");
});

test("rejects missing, non-completed, and HEAD-drifted refinement sources without starting Codex", async () => {
  const root = repository();
  let finish!: (result: ExecutorResult) => void;
  const pending = new Promise<ExecutorResult>((done) => { finish = done; });
  let executions = 0;
  const { controlled, tasks } = fixture(root, () => {
    executions += 1;
    return pending;
  });
  const source = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });
  await Promise.resolve();

  await expectCode(() => controlled.refine({
    patch_task_id: "missing",
    change_request: "refine"
  }), "INVALID_STATE_TRANSITION");
  await expectCode(() => controlled.refine({
    patch_task_id: source.taskId,
    change_request: "refine"
  }), "INVALID_STATE_TRANSITION");
  assert.equal(executions, 1);

  finish({ kind: "completed", output: validPatch });
  await terminal(tasks, source.taskId);
  writeFileSync(join(root, "other.txt"), "commit\n");
  git(root, "add", "other.txt");
  git(root, "commit", "-qm", "move head");
  await expectCode(() => controlled.refine({
    patch_task_id: source.taskId,
    change_request: "refine"
  }), "WORKSPACE_PRECONDITION_FAILED");
  assert.equal(executions, 1);
});

test("accepts a normal absolute Git top-level path", async () => {
  const root = repository();
  const { controlled } = fixture(root, async () => ({ kind: "completed", output: validPatch }));

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });

  assert.equal(generated.baseHead, git(root, "rev-parse", "HEAD").trim());
});

test("accepts a symlink alias that resolves to the same Git top-level", async () => {
  const root = repository();
  const aliasParent = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-alias-")));
  const alias = join(aliasParent, "workspace-alias");
  symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  const { controlled } = fixture(alias, async () => ({ kind: "completed", output: validPatch }));

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });

  assert.equal(generated.baseHead, git(root, "rev-parse", "HEAD").trim());
});

test("rejects a different directory, a Git subdirectory, and a missing workspace", async () => {
  const root = repository();
  const other = repository();
  const nested = join(root, "nested");
  mkdirSync(nested);

  for (const invalidRoot of [other, nested, join(root, "missing")]) {
    const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root: invalidRoot, allow_write: true }]);
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, (executable, args, options) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel" && invalidRoot === other) {
        return spawn(executable, args, { ...options, cwd: root });
      }
      return spawn(executable, args, options);
    });
    await expectCode(
      () => controlled.generate({ workspace_id: "workspace", change_request: "change note" }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
  }
});

test("stores and applies a controlled patch normalized to one trailing LF", async () => {
  const root = repository();
  const patchWithoutFinalLf = validPatch.slice(0, -1);
  const { controlled, tasks } = fixture(root, async () => ({
    kind: "completed",
    output: patchWithoutFinalLf
  }));

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });
  await terminal(tasks, generated.taskId);

  assert.deepEqual(tasks.result(generated.taskId), {
    id: generated.taskId,
    state: "completed",
    output: validPatch
  });
  await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
});

test("generation and refinement carry an explicit knowledge preflight receipt without changing patch authority", async () => {
  const root = repository();
  const instructions: string[] = [];
  const { controlled, tasks } = fixture(root, async (request) => {
    instructions.push(request.instruction);
    return { kind: "completed", output: validPatch };
  });

  const generated = await controlled.generate({
    workspace_id: "workspace",
    change_request: "change note",
    preflight_receipt: preflightReceipt
  });
  await terminal(tasks, generated.taskId);

  const refined = await controlled.refine({
    patch_task_id: generated.taskId,
    change_request: "keep the same change",
    preflight_receipt: preflightReceipt
  });
  await terminal(tasks, refined.taskId);

  assert.equal(instructions.length, 2);
  for (const instruction of instructions) {
    assert.match(instruction, /Knowledge Preflight Receipt/u);
    assert.match(instruction, /knowledge_base_head: 670414561cb44acfd79bc1d5e858ee814a09a240/u);
    assert.match(instruction, /workspace_root:/u);
    assert.match(instruction, /sandbox: read-only/u);
    assert.match(instruction, /does not grant write, release, credential, or scope-expansion authority/u);
    assert.match(instruction, /Return only a unified textual Git diff/u);
  }
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "before\n");
});

test("applies a valid patch when Markdown context contains fenced code", async () => {
  const root = repository();
  writeFileSync(join(root, "README.md"), "# Example\n\n```sh\necho ok\n```\n\nbefore\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "add Markdown fixture");
  const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: markdownFencePatch }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change Markdown" });
  await terminal(tasks, generated.taskId);

  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.deepEqual(applied.changed_paths, ["README.md"]);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# Example\n\n```sh\necho ok\n```\n\nafter\n");
});

test("recounts stale hunk line counts in a valid generated patch", async () => {
  const root = repository();
  writeFileSync(join(root, "README.md"), "# Example\n\n```sh\necho ok\n```\n\nbefore\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "add generated patch fixture");
  const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: staleHunkCountPatch }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change generated patch" });
  await terminal(tasks, generated.taskId);

  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.deepEqual(applied.changed_paths, ["README.md"]);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# Example\n\n```sh\necho ok\n```\n\nafter\n");
});

test("applies a valid generated patch with zero context", async () => {
  const root = repository();
  writeFileSync(join(root, "README.md"), "# Example\n\n```sh\necho ok\n```\n\nbefore\ntail\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "add zero-context fixture");
  const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: zeroContextPatch }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change one line" });
  await terminal(tasks, generated.taskId);

  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.deepEqual(applied.changed_paths, ["README.md"]);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# Example\n\n```sh\necho ok\n```\n\nafter\ntail\n");
});

test("adds an absent 100644 text file", async () => {
  const root = repository();
  const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: additionPatch }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
  await terminal(tasks, generated.taskId);

  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.deepEqual(applied.changed_paths, ["added.txt"]);
  assert.equal(readFileSync(join(root, "added.txt"), "utf8"), "added\n");
});

test("applies a mixed modification and 100644 text addition", async () => {
  const root = repository();
  const mixedPatch = `${validPatch}${additionPatch}`;
  const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: mixedPatch }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change and add" });
  await terminal(tasks, generated.taskId);

  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.deepEqual(applied.changed_paths, ["note.txt", "added.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
  assert.equal(readFileSync(join(root, "added.txt"), "utf8"), "added\n");
});

test("rejects addition targets already present in base HEAD, the worktree, or the index", async () => {
  for (const state of ["tracked", "untracked", "index"] as const) {
    const root = repository();
    const path = state === "tracked" ? "note.txt" : "added.txt";
    const patch = additionPatch.replaceAll("added.txt", path);
    if (state === "untracked") writeFileSync(join(root, path), "collision\n");
    const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: patch }));
    const generated = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
    await terminal(tasks, generated.taskId);
    if (state === "index") {
      writeFileSync(join(root, path), "indexed\n");
      git(root, "add", path);
    }
    await expectCode(
      () => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
  }
});

test("rejects unsafe or structurally invalid additions", async () => {
  const invalidPatches = [
    additionPatch.replace("new file mode 100644", "new file mode 100755"),
    additionPatch.replace("new file mode 100644", "new file mode 120000"),
    additionPatch.replace("new file mode 100644", "new file mode 160000"),
    additionPatch.replace("index 0000000..3e75765", "GIT binary patch\nliteral 0\nHcmV?d00001"),
    additionPatch.replace("new file mode 100644", "deleted file mode 100644").replace("--- /dev/null", "--- a/added.txt").replace("+++ b/added.txt", "+++ /dev/null"),
    additionPatch.replace("new file mode 100644", "similarity index 100%\nrename from old.txt\nrename to added.txt"),
    additionPatch.replace("new file mode 100644", "similarity index 100%\ncopy from old.txt\ncopy to added.txt"),
    `${additionPatch}${additionPatch}`,
    additionPatch.replace("diff --git a/added.txt b/added.txt", "diff --git added.txt added.txt"),
    additionPatch.replace("+++ b/added.txt", "+++ b/other.txt"),
    additionPatch.replaceAll("added.txt", "../added.txt")
  ];

  for (const output of invalidPatches) {
    const root = repository();
    const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output }));
    const generated = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
    await terminal(tasks, generated.taskId);
    await expectCode(
      () => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }),
      "WORKSPACE_PRECONDITION_FAILED"
    );
  }
});

test("collapses extra trailing LFs in controlled patch results", async () => {
  const root = repository();
  const { controlled, tasks } = fixture(root, async () => ({
    kind: "completed",
    output: `${validPatch}\n\n`
  }));

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });
  await terminal(tasks, generated.taskId);

  assert.deepEqual(tasks.result(generated.taskId), {
    id: generated.taskId,
    state: "completed",
    output: validPatch
  });
});

test("requires exact confirmation and a successfully completed generation task", async () => {
  const root = repository();
  let finish!: (result: ExecutorResult) => void;
  const pending = new Promise<ExecutorResult>((done) => { finish = done; });
  const { controlled, tasks } = fixture(root, () => pending);
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change" });
  await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "apply" }), "INVALID_STATE_TRANSITION");
  await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "INVALID_STATE_TRANSITION");
  finish({ kind: "failed", error: { code: "CODEX_EXECUTION_FAILED", message: "Codex execution failed." } });
  await terminal(tasks, generated.taskId);
  await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "INVALID_STATE_TRANSITION");
});

test("removes a proposal when its controlled patch generation task fails", async () => {
  const root = repository();
  const { controlled, tasks } = fixture(root, async () => ({
    kind: "failed",
    error: { code: "CODEX_EXECUTION_FAILED", message: "Codex execution failed." }
  }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change" });
  await terminal(tasks, generated.taskId);

  const proposals = (controlled as unknown as { proposals: Map<string, { state: string }> }).proposals;
  assert.equal(proposals.has(generated.taskId), false);
});

test("rejects dirty workspaces, changed HEAD, and malformed or out-of-scope patches", async () => {
  const dirtyRoot = repository();
  writeFileSync(join(dirtyRoot, "note.txt"), "dirty\n");
  const dirty = fixture(dirtyRoot, async () => ({ kind: "completed", output: validPatch })).controlled;
  await expectCode(() => dirty.generate({ workspace_id: "workspace", change_request: "change" }), "WORKSPACE_PRECONDITION_FAILED");

  for (const output of ["```diff\n" + validPatch + "```", validPatch.replaceAll("note.txt", "new.txt")]) {
    const root = repository();
    const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output }));
    const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change" });
    await terminal(tasks, generated.taskId);
    await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "WORKSPACE_PRECONDITION_FAILED");
  }

  const root = repository();
  const { controlled, tasks } = fixture(root, async () => ({ kind: "completed", output: validPatch }));
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change" });
  await terminal(tasks, generated.taskId);
  writeFileSync(join(root, "other.txt"), "commit\n");
  git(root, "add", "other.txt");
  git(root, "commit", "-qm", "move head");
  await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "WORKSPACE_PRECONDITION_FAILED");
});

test("bounds applied proposal history without evicting live proposed or applying proposals", async () => {
  const root = repository();
  let next = 0;
  const { controlled, tasks } = fixture(root, async () => {
    const path = `added-${next++}.txt`;
    return { kind: "completed", output: additionPatch.replaceAll("added.txt", path) };
  });
  const appliedTaskIds: string[] = [];

  for (let index = 0; index < 101; index += 1) {
    const proposal = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
    await terminal(tasks, proposal.taskId);
    await controlled.apply({ patch_task_id: proposal.taskId, confirmation: "APPLY" });
    appliedTaskIds.push(proposal.taskId);
    git(root, "add", ".");
    git(root, "commit", "-qm", `apply ${index}`);
  }

  const proposals = (controlled as unknown as { proposals: Map<string, { state: string }> }).proposals;
  assert.equal(proposals.has(appliedTaskIds[0]!), false);
  for (const taskId of appliedTaskIds.slice(1)) assert.equal(proposals.get(taskId)?.state, "applied");

  const live = await controlled.generate({ workspace_id: "workspace", change_request: "add live file" });
  const applying = await controlled.generate({ workspace_id: "workspace", change_request: "add applying file" });
  proposals.get(applying.taskId)!.state = "applying";
  assert.equal(proposals.size, 102);

  await terminal(tasks, live.taskId);
  assert.equal((await controlled.apply({ patch_task_id: live.taskId, confirmation: "APPLY" })).applied, true);
  assert.equal(proposals.get(applying.taskId)?.state, "applying");
});

test("generates and refines proposals for an unborn repository with an explicit unborn instruction", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-")));
  initGit(root);
  const instructions: string[] = [];
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async (request) => {
      instructions.push(request.instruction);
      return { kind: "completed", output: additionPatch };
    }
  }));
  const controlled = new ControlledPatchService(registry, tasks);

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
  assert.equal(generated.baseHead, null);
  await terminal(tasks, generated.taskId);
  const generateInstruction = instructions[0] ?? "";
  assert.match(generateInstruction, /unborn repository state/u);
  assert.match(generateInstruction, /only add ordinary text files using new file mode 100644/u);
  // No fake HEAD: never "Base HEAD: null" or a fabricated SHA. (The embedded
  // source diff legitimately contains "/dev/null" headers.)
  assert.equal(generateInstruction.includes("Base HEAD: null"), false);
  assert.equal(/\bbase_head\s+null\b/u.test(generateInstruction), false);
  assert.equal(/\b[0-9a-f]{40}\b/u.test(generateInstruction), false);

  const refined = await controlled.refine({ patch_task_id: generated.taskId, change_request: "adjust" });
  assert.equal(refined.baseHead, null);
  await terminal(tasks, refined.taskId);
  const refinementInstruction = instructions[1] ?? "";
  assert.match(refinementInstruction, /unborn repository state/u);
  assert.match(refinementInstruction, /only add ordinary text files using new file mode 100644/u);
  assert.equal(refinementInstruction.includes("Base HEAD: null"), false);
  assert.equal(/\bbase_head\s+null\b/u.test(refinementInstruction), false);
  assert.equal(/\b[0-9a-f]{40}\b/u.test(refinementInstruction), false);
});

test("applies an unborn proposal while the repository stays unborn and does not stage files", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-")));
  initGit(root);
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: additionPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks);

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
  await terminal(tasks, generated.taskId);
  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.equal(applied.applied, true);
  assert.deepEqual(applied.changed_paths, ["added.txt"]);
  assert.equal(readFileSync(join(root, "added.txt"), "utf8"), "added\n");
  // git apply without --index never stages the new file.
  assert.equal(git(root, "ls-files", "--stage").trim(), "");
});

test("rejects an unborn proposal once the repository gains its first commit", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-")));
  initGit(root);
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: additionPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks);

  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "add file" });
  await terminal(tasks, generated.taskId);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(root, "add", "seed.txt");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "commit", "-qm", "first commit");

  // Both refine and APPLY must reject the stale unborn proposal.
  await expectCode(() => controlled.refine({ patch_task_id: generated.taskId, change_request: "adjust" }), "WORKSPACE_PRECONDITION_FAILED");
  await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "WORKSPACE_PRECONDITION_FAILED");
});

test("rejects unborn modified targets and targets that already exist as untracked files", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-")));
  initGit(root);
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks);

  const modified = await controlled.generate({ workspace_id: "workspace", change_request: "modify" });
  await terminal(tasks, modified.taskId);
  await expectCode(() => controlled.apply({ patch_task_id: modified.taskId, confirmation: "APPLY" }), "WORKSPACE_PRECONDITION_FAILED");

  const conflictingTasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: additionPatch })
  }));
  const conflicting = new ControlledPatchService(registry, conflictingTasks);
  const generated = await conflicting.generate({ workspace_id: "workspace", change_request: "add file" });
  await terminal(conflictingTasks, generated.taskId);
  writeFileSync(join(root, "added.txt"), "user content\n");
  await expectCode(() => conflicting.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "WORKSPACE_PRECONDITION_FAILED");
});

test("retained-state loader accepts old and new commit bases and quarantines illegal base combinations", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  const oldRecord = {
    version: 1,
    applied_task_ids: [],
    proposals: [{
      task_id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "workspace",
      workspace_root: root,
      base_head: head,
      state: "proposed",
      output: validPatch
    }]
  };
  writeFileSync(stateFilePath, `${JSON.stringify(oldRecord, null, 2)}\n`);
  const oldTasks = new RegisteredWorkspaceTaskService(registry, () => ({ execute: async () => ({ kind: "completed", output: validPatch }) }));
  const oldLoaded = new ControlledPatchService(registry, oldTasks, undefined, stateFilePath);
  await oldLoaded.load();
  const oldProposals = (oldLoaded as unknown as { proposals: Map<string, { base: { kind: string; head?: string } }> }).proposals;
  assert.equal(oldProposals.get("00000000-0000-4000-8000-000000000001")?.base.kind, "commit");

  const newCommitRecord = {
    ...oldRecord,
    proposals: [{ ...oldRecord.proposals[0]!, unborn: false }]
  };
  writeFileSync(stateFilePath, `${JSON.stringify(newCommitRecord, null, 2)}\n`);
  const newCommitTasks = new RegisteredWorkspaceTaskService(registry, () => ({ execute: async () => ({ kind: "completed", output: validPatch }) }));
  const newCommitLoaded = new ControlledPatchService(registry, newCommitTasks, undefined, stateFilePath);
  await newCommitLoaded.load();
  assert.equal(
    (newCommitLoaded as unknown as { proposals: Map<string, { base: { kind: string; head?: string } }> }).proposals
      .get("00000000-0000-4000-8000-000000000001")?.base.kind,
    "commit"
  );

  const unbornRoot = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-state-")));
  initGit(unbornRoot);
  const unbornStateFilePath = retainedStateFile();
  writeFileSync(unbornStateFilePath, `${JSON.stringify({
    version: 1,
    applied_task_ids: [],
    proposals: [{
      task_id: "00000000-0000-4000-8000-000000000002",
      workspace_id: "unborn-workspace",
      workspace_root: unbornRoot,
      base_head: null,
      unborn: true,
      state: "proposed",
      output: additionPatch
    }]
  }, null, 2)}\n`);
  const unbornRegistry = new RegisteredWorkspaceRegistry([{ id: "unborn-workspace", root: unbornRoot, allow_write: true }]);
  const unbornTasks = new RegisteredWorkspaceTaskService(unbornRegistry, () => ({ execute: async () => ({ kind: "completed", output: additionPatch }) }));
  const unbornLoaded = new ControlledPatchService(unbornRegistry, unbornTasks, undefined, unbornStateFilePath);
  await unbornLoaded.load();
  assert.equal(
    (unbornLoaded as unknown as { proposals: Map<string, { base: { kind: string } }> }).proposals
      .get("00000000-0000-4000-8000-000000000002")?.base.kind,
    "unborn"
  );

  // Restart recovery: the restored unborn proposal can still be refined and applied.
  const refined = await unbornLoaded.refine({ patch_task_id: "00000000-0000-4000-8000-000000000002", change_request: "adjust" });
  assert.equal(refined.baseHead, null);
  await terminal(unbornTasks, refined.taskId);
  const restoredApplied = await unbornLoaded.apply({ patch_task_id: refined.taskId, confirmation: "APPLY" });
  assert.equal(restoredApplied.applied, true);
  assert.equal(readFileSync(join(unbornRoot, "added.txt"), "utf8"), "added\n");

  for (const [baseHead, unborn] of [[null, false], [head, true], [null, undefined]] as const) {
    // JSON.stringify drops the undefined key: [null, undefined] is exactly the
    // "base_head null with no unborn field" illegal combination. Each illegal
    // base makes only that proposal unrecoverable, so it is quarantined while
    // the rest of the state still loads.
    writeFileSync(stateFilePath, `${JSON.stringify({
      version: 1,
      applied_task_ids: [],
      proposals: [{
        task_id: "00000000-0000-4000-8000-000000000003",
        workspace_id: "workspace",
        workspace_root: root,
        base_head: baseHead,
        unborn,
        state: "proposed",
        output: validPatch
      }]
    }, null, 2)}\n`);
    const invalidTasks = new RegisteredWorkspaceTaskService(registry, () => ({ execute: async () => ({ kind: "completed", output: validPatch }) }));
    const invalid = new ControlledPatchService(registry, invalidTasks, undefined, stateFilePath);
    await invalid.load();
    const proposals = (invalid as unknown as { proposals: Map<string, unknown> }).proposals;
    assert.equal(proposals.has("00000000-0000-4000-8000-000000000003"), false);
  }
});

test("generation needs no write authorization; APPLY does, and AUTHORIZE afterwards enables the same proposal", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([]);
  const catalog = new ManagedWorkspaceCatalog(undefined);
  await catalog.load();
  const { id } = await catalog.registerOnce(root);
  registry.registerManaged(id, root);
  const onboarding = new WorkspaceOnboardingService(registry, catalog, []);
  const stateFilePath = retainedStateFile();
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: additionPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);

  // Any registered workspace can generate a read-only proposal.
  const generated = await controlled.generate({ workspace_id: id, change_request: "add file" });
  assert.equal(generated.baseHead, git(root, "rev-parse", "HEAD").trim());
  await terminal(tasks, generated.taskId);

  // Refinement is also read-only analysis: no write authorization needed.
  const refined = await controlled.refine({ patch_task_id: generated.taskId, change_request: "adjust" });
  assert.equal(refined.baseHead, git(root, "rev-parse", "HEAD").trim());
  await terminal(tasks, refined.taskId);

  // APPLY still requires controlled-write authorization.
  await expectCode(() => controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" }), "WORKSPACE_PRECONDITION_FAILED");

  // AUTHORIZE the managed workspace, then the SAME proposal applies.
  const authorized = await onboarding.authorizeWrite(id);
  assert.deepEqual(authorized, { workspace_id: id, allow_write: true });
  assert.equal(registry.resolveWritable(id), root);
  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });
  assert.equal(applied.applied, true);
  assert.equal(readFileSync(join(root, "added.txt"), "utf8"), "added\n");

  // Restart recovery: the authorized state round-trips through the catalog and registry.
  const reloadedRegistry = new RegisteredWorkspaceRegistry([]);
  for (const entry of catalog.entries()) reloadedRegistry.registerManaged(entry.id, entry.root, entry.allowWrite);
  assert.equal(reloadedRegistry.resolveWritable(id), root);
});

test("HEAD detection fails closed: a git helper spawn failure in a real unborn repo is not inferred as unborn", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-")));
  initGit(root);
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: additionPatch })
  }));
  // The repository is genuinely unborn, but the HEAD probe cannot even spawn:
  // that must fail closed, never be guessed as unborn.
  const starter: GitStarter = (executable, args, options) => {
    if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "--quiet" && args[3] === "HEAD") {
      throw new Error("simulated git spawn failure");
    }
    return spawn(executable, args, options);
  };
  const controlled = new ControlledPatchService(registry, tasks, starter);
  await expectCode(
    () => controlled.generate({ workspace_id: "workspace", change_request: "add file" }),
    "WORKSPACE_PRECONDITION_FAILED"
  );
});

test("HEAD detection fails closed: a nonzero rev-parse without unborn proof is not inferred as unborn", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  // rev-parse HEAD exits non-zero exactly as in an unborn repo, but the branch
  // symbolic ref resolves to a real commit: an inconsistent reference state,
  // not an unborn branch.
  const starter: GitStarter = (executable, args, options) => {
    if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "--quiet" && args[3] === "HEAD") {
      return spawn(process.execPath, ["-e", "process.exit(1)"], options);
    }
    return spawn(executable, args, options);
  };
  const controlled = new ControlledPatchService(registry, tasks, starter);
  await expectCode(
    () => controlled.generate({ workspace_id: "workspace", change_request: "change note" }),
    "WORKSPACE_PRECONDITION_FAILED"
  );
});

test("HEAD detection fails closed: a detached-style unresolvable HEAD is not inferred as unborn", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  // HEAD cannot resolve and there is no symbolic branch ref behind it (as with
  // a missing or detached HEAD): without a branch ref, unborn is unproven.
  const starter: GitStarter = (executable, args, options) => {
    if (args.includes("--quiet")) {
      return spawn(process.execPath, ["-e", "process.exit(1)"], options);
    }
    return spawn(executable, args, options);
  };
  const controlled = new ControlledPatchService(registry, tasks, starter);
  await expectCode(
    () => controlled.generate({ workspace_id: "workspace", change_request: "change note" }),
    "WORKSPACE_PRECONDITION_FAILED"
  );
});

test("HEAD detection fails closed: a non-branch symbolic HEAD is not inferred as unborn", async () => {
  // A real repository whose HEAD symbolic ref points outside refs/heads/: git
  // reports no resolvable HEAD, but this is not an unborn branch state.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "engineering-bridge-unborn-")));
  initGit(root);
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/tags/nonexistent\n");
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: additionPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks);
  await expectCode(
    () => controlled.generate({ workspace_id: "workspace", change_request: "add file" }),
    "WORKSPACE_PRECONDITION_FAILED"
  );
});

function retainedRecord(
  taskId: string,
  root: string,
  head: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    task_id: taskId,
    workspace_id: "workspace",
    workspace_root: root,
    base_head: head,
    state: "proposed",
    executor: "codex",
    output: validPatch,
    ...overrides
  };
}

function writeRetainedState(stateFilePath: string, state: unknown): void {
  writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`);
}

test("quarantines a single malformed proposal field while restoring the valid proposal", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const goodId = "00000000-0000-4000-8000-000000000001";
  const badId = "00000000-0000-4000-8000-000000000002";
  const badVariants: Array<Record<string, unknown>> = [
    { state: "bogus" },
    { output: 42 },
    { base_head: "not-a-hex" },
    { unborn: "yes" },
    { workspace_id: "" },
    { workspace_root: 42 },
    { parent_task_id: "not-a-uuid" }
  ];

  for (const badFields of badVariants) {
    const stateFilePath = retainedStateFile();
    writeRetainedState(stateFilePath, {
      version: 1,
      applied_task_ids: [],
      proposals: [
        retainedRecord(goodId, root, head),
        retainedRecord(badId, root, head, badFields)
      ]
    });
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await controlled.load();

    const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
    assert.deepEqual([...proposals.keys()], [goodId]);
    assert.equal(tasks.taskView(goodId)?.state, "completed");
    // The quarantined record is unreachable through every proposal surface.
    assert.equal(tasks.taskView(badId), undefined);
    assert.equal(tasks.result(badId), undefined);
    await expectCode(() => controlled.refine({
      patch_task_id: badId,
      change_request: "improve"
    }), "INVALID_STATE_TRANSITION");
    await expectCode(() => controlled.apply({
      patch_task_id: badId,
      confirmation: "APPLY"
    }), "INVALID_STATE_TRANSITION");
  }
});

test("quarantines a proposal with an invalid task id without touching the valid proposals", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [],
    proposals: [
      retainedRecord("00000000-0000-4000-8000-000000000001", root, head),
      retainedRecord("not-a-uuid", root, head),
      retainedRecord("00000000-0000-4000-8000-000000000003", root, head)
    ]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.deepEqual(
    [...proposals.keys()],
    ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003"]
  );
  assert.equal(proposals.size, 2);
});

test("quarantines proposals whose workspace is unregistered or whose root moved, keeping the rest", async () => {
  const root = repository();
  const other = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const otherHead = git(other, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [],
    proposals: [
      retainedRecord("00000000-0000-4000-8000-000000000001", root, head),
      // Unregistered workspace: registry.resolve throws UNKNOWN_WORKSPACE.
      retainedRecord("00000000-0000-4000-8000-000000000002", other, otherHead, { workspace_id: "ghost" }),
      // Registered id whose persisted root no longer matches the registry.
      retainedRecord("00000000-0000-4000-8000-000000000003", other, otherHead)
    ]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.deepEqual([...proposals.keys()], ["00000000-0000-4000-8000-000000000001"]);
  assert.equal(tasks.taskView("00000000-0000-4000-8000-000000000001")?.state, "completed");
  for (const skipped of ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"]) {
    assert.equal(proposals.has(skipped), false);
    assert.equal(tasks.taskView(skipped), undefined);
    await expectCode(() => controlled.apply({ patch_task_id: skipped, confirmation: "APPLY" }), "INVALID_STATE_TRANSITION");
  }
});

test("a single bad proposal record does not prevent Bridge startup", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  const badStates: unknown[] = [
    { version: 1, applied_task_ids: [], proposals: [retainedRecord("00000000-0000-4000-8000-000000000001", root, head, { output: 42 })] },
    { version: 1, applied_task_ids: [], proposals: [null] }
  ];
  for (const state of badStates) {
    writeRetainedState(stateFilePath, state);
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await controlled.load();

    const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
    assert.equal(proposals.size, 0);
    const appliedProposalTaskIds = (controlled as unknown as { appliedProposalTaskIds: string[] }).appliedProposalTaskIds;
    assert.deepEqual(appliedProposalTaskIds, []);
  }
});

test("drops the applied history entry of a quarantined applied proposal and keeps the rest not re-appliable", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const badAppliedId = "00000000-0000-4000-8000-000000000001";
  const goodAppliedId = "00000000-0000-4000-8000-000000000002";
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [badAppliedId, goodAppliedId],
    proposals: [
      // Malformed output makes this applied record unrecoverable: it and its
      // applied_task_ids entry are quarantined together.
      retainedRecord(badAppliedId, root, head, { state: "applied", output: 42 }),
      retainedRecord(goodAppliedId, root, head, { state: "applied" })
    ]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  const proposals = (controlled as unknown as { proposals: Map<string, { state: string }> }).proposals;
  assert.deepEqual([...proposals.keys()], [goodAppliedId]);
  assert.equal(proposals.get(goodAppliedId)?.state, "applied");
  const appliedProposalTaskIds = (controlled as unknown as { appliedProposalTaskIds: string[] }).appliedProposalTaskIds;
  assert.deepEqual(appliedProposalTaskIds, [goodAppliedId]);
  // The surviving applied proposal must not become re-appliable.
  await expectCode(() => controlled.apply({
    patch_task_id: goodAppliedId,
    confirmation: "APPLY"
  }), "INVALID_STATE_TRANSITION");
});

test("retained state fails closed: unsupported version and invalid top-level structure", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  const invalidStates: unknown[] = [
    { version: 2, applied_task_ids: [], proposals: [retainedRecord("00000000-0000-4000-8000-000000000001", root, head)] },
    { version: 1, proposals: [] },
    { version: 1, applied_task_ids: [], proposals: "nope" }
  ];
  for (const state of invalidStates) {
    writeRetainedState(stateFilePath, state);
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await expectCode(() => controlled.load(), "INTERNAL_ERROR");
  }
});

test("retained state fails closed: applied_task_ids itself is invalid", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const stateFilePath = retainedStateFile();
  const invalidAppliedLists: unknown[] = [
    "nope",
    [123],
    ["not-a-uuid"],
    [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001"
    ]
  ];
  for (const appliedTaskIds of invalidAppliedLists) {
    writeRetainedState(stateFilePath, { version: 1, applied_task_ids: appliedTaskIds, proposals: [] });
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await expectCode(() => controlled.load(), "INTERNAL_ERROR");
  }
});

test("retained state fails closed: duplicate proposal task ids are ambiguous even with a broken duplicate", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  const duplicateStates: unknown[] = [
    // Two otherwise valid records with the same task id.
    {
      version: 1,
      applied_task_ids: [],
      proposals: [
        retainedRecord("00000000-0000-4000-8000-000000000001", root, head),
        retainedRecord("00000000-0000-4000-8000-000000000001", root, head)
      ]
    },
    // One broken duplicate could claim a different applied state than the
    // valid record, so the duplicate id always fails closed.
    {
      version: 1,
      applied_task_ids: [],
      proposals: [
        retainedRecord("00000000-0000-4000-8000-000000000001", root, head),
        retainedRecord("00000000-0000-4000-8000-000000000001", root, head, { state: "applied", output: 42 })
      ]
    }
  ];
  for (const state of duplicateStates) {
    writeRetainedState(stateFilePath, state);
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await expectCode(() => controlled.load(), "INTERNAL_ERROR");
  }
});

test("retained state fails closed: applied_task_ids contradicts the surviving proposal states", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  const firstId = "00000000-0000-4000-8000-000000000001";
  const secondId = "00000000-0000-4000-8000-000000000002";
  const contradictoryStates: unknown[] = [
    // Applied history claims a proposal the record says is only proposed.
    {
      version: 1,
      applied_task_ids: [firstId],
      proposals: [retainedRecord(firstId, root, head)]
    },
    // A proposal claims to be applied but is missing from applied history.
    {
      version: 1,
      applied_task_ids: [],
      proposals: [retainedRecord(firstId, root, head, { state: "applied" })]
    },
    // Applied history claims a proposal stuck in the interrupted applying state.
    {
      version: 1,
      applied_task_ids: [firstId, secondId],
      proposals: [
        retainedRecord(firstId, root, head, { state: "applied" }),
        retainedRecord(secondId, root, head, { state: "applying" })
      ]
    }
  ];
  for (const state of contradictoryStates) {
    writeRetainedState(stateFilePath, state);
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await expectCode(() => controlled.load(), "INTERNAL_ERROR");
  }
});

test("retained state fails closed: an applied id with no backing proposal record at all", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: ["00000000-0000-4000-8000-000000000001"],
    proposals: []
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await expectCode(() => controlled.load(), "INTERNAL_ERROR");
});

test("keeps a child proposal usable when its parent record is quarantined", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const parentId = "00000000-0000-4000-8000-000000000001";
  const childId = "00000000-0000-4000-8000-000000000002";
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [],
    proposals: [
      // Bad parent record: quarantined on its own merits.
      retainedRecord(parentId, root, head, { state: "bogus" }),
      retainedRecord(childId, root, head, { parent_task_id: parentId })
    ]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  const proposals = (controlled as unknown as { proposals: Map<string, { parentTaskId?: string }> }).proposals;
  assert.deepEqual([...proposals.keys()], [childId]);
  // The dangling parent link (audit lineage only) is retained and harmless.
  assert.equal(proposals.get(childId)?.parentTaskId, parentId);
  assert.equal(tasks.taskView(childId)?.state, "completed");
  const refined = await controlled.refine({ patch_task_id: childId, change_request: "improve" });
  await terminal(tasks, refined.taskId);
  const applied = await controlled.apply({ patch_task_id: refined.taskId, confirmation: "APPLY" });
  assert.equal(applied.applied, true);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
});

test("retained state fails closed: a surviving parent contradicts the child workspace or base", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([
    { id: "workspace", root, allow_write: true },
    { id: "other", root, allow_write: true }
  ]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const parentId = "00000000-0000-4000-8000-000000000001";
  const childId = "00000000-0000-4000-8000-000000000002";
  const stateFilePath = retainedStateFile();
  const inconsistentChildren: Array<Record<string, unknown>> = [
    // Child base differs from the surviving parent's base.
    { parent_task_id: parentId, base_head: "1111111111111111111111111111111111111111" },
    // Child workspace differs from the surviving parent's workspace.
    { parent_task_id: parentId, workspace_id: "other" }
  ];
  for (const childOverrides of inconsistentChildren) {
    writeRetainedState(stateFilePath, {
      version: 1,
      applied_task_ids: [],
      proposals: [
        retainedRecord(parentId, root, head),
        retainedRecord(childId, root, head, childOverrides)
      ]
    });
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await expectCode(() => controlled.load(), "INTERNAL_ERROR");
  }
});

test("keeps a refine chain usable across restart when refining a restored child", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const refinedPatch = validPatch.replace("+after", "+refined after");
  const first = fixture(
    root,
    async () => ({ kind: "completed", output: validPatch }),
    undefined,
    stateFilePath
  );
  const source = await first.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note"
  });
  await terminal(first.tasks, source.taskId);
  const refined = await first.controlled.refine({
    patch_task_id: source.taskId,
    change_request: "improve wording"
  });
  await terminal(first.tasks, refined.taskId);

  const restarted = fixture(
    root,
    async () => ({ kind: "completed", output: refinedPatch }),
    undefined,
    stateFilePath
  );
  await restarted.controlled.load();
  // Refining the restored child, not the source: the chain stays usable.
  const refined2 = await restarted.controlled.refine({
    patch_task_id: refined.taskId,
    change_request: "polish"
  });
  await terminal(restarted.tasks, refined2.taskId);

  assert.equal(refined2.baseHead, source.baseHead);
  const state = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
    proposals: Array<{ task_id: string; parent_task_id?: string }>;
  };
  assert.equal(state.proposals.find(({ task_id }) => task_id === refined2.taskId)?.parent_task_id, refined.taskId);
  const applied = await restarted.controlled.apply({ patch_task_id: refined2.taskId, confirmation: "APPLY" });
  assert.equal(applied.applied, true);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "refined after\n");
});

test("generate routes an explicit dsh executor to the factory and reports dsh in taskView", async () => {
  const root = repository();
  const factoryCalls: string[] = [];
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, (executor) => {
    factoryCalls.push(executor);
    return { execute: async () => ({ kind: "completed", output: validPatch }) };
  });
  const controlled = new ControlledPatchService(registry, tasks);
  const generated = await controlled.generate({
    workspace_id: "workspace",
    change_request: "change note",
    executor: "dsh"
  });
  await terminal(tasks, generated.taskId);

  assert.deepEqual(factoryCalls, ["dsh"]);
  assert.equal(tasks.taskView(generated.taskId)?.executor, "dsh");
});

test("generate without executor keeps the codex default", async () => {
  const root = repository();
  const factoryCalls: string[] = [];
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, (executor) => {
    factoryCalls.push(executor);
    return { execute: async () => ({ kind: "completed", output: validPatch }) };
  });
  const controlled = new ControlledPatchService(registry, tasks);
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });
  await terminal(tasks, generated.taskId);

  assert.deepEqual(factoryCalls, ["codex"]);
  assert.equal(tasks.taskView(generated.taskId)?.executor, "codex");
});

test("refine selects the executor per call and never inherits the parent proposal's executor", async () => {
  const root = repository();
  const factoryCalls: string[] = [];
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, (executor) => {
    factoryCalls.push(executor);
    return { execute: async () => ({ kind: "completed", output: validPatch }) };
  });
  const controlled = new ControlledPatchService(registry, tasks);
  const source = await controlled.generate({
    workspace_id: "workspace",
    change_request: "change note",
    executor: "dsh"
  });
  await terminal(tasks, source.taskId);

  const refinedDsh = await controlled.refine({
    patch_task_id: source.taskId,
    change_request: "adjust",
    executor: "dsh"
  });
  await terminal(tasks, refinedDsh.taskId);
  const refinedDefault = await controlled.refine({
    patch_task_id: source.taskId,
    change_request: "polish"
  });
  await terminal(tasks, refinedDefault.taskId);

  assert.deepEqual(factoryCalls, ["dsh", "dsh", "codex"]);
  assert.equal(tasks.taskView(refinedDsh.taskId)?.executor, "dsh");
  assert.equal(tasks.taskView(refinedDefault.taskId)?.executor, "codex");
});

test("persists the proposal executor and restores a dsh proposal after restart", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const first = fixture(root, async () => ({ kind: "completed", output: validPatch }), undefined, stateFilePath);
  const generated = await first.controlled.generate({
    workspace_id: "workspace",
    change_request: "change note",
    executor: "dsh"
  });
  await terminal(first.tasks, generated.taskId);

  const state = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
    proposals: Array<{ task_id: string; executor?: unknown }>;
  };
  assert.equal(state.proposals.find(({ task_id }) => task_id === generated.taskId)?.executor, "dsh");

  const restarted = fixture(
    root,
    async () => { throw new Error("restored tasks must not execute"); },
    undefined,
    stateFilePath
  );
  await restarted.controlled.load();

  assert.deepEqual(restarted.tasks.taskView(generated.taskId), {
    taskId: generated.taskId,
    state: "completed",
    executor: "dsh",
    ready: true,
    output: validPatch
  });
});

test("restores a legacy retained proposal without an executor field as codex", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [],
    proposals: [{
      task_id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "workspace",
      workspace_root: root,
      base_head: head,
      state: "proposed",
      output: validPatch
    }]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  assert.equal(tasks.taskView("00000000-0000-4000-8000-000000000001")?.executor, "codex");
});

test("quarantines a retained proposal with an invalid executor instead of downgrading to codex", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [],
    proposals: [
      retainedRecord("00000000-0000-4000-8000-000000000001", root, head),
      retainedRecord("00000000-0000-4000-8000-000000000002", root, head, { executor: "gemini" })
    ]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => ({ kind: "completed", output: validPatch })
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.deepEqual([...proposals.keys()], ["00000000-0000-4000-8000-000000000001"]);
  assert.equal(tasks.taskView("00000000-0000-4000-8000-000000000002"), undefined);
  assert.equal(tasks.result("00000000-0000-4000-8000-000000000002"), undefined);
  await expectCode(() => controlled.apply({
    patch_task_id: "00000000-0000-4000-8000-000000000002",
    confirmation: "APPLY"
  }), "INVALID_STATE_TRANSITION");
});

test("applies a dsh-generated proposal without invoking any executor again", async () => {
  const root = repository();
  let executions = 0;
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => {
    executions += 1;
    return { execute: async () => ({ kind: "completed", output: validPatch }) };
  });
  const controlled = new ControlledPatchService(registry, tasks);
  const generated = await controlled.generate({
    workspace_id: "workspace",
    change_request: "change note",
    executor: "dsh"
  });
  await terminal(tasks, generated.taskId);
  assert.equal(executions, 1);

  const applied = await controlled.apply({ patch_task_id: generated.taskId, confirmation: "APPLY" });

  assert.deepEqual(applied.changed_paths, ["note.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
  assert.equal(executions, 1);
});

test("submit_controlled_patch registers a retained submitted proposal that APPLY applies without any executor", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  let executions = 0;
  const { controlled, tasks } = fixture(root, async () => {
    executions += 1;
    throw new Error("submitted tasks must not execute");
  }, undefined, stateFilePath);
  const head = git(root, "rev-parse", "HEAD").trim();
  const submitted = await controlled.submit({ workspace_id: "workspace", base_head: head, diff: validPatch });

  assert.equal(submitted.baseHead, head);
  assert.equal(executions, 0);
  assert.deepEqual(tasks.taskView(submitted.taskId), {
    taskId: submitted.taskId,
    state: "completed",
    source: "submitted",
    ready: true,
    output: validPatch
  });
  assert.equal(tasks.taskView(submitted.taskId)?.executor, undefined);
  assert.deepEqual(tasks.result(submitted.taskId), {
    id: submitted.taskId,
    state: "completed",
    output: validPatch
  });
  // The retained record uses source: "submitted" and carries no executor field.
  const state = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
    proposals: Array<{ task_id: string; executor?: unknown; source?: unknown }>;
  };
  const retained = state.proposals.find(({ task_id }) => task_id === submitted.taskId);
  assert.ok(retained);
  assert.equal(retained.source, "submitted");
  assert.equal("executor" in retained, false);

  const applied = await controlled.apply({ patch_task_id: submitted.taskId, confirmation: "APPLY" });
  assert.deepEqual(applied.changed_paths, ["note.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
  assert.equal(executions, 0);
});

test("submit rejects a base_head that is not exactly the current commit HEAD", async () => {
  const root = repository();
  const { controlled, tasks } = fixture(root, async () => {
    throw new Error("must not execute");
  });
  const head = git(root, "rev-parse", "HEAD").trim();
  await expectCode(() => controlled.submit({
    workspace_id: "workspace",
    base_head: "0".repeat(40),
    diff: validPatch
  }), "WORKSPACE_PRECONDITION_FAILED");

  // A previously correct base_head becomes stale once HEAD moves.
  writeFileSync(join(root, "other.txt"), "commit\n");
  git(root, "add", "other.txt");
  git(root, "commit", "-qm", "move head");
  await expectCode(() => controlled.submit({
    workspace_id: "workspace",
    base_head: head,
    diff: validPatch
  }), "WORKSPACE_PRECONDITION_FAILED");

  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.equal(proposals.size, 0);
});

test("submit rejects unsafe diffs and dirty workspaces with the shared preflight without registering anything", async () => {
  const root = repository();
  const { controlled, tasks } = fixture(root, async () => {
    throw new Error("must not execute");
  });
  const head = git(root, "rev-parse", "HEAD").trim();

  for (const diff of [
    "not a patch",
    `\`\`\`diff\n${validPatch}\`\`\``,
    validPatch.replaceAll("note.txt", "new.txt"),
    additionPatch.replace("new file mode 100644", "new file mode 100755")
  ]) {
    await expectCode(() => controlled.submit({ workspace_id: "workspace", base_head: head, diff }),
      "WORKSPACE_PRECONDITION_FAILED");
  }

  // A dirty worktree fails the same workspace preflight as generate and APPLY.
  writeFileSync(join(root, "note.txt"), "dirty\n");
  await expectCode(() => controlled.submit({ workspace_id: "workspace", base_head: head, diff: validPatch }),
    "WORKSPACE_PRECONDITION_FAILED");

  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.equal(proposals.size, 0);
});

test("submit requires no write authorization; APPLY still re-verifies it", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: false }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => {
    throw new Error("submitted tasks must not execute");
  });
  const controlled = new ControlledPatchService(registry, tasks);
  const head = git(root, "rev-parse", "HEAD").trim();
  const submitted = await controlled.submit({ workspace_id: "workspace", base_head: head, diff: validPatch });
  assert.equal(submitted.baseHead, head);

  // APPLY still requires controlled-write authorization for submitted proposals.
  await expectCode(() => controlled.apply({ patch_task_id: submitted.taskId, confirmation: "APPLY" }),
    "WORKSPACE_PRECONDITION_FAILED");
});

test("a submitted proposal survives restart and APPLY re-verifies HEAD, workspace, patch safety, and write authorization", async () => {
  const root = repository();
  const stateFilePath = retainedStateFile();
  const first = fixture(root, async () => { throw new Error("must not execute"); }, undefined, stateFilePath);
  const head = git(root, "rev-parse", "HEAD").trim();
  const submitted = await first.controlled.submit({ workspace_id: "workspace", base_head: head, diff: validPatch });

  const restarted = fixture(root, async () => { throw new Error("restored tasks must not execute"); }, undefined, stateFilePath);
  await restarted.controlled.load();

  assert.deepEqual(restarted.tasks.taskView(submitted.taskId), {
    taskId: submitted.taskId,
    state: "completed",
    source: "submitted",
    ready: true,
    output: validPatch
  });
  assert.equal(restarted.tasks.taskView(submitted.taskId)?.executor, undefined);
  assert.deepEqual(restarted.tasks.result(submitted.taskId), {
    id: submitted.taskId,
    state: "completed",
    output: validPatch
  });

  // HEAD drift is re-verified at APPLY: a new commit invalidates the submitted base.
  writeFileSync(join(root, "other.txt"), "commit\n");
  git(root, "add", "other.txt");
  git(root, "commit", "-qm", "move head");
  await expectCode(() => restarted.controlled.apply({ patch_task_id: submitted.taskId, confirmation: "APPLY" }),
    "WORKSPACE_PRECONDITION_FAILED");

  // Reset to the submitted base on a clean worktree: APPLY applies the retained diff.
  git(root, "reset", "--hard", head);
  const applied = await restarted.controlled.apply({ patch_task_id: submitted.taskId, confirmation: "APPLY" });
  assert.deepEqual(applied.changed_paths, ["note.txt"]);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
});

test("A consistent submitted record restores with submitted provenance and no executor identity", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const taskId = "00000000-0000-4000-8000-000000000001";
  const stateFilePath = retainedStateFile();
  // retainedRecord(...) defaults to executor: "codex"; the explicit
  // executor: undefined before source: "submitted" makes JSON serialization
  // truly omit the executor field.
  writeRetainedState(stateFilePath, {
    version: 1,
    applied_task_ids: [],
    proposals: [{
      ...retainedRecord(taskId, root, head),
      executor: undefined,
      source: "submitted"
    }]
  });
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: async () => { throw new Error("restored tasks must not execute"); }
  }));
  const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
  await controlled.load();

  assert.deepEqual(tasks.taskView(taskId), {
    taskId,
    state: "completed",
    source: "submitted",
    ready: true,
    output: validPatch
  });
  assert.equal(tasks.taskView(taskId)?.executor, undefined);
  // The restored submitted proposal stays usable through the existing APPLY flow.
  const applied = await controlled.apply({ patch_task_id: taskId, confirmation: "APPLY" });
  assert.equal(applied.applied, true);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\n");
});

test("quarantines submitted retained records that carry an executor identity or an unknown source", async () => {
  const root = repository();
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const head = git(root, "rev-parse", "HEAD").trim();
  const stateFilePath = retainedStateFile();
  const inconsistent: Array<Record<string, unknown>> = [
    // source "submitted" must never also claim an executor.
    { ...retainedRecord("00000000-0000-4000-8000-000000000001", root, head), source: "submitted" },
    // any other source value is invalid retained state.
    { ...retainedRecord("00000000-0000-4000-8000-000000000002", root, head), source: "generated" }
  ];
  for (const record of inconsistent) {
    writeRetainedState(stateFilePath, {
      version: 1,
      applied_task_ids: [],
      proposals: [record]
    });
    const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
      execute: async () => ({ kind: "completed", output: validPatch })
    }));
    const controlled = new ControlledPatchService(registry, tasks, undefined, stateFilePath);
    await controlled.load();
    const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
    assert.equal(proposals.size, 0);
    assert.equal(tasks.taskView(record.task_id as string), undefined);
  }
});

test("interrupts a running generate_controlled_patch through control_task and finalizes as TASK_INTERRUPTED", async () => {
  const root = repository();
  let release!: (result: ExecutorResult) => void;
  const pending = new Promise<ExecutorResult>((done) => { release = done; });
  let interrupts = 0;
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: () => pending,
    interrupt: async () => { interrupts += 1; release({ kind: "interrupted", output: "partial diff" }); }
  }));
  const controlled = new ControlledPatchService(registry, tasks);
  const generated = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });

  while (tasks.status(generated.taskId)?.state === "queued") {
    await new Promise<void>((done) => setImmediate(done));
  }
  assert.equal(tasks.status(generated.taskId)?.state, "running");

  const view = await tasks.controlTask(generated.taskId, "interrupt");
  assert.equal(view.state, "running");
  assert.equal(interrupts, 1);
  await terminal(tasks, generated.taskId);

  assert.deepEqual(tasks.result(generated.taskId), {
    id: generated.taskId,
    state: "failed",
    error: { code: "TASK_INTERRUPTED", message: "The task was interrupted." },
    partial_output: "partial diff"
  });
  // A failed generation removes its proposal, exactly like any other failure.
  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.equal(proposals.has(generated.taskId), false);
});

test("interrupts a running refine_controlled_patch through control_task and finalizes as TASK_INTERRUPTED", async () => {
  const root = repository();
  const releases: Array<(result: ExecutorResult) => void> = [];
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, () => ({
    execute: () => new Promise<ExecutorResult>((done) => { releases.push(done); }),
    interrupt: async () => { releases[releases.length - 1]?.({ kind: "interrupted", output: "" }); }
  }));
  const controlled = new ControlledPatchService(registry, tasks);
  const source = await controlled.generate({ workspace_id: "workspace", change_request: "change note" });
  releases[0]?.({ kind: "completed", output: validPatch });
  await terminal(tasks, source.taskId);

  const refined = await controlled.refine({ patch_task_id: source.taskId, change_request: "improve wording" });
  while (tasks.status(refined.taskId)?.state === "queued") {
    await new Promise<void>((done) => setImmediate(done));
  }
  assert.equal(tasks.status(refined.taskId)?.state, "running");
  await tasks.controlTask(refined.taskId, "interrupt");
  await terminal(tasks, refined.taskId);

  assert.deepEqual(tasks.result(refined.taskId), {
    id: refined.taskId,
    state: "failed",
    error: { code: "TASK_INTERRUPTED", message: "The task was interrupted." }
  });
  const proposals = (controlled as unknown as { proposals: Map<string, unknown> }).proposals;
  assert.equal(proposals.has(refined.taskId), false);
  // The completed source proposal survives the interrupted refinement.
  assert.equal(proposals.has(source.taskId), true);
});

test("steer on a running dsh generate task is unsupported; codex generate keeps the existing steer seam", async () => {
  const root = repository();
  const releases: Array<(result: ExecutorResult) => void> = [];
  const steers: string[] = [];
  const executorNames: string[] = [];
  const registry = new RegisteredWorkspaceRegistry([{ id: "workspace", root, allow_write: true }]);
  const tasks = new RegisteredWorkspaceTaskService(registry, (executor) => {
    executorNames.push(executor);
    const execute = () => new Promise<ExecutorResult>((done) => { releases.push(done); });
    return executor === "dsh"
      ? { execute }
      : { execute, steer: async (instruction) => { steers.push(instruction); } };
  });
  const controlled = new ControlledPatchService(registry, tasks);

  const dsh = await controlled.generate({ workspace_id: "workspace", change_request: "change", executor: "dsh" });
  while (tasks.status(dsh.taskId)?.state === "queued") {
    await new Promise<void>((done) => setImmediate(done));
  }
  await expectCode(() => tasks.controlTask(dsh.taskId, "steer", "keep going"), "UNSUPPORTED_ACTION");
  releases[0]?.({ kind: "completed", output: validPatch });
  await terminal(tasks, dsh.taskId);

  const codex = await controlled.generate({ workspace_id: "workspace", change_request: "change" });
  while (tasks.status(codex.taskId)?.state === "queued") {
    await new Promise<void>((done) => setImmediate(done));
  }
  await tasks.controlTask(codex.taskId, "steer", "keep going");
  assert.deepEqual(steers, ["keep going"]);
  releases[1]?.({ kind: "completed", output: validPatch });
  await terminal(tasks, codex.taskId);

  assert.deepEqual(executorNames, ["dsh", "codex"]);
});
