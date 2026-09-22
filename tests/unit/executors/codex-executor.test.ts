import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import { CodexExecutor, DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING } from "../../../src/executors/codex-executor.js";
import type { ProcessStarter } from "../../../src/executors/codex-executor.js";
import { VERSION } from "../../../src/version.js";

const TASK_ID = "550e8400-e29b-41d4-a716-446655440000" as never;
const TRUSTED_CWD = "/trusted/workspace";

interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: SpawnOptionsWithoutStdio;
  stdin: string;
  readonly signals: string[];
}

interface FakeBehavior {
  readonly output?: string;
  readonly largeFrame?: boolean;
  readonly hold?: boolean;
}

function fakeStarter(behavior: FakeBehavior, invocations: Invocation[]): ProcessStarter {
  return (executable, args, options) => {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const invocation: Invocation = {
      executable,
      args: [...args],
      options,
      stdin: "",
      signals: []
    };
    const send = (message: unknown): void => { stdout.write(`${JSON.stringify(message)}\n`); };
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        const source = chunk.toString();
        invocation.stdin += source;
        for (const line of source.trim().split("\n")) {
          if (line === "") continue;
          const message = JSON.parse(line) as { id?: number; method?: string };
          if (message.id === undefined) continue;
          if (message.method === "initialize") {
            queueMicrotask(() => send({ id: message.id, result: {} }));
          } else if (message.method === "thread/start") {
            queueMicrotask(() => send({ id: message.id, result: { thread: { id: "thread-1" } } }));
          } else if (message.method === "turn/start") {
            queueMicrotask(() => {
              send({ id: message.id, result: { turn: { id: "turn-1" } } });
              send({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } } });
              if (behavior.hold === true) return;
              if (behavior.largeFrame === true) {
                send({ method: "item/completed", params: {
                  item: { id: "command-1", type: "commandExecution", status: "completed", command: "Get-Content", aggregatedOutput: "x".repeat(200_000) }
                } });
              }
              send({ method: "item/completed", params: {
                item: { id: "message-1", type: "agentMessage", text: behavior.output ?? "done" }
              } });
              send({ method: "turn/completed", params: {
                threadId: "thread-1", turn: { id: "turn-1", status: "completed" }
              } });
            });
          } else if (message.method === "turn/interrupt") {
            queueMicrotask(() => send({ id: message.id, result: {} }));
          }
        }
        callback();
      }
    });
    Object.assign(child, {
      stdin,
      stdout,
      stderr,
      killed: false,
      pid: undefined,
      kill(signal?: string) {
        this.killed = true;
        invocation.signals.push(signal ?? "SIGTERM");
        return true;
      }
    });
    invocations.push(invocation);
    return child as unknown as ChildProcessWithoutNullStreams;
  };
}

function messages(invocation: Invocation): Array<Record<string, unknown>> {
  return invocation.stdin.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function paramsFor(invocation: Invocation, method: string): Record<string, unknown> {
  const message = messages(invocation).find((item) => item.method === method);
  assert.ok(message);
  return message.params as Record<string, unknown>;
}

test("sends Luna/MAX defaults and omits every policy option", async () => {
  const invocations: Invocation[] = [];
  const executor = new CodexExecutor(TRUSTED_CWD, fakeStarter({ output: "done" }, invocations), { PATH: "/bin" }, "linux");

  const result = await executor.execute({ taskId: TASK_ID, instruction: "inspect" });

  assert.equal(result.kind, "completed");
  assert.equal(invocations.length, 1);
  const invocation = invocations[0]!;
  assert.equal(invocation.executable, "codex");
  assert.deepEqual(invocation.args, ["app-server", "--stdio"]);
  assert.equal(invocation.options.cwd, TRUSTED_CWD);
  assert.equal(invocation.options.shell, false);
  const allMessages = messages(invocation);
  assert.equal(allMessages.some((message) => message.method === "model/list"), false);
  assert.deepEqual(allMessages[0], {
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "engineering-bridge", version: VERSION } }
  });
  assert.deepEqual(paramsFor(invocation, "thread/start"), { cwd: TRUSTED_CWD });
  assert.deepEqual(paramsFor(invocation, "turn/start"), {
    threadId: "thread-1",
    input: [{ type: "text", text: "inspect" }],
    cwd: TRUSTED_CWD,
    model: DEFAULT_CODEX_MODEL,
    effort: DEFAULT_CODEX_REASONING
  });
  const serialized = JSON.stringify(allMessages);
  for (const forbidden of ["serviceTier", "account", "webSearch", "web_research", "sandbox", "approvalPolicy", "networkAccess", "sandboxPolicy"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("forwards explicit model and reasoning overrides", async () => {
  const invocations: Invocation[] = [];
  const executor = new CodexExecutor(TRUSTED_CWD, fakeStarter({ output: "done" }, invocations), {}, "linux");

  const result = await executor.execute({
    taskId: TASK_ID,
    instruction: "inspect",
    model: "gpt-5.6-custom",
    reasoning: "high"
  });

  assert.equal(result.kind, "completed");
  const turnStart = paramsFor(invocations[0]!, "turn/start");
  assert.equal(turnStart.model, "gpt-5.6-custom");
  assert.equal(turnStart.effort, "high");
});

test("accepts a large valid JSONL frame while keeping evidence bounded", async () => {
  const invocations: Invocation[] = [];
  const executor = new CodexExecutor(TRUSTED_CWD, fakeStarter({ largeFrame: true, output: "large-frame-ok" }, invocations), {}, "linux");

  const result = await executor.execute({ taskId: TASK_ID, instruction: "read" });

  assert.equal(result.kind, "completed");
  if (result.kind === "completed") {
    assert.equal(result.output, "large-frame-ok");
    assert.equal(result.evidence?.length, 1);
    assert.equal(result.evidence?.[0]?.type, "commandExecution");
  }
});

test("interrupt is the only active control seam and does not wait on a normal-execution watchdog", async () => {
  const invocations: Invocation[] = [];
  const executor = new CodexExecutor(
    TRUSTED_CWD,
    fakeStarter({ hold: true }, invocations),
    {},
    "linux",
    { interruptGraceMs: 5, killGraceMs: 5, rpcCallTimeoutMs: 50 }
  );

  const running = executor.execute({ taskId: TASK_ID, instruction: "hold" });
  for (let attempt = 0; attempt < 100 && !invocations[0]?.stdin.includes('"method":"turn/start"'); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  await executor.interrupt();
  const result = await running;

  assert.equal(result.kind, "interrupted");
  assert.equal(invocations[0]?.stdin.includes('"method":"turn/interrupt"'), true);
  assert.equal(invocations[0]?.stdin.includes('"method":"turn/steer"'), false);
});
