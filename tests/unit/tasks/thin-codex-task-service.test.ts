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
