import { CoreError, serializeError, type SerializedError } from "../core/errors.js";
import { isId, newId, type Id } from "../core/ids.js";
import { CodexExecutor, DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING } from "../executors/codex-executor.js";
import type { Executor, ExecutorDiagnostics, ExecutorEvidence, ExecutorResult, ReasoningEffort } from "../executors/executor.js";
import { RegisteredWorkspaceRegistry } from "../workspaces/registered-workspace-registry.js";

const MAX_TERMINAL_TASK_HISTORY = 100;

export interface ThinCodexTaskRequest {
  readonly workspace_id: string;
  readonly instruction: string;
  readonly model?: string;
  readonly reasoning?: ReasoningEffort;
}

export type ThinCodexTaskState = "running" | "completed" | "failed";

export interface ThinCodexTaskView {
  readonly taskId: Id;
  readonly state: ThinCodexTaskState;
  readonly model: string;
  readonly reasoning: string;
  readonly threadId?: string;
  readonly output?: string;
  readonly error?: SerializedError;
  readonly partialOutput?: string;
  readonly evidence: readonly ExecutorEvidence[];
  readonly diagnostics?: ExecutorDiagnostics;
}

export type ThinCodexExecutorFactory = (workspaceRoot: string) => Executor;

type ThinCodexTaskRecord = {
  state: ThinCodexTaskState;
  instruction: string;
  model: string;
  reasoning: ReasoningEffort;
  executor: Executor;
  threadId?: string | undefined;
  output?: string;
  error?: SerializedError;
  partialOutput?: string;
  evidence: readonly ExecutorEvidence[];
  diagnostics?: ExecutorDiagnostics | undefined;
};

export class ThinCodexTaskService {
  private readonly tasks = new Map<Id, ThinCodexTaskRecord>();
  private readonly terminalTaskIds: Id[] = [];

  constructor(
    private readonly registry: RegisteredWorkspaceRegistry,
    private readonly executorFactory: ThinCodexExecutorFactory = (workspaceRoot) => new CodexExecutor(workspaceRoot)
  ) {}

  startTask(request: ThinCodexTaskRequest): { taskId: Id } {
    const workspaceRoot = this.registry.resolve(request.workspace_id);
    const taskId = newId();
    const record: ThinCodexTaskRecord = {
      state: "running",
      instruction: request.instruction,
      model: request.model ?? DEFAULT_CODEX_MODEL,
      reasoning: request.reasoning ?? DEFAULT_CODEX_REASONING,
      executor: this.executorFactory(workspaceRoot),
      evidence: []
    };
    this.tasks.set(taskId, record);
    queueMicrotask(() => void this.execute(taskId, record));
    return { taskId };
  }

  taskView(taskId: unknown): ThinCodexTaskView | undefined {
    if (!isId(taskId)) return undefined;
    const record = this.tasks.get(taskId);
    if (record === undefined) return undefined;
    return {
      taskId,
      state: record.state,
      model: record.model,
      reasoning: record.reasoning,
      ...(record.threadId === undefined ? {} : { threadId: record.threadId }),
      ...(record.output === undefined ? {} : { output: record.output }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(record.partialOutput === undefined ? {} : { partialOutput: record.partialOutput }),
      evidence: record.evidence,
      ...(record.diagnostics === undefined ? {} : { diagnostics: record.diagnostics })
    };
  }

  async controlTask(taskId: unknown, action: "interrupt"): Promise<ThinCodexTaskView> {
    if (action !== "interrupt" || !isId(taskId)) throw new CoreError("INVALID_STATE_TRANSITION");
    const record = this.tasks.get(taskId);
    if (record === undefined || record.state !== "running" || record.executor.interrupt === undefined) {
      throw new CoreError("INVALID_STATE_TRANSITION");
    }
    await record.executor.interrupt();
    return this.taskView(taskId)!;
  }

  private async execute(taskId: Id, record: ThinCodexTaskRecord): Promise<void> {
    try {
      const result = await record.executor.execute({
        taskId,
        instruction: record.instruction,
        model: record.model,
        reasoning: record.reasoning,
        onEvidence: (evidence) => { record.evidence = evidence; }
      });
      record.threadId = result.threadId;
      record.diagnostics = result.diagnostics;
      if (result.evidence !== undefined) record.evidence = result.evidence;
      if (result.kind === "completed") {
        record.state = "completed";
        record.output = result.output;
      } else if (result.kind === "failed") {
        record.state = "failed";
        record.error = result.error;
      } else {
        record.state = "failed";
        record.error = serializeError(new CoreError("TASK_INTERRUPTED"));
        if (result.output !== "") record.partialOutput = result.output;
      }
    } catch (error) {
      record.state = "failed";
      record.error = serializeError(error);
    } finally {
      if (record.state !== "running") {
        this.terminalTaskIds.push(taskId);
        this.trimTerminalTasks();
      }
    }
  }

  private trimTerminalTasks(): void {
    while (this.terminalTaskIds.length > MAX_TERMINAL_TASK_HISTORY) {
      const taskId = this.terminalTaskIds.shift();
      if (taskId !== undefined) this.tasks.delete(taskId);
    }
  }
}
