import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GuardProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GuardProcessRunner = (
  executable: string,
  args: readonly string[]
) => Promise<GuardProcessResult>;

export interface DevelopmentExecutionGuardClientOptions {
  readonly enabled: boolean;
  readonly python: string;
  readonly script: string;
  readonly runtimeRoot?: string | undefined;
  readonly leaseSeconds: number;
  readonly terminalGraceSeconds: number;
  readonly heartbeatIntervalMs: number;
}

export interface GuardHeartbeatInput {
  readonly workspaceRoot: string;
  readonly source: string;
  readonly activity: string;
  readonly taskId?: string | undefined;
  readonly leaseSeconds?: number | undefined;
}

export interface GuardStopInput {
  readonly workspaceRoot: string;
  readonly eventId: string;
  readonly kind: "completed" | "interrupted" | "blocked" | "waiting" | "paused";
  readonly reasonZh: string;
}

export interface GuardCommandReceipt {
  readonly ok: boolean;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
}

export function isGoalDelegatedGuardReceipt(
  receipt: GuardCommandReceipt | undefined
): boolean {
  const result = receipt?.payload?.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return (result as Readonly<Record<string, unknown>>).state === "goal_delegated";
}

const defaultRunner: GuardProcessRunner = async (executable, args) => {
  try {
    const result = await execFileAsync(executable, [...args], {
      windowsHide: true,
      timeout: 15_000,
      encoding: "utf8"
    });
    return {
      exitCode: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  } catch (error) {
    const value = error as NodeJS.ErrnoException & {
      readonly code?: string | number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      exitCode: typeof value.code === "number" ? value.code : 1,
      stdout: value.stdout ?? "",
      stderr: value.stderr ?? String(value.message ?? error)
    };
  }
};

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function parsePayload(raw: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : undefined;
  } catch {
    return undefined;
  }
}

export class DevelopmentExecutionGuardClient {
  constructor(
    readonly options: DevelopmentExecutionGuardClientOptions,
    private readonly runner: GuardProcessRunner = defaultRunner
  ) {}

  static fromEnvironment(
    env: Readonly<NodeJS.ProcessEnv> = process.env,
    runner?: GuardProcessRunner
  ): DevelopmentExecutionGuardClient {
    const options: DevelopmentExecutionGuardClientOptions = {
      enabled: parseBoolean(env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD),
      python: env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_PYTHON ??
        String.raw`D:\shoestring-goal\.venv\Scripts\python.exe`,
      script: env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_SCRIPT ??
        String.raw`D:\shoestring-goal\scripts\development_execution_guard.py`,
      ...(env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_ROOT === undefined
        ? {}
        : { runtimeRoot: env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_ROOT }),
      leaseSeconds: boundedInt(
        env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_LEASE_SECONDS,
        180,
        30,
        3600
      ),
      terminalGraceSeconds: boundedInt(
        env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_TERMINAL_GRACE_SECONDS,
        60,
        30,
        600
      ),
      heartbeatIntervalMs: boundedInt(
        env.ENGINEERING_BRIDGE_DEVELOPMENT_GUARD_HEARTBEAT_MS,
        60_000,
        5_000,
        300_000
      )
    };
    return new DevelopmentExecutionGuardClient(options, runner);
  }

  async heartbeat(input: GuardHeartbeatInput): Promise<GuardCommandReceipt> {
    if (!this.options.enabled) return { ok: true };
    const args = [
      this.options.script,
      ...this.rootArgs(),
      "heartbeat",
      "--worktree", input.workspaceRoot,
      "--project", basename(input.workspaceRoot) || "engineering-bridge",
      "--source", input.source,
      "--activity", input.activity,
      "--lease-seconds", String(input.leaseSeconds ?? this.options.leaseSeconds),
      ...(input.taskId === undefined ? [] : ["--task-id", input.taskId])
    ];
    return this.run(args);
  }

  async stop(input: GuardStopInput): Promise<GuardCommandReceipt> {
    if (!this.options.enabled) {
      return {
        ok: false,
        payload: { error: "DEVELOPMENT_EXECUTION_GUARD_DISABLED" }
      };
    }
    return this.run([
      this.options.script,
      ...this.rootArgs(),
      "stop",
      "--worktree", input.workspaceRoot,
      "--project", basename(input.workspaceRoot) || "engineering-bridge",
      "--event-id", input.eventId,
      "--kind", input.kind,
      "--reason-zh", input.reasonZh
    ]);
  }

  private rootArgs(): string[] {
    return this.options.runtimeRoot === undefined
      ? []
      : ["--runtime-root", this.options.runtimeRoot];
  }

  private async run(args: readonly string[]): Promise<GuardCommandReceipt> {
    const result = await this.runner(this.options.python, args);
    const payload = parsePayload(result.exitCode === 0 ? result.stdout : result.stderr || result.stdout);
    const ok = result.exitCode === 0 && payload?.ok === true;
    return {
      ok,
      ...(payload === undefined ? {} : { payload })
    };
  }
}

export type GuardedTaskState =
  | "queued"
  | "running"
  | "waiting_for_supervisor_review"
  | "completed"
  | "failed";

export class DevelopmentExecutionGuardSupervisor {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly client: DevelopmentExecutionGuardClient,
    private readonly taskState: (taskId: string) => GuardedTaskState | undefined
  ) {}

  async beforeTaskReceipt(workspaceRoot: string): Promise<GuardCommandReceipt> {
    return this.client.heartbeat({
      workspaceRoot,
      source: "bridge",
      activity: "run_task-preflight"
    });
  }

  async beforeTask(workspaceRoot: string): Promise<boolean> {
    const receipt = await this.beforeTaskReceipt(workspaceRoot);
    return receipt.ok;
  }

  start(taskId: string, workspaceRoot: string): void {
    if (!this.client.options.enabled) return;
    this.stop(taskId);
    const pulse = async (): Promise<void> => {
      const state = this.taskState(taskId);
      if (state === "queued" || state === "running") {
        await this.client.heartbeat({
          workspaceRoot,
          source: "bridge",
          activity: "run_task-active",
          taskId
        });
        return;
      }
      if (state !== undefined) {
        await this.client.heartbeat({
          workspaceRoot,
          source: "bridge",
          activity: "run_task-terminal-grace",
          taskId,
          leaseSeconds: this.client.options.terminalGraceSeconds
        });
      }
      this.stop(taskId);
    };
    const timer = setInterval(() => void pulse(), this.client.options.heartbeatIntervalMs);
    timer.unref();
    this.timers.set(taskId, timer);
    void pulse();
  }

  stop(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer !== undefined) clearInterval(timer);
    this.timers.delete(taskId);
  }
}
