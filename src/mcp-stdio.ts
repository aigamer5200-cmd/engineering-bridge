#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CodexExecutor } from "./executors/codex-executor.js";
import { DshExecutor } from "./executors/dsh-executor.js";
import { VERSION } from "./version.js";
import { CoreError, serializeError } from "./core/errors.js";
import { RegisteredWorkspaceTaskService } from "./tasks/registered-workspace-task-service.js";
import { ExecutionReceiptStore } from "./tasks/execution-receipt-store.js";
import { ControlledPatchService } from "./tasks/controlled-patch-service.js";
import { ControlledPatchValidationService } from "./tasks/controlled-patch-validation-service.js";
import {
  type ValidationProfile,
  type ValidationStep,
  ValidationProfileStore
} from "./tasks/validation-profile-store.js";
import { ValidationProcessRunner } from "./tasks/validation-process-runner.js";
import { KnowledgePreflightReceiptSchema } from "./tasks/knowledge-preflight-receipt.js";
import { createTaskObserver } from "./tasks/task-observer.js";
import { ManagedWorkspaceCatalog } from "./workspaces/managed-workspace-catalog.js";
import { RegisteredWorkspaceRegistry } from "./workspaces/registered-workspace-registry.js";
import { WorkspaceOnboardingService } from "./workspaces/workspace-onboarding-service.js";

const WorkspaceEntrySchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  allow_write: z.boolean().optional()
}).strict();

const ProjectRootEntrySchema = z.object({
  kind: z.literal("project_root"),
  root: z.string().min(1)
}).strict();

const WorkspaceConfigSchema = z.array(z.union([WorkspaceEntrySchema, ProjectRootEntrySchema]));

const ValidationStepSchema = z.object({
  name: z.string().min(1),
  argv: z.array(z.string()).min(1),
  timeout_seconds: z.number().int().positive().optional()
}).strict();

const ValidationProfileSchema = z.object({
  preparation: z.array(ValidationStepSchema),
  validation: z.array(ValidationStepSchema),
  default_step_timeout_seconds: z.number().int().positive().optional().default(600),
  total_timeout_seconds: z.number().int().positive().optional().default(1200)
}).strict();

type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
type ProjectRootEntry = z.infer<typeof ProjectRootEntrySchema>;

function isProjectRootEntry(entry: WorkspaceEntry | ProjectRootEntry): entry is ProjectRootEntry {
  return "kind" in entry;
}

function toValidationStep(
  step: z.infer<typeof ValidationStepSchema>
): ValidationStep {
  return {
    name: step.name,
    argv: [step.argv[0]!, ...step.argv.slice(1)],
    ...(step.timeout_seconds === undefined
      ? {}
      : { timeoutSeconds: step.timeout_seconds })
  };
}

function toValidationProfile(
  profile: z.infer<typeof ValidationProfileSchema>
): ValidationProfile {
  return {
    preparation: profile.preparation.map(toValidationStep),
    validation: profile.validation.map(toValidationStep),
    defaultStepTimeoutSeconds: profile.default_step_timeout_seconds,
    totalTimeoutSeconds: profile.total_timeout_seconds
  };
}

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }]
  };
}

function unknownTask() {
  return {
    isError: true,
    ...jsonContent({ error: "UNKNOWN_TASK" })
  };
}

async function main(): Promise<void> {
  if (process.argv.length !== 3) {
    throw new Error("Usage: node dist/src/mcp-stdio.js /absolute/path/to/workspaces.json");
  }

  const configPath = process.argv[2];
  if (configPath === undefined) throw new Error("Workspace configuration path is required.");
  const configSource = await readFile(configPath, "utf8");
  const parsed = WorkspaceConfigSchema.parse(JSON.parse(configSource.startsWith("\uFEFF") ? configSource.slice(1) : configSource));
  const observer = createTaskObserver(configPath);
  const workspaceEntries = parsed.filter((entry): entry is WorkspaceEntry => !isProjectRootEntry(entry));
  const projectRootEntries = parsed.filter(isProjectRootEntry);
  for (const entry of projectRootEntries) {
    // project_root entries share the manual workspace root semantics: absolute
    // and already normalized, rejected at startup otherwise.
    if (!isAbsolute(entry.root) || normalize(entry.root) !== entry.root) {
      throw new CoreError("WORKSPACE_BOUNDARY_VIOLATION");
    }
  }
  const registry = new RegisteredWorkspaceRegistry(workspaceEntries);
  const catalog = new ManagedWorkspaceCatalog(`${configPath}.managed-workspaces.json`);
  await catalog.load();
  for (const entry of catalog.entries()) {
    try {
      registry.registerManaged(entry.id, entry.root, entry.allowWrite);
    } catch {
      // A manual or earlier managed registration already owns the id or root.
    }
  }
  const onboarding = new WorkspaceOnboardingService(
    registry,
    catalog,
    projectRootEntries.map(({ root }) => root)
  );
  const executionReceipts = new ExecutionReceiptStore(`${configPath}.execution-receipts.json`);
  await executionReceipts.load();
  const service = new RegisteredWorkspaceTaskService(
    registry,
    (executor, workspaceRoot) => {
      switch (executor) {
        case "codex": return new CodexExecutor(workspaceRoot);
        case "dsh": return new DshExecutor(workspaceRoot);
      }
    },
    executionReceipts,
    observer
  );
  const controlledPatches = new ControlledPatchService(
    registry,
    service,
    undefined,
    `${configPath}.controlled-patches.json`
  );
  await controlledPatches.load();
  const validationProfiles = new ValidationProfileStore(
    `${configPath}.validation-profiles.json`
  );
  const validationRunner = new ValidationProcessRunner();
  const validation = new ControlledPatchValidationService(
    registry,
    controlledPatches,
    validationProfiles,
    validationRunner
  );
  const server = new McpServer({ name: "engineering-bridge", version: VERSION });

  server.registerTool("run_task", {
    description: "Run a supervised task in a pre-registered workspace. Codex defaults to danger-full-access (Owner-approved full access) and may be explicitly narrowed to workspace-write or read-only; DSH remains read-only. Explicit Codex A/B routing uses bounded quota preflight and may fail over once to the alternate account without changing model/reasoning/service tier/sandbox; if both accounts are quota-exhausted, the Bridge may fall back to read-only DSH with durable provenance. Codex may also use native live web research and a bounded Knowledge Preflight Receipt.",
    inputSchema: {
      workspace_id: z.string().min(1),
      instruction: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex"),
      model: z.string().trim().min(1).max(200).optional(),
      reasoning: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
      reasoning_effort: z.string().trim().min(1).max(100).optional(),
      service_tier: z.enum(["standard", "priority"]).optional(),
      account: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).optional(),
      web_research: z.boolean().optional().default(false),
      sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
      preflight_receipt: KnowledgePreflightReceiptSchema.optional()
    }
  }, ({ workspace_id, instruction, executor, model, reasoning, reasoning_effort, service_tier, account, web_research, sandbox, preflight_receipt }) => {
    try {
      if (reasoning !== undefined && reasoning_effort !== undefined) {
        throw new CoreError("UNSUPPORTED_ACTION");
      }
      if (executor === "dsh" && (
        model !== undefined || reasoning !== undefined || reasoning_effort !== undefined ||
        service_tier !== undefined ||
        account !== undefined || web_research ||
        (sandbox !== undefined && sandbox !== "read-only")
      )) {
        throw new CoreError("UNSUPPORTED_ACTION");
      }
      const effectiveSandbox = sandbox ?? (executor === "codex" ? "danger-full-access" : "read-only");
      const { taskId } = service.startTask({
        workspace_id,
        instruction,
        executor,
        ...(model === undefined ? {} : { model }),
        ...(reasoning === undefined ? {} : { reasoning }),
        ...(reasoning_effort === undefined ? {} : { reasoning_effort }),
        ...(service_tier === undefined ? {} : { service_tier }),
        ...(account === undefined ? {} : { account }),
        ...(web_research ? { web_research: true } : {}),
        sandbox: effectiveSandbox,
        ...(preflight_receipt === undefined ? {} : { preflight_receipt })
      });
      return jsonContent({ task_id: taskId });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("task_result", {
    description: "Retrieve the completed output or safe error for a task. This tool is read-only.",
    inputSchema: { task_id: z.string() }
  }, ({ task_id }) => {
    const view = service.taskView(task_id);
    if (view === undefined) return unknownTask();
    const storedReceipt = executionReceipts.get(task_id);
    const receipt = storedReceipt !== undefined && (
      (view.state === "waiting_for_supervisor_review" && storedReceipt.state === "waiting_for_supervisor_review") ||
      (view.state === "completed" && storedReceipt.state === "completed") ||
      (view.state === "failed" && storedReceipt.state === "handoff_required")
    ) ? storedReceipt : undefined;
    const taskView = { task_id: view.taskId, state: view.state,
      ...(view.source === undefined ? {} : { source: view.source }),
      ...(view.executor === undefined ? {} : { executor: view.executor }),
      ...(view.model === undefined ? {} : { model: view.model }),
      ...(view.reasoning === undefined ? {} : { reasoning: view.reasoning }),
      ...(view.reasoning_effort === undefined ? {} : { reasoning_effort: view.reasoning_effort }),
      ...(view.service_tier === undefined ? {} : { service_tier: view.service_tier }),
      ...(view.account === undefined ? {} : { account: view.account }),
      ...(view.requested_account === undefined ? {} : { requested_account: view.requested_account }),
      ...(view.resolved_account === undefined ? {} : { resolved_account: view.resolved_account }),
      ...(view.resolved_executor === undefined ? {} : { resolved_executor: view.resolved_executor }),
      ...(view.sandbox === undefined ? {} : { sandbox: view.sandbox }),
      ...(view.failover === undefined ? {} : { failover: view.failover }),
      ...(view.threadId === undefined ? {} : { thread_id: view.threadId }),
      ready: view.ready,
      ...(view.output === undefined ? {} : { output: view.output }),
      ...(view.review_output === undefined ? {} : { review_output: view.review_output }),
      ...(view.partial_output === undefined ? {} : { partial_output: view.partial_output }),
      evidence: view.evidence,
      ...(view.diagnostics === undefined ? {} : { diagnostics: view.diagnostics }),
      ...(receipt === undefined ? {} : {
        execution_receipt: {
          workspace_id: receipt.workspaceId,
          workspace_root: receipt.workspaceRoot,
          task_id: receipt.taskId,
          executor: receipt.executor,
          ...(receipt.model === undefined ? {} : { model: receipt.model }),
          ...(receipt.reasoning === undefined ? {} : { reasoning: receipt.reasoning }),
          ...(receipt.serviceTier === undefined ? {} : { service_tier: receipt.serviceTier }),
          ...(receipt.account === undefined ? {} : { account: receipt.account }),
          ...(receipt.requestedAccount === undefined ? {} : { requested_account: receipt.requestedAccount }),
          ...(receipt.resolvedAccount === undefined ? {} : { resolved_account: receipt.resolvedAccount }),
          ...(receipt.resolvedExecutor === undefined ? {} : { resolved_executor: receipt.resolvedExecutor }),
          ...(receipt.failover === undefined ? {} : {
            failover: {
              attempted: receipt.failover.attempted,
              ...(receipt.failover.fromAccount === undefined ? {} : { from_account: receipt.failover.fromAccount }),
              ...(receipt.failover.toAccount === undefined ? {} : { to_account: receipt.failover.toAccount }),
              ...(receipt.failover.reason === undefined ? {} : { reason: receipt.failover.reason }),
              ...(receipt.failover.quotaWindow === undefined ? {} : { quota_window: receipt.failover.quotaWindow }),
              ...(receipt.failover.resetAt === undefined ? {} : { reset_at: receipt.failover.resetAt }),
              ...(receipt.failover.fallbackExecutor === undefined ? {} : { fallback_executor: receipt.failover.fallbackExecutor }),
              retry_count: receipt.failover.retryCount,
              continuation: {
                checkpoint: receipt.failover.checkpoint,
                evidence_count: receipt.failover.evidenceCount,
                mutation_evidence: receipt.failover.mutationEvidence
              },
              ...(receipt.failover.ownerNotice === undefined ? {} : { owner_notice: receipt.failover.ownerNotice })
            }
          }),
          operation: receipt.operation,
          sandbox: receipt.sandbox,
          read_only: receipt.readOnly,
          state: receipt.state,
          recorded_at: receipt.recordedAt
        }
      }),
      ...(view.error === undefined ? {} : { error: view.error }) };
    return jsonContent({
      ...taskView,
      mcp_diagnostics: {
        serialized_task_view_bytes: Buffer.byteLength(JSON.stringify(taskView), "utf8")
      }
    });
  });

  server.registerTool("control_task", {
    description: "Steer or interrupt a running task, continue a reviewed task, or accept reviewed output.",
    inputSchema: {
      task_id: z.string(),
      action: z.enum(["continue", "steer", "interrupt", "accept"]),
      instruction: z.string().optional()
    }
  }, async ({ task_id, action, instruction }) => {
    if (service.taskView(task_id) === undefined) return unknownTask();
    try {
      const view = await service.controlTask(task_id, action, instruction);
      return jsonContent({ task_id: view.taskId, state: view.state });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("bind_project", {
    description: "Register an existing local project directory as a read-only workspace. The path must already exist inside a configured project_root and the call requires exact BIND confirmation.",
    inputSchema: {
      project_path: z.string().min(1),
      confirmation: z.literal("BIND")
    }
  }, async ({ project_path }) => {
    try {
      return jsonContent(await onboarding.bind({ project_path }));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("create_project", {
    description: "Create a new empty Git project directory inside a configured project_root and register it as a read-only workspace. The call requires exact CREATE confirmation; only mkdir and git init are performed.",
    inputSchema: {
      parent: z.string().min(1),
      name: z.string().min(1),
      confirmation: z.literal("CREATE")
    }
  }, async ({ parent, name }) => {
    try {
      return jsonContent(await onboarding.create({ parent, name }));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("authorize_workspace_write", {
    description: "Grant persistent controlled-patch authorization to a managed workspace after exact AUTHORIZE confirmation. Manual workspaces remain authoritative through workspaces.json. This permission gates APPLY only and is independent of the Codex run_task sandbox.",
    inputSchema: {
      workspace_id: z.string().min(1),
      confirmation: z.literal("AUTHORIZE")
    }
  }, async ({ workspace_id }) => {
    try {
      return jsonContent(await onboarding.authorizeWrite(workspace_id));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("generate_controlled_patch", {
    description: "Generate a read-only patch proposal for review in any registered Git workspace. Optional model/reasoning selection and a bounded Knowledge Preflight Receipt remain read-only; controlled-write authorization is required only to APPLY.",
    inputSchema: {
      workspace_id: z.string().min(1),
      change_request: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex"),
      model: z.string().min(1).optional(),
      reasoning_effort: z.string().min(1).optional(),
      preflight_receipt: KnowledgePreflightReceiptSchema.optional()
    }
  }, async ({ workspace_id, change_request, executor, model, reasoning_effort, preflight_receipt }) => {
    try {
      if (executor === "dsh" && (model !== undefined || reasoning_effort !== undefined)) {
        throw new CoreError("UNSUPPORTED_ACTION");
      }
      const proposal = await controlledPatches.generate({ workspace_id, change_request, executor,
        ...(model === undefined ? {} : { model }),
        ...(reasoning_effort === undefined ? {} : { reasoning_effort }),
        ...(preflight_receipt === undefined ? {} : { preflight_receipt }) });
      return jsonContent({ task_id: proposal.taskId, base_head: proposal.baseHead });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("refine_controlled_patch", {
    description: "Refine a completed retained patch proposal into a new complete read-only proposal against the same base HEAD. Optional model/reasoning selection and a bounded Knowledge Preflight Receipt remain read-only.",
    inputSchema: {
      patch_task_id: z.string().min(1),
      change_request: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex"),
      model: z.string().min(1).optional(),
      reasoning_effort: z.string().min(1).optional(),
      preflight_receipt: KnowledgePreflightReceiptSchema.optional()
    }
  }, async ({ patch_task_id, change_request, executor, model, reasoning_effort, preflight_receipt }) => {
    try {
      if (executor === "dsh" && (model !== undefined || reasoning_effort !== undefined)) {
        throw new CoreError("UNSUPPORTED_ACTION");
      }
      const proposal = await controlledPatches.refine({ patch_task_id, change_request, executor,
        ...(model === undefined ? {} : { model }),
        ...(reasoning_effort === undefined ? {} : { reasoning_effort }),
        ...(preflight_receipt === undefined ? {} : { preflight_receipt }) });
      return jsonContent({ task_id: proposal.taskId, base_head: proposal.baseHead });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("submit_controlled_patch", {
    description: "Submit a caller-provided complete unified Git diff as a read-only patch proposal against exactly the current commit HEAD. Nothing is written until the returned task is applied with exact APPLY; the proposal carries source: \"submitted\" and no executor identity.",
    inputSchema: {
      workspace_id: z.string().min(1),
      base_head: z.string().min(1),
      diff: z.string().min(1)
    }
  }, async ({ workspace_id, base_head, diff }) => {
    try {
      const proposal = await controlledPatches.submit({ workspace_id, base_head, diff });
      return jsonContent({ task_id: proposal.taskId, base_head: proposal.baseHead });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("apply_controlled_patch", {
    description: "Apply one reviewed patch proposal after exact APPLY confirmation. This tool can modify validated tracked text files or add absent 100644 text files, but never stages, commits, or pushes.",
    inputSchema: {
      patch_task_id: z.string().min(1),
      confirmation: z.literal("APPLY")
    }
  }, async ({ patch_task_id, confirmation }) => jsonContent(
    await controlledPatches.apply({ patch_task_id, confirmation })
  ));

  server.registerTool("commit_controlled_patch", {
    description: "Create one Git commit containing only an already-APPLYed controlled patch after exact COMMIT confirmation. Never pushes.",
    inputSchema: {
      patch_task_id: z.string().min(1),
      message: z.string().min(1),
      confirmation: z.literal("COMMIT")
    }
  }, async ({ patch_task_id, message, confirmation }) => jsonContent(
    await controlledPatches.commit({
      patch_task_id,
      message,
      confirmation
    })
  ));

  server.registerTool("configure_validation_profile", {
    description: "Configure the fixed validation profile for a registered workspace after exact CONFIGURE confirmation.",
    inputSchema: z.object({
      workspace_id: z.string().min(1),
      profile: ValidationProfileSchema,
      confirmation: z.literal("CONFIGURE")
    }).strict()
  }, async ({ workspace_id, profile }) => {
    try {
      return jsonContent(await validation.configure(
        workspace_id,
        toValidationProfile(profile)
      ));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("validate_controlled_patch", {
    description: "Validate one retained controlled patch with its workspace's configured profile.",
    inputSchema: z.object({
      patch_task_id: z.string().min(1)
    }).strict()
  }, async ({ patch_task_id }) => {
    try {
      return jsonContent(await validation.validate(patch_task_id));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Failed to start engineering-bridge.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
