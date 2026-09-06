import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  runBoundedGit,
  type GitProcessSignaler,
  type GitProcessTimers,
  type GitStarter
} from "../../../src/executors/bounded-git-process.js";

class ManualTimers implements GitProcessTimers {
  readonly pending = new Map<number, { readonly callback: () => void; readonly delayMs: number }>();
  private nextId = 1;

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.pending.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(timer: unknown): void {
    this.pending.delete(timer as number);
  }

  fireNext(): number {
    const first = this.pending.entries().next();
    assert.equal(first.done, false);
    const [id, timer] = first.value!;
    this.pending.delete(id);
    timer.callback();
    return timer.delayMs;
  }
}

function fakeChild(pid = 1234): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid,
    kill: () => true,
    ref: () => {},
    unref: () => {}
  }) as unknown as ChildProcessWithoutNullStreams;
}

test("bounded git resolves normal completion and clears its deadline", async () => {
  const timers = new ManualTimers();
  const child = fakeChild();
  const calls: Array<{ readonly signal: NodeJS.Signals; readonly allowDirectFallback: boolean | undefined }> = [];
  const signaler: GitProcessSignaler = (_child, _platform, signal, allowDirectFallback) => {
    calls.push({ signal, allowDirectFallback });
  };
  const starter: GitStarter = (executable, args, options) => {
    assert.equal(executable, "git");
    assert.deepEqual(args, ["status", "--porcelain"]);
    assert.equal(options.cwd, "/workspace");
    assert.equal(options.shell, false);
    assert.equal(options.detached, true);
    return child;
  };

  const result = runBoundedGit(
    starter,
    "/workspace",
    ["status", "--porcelain"],
    undefined,
    () => new Error("bounded"),
    {
      platform: "linux",
      timers,
      signaler,
      timing: { executionTimeoutMs: 100, killGraceMs: 10 }
    }
  );

  child.stdout.emit("data", "clean\n");
  child.emit("close", 0, null);

  assert.deepEqual(await result, { code: 0, stdout: "clean\n" });
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(calls, []);
});

test("bounded git keeps TERM to KILL grace alive after direct child exit", async () => {
  const timers = new ManualTimers();
  const child = fakeChild();
  const calls: Array<{ readonly signal: NodeJS.Signals; readonly allowDirectFallback: boolean | undefined }> = [];
  const signaler: GitProcessSignaler = (_child, _platform, signal, allowDirectFallback) => {
    calls.push({ signal, allowDirectFallback });
  };
  const starter: GitStarter = (_executable, _args, options) => {
    assert.equal(options.detached, true);
    return child;
  };

  const result = runBoundedGit(
    starter,
    "/workspace",
    ["apply", "--check"],
    undefined,
    () => new Error("bounded"),
    {
      platform: "linux",
      timers,
      signaler,
      timing: { executionTimeoutMs: 100, killGraceMs: 10 }
    }
  );

  let settled = false;
  void result.then(
    () => { settled = true; },
    () => { settled = true; }
  );

  assert.equal(timers.fireNext(), 100);
  assert.deepEqual(calls, [{ signal: "SIGTERM", allowDirectFallback: undefined }]);

  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  await Promise.resolve();

  assert.equal(settled, false);
  assert.equal(timers.pending.size, 1);

  assert.equal(timers.fireNext(), 10);
  await assert.rejects(result, /bounded/);
  assert.deepEqual(calls, [
    { signal: "SIGTERM", allowDirectFallback: undefined },
    { signal: "SIGKILL", allowDirectFallback: false }
  ]);
  assert.equal(timers.pending.size, 0);
});

test("bounded git allows direct fallback at KILL when the child has not exited", async () => {
  const timers = new ManualTimers();
  const child = fakeChild();
  const calls: Array<{ readonly signal: NodeJS.Signals; readonly allowDirectFallback: boolean | undefined }> = [];
  const signaler: GitProcessSignaler = (_child, _platform, signal, allowDirectFallback) => {
    calls.push({ signal, allowDirectFallback });
  };

  const result = runBoundedGit(
    () => child,
    "/workspace",
    ["rev-parse", "HEAD"],
    undefined,
    () => new Error("bounded"),
    {
      platform: "linux",
      timers,
      signaler,
      timing: { executionTimeoutMs: 100, killGraceMs: 10 }
    }
  );

  assert.equal(timers.fireNext(), 100);
  assert.equal(timers.fireNext(), 10);
  await assert.rejects(result, /bounded/);

  assert.deepEqual(calls, [
    { signal: "SIGTERM", allowDirectFallback: undefined },
    { signal: "SIGKILL", allowDirectFallback: true }
  ]);
  assert.equal(timers.pending.size, 0);
});

test("bounded git rejects a synchronous spawn failure without leaving timers", async () => {
  const timers = new ManualTimers();
  await assert.rejects(
    runBoundedGit(
      () => { throw new Error("spawn failed"); },
      "/workspace",
      ["status"],
      undefined,
      () => new Error("bounded"),
      { platform: "linux", timers, timing: { executionTimeoutMs: 100, killGraceMs: 10 } }
    ),
    /bounded/
  );
  assert.equal(timers.pending.size, 0);
});
