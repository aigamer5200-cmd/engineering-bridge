import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { CoreError } from "../../../src/core/errors.js";
import { ManagedWorkspaceCatalog } from "../../../src/workspaces/managed-workspace-catalog.js";

function catalogPath(): string {
  return join(mkdtempSync(join(tmpdir(), "bridge-catalog-")), "managed-workspaces.json");
}

function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(action, (error: unknown) => error instanceof CoreError && error.code === code);
}

const canonical = (name: string): string => resolve(process.cwd(), "catalog-fixtures", name);

test("loads an absent catalog as empty and round-trips registrations through the file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-catalog-"));
  const path = join(directory, "managed-workspaces.json");
  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  assert.deepEqual(catalog.entries(), []);

  const firstRoot = canonical("a");
  const secondRoot = canonical("b");
  const first = await catalog.registerOnce(firstRoot);
  assert.equal(first.created, true);
  const second = await catalog.registerOnce(secondRoot);

  const reloaded = new ManagedWorkspaceCatalog(path);
  await reloaded.load();
  assert.deepEqual(reloaded.entries(), [
    { id: first.id, root: firstRoot, allowWrite: false },
    { id: second.id, root: secondRoot, allowWrite: false }
  ]);
  // Atomic writes leave no temporary files behind.
  assert.deepEqual(readdirSync(directory), ["managed-workspaces.json"]);
});

test("registerOnce returns the existing id for the same root without duplicating", async () => {
  const catalog = new ManagedWorkspaceCatalog(undefined);
  const root = canonical("a");
  const first = await catalog.registerOnce(root);
  const second = await catalog.registerOnce(root);

  assert.equal(second.id, first.id);
  assert.equal(second.created, false);
  assert.deepEqual(catalog.entries(), [{ id: first.id, root, allowWrite: false }]);
});

test("concurrent registerOnce calls for the same root converge on one id and one record", async () => {
  const path = catalogPath();
  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  const root = canonical("same");

  const [first, second] = await Promise.all([
    catalog.registerOnce(root),
    catalog.registerOnce(root)
  ]);

  assert.equal(first.id, second.id);
  assert.notEqual(first.created, second.created);

  const reloaded = new ManagedWorkspaceCatalog(path);
  await reloaded.load();
  assert.deepEqual(reloaded.entries(), [{ id: first.id, root, allowWrite: false }]);
});

test("a persist failure rolls back the in-memory record and allows a later retry", async () => {
  const path = catalogPath();
  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  const root = canonical("x");

  // Block the state file path with a directory so the atomic rename fails.
  mkdirSync(path);
  await expectCode(() => catalog.registerOnce(root), "INTERNAL_ERROR");
  assert.deepEqual(catalog.entries(), []);

  rmSync(path, { recursive: true, force: true });
  const retried = await catalog.registerOnce(root);
  assert.equal(retried.created, true);
  const reloaded = new ManagedWorkspaceCatalog(path);
  await reloaded.load();
  assert.deepEqual(reloaded.entries(), [{ id: retried.id, root, allowWrite: false }]);
});

test("skips individually invalid records and rejects a corrupt whole file", async () => {
  const path = catalogPath();
  const badIdRoot = canonical("bad-id");
  const okRoot = canonical("ok");
  const dupIdRoot = canonical("dup-id");
  writeFileSync(path, `${JSON.stringify({
    version: 1,
    workspaces: [
      { id: "not-a-uuid", root: badIdRoot },
      { id: "00000000-0000-4000-8000-000000000001", root: "relative/root" },
      { id: "00000000-0000-4000-8000-000000000002", root: okRoot },
      { id: "00000000-0000-4000-8000-000000000002", root: dupIdRoot },
      { id: "00000000-0000-4000-8000-000000000003", root: okRoot }
    ]
  }, null, 2)}\n`);

  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  assert.deepEqual(catalog.entries(), [
    { id: "00000000-0000-4000-8000-000000000002", root: okRoot, allowWrite: false }
  ]);

  writeFileSync(path, "not json at all");
  await expectCode(() => new ManagedWorkspaceCatalog(path).load(), "INTERNAL_ERROR");

  writeFileSync(path, `${JSON.stringify({ version: 2, workspaces: [] })}\n`);
  await expectCode(() => new ManagedWorkspaceCatalog(path).load(), "INTERNAL_ERROR");
});

test("a catalog without a state file path stays process-local", async () => {
  const catalog = new ManagedWorkspaceCatalog(undefined);
  await catalog.load();
  const root = canonical("local");
  const { id } = await catalog.registerOnce(root);
  assert.deepEqual(catalog.entries(), [{ id, root, allowWrite: false }]);
});

test("loads pre-authorization v1 records as read-only and round-trips authorized records", async () => {
  const path = catalogPath();
  const oldRoot = canonical("old");
  const authorizedRoot = canonical("authorized");
  writeFileSync(path, `${JSON.stringify({
    version: 1,
    workspaces: [
      { id: "00000000-0000-4000-8000-000000000001", root: oldRoot },
      { id: "00000000-0000-4000-8000-000000000002", root: authorizedRoot, allow_write: true }
    ]
  }, null, 2)}\n`);

  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  assert.deepEqual(catalog.entries(), [
    { id: "00000000-0000-4000-8000-000000000001", root: oldRoot, allowWrite: false },
    { id: "00000000-0000-4000-8000-000000000002", root: authorizedRoot, allowWrite: true }
  ]);

  const reloaded = new ManagedWorkspaceCatalog(path);
  await reloaded.load();
  assert.deepEqual(reloaded.entries(), catalog.entries());
});

test("registerOnce records stay read-only until authorize flips the record persistently", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-catalog-auth-"));
  const path = join(directory, "managed-workspaces.json");
  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  const root = canonical("auth");
  const { id } = await catalog.registerOnce(root);
  assert.equal(catalog.entries()[0]?.allowWrite, false);

  await catalog.authorize(root);
  assert.equal(catalog.entries()[0]?.allowWrite, true);

  const reloaded = new ManagedWorkspaceCatalog(path);
  await reloaded.load();
  assert.deepEqual(reloaded.entries(), [{ id, root, allowWrite: true }]);
});

test("authorize is idempotent and unknown roots fail closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-catalog-idem-"));
  const path = join(directory, "managed-workspaces.json");
  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  const root = canonical("idem");
  await catalog.registerOnce(root);

  await catalog.authorize(root);
  await catalog.authorize(root);
  assert.equal(catalog.entries()[0]?.allowWrite, true);
  await expectCode(() => catalog.authorize(canonical("unknown")), "INTERNAL_ERROR");
  assert.equal(readdirSync(directory).length, 1); // no extra temporary files
});

test("concurrent authorize calls converge and a persist failure rolls back the in-memory record", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-catalog-conc-"));
  const path = join(directory, "managed-workspaces.json");
  const catalog = new ManagedWorkspaceCatalog(path);
  await catalog.load();
  const concurrentRoot = canonical("concurrent");
  await catalog.registerOnce(concurrentRoot);

  await Promise.all([
    catalog.authorize(concurrentRoot),
    catalog.authorize(concurrentRoot)
  ]);
  assert.equal(catalog.entries()[0]?.allowWrite, true);

  // Replace the state file with a directory so the atomic rename fails.
  const blockedPath = join(directory, "blocked.json");
  const blocked = new ManagedWorkspaceCatalog(blockedPath);
  await blocked.load();
  const blockedRoot = canonical("blocked");
  await blocked.registerOnce(blockedRoot);
  rmSync(blockedPath);
  mkdirSync(blockedPath);
  await expectCode(() => blocked.authorize(blockedRoot), "INTERNAL_ERROR");
  assert.equal(blocked.entries()[0]?.allowWrite, false);

  // The same catalog can authorize once the blocker is gone.
  rmSync(blockedPath, { recursive: true, force: true });
  await blocked.authorize(blockedRoot);
  assert.equal(blocked.entries()[0]?.allowWrite, true);
});
