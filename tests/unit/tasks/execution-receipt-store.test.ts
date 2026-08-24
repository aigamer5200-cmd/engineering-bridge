import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { newId } from "../../../src/core/ids.js";
import { ExecutionReceiptStore } from "../../../src/tasks/execution-receipt-store.js";
import type { ExecutionReceiptRecord } from "../../../src/tasks/execution-receipt-store.js";

const ROOT = resolve(process.cwd(), "receipt-root");

function receipt(taskId = newId()): Omit<ExecutionReceiptRecord, "recordedAt"> {
  return {
    taskId,
    workspaceId: "known",
    workspaceRoot: ROOT,
    executor: "codex",
    operation: "run_task",
    readOnly: true,
    state: "completed"
  };
}

test("persists only bounded provenance fields and survives reload", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-receipts-")), "receipts.json");
  const store = new ExecutionReceiptStore(statePath);
  const taskId = newId();
  const input = {
    ...receipt(taskId),
    prompt: "SECRET_PROMPT_SENTINEL",
    output: "SECRET_OUTPUT_SENTINEL",
    token: "SECRET_TOKEN_SENTINEL"
  } as unknown as Omit<ExecutionReceiptRecord, "recordedAt">;

  await store.record(input);

  assert.deepEqual(Object.keys(store.get(taskId) ?? {}).sort(), [
    "executor",
    "operation",
    "readOnly",
    "recordedAt",
    "state",
    "taskId",
    "workspaceId",
    "workspaceRoot"
  ]);

  const raw = readFileSync(statePath, "utf8");
  assert.equal(raw.includes("SECRET_PROMPT_SENTINEL"), false);
  assert.equal(raw.includes("SECRET_OUTPUT_SENTINEL"), false);
  assert.equal(raw.includes("SECRET_TOKEN_SENTINEL"), false);
  const parsed = JSON.parse(raw) as { version: number; receipts: Array<Record<string, unknown>> };
  assert.equal(parsed.version, 1);
  assert.equal(parsed.receipts.length, 1);
  assert.deepEqual(Object.keys(parsed.receipts[0] ?? {}).sort(), [
    "executor",
    "operation",
    "read_only",
    "recorded_at",
    "state",
    "task_id",
    "workspace_id",
    "workspace_root"
  ]);

  const restored = new ExecutionReceiptStore(statePath);
  await restored.load();
  assert.equal(restored.get(taskId)?.workspaceRoot, ROOT);
  assert.equal(restored.get(taskId)?.state, "completed");
});

test("retains only the newest 500 valid receipts after load and next persist", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-receipts-cap-")), "receipts.json");
  const taskIds = Array.from({ length: 505 }, () => newId());
  const recordedAt = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    receipts: taskIds.map((taskId) => ({
      task_id: taskId,
      workspace_id: "known",
      workspace_root: ROOT,
      executor: "codex",
      operation: "run_task",
      read_only: true,
      state: "completed",
      recorded_at: recordedAt
    }))
  })}\n`, "utf8");

  const store = new ExecutionReceiptStore(statePath);
  await store.load();
  assert.equal(store.get(taskIds[0]), undefined);
  assert.equal(store.get(taskIds[4]), undefined);
  assert.equal(store.get(taskIds[5])?.taskId, taskIds[5]);

  const newest = newId();
  await store.record(receipt(newest));
  const persisted = JSON.parse(readFileSync(statePath, "utf8")) as { receipts: Array<{ task_id: string }> };
  assert.equal(persisted.receipts.length, 500);
  assert.equal(persisted.receipts.some(({ task_id }) => task_id === taskIds[5]), false);
  assert.equal(persisted.receipts.some(({ task_id }) => task_id === taskIds[6]), true);
  assert.equal(persisted.receipts.some(({ task_id }) => task_id === newest), true);
});

test("persist failure rolls back record and remove mutations", async () => {
  const root = mkdtempSync(join(tmpdir(), "engineering-bridge-receipts-fail-"));
  const statePath = join(root, "receipts.json");
  mkdirSync(statePath);
  const store = new ExecutionReceiptStore(statePath);
  const taskId = newId();

  await assert.rejects(store.record(receipt(taskId)));
  assert.equal(store.get(taskId), undefined);

  const goodPath = join(root, "good-receipts.json");
  const good = new ExecutionReceiptStore(goodPath);
  await good.record(receipt(taskId));
  assert.equal(good.get(taskId)?.taskId, taskId);
  rmSync(goodPath);
  mkdirSync(goodPath);
  await assert.rejects(good.remove(taskId));
  assert.equal(good.get(taskId)?.taskId, taskId);
});

test("completed receipt cannot be downgraded and identity cannot change", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-receipts-state-")), "receipts.json");
  const store = new ExecutionReceiptStore(statePath);
  const taskId = newId();
  await store.record(receipt(taskId));

  await store.record({ ...receipt(taskId), state: "waiting_for_supervisor_review" });
  assert.equal(store.get(taskId)?.state, "completed");
  await assert.rejects(store.record({ ...receipt(taskId), workspaceId: "different" }));
  assert.equal(store.get(taskId)?.workspaceId, "known");
});
