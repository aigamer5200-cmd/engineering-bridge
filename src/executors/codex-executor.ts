import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { CoreError, serializeError } from "../core/errors.js";
import { VERSION } from "../version.js";
import { resolveCommand } from "./command-resolution.js";
import { resolveCodexAccountLaunch } from "./codex-account-router.js";
import {
  DEFAULT_EXECUTOR_TIMING,
  signalExecution,
  signalProcessGroup,
  type Executor,
  type ExecutorEvidence,
  type ExecutorRequest,
  type ExecutorResult,
  type ExecutorTiming
} from "./executor.js";

export type ProcessStarter = (executable: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
const ENVIRONMENT_ALLOWLIST = ["PATH", "HOME", "CODEX_HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME"] as const;
const MAX_EVIDENCE = 50;
const MAX_TEXT = 16_384;
const MAX_EVIDENCE_BYTES = 65_536;
// Codex app-server commandExecution items legitimately include aggregatedOutput
// in the same JSONL frame. Repository reads can therefore exceed 64 KiB even
// though the event is valid. Keep a defensive transport bound, but make it
// large enough for normal engineering/audit output instead of treating valid
// command output as a protocol violation.
const MAX_JSONL_FRAME_BYTES = 16 * 1024 * 1024;
const PROTOCOL_TAIL_BYTES = 4_096;
const DEFAULT_RPC_CALL_TIMEOUT_MS = 30_000;
// Official npm target of the Codex CLI, derived from a codex.cmd shim's
// location so a Windows npm install can be launched through Node directly
// (never through a shell).
const CODEX_NODE_TARGET = ["@openai", "codex", "bin", "codex.js"] as const;
// Machine- and human-readable marker appended to any bounded evidence string
// that was cut by MAX_TEXT, and the basis of the synthetic change/evidence
// entries that make list and count truncation visible.
const TRUNCATION_MARKER = "[truncated]";

function failure(code: "CODEX_UNAVAILABLE" | "CODEX_ACCOUNT_UNAVAILABLE" | "CODEX_PROTOCOL_ERROR" | "CODEX_EXECUTION_FAILED" | "EXECUTOR_STALLED"): ExecutorResult {
  return { kind: "failed", error: serializeError(new CoreError(code)) };
}
function failedTurn(turn: Record<string, unknown>): ExecutorResult {
  const error = object(turn.error) ? turn.error : undefined;
  if (error?.codexErrorInfo === "serverOverloaded") {
    return {
      kind: "failed",
      error: {
        code: "CODEX_EXECUTION_FAILED",
        message: "Codex execution failed: the selected model is at capacity."
      }
    };
  }
  return failure("CODEX_EXECUTION_FAILED");
}
function environment(host: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ENVIRONMENT_ALLOWLIST) if (host[key]) result[key] = host[key];
  return result;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function bounded(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length <= MAX_TEXT) return value;
  // The marker must fit inside the MAX_TEXT budget: its length plus the
  // newline separator is deducted from the retained content, so the final
  // string never exceeds MAX_TEXT.
  const retained = MAX_TEXT - TRUNCATION_MARKER.length - 1;
  return `${value.slice(0, retained)}\n${TRUNCATION_MARKER}`;
}
function appendProtocolTail(current: Buffer, chunk: string): Buffer {
  const bytes = Buffer.from(chunk, "utf8");
  const combined = current.length === 0 ? bytes : Buffer.concat([current, bytes]);
  return combined.length <= PROTOCOL_TAIL_BYTES
    ? combined
    : combined.subarray(combined.length - PROTOCOL_TAIL_BYTES);
}
function tailSha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function agentMessageText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") return item.text;
  if (!Array.isArray(item.content)) return undefined;
  const parts = item.content
    .filter(object)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts.join("");
}

export class CodexExecutor implements Executor {
  private child: ChildProcessWithoutNullStreams | undefined;
  private threadId?: string;
  private turnId: string | undefined;
  private startedTurnId: string | undefined;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: () => void;
    timer: NodeJS.Timeout;
  }>();
  private beginInterrupt: (() => void) | undefined;

  constructor(private readonly workspaceRoot: string, private readonly startProcess: ProcessStarter = spawn,
    private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly timing: ExecutorTiming & { readonly rpcCallTimeoutMs?: number } = DEFAULT_EXECUTOR_TIMING) {}

  async execute(request: ExecutorRequest): Promise<ExecutorResult> {
    const executorStartedAt = new Date().toISOString();
    let protocolFailureStage: string | undefined;
    let protocolEventSequence = 0;
    let protocolLastFrameBytes = 0;
    let protocolLastMethod: string | undefined;
    let protocolLastItemType: string | undefined;
    let protocolFinalFrameSeen = false;
    let protocolStdoutBytes = 0;
    let protocolStderrBytes = 0;
    let protocolStdoutTail = Buffer.alloc(0);
    let protocolStderrTail = Buffer.alloc(0);
    let protocolExitCode: number | null | undefined;
    const protocolFailure = (stage: string): ExecutorResult => {
      protocolFailureStage ??= stage;
      return failure("CODEX_PROTOCOL_ERROR");
    };
    const withDiagnostics = (result: ExecutorResult): ExecutorResult => ({
      ...result,
      diagnostics: {
        executor_started_at: executorStartedAt,
        executor_ended_at: new Date().toISOString(),
        ...(protocolFailureStage === undefined ? {} : {
          protocol: {
            stage: protocolFailureStage,
            event_sequence: protocolEventSequence,
            last_frame_bytes: protocolLastFrameBytes,
            ...(protocolLastMethod === undefined ? {} : { last_method: protocolLastMethod }),
            ...(protocolLastItemType === undefined ? {} : { last_item_type: protocolLastItemType }),
            final_frame_seen: protocolFinalFrameSeen,
            stdout_bytes: protocolStdoutBytes,
            stdout_tail_bytes: protocolStdoutTail.length,
            stdout_tail_sha256: tailSha256(protocolStdoutTail),
            stderr_bytes: protocolStderrBytes,
            stderr_tail_bytes: protocolStderrTail.length,
            stderr_tail_sha256: tailSha256(protocolStderrTail),
            ...(protocolExitCode === undefined ? {} : { subprocess_exit_code: protocolExitCode })
          }
        })
      }
    });
    this.turnId = undefined;
    this.startedTurnId = undefined;
    let child: ChildProcessWithoutNullStreams;
    let accountRouted = false;
    try {
      const accountLaunch = resolveCodexAccountLaunch(request.account, this.hostEnvironment, this.platform);
      accountRouted = accountLaunch !== undefined;
      const childEnvironment = environment(this.hostEnvironment);
      if (accountLaunch !== undefined) {
        Object.assign(childEnvironment, accountLaunch.environmentOverlay);
      }
      const options: SpawnOptionsWithoutStdio = {
        cwd: this.workspaceRoot, shell: false, stdio: ["pipe", "pipe", "pipe"],
        detached: this.platform !== "win32", env: childEnvironment
      };
      // Windows: a directly spawnable codex.exe is preferred; an npm-installed
      // codex.cmd shim is resolved to the official bin/codex.js Node target and
      // launched through Node directly. Nothing here goes through a shell, and
      // the user instruction travels over stdin, never through the command
      // line. Everywhere else (and as the Windows fallback) the original bare
      // "codex" spawn is unchanged.
      if (accountLaunch !== undefined) {
        child = this.startProcess(accountLaunch.executable, accountLaunch.args, options);
      } else {
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
      }
      this.child = child;
    } catch (error) {
      if (request.account !== undefined) {
        return withDiagnostics({
          kind: "failed",
          error: serializeError(error instanceof CoreError ? error : new CoreError("CODEX_ACCOUNT_UNAVAILABLE"))
        });
      }
      return withDiagnostics(failure("CODEX_UNAVAILABLE"));
    }

    const evidence = new Map<string, ExecutorEvidence>();
    let evidenceDropped = 0;
    let output = "";
    let buffer = "";
    let terminal: ((result: ExecutorResult) => void) | undefined;
    let terminalPromise: Promise<ExecutorResult>;
    terminalPromise = new Promise((resolve) => { terminal = resolve; });
    let settled = false;
    let directExited = false;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let inactivityTimer: NodeJS.Timeout | undefined;
    let interruptTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let exitImmediate: NodeJS.Immediate | undefined;
    let terminationResult: ExecutorResult | undefined;
    let killSignalled = false;
    const rejectPending = (): void => {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject();
      }
      this.pending.clear();
    };
    const finish = (result: ExecutorResult): void => {
      if (settled) return;
      const finalResult = terminationResult?.kind === "interrupted"
        ? { ...terminationResult, output, evidence: visibleEvidence() }
        : terminationResult ?? result;
      settled = true;
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (inactivityTimer !== undefined) clearTimeout(inactivityTimer);
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
      // Every protocol terminal event ends this one-shot app-server, including
      // a cooperative interrupt completion. Settling the Bridge task must not
      // leave a detached process tree alive.
      if (accountRouted) {
        // codex-switch performs a short auth stage/restore transaction around
        // the inherited app-server. On normal completion, EOF lets the wrapper
        // restore the original auth state before it exits.
        child.stdin.end();
      } else {
        if (!killSignalled) {
          if (directExited) {
            signalProcessGroup(child, this.platform, "SIGTERM");
            signalProcessGroup(child, this.platform, "SIGKILL");
          } else {
            signalExecution(child, this.platform, "SIGTERM");
            signalExecution(child, this.platform, "SIGKILL");
          }
          killSignalled = true;
        }
        child.stdin.destroy();
      }
      child.stdout.destroy();
      child.stderr.destroy();
      terminal?.(withDiagnostics(finalResult));
    };
    const stop = (result: ExecutorResult): void => {
      if (settled) return;
      terminationResult = result;
      signalExecution(child, this.platform, "SIGKILL");
      killSignalled = true;
      finish(result);
    };
    const unavailable = (): void => stop(failure(accountRouted ? "CODEX_ACCOUNT_UNAVAILABLE" : "CODEX_UNAVAILABLE"));
    // The evidence view a supervisor receives. Real evidence and the synthetic
    // evidence-drop marker together never exceed MAX_EVIDENCE: the marker only
    // appears once real entries were evicted, and the eviction loop above
    // reserves its slot within the same budget. Rebuilt from a single counter,
    // it can never grow evidence unboundedly.
    const visibleEvidence = (): readonly ExecutorEvidence[] => {
      const items = [...evidence.values()];
      return evidenceDropped === 0
        ? items
        : [...items, {
          id: "evidence-drop",
          type: "commandExecution",
          status: "completed",
          command: `${evidenceDropped} evidence item(s) dropped: evidence limit exceeded`
        }];
    };
    const enforceEvidenceBudget = (): void => {
      while (evidence.size > 0 &&
        Buffer.byteLength(JSON.stringify(visibleEvidence()), "utf8") > MAX_EVIDENCE_BYTES) {
        evidence.delete(evidence.keys().next().value as string);
        evidenceDropped += 1;
      }
    };
    const currentTerminationResult = (): ExecutorResult =>
      terminationResult?.kind === "interrupted"
        ? {
          kind: "interrupted",
          output,
          ...(this.threadId === undefined ? {} : { threadId: this.threadId }),
          evidence: visibleEvidence()
        }
        : terminationResult ?? failure("CODEX_EXECUTION_FAILED");
    const forceKill = (): void => {
      signalExecution(child, this.platform, "SIGKILL", !directExited);
      killSignalled = true;
      finish(currentTerminationResult());
    };
    const sendTerm = (): void => {
      if (settled) return;
      signalExecution(child, this.platform, "SIGTERM");
      killTimer = setTimeout(forceKill, this.timing.killGraceMs);
    };
    const beginTermination = (result: ExecutorResult, cooperativeMs: number): void => {
      if (settled || terminationResult !== undefined) return;
      terminationResult = result;
      if (inactivityTimer !== undefined) {
        clearTimeout(inactivityTimer);
        inactivityTimer = undefined;
      }
      if (cooperativeMs === 0) sendTerm();
      else interruptTimer = setTimeout(sendTerm, cooperativeMs);
    };
    const startInactivityWatchdog = (): void => {
      if (settled || terminationResult !== undefined) return;
      if (inactivityTimer !== undefined) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(
        () => beginTermination(failure("EXECUTOR_STALLED"), 0),
        this.timing.protocolInactivityTimeoutMs ?? DEFAULT_EXECUTOR_TIMING.protocolInactivityTimeoutMs ?? 2 * 60_000
      );
    };
    const resetInactivityWatchdog = (): void => {
      if (inactivityTimer !== undefined) startInactivityWatchdog();
    };
    const activeTurnActivity = (params: Record<string, unknown>): boolean => {
      return this.threadId !== undefined &&
        this.startedTurnId !== undefined &&
        params.threadId === this.threadId &&
        params.turnId === this.startedTurnId;
    };
    this.beginInterrupt = () => {
      if (settled || terminationResult !== undefined) return;
      const result: ExecutorResult = { kind: "interrupted", output, evidence: visibleEvidence() };
      if (this.threadId !== undefined) Object.assign(result, { threadId: this.threadId });
      if (this.threadId && this.startedTurnId) {
        // The protocol request is best-effort. Its response is not the terminal
        // signal, and its Promise must never hold control_task open.
        void this.call("turn/interrupt", {
          threadId: this.threadId,
          turnId: this.startedTurnId
        }).catch((): void => {});
        beginTermination(result, this.timing.interruptGraceMs);
      } else {
        // initialize/thread-start/turn-start have no cooperative turn seam.
        beginTermination(result, 0);
      }
    };
    deadlineTimer = setTimeout(
      () => beginTermination(failure("CODEX_EXECUTION_FAILED"), 0),
      this.timing.executionTimeoutMs
    );
    child.on("error", unavailable);
    child.stdin.on("error", unavailable);
    child.stdout.on("error", unavailable);
    child.stderr.on("error", unavailable);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      protocolStderrBytes += Buffer.byteLength(chunk, "utf8");
      protocolStderrTail = appendProtocolTail(protocolStderrTail, chunk);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      protocolStdoutBytes += Buffer.byteLength(chunk, "utf8");
      protocolStdoutTail = appendProtocolTail(protocolStdoutTail, chunk);
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        protocolLastFrameBytes = Buffer.byteLength(rawLine, "utf8");
        if (protocolLastFrameBytes > MAX_JSONL_FRAME_BYTES) {
          finish(protocolFailure("frame_too_large"));
          return;
        }
        const line = rawLine.trim();
        if (!line) continue;
        protocolEventSequence += 1;
        let message: unknown;
        try { message = JSON.parse(line); } catch { finish(protocolFailure("json_parse")); return; }
        if (!object(message)) { finish(protocolFailure("message_shape")); return; }
        if (typeof message.id === "number" && ("result" in message || "error" in message)) {
          const waiter = this.pending.get(message.id);
          if (waiter) {
            this.pending.delete(message.id);
            clearTimeout(waiter.timer);
            "error" in message ? waiter.reject() : waiter.resolve(message.result);
          }
          continue;
        }
        if (typeof message.method !== "string") { finish(protocolFailure("message_method_shape")); return; }
        protocolLastMethod = message.method;
        if (message.params !== undefined && message.params !== null && !object(message.params)) {
          finish(protocolFailure("message_params_shape"));
          return;
        }
        const params = object(message.params) ? message.params : {};
        if (activeTurnActivity(params)) resetInactivityWatchdog();
        if (message.method === "turn/started") {
          const turn = object(params.turn) ? params.turn : params;
          if (params.threadId === this.threadId &&
            typeof turn.id === "string" &&
            (!this.turnId || turn.id === this.turnId)) {
            this.startedTurnId = turn.id;
            startInactivityWatchdog();
          }
        }
        const item = object(params.item) ? params.item : undefined;
        if ((message.method === "item/started" || message.method === "item/completed") && item) {
          protocolLastItemType = typeof item.type === "string" ? item.type : undefined;
          if (item.type === "agentMessage") {
            const text = agentMessageText(item);
            if (message.method === "item/completed" && text === undefined) {
              finish(protocolFailure("agent_message_shape"));
              return;
            }
            if (text !== undefined) output = text;
          }
          const id = typeof item.id === "string" ? item.id : undefined;
          if (id && (item.type === "commandExecution" || item.type === "fileChange")) {
            const status = typeof item.status === "string" ? item.status : message.method === "item/started" ? "inProgress" : "completed";
            let entry: ExecutorEvidence;
            if (item.type === "commandExecution") entry = { id, type: item.type, status, command: bounded(item.command) };
            else {
              const rawChanges = Array.isArray(item.changes) ? item.changes : [];
              // The 50-entry bound includes the synthetic truncation marker: a
              // truncated list keeps 49 real entries and spends the 50th slot
              // on the marker, so the final list never exceeds the bound.
              const kept = rawChanges.length > 50 ? 49 : 50;
              const changes = rawChanges.slice(0, kept).filter(object).map((c) => ({ path: bounded(c.path), diff: bounded(c.diff) }));
              if (rawChanges.length > 50) {
                // omitted counts exactly the real changes that were never
                // returned to the supervisor.
                changes.push({ path: `[truncated: ${rawChanges.length - kept} additional changes omitted]`, diff: "" });
              }
              entry = { id, type: item.type, status, changes };
            }
            evidence.set(id, entry);
            // The MAX_EVIDENCE budget includes the evidence-drop marker: once
            // any drop has happened the marker reserves one slot within the
            // same budget, so the final visible list never exceeds
            // MAX_EVIDENCE entries.
            while (evidence.size + (evidenceDropped > 0 ? 1 : 0) > MAX_EVIDENCE) {
              evidence.delete(evidence.keys().next().value as string);
              evidenceDropped += 1;
            }
            enforceEvidenceBudget();
            request.onEvidence?.(visibleEvidence());
          }
        }
        if (message.method === "turn/completed") {
          const turn = object(params.turn) ? params.turn : params;
          if (params.threadId !== this.threadId ||
            typeof turn.id !== "string" ||
            turn.id !== (this.startedTurnId ?? this.turnId)) continue;
          protocolFinalFrameSeen = true;
          const status = turn.status;
          const common = { threadId: this.threadId, evidence: visibleEvidence() };
          if (status === "failed") finish({ ...failedTurn(turn), ...common });
          else if (status === "interrupted") finish({ kind: "interrupted", output, ...common });
          else if (status === "completed") finish({ kind: "completed", output, ...common });
          else finish(protocolFailure("turn_status"));
        }
      }
      if (Buffer.byteLength(buffer, "utf8") > MAX_JSONL_FRAME_BYTES) {
        protocolLastFrameBytes = Buffer.byteLength(buffer, "utf8");
        finish(protocolFailure("unterminated_frame_too_large"));
      }
    });
    const finishFromExit = (code: number | null): void => {
      if (settled) return;
      protocolExitCode = code;
      if (inactivityTimer !== undefined) clearTimeout(inactivityTimer);
      directExited = true;
      // The app-server can no longer answer. Reject RPC callers immediately;
      // descendant cleanup may continue for the bounded kill grace below.
      rejectPending();
      const result = terminationResult ?? (code === 0
        ? protocolFailure("process_exit_without_terminal")
        : failure("CODEX_EXECUTION_FAILED"));
      terminationResult = result;
      if (signalProcessGroup(child, this.platform, "SIGTERM")) {
        if (killTimer === undefined) killTimer = setTimeout(forceKill, this.timing.killGraceMs);
        return;
      }
      if (buffer.trim()) {
        protocolLastFrameBytes = Buffer.byteLength(buffer, "utf8");
        try { JSON.parse(buffer); } catch { finish(protocolFailure("partial_frame_on_exit")); return; }
      }
      finish(currentTerminationResult());
    };
    child.on("exit", (code) => {
      // `close` can be withheld indefinitely by descendants that inherited an
      // app-server pipe. Drain already-delivered events once, then settle from
      // the direct child's exit and reject every outstanding RPC.
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
      if (request.reasoning !== undefined && request.reasoning_effort !== undefined) {
        throw new CoreError("UNSUPPORTED_ACTION");
      }
      const reasoningEffort = request.reasoning ?? request.reasoning_effort;
      if (request.model !== undefined || reasoningEffort !== undefined) {
        const modelResult = await this.call("model/list", {});
        if (!object(modelResult) || !Array.isArray(modelResult.data)) throw new Error();
        const models = modelResult.data.filter((entry): entry is Record<string, unknown> =>
          object(entry) && typeof entry.model === "string"
        );
        const selected = request.model !== undefined
          ? models.find((entry) => entry.model === request.model)
          : models.find((entry) => entry.isDefault === true);
        if (!selected) throw new CoreError("UNSUPPORTED_ACTION");
        if (reasoningEffort !== undefined) {
          const efforts = Array.isArray(selected.supportedReasoningEfforts)
            ? selected.supportedReasoningEfforts
            : [];
          if (!efforts.some((effort) => object(effort) && effort.reasoningEffort === reasoningEffort)) {
            throw new CoreError("UNSUPPORTED_ACTION");
          }
        }
      }
      const sandbox = request.sandbox ?? "read-only";
      const threadParams: Record<string, unknown> = { cwd: this.workspaceRoot, approvalPolicy: "never", sandbox };
      if (request.service_tier !== undefined) threadParams.serviceTier = request.service_tier;
      if (request.webSearch === "live") {
        threadParams.config = { web_search: "live" };
      }
      if (request.threadId) threadParams.threadId = request.threadId;
      const threadResult = await this.call(request.threadId ? "thread/resume" : "thread/start", threadParams);
      if (!object(threadResult) || !object(threadResult.thread) || typeof threadResult.thread.id !== "string") throw new Error();
      this.threadId = threadResult.thread.id;
      const sandboxPolicy = sandbox === "danger-full-access"
        ? { type: "dangerFullAccess" }
        : sandbox === "workspace-write"
          ? { type: "workspaceWrite", writableRoots: [this.workspaceRoot], networkAccess: false }
          : { type: "readOnly", networkAccess: false };
      const turnParams: Record<string, unknown> = {
        threadId: this.threadId, input: [{ type: "text", text: request.instruction }],
        cwd: this.workspaceRoot, approvalPolicy: "never", sandboxPolicy
      };
      if (request.model !== undefined) turnParams.model = request.model;
      if (reasoningEffort !== undefined) turnParams.effort = reasoningEffort;
      if (request.service_tier !== undefined) turnParams.serviceTier = request.service_tier;
      const turnResult = await this.call("turn/start", turnParams);
      if (!object(turnResult) || !object(turnResult.turn) || typeof turnResult.turn.id !== "string") throw new Error();
      this.turnId = turnResult.turn.id;
      if (this.startedTurnId !== this.turnId) this.startedTurnId = undefined;
    } catch (error) {
      if (!settled) finish(error instanceof CoreError && error.code === "UNSUPPORTED_ACTION"
        ? { kind: "failed", error: serializeError(error) }
        : protocolFailure("rpc_or_handshake"));
    }
    return terminalPromise;
  }

  async steer(instruction: string): Promise<void> {
    if (!this.threadId || !this.startedTurnId) throw new CoreError("INVALID_STATE_TRANSITION");
    await this.call("turn/steer", { threadId: this.threadId, expectedTurnId: this.startedTurnId, input: [{ type: "text", text: instruction }] });
  }
  async interrupt(): Promise<void> {
    if (!this.child || !this.beginInterrupt) throw new CoreError("INVALID_STATE_TRANSITION");
    this.beginInterrupt();
  }
  private call(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.stdin.destroyed) { reject(); return; }
      const rejectWaiter = (): void => reject(new Error());
      const timer = setTimeout(() => {
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject();
      }, this.timing.rpcCallTimeoutMs ?? DEFAULT_RPC_CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject: rejectWaiter, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch {
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject();
      }
    });
  }
  private notify(method: string, params: unknown): void { this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`); }
}
