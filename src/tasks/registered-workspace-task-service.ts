import { isId, newId } from "../core/ids.js";
import { serializeError } from "../core/errors.js";
import type { Id } from "../core/ids.js";
import type { SerializedError } from "../core/errors.js";
import { CoreError } from "../core/errors.js";
import type { Executor, ExecutorEvidence } from "../executors/executor.js";
import { RegisteredWorkspaceRegistry } from "../workspaces/registered-workspace-registry.js";
import { attachKnowledgePreflightReceipt } from "./knowledge-preflight-receipt.js";
import type { KnowledgePreflightReceipt } from "./knowledge-preflight-receipt.js";
import type { ExecutionReceiptOperation } from "./execution-receipt-store.js";
import { ExecutionReceiptStore } from "./execution-receipt-store.js";
import type { TaskObserver, TaskObserverState } from "./task-observer.js";

export type ExecutorName = "codex" | "dsh";

export interface RegisteredWorkspaceTaskRequest {
  readonly workspace_id: string;
  readonly instruction: string;
  readonly executor?: ExecutorName;
  readonly model?: string;
  readonly web_research?: boolean;
  readonly preflight_receipt?: KnowledgePreflightReceipt;
}

type NormalizedRegisteredWorkspaceTaskRequest = RegisteredWorkspaceTaskRequest & { readonly executor: ExecutorName };

function normalizeTaskRequest(request: RegisteredWorkspaceTaskRequest): NormalizedRegisteredWorkspaceTaskRequest {
  const executor = request.executor ?? "codex";
  if (request.web_research === true && executor !== "codex") {
    throw new CoreError("UNSUPPORTED_ACTION");
  }
  if (request.model !== undefined && executor !== "codex") {
    throw new CoreError("UNSUPPORTED_ACTION");
  }
  return { ...request, executor };
}

export type RegisteredWorkspaceTaskResult =
  | {
    readonly id: Id;
    readonly state: "completed";
    readonly output: string;
  }
  | {
    readonly id: Id;
    readonly state: "failed";
    readonly error: SerializedError;
    // Present only when the executor returned genuine partial output for an
    // interrupted run; never for ordinary failures and never as completed
    // output. Empty partial output is omitted entirely.
    readonly partial_output?: string | undefined;
  };

export type ExecutorFactory = (executor: ExecutorName, workspaceRoot: string) => Executor;
export type CompletedOutputTransform = (output: string) => string;

export type RegisteredWorkspaceTaskState = "queued" | "running" | "completed" | "failed";

export type ControlledTaskState = RegisteredWorkspaceTaskState | "waiting_for_supervisor_review";
export interface ControlledTaskView {
  readonly taskId: Id;
  readonly state: ControlledTaskState;
  // The executor selection is fixed for the whole task lifetime. It is always
  // reported honestly: a Codex task may additionally expose its real native
  // app-server thread id, while a DSH task never gets a fabricated session or
  // thread id (DSH headless currently has no machine-resumable session seam).
  // A caller-submitted controlled patch has no executor at all: the view then
  // reports only source: "submitted" and never a codex/dsh identity.
  readonly executor?: ExecutorName | undefined;
  // Present only when the caller explicitly pinned a Codex model for this
  // task. Omitted means Codex owns default-model selection.
  readonly model?: string | undefined;
  // Present only for caller-submitted controlled patches: the proposal was
  // provided by the caller, not produced by an executor.
  readonly source?: "submitted" | undefined;
  readonly threadId?: string | undefined;
  readonly ready?: boolean;
  readonly output?: string | undefined;
  readonly review_output?: string | undefined;
  readonly partial_output?: string | undefined;
  readonly evidence?: readonly ExecutorEvidence[];
  readonly error?: SerializedError | undefined;
}

// While a legacy task is queued/running it temporarily retains its active
// executor so control_task can reach the existing interrupt/steer seam; the
// terminal record stores the result instead.
type TaskRecord =
  | { state: "queued" | "running"; executor: ExecutorName; active?: Executor }
  | { state: "completed" | "failed"; executor: ExecutorName | undefined; source?: "submitted"; result: RegisteredWorkspaceTaskResult };

type NonTerminalTaskRecord = Extract<TaskRecord, { state: "queued" | "running" }>;

type InteractiveRecord = {
  state: ControlledTaskState; request: NormalizedRegisteredWorkspaceTaskRequest; evidence: readonly ExecutorEvidence[];
  executor?: Executor | undefined; threadId?: string | undefined; output?: string | undefined;
  partialOutput?: string | undefined; error?: SerializedError | undefined;
};

const MAX_TERMINAL_TASK_HISTORY = 100;

export type TerminalTaskHandler = (result: RegisteredWorkspaceTaskResult) => void | Promise<void>;

// An interrupted run ends as TASK_INTERRUPTED: a stop is a task-level control
// outcome, never an executor execution failure, and it must not masquerade as
// DSH_EXECUTION_FAILED (or any other executor-specific code).
function interruptedError(): SerializedError {
  return serializeError(new CoreError("TASK_INTERRUPTED"));
}

// Interrupt keeps the failed terminal state and its safe error, and
// additionally retains the executor's genuine partial output. Empty partial
// output (interrupt before anything was produced) is not fabricated: the field
// is simply omitted.
function interruptedTaskResult(taskId: Id, partialOutput: string): RegisteredWorkspaceTaskResult {
  if (partialOutput === "") {
    return { id: taskId, state: "failed", error: interruptedError() };
  }
  return { id: taskId, state: "failed", error: interruptedError(), partial_output: partialOutput };
}

export class RegisteredWorkspaceTaskService {
  private readonly tasks = new Map<Id, TaskRecord>();
  private readonly pinnedTaskIds = new Set<Id>();
  private legacyTerminalTaskIds: Id[] = [];

  constructor(
    private readonly registry: RegisteredWorkspaceRegistry,
    private readonly executorFactory: ExecutorFactory,
    private readonly executionReceipts?: ExecutionReceiptStore,
    private readonly observer?: TaskObserver
  ) {}

  runTask(
    request: RegisteredWorkspaceTaskRequest,
    completedOutputTransform?: CompletedOutputTransform,
    terminalTaskHandler?: TerminalTaskHandler,
    receiptOperation?: ExecutionReceiptOperation
  ): { taskId: Id } {
    const taskId = newId();
    const normalizedRequest = normalizeTaskRequest(request);
    this.tasks.set(taskId, { state: "queued", executor: normalizedRequest.executor });
    this.observeState(taskId, normalizedRequest.executor, "queued");
    queueMicrotask(() => void this.run(
      taskId,
      normalizedRequest,
      completedOutputTransform,
      terminalTaskHandler,
      receiptOperation
    ));
    return { taskId };
  }

  pinTask(taskId: Id): void {
    this.pinnedTaskIds.add(taskId);
  }

  unpinTask(taskId: Id): void {
    this.pinnedTaskIds.delete(taskId);
    this.trimLegacyTerminalTasks();
  }

  restoreControlledPatchTask(taskId: Id, output: string, pinned: boolean, executor: ExecutorName | undefined = "codex", source?: "submitted"): void {
    if (this.tasks.has(taskId) || this.interactive.has(taskId)) {
      throw new CoreError("INTERNAL_ERROR");
    }
    const result: RegisteredWorkspaceTaskResult = { id: taskId, state: "completed", output };
    const record: TaskRecord = {
      state: "completed",
      executor: source === "submitted" ? undefined : executor ?? "codex",
      ...(source === undefined ? {} : { source }),
      result
    };
    this.tasks.set(taskId, record);
    this.legacyTerminalTaskIds.push(taskId);
    if (pinned) this.pinnedTaskIds.add(taskId);
    this.trimLegacyTerminalTasks();
  }

  // Registers a caller-submitted controlled patch as a retained completed task
  // with submitted provenance: no executor ran, so none is reported.
  submitControlledPatchTask(output: string, pinned: boolean): { taskId: Id } {
    const taskId = newId();
    this.restoreControlledPatchTask(taskId, output, pinned, undefined, "submitted");
    return { taskId };
  }

  status(taskId: unknown): { taskId: Id; state: RegisteredWorkspaceTaskState } | undefined {
    if (!isId(taskId)) return undefined;
    const task = this.tasks.get(taskId);
    return task && { taskId, state: task.state };
  }

  result(taskId: unknown): RegisteredWorkspaceTaskResult | undefined {
    if (!isId(taskId)) return undefined;
    const task = this.tasks.get(taskId);
    return task?.state === "completed" || task?.state === "failed" ? task.result : undefined;
  }

  startTask(request: RegisteredWorkspaceTaskRequest): { taskId: Id } {
    const taskId = newId();
    const normalizedRequest = normalizeTaskRequest(request);
    this.interactive.set(taskId, { state: "queued", request: normalizedRequest, evidence: [] });
    this.observeState(taskId, normalizedRequest.executor, "queued");
    queueMicrotask(() => void this.executeInteractive(taskId));
    return { taskId };
  }

  taskView(taskId: unknown): ControlledTaskView | undefined {
    if (!isId(taskId)) return undefined;
    const record = this.interactive.get(taskId);
    if (!record) {
      const legacy = this.tasks.get(taskId);
      if (!legacy) return undefined;
      if (!("result" in legacy)) {
        return { taskId, state: legacy.state, executor: legacy.executor, ready: false };
      }
      const common = {
        taskId,
        state: legacy.result.state,
        ...(legacy.executor === undefined ? {} : { executor: legacy.executor }),
        ...(legacy.source === undefined ? {} : { source: legacy.source }),
        ready: true
      };
      return legacy.result.state === "completed"
        ? { ...common, output: legacy.result.output }
        : {
          ...common,
          error: legacy.result.error,
          ...(legacy.result.partial_output === undefined ? {} : { partial_output: legacy.result.partial_output })
        };
    }
    const base: ControlledTaskView = {
      taskId,
      state: record.state,
      executor: record.request.executor,
      ...(record.request.model === undefined ? {} : { model: record.request.model }),
      evidence: record.evidence,
      ...(record.threadId === undefined ? {} : { threadId: record.threadId })
    };
    if (record.state === "queued" || record.state === "running") return { ...base, ready: false };
    if (record.state === "waiting_for_supervisor_review") return { ...base, ready: true, review_output: record.output };
    if (record.state === "completed") return { ...base, ready: true, output: record.output };
    return {
      ...base,
      ready: true,
      error: record.error,
      ...(record.partialOutput === undefined || record.partialOutput === ""
        ? {}
        : { partial_output: record.partialOutput })
    };
  }

  async controlTask(taskId: unknown, action: "continue" | "steer" | "interrupt" | "accept", instruction?: string): Promise<ControlledTaskView> {
    if (!isId(taskId)) throw new CoreError("INVALID_STATE_TRANSITION");
    const record = this.interactive.get(taskId);
    if (record !== undefined) return this.controlInteractiveTask(taskId, record, action, instruction);
    const legacy = this.tasks.get(taskId);
    if (legacy === undefined || "result" in legacy) throw new CoreError("INVALID_STATE_TRANSITION");
    return this.controlLegacyTask(taskId, legacy, action, instruction);
  }

  private async controlInteractiveTask(
    taskId: Id,
    record: InteractiveRecord,
    action: "continue" | "steer" | "interrupt" | "accept",
    instruction?: string
  ): Promise<ControlledTaskView> {
    if (action === "accept") {
      if (record.state !== "waiting_for_supervisor_review") throw new CoreError("INVALID_STATE_TRANSITION");
      await this.recordExecutionReceipt(taskId, record.request, "run_task", "completed");
      record.state = "completed";
      this.observeState(taskId, record.request.executor, "completed");
      this.interactiveTerminalTaskIds.push(taskId);
      this.trimInteractiveTerminalTasks();
    } else if (action === "continue") {
      if (record.state !== "waiting_for_supervisor_review" || !instruction?.trim()) throw new CoreError("INVALID_STATE_TRANSITION");
      if (record.request.executor === "codex") {
        await this.executionReceipts?.remove(taskId);
      }
      record.request = { ...record.request, instruction };
      record.state = "queued";
      this.observeState(taskId, record.request.executor, "queued");
      queueMicrotask(() => void this.executeInteractive(taskId));
    } else if (action === "steer") {
      // DSH headless has no steer seam: the action is unsupported for the
      // executor type, not an invalid state transition. Codex steer behavior
      // is unchanged.
      if (record.request.executor === "dsh") throw new CoreError("UNSUPPORTED_ACTION");
      if (record.state !== "running" || !instruction?.trim() || !record.executor?.steer) throw new CoreError("INVALID_STATE_TRANSITION");
      await record.executor.steer(instruction);
    } else {
      if (record.state !== "running" || !record.executor?.interrupt) throw new CoreError("INVALID_STATE_TRANSITION");
      await record.executor.interrupt();
    }
    return this.taskView(taskId)!;
  }

  private async controlLegacyTask(
    taskId: Id,
    record: NonTerminalTaskRecord,
    action: "continue" | "steer" | "interrupt" | "accept",
    instruction?: string
  ): Promise<ControlledTaskView> {
    if (action === "steer") {
      // Same executor-type gate as the interactive path: DSH steer is
      // unsupported, Codex keeps its existing seam.
      if (record.executor === "dsh") throw new CoreError("UNSUPPORTED_ACTION");
      const active = record.active;
      if (record.state !== "running" || !instruction?.trim() || !active?.steer) throw new CoreError("INVALID_STATE_TRANSITION");
      await active.steer(instruction);
    } else if (action === "interrupt") {
      const active = record.active;
      if (record.state !== "running" || !active?.interrupt) throw new CoreError("INVALID_STATE_TRANSITION");
      await active.interrupt();
    } else {
      throw new CoreError("INVALID_STATE_TRANSITION");
    }
    return this.taskView(taskId)!;
  }

  private readonly interactive = new Map<Id, InteractiveRecord>();
  private interactiveTerminalTaskIds: Id[] = [];

  private async executeInteractive(taskId: Id): Promise<void> {
    const record = this.interactive.get(taskId);
    if (!record) return;
    record.state = "running";
    this.observeState(taskId, record.request.executor, "running");
    try {
      const registration = this.registry.resolveExecution(record.request.workspace_id);
      const executor = this.executorFactory(record.request.executor, registration.root);
      record.executor = executor;
      const instruction = attachKnowledgePreflightReceipt(record.request.instruction, record.request.preflight_receipt, {
        workspaceId: record.request.workspace_id,
        workspaceRoot: registration.root,
        executor: record.request.executor
      });
      const result = await executor.execute({ taskId, instruction,
        sandbox: "read-only", threadId: record.threadId,
        ...(record.request.model === undefined ? {} : { model: record.request.model }),
        ...(record.request.web_research === true ? { webSearch: "live" as const } : {}),
        onEvidence: (items) => {
          record.evidence = items;
          this.observeEvidence(taskId, record.request.executor, items);
        } });
      record.executor = undefined;
      record.threadId = result.threadId ?? record.threadId;
      record.evidence = result.evidence ?? record.evidence;
      if (result.threadId !== undefined) {
        this.observeThread(taskId, record.request.executor, result.threadId);
      }
      if (result.evidence !== undefined) {
        this.observeEvidence(taskId, record.request.executor, result.evidence);
      }
      if (result.kind === "failed") { record.state = "failed"; record.error = result.error; }
      else if (result.kind === "interrupted") {
        // The failed terminal state and its safe error are unchanged; the
        // executor's genuine partial output is retained separately and never
        // treated as completed review output.
        record.partialOutput = result.output;
        record.output = undefined;
        record.state = "failed";
        record.error = interruptedError();
      } else {
        record.output = result.output;
        await this.recordExecutionReceipt(
          taskId,
          record.request,
          "run_task",
          "waiting_for_supervisor_review",
          registration.root
        );
        record.state = "waiting_for_supervisor_review";
      }
      this.observeState(taskId, record.request.executor, record.state);
      if (record.state === "failed") this.recordInteractiveTerminalTask(taskId);
    } catch (error) {
      record.executor = undefined;
      record.state = "failed";
      record.error = serializeError(error);
      this.observeState(taskId, record.request.executor, "failed");
      this.recordInteractiveTerminalTask(taskId);
    }
  }

  private async run(
    taskId: Id,
    request: NormalizedRegisteredWorkspaceTaskRequest,
    completedOutputTransform?: CompletedOutputTransform,
    terminalTaskHandler?: TerminalTaskHandler,
    receiptOperation?: ExecutionReceiptOperation
  ): Promise<void> {
    this.tasks.set(taskId, { state: "running", executor: request.executor });
    this.observeState(taskId, request.executor, "running");
    try {
      const workspaceRoot = this.registry.resolve(request.workspace_id);
      const executor = this.executorFactory(request.executor, workspaceRoot);
      // Temporarily retain the active executor on the running record so
      // control_task can reach the existing interrupt/steer seam; the terminal
      // record below replaces it once the run settles.
      this.tasks.set(taskId, { state: "running", executor: request.executor, active: executor });
      const instruction = attachKnowledgePreflightReceipt(request.instruction, request.preflight_receipt, {
        workspaceId: request.workspace_id,
        workspaceRoot,
        executor: request.executor
      });
      const result = await executor.execute(
        this.observer === undefined
          ? {
            taskId,
            instruction,
            ...(request.model === undefined ? {} : { model: request.model }),
            ...(request.web_research === true ? { webSearch: "live" as const } : {})
          }
          : {
            taskId,
            instruction,
            ...(request.model === undefined ? {} : { model: request.model }),
            ...(request.web_research === true ? { webSearch: "live" as const } : {}),
            onEvidence: (items) => this.observeEvidence(taskId, request.executor, items)
          }
      );
      if (result.threadId !== undefined) {
        this.observeThread(taskId, request.executor, result.threadId);
      }
      if (result.evidence !== undefined) {
        this.observeEvidence(taskId, request.executor, result.evidence);
      }
      const taskResult: RegisteredWorkspaceTaskResult = result.kind === "completed"
        ? {
          id: taskId,
          state: "completed",
          output: completedOutputTransform === undefined
            ? result.output
            : completedOutputTransform(result.output)
        }
        : result.kind === "failed"
          ? { id: taskId, state: "failed", error: result.error }
          : interruptedTaskResult(taskId, result.output);
      if (taskResult.state === "completed" && receiptOperation !== undefined) {
        await this.recordExecutionReceipt(
          taskId,
          request,
          receiptOperation,
          "completed",
          workspaceRoot
        );
      }
      await this.recordLegacyTerminalTask(taskId, taskResult, terminalTaskHandler);
    } catch (error) {
      const result: RegisteredWorkspaceTaskResult = {
        id: taskId,
        state: "failed",
        error: serializeError(error)
      };
      await this.recordLegacyTerminalTask(taskId, result);
    }
  }

  private async recordLegacyTerminalTask(
    taskId: Id,
    result: RegisteredWorkspaceTaskResult,
    terminalTaskHandler?: TerminalTaskHandler
  ): Promise<void> {
    await terminalTaskHandler?.(result);
    const executor = this.tasks.get(taskId)?.executor ?? "codex";
    this.tasks.set(taskId, { state: result.state, executor, result });
    this.observeState(taskId, executor, result.state);
    this.legacyTerminalTaskIds.push(taskId);
    this.trimLegacyTerminalTasks();
  }

  private recordInteractiveTerminalTask(taskId: Id): void {
    this.interactiveTerminalTaskIds.push(taskId);
    this.trimInteractiveTerminalTasks();
  }

  private observeState(
    taskId: Id,
    executor: ExecutorName | undefined,
    state: TaskObserverState,
  ): void {
    try {
      this.observer?.state(taskId, executor, state);
    } catch {
      // Observation is best effort and cannot affect task control.
    }
  }

  private observeThread(
    taskId: Id,
    executor: ExecutorName | undefined,
    threadId: string,
  ): void {
    try {
      this.observer?.thread(taskId, executor, threadId);
    } catch {
      // Observation is best effort and cannot affect task control.
    }
  }

  private observeEvidence(
    taskId: Id,
    executor: ExecutorName | undefined,
    evidence: readonly ExecutorEvidence[],
  ): void {
    try {
      this.observer?.evidence(taskId, executor, evidence);
    } catch {
      // Observation is best effort and cannot affect task control.
    }
  }

  private async recordExecutionReceipt(
    taskId: Id,
    request: NormalizedRegisteredWorkspaceTaskRequest,
    operation: ExecutionReceiptOperation,
    state: "waiting_for_supervisor_review" | "completed",
    knownWorkspaceRoot?: string
  ): Promise<void> {
    if (request.executor !== "codex" || this.executionReceipts === undefined) return;
    const workspaceRoot = knownWorkspaceRoot ?? this.registry.resolve(request.workspace_id);
    await this.executionReceipts.record({
      taskId,
      workspaceId: request.workspace_id,
      workspaceRoot,
      executor: "codex",
      operation,
      readOnly: true,
      state
    });
  }

  private trimLegacyTerminalTasks(): void {
    const terminalTaskIds = this.legacyTerminalTaskIds.filter((taskId) => {
      const task = this.tasks.get(taskId);
      return task?.state === "completed" || task?.state === "failed";
    });
    const unpinnedTaskIds = terminalTaskIds.filter((taskId) => !this.pinnedTaskIds.has(taskId));
    const evictedTaskIds = new Set(unpinnedTaskIds.slice(
      0,
      Math.max(0, unpinnedTaskIds.length - MAX_TERMINAL_TASK_HISTORY)
    ));
    for (const taskId of evictedTaskIds) this.tasks.delete(taskId);
    this.legacyTerminalTaskIds = terminalTaskIds.filter((taskId) => !evictedTaskIds.has(taskId));
  }

  private trimInteractiveTerminalTasks(): void {
    const terminalTaskIds = this.interactiveTerminalTaskIds.filter((taskId) => {
      const task = this.interactive.get(taskId);
      return task?.state === "completed" || task?.state === "failed";
    });
    const evictedTaskIds = new Set(terminalTaskIds.slice(
      0,
      Math.max(0, terminalTaskIds.length - MAX_TERMINAL_TASK_HISTORY)
    ));
    for (const taskId of evictedTaskIds) this.interactive.delete(taskId);
    this.interactiveTerminalTaskIds = terminalTaskIds.filter((taskId) => !evictedTaskIds.has(taskId));
  }
}
