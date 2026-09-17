import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CoreError, serializeError } from "../../../src/core/errors.js";
import type { Executor, ExecutorRequest, ExecutorResult } from "../../../src/executors/executor.js";
import { ExecutionReceiptStore } from "../../../src/tasks/execution-receipt-store.js";
import { RegisteredWorkspaceTaskService } from "../../../src/tasks/registered-workspace-task-service.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

type Call = { readonly executor: "codex" | "dsh"; readonly request: ExecutorRequest };

function available(primaryUsed = 25, secondaryUsed = 50): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    account_limited: false,
    primary_used: primaryUsed,
    primary_reset: now + 3600,
    secondary_used: secondaryUsed,
    secondary_reset: now + 3 * 86_400
  };
}

function exhausted(window: "5h" | "weekly"): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    account_limited: true,
    rate_limit_reached_type: "rate_limit_reached",
    primary_used: window === "5h" ? 100 : 40,
    primary_reset: now + 3600,
    secondary_used: window === "weekly" ? 100 : 55,
    secondary_reset: now + 3 * 86_400
  };
}

function harness(
  entries: Record<string, unknown>,
  behavior: (executor: "codex" | "dsh", request: ExecutorRequest, cachePath: string) => Promise<ExecutorResult> | ExecutorResult
): {
  readonly service: RegisteredWorkspaceTaskService;
  readonly calls: Call[];
  readonly cachePath: string;
  readonly receipts: ExecutionReceiptStore;
  readonly workspaceRoot: string;
} {
  const root = mkdtempSync(join(tmpdir(), "bridge-failover-workspace-"));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["-c", "user.name=Bridge Test", "-c", "user.email=bridge-test@example.invalid",
    "commit", "--allow-empty", "-qm", "baseline"], { cwd: root, stdio: "ignore", windowsHide: true });
  const stateRoot = mkdtempSync(join(tmpdir(), "bridge-failover-state-"));
  const switchHome = join(stateRoot, "switch-home");
  mkdirSync(switchHome);
  const cachePath = join(switchHome, "cache.json");
  writeFileSync(cachePath, JSON.stringify({ entries }), "utf8");
  const registry = new RegisteredWorkspaceRegistry([{ id: "known", root }]);
  const receipts = new ExecutionReceiptStore();
  const calls: Call[] = [];
  const service = new RegisteredWorkspaceTaskService(
    registry,
    (executor) => ({
      execute: async (request) => {
        calls.push({ executor, request });
        return behavior(executor, request, cachePath);
      }
    } satisfies Executor),
    receipts,
    undefined,
    {
      ENGINEERING_BRIDGE_CODEX_SWITCH_HOME: switchHome,
      ENGINEERING_BRIDGE_CODEX_ACCOUNT_ALLOWLIST: "A,B",
      ENGINEERING_BRIDGE_CODEX_USAGE_CACHE_MAX_AGE_MS: "3600000"
    }
  );
  return { service, calls, cachePath, receipts, workspaceRoot: root };
}

async function ready(service: RegisteredWorkspaceTaskService, taskId: string): Promise<void> {
  while (true) {
    const state = service.taskView(taskId)?.state;
    if (state !== "queued" && state !== "running") return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function runProfile(service: RegisteredWorkspaceTaskService, account: "A" | "B", sandbox: "read-only" | "danger-full-access" = "danger-full-access") {
  return service.startTask({
    workspace_id: "known",
    instruction: "preserve this exact task",
    executor: "codex",
    account,
    model: "gpt-5.6-luna",
    reasoning: "max",
    service_tier: "priority",
    web_research: true,
    sandbox
  });
}

test("available A and B execute normally without failover", async () => {
  for (const account of ["A", "B"] as const) {
    const { service, calls } = harness({ A: available(), B: available() }, async () => ({
      kind: "completed",
      output: `${account}-ok`,
      threadId: `${account}-thread`
    }));
    const { taskId } = runProfile(service, account);
    await ready(service, taskId);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.executor, "codex");
    assert.equal(calls[0]?.request.account, account);
    assert.equal(service.taskView(taskId)?.state, "waiting_for_supervisor_review");
    assert.equal(service.taskView(taskId)?.failover, undefined);
  }
});

test("five-hour preflight exhaustion fails over A to B and B to A with the identical execution profile", async () => {
  for (const [from, to] of [["A", "B"], ["B", "A"]] as const) {
    const { service, calls } = harness(
      { [from]: exhausted("5h"), [to]: available() },
      async () => ({ kind: "completed", output: "replacement-ok", threadId: "replacement-thread" })
    );
    const { taskId } = runProfile(service, from);
    await ready(service, taskId);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.request.account, to);
    assert.equal(calls[0]?.request.model, "gpt-5.6-luna");
    assert.equal(calls[0]?.request.reasoning, "max");
    assert.equal(calls[0]?.request.service_tier, "priority");
    assert.equal(calls[0]?.request.sandbox, "danger-full-access");
    assert.equal(calls[0]?.request.webSearch, "live");
    assert.equal(calls[0]?.request.threadId, undefined);
    const view = service.taskView(taskId)!;
    assert.equal(view.requested_account, from);
    assert.equal(view.resolved_account, to);
    assert.equal(view.failover?.reason, "ACCOUNT_5H_QUOTA_EXHAUSTED");
    assert.equal(view.failover?.quota_window, "5h");
    assert.equal(view.failover?.retry_count, 1);
  }
});

test("weekly preflight exhaustion fails over A to B and B to A", async () => {
  for (const [from, to] of [["A", "B"], ["B", "A"]] as const) {
    const { service, calls } = harness(
      { [from]: exhausted("weekly"), [to]: available() },
      async () => ({ kind: "completed", output: "weekly-replacement-ok" })
    );
    const { taskId } = runProfile(service, from);
    await ready(service, taskId);

    assert.equal(calls[0]?.request.account, to);
    assert.equal(service.taskView(taskId)?.failover?.reason, "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED");
    assert.equal(service.taskView(taskId)?.failover?.quota_window, "weekly");
  }
});

test("both exhausted creates a durable DS handoff for a write-capable task instead of pretending read-only DSH can mutate", async () => {
  const { service, calls, receipts } = harness(
    { A: exhausted("5h"), B: exhausted("weekly") },
    async () => ({ kind: "completed", output: "must-not-run" })
  );
  const { taskId } = runProfile(service, "A", "danger-full-access");
  await ready(service, taskId);

  assert.equal(calls.length, 0);
  const view = service.taskView(taskId)!;
  assert.equal(view.state, "failed");
  assert.equal(view.error?.code, "BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED");
  assert.equal(view.failover?.fallback_executor, "ds");
  assert.equal(view.failover?.continuation.checkpoint, "quota_preflight");
  assert.equal(receipts.get(taskId)?.state, "handoff_required");
  assert.equal(receipts.get(taskId)?.failover?.fallbackExecutor, "ds");
});

test("both exhausted read-only task still produces a DS handoff instead of substituting DSH", async () => {
  const { service, calls, receipts } = harness(
    { A: exhausted("5h"), B: exhausted("5h") },
    async () => ({ kind: "completed", output: "must-not-run" })
  );
  const { taskId } = runProfile(service, "A", "read-only");
  await ready(service, taskId);

  assert.equal(calls.length, 0);
  const view = service.taskView(taskId)!;
  assert.equal(view.state, "failed");
  assert.equal(view.error?.code, "BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED");
  assert.equal(view.requested_account, "A");
  assert.equal(view.failover?.fallback_executor, "ds");
  assert.equal(receipts.get(taskId)?.state, "handoff_required");
  assert.equal(receipts.get(taskId)?.failover?.fallbackExecutor, "ds");
  assert.equal(receipts.get(taskId)?.resolvedAccount, undefined);
});

test("protocol, model-capacity, and generic execution failures never trigger account switching when quota remains", async () => {
  for (const code of ["CODEX_PROTOCOL_ERROR", "MODEL_CAPACITY", "CODEX_EXECUTION_FAILED"] as const) {
    const { service, calls } = harness(
      { A: available(), B: available() },
      async () => ({ kind: "failed", error: serializeError(new CoreError(code)) })
    );
    const { taskId } = runProfile(service, "A");
    await ready(service, taskId);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.request.account, "A");
    assert.equal(service.taskView(taskId)?.error?.code, code);
    assert.equal(service.taskView(taskId)?.failover, undefined);
  }
});

test("mid-task quota exhaustion refreshes usage, starts a new account-bound turn, and does not carry the native thread", async () => {
  const initial = { A: available(), B: available() };
  const { service, calls } = harness(initial, async (_executor, request, cachePath) => {
    if (request.account === "A") {
      writeFileSync(cachePath, JSON.stringify({ entries: { A: exhausted("5h"), B: available() } }), "utf8");
      return {
        kind: "failed",
        error: serializeError(new CoreError("PROVIDER_RATE_LIMIT")),
        threadId: "native-A-thread",
        evidence: []
      };
    }
    return { kind: "completed", output: "B-continued", threadId: "native-B-thread" };
  });
  const { taskId } = runProfile(service, "A");
  await ready(service, taskId);

  assert.deepEqual(calls.map((call) => call.request.account), ["A", "B"]);
  assert.equal(calls[1]?.request.threadId, undefined);
  assert.equal(calls[1]?.request.model, calls[0]?.request.model);
  assert.equal(calls[1]?.request.reasoning, calls[0]?.request.reasoning);
  assert.equal(calls[1]?.request.service_tier, calls[0]?.request.service_tier);
  assert.equal(calls[1]?.request.sandbox, calls[0]?.request.sandbox);
  assert.equal(service.taskView(taskId)?.failover?.continuation.mutation_evidence, false);
});

test("mutation evidence blocks automatic account replay after mid-task quota exhaustion", async () => {
  const { service, calls } = harness({ A: available(), B: available() }, async (_executor, request, cachePath) => {
    assert.equal(request.account, "A");
    writeFileSync(cachePath, JSON.stringify({ entries: { A: exhausted("5h"), B: available() } }), "utf8");
    return {
      kind: "failed",
      error: serializeError(new CoreError("PROVIDER_RATE_LIMIT")),
      evidence: [{
        id: "mutation-1",
        type: "fileChange",
        status: "completed",
        changes: [{ path: "src/file.ts", diff: "bounded" }]
      }]
    };
  });
  const { taskId } = runProfile(service, "A");
  await ready(service, taskId);

  assert.equal(calls.length, 1);
  assert.equal(service.taskView(taskId)?.error?.code, "FAILOVER_REVIEW_REQUIRED");
  assert.equal(service.taskView(taskId)?.failover?.attempted, false);
  assert.equal(service.taskView(taskId)?.failover?.continuation.mutation_evidence, true);
});

test("Git checkpoint catches command-side mutation even when Codex emits no fileChange evidence", async () => {
  let workspaceRoot = "";
  const built = harness({ A: available(), B: available() }, async (_executor, request, cachePath) => {
    assert.equal(request.account, "A");
    writeFileSync(join(workspaceRoot, "mutated-by-command.txt"), "mutation\n", "utf8");
    writeFileSync(cachePath, JSON.stringify({ entries: { A: exhausted("5h"), B: available() } }), "utf8");
    return {
      kind: "failed",
      error: serializeError(new CoreError("PROVIDER_RATE_LIMIT")),
      evidence: []
    };
  });
  workspaceRoot = built.workspaceRoot;
  const { taskId } = runProfile(built.service, "A");
  await ready(built.service, taskId);

  assert.equal(built.calls.length, 1);
  assert.equal(built.service.taskView(taskId)?.error?.code, "FAILOVER_REVIEW_REQUIRED");
  assert.equal(built.service.taskView(taskId)?.failover?.continuation.mutation_evidence, true);
});

test("account failover loop is bounded to one A-to-B cycle before a DS handoff", async () => {
  const { service, calls, receipts } = harness({ A: available(), B: available() }, async (_executor, request, cachePath) => {
    if (request.account === "A") {
      writeFileSync(cachePath, JSON.stringify({ entries: { A: exhausted("5h"), B: available() } }), "utf8");
      return { kind: "failed", error: serializeError(new CoreError("PROVIDER_RATE_LIMIT")), evidence: [] };
    }
    writeFileSync(cachePath, JSON.stringify({ entries: { A: exhausted("5h"), B: exhausted("5h") } }), "utf8");
    return { kind: "failed", error: serializeError(new CoreError("PROVIDER_RATE_LIMIT")), evidence: [] };
  });
  const { taskId } = runProfile(service, "A", "danger-full-access");
  await ready(service, taskId);

  assert.deepEqual(calls.map((call) => call.request.account), ["A", "B"]);
  assert.equal(service.taskView(taskId)?.error?.code, "BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED");
  assert.equal(service.taskView(taskId)?.failover?.fallback_executor, "ds");
  assert.equal(service.taskView(taskId)?.failover?.retry_count, 1);
  assert.equal(receipts.get(taskId)?.state, "handoff_required");
});
