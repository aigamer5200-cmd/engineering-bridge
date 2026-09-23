# Engineering Bridge

Engineering Bridge 1.4.2-biaogu.13 is a local MCP STDIO transport for the
official Codex CLI app-server. The CLI and its local configuration own model
selection and native execution behavior. Bridge starts tasks, returns their
state and output, and can interrupt a running task.

The public MCP surface contains exactly four tools:

- `bind_project(project_path, confirmation="BIND")`
- `run_task(workspace_id, instruction)`
- `task_result(task_id)`
- `control_task(task_id, action="interrupt")`

Bridge does not send model selection or task policy overrides to the app-server.
`thread/start` sends only the workspace cwd. `turn/start` sends only the native
thread ID, user input, and workspace cwd.

Task results report `running`, `completed`, or `failed`, with optional native
thread ID, output, error, or partial output. Task state is process-local; the
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
as its working directory. Windows npm Codex shims are resolved to the official
`codex.js` target without using a shell. JSONL frames are bounded at 16 MiB,
RPC responses have transport timers, and interrupt cleanup is bounded so
child processes cannot remain attached to the transport.

## Validation

```sh
npm run typecheck
npm test
```

The older governance and proposal modules remain in the source tree for
compatibility, but they are not imported by the active MCP composition.
