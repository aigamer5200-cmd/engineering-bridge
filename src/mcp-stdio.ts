#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { VERSION } from "./version.js";
import { ThinCodexTaskService } from "./tasks/thin-codex-task-service.js";
import { WorkspaceDirectory } from "./transport/workspace-directory.js";

const WorkspaceEntrySchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1)
});

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
  return { isError: true, ...jsonContent({ error: "Task was not found." }) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function taskResultContent(view: ReturnType<ThinCodexTaskService["taskView"]>) {
  if (view === undefined) return unknownTask();
  return jsonContent({
    task_id: view.taskId,
    state: view.state,
    executor: "codex",
    ...(view.threadId === undefined ? {} : { thread_id: view.threadId }),
    ...(view.output === undefined ? {} : { output: view.output }),
    ...(view.partialOutput === undefined ? {} : { partial_output: view.partialOutput }),
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
      throw new Error("Workspace configuration is invalid.");
    }
  }

  const workspaces = new WorkspaceDirectory(
    workspaceEntries,
    projectRootEntries.map(({ root }) => root),
    `${configPath}.managed-workspaces.json`
  );
  await workspaces.load();
  const tasks = new ThinCodexTaskService(workspaces);
  const server = new McpServer({ name: "engineering-bridge", version: VERSION });

  server.registerTool("bind_project", {
    description: "Register an existing local project inside a configured project_root.",
    inputSchema: z.object({
      project_path: z.string().min(1),
      confirmation: z.literal("BIND").default("BIND")
    }).strict()
  }, async ({ project_path }) => {
    try {
      return jsonContent(await workspaces.bind(project_path));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: errorMessage(error) }) };
    }
  });

  server.registerTool("run_task", {
    description: "Run one task through the official Codex app-server in a bound workspace.",
    inputSchema: z.object({
      workspace_id: z.string().min(1),
      instruction: z.string().min(1)
    }).strict()
  }, async ({ workspace_id, instruction }) => {
    try {
      const { taskId } = tasks.startTask({ workspace_id, instruction });
      return jsonContent({ task_id: taskId });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: errorMessage(error) }) };
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
      action: z.literal("interrupt").default("interrupt")
    }).strict()
  }, async ({ task_id, action }) => {
    if (tasks.taskView(task_id) === undefined) return unknownTask();
    try {
      const view = await tasks.controlTask(task_id, action);
      return jsonContent({ task_id: view.taskId, state: view.state });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: errorMessage(error) }) };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Failed to start engineering-bridge.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
