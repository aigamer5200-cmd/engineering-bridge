import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Id } from "../core/ids.js";
import type { SerializedError } from "../core/errors.js";

export type SandboxMode = "read-only" | "workspace-write";

export interface EvidenceChange { readonly path: string; readonly diff: string }
export interface ExecutorEvidence {
  readonly id: string;
  readonly type: "commandExecution" | "fileChange";
  readonly status: string;
  readonly command?: string;
  readonly changes?: readonly EvidenceChange[];
}

export interface ExecutorRequest {
  readonly taskId: Id;
  readonly instruction: string;
  readonly sandbox?: SandboxMode;
  readonly webSearch?: "live";
  readonly threadId?: string | undefined;
  readonly onEvidence?: (evidence: readonly ExecutorEvidence[]) => void;
}

export type ExecutorResult =
  | { readonly kind: "completed" | "interrupted"; readonly output: string; readonly threadId?: string | undefined; readonly evidence?: readonly ExecutorEvidence[] }
  | { readonly kind: "failed"; readonly error: SerializedError; readonly threadId?: string | undefined; readonly evidence?: readonly ExecutorEvidence[] };

export interface Executor {
  execute(request: ExecutorRequest): Promise<ExecutorResult>;
  steer?(instruction: string): Promise<void>;
  interrupt?(): Promise<void>;
}

export interface ExecutorTiming {
  readonly executionTimeoutMs: number;
  readonly interruptGraceMs: number;
  readonly killGraceMs: number;
}

export const DEFAULT_EXECUTOR_TIMING: ExecutorTiming = {
  executionTimeoutMs: 15 * 60_000,
  interruptGraceMs: 5_000,
  killGraceMs: 2_000
};

export function signalProcessGroup(
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform,
  signal: NodeJS.Signals
): boolean {
  if (platform === "win32" || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function signalExecution(
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform,
  signal: NodeJS.Signals,
  directChildAlive = true
): boolean {
  if (signalProcessGroup(child, platform, signal)) return true;
  if (!directChildAlive) return false;
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}
