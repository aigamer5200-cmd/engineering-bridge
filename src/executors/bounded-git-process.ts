import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import { signalExecution } from "./executor.js";

export type GitStarter = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export interface GitProcessTiming {
  readonly executionTimeoutMs: number;
  readonly killGraceMs: number;
}

export interface GitProcessTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export type GitProcessSignaler = (
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform,
  signal: NodeJS.Signals,
  directChildAlive?: boolean
) => void;

export interface GitProcessOptions {
  readonly timing?: GitProcessTiming;
  readonly timers?: GitProcessTimers;
  readonly platform?: NodeJS.Platform;
  readonly signaler?: GitProcessSignaler;
}

export interface GitProcessResult {
  readonly code: number;
  readonly stdout: string;
}

const DEFAULT_GIT_PROCESS_TIMING: GitProcessTiming = {
  executionTimeoutMs: 60_000,
  killGraceMs: 2_000
};

const SYSTEM_TIMERS: GitProcessTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer as NodeJS.Timeout);
  }
};

export function runBoundedGit(
  startProcess: GitStarter,
  cwd: string,
  args: readonly string[],
  input: string | undefined,
  failure: () => Error,
  options: GitProcessOptions = {}
): Promise<GitProcessResult> {
  const timing = options.timing ?? DEFAULT_GIT_PROCESS_TIMING;
  const timers = options.timers ?? SYSTEM_TIMERS;
  const platform = options.platform ?? process.platform;
  const signaler = options.signaler ?? signalExecution;

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      const spawnOptions: SpawnOptionsWithoutStdio = {
        cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      };
      if (platform !== "win32") spawnOptions.detached = true;
      child = startProcess("git", args, spawnOptions);
    } catch {
      reject(failure());
      return;
    }

    let stdout = "";
    let settled = false;
    let timedOut = false;
    let exited = false;
    let deadlineTimer: unknown;
    let graceTimer: unknown;

    const ignoreError = (): void => {};

    function clearTimers(): void {
      if (deadlineTimer !== undefined) {
        timers.clearTimeout(deadlineTimer);
        deadlineTimer = undefined;
      }
      if (graceTimer !== undefined) {
        timers.clearTimeout(graceTimer);
        graceTimer = undefined;
      }
    }

    function cleanup(): void {
      clearTimers();
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout.removeListener("data", onData);
      child.stdin.removeListener("error", onError);
      child.stdout.removeListener("error", onError);
      child.stderr.removeListener("error", onError);
      child.on("error", ignoreError);
      child.stdin.on("error", ignoreError);
      child.stdout.on("error", ignoreError);
      child.stderr.on("error", ignoreError);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (timedOut) {
        try { child.unref(); } catch { /* best effort after bounded kill */ }
      }
    }

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    }

    function fail(): void {
      settle(() => reject(failure()));
    }

    function onData(chunk: string): void {
      stdout += chunk;
    }

    function onExit(): void {
      exited = true;
    }

    function onClose(code: number | null): void {
      exited = true;
      if (timedOut) return;
      settle(() => resolve({ code: code ?? -1, stdout }));
    }

    function onError(): void {
      if (!timedOut) fail();
    }

    function onDeadline(): void {
      deadlineTimer = undefined;
      if (settled) return;
      timedOut = true;
      signaler(child, platform, "SIGTERM");
      graceTimer = timers.setTimeout(() => {
        graceTimer = undefined;
        if (settled) return;
        signaler(child, platform, "SIGKILL", !exited);
        fail();
      }, timing.killGraceMs);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
    child.on("error", onError);
    child.on("exit", onExit);
    child.on("close", onClose);
    child.stdin.on("error", onError);
    child.stdout.on("error", onError);
    child.stderr.on("error", onError);
    child.stderr.resume();
    deadlineTimer = timers.setTimeout(onDeadline, timing.executionTimeoutMs);
    try {
      child.stdin.end(input);
    } catch {
      onError();
    }
  });
}
