# Engineering Bridge

Engineering Bridge 1.4.2-biaogu.12 is a local MCP STDIO transport for the
official Codex CLI app-server. It binds existing projects under an approved
root, starts Codex tasks, returns their state, and can interrupt a running
task.

The public MCP surface contains exactly four tools:

- `bind_project(project_path, confirmation: "BIND")`
- `run_task(workspace_id, instruction, model?, reasoning?)`
- `task_result(task_id)`
- `control_task(task_id, action: "interrupt")`

`run_task` uses `gpt-5.6-luna` and `max` when the two optional model fields are
omitted. Explicit values are passed to the Codex turn unchanged. The Bridge
leaves every other app-server option absent so the official Codex defaults
remain authoritative.

Task results report `running`, `completed`, or `failed` directly. A task that
is interrupted ends as `failed` with a safe `TASK_INTERRUPTED` error and may
include bounded partial output. Task supervision is process-local; the managed
workspace binding is the only sidecar state retained across restarts.

## Configuration

Build the project with Node.js 22 or newer:

```sh
npm install
npm run build
```

The STDIO entry point accepts one absolute path to a JSON configuration file:

```json
[
  { "id": "my-project", "root": "/absolute/path/to/my-project" },
  { "kind": "project_root", "root": "/absolute/path/to/projects" }
]
```

Manual entries are available immediately. `bind_project` can register an
existing directory below a `project_root`; paths are checked using canonical
real-path containment. Binding persists the managed workspace ID to
`<config>.managed-workspaces.json`.

An MCP client should launch:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/engineering-bridge/dist/src/mcp-stdio.js",
    "/absolute/path/to/engineering-bridge/workspaces.json"
  ]
}
```

Codex is launched as `codex app-server --stdio` with the registered workspace
as its working directory. JSONL input is parsed safely, valid frames up to the
defensive 16 MiB transport bound are accepted, returned evidence is bounded,
and short RPC responses have transport timers. Normal execution has no Bridge
deadline or inactivity watchdog; interrupt cleanup is bounded so child
processes cannot remain attached to the transport.

## Validation

```sh
npm run typecheck
npm test
```

The older governance and proposal modules remain in the source tree for
compatibility, but they are not imported by the active MCP composition.
