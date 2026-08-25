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
import { ManagedWorkspaceCatalog } from "./workspaces/managed-workspace-catalog.js";
import { RegisteredWorkspaceRegistry } from "./workspaces/registered-workspace-registry.js";
import { WorkspaceOnboardingService } from "./workspaces/workspace-onboarding-service.js";
import { KnowledgePreflightReceiptSchema } from "./tasks/knowledge-preflight-receipt.js";
import { createTaskObserver } from "./tasks/task-observer.js";

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

type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
type ProjectRootEntry = z.infer<typeof ProjectRootEntrySchema>;

function isProjectRootEntry(entry: WorkspaceEntry | ProjectRootEntry): entry is ProjectRootEntry {
  return "kind" in entry;
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
  const parsed = WorkspaceConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
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
  const server = new McpServer({ name: "engineering-bridge", version: VERSION });

  server.registerTool("run_task", {
    description: "Run a read-only task with the selected executor in a pre-registered workspace. An optional bounded Knowledge Preflight Receipt is prepended to the executor instruction without granting extra authority. This tool does not modify workspace files.",
    inputSchema: {
      workspace_id: z.string().min(1),
      instruction: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex"),
      preflight_receipt: KnowledgePreflightReceiptSchema.optional()
    }
  }, ({ workspace_id, instruction, executor, preflight_receipt }) => {
    const { taskId } = service.startTask({
      workspace_id,
      instruction,
      executor,
      ...(preflight_receipt === undefined ? {} : { preflight_receipt })
    });
    return jsonContent({ task_id: taskId });
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
      (view.state === "completed" && storedReceipt.state === "completed")
    ) ? storedReceipt : undefined;
    return jsonContent({ task_id: view.taskId, state: view.state,
      ...(view.source === undefined ? {} : { source: view.source }),
      ...(view.executor === undefined ? {} : { executor: view.executor }),
      ...(view.threadId === undefined ? {} : { thread_id: view.threadId }),
      ready: view.ready,
      ...(view.output === undefined ? {} : { output: view.output }),
      ...(view.review_output === undefined ? {} : { review_output: view.review_output }),
      ...(view.partial_output === undefined ? {} : { partial_output: view.partial_output }),
      evidence: view.evidence,
      ...(receipt === undefined ? {} : {
        execution_receipt: {
          workspace_id: receipt.workspaceId,
          workspace_root: receipt.workspaceRoot,
          task_id: receipt.taskId,
          executor: receipt.executor,
          operation: receipt.operation,
          read_only: receipt.readOnly,
          state: receipt.state,
          recorded_at: receipt.recordedAt
        }
      }),
      ...(view.error === undefined ? {} : { error: view.error }) });
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
    description: "Grant persistent controlled-write authorization to a managed workspace after exact AUTHORIZE confirmation. Manual workspaces remain authoritative through workspaces.json. Ordinary run_task calls stay read-only.",
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
    description: "Generate a read-only patch proposal for review in any registered Git workspace. An optional bounded Knowledge Preflight Receipt is prepended to the executor instruction. Generation requires no write authorization, and controlled-write authorization is required only to APPLY.",
    inputSchema: {
      workspace_id: z.string().min(1),
      change_request: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex"),
      preflight_receipt: KnowledgePreflightReceiptSchema.optional()
    }
  }, async ({ workspace_id, change_request, executor, preflight_receipt }) => {
    try {
      const proposal = await controlledPatches.generate({
        workspace_id,
        change_request,
        executor,
        ...(preflight_receipt === undefined ? {} : { preflight_receipt })
      });
      return jsonContent({ task_id: proposal.taskId, base_head: proposal.baseHead });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("refine_controlled_patch", {
    description: "Refine a completed retained patch proposal into a new complete read-only proposal against the same base HEAD. An optional bounded Knowledge Preflight Receipt is prepended to the executor instruction for this new delegation.",
    inputSchema: {
      patch_task_id: z.string().min(1),
      change_request: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex"),
      preflight_receipt: KnowledgePreflightReceiptSchema.optional()
    }
  }, async ({ patch_task_id, change_request, executor, preflight_receipt }) => {
    try {
      const proposal = await controlledPatches.refine({
        patch_task_id,
        change_request,
        executor,
        ...(preflight_receipt === undefined ? {} : { preflight_receipt })
      });
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

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Failed to start engineering-bridge.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
