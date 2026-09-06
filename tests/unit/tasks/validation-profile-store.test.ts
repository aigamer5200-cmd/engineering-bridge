import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CoreError } from "../../../src/core/errors.js";
import { ValidationProfileStore } from "../../../src/tasks/validation-profile-store.js";
import type { ValidationProfile } from "../../../src/tasks/validation-profile-store.js";

const PROFILE: ValidationProfile = {
  preparation: [
    { name: "install", argv: ["npm", "ci", "--ignore-scripts"] }
  ],
  validation: [
    { name: "test", argv: ["npm", "test"], timeoutSeconds: 90 }
  ],
  defaultStepTimeoutSeconds: 600,
  totalTimeoutSeconds: 1200
};

const REPLACEMENT_PROFILE: ValidationProfile = {
  preparation: [],
  validation: [
    { name: "typecheck", argv: ["npm", "run", "typecheck"] }
  ],
  defaultStepTimeoutSeconds: 300,
  totalTimeoutSeconds: 900
};

function stateFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "bridge-validation-profiles-")), "validation-profiles.json");
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof CoreError && error.code === code);
}

test("construction does not read a malformed state file", async () => {
  const path = stateFilePath();
  writeFileSync(path, `${JSON.stringify({ version: 1, profiles: "invalid" })}\n`);
  const store = new ValidationProfileStore(path);

  rmSync(path);
  assert.equal(await store.get("workspace-a"), undefined);
});

test("get fails closed on malformed top-level state", async () => {
  const path = stateFilePath();
  writeFileSync(path, `${JSON.stringify({ version: 1, profiles: "invalid" })}\n`);
  const store = new ValidationProfileStore(path);

  await expectCode(() => store.get("workspace-a"), "INTERNAL_ERROR");
});

test("a fresh configuration round-trips exactly through a second store", async () => {
  const path = stateFilePath();
  const store = new ValidationProfileStore(path);

  assert.deepEqual(await store.configure("workspace-a", PROFILE), PROFILE);

  const reloaded = new ValidationProfileStore(path);
  assert.deepEqual(await reloaded.get("workspace-a"), PROFILE);
});

test("configuring the same workspace replaces its whole profile", async () => {
  const path = stateFilePath();
  const store = new ValidationProfileStore(path);
  await store.configure("workspace-a", PROFILE);

  assert.deepEqual(
    await store.configure("workspace-a", REPLACEMENT_PROFILE),
    REPLACEMENT_PROFILE
  );
  assert.deepEqual(await store.get("workspace-a"), REPLACEMENT_PROFILE);

  const reloaded = new ValidationProfileStore(path);
  assert.deepEqual(await reloaded.get("workspace-a"), REPLACEMENT_PROFILE);
  const persisted = JSON.parse(readFileSync(path, "utf8")) as { profiles: unknown[] };
  assert.equal(persisted.profiles.length, 1);
});

test("profiles for two workspaces survive together", async () => {
  const path = stateFilePath();
  const store = new ValidationProfileStore(path);
  await store.configure("workspace-a", PROFILE);
  await store.configure("workspace-b", REPLACEMENT_PROFILE);

  const reloaded = new ValidationProfileStore(path);
  assert.deepEqual(await reloaded.get("workspace-a"), PROFILE);
  assert.deepEqual(await reloaded.get("workspace-b"), REPLACEMENT_PROFILE);
});

test("a failed atomic write rolls back the in-memory profile", async () => {
  const path = stateFilePath();
  const store = new ValidationProfileStore(path);
  await store.configure("workspace-a", PROFILE);

  rmSync(path);
  mkdirSync(path);
  await expectCode(
    () => store.configure("workspace-a", REPLACEMENT_PROFILE),
    "INTERNAL_ERROR"
  );

  assert.deepEqual(await store.get("workspace-a"), PROFILE);
});
