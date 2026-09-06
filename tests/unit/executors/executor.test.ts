import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { signalExecution } from "../../../src/executors/executor.js";
import type { WindowsTaskkill } from "../../../src/executors/executor.js";

function fakeChild(pid: number | undefined, kill: () => boolean): ChildProcessWithoutNullStreams {
  return { pid, kill } as unknown as ChildProcessWithoutNullStreams;
}

test("Windows taskkill terminates the live process tree", () => {
  const calls: Array<{
    file: string;
    args: readonly string[];
    options: unknown;
  }> = [];
  let killCalls = 0;
  const taskkill: WindowsTaskkill = (file, args, options) => {
    calls.push({ file, args, options });
  };

  assert.equal(
    signalExecution(fakeChild(1234, () => {
      killCalls += 1;
      return true;
    }), "win32", "SIGTERM", true, taskkill),
    true
  );
  assert.deepEqual(calls, [{
    file: "taskkill",
    args: ["/PID", "1234", "/T", "/F"],
    options: {
      shell: false,
      stdio: "ignore",
      timeout: 1000,
      windowsHide: true
    }
  }]);
  assert.equal(killCalls, 0);
});

test("Windows taskkill failure falls back to child.kill exactly once", () => {
  let taskkillCalls = 0;
  let killCalls = 0;
  const taskkill: WindowsTaskkill = () => {
    taskkillCalls += 1;
    throw new Error("taskkill failed");
  };

  assert.equal(
    signalExecution(fakeChild(1234, () => {
      killCalls += 1;
      return true;
    }), "win32", "SIGKILL", true, taskkill),
    true
  );
  assert.equal(taskkillCalls, 1);
  assert.equal(killCalls, 1);
});

test("Windows invalid pid skips taskkill and falls back to child.kill once", () => {
  let taskkillCalls = 0;
  let killCalls = 0;
  const taskkill: WindowsTaskkill = () => {
    taskkillCalls += 1;
  };

  assert.equal(
    signalExecution(fakeChild(undefined, () => {
      killCalls += 1;
      return true;
    }), "win32", "SIGTERM", true, taskkill),
    true
  );
  assert.equal(taskkillCalls, 0);
  assert.equal(killCalls, 1);
});

test("Windows direct-child-already-exited skips taskkill and child.kill", () => {
  let taskkillCalls = 0;
  let killCalls = 0;
  const taskkill: WindowsTaskkill = () => {
    taskkillCalls += 1;
  };

  assert.equal(
    signalExecution(fakeChild(1234, () => {
      killCalls += 1;
      return true;
    }), "win32", "SIGTERM", false, taskkill),
    false
  );
  assert.equal(taskkillCalls, 0);
  assert.equal(killCalls, 0);
});
