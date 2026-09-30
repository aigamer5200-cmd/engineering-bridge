#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
  return "Usage: node ops/siwc/siwc-live-smoke.mjs --profile <label> --config <absolute-workspaces.json> --workspace-id <id> [--instruction <text>] [--expect <text>] [--interrupt-after-ms <ms>]";
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--profile", "--config", "--workspace-id", "--instruction", "--expect", "--interrupt-after-ms"].includes(key) || !value) throw new Error(usage());
    result[key.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!result.profile || !result.config || !result.workspace_id) throw new Error(usage());
  return result;
}

function parsedToolText(response) {
  const text = response?.content?.find?.((item) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new Error("Candidate Bridge returned no text result.");
  return JSON.parse(text);
}

async function main() {
  const {
    profile,
    config,
    workspace_id: workspaceId,
    instruction = "Read-only smoke test. Return exactly SIWC_OK. Do not modify files and do not run shell commands.",
    expect = "SIWC_OK",
    interrupt_after_ms: interruptAfterRaw
  } = parseArgs(process.argv.slice(2));
  const interruptAfterMs = interruptAfterRaw === undefined ? undefined : Number(interruptAfterRaw);
  if (interruptAfterMs !== undefined && (!Number.isFinite(interruptAfterMs) || interruptAfterMs < 0)) {
    throw new Error("--interrupt-after-ms must be a non-negative number.");
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const launcher = resolve(here, "start-bridge-siwc.mjs");
  const client = new Client({ name: "engineering-bridge-siwc-smoke", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, "--profile", profile, "--config", resolve(config)],
    stderr: "pipe"
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    const expected = ["bind_project", "control_task", "run_task", "task_result"];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected candidate MCP surface: ${names.join(", ")}`);
    }

    const started = parsedToolText(await client.callTool({
      name: "run_task",
      arguments: {
        workspace_id: workspaceId,
        instruction
      }
    }));
    if (typeof started.task_id !== "string") throw new Error("Candidate task did not return a task id.");

    if (interruptAfterMs !== undefined) {
      await new Promise((resolveWait) => setTimeout(resolveWait, interruptAfterMs));
      await client.callTool({
        name: "control_task",
        arguments: { task_id: started.task_id, action: "interrupt" }
      });
    }

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const view = parsedToolText(await client.callTool({
        name: "task_result",
        arguments: { task_id: started.task_id }
      }));
      if (view.state === "completed") {
        if (interruptAfterMs !== undefined) throw new Error("Interrupted smoke unexpectedly completed.");
        if (view.output !== expect) throw new Error(`Unexpected smoke output: ${String(view.output)}`);
        process.stdout.write(`${JSON.stringify({ ok: true, state: view.state, output: view.output })}\n`);
        return;
      }
      if (view.state === "failed") {
        if (interruptAfterMs !== undefined && String(view.error ?? "").toLowerCase().includes("interrupt")) {
          process.stdout.write(`${JSON.stringify({ ok: true, state: view.state, interrupted: true })}\n`);
          return;
        }
        throw new Error(`Candidate task failed: ${String(view.error ?? "unknown error")}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    throw new Error("Candidate task timed out waiting for completion.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "SIWC live smoke failed."}\n`);
  process.exitCode = 1;
});
