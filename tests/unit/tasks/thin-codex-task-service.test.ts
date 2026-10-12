import assert from "node:assert/strict";
import test from "node:test";

import { ThinCodexTaskService } from "../../../src/tasks/thin-codex-task-service.js";
import type { CodexTaskExecutor, CodexTaskRequest } from "../../../src/transport/codex-app-server.js";

const WORKSPACE = "C:\\workspace";

function serviceWithCapture(): {
  readonly service: ThinCodexTaskService;
  readonly request: () => CodexTaskRequest | undefined;
} {
  let captured: CodexTaskRequest | undefined;
  const executor: CodexTaskExecutor = {
    execute: async (request) => {
      captured = request;
      return { kind: "completed", output: "done", threadId: "thread-1" };
    },
    interrupt: async () => {}
  };
  return {
    service: new ThinCodexTaskService(
      { resolve: (workspaceId) => { assert.equal(workspaceId, "known"); return WORKSPACE; } },
      () => executor
    ),
    request: () => captured
  };
}

async function waitForExecution(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("keeps omitted routing absent from the executor request and task result", async () => {
  const harness = serviceWithCapture();
  const { taskId } = harness.service.startTask({ workspace_id: "known", instruction: "inspect" });

  await waitForExecution();

  assert.deepEqual(harness.request(), { instruction: "inspect" });
  assert.deepEqual(harness.service.taskView(taskId), {
    taskId,
    state: "completed",
    threadId: "thread-1",
    output: "done"
  });
});

test("preserves explicit routing as non-secret task result provenance", async () => {
  const harness = serviceWithCapture();
  const { taskId } = harness.service.startTask({
    workspace_id: "known",
    instruction: "inspect",
    model: "gpt-5.6-custom",
    reasoning: "high",
    service_tier: "priority"
  });

  await waitForExecution();

  assert.deepEqual(harness.request(), {
    instruction: "inspect",
    model: "gpt-5.6-custom",
    reasoning: "high",
    service_tier: "priority"
  });
  assert.deepEqual(harness.service.taskView(taskId), {
    taskId,
    state: "completed",
    model: "gpt-5.6-custom",
    reasoning: "high",
    service_tier: "priority",
    threadId: "thread-1",
    output: "done"
  });
});

test("running task exposes bounded local health without altering routing or ending a quiet turn", async () => {
  let finish: () => void = () => {};
  const execution = new Promise<{ kind: "completed"; output: string }>((resolve) => {
    finish = () => resolve({ kind: "completed", output: "done" });
  });
  const executor: CodexTaskExecutor = {
    execute: () => execution,
    interrupt: async () => {},
    healthSnapshot: () => ({
      state: "running",
      process_state: "no_exit_observed",
      last_protocol_at: "2026-10-12T08:00:00.000Z",
      last_checked_at: "2026-10-12T08:03:00.000Z",
      quiet_for_ms: 180_000,
      checks: 1,
      observation: "quiet_unconfirmed"
    })
  };
  const service = new ThinCodexTaskService({ resolve: () => WORKSPACE }, () => executor);
  const { taskId } = service.startTask({ workspace_id: "known", instruction: "secret-instruction" });
  await waitForExecution();
  const view = service.taskView(taskId);
  assert.equal(view?.state, "running");
  assert.equal(view?.health?.checks, 1);
  assert.equal(view?.health?.observation, "quiet_unconfirmed");
  assert.equal(JSON.stringify(view).includes("secret-instruction"), false);
  finish();
  await waitForExecution();
  assert.equal(service.taskView(taskId)?.state, "completed");
});
