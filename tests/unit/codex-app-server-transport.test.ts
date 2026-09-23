import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import { CodexAppServerTransport } from "../../src/transport/codex-app-server.js";
import type { ProcessStarter } from "../../src/transport/codex-app-server.js";
import { VERSION } from "../../src/version.js";

const WORKSPACE = "C:\\workspace";

interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: SpawnOptionsWithoutStdio;
  stdin: string;
  readonly signals: string[];
}

function fakeStarter(invocations: Invocation[], output = "transport-ok", hold = false): ProcessStarter {
  return (executable, args, options) => {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const invocation: Invocation = { executable, args: [...args], options, stdin: "", signals: [] };
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
              send({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
              send({ method: "item/completed", params: { item: { type: "agentMessage", text: output } } });
              if (hold) return;
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
      kill(signal?: string) { invocation.signals.push(signal ?? "SIGTERM"); this.killed = true; return true; }
    });
    invocations.push(invocation);
    return child as unknown as ChildProcessWithoutNullStreams;
  };
}

function messages(invocation: Invocation): Array<Record<string, unknown>> {
  return invocation.stdin.trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("sends only workspace and input fields to the official app-server", async () => {
  const invocations: Invocation[] = [];
  const inheritedEnvironment = {
    PATH: "C:\\bin",
    USERPROFILE: "C:\\Users\\tester",
    CODEX_HOME: "C:\\Users\\tester\\.codex",
    BRIDGE_TEST_UNLISTED: "preserve exactly: spaces & punctuation!"
  };
  const transport = new CodexAppServerTransport(
    WORKSPACE,
    fakeStarter(invocations),
    inheritedEnvironment,
    "win32"
  );

  const result = await transport.execute({ instruction: "inspect" });

  assert.deepEqual(result, { kind: "completed", output: "transport-ok", threadId: "thread-1" });
  assert.equal(invocations.length, 1);
  const invocation = invocations[0]!;
  assert.equal(invocation.args.at(-2), "app-server");
  assert.equal(invocation.args.at(-1), "--stdio");
  assert.equal(invocation.executable, "codex");
  assert.equal(invocation.options.cwd, WORKSPACE);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.env, inheritedEnvironment);

  const allMessages = messages(invocation);
  assert.equal(allMessages.some((message) => message.method === "model/list"), false);
  assert.deepEqual(allMessages.find((message) => message.method === "initialize"), {
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "engineering-bridge", version: VERSION } }
  });
  assert.deepEqual(allMessages.find((message) => message.method === "thread/start")?.params, { cwd: WORKSPACE });
  assert.deepEqual(allMessages.find((message) => message.method === "turn/start")?.params, {
    threadId: "thread-1",
    input: [{ type: "text", text: "inspect" }],
    cwd: WORKSPACE
  });

  const serialized = JSON.stringify(allMessages);
  for (const forbidden of [
    "model", "effort", "serviceTier", "sandbox", "approvalPolicy", "sandboxPolicy",
    "networkAccess", "webSearch", "account", "profile"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("returns agent output longer than the former 65K limit intact", async () => {
  const invocations: Invocation[] = [];
  const output = "0123456789abcdef".repeat(5_000);
  const transport = new CodexAppServerTransport(
    WORKSPACE,
    fakeStarter(invocations, output),
    { PATH: "/bin" },
    "linux"
  );

  const result = await transport.execute({ instruction: "write a long result" });

  assert.deepEqual(result, { kind: "completed", output, threadId: "thread-1" });
  assert.equal(output.length, 80_000);
});

test("returns partial agent output longer than the former 65K limit intact", async () => {
  const invocations: Invocation[] = [];
  const output = "partial output ".repeat(6_000);
  const transport = new CodexAppServerTransport(
    WORKSPACE,
    fakeStarter(invocations, output, true),
    { PATH: "/bin" },
    "linux",
    { interruptGraceMs: 1, killGraceMs: 1, rpcCallTimeoutMs: 50 }
  );

  const running = transport.execute({ instruction: "write a long partial result" });
  for (let attempt = 0; attempt < 100 && !invocations[0]?.stdin.includes('"method":"turn/start"'); attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await transport.interrupt();
  const result = await running;

  assert.deepEqual(result, { kind: "interrupted", output, threadId: "thread-1" });
  assert.ok(output.length > 65_536);
});

test("interrupt sends the native turn interrupt and bounds child cleanup", async () => {
  const invocations: Invocation[] = [];
  const transport = new CodexAppServerTransport(
    WORKSPACE,
    fakeStarter(invocations, "", true),
    { PATH: "/bin" },
    "linux",
    { interruptGraceMs: 1, killGraceMs: 1, rpcCallTimeoutMs: 50 }
  );

  const running = transport.execute({ instruction: "hold" });
  for (let attempt = 0; attempt < 100 && !invocations[0]?.stdin.includes('"method":"turn/start"'); attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await transport.interrupt();
  const result = await running;

  assert.deepEqual(result, { kind: "interrupted", output: "", threadId: "thread-1" });
  const invocation = invocations[0]!;
  const interrupt = messages(invocation).find((message) => message.method === "turn/interrupt");
  assert.deepEqual(interrupt?.params, { threadId: "thread-1", turnId: "turn-1" });
  assert.equal(messages(invocation).some((message) => message.method === "turn/steer"), false);
  assert.ok(invocation.signals.includes("SIGTERM"));
  assert.ok(invocation.signals.includes("SIGKILL"));
});
