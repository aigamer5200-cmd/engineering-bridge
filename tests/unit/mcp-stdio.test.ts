import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface ToolResult {
  readonly content?: Array<{ readonly type?: string; readonly text?: string }>;
  readonly isError?: boolean;
}

async function startClient(configPath: string): Promise<Client> {
  const client = new Client({ name: "thin-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist/src/mcp-stdio.js"), configPath],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const result = await client.callTool({ name, arguments: args }) as ToolResult;
  const text = result.content?.[0]?.text ?? "";
  return {
    isError: result.isError === true,
    body: JSON.parse(text) as Record<string, unknown>
  };
}

test("MCP exposes exactly the Phase 1 thin tool surface", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "engineering-bridge-thin-mcp-"));
  const configPath = join(configDir, "workspaces.json");
  writeFileSync(configPath, "[]\n");
  const client = await startClient(configPath);

  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [
      "bind_project",
      "control_task",
      "run_task",
      "task_result"
    ]);

    const schemas = new Map(listed.tools.map((tool) => [tool.name, tool.inputSchema as {
      properties?: Record<string, { type?: string; const?: unknown; default?: unknown; enum?: unknown[] }>;
      required?: string[];
    }]));
    assert.deepEqual(Object.keys(schemas.get("run_task")?.properties ?? {}).sort(), [
      "instruction",
      "workspace_id"
    ]);
    assert.deepEqual(Object.keys(schemas.get("control_task")?.properties ?? {}).sort(), ["action", "task_id"]);
    assert.equal(schemas.get("control_task")?.properties?.action?.const, "interrupt");
    assert.deepEqual(Object.keys(schemas.get("bind_project")?.properties ?? {}).sort(), ["confirmation", "project_path"]);
    assert.equal(schemas.get("bind_project")?.properties?.confirmation?.const, "BIND");
    assert.equal(schemas.get("bind_project")?.properties?.confirmation?.default, "BIND");
    assert.deepEqual(schemas.get("run_task")?.required?.sort(), ["instruction", "workspace_id"]);

    assert.equal(JSON.stringify(listed.tools).includes("model"), false);
    assert.equal(JSON.stringify(listed.tools).includes("reasoning"), false);

    const run = await call(client, "run_task", {
      workspace_id: "missing",
      instruction: "inspect"
    });
    assert.equal(run.isError, true);
    assert.equal("task_id" in run.body, false);

    const unknownTask = await call(client, "task_result", { task_id: "missing" });
    assert.equal(unknownTask.isError, true);
    assert.deepEqual(unknownTask.body, { error: "Task was not found." });
  } finally {
    await client.close();
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("bind_project keeps the configured project_root boundary", async () => {
  const approved = mkdtempSync(join(tmpdir(), "engineering-bridge-thin-approved-"));
  const project = join(approved, "project");
  mkdirSync(project);
  const configDir = mkdtempSync(join(tmpdir(), "engineering-bridge-thin-bind-"));
  const configPath = join(configDir, "workspaces.json");
  writeFileSync(configPath, `${JSON.stringify([{ kind: "project_root", root: approved }])}\n`);
  const client = await startClient(configPath);

  try {
    const bound = await call(client, "bind_project", { project_path: project });
    assert.equal(bound.isError, false);
    assert.equal(bound.body.root, project);
    assert.equal(typeof bound.body.workspace_id, "string");
    assert.deepEqual(Object.keys(bound.body).sort(), ["root", "workspace_id"]);
    const stored = JSON.parse(readFileSync(`${configPath}.managed-workspaces.json`, "utf8")) as {
      workspaces?: Array<{ root?: string }>;
    };
    assert.equal(stored.workspaces?.some(({ root }) => root === project), true);
  } finally {
    await client.close();
    rmSync(approved, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  }
});
