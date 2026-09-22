# Architecture

Engineering Bridge 1.4.2-biaogu.12 is a local MCP STDIO transport with one
active executor: the official Codex CLI app-server.

The active path has three small responsibilities:

1. `src/mcp-stdio.ts` loads trusted workspace configuration, preserves the
   `project_root` containment boundary, binds existing projects, and registers
   exactly `bind_project`, `run_task`, `task_result`, and `control_task`.
2. `ThinCodexTaskService` resolves a registered workspace, creates a UUID,
   starts one Codex executor, retains running or terminal state in memory, and
   exposes the interrupt seam.
3. `CodexExecutor` starts `codex app-server --stdio`, performs the official
   initialize/thread/turn JSON-RPC exchange, forwards the selected model and
   reasoning effort, collects bounded evidence, parses large JSONL frames, and
   cleans up the child process after completion or explicit interruption.

The active service never selects another executor, creates a project,
authorizes a write path, or waits for a review transition. Task states are
`running`, `completed`, and `failed`. An interruption is represented as a
failed task with a safe `TASK_INTERRUPTED` error and optional partial output.

The only task-local choices are the model and reasoning fields. Omission uses
`gpt-5.6-luna` and `max`; explicit values are passed through. The active
executor leaves all other app-server policy and capability options absent so
the official Codex defaults remain authoritative. Workspace `cwd`, protocol
client metadata, task input, model, and reasoning are the only task parameters
Bridge constructs.

Codex JSON-RPC is newline-delimited. The parser buffers chunked input, accepts
valid frames up to 16 MiB, rejects malformed shapes safely, and bounds evidence
and diagnostics. Each RPC call has a bounded response timer to prevent a
leaked pending request. There is no normal execution deadline and no protocol
inactivity watchdog. Explicit interrupt uses the official interrupt request
when possible and then bounded child cleanup.

The managed workspace catalog remains a local sidecar because binding an
existing project must survive a Bridge restart. Task supervision state is
process-local and is not a durable execution receipt.

Older governance and proposal modules remain in the repository for source and
test compatibility, but `mcp-stdio.ts` does not import or activate them.
