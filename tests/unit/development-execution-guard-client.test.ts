import assert from "node:assert/strict";
import test from "node:test";

import {
  DevelopmentExecutionGuardClient,
  DevelopmentExecutionGuardSupervisor,
  type GuardProcessRunner,
  type GuardedTaskState
} from "../../src/core/development-execution-guard-client.js";

function options(overrides: Partial<ConstructorParameters<typeof DevelopmentExecutionGuardClient>[0]> = {}) {
  return {
    enabled: true,
    python: "python",
    script: "guard.py",
    leaseSeconds: 180,
    terminalGraceSeconds: 30,
    heartbeatIntervalMs: 10,
    ...overrides
  };
}

test("disabled guard preserves the existing Bridge path without spawning a helper", async () => {
  let calls = 0;
  const runner: GuardProcessRunner = async () => {
    calls += 1;
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const client = new DevelopmentExecutionGuardClient(
    options({ enabled: false }),
    runner
  );

  assert.deepEqual(await client.heartbeat({
    workspaceRoot: String.raw`D:\repo`,
    source: "bridge",
    activity: "run_task-preflight"
  }), { ok: true });
  assert.equal(calls, 0);

  const stop = await client.stop({
    workspaceRoot: String.raw`D:\repo`,
    eventId: "stop-1",
    kind: "waiting",
    reasonZh: "等待驗收。"
  });
  assert.equal(stop.ok, false);
  assert.equal(calls, 0);
});

test("enabled heartbeat is fail-closed unless the helper returns ok true", async () => {
  const invocations: Array<{ executable: string; args: readonly string[] }> = [];
  const runner: GuardProcessRunner = async (executable, args) => {
    invocations.push({ executable, args });
    return {
      exitCode: 8,
      stdout: "",
      stderr: JSON.stringify({ ok: false, error: "delivery-failed" })
    };
  };
  const client = new DevelopmentExecutionGuardClient(options(), runner);
  const result = await client.heartbeat({
    workspaceRoot: String.raw`D:\repo`,
    source: "bridge",
    activity: "run_task-preflight",
    taskId: "task-1"
  });

  assert.equal(result.ok, false);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]?.executable, "python");
  assert.deepEqual(invocations[0]?.args.slice(0, 2), ["guard.py", "heartbeat"]);
  assert.equal(invocations[0]?.args.includes("--task-id"), true);
});

test("explicit stop succeeds only with a delivered helper receipt", async () => {
  const runner: GuardProcessRunner = async (_executable, args) => {
    assert.equal(args.includes("stop"), true);
    assert.equal(args.includes("stable-stop"), true);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        result: {
          state: "delivered",
          notification: { status: "delivered" }
        }
      }),
      stderr: ""
    };
  };
  const client = new DevelopmentExecutionGuardClient(options(), runner);
  const result = await client.stop({
    workspaceRoot: String.raw`D:\repo`,
    eventId: "stable-stop",
    kind: "completed",
    reasonZh: "開發任務完成。"
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload?.ok, true);
});

test("supervisor heartbeats active tasks then shortens the lease at terminal state", async () => {
  const calls: string[][] = [];
  const runner: GuardProcessRunner = async (_executable, args) => {
    calls.push([...args]);
    return {
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, result: { state: "active" } }),
      stderr: ""
    };
  };
  const client = new DevelopmentExecutionGuardClient(
    options({ heartbeatIntervalMs: 8, terminalGraceSeconds: 30 }),
    runner
  );
  let state: GuardedTaskState = "queued";
  const supervisor = new DevelopmentExecutionGuardSupervisor(
    client,
    () => state
  );

  assert.equal(await supervisor.beforeTask(String.raw`D:\repo`), true);
  supervisor.start("task-1", String.raw`D:\repo`);
  await new Promise<void>((resolve) => setTimeout(resolve, 15));
  state = "completed";
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  supervisor.stop("task-1");

  assert.equal(calls.some((args) => args.includes("run_task-preflight")), true);
  assert.equal(calls.some((args) => args.includes("run_task-active")), true);
  const terminal = calls.find((args) => args.includes("run_task-terminal-grace"));
  assert.notEqual(terminal, undefined);
  const leaseIndex = terminal?.indexOf("--lease-seconds") ?? -1;
  assert.equal(leaseIndex >= 0, true);
  assert.equal(terminal?.[leaseIndex + 1], "30");
});
