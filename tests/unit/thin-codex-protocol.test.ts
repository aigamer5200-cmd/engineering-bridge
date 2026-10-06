import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CodexAppServerTransport } from "../../src/transport/codex-app-server.js";

type Message = { id: number; method: string };
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const item = (text: string, threadId = "thread", turnId = "turn") => ({
  method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", text } }
});
const completed = (id = "turn") => ({
  method: "turn/completed", params: { threadId: "thread", turn: { id, status: "completed" } }
});

function harness(onTurn: (message: Message, stdout: PassThrough, child: EventEmitter) => void,
  overrides?: (message: Message, stdout: PassThrough, child: EventEmitter) => boolean) {
  const requests: Message[] = [];
  const signals: string[] = [];
  const transport = new CodexAppServerTransport("C:\\workspace", () => {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString()) as Message;
      if (message.id !== undefined) {
        requests.push(message);
        queueMicrotask(() => {
          if (overrides?.(message, stdout, child)) return;
          if (message.method === "initialize") stdout.write(line({ id: message.id, result: {} }));
          if (message.method === "thread/start") stdout.write(line({ id: message.id, result: { thread: { id: "thread" } } }));
          if (message.method === "turn/start") onTurn(message, stdout, child);
          if (message.method === "turn/interrupt") stdout.write(line({ id: message.id, error: { code: -1, message: "secret" } }));
        });
      }
      callback();
    } });
    Object.assign(child, { stdin, stdout, stderr, pid: undefined,
      kill(signal: string) { signals.push(signal); return true; } });
    return child as unknown as ChildProcessWithoutNullStreams;
  }, {}, "win32", { rpcCallTimeoutMs: 30, interruptGraceMs: 1, killGraceMs: 1, protocolInactivityTimeoutMs: 30 });
  return { transport, requests, signals };
}

test("coalesced response identities isolate output and stop processing at terminal event", async () => {
  const h = harness((m, out) => out.write(
    line({ id: m.id, result: { turn: { id: "turn" } } }) +
    line(item("foreign", "other")) + line(item("foreign", "thread", "other")) +
    line(item("uncorrelated", "", "")) + line(completed("other")) +
    line(item("correct")) + line(completed()) + line(item("trailing"))));
  assert.deepEqual(await h.transport.execute({ instruction: "test" }), { kind: "completed", output: "correct", threadId: "thread" });
});

test("bounded pre-response events replay against the authoritative response turn", async () => {
  const h = harness((m, out) => out.write(line(item("wrong", "thread", "other")) +
    line(item("early")) + line(completed()) + line({ id: m.id, result: { turn: { id: "turn" } } })));
  assert.deepEqual(await h.transport.execute({ instruction: "test" }), { kind: "completed", output: "early", threadId: "thread" });
});

test("pre-response aggregate bound is independent of the 16 MiB frame bound", async () => {
  const h = harness((_m, out) => out.write(line(item("x".repeat(40_000))) + line(item("x".repeat(40_000)))));
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "failed");
  assert.equal(JSON.stringify(result).includes("xxxx"), false);
});

test("split UTF-8, CRLF, unknown JSON params, unmatched string id and final EOF frame are legal", async () => {
  const h = harness((m, out) => {
    out.write(line({ id: "unknown", result: {} }) + line({ method: "future", params: [1, null] }) +
      line({ id: m.id, result: { turn: { id: "turn" } } }));
    const bytes = Buffer.from(line(item("中文🙂")).replace(/\n$/, "\r\n"));
    const split = bytes.indexOf(Buffer.from("中")) + 1;
    out.write(bytes.subarray(0, split));
    out.write(bytes.subarray(split));
    out.end(JSON.stringify(completed()));
  });
  assert.deepEqual(await h.transport.execute({ instruction: "test" }), { kind: "completed", output: "中文🙂", threadId: "thread" });
});

for (const raw of ["[]\n", "null\n", "{bad}\n", line({ id: null, result: {} }),
  line({ id: 1.5, result: {} }), line({ id: 1, result: {}, error: {} }),
  line({ id: 9, error: { code: "bad", message: "secret" } }), line({ result: {} }),
  line({ id: 9, method: "approval/secret", params: {} }),
  line({ method: "turn/completed", params: [] }),
  line({ method: "turn/completed", params: { threadId: "thread", turn: {} } }),
  line({ method: "item/completed", params: {} })]) {
  test(`malformed envelope fails closed: ${raw.trim().slice(0, 65)}`, async () => {
    const h = harness((_m, out) => out.write(raw));
    const result = await h.transport.execute({ instruction: "test" });
    assert.equal(result.kind, "failed");
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
}

for (const eof of [false, true]) test(`invalid UTF-8 fails closed (EOF=${eof})`, async () => {
  const h = harness((_m, out) => {
    out.write(Buffer.from(eof ? [0xe4] : [0xff]));
    if (eof) out.end();
  });
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "failed");
  assert.match(JSON.stringify(result), /invalid UTF-8/);
});

test("frame larger than upstream 8 MiB is retained under the fork 16 MiB bound", async () => {
  const text = "x".repeat(9 * 1024 * 1024);
  const h = harness((m, out) => out.write(line({ id: m.id, result: { turn: { id: "turn" } } }) + line(item(text)) + line(completed())));
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "completed");
  assert.equal("output" in result && result.output, text);
});

test("coalesced individually bounded frames may exceed 16 MiB in aggregate", async () => {
  const text = "x".repeat(9 * 1024 * 1024);
  const h = harness((m, out) => out.write(line({ id: m.id, result: { turn: { id: "turn" } } }) +
    line(item(text)) + line(item(text)) + line(completed())));
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "completed");
  assert.equal("output" in result && result.output, text);
});

test("fork content-array output remains supported with correlated identity", async () => {
  const h = harness((m, out) => out.write(line({ id: m.id, result: { turn: { id: "turn" } } }) +
    line({ method: "item/completed", params: { threadId: "thread", turnId: "turn",
      item: { type: "agentMessage", content: [{ text: "one" }, { text: "two" }] } } }) + line(completed())));
  assert.deepEqual(await h.transport.execute({ instruction: "test" }), { kind: "completed", output: "onetwo", threadId: "thread" });
});

test("active terminal event with invalid status fails closed", async () => {
  const h = harness((m, out) => out.write(line({ id: m.id, result: { turn: { id: "turn" } } }) +
    line({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "unknown" } } })));
  assert.equal((await h.transport.execute({ instruction: "test" })).kind, "failed");
});

test("direct exit with incomplete framing remains a failure", async () => {
  const h = harness((_m, out, child) => { out.write('{"method":'); child.emit("exit", 0); });
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "failed");
  assert.match(JSON.stringify(result), /incomplete message/);
});

for (const terminated of [true, false]) test(`oversized UTF-8 frame rejected (newline=${terminated})`, async () => {
  const h = harness((_m, out) => out.write("中".repeat(Math.ceil(16 * 1024 * 1024 / 3)) + (terminated ? "\n" : "")));
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "failed");
  assert.match(JSON.stringify(result), /oversized message/);
});

for (const method of ["initialize", "thread/start", "turn/start"]) {
  test(`${method} RPC rejection stays sanitized even with immediate close`, async () => {
    const h = harness(() => {}, (m, out, child) => {
      if (m.method !== method) return false;
      out.write(line({ id: m.id, error: { code: -1, message: "secret" } }));
      child.emit("close", 1);
      return true;
    });
    const result = await h.transport.execute({ instruction: "test" });
    assert.equal(result.kind, "failed");
    assert.match(JSON.stringify(result), /request failed/);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
  test(`${method} RPC timeout remains bounded`, async () => {
    const h = harness(() => {}, (m) => m.method === method);
    assert.equal((await h.transport.execute({ instruction: "test" })).kind, "failed");
    assert.ok(h.signals.includes("SIGKILL"));
  });
}

for (const method of ["thread/start", "turn/start"]) test(`${method} malformed response fails before notifications`, async () => {
  const h = harness(() => {}, (m, out) => {
    if (m.method !== method) return false;
    out.write(line({ id: m.id, result: { thread: { id: "" }, turn: { id: "" } } }) + line(completed()));
    return true;
  });
  assert.equal((await h.transport.execute({ instruction: "test" })).kind, "failed");
});

test("response without started notification has a bounded inactivity watchdog", async () => {
  const h = harness((m, out) => out.write(line({ id: m.id, result: { turn: { id: "turn" } } })));
  const result = await h.transport.execute({ instruction: "test" });
  assert.equal(result.kind, "failed");
  assert.match(JSON.stringify(result), /stopped responding/);
});

test("early started event permits interruption; RPC rejection preserves interrupted output", async () => {
  const h = harness((m, out) => out.write(line({ method: "turn/started", params: { threadId: "thread", turn: { id: "turn" } } }) +
    line(item("partial")) + line({ id: m.id, result: { turn: { id: "turn" } } })));
  const running = h.transport.execute({ instruction: "test" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await h.transport.interrupt();
  assert.deepEqual(await running, { kind: "interrupted", output: "partial", threadId: "thread" });
  assert.ok(h.requests.some(({ method }) => method === "turn/interrupt"));
});
