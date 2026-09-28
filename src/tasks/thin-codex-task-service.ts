import { isId, newId, type Id } from "../core/ids.js";
import { CodexAppServerTransport } from "../transport/codex-app-server.js";
import type { CodexTaskExecutor } from "../transport/codex-app-server.js";

const MAX_TERMINAL_TASK_HISTORY = 100;

export interface ThinCodexTaskRequest {
  readonly workspace_id: string;
  readonly instruction: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly service_tier?: string;
}

export type ThinCodexTaskState = "running" | "completed" | "failed";

export interface ThinCodexTaskView {
  readonly taskId: Id;
  readonly state: ThinCodexTaskState;
  readonly model?: string;
  readonly reasoning?: string;
  readonly service_tier?: string;
  readonly threadId?: string;
  readonly output?: string;
  readonly error?: string;
  readonly partialOutput?: string;
}

export type ThinCodexExecutorFactory = (workspaceRoot: string) => CodexTaskExecutor;

type ThinCodexTaskRecord = {
  state: ThinCodexTaskState;
  instruction: string;
  executor: CodexTaskExecutor;
  model?: string;
  reasoning?: string;
  service_tier?: string;
  threadId?: string;
  output?: string;
  error?: string;
  partialOutput?: string;
};

export interface WorkspaceResolver {
  resolve(workspaceId: string): string;
}

export class ThinCodexTaskService {
  private readonly tasks = new Map<Id, ThinCodexTaskRecord>();
  private readonly terminalTaskIds: Id[] = [];

  constructor(
    private readonly workspaces: WorkspaceResolver,
    private readonly executorFactory: ThinCodexExecutorFactory = (workspaceRoot) => new CodexAppServerTransport(workspaceRoot)
  ) {}

  startTask(request: ThinCodexTaskRequest): { taskId: Id } {
    const workspaceRoot = this.workspaces.resolve(request.workspace_id);
    const taskId = newId();
    const record: ThinCodexTaskRecord = {
      state: "running",
      instruction: request.instruction,
      executor: this.executorFactory(workspaceRoot),
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
      ...(request.service_tier === undefined ? {} : { service_tier: request.service_tier })
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
      ...(record.model === undefined ? {} : { model: record.model }),
      ...(record.reasoning === undefined ? {} : { reasoning: record.reasoning }),
      ...(record.service_tier === undefined ? {} : { service_tier: record.service_tier }),
      ...(record.threadId === undefined ? {} : { threadId: record.threadId }),
      ...(record.output === undefined ? {} : { output: record.output }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(record.partialOutput === undefined ? {} : { partialOutput: record.partialOutput })
    };
  }

  async controlTask(taskId: unknown, action: "interrupt"): Promise<ThinCodexTaskView> {
    if (action !== "interrupt" || !isId(taskId)) throw new Error("Task cannot be interrupted.");
    const record = this.tasks.get(taskId);
    if (record === undefined || record.state !== "running") throw new Error("Task cannot be interrupted.");
    await record.executor.interrupt();
    const view = this.taskView(taskId);
    if (view === undefined) throw new Error("Task was not found.");
    return view;
  }

  private async execute(taskId: Id, record: ThinCodexTaskRecord): Promise<void> {
    try {
      const result = await record.executor.execute({
        instruction: record.instruction,
        ...(record.model === undefined ? {} : { model: record.model }),
        ...(record.reasoning === undefined ? {} : { reasoning: record.reasoning }),
        ...(record.service_tier === undefined ? {} : { service_tier: record.service_tier })
      });
      if (result.threadId !== undefined) record.threadId = result.threadId;
      if (result.kind === "completed") {
        record.state = "completed";
        record.output = result.output;
      } else if (result.kind === "interrupted") {
        record.state = "failed";
        record.error = "Task was interrupted.";
        if (result.output !== "") record.partialOutput = result.output;
      } else {
        record.state = "failed";
        record.error = result.error;
        if (result.output !== undefined && result.output !== "") record.partialOutput = result.output;
      }
    } catch (error) {
      record.state = "failed";
      record.error = error instanceof Error ? error.message : "Codex task failed.";
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
