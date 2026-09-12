import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Executor, ExecutorEvidence } from "../../../src/executors/executor.js";
import { RegisteredWorkspaceTaskService } from "../../../src/tasks/registered-workspace-task-service.js";
import { createTaskObserver, TaskObserverLogger } from "../../../src/tasks/task-observer.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

async function waitUntilReady(service: RegisteredWorkspaceTaskService, taskId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = service.taskView(taskId)?.state;
    if (state !== "queued" && state !== "running") return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("task did not settle");
}

test("observer logs states, thread and bounded evidence without logging instruction or diffs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "engineering-bridge-observer-"));
  try {
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    const configPath = join(directory, "workspaces.json");
    const observer = new TaskObserverLogger(configPath, "log");
    const evidence: readonly ExecutorEvidence[] = [
      {
        id: "cmd-1",
        type: "commandExecution",
        command: "git status --short",
        status: "completed",
      },
      {
        id: "file-1",
        type: "fileChange",
        status: "completed",
        changes: [
          { path: "src/example.ts", diff: "SECRET_DIFF_MUST_NOT_BE_LOGGED" },
          { path: "tests/example.test.ts", diff: "another diff" },
        ],
      },
    ];
    const executor: Executor = {
      execute: async (request) => {
        request.onEvidence?.(evidence);
        return {
          kind: "completed",
          output: "done",
          threadId: "native-thread-1",
          evidence,
        };
      },
    };
    const registry = new RegisteredWorkspaceRegistry([{ id: "known", root: workspace }]);
    const service = new RegisteredWorkspaceTaskService(
      registry,
      () => executor,
      undefined,
      observer,
    );

    const { taskId } = service.startTask({
      workspace_id: "known",
      instruction: "PRIVATE_PROMPT_MUST_NOT_BE_LOGGED",
      executor: "codex",
    });
    await waitUntilReady(service, taskId);

    const log = readFileSync(observer.logPath, "utf8");
    assert.match(log, new RegExp(`task=${taskId} executor=codex state=queued`, "u"));
    assert.match(log, new RegExp(`task=${taskId} executor=codex state=running`, "u"));
    assert.match(log, /state=waiting_for_supervisor_review/u);
    assert.match(log, /thread_id=native-thread-1/u);
    assert.match(log, /command="git status --short"/u);
    assert.match(log, /paths="src\/example\.ts, tests\/example\.test\.ts"/u);
    assert.equal(log.includes("PRIVATE_PROMPT_MUST_NOT_BE_LOGGED"), false);
    assert.equal(log.includes("SECRET_DIFF_MUST_NOT_BE_LOGGED"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("observer is off unless explicitly enabled", () => {
  const directory = mkdtempSync(join(tmpdir(), "engineering-bridge-observer-off-"));
  try {
    const configPath = join(directory, "workspaces.json");
    assert.equal(
      createTaskObserver(configPath, { ENGINEERING_BRIDGE_OBSERVER_MODE: "off" }),
      undefined,
    );
    assert.equal(createTaskObserver(configPath, {}), undefined);
    assert.equal(existsSync(`${configPath}.observer.log`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("observer failover provenance is bounded and excludes credentials and provider payloads", () => {
  const directory = mkdtempSync(join(tmpdir(), "engineering-bridge-observer-failover-"));
  try {
    const observer = new TaskObserverLogger(join(directory, "workspaces.json"), "log");
    observer.failover("550e8400-e29b-41d4-a716-446655440000", {
      attempted: true,
      fromAccount: "A",
      toAccount: "B",
      reason: "ACCOUNT_5H_QUOTA_EXHAUSTED",
      quotaWindow: "5h",
      resetAt: "2026-09-12T06:39:30.000Z",
      retryCount: 1
    });

    const log = readFileSync(observer.logPath, "utf8");
    assert.match(log, /event=failover/u);
    assert.match(log, /from_account=A/u);
    assert.match(log, /to_account=B/u);
    assert.match(log, /reason=ACCOUNT_5H_QUOTA_EXHAUSTED/u);
    assert.match(log, /quota_window=5h/u);
    for (const forbidden of ["OPENAI_API_KEY", "auth.json", "owner@example.com", "raw_provider_response"]) {
      assert.equal(log.includes(forbidden), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("window observer reuses an existing live observer lease", { skip: process.platform !== "win32" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "engineering-bridge-observer-window-"));
  try {
    const configPath = join(directory, "workspaces.json");
    const leasePath = `${configPath}.observer.log.window.pid`;
    writeFileSync(leasePath, `${process.pid}\n`, "utf8");

    const observer = new TaskObserverLogger(configPath, "window");

    assert.equal(observer.logPath, `${configPath}.observer.log`);
    assert.equal(readFileSync(leasePath, "utf8"), `${process.pid}\n`);
    assert.match(readFileSync(observer.logPath, "utf8"), /observer=ready mode=window/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
