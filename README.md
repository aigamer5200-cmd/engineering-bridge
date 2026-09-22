# Engineering Bridge

Engineering Bridge 1.4.2-biaogu.12 是一個本機 MCP STDIO transport，直接連接
官方 Codex CLI app-server。它可以在核准的 project root 內綁定既有專案、啟動
Codex task、讀取 task 狀態，並中斷執行中的 task。

公開 MCP tool surface 嚴格只有四個：

- `bind_project(project_path, confirmation: "BIND")`
- `run_task(workspace_id, instruction, model?, reasoning?)`
- `task_result(task_id)`
- `control_task(task_id, action: "interrupt")`

`run_task` 省略 model 或 reasoning 時使用 `gpt-5.6-luna` 與 `max`；明確提供的
值會原樣傳給 Codex turn。其他 app-server 選項保持省略，交由官方 Codex 預設值
處理。

`task_result` 直接回傳 `running`、`completed` 或 `failed`。中斷後的 task 會以
安全的 `TASK_INTERRUPTED` 錯誤結束，必要時附帶受限的 partial output。task 狀態
只保留在目前 Bridge process；workspace binding 會保存到 sidecar。

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
workspace。Bridge 支援分段 JSONL frame、安全解析與最多 16 MiB 的 transport
frame，並限制回傳 evidence。一般執行沒有 Bridge deadline 或 inactivity watchdog；
只有 explicit interrupt 會觸發受限的 child cleanup。

## 驗證

```sh
npm run typecheck
npm test
```

舊 governance 與 proposal modules 仍保留在 source tree 供相容性使用，但 active
MCP composition 不會載入它們。
