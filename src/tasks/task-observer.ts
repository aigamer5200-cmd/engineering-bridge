import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";

import type { ExecutorEvidence } from "../executors/executor.js";

export type TaskObserverMode = "log" | "window";
export type TaskObserverState =
  | "queued"
  | "running"
  | "waiting_for_supervisor_review"
  | "completed"
  | "failed";

export interface TaskObserver {
  state(taskId: string, executor: string | undefined, state: TaskObserverState): void;
  thread(taskId: string, executor: string | undefined, threadId: string): void;
  evidence(taskId: string, executor: string | undefined, evidence: readonly ExecutorEvidence[]): void;
}

export const MAX_OBSERVER_LOG_BYTES = 512 * 1024;

const MAX_EVIDENCE_ITEMS = 20;
const MAX_CHANGE_PATHS = 8;
const MAX_FIELD_LENGTH = 220;

function bounded(value: unknown): string {
  return String(value)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

function quoted(value: unknown): string {
  return `"${bounded(value).replace(/"/gu, "\\\"")}"`;
}

function evidenceSummary(item: ExecutorEvidence): string {
  if (item.type === "commandExecution") {
    return [
      "type=commandExecution",
      `status=${bounded(item.status)}`,
      item.command === undefined ? undefined : `command=${quoted(item.command)}`,
    ].filter((value): value is string => value !== undefined).join(" ");
  }

  const paths = (item.changes ?? [])
    .slice(0, MAX_CHANGE_PATHS)
    .map(({ path }) => bounded(path))
    .filter(Boolean);
  const omitted = Math.max(0, (item.changes?.length ?? 0) - paths.length);
  return [
    "type=fileChange",
    `status=${bounded(item.status)}`,
    paths.length === 0 ? undefined : `paths=${quoted(paths.join(", "))}`,
    omitted === 0 ? undefined : `omitted_paths=${omitted}`,
  ].filter((value): value is string => value !== undefined).join(" ");
}

export class TaskObserverLogger implements TaskObserver {
  readonly logPath: string;
  private readonly lastStates = new Map<string, TaskObserverState>();
  private readonly lastThreads = new Map<string, string>();
  private readonly lastEvidence = new Map<string, string>();
  private windowLaunchAttempted = false;

  constructor(configPath: string, mode: TaskObserverMode) {
    this.logPath = `${configPath}.observer.log`;
    this.write(`observer=ready mode=${mode}`);
    if (mode === "window" && process.platform === "win32") this.launchWindow();
  }

  state(taskId: string, executor: string | undefined, state: TaskObserverState): void {
    if (this.lastStates.get(taskId) === state) return;
    this.lastStates.set(taskId, state);
    this.write(`task=${bounded(taskId)} executor=${bounded(executor ?? "none")} state=${state}`);
  }

  thread(taskId: string, executor: string | undefined, threadId: string): void {
    if (this.lastThreads.get(taskId) === threadId) return;
    this.lastThreads.set(taskId, threadId);
    this.write(`task=${bounded(taskId)} executor=${bounded(executor ?? "none")} thread_id=${bounded(threadId)}`);
  }

  evidence(taskId: string, executor: string | undefined, evidence: readonly ExecutorEvidence[]): void {
    const visible = evidence.slice(-MAX_EVIDENCE_ITEMS).map(evidenceSummary);
    const summary = visible.join(" | ") || "none";
    if (this.lastEvidence.get(taskId) === summary) return;
    this.lastEvidence.set(taskId, summary);
    this.write(`task=${bounded(taskId)} executor=${bounded(executor ?? "none")} evidence=${summary}`);
  }

  private write(message: string): void {
    try {
      appendFileSync(this.logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
      if (statSync(this.logPath).size <= MAX_OBSERVER_LOG_BYTES) return;
      const content = readFileSync(this.logPath);
      const start = Math.max(0, content.length - MAX_OBSERVER_LOG_BYTES);
      const boundary = content.indexOf(10, start);
      writeFileSync(this.logPath, content.subarray(boundary < 0 ? start : boundary + 1));
    } catch {
      // Observation is best effort and must never affect task execution.
    }
  }

  private launchWindow(): void {
    if (this.windowLaunchAttempted) return;
    this.windowLaunchAttempted = true;
    try {
      const literalPath = this.logPath.replace(/'/gu, "''");
      const title = "Shoestring GOAL - Codex Observer";
      const command = `$Host.UI.RawUI.WindowTitle='${title}'; Get-Content -LiteralPath '${literalPath}' -Wait`;
      const child = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NoExit", "-Command", command],
        { detached: true, stdio: "ignore", windowsHide: false },
      );
      child.once("error", () => undefined);
      child.unref();
    } catch {
      // Window launch is optional; log-only observation remains available.
    }
  }
}

export function createTaskObserver(
  configPath: string,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): TaskObserver | undefined {
  const mode = environment.ENGINEERING_BRIDGE_OBSERVER_MODE;
  return mode === "log" || mode === "window"
    ? new TaskObserverLogger(configPath, mode)
    : undefined;
}
