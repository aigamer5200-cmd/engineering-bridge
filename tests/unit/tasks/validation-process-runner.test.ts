import assert from "node:assert/strict";
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio
} from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  ValidationProcessRunner,
  type ValidationProcessOutcome,
  type ValidationProcessRequest,
  type ValidationProcessStarter,
  type ValidationTimer
} from "../../../src/tasks/validation-process-runner.js";

class ManualTimer implements ValidationTimer {
  currentMs = 0;
  clearCount = 0;
  readonly pending = new Map<
    NodeJS.Timeout,
    { readonly callback: () => void; readonly delayMs: number }
  >();
  private nextId = 1;

  now(): number {
    return this.currentMs;
  }

  set(callback: () => void, delayMs: number): NodeJS.Timeout {
    const handle = this.nextId++ as unknown as NodeJS.Timeout;
    this.pending.set(handle, { callback, delayMs });
    return handle;
  }

  clear(handle: NodeJS.Timeout): void {
    this.clearCount++;
    this.pending.delete(handle);
  }

  fireNext(): number {
    const first = this.pending.entries().next();
    assert.equal(first.done, false);
    const [handle, timer] = first.value!;
    this.pending.delete(handle);
    timer.callback();
    return timer.delayMs;
  }

  fireAll(): number {
    let fired = 0;
    while (this.pending.size > 0) {
      this.fireNext();
      fired++;
    }
    return fired;
  }
}

interface FakeChild {
  readonly process: ChildProcessWithoutNullStreams;
  readonly stdinText: () => string;
  readonly killSignals: Array<NodeJS.Signals | number | undefined>;
  writeStdout(chunk: string | Buffer): void;
  writeStderr(chunk: string | Buffer): void;
  close(code: number | null, signal?: NodeJS.Signals | null): void;
  error(): void;
}

function fakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const inputChunks: Buffer[] = [];
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];

  stdin.on("data", (chunk: Buffer | string) => {
    inputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const process = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: 1234,
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      return true;
    }
  }) as unknown as ChildProcessWithoutNullStreams;

  return {
    process,
    stdinText: () => Buffer.concat(inputChunks).toString("utf8"),
    killSignals,
    writeStdout: (chunk) => stdout.write(chunk),
    writeStderr: (chunk) => stderr.write(chunk),
    close(code, signal = null) {
      stdout.end();
      stderr.end();
      process.emit("close", code, signal);
    },
    error() {
      process.emit("error", new Error("spawn failed"));
    }
  };
}

interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: SpawnOptionsWithoutStdio;
}

function starterFor(child: FakeChild, invocations: Invocation[]): ValidationProcessStarter {
  return (executable, args, options) => {
    invocations.push({ executable, args: [...args], options });
    return child.process;
  };
}

function request(argv: readonly [string, ...string[]]): ValidationProcessRequest {
  return {
    argv,
    cwd: "/trusted/workspace",
    timeoutMs: 500
  };
}

test("passes executable, arguments, cwd, and no-shell pipe options exactly", async () => {
  const child = fakeChild();
  const invocations: Invocation[] = [];
  const runner = new ValidationProcessRunner(
    starterFor(child, invocations),
    new ManualTimer()
  );

  const result = runner.run(request(["npm", "test", "--", "focused"]));
  child.close(0);
  await result;

  assert.deepEqual(invocations, [{
    executable: "npm",
    args: ["test", "--", "focused"],
    options: {
      cwd: "/trusted/workspace",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    }
  }]);
});

test("preserves a shell metacharacter argument as one literal argument", async () => {
  const child = fakeChild();
  const invocations: Invocation[] = [];
  const runner = new ValidationProcessRunner(
    starterFor(child, invocations),
    new ManualTimer()
  );

  const result = runner.run(request(["tool", "safe", "; rm -rf /", "after"]));
  child.close(0);
  await result;

  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0]?.args, ["safe", "; rm -rf /", "after"]);
});

test("forwards optional stdin input and ends stdin", async () => {
  const child = fakeChild();
  const runner = new ValidationProcessRunner(
    starterFor(child, []),
    new ManualTimer()
  );

  const result = runner.run({
    ...request(["validator"]),
    input: "candidate patch\n"
  });

  assert.equal(child.stdinText(), "candidate patch\n");
  assert.equal(child.process.stdin.writableEnded, true);

  child.close(0);
  await result;
});

test("preserves zero and nonzero numeric exit codes", async () => {
  const cases: ReadonlyArray<{
    readonly exitCode: number;
    readonly expected: ValidationProcessOutcome;
  }> = [
    {
      exitCode: 0,
      expected: { kind: "exit", exitCode: 0, durationMs: 0, outputTail: "" }
    },
    {
      exitCode: 23,
      expected: { kind: "exit", exitCode: 23, durationMs: 0, outputTail: "" }
    }
  ];

  for (const item of cases) {
    const child = fakeChild();
    const runner = new ValidationProcessRunner(
      starterFor(child, []),
      new ManualTimer()
    );

    const result = runner.run(request(["validator"]));
    child.close(item.exitCode);

    assert.deepEqual(await result, item.expected);
  }
});

test("retains only the byte-bounded tail of combined stdout and stderr", async () => {
  const child = fakeChild();
  const runner = new ValidationProcessRunner(
    starterFor(child, []),
    new ManualTimer()
  );

  const result = runner.run(request(["validator"]));
  child.writeStdout("a".repeat(40_000));
  child.writeStderr("b".repeat(40_000));
  child.close(0);

  const outcome = await result;
  assert.equal(outcome.kind, "exit");
  assert.equal(Buffer.byteLength(outcome.outputTail), 65_536);
  assert.equal(outcome.outputTail, `${"a".repeat(25_536)}${"b".repeat(40_000)}`);
});

test("drops an incomplete trailing UTF-8 sequence without expanding the byte-bounded tail", async () => {
  const child = fakeChild();
  const runner = new ValidationProcessRunner(
    starterFor(child, []),
    new ManualTimer()
  );

  const result = runner.run(request(["validator"]));
  child.writeStdout(Buffer.concat([
    Buffer.alloc(65_535, 0x61),
    Buffer.from([0xe2])
  ]));
  child.close(0);

  const outcome = await result;
  assert.equal(outcome.kind, "exit");
  assert.ok(Buffer.byteLength(outcome.outputTail) <= 65_536);
  assert.equal(outcome.outputTail.endsWith("\ufffd"), false);
});

test("does not return timeout until the killed child closes", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  timers.currentMs = 100;
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  const result = runner.run({
    ...request(["validator"]),
    timeoutMs: 200
  });
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  child.writeStdout("before timeout");
  timers.currentMs = 350;

  assert.equal(timers.fireNext(), 200);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(child.killSignals.length, 1);

  child.close(null, "SIGTERM");
  assert.deepEqual(await result, {
    kind: "timeout",
    durationMs: 250,
    outputTail: "before timeout"
  });
});

test("does not let a child error after timeout settle the run before close", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  timers.currentMs = 100;
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  const result = runner.run({
    ...request(["validator"]),
    timeoutMs: 200
  });
  let settled = false;
  void result.then(() => {
    settled = true;
  });

  timers.currentMs = 350;
  assert.equal(timers.fireNext(), 200);
  child.error();

  await Promise.resolve();
  assert.equal(settled, false);

  child.close(null);
  assert.deepEqual(await result, {
    kind: "timeout",
    durationMs: 250,
    outputTail: ""
  });
});

test("returns timeout when kill synchronously closes the child", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  timers.currentMs = 100;
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  child.process.kill = (
    signal?: NodeJS.Signals | number
  ): boolean => {
    child.killSignals.push(signal);
    child.close(null, "SIGTERM");
    return true;
  };

  const result = runner.run({
    ...request(["validator"]),
    timeoutMs: 200
  });
  child.writeStdout("before timeout");
  timers.currentMs = 350;

  assert.equal(timers.fireNext(), 200);
  assert.deepEqual(await result, {
    kind: "timeout",
    durationMs: 250,
    outputTail: "before timeout"
  });
  child.error();
  child.close(0);
  assert.equal(timers.clearCount, 1);
});

test("does not return timeout until the child closes when kill throws", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  timers.currentMs = 10;
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  child.process.kill = (
    signal?: NodeJS.Signals | number
  ): boolean => {
    child.killSignals.push(signal);
    throw new Error("kill failed");
  };

  const result = runner.run({
    ...request(["validator"]),
    timeoutMs: 50
  });
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  child.writeStderr("before failed kill");
  timers.currentMs = 60;

  assert.doesNotThrow(() => timers.fireNext());
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(child.killSignals.length, 1);

  child.close(null, "SIGTERM");
  assert.deepEqual(await result, {
    kind: "timeout",
    durationMs: 50,
    outputTail: "before failed kill"
  });
});

for (const killBehavior of [
  { name: "throws", throws: true },
  { name: "reports signal delivery", throws: false }
] as const) {
  test(
    `bounds timeout termination when kill ${killBehavior.name} but the child never closes`,
    async () => {
      const child = fakeChild();
      const timers = new ManualTimer();
      timers.currentMs = 10;
      const runner = new ValidationProcessRunner(starterFor(child, []), timers);

      child.process.kill = (
        signal?: NodeJS.Signals | number
      ): boolean => {
        child.killSignals.push(signal);
        if (killBehavior.throws) {
          throw new Error("kill failed");
        }
        return true;
      };

      const result = runner.run({
        ...request(["validator"]),
        timeoutMs: 50
      });
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      child.writeStderr("before stalled termination");
      timers.currentMs = 60;

      assert.doesNotThrow(() => timers.fireNext());
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(child.killSignals.length, 1);
      assert.equal(timers.pending.size, 1);

      timers.currentMs = 1_060;
      timers.fireNext();
      assert.deepEqual(await result, {
        kind: "termination_error",
        durationMs: 1_050,
        outputTail: "before stalled termination"
      });
    }
  );
}

test("returns spawn_error when the child errors before close", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  timers.currentMs = 20;
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  const result = runner.run(request(["validator"]));
  timers.currentMs = 27;
  child.error();

  assert.deepEqual(await result, {
    kind: "spawn_error",
    durationMs: 7,
    outputTail: ""
  });
  child.close(0);
});

test("returns signal when close has no numeric exit code", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  timers.currentMs = 40;
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  const result = runner.run(request(["validator"]));
  timers.currentMs = 52;
  child.close(null, "SIGTERM");

  assert.deepEqual(await result, {
    kind: "signal",
    durationMs: 12,
    outputTail: ""
  });
});

test("clears the timeout after normal exit so it cannot fire later", async () => {
  const child = fakeChild();
  const timers = new ManualTimer();
  const runner = new ValidationProcessRunner(starterFor(child, []), timers);

  const result = runner.run(request(["validator"]));
  assert.equal(timers.pending.size, 1);

  child.close(0);
  assert.deepEqual(await result, {
    kind: "exit",
    exitCode: 0,
    durationMs: 0,
    outputTail: ""
  });
  assert.equal(timers.clearCount, 1);
  assert.equal(timers.pending.size, 0);
  assert.equal(timers.fireAll(), 0);
  assert.deepEqual(child.killSignals, []);
});
