// Opt-in candidate Canary. Real elapsed time, simulated Codex protocol, no
// credentials, network, provider calls or filesystem writes.
// Usage after npm run build:
//   node tests/canary/codex-quiet-real-clock.mjs
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { CodexAppServerTransport } from "../../dist/src/transport/codex-app-server.js";

const SILENT_MS = 125_000;
const HEALTH_CHECK_MS = 50_000;
const THREAD_ID = "canary-thread";
const TURN_ID = "canary-turn";
const signals = [];

function fakeCodex() {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const send = (object) => stdout.write(JSON.stringify(object) + "\n");
  const stdin = new Writable({
    write(chunk, _encoding, done) {
      const message = JSON.parse(chunk.toString());
      if (message.method === "initialize") send({ id: message.id, result: {} });
      if (message.method === "thread/start") {
        send({ id: message.id, result: { thread: { id: THREAD_ID } } });
      }
      if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: TURN_ID } } });
        send({ method: "turn/started", params: {
          threadId: THREAD_ID, turn: { id: TURN_ID }
        } });
        setTimeout(() => {
          send({ method: "item/completed", params: {
            threadId: THREAD_ID, turnId: TURN_ID,
            item: { type: "agentMessage", text: "LONG_QUIET_CANARY_OK" }
          } });
          send({ method: "turn/completed", params: {
            threadId: THREAD_ID, turn: { id: TURN_ID, status: "completed" }
          } });
        }, SILENT_MS);
      }
      done();
    }
  });
  Object.assign(child, {
    stdin, stdout, stderr, pid: undefined,
    kill(signal) { signals.push(signal); return true; }
  });
  return child;
}

const transport = new CodexAppServerTransport(
  process.cwd(),
  fakeCodex,
  {},
  "win32",
  {
    rpcCallTimeoutMs: 5_000,
    interruptGraceMs: 100,
    killGraceMs: 100,
    healthCheckIntervalMs: HEALTH_CHECK_MS
  }
);
const began = Date.now();
const execution = transport.execute({ instruction: "canary-simulation-no-tools" });
await new Promise((resolve) => setTimeout(resolve, 122_000));
const beforeCompletion = transport.healthSnapshot();
assert.equal(beforeCompletion?.state, "running");
assert.equal(beforeCompletion?.observation, "quiet_unconfirmed");
assert.ok((beforeCompletion?.checks ?? 0) >= 2);
assert.ok((beforeCompletion?.quiet_for_ms ?? 0) > 120_000);
assert.equal(signals.length, 0);
const result = await execution;
assert.equal(result.kind, "completed");
assert.equal(result.output, "LONG_QUIET_CANARY_OK");
assert.ok(Date.now() - began >= 125_000);
console.log(JSON.stringify({
  status: "PASS",
  real_elapsed_ms: Date.now() - began,
  health_checks_before_completion: beforeCompletion.checks,
  quiet_ms_before_completion: beforeCompletion.quiet_for_ms,
  output: result.output,
  kind: result.kind,
  network_calls: 0,
  provider_calls: 0
}));
