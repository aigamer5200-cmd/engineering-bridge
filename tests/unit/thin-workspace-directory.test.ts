import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceDirectory } from "../../src/transport/workspace-directory.js";
import { isWorkspaceRoot } from "../../src/transport/workspace-paths.js";
import { newId } from "../../src/core/ids.js";

test("Windows roots accept normalized drives/UNC and reject ambiguous/device namespaces", () => {
  for (const root of ["C:\\", "D:\\Projects\\app", "\\\\server\\share\\", "\\\\server\\share\\app"]) {
    assert.equal(isWorkspaceRoot(root, path.win32), true, root);
  }
  for (const root of ["", "C:app", "\\app", "\\", "\\\\server", "\\\\?\\C:\\app", "\\\\.\\C:\\app",
    "\\\\?\\UNC\\server\\share\\app", "C:/app", "C:\\app\\..\\other", "relative"]) {
    assert.equal(isWorkspaceRoot(root, path.win32), false, root);
  }
});

test("POSIX root semantics remain unchanged", () => {
  assert.equal(isWorkspaceRoot("/project/app", path.posix), true);
  assert.equal(isWorkspaceRoot("/project/../app", path.posix), false);
});

test("directory validates both manual and approved roots before binding", () => {
  assert.throws(() => new WorkspaceDirectory([{ id: "manual", root: "relative" }], [], "unused"), /configuration/);
  assert.throws(() => new WorkspaceDirectory([], ["relative"], "unused"), /configuration/);
  if (process.platform === "win32") {
    for (const root of ["\\app", "\\\\?\\C:\\app", "\\\\.\\C:\\app"]) {
      assert.throws(() => new WorkspaceDirectory([{ id: "manual", root }], [], "unused"), /configuration/);
      assert.throws(() => new WorkspaceDirectory([], [root], "unused"), /configuration/);
    }
  }
});

test("late-created manual junction retains its ID instead of registering a duplicate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-thin-identity-"));
  try {
    const alias = path.join(root, "alias");
    const target = path.join(root, "target");
    const state = path.join(root, "state.json");
    const directory = new WorkspaceDirectory([{ id: "manual", root: alias }], [root], state);
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(await directory.bind(target), { workspace_id: "manual", root: alias });
    await assert.rejects(readFile(state), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("load refreshes late manual identity and skips duplicate/invalid persisted roots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-thin-load-"));
  try {
    const alias = path.join(root, "alias");
    const target = path.join(root, "target");
    const state = path.join(root, "state.json");
    const directory = new WorkspaceDirectory([{ id: "manual", root: alias }], [root], state);
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const duplicate = newId();
    const invalid = newId();
    await writeFile(state, JSON.stringify({ version: 1, workspaces: [
      { id: duplicate, root: target }, { id: invalid, root: process.platform === "win32" ? "\\app" : "relative" }
    ] }));
    await directory.load();
    assert.throws(() => directory.resolve(duplicate), /not bound/);
    assert.throws(() => directory.resolve(invalid), /not bound/);
    assert.equal((await directory.bind(target)).workspace_id, "manual");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("canonical containment rejects sibling prefix and junction escape; binding remains idempotent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-thin-boundary-"));
  try {
    const approved = path.join(root, "approved");
    const sibling = path.join(root, "approved-other");
    await mkdir(approved); await mkdir(sibling);
    const project = path.join(approved, "project");
    await mkdir(project);
    const escape = path.join(approved, "escape");
    await symlink(sibling, escape, process.platform === "win32" ? "junction" : "dir");
    const state = path.join(root, "state.json");
    const directory = new WorkspaceDirectory([], [approved], state);
    await assert.rejects(directory.bind(sibling), /outside/);
    await assert.rejects(directory.bind(escape), /outside/);
    const [a, b] = await Promise.all([directory.bind(project), directory.bind(project)]);
    assert.deepEqual(a, b);
    const restored = new WorkspaceDirectory([], [approved], state);
    await restored.load();
    assert.deepEqual(await restored.bind(project), a);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows case aliases bind to the existing native canonical identity", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-thin-case-"));
  try {
    const project = path.join(root, "MixedCase");
    await mkdir(project);
    const directory = new WorkspaceDirectory([{ id: "manual", root: project.toUpperCase() }], [root], path.join(root, "state.json"));
    assert.equal((await directory.bind(project)).workspace_id, "manual");
  } finally { await rm(root, { recursive: true, force: true }); }
});
