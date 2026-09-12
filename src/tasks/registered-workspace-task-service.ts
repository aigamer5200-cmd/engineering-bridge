import { execFileSync } from "node:child_process";
import { isId, newId } from "../core/ids.js";
import { serializeError } from "../core/errors.js";
import type { Id } from "../core/ids.js";
import type { SerializedError } from "../core/errors.js";
import { CoreError } from "../core/errors.js";
import type { Executor, ExecutorDiagnostics, ExecutorEvidence, ReasoningEffort, SandboxMode, ServiceTier } from "../executors/executor.js";
import {
  alternateCodexAccount,
  inspectCodexAccountUsage,
  type CodexAccountUsageState,
  type CodexQuotaWindow
} from "../executors/codex-account-router.js";
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
  readonly reasoning?: ReasoningEffort;
  readonly reasoning_effort?: string;
  readonly service_tier?: ServiceTier;
  readonly account?: string;
  readonly web_research?: boolean;
  readonly sandbox?: SandboxMode;
  readonly preflight_receipt?: KnowledgePreflightReceipt;
}

type NormalizedRegisteredWorkspaceTaskRequest = RegisteredWorkspaceTaskRequest & { readonly executor: ExecutorName };

function normalizeTaskRequest(request: RegisteredWorkspaceTaskRequest): NormalizedRegisteredWorkspaceTaskRequest {
  const executor = request.executor ?? "codex";
  if (request.reasoning !== undefined && request.reasoning_effort !== undefined) {
    throw new CoreError("UNSUPPORTED_ACTION");
  }
  if (executor !== "codex" && (
    request.model !== undefined ||
    request.reasoning !== undefined ||
    request.reasoning_effort !== undefined ||
    request.service_tier !== undefined ||
    request.account !== undefined ||
    request.web_research === true ||
    (request.sandbox !== undefined && request.sandbox !== "read-only")
  )) {
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

export type ControlledPatchTaskRestore = {
  readonly result: RegisteredWorkspaceTaskResult;
  readonly pinned: boolean;
  readonly executor?: ExecutorName | undefined;
  readonly source?: "submitted" | undefined;
};

export type ExecutorFactory = (executor: ExecutorName, workspaceRoot: string) => Executor;
export type CompletedOutputTransform = (output: string) => string;

export type RegisteredWorkspaceTaskState = "queued" | "running" | "completed" | "failed";

export type ControlledTaskState = RegisteredWorkspaceTaskState | "waiting_for_supervisor_review";
export type ControlledTaskDiagnostics =
  | (ExecutorDiagnostics & {
    readonly finalization_started_at?: never;
    readonly finalization_ended_at?: never;
  })
  | {
    readonly finalization_started_at: string;
    readonly finalization_ended_at: string;
    readonly executor_started_at?: never;
    readonly executor_ended_at?: never;
  };

export interface FailoverContinuationReceipt {
  readonly original_task_id: Id;
  readonly checkpoint: "no_mutation_evidence" | "mutation_review_required" | "quota_preflight";
  readonly evidence_count: number;
  readonly mutation_evidence: boolean;
}

export interface FailoverProvenance {
  readonly attempted: boolean;
  readonly from_account?: string;
  readonly to_account?: string;
  readonly reason?: "ACCOUNT_5H_QUOTA_EXHAUSTED" | "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED";
  readonly quota_window?: CodexQuotaWindow;
  readonly reset_at?: string;
  readonly fallback_executor?: "dsh" | "ds";
  readonly retry_count: number;
  readonly continuation: FailoverContinuationReceipt;
  readonly owner_notice?: string;
}

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
  readonly model?: string | undefined;
  readonly reasoning?: ReasoningEffort | undefined;
  readonly reasoning_effort?: string | undefined;
  readonly service_tier?: ServiceTier | undefined;
  readonly account?: string | undefined;
  readonly requested_account?: string | undefined;
  readonly resolved_account?: string | undefined;
  readonly resolved_executor?: ExecutorName | undefined;
  readonly sandbox?: SandboxMode | undefined;
  readonly failover?: FailoverProvenance | undefined;
  // Present only for caller-submitted controlled patches: the proposal was
  // provided by the caller, not produced by an executor.
  readonly source?: "submitted" | undefined;
  readonly threadId?: string | undefined;
  readonly ready?: boolean;
  readonly output?: string | undefined;
  readonly review_output?: string | undefined;
  readonly partial_output?: string | undefined;
  readonly evidence?: readonly ExecutorEvidence[];
  readonly diagnostics?: ControlledTaskDiagnostics;
  readonly error?: SerializedError | undefined;
}

// While a legacy task is queued/running it temporarily retains its active
// executor so control_task can reach the existing interrupt/steer seam; the
// terminal record stores the result instead.
type TaskRecord =
  | { state: "queued" | "running"; executor: ExecutorName; active?: Executor }
  | { state: "completed" | "failed"; executor: ExecutorName | undefined; source?: "submitted"; result: RegisteredWorkspaceTaskResult; diagnostics?: ControlledTaskDiagnostics };

type NonTerminalTaskRecord = Extract<TaskRecord, { state: "queued" | "running" }>;

type InteractiveRecord = {
  state: ControlledTaskState; request: NormalizedRegisteredWorkspaceTaskRequest; evidence: readonly ExecutorEvidence[];
  executor?: Executor | undefined; threadId?: string | undefined; output?: string | undefined;
  partialOutput?: string | undefined; diagnostics?: ExecutorDiagnostics | undefined; error?: SerializedError | undefined;
  resolvedAccount?: string | undefined; resolvedExecutor?: ExecutorName | undefined;
  failover?: FailoverProvenance | undefined; executionInstruction?: string | undefined;
};

interface WorkspaceMutationCheckpoint {
  readonly head: string;
  readonly clean: boolean;
}

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

function quotaError(state: CodexAccountUsageState): SerializedError {
  return serializeError(new CoreError(state.quotaWindow === "weekly"
    ? "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED"
    : "ACCOUNT_5H_QUOTA_EXHAUSTED"));
}

function quotaReason(state: CodexAccountUsageState): "ACCOUNT_5H_QUOTA_EXHAUSTED" | "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED" {
  return state.quotaWindow === "weekly"
    ? "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED"
    : "ACCOUNT_5H_QUOTA_EXHAUSTED";
}

function hasMutationEvidence(evidence: readonly ExecutorEvidence[]): boolean {
  return evidence.some((item) => item.type === "fileChange" && item.status !== "failed");
}

function captureWorkspaceMutationCheckpoint(workspaceRoot: string): WorkspaceMutationCheckpoint | undefined {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    return head ? { head, clean: status.trim() === "" } : undefined;
  } catch {
    return undefined;
  }
}

function workspaceMutationIsSafe(
  before: WorkspaceMutationCheckpoint | undefined,
  after: WorkspaceMutationCheckpoint | undefined,
  sandbox: SandboxMode
): boolean {
  if (sandbox === "read-only") return true;
  return before !== undefined && after !== undefined &&
    before.clean && after.clean && before.head === after.head;
}

function continuationReceipt(
  taskId: Id,
  checkpoint: FailoverContinuationReceipt["checkpoint"],
  evidence: readonly ExecutorEvidence[],
  mutationDetected = hasMutationEvidence(evidence)
): FailoverContinuationReceipt {
  return {
    original_task_id: taskId,
    checkpoint,
    evidence_count: evidence.length,
    mutation_evidence: mutationDetected
  };
}

function failoverInstruction(
  originalInstruction: string,
  taskId: Id,
  fromAccount: string,
  toAccount: string | undefined,
  reason: NonNullable<FailoverProvenance["reason"]>,
  evidence: readonly ExecutorEvidence[],
  fallbackExecutor?: "dsh" | "ds",
  mutationDetected = hasMutationEvidence(evidence)
): string {
  const receipt = continuationReceipt(
    taskId,
    mutationDetected ? "mutation_review_required" : "no_mutation_evidence",
    evidence,
    mutationDetected
  );
  const lines = [
    "Bridge Failover Continuation Receipt",
    `original_task_id: ${taskId}`,
    `from_account: ${fromAccount}`,
    ...(toAccount === undefined ? [] : [`to_account: ${toAccount}`]),
    `reason: ${reason}`,
    ...(fallbackExecutor === undefined ? [] : [`fallback_executor: ${fallbackExecutor}`]),
    `checkpoint: ${receipt.checkpoint}`,
    `evidence_count: ${receipt.evidence_count}`,
    `mutation_evidence: ${receipt.mutation_evidence}`,
    "Native Codex thread/session state is account-bound and must not be resumed across accounts.",
    "Continue from the current repository state. Do not repeat already-completed mutation. Inspect current state before any new mutation.",
    "End Bridge Failover Continuation Receipt",
    "",
    "Original task instruction:",
    originalInstruction
  ];
  return lines.join("\n");
}

function ownerFailoverNotice(
  fromAccount: string,
  toAccount: string,
  state: CodexAccountUsageState,
  request: NormalizedRegisteredWorkspaceTaskRequest
): string {
  const windowLabel = state.quotaWindow === "weekly" ? "週額度" : "5 小時額度";
  const profile = [request.model, request.reasoning ?? request.reasoning_effort, request.service_tier]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" / ");
  const reset = ownerResetTime(state.resetAt);
  return `Account ${fromAccount} ${windowLabel}已耗盡${reset ? `（重置：${reset} Asia/Taipei）` : ""}，任務已自動切換至 Account ${toAccount}${profile ? `，維持 ${profile}` : ""} 接續執行。`;
}

function ownerDsHandoffNotice(
  first: CodexAccountUsageState,
  second: CodexAccountUsageState
): string {
  const firstReset = ownerResetTime(first.resetAt) ?? "unknown";
  const secondReset = ownerResetTime(second.resetAt) ?? "unknown";
  return `Codex A/B 帳號目前皆無可用額度，已建立 durable DS handoff，交由 DS 接續。${first.account} reset：${firstReset}；${second.account} reset：${secondReset}。`;
}

function ownerResetTime(resetAt: string | undefined): string | undefined {
  if (resetAt === undefined) return undefined;
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

export class RegisteredWorkspaceTaskService {
  private readonly tasks = new Map<Id, TaskRecord>();
  private readonly pinnedTaskIds = new Set<Id>();
  private legacyTerminalTaskIds: Id[] = [];

  constructor(
    private readonly registry: RegisteredWorkspaceRegistry,
    private readonly executorFactory: ExecutorFactory,
    private readonly executionReceipts?: ExecutionReceiptStore,
    private readonly observer?: TaskObserver,
    private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
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

  restoreControlledPatchTasks(restorations: readonly ControlledPatchTaskRestore[]): void {
    if (restorations.length === 0) return;
    const batchTaskIds = new Set<Id>();
    for (const { result } of restorations) {
      if (batchTaskIds.has(result.id) || this.tasks.has(result.id) || this.interactive.has(result.id)) {
        throw new CoreError("INTERNAL_ERROR");
      }
      batchTaskIds.add(result.id);
    }

    for (const { result, pinned, executor, source } of restorations) {
      const restoredExecutor = source === "submitted" ? undefined : executor ?? "codex";
      const record: TaskRecord = result.state === "completed"
        ? {
          state: "completed",
          executor: restoredExecutor,
          ...(source === undefined ? {} : { source }),
          result
        }
        : {
          state: "failed",
          executor: restoredExecutor,
          ...(source === undefined ? {} : { source }),
          result
        };
      this.tasks.set(result.id, record);
      this.legacyTerminalTaskIds.push(result.id);
      if (pinned) this.pinnedTaskIds.add(result.id);
    }
    this.trimLegacyTerminalTasks();
  }

  restoreControlledPatchTask(taskId: Id, output: string, pinned: boolean, executor: ExecutorName | undefined = "codex", source?: "submitted"): void {
    this.restoreControlledPatchTasks([{
      result: { id: taskId, state: "completed", output },
      pinned,
      executor,
      source
    }]);
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
        ...(legacy.diagnostics === undefined ? {} : { diagnostics: legacy.diagnostics }),
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
      ...(record.resolvedExecutor === undefined || record.resolvedExecutor === record.request.executor
        ? {}
        : { resolved_executor: record.resolvedExecutor }),
      ...(record.request.model === undefined ? {} : { model: record.request.model }),
      ...(record.request.reasoning === undefined ? {} : { reasoning: record.request.reasoning }),
      ...(record.request.reasoning_effort === undefined ? {} : { reasoning_effort: record.request.reasoning_effort }),
      ...(record.request.service_tier === undefined ? {} : { service_tier: record.request.service_tier }),
      ...(record.resolvedExecutor === "dsh" || record.failover?.fallback_executor === "ds"
        ? {}
        : record.resolvedAccount === undefined && record.request.account === undefined
        ? {}
        : { account: record.resolvedAccount ?? record.request.account }),
      ...(record.failover === undefined || record.request.account === undefined
        ? {}
        : { requested_account: record.request.account }),
      ...(record.failover === undefined || record.resolvedAccount === undefined
        ? {}
        : { resolved_account: record.resolvedAccount }),
      ...(record.request.sandbox === undefined ? {} : { sandbox: record.request.sandbox }),
      ...(record.failover === undefined ? {} : { failover: record.failover }),
      evidence: record.evidence,
      ...(record.threadId === undefined ? {} : { threadId: record.threadId }),
      ...(record.diagnostics === undefined ? {} : { diagnostics: record.diagnostics })
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
      await this.recordExecutionReceipt(taskId, record.request, "run_task", "completed", undefined, record);
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
      record.diagnostics = undefined;
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

  private failInteractive(taskId: Id, record: InteractiveRecord, error: SerializedError): void {
    record.executor = undefined;
    record.state = "failed";
    record.error = error;
    this.observeState(taskId, record.resolvedExecutor ?? record.request.executor, "failed");
    this.recordInteractiveTerminalTask(taskId);
  }

  private routeAfterQuota(
    taskId: Id,
    record: InteractiveRecord,
    currentAccount: string,
    currentState: CodexAccountUsageState,
    evidence: readonly ExecutorEvidence[],
    checkpoint: "quota_preflight" | "runtime_failure",
    workspaceMutationSafe = true
  ): "retry" | "terminal" | "ds_handoff" {
    const alternate = alternateCodexAccount(currentAccount, this.hostEnvironment);
    if (alternate === undefined) {
      this.failInteractive(taskId, record, quotaError(currentState));
      return "terminal";
    }
    const alternateState = inspectCodexAccountUsage(alternate, this.hostEnvironment, { forceRefresh: true });
    const priorRetryCount = record.failover?.retry_count ?? 0;

    if (alternateState.availability === "quota_exhausted") {
      if (checkpoint === "runtime_failure" && (!workspaceMutationSafe || hasMutationEvidence(evidence))) {
        record.failover = {
          attempted: false,
          from_account: currentAccount,
          reason: quotaReason(currentState),
          quota_window: currentState.quotaWindow ?? "5h",
          ...(currentState.resetAt === undefined ? {} : { reset_at: currentState.resetAt }),
          fallback_executor: "ds",
          retry_count: priorRetryCount,
          continuation: continuationReceipt(taskId, "mutation_review_required", evidence, true),
          owner_notice: `Codex A/B 帳號皆已耗盡，但先前已有 mutation evidence；已停止自動接續，等待 DS / supervisor 先核對 Repo checkpoint。`
        };
        this.observeFailover(taskId, record.failover);
        this.failInteractive(taskId, record, serializeError(new CoreError("FAILOVER_REVIEW_REQUIRED")));
        return "terminal";
      }

      record.resolvedExecutor = "codex";
      record.resolvedAccount = undefined;
      record.threadId = undefined;
      record.executionInstruction = failoverInstruction(
        record.request.instruction,
        taskId,
        currentAccount,
        undefined,
        quotaReason(currentState),
        evidence,
        "ds"
      );
      record.failover = {
        attempted: true,
        from_account: currentAccount,
        reason: quotaReason(currentState),
        quota_window: currentState.quotaWindow ?? "5h",
        ...(currentState.resetAt === undefined ? {} : { reset_at: currentState.resetAt }),
        fallback_executor: "ds",
        retry_count: priorRetryCount,
        continuation: continuationReceipt(
          taskId,
          checkpoint === "quota_preflight" ? "quota_preflight" : "no_mutation_evidence",
          evidence
        ),
        owner_notice: ownerDsHandoffNotice(currentState, alternateState)
      };
      this.observeFailover(taskId, record.failover);
      return "ds_handoff";
    }

    if (alternateState.availability !== "available") {
      this.failInteractive(taskId, record, quotaError(currentState));
      return "terminal";
    }

    // One account failover cycle per Bridge task. A replacement account that
    // later exhausts quota must never bounce back A -> B -> A -> ... .
    if (priorRetryCount >= 1) {
      this.failInteractive(taskId, record, quotaError(currentState));
      return "terminal";
    }

    if (checkpoint === "runtime_failure" && (!workspaceMutationSafe || hasMutationEvidence(evidence))) {
      record.failover = {
        attempted: false,
        from_account: currentAccount,
        to_account: alternate,
        reason: quotaReason(currentState),
        quota_window: currentState.quotaWindow ?? "5h",
        ...(currentState.resetAt === undefined ? {} : { reset_at: currentState.resetAt }),
        retry_count: 0,
        continuation: continuationReceipt(taskId, "mutation_review_required", evidence, true),
        owner_notice: `Account ${currentAccount} 額度耗盡，但先前已出現 mutation evidence；為避免重複寫入，已停止自動重跑並等待 supervisor review。`
      };
      this.observeFailover(taskId, record.failover);
      this.failInteractive(taskId, record, serializeError(new CoreError("FAILOVER_REVIEW_REQUIRED")));
      return "terminal";
    }

    record.resolvedExecutor = "codex";
    record.resolvedAccount = alternate;
    record.threadId = undefined;
    record.executionInstruction = checkpoint === "quota_preflight"
      ? record.request.instruction
      : failoverInstruction(
        record.request.instruction,
        taskId,
        currentAccount,
        alternate,
        quotaReason(currentState)!,
        evidence
      );
    record.failover = {
      attempted: true,
      from_account: currentAccount,
      to_account: alternate,
      reason: quotaReason(currentState),
      quota_window: currentState.quotaWindow ?? "5h",
      ...(currentState.resetAt === undefined ? {} : { reset_at: currentState.resetAt }),
      retry_count: priorRetryCount + 1,
      continuation: continuationReceipt(
        taskId,
        checkpoint === "quota_preflight" ? "quota_preflight" : "no_mutation_evidence",
        evidence
      ),
      owner_notice: ownerFailoverNotice(currentAccount, alternate, currentState, record.request)
    };
    this.observeFailover(taskId, record.failover);
    return "retry";
  }

  private prepareInitialInteractiveRouting(
    taskId: Id,
    record: InteractiveRecord
  ): "ready" | "terminal" | "ds_handoff" {
    record.resolvedExecutor ??= record.request.executor;
    if (record.request.executor !== "codex" || record.request.account === undefined) return "ready";
    if (record.resolvedAccount !== undefined || record.failover !== undefined) return "ready";
    const state = inspectCodexAccountUsage(record.request.account, this.hostEnvironment);
    if (state.availability !== "quota_exhausted") {
      record.resolvedAccount = record.request.account;
      return "ready";
    }
    const route = this.routeAfterQuota(taskId, record, record.request.account, state, [], "quota_preflight");
    return route === "retry" ? "ready" : route;
  }

  private async executeInteractive(taskId: Id): Promise<void> {
    const record = this.interactive.get(taskId);
    if (!record) return;
    record.state = "running";
    this.observeState(taskId, record.request.executor, "running");
    try {
      const registration = this.registry.resolveExecution(record.request.workspace_id);
      const initialRoute = this.prepareInitialInteractiveRouting(taskId, record);
      if (initialRoute === "terminal") return;
      if (initialRoute === "ds_handoff") {
        await this.recordExecutionReceipt(
          taskId,
          record.request,
          "run_task",
          "handoff_required",
          registration.root,
          record
        );
        this.failInteractive(
          taskId,
          record,
          serializeError(new CoreError("BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED"))
        );
        return;
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const resolvedExecutor = record.resolvedExecutor ?? record.request.executor;
        const resolvedAccount = record.resolvedAccount ?? record.request.account;
        const executor = this.executorFactory(resolvedExecutor, registration.root);
        record.executor = executor;
        const effectiveSandbox = resolvedExecutor === "dsh" ? "read-only" : record.request.sandbox ?? "read-only";
        const mutationBefore = captureWorkspaceMutationCheckpoint(registration.root);
        const instruction = attachKnowledgePreflightReceipt(
          record.executionInstruction ?? record.request.instruction,
          record.request.preflight_receipt,
          {
            workspaceId: record.request.workspace_id,
            workspaceRoot: registration.root,
            executor: resolvedExecutor,
            sandbox: effectiveSandbox
          }
        );
        const result = await executor.execute({
          taskId,
          instruction,
          sandbox: effectiveSandbox,
          ...(resolvedExecutor === "codex" && record.threadId !== undefined ? { threadId: record.threadId } : {}),
          ...(resolvedExecutor === "codex" && record.request.model !== undefined ? { model: record.request.model } : {}),
          ...(resolvedExecutor === "codex" && record.request.reasoning !== undefined ? { reasoning: record.request.reasoning } : {}),
          ...(resolvedExecutor === "codex" && record.request.reasoning_effort !== undefined ? { reasoning_effort: record.request.reasoning_effort } : {}),
          ...(resolvedExecutor === "codex" && record.request.service_tier !== undefined ? { service_tier: record.request.service_tier } : {}),
          ...(resolvedExecutor === "codex" && resolvedAccount !== undefined ? { account: resolvedAccount } : {}),
          ...(resolvedExecutor === "codex" && record.request.web_research === true ? { webSearch: "live" as const } : {}),
          onEvidence: (items) => {
            record.evidence = items;
            this.observeEvidence(taskId, resolvedExecutor, items);
          }
        });
        record.executor = undefined;
        if (resolvedExecutor === "codex") {
          record.threadId = result.threadId ?? record.threadId;
        }
        record.evidence = result.evidence ?? record.evidence;
        if (result.threadId !== undefined) {
          this.observeThread(taskId, resolvedExecutor, result.threadId);
        }
        if (result.evidence !== undefined) {
          this.observeEvidence(taskId, resolvedExecutor, result.evidence);
        }

        if (result.kind === "failed") {
          if (resolvedExecutor === "codex" && resolvedAccount !== undefined &&
              result.error.code !== "CODEX_PROTOCOL_ERROR" &&
              result.error.code !== "MODEL_CAPACITY" &&
              result.error.code !== "ACCOUNT_AUTH_INVALID" &&
              result.error.code !== "ACCOUNT_PROFILE_UNAVAILABLE" &&
              result.error.code !== "PROCESS_SPAWN_FAILURE" &&
              result.error.code !== "NETWORK_RPC_FAILURE") {
            const usage = inspectCodexAccountUsage(resolvedAccount, this.hostEnvironment, { forceRefresh: true });
            if (usage.availability === "quota_exhausted") {
              const mutationAfter = captureWorkspaceMutationCheckpoint(registration.root);
              const routed = this.routeAfterQuota(
                taskId,
                record,
                resolvedAccount,
                usage,
                result.evidence ?? record.evidence,
                "runtime_failure",
                workspaceMutationIsSafe(mutationBefore, mutationAfter, effectiveSandbox)
              );
              if (routed === "retry") continue;
              if (routed === "ds_handoff") {
                await this.recordExecutionReceipt(
                  taskId,
                  record.request,
                  "run_task",
                  "handoff_required",
                  registration.root,
                  record
                );
                this.failInteractive(
                  taskId,
                  record,
                  serializeError(new CoreError("BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED"))
                );
              }
              return;
            }
          }

          record.state = "failed";
          record.error = result.error;
          if (result.error.code === "CODEX_PROTOCOL_ERROR" && result.diagnostics?.protocol !== undefined) {
            record.diagnostics = result.diagnostics;
          }
          this.observeState(taskId, resolvedExecutor, "failed");
          this.recordInteractiveTerminalTask(taskId);
          return;
        }

        if (result.kind === "interrupted") {
          record.partialOutput = result.output;
          record.output = undefined;
          record.state = "failed";
          record.error = interruptedError();
          this.observeState(taskId, resolvedExecutor, "failed");
          this.recordInteractiveTerminalTask(taskId);
          return;
        }

        record.diagnostics = result.diagnostics;
        record.output = result.output;
        await this.recordExecutionReceipt(
          taskId,
          record.request,
          "run_task",
          "waiting_for_supervisor_review",
          registration.root,
          record
        );
        record.state = "waiting_for_supervisor_review";
        this.observeState(taskId, resolvedExecutor, record.state);
        return;
      }

      this.failInteractive(taskId, record, serializeError(new CoreError("UNKNOWN_EXECUTOR_FAILURE")));
    } catch (error) {
      this.failInteractive(taskId, record, serializeError(error));
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
        executor: request.executor,
        sandbox: request.sandbox ?? "read-only"
      });
      const result = await executor.execute(
        this.observer === undefined
          ? {
            taskId,
            instruction,
            ...(request.sandbox === undefined ? {} : { sandbox: request.sandbox }),
            ...(request.model !== undefined ? { model: request.model } : {}),
            ...(request.reasoning !== undefined ? { reasoning: request.reasoning } : {}),
            ...(request.reasoning_effort !== undefined ? { reasoning_effort: request.reasoning_effort } : {}),
            ...(request.service_tier !== undefined ? { service_tier: request.service_tier } : {}),
            ...(request.account !== undefined ? { account: request.account } : {}),
            ...(request.web_research === true ? { webSearch: "live" as const } : {})
          }
          : {
            taskId,
            instruction,
            ...(request.sandbox === undefined ? {} : { sandbox: request.sandbox }),
            ...(request.model !== undefined ? { model: request.model } : {}),
            ...(request.reasoning !== undefined ? { reasoning: request.reasoning } : {}),
            ...(request.reasoning_effort !== undefined ? { reasoning_effort: request.reasoning_effort } : {}),
            ...(request.service_tier !== undefined ? { service_tier: request.service_tier } : {}),
            ...(request.account !== undefined ? { account: request.account } : {}),
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
        await this.recordExecutionReceipt(taskId, request, receiptOperation, "completed", workspaceRoot);
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
    const finalizationStartedAt = new Date().toISOString();
    let terminalResult: RegisteredWorkspaceTaskResult = result;
    try {
      await terminalTaskHandler?.(result);
    } catch {
      terminalResult = {
        id: taskId,
        state: "failed",
        error: serializeError(new CoreError("INTERNAL_ERROR"))
      };
    }
    const diagnostics: ControlledTaskDiagnostics = {
      finalization_started_at: finalizationStartedAt,
      finalization_ended_at: new Date().toISOString()
    };
    const executor = this.tasks.get(taskId)?.executor ?? "codex";
    this.tasks.set(taskId, { state: terminalResult.state, executor, result: terminalResult, diagnostics });
    this.observeState(taskId, executor, terminalResult.state);
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

  private observeFailover(taskId: Id, failover: FailoverProvenance): void {
    try {
      this.observer?.failover?.(taskId, {
        attempted: failover.attempted,
        ...(failover.from_account === undefined ? {} : { fromAccount: failover.from_account }),
        ...(failover.to_account === undefined ? {} : { toAccount: failover.to_account }),
        ...(failover.reason === undefined ? {} : { reason: failover.reason }),
        ...(failover.quota_window === undefined ? {} : { quotaWindow: failover.quota_window }),
        ...(failover.reset_at === undefined ? {} : { resetAt: failover.reset_at }),
        ...(failover.fallback_executor === undefined ? {} : { fallbackExecutor: failover.fallback_executor }),
        retryCount: failover.retry_count
      });
    } catch {
      // Observation is best effort and cannot affect task control.
    }
  }

  private async recordExecutionReceipt(
    taskId: Id,
    request: NormalizedRegisteredWorkspaceTaskRequest,
    operation: ExecutionReceiptOperation,
    state: "waiting_for_supervisor_review" | "completed" | "handoff_required",
    knownWorkspaceRoot?: string,
    interactiveRecord?: InteractiveRecord
  ): Promise<void> {
    if (request.executor !== "codex" || this.executionReceipts === undefined) return;
    const workspaceRoot = knownWorkspaceRoot ?? this.registry.resolve(request.workspace_id);
    const reasoning = receiptReasoning(request);
    const sandbox = request.sandbox ?? "read-only";
    await this.executionReceipts.record({
      taskId,
      workspaceId: request.workspace_id,
      workspaceRoot,
      executor: "codex",
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(request.service_tier === undefined ? {} : { serviceTier: request.service_tier }),
      ...(request.account === undefined ? {} : { account: request.account }),
      ...(interactiveRecord?.failover === undefined || request.account === undefined
        ? {}
        : { requestedAccount: request.account }),
      ...(interactiveRecord?.failover === undefined || interactiveRecord.resolvedExecutor === "dsh" ||
          interactiveRecord.failover.fallback_executor === "ds" ||
          (interactiveRecord.resolvedAccount ?? request.account) === undefined
        ? {}
        : { resolvedAccount: interactiveRecord?.resolvedAccount ?? request.account }),
      ...(interactiveRecord?.failover === undefined || interactiveRecord.resolvedExecutor === undefined ||
          interactiveRecord.resolvedExecutor === request.executor
        ? {}
        : { resolvedExecutor: interactiveRecord.resolvedExecutor }),
      ...(interactiveRecord?.failover === undefined ? {} : {
        failover: {
          attempted: interactiveRecord.failover.attempted,
          ...(interactiveRecord.failover.from_account === undefined
            ? {}
            : { fromAccount: interactiveRecord.failover.from_account }),
          ...(interactiveRecord.failover.to_account === undefined
            ? {}
            : { toAccount: interactiveRecord.failover.to_account }),
          ...(interactiveRecord.failover.reason === undefined
            ? {}
            : { reason: interactiveRecord.failover.reason }),
          ...(interactiveRecord.failover.quota_window === undefined
            ? {}
            : { quotaWindow: interactiveRecord.failover.quota_window }),
          ...(interactiveRecord.failover.reset_at === undefined
            ? {}
            : { resetAt: interactiveRecord.failover.reset_at }),
          ...(interactiveRecord.failover.fallback_executor === undefined
            ? {}
            : { fallbackExecutor: interactiveRecord.failover.fallback_executor }),
          retryCount: interactiveRecord.failover.retry_count,
          checkpoint: interactiveRecord.failover.continuation.checkpoint,
          evidenceCount: interactiveRecord.failover.continuation.evidence_count,
          mutationEvidence: interactiveRecord.failover.continuation.mutation_evidence,
          ...(interactiveRecord.failover.owner_notice === undefined
            ? {}
            : { ownerNotice: interactiveRecord.failover.owner_notice })
        }
      }),
      operation,
      sandbox,
      readOnly: sandbox === "read-only",
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

function receiptReasoning(request: RegisteredWorkspaceTaskRequest): ReasoningEffort | undefined {
  const value = request.reasoning ?? request.reasoning_effort;
  return value === "low" || value === "medium" || value === "high" ||
    value === "xhigh" || value === "max" || value === "ultra"
    ? value
    : undefined;
}
