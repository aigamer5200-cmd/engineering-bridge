# Engineering Bridge

Engineering Bridge 1.4.2-biaogu.13 是一個本機 MCP STDIO transport，直接連接
官方 Codex CLI app-server。Codex CLI 與本機設定負責模型選擇及原生執行行為；
Bridge 負責啟動 task、回報 task 狀態與輸出，以及中斷執行中的 task。

公開 MCP tool surface 嚴格只有四個：

- `bind_project(project_path, confirmation="BIND")`
- `run_task(workspace_id, instruction)`
- `task_result(task_id)`
- `control_task(task_id, action="interrupt")`

Bridge 不會將模型選擇或 task policy override 傳入 app-server。`thread/start` 只傳送
workspace cwd；`turn/start` 只傳送 thread ID、使用者輸入及 workspace cwd。

`task_result` 只回傳 task ID、狀態、executor、thread ID、輸出或錯誤。task 狀態只
保留在目前 Bridge process；workspace binding 會保存到 sidecar。

## 設定

需要 Node.js 22 或更新版本：

```sh
npm install
npm run build
```

STDIO entry point 接受一個 JSON 設定檔絕對路徑：

```json
[
  { "id": "my-project", "root": "/absolute/path/to/my-project" },
  { "kind": "project_root", "root": "/absolute/path/to/projects" }
]
```

`bind_project` 只能註冊 `project_root` 內已存在的資料夾，並使用 canonical
real-path containment 檢查邊界。binding 會寫入
`<config>.managed-workspaces.json`。

MCP client 啟動方式：

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/engineering-bridge/dist/src/mcp-stdio.js",
    "/absolute/path/to/engineering-bridge/workspaces.json"
  ]
}
```

Codex 以 `codex app-server --stdio` 啟動，working directory 是已綁定的
workspace。Bridge 會安全解析最多 16 MiB 的 JSONL frame，並原樣回傳 final agent
output；Pure Transport 不提供 evidence。一般執行沒有 Bridge deadline 或 inactivity watchdog；
只有 explicit interrupt 會觸發受限的 child cleanup。

## 驗證

```sh
npm run typecheck
npm test
```

舊 governance 與 proposal modules 仍保留在 source tree 供相容性使用，但 active
MCP composition 不會載入它們。
