import { execFileSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import { resolveCommand } from "../executors/command-resolution.js";
import { VERSION } from "../version.js";

export type CodexTaskResult =
  | { readonly kind: "completed"; readonly output: string; readonly threadId?: string }
  | { readonly kind: "interrupted"; readonly output: string; readonly threadId?: string }
  | { readonly kind: "failed"; readonly error: string; readonly output?: string; readonly threadId?: string };

export interface CodexTaskExecutor {
  execute(request: { readonly instruction: string }): Promise<CodexTaskResult>;
  interrupt(): Promise<void>;
}

export type ProcessStarter = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export interface TransportTiming {
  readonly interruptGraceMs: number;
  readonly killGraceMs: number;
  readonly rpcCallTimeoutMs: number;
}

const CODEX_NODE_TARGET = ["@openai", "codex", "bin", "codex.js"] as const;
const MAX_JSONL_FRAME_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMING: TransportTiming = {
  interruptGraceMs: 5_000,
  killGraceMs: 2_000,
  rpcCallTimeoutMs: 30_000
};

type PendingCall = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
  readonly timer: NodeJS.Timeout;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") return item.text;
  if (!Array.isArray(item.content)) return undefined;
  const parts = item.content
    .filter(object)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts.join("");
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform,
  signal: NodeJS.Signals,
  childAlive = true
): boolean {
  if (platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Fall through to the direct child signal.
    }
  }
  if (!childAlive) return false;
  if (platform === "win32" && child.pid !== undefined && Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        timeout: 1_000,
        windowsHide: true
      });
      return true;
    } catch {
      // Fall through to the direct child signal.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

export class CodexAppServerTransport implements CodexTaskExecutor {
  private child: ChildProcessWithoutNullStreams | undefined;
  private threadId: string | undefined;
  private turnId: string | undefined;
  private startedTurnId: string | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private beginInterrupt: (() => void) | undefined;

  constructor(
    private readonly workspaceRoot: string,
    private readonly startProcess: ProcessStarter = spawn,
    private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly timing: TransportTiming = DEFAULT_TIMING
  ) {}

  async execute(request: { readonly instruction: string }): Promise<CodexTaskResult> {
    if (this.child !== undefined) return { kind: "failed", error: "Codex task is already running." };
    this.threadId = undefined;
    this.turnId = undefined;
    this.startedTurnId = undefined;

    let child: ChildProcessWithoutNullStreams;
    try {
      const options: SpawnOptionsWithoutStdio = {
        cwd: this.workspaceRoot,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        detached: this.platform !== "win32",
        env: { ...this.hostEnvironment },
        windowsHide: true
      };
      const resolved = resolveCommand(this.hostEnvironment, "codex", {
        nodeTarget: CODEX_NODE_TARGET,
        preferGlobalNodeShim: true,
        platform: this.platform
      });
      if (resolved.kind === "direct") {
        child = this.startProcess(resolved.executable, ["app-server", "--stdio"], options);
      } else if (resolved.kind === "node-launcher") {
        child = this.startProcess(process.execPath, [resolved.scriptPath, "app-server", "--stdio"], options);
      } else {
        child = this.startProcess("codex", ["app-server", "--stdio"], options);
      }
      this.child = child;
    } catch {
      return { kind: "failed", error: "Codex app-server could not be started." };
    }

    let output = "";
    let buffer = "";
    let terminal: ((result: CodexTaskResult) => void) | undefined;
    const terminalPromise = new Promise<CodexTaskResult>((resolve) => { terminal = resolve; });
    let settled = false;
    let directExited = false;
    let killSignalled = false;
    let terminationResult: CodexTaskResult | undefined;
    let interruptTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let exitImmediate: NodeJS.Immediate | undefined;

    const rejectPending = (): void => {
      for (const [id, waiter] of this.pending) {
        this.pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Codex app-server request ended."));
      }
    };

    const finish = (result: CodexTaskResult): void => {
      if (settled) return;
      const finalResult = terminationResult ?? result;
      settled = true;
      if (interruptTimer !== undefined) clearTimeout(interruptTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (exitImmediate !== undefined) clearImmediate(exitImmediate);
      rejectPending();
      if (this.child === child) {
        this.child = undefined;
        this.turnId = undefined;
        this.startedTurnId = undefined;
        this.beginInterrupt = undefined;
      }
      if (!killSignalled) {
        signalProcessTree(child, this.platform, "SIGTERM", !directExited);
        signalProcessTree(child, this.platform, "SIGKILL", !directExited);
        killSignalled = true;
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      terminal?.(finalResult);
    };

    const fail = (message: string): void => {
      finish({
        kind: "failed",
        error: message,
        ...(output === "" ? {} : { output }),
        ...(this.threadId === undefined ? {} : { threadId: this.threadId })
      });
    };

    const forceKill = (): void => {
      signalProcessTree(child, this.platform, "SIGKILL", !directExited);
      killSignalled = true;
      finish(terminationResult ?? { kind: "failed", error: "Codex app-server did not stop." });
    };

    const sendTerm = (): void => {
      if (settled) return;
      signalProcessTree(child, this.platform, "SIGTERM", !directExited);
      killTimer = setTimeout(forceKill, this.timing.killGraceMs);
    };

    const beginTermination = (result: CodexTaskResult, cooperativeMs: number): void => {
      if (settled || terminationResult !== undefined) return;
      terminationResult = result;
      if (cooperativeMs === 0) sendTerm();
      else interruptTimer = setTimeout(sendTerm, cooperativeMs);
    };

    this.beginInterrupt = (): void => {
      if (settled || terminationResult !== undefined) return;
      const result: CodexTaskResult = {
        kind: "interrupted",
        output,
        ...(this.threadId === undefined ? {} : { threadId: this.threadId })
      };
      if (this.threadId !== undefined && this.startedTurnId !== undefined) {
        void this.call("turn/interrupt", { threadId: this.threadId, turnId: this.startedTurnId }).catch((): void => {});
        beginTermination(result, this.timing.interruptGraceMs);
      } else {
        beginTermination(result, 0);
      }
    };

    child.on("error", () => fail("Codex app-server could not be started."));
    child.stdin.on("error", () => fail("Codex app-server communication failed."));
    child.stdout.on("error", () => fail("Codex app-server communication failed."));
    child.stderr.on("error", () => fail("Codex app-server communication failed."));
    child.stderr.on("data", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(rawLine, "utf8") > MAX_JSONL_FRAME_BYTES) {
          fail("Codex app-server returned an oversized message.");
          return;
        }
        const line = rawLine.trim();
        if (line === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          fail("Codex app-server returned an invalid message.");
          return;
        }
        if (!object(parsed)) {
          fail("Codex app-server returned an invalid message.");
          return;
        }

        if (typeof parsed.id === "number" && ("result" in parsed || "error" in parsed)) {
          const waiter = this.pending.get(parsed.id);
          if (waiter !== undefined) {
            this.pending.delete(parsed.id);
            clearTimeout(waiter.timer);
            if ("error" in parsed) waiter.reject(new Error("Codex app-server request failed."));
            else waiter.resolve(parsed.result);
          }
          continue;
        }

        if (typeof parsed.method !== "string") continue;
        const params = object(parsed.params) ? parsed.params : {};
        if (parsed.method === "turn/started") {
          const turn = object(params.turn) ? params.turn : params;
          if (params.threadId === this.threadId && typeof turn.id === "string" &&
              (this.turnId === undefined || turn.id === this.turnId)) {
            this.startedTurnId = turn.id;
          }
          continue;
        }

        const item = object(params.item) ? params.item : undefined;
        if (parsed.method === "item/completed" && item?.type === "agentMessage") {
          const text = messageText(item);
          if (text !== undefined) {
            output = text;
            if (terminationResult?.kind === "interrupted") {
              terminationResult = {
                ...terminationResult,
                output,
                ...(this.threadId === undefined ? {} : { threadId: this.threadId })
              };
            }
          }
          continue;
        }

        if (parsed.method === "turn/completed") {
          const turn = object(params.turn) ? params.turn : params;
          const expectedTurnId = this.startedTurnId ?? this.turnId;
          if (params.threadId !== this.threadId || typeof turn.id !== "string" ||
              expectedTurnId === undefined || turn.id !== expectedTurnId) continue;
          if (turn.status === "completed") {
            finish({
              kind: "completed",
              output,
              ...(this.threadId === undefined ? {} : { threadId: this.threadId })
            });
          } else if (turn.status === "interrupted") {
            finish({
              kind: "interrupted",
              output,
              ...(this.threadId === undefined ? {} : { threadId: this.threadId })
            });
          } else if (turn.status === "failed") {
            fail("Codex task failed.");
          } else {
            fail("Codex app-server returned an invalid task state.");
          }
        }
      }
      if (Buffer.byteLength(buffer, "utf8") > MAX_JSONL_FRAME_BYTES) {
        fail("Codex app-server returned an oversized message.");
      }
    });

    const finishFromExit = (code: number | null): void => {
      if (settled) return;
      directExited = true;
      rejectPending();
      if (buffer.trim() !== "") {
        fail("Codex app-server returned an incomplete message.");
        return;
      }
      if (terminationResult !== undefined) {
        finish(terminationResult);
        return;
      }
      fail(code === 0 ? "Codex app-server exited before the task completed." : "Codex app-server exited unexpectedly.");
    };

    child.on("exit", (code) => {
      directExited = true;
      exitImmediate = setImmediate(() => {
        exitImmediate = undefined;
        finishFromExit(code);
      });
    });
    child.on("close", finishFromExit);

    try {
      await this.call("initialize", { clientInfo: { name: "engineering-bridge", version: VERSION } });
      this.notify("initialized", {});
      const threadResult = await this.call("thread/start", { cwd: this.workspaceRoot });
      if (!object(threadResult) || !object(threadResult.thread) || typeof threadResult.thread.id !== "string") {
        throw new Error("Invalid thread response.");
      }
      this.threadId = threadResult.thread.id;
      const turnResult = await this.call("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text: request.instruction }],
        cwd: this.workspaceRoot
      });
      if (!object(turnResult) || !object(turnResult.turn) || typeof turnResult.turn.id !== "string") {
        throw new Error("Invalid task response.");
      }
      this.turnId = turnResult.turn.id;
      if (this.startedTurnId !== this.turnId) this.startedTurnId = undefined;
    } catch {
      if (!settled) fail("Codex app-server request failed.");
    }
    return terminalPromise;
  }

  async interrupt(): Promise<void> {
    if (this.child === undefined || this.beginInterrupt === undefined) {
      throw new Error("Codex task is not running.");
    }
    this.beginInterrupt();
  }

  private call(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (child === undefined || child.stdin.destroyed) {
        reject(new Error("Codex app-server is unavailable."));
        return;
      }
      const timer = setTimeout(() => {
        const waiter = this.pending.get(id);
        if (waiter === undefined) return;
        this.pending.delete(id);
        waiter.reject(new Error("Codex app-server request timed out."));
      }, this.timing.rpcCallTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch {
        const waiter = this.pending.get(id);
        if (waiter === undefined) return;
        this.pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Codex app-server request failed."));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    try {
      this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
    } catch {
      // The pending request or child stream event will report the transport failure.
    }
  }
}
