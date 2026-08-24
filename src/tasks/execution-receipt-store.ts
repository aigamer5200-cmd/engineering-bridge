import { open, readFile, rename, unlink } from "node:fs/promises";

import { CoreError } from "../core/errors.js";
import { isId } from "../core/ids.js";
import type { Id } from "../core/ids.js";

export type ExecutionReceiptOperation =
  | "run_task"
  | "generate_controlled_patch"
  | "refine_controlled_patch";

export type ExecutionReceiptState = "waiting_for_supervisor_review" | "completed";

export interface ExecutionReceiptRecord {
  readonly taskId: Id;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly executor: "codex";
  readonly operation: ExecutionReceiptOperation;
  readonly readOnly: true;
  readonly state: ExecutionReceiptState;
  readonly recordedAt: string;
}

const EXECUTION_RECEIPTS_VERSION = 1;
const MAX_EXECUTION_RECEIPTS = 500;

/**
 * Durable, Bridge-authored provenance for formal read-only Codex execution.
 *
 * Active task supervision remains process-local.  This store persists only the
 * bounded evidence needed by Shoestring GOAL to prove that a ready/completed
 * Codex task actually entered through Engineering Bridge for the registered
 * workspace.  It grants no write authority and contains no prompt/output text.
 */
export class ExecutionReceiptStore {
  private records = new Map<Id, ExecutionReceiptRecord>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  constructor(private readonly stateFilePath?: string) {}

  async load(): Promise<void> {
    if (this.stateFilePath === undefined) return;
    if (this.records.size !== 0) throw new CoreError("INTERNAL_ERROR");
    let source: string;
    try {
      source = await readFile(this.stateFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new CoreError("INTERNAL_ERROR");
    }

    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new CoreError("INTERNAL_ERROR");
    }
    if (!isObject(value) || value.version !== EXECUTION_RECEIPTS_VERSION ||
        !Array.isArray(value.receipts)) {
      throw new CoreError("INTERNAL_ERROR");
    }

    for (const item of value.receipts) {
      const record = parseRecord(item);
      if (record === undefined || this.records.has(record.taskId)) continue;
      this.records.set(record.taskId, record);
    }
    this.trim();
  }

  get(taskId: unknown): ExecutionReceiptRecord | undefined {
    if (!isId(taskId)) return undefined;
    const record = this.records.get(taskId);
    return record === undefined ? undefined : { ...record };
  }

  record(input: Omit<ExecutionReceiptRecord, "recordedAt">): Promise<void> {
    const mutation = this.mutationQueue.then(async (): Promise<void> => {
      const existing = this.records.get(input.taskId);
      const next: ExecutionReceiptRecord = {
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot,
        executor: input.executor,
        operation: input.operation,
        readOnly: input.readOnly,
        state: input.state,
        recordedAt: new Date().toISOString()
      };
      if (existing !== undefined) {
        if (!sameIdentity(existing, next)) throw new CoreError("INTERNAL_ERROR");
        if (existing.state === "completed" && next.state !== "completed") return;
      }
      const snapshot = this.records;
      this.records = new Map(snapshot);
      this.records.delete(input.taskId);
      this.records.set(input.taskId, next);
      this.trim();
      try {
        await this.persist();
      } catch {
        this.records = snapshot;
        throw new CoreError("INTERNAL_ERROR");
      }
    });
    this.mutationQueue = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  remove(taskId: unknown): Promise<void> {
    if (!isId(taskId)) throw new CoreError("INTERNAL_ERROR");
    const mutation = this.mutationQueue.then(async (): Promise<void> => {
      if (!this.records.has(taskId)) return;
      const snapshot = this.records;
      this.records = new Map(snapshot);
      this.records.delete(taskId);
      try {
        await this.persist();
      } catch {
        this.records = snapshot;
        throw new CoreError("INTERNAL_ERROR");
      }
    });
    this.mutationQueue = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  private trim(): void {
    const keys = [...this.records.keys()];
    for (const taskId of keys.slice(0, Math.max(0, keys.length - MAX_EXECUTION_RECEIPTS))) {
      this.records.delete(taskId);
    }
  }

  private persist(): Promise<void> {
    if (this.stateFilePath === undefined) return Promise.resolve();
    const contents = `${JSON.stringify({
      version: EXECUTION_RECEIPTS_VERSION,
      receipts: [...this.records.values()].map((record) => ({
        task_id: record.taskId,
        workspace_id: record.workspaceId,
        workspace_root: record.workspaceRoot,
        executor: record.executor,
        operation: record.operation,
        read_only: record.readOnly,
        state: record.state,
        recorded_at: record.recordedAt
      }))
    }, null, 2)}\n`;
    return this.writeStateFile(contents);
  }

  private async writeStateFile(contents: string): Promise<void> {
    const stateFilePath = this.stateFilePath!;
    const temporaryPath = `${stateFilePath}.${process.pid}.${Date.now()}.${this.writeSequence++}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(contents, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, stateFilePath);
    } catch {
      await handle?.close().catch((): void => {});
      await unlink(temporaryPath).catch((): void => {});
      throw new CoreError("INTERNAL_ERROR");
    }
  }
}

function parseRecord(item: unknown): ExecutionReceiptRecord | undefined {
  if (!isObject(item) || !isId(item.task_id) ||
      typeof item.workspace_id !== "string" || item.workspace_id.length === 0 ||
      typeof item.workspace_root !== "string" || item.workspace_root.length === 0 ||
      item.executor !== "codex" ||
      !isOperation(item.operation) || item.read_only !== true ||
      !isState(item.state) ||
      typeof item.recorded_at !== "string" || item.recorded_at.length === 0) {
    return undefined;
  }
  return {
    taskId: item.task_id,
    workspaceId: item.workspace_id,
    workspaceRoot: item.workspace_root,
    executor: "codex",
    operation: item.operation,
    readOnly: true,
    state: item.state,
    recordedAt: item.recorded_at
  };
}

function isOperation(value: unknown): value is ExecutionReceiptOperation {
  return value === "run_task" ||
    value === "generate_controlled_patch" ||
    value === "refine_controlled_patch";
}

function isState(value: unknown): value is ExecutionReceiptState {
  return value === "waiting_for_supervisor_review" || value === "completed";
}

function sameIdentity(a: ExecutionReceiptRecord, b: ExecutionReceiptRecord): boolean {
  return a.taskId === b.taskId &&
    a.workspaceId === b.workspaceId &&
    a.workspaceRoot === b.workspaceRoot &&
    a.executor === b.executor &&
    a.operation === b.operation &&
    a.readOnly === b.readOnly;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
