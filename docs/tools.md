# MCP tool reference

Engineering Bridge 1.4.2-biaogu.12 is a thin local STDIO transport for the
official Codex app-server. Its public MCP surface contains exactly four tools.

## `bind_project`

Inputs: `project_path` and `confirmation`, which must equal `BIND` exactly.

Registers an existing directory inside a configured `project_root`. The path
must exist and pass canonical real-path containment. Managed registration is
persisted to `<config>.managed-workspaces.json` and remains read-only at the
Bridge registration layer.

## `run_task`

Inputs: `workspace_id`, `instruction`, and optional `model` and `reasoning`.

Starts one task through `codex app-server --stdio` in the registered workspace.
The Bridge supplies `gpt-5.6-luna` and `max` when those two fields are omitted.
Explicit values are passed through unchanged. The app-server receives only the
normal protocol fields plus the selected model and reasoning effort, so its
own defaults apply to every other option.

The call returns a UUID `task_id`. An unknown workspace is rejected before a
Codex process is started.

## `task_result`

Input: `task_id`.

Returns `state` as `running`, `completed`, or `failed` directly. Terminal
results include the final text or a safe serialized error. A real native
thread ID, bounded protocol evidence, and bounded diagnostics are included
when available. Unknown task IDs return `UNKNOWN_TASK`.

## `control_task`

Inputs: `task_id` and `action`, where the only accepted action is
`interrupt`.

Interrupt is valid for a running task. The Bridge sends the official
app-server interrupt request when a turn is ready, then performs bounded child
cleanup so a stopped process tree cannot remain attached to the transport.

## Workspace configuration

The STDIO entry point accepts one absolute path to a JSON configuration file:

```json
[
  { "id": "my-project", "root": "/absolute/path/to/my-project" },
  { "kind": "project_root", "root": "/absolute/path/to/projects" }
]
```

Manual entries are available immediately. `bind_project` can add an existing
directory under an approved `project_root`; there is no project creation or
authorization tool in the Phase 1 surface.

## Protocol boundary

Codex traffic is newline-delimited JSON. The transport accepts chunked frames
up to a defensive 16 MiB frame limit, parses each frame safely, bounds returned
evidence, and keeps short RPC response timers. Normal task execution has no
Bridge deadline or protocol inactivity watchdog. Explicit interrupt cleanup is
the only task-level termination path exposed by the active runtime.
