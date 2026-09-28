# Engineering Bridge

Engineering Bridge 1.4.2-biaogu.15 的使用说明请见
[简体中文 README](README.md) 与 [English README](README.en.md)。

当前 MCP 公开工具严格只有 `bind_project(project_path, confirmation="BIND")`、
`run_task(workspace_id, instruction, model?, reasoning?, service_tier?)`、`task_result(task_id)` 和
`control_task(task_id, action="interrupt")`。Codex CLI 及其本机配置负责模型选择和
原生执行行为。Bridge 不推断 GOAL 角色、不选择 routing default；只有 caller 明确提供
`model`、`reasoning`、`service_tier` 时，才以原生 app-server 字段做 task-local 透传。

四个工具均提供标准 MCP ToolAnnotations，让 MCP host 能明确区分只读、破坏性、幂等
和 open-world 行为；这些 annotations 只是 client 行为提示，不是安全边界。
