#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CoreError, serializeError } from "./core/errors.js";
import { VERSION } from "./version.js";
import { ThinCodexTaskService } from "./tasks/thin-codex-task-service.js";
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

type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
type ProjectRootEntry = z.infer<typeof ProjectRootEntrySchema>;

function isProjectRootEntry(entry: WorkspaceEntry | ProjectRootEntry): entry is ProjectRootEntry {
  return "kind" in entry;
}

function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function unknownTask() {
  return { isError: true, ...jsonContent({ error: "UNKNOWN_TASK" }) };
}

function taskResultContent(view: ReturnType<ThinCodexTaskService["taskView"]>) {
  if (view === undefined) return unknownTask();
  return jsonContent({
    task_id: view.taskId,
    state: view.state,
    executor: "codex",
    model: view.model,
    reasoning: view.reasoning,
    ...(view.threadId === undefined ? {} : { thread_id: view.threadId }),
    ...(view.output === undefined ? {} : { output: view.output }),
    ...(view.partialOutput === undefined ? {} : { partial_output: view.partialOutput }),
    evidence: view.evidence,
    ...(view.diagnostics === undefined ? {} : { diagnostics: view.diagnostics }),
    ...(view.error === undefined ? {} : { error: view.error })
  });
}

async function main(): Promise<void> {
  if (process.argv.length !== 3) {
    throw new Error("Usage: node dist/src/mcp-stdio.js /absolute/path/to/workspaces.json");
  }

  const configPath = process.argv[2];
  if (configPath === undefined) throw new Error("Workspace configuration path is required.");
  const configSource = await readFile(configPath, "utf8");
  const parsed = WorkspaceConfigSchema.parse(JSON.parse(
    configSource.startsWith("\uFEFF") ? configSource.slice(1) : configSource
  ));
  const workspaceEntries = parsed.filter((entry): entry is WorkspaceEntry => !isProjectRootEntry(entry));
  const projectRootEntries = parsed.filter(isProjectRootEntry);
  for (const entry of projectRootEntries) {
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
      // Manual configuration remains authoritative for duplicate registrations.
    }
  }

  const onboarding = new WorkspaceOnboardingService(
    registry,
    catalog,
    projectRootEntries.map(({ root }) => root)
  );
  const tasks = new ThinCodexTaskService(registry);
  const server = new McpServer({ name: "engineering-bridge", version: VERSION });

  server.registerTool("bind_project", {
    description: "Register an existing local project inside a configured project_root.",
    inputSchema: z.object({
      project_path: z.string().min(1),
      confirmation: z.literal("BIND")
    }).strict()
  }, async ({ project_path }) => {
    try {
      return jsonContent(await onboarding.bind({ project_path }));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("run_task", {
    description: "Run one task through the official Codex app-server in a bound workspace.",
    inputSchema: z.object({
      workspace_id: z.string().min(1),
      instruction: z.string().min(1),
      model: z.string().trim().min(1).max(200).optional(),
      reasoning: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]).optional()
    }).strict()
  }, async ({ workspace_id, instruction, model, reasoning }) => {
    try {
      const { taskId } = tasks.startTask({
        workspace_id,
        instruction,
        ...(model === undefined ? {} : { model }),
        ...(reasoning === undefined ? {} : { reasoning })
      });
      return jsonContent({ task_id: taskId });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("task_result", {
    description: "Read the current or terminal result for a Codex task.",
    inputSchema: z.object({ task_id: z.string() }).strict()
  }, ({ task_id }) => taskResultContent(tasks.taskView(task_id)));

  server.registerTool("control_task", {
    description: "Interrupt a running Codex task.",
    inputSchema: z.object({
      task_id: z.string(),
      action: z.literal("interrupt")
    }).strict()
  }, async ({ task_id, action }) => {
    if (tasks.taskView(task_id) === undefined) return unknownTask();
    try {
      const view = await tasks.controlTask(task_id, action);
      return jsonContent({ task_id: view.taskId, state: view.state });
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
