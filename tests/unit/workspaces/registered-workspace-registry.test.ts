import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import test from "node:test";

import { CoreError } from "../../../src/core/errors.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

const testRoot = (...parts: string[]): string => resolve(process.cwd(), "registry-fixtures", ...parts);
const ROOT = testRoot("registered", "root");
const WRITE_ROOT = testRoot("write", "root");
const OTHER_ROOT = testRoot("other", "root");
const MANAGED_ROOT = testRoot("managed", "root");
const MANUAL_ROOT = testRoot("manual", "root");
const TWO_ROOT = testRoot("two", "root");
const CANONICAL_ROOT = testRoot("canonical", "root");
const UNKNOWN_ROOT = testRoot("unknown", "root");
const MISSING_ROOT = testRoot("definitely", "missing", "path");
const WRITE_MANAGED_ROOT = testRoot("write", "managed");

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof CoreError && error.code === code);
}

test("returns the fixed root for a registered id", () => {
  const registry = new RegisteredWorkspaceRegistry([{ id: "known", root: ROOT }]);

  assert.equal(registry.resolve("known"), ROOT);
});

test("write access defaults to denied and must be explicitly enabled", () => {
  const registry = new RegisteredWorkspaceRegistry([
    { id: "default", root: ROOT },
    { id: "enabled", root: WRITE_ROOT, allow_write: true }
  ]);

  expectCode(() => registry.resolveWritable("default"), "WORKSPACE_PRECONDITION_FAILED");
  assert.equal(registry.resolveWritable("enabled"), WRITE_ROOT);
  assert.equal(registry.resolve("default"), ROOT);
});

test("rejects an unknown id", () => {
  const registry = new RegisteredWorkspaceRegistry([{ id: "known", root: ROOT }]);

  expectCode(() => registry.resolve("unknown"), "UNKNOWN_WORKSPACE");
});

test("rejects duplicate ids", () => {
  expectCode(() => new RegisteredWorkspaceRegistry([
    { id: "known", root: ROOT },
    { id: "known", root: OTHER_ROOT }
  ]), "WORKSPACE_BOUNDARY_VIOLATION");
});

test("rejects relative, non-normalized, or empty configuration fields", () => {
  const invalidEntries = [
    [{ id: "known", root: "relative/root" }],
    [{ id: "known", root: `${ROOT}${sep}..${sep}root` }],
    [{ id: "", root: ROOT }],
    [{ id: "known", root: "" }]
  ];

  for (const entries of invalidEntries) {
    expectCode(() => new RegisteredWorkspaceRegistry(entries), "WORKSPACE_BOUNDARY_VIOLATION");
  }
  expectCode(
    () => new RegisteredWorkspaceRegistry([{ id: "known", root: ROOT, allow_write: "yes" }] as never),
    "WORKSPACE_BOUNDARY_VIOLATION"
  );
});

test("registers managed workspaces read-only and resolves them", () => {
  const registry = new RegisteredWorkspaceRegistry([]);
  registry.registerManaged("managed-1", ROOT);

  assert.equal(registry.resolve("managed-1"), ROOT);
  assert.deepEqual(registry.resolveExecution("managed-1"), { root: ROOT, allowWrite: false });
  expectCode(() => registry.resolveWritable("managed-1"), "WORKSPACE_PRECONDITION_FAILED");
  expectCode(() => registry.resolve("unknown-managed"), "UNKNOWN_WORKSPACE");
});

test("registerManaged is idempotent for the same id and root", () => {
  const registry = new RegisteredWorkspaceRegistry([]);
  registry.registerManaged("managed-1", ROOT);
  registry.registerManaged("managed-1", ROOT);
  assert.equal(registry.resolve("managed-1"), ROOT);
});

test("registerManaged rejects conflicting ids and occupied canonical roots", () => {
  const registry = new RegisteredWorkspaceRegistry([{ id: "manual", root: ROOT }]);
  expectCode(() => registry.registerManaged("managed-1", ROOT), "WORKSPACE_BOUNDARY_VIOLATION");

  registry.registerManaged("managed-1", MANAGED_ROOT);
  expectCode(() => registry.registerManaged("managed-1", OTHER_ROOT), "WORKSPACE_BOUNDARY_VIOLATION");
  expectCode(() => registry.registerManaged("managed-2", MANAGED_ROOT), "WORKSPACE_BOUNDARY_VIOLATION");
});

test("findByRoot returns the manual registration with its real write access", () => {
  const registry = new RegisteredWorkspaceRegistry([
    { id: "manual", root: ROOT, allow_write: true }
  ]);

  assert.deepEqual(registry.findByRoot(ROOT), {
    id: "manual",
    root: ROOT,
    allowWrite: true,
    source: "manual"
  });
  assert.equal(registry.findByRoot(UNKNOWN_ROOT), undefined);
});

test("findByRoot resolves managed registrations and manual canonical duplicates first-win", () => {
  const canonicalize = (root: string): string => root === MANUAL_ROOT ? CANONICAL_ROOT : root;
  const registry = new RegisteredWorkspaceRegistry([
    { id: "first", root: MANUAL_ROOT },
    { id: "second", root: TWO_ROOT }
  ], canonicalize);

  assert.deepEqual(registry.findByRoot(CANONICAL_ROOT), {
    id: "first",
    root: MANUAL_ROOT,
    allowWrite: false,
    source: "manual"
  });

  registry.registerManaged("managed-1", MANAGED_ROOT);
  assert.deepEqual(registry.findByRoot(MANAGED_ROOT), {
    id: "managed-1",
    root: MANAGED_ROOT,
    allowWrite: false,
    source: "managed"
  });
});

test("a managed registration cannot occupy a manual canonical root", () => {
  const canonicalize = (): string => CANONICAL_ROOT;
  const registry = new RegisteredWorkspaceRegistry([
    { id: "manual", root: MANUAL_ROOT, allow_write: true }
  ], canonicalize);

  expectCode(() => registry.registerManaged("managed-1", MANAGED_ROOT), "WORKSPACE_BOUNDARY_VIOLATION");
});

test("manual roots that cannot be canonicalized fall back to the literal root without failing startup", () => {
  const registry = new RegisteredWorkspaceRegistry([
    { id: "known", root: MISSING_ROOT }
  ]);

  assert.deepEqual(registry.findByRoot(MISSING_ROOT), {
    id: "known",
    root: MISSING_ROOT,
    allowWrite: false,
    source: "manual"
  });
  assert.equal(registry.resolve("known"), MISSING_ROOT);
});

test("registerManaged restores a persisted allow_write flag", () => {
  const registry = new RegisteredWorkspaceRegistry([]);
  registry.registerManaged("managed-readonly", ROOT);
  registry.registerManaged("managed-authorized", WRITE_MANAGED_ROOT, true);

  expectCode(() => registry.resolveWritable("managed-readonly"), "WORKSPACE_PRECONDITION_FAILED");
  assert.equal(registry.resolveWritable("managed-authorized"), WRITE_MANAGED_ROOT);
});

test("authorizeWrite grants controlled-write to managed workspaces idempotently", () => {
  const registry = new RegisteredWorkspaceRegistry([]);
  registry.registerManaged("managed-1", ROOT);
  expectCode(() => registry.resolveWritable("managed-1"), "WORKSPACE_PRECONDITION_FAILED");

  registry.authorizeWrite("managed-1");
  assert.equal(registry.resolveWritable("managed-1"), ROOT);
  registry.authorizeWrite("managed-1");
  assert.equal(registry.resolveWritable("managed-1"), ROOT);
});

test("authorizeWrite rejects manual workspaces and unknown ids", () => {
  const registry = new RegisteredWorkspaceRegistry([
    { id: "manual", root: ROOT, allow_write: true }
  ]);

  expectCode(() => registry.authorizeWrite("manual"), "WORKSPACE_PRECONDITION_FAILED");
  expectCode(() => registry.authorizeWrite("missing"), "UNKNOWN_WORKSPACE");
  assert.equal(registry.resolveWritable("manual"), ROOT);
});

test("sourceOf distinguishes manual and managed registrations", () => {
  const registry = new RegisteredWorkspaceRegistry([{ id: "manual", root: ROOT }]);
  registry.registerManaged("managed-1", MANAGED_ROOT);

  assert.equal(registry.sourceOf("manual"), "manual");
  assert.equal(registry.sourceOf("managed-1"), "managed");
  expectCode(() => registry.sourceOf("missing"), "UNKNOWN_WORKSPACE");
});
