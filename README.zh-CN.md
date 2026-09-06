# Engineering Bridge

中文 README 已成为仓库默认首页：[简体中文](README.md)

English README: [English](README.en.md)

## 受控补丁验证（可选）

校验是可选、按需的：使用 `configure_validation_profile` 为每个已登记工作区配置最多一个固定校验 profile，并要求精确 `CONFIGURE`（不复用 `AUTHORIZE`）；只有显式调用 `validate_controlled_patch` 才会运行校验，且该调用只接受 `patch_task_id`，不能携带命令、argv、shell 文本或超时。`apply_controlled_patch` 不会自动运行校验或测试，普通 Bridge 路径不变，也没有后台校验 worker/queue。命令是非空 argv 数组、不用 shell 字符串，省略超时时默认每步 600 秒、总预算 1200 秒。结果只有 `PASS`、`FAIL`、`INCOMPLETE`；unborn 仓库提案返回 `INCOMPLETE` 且 `reason: "unsupported_unborn_base"`。validation profile 与现有持久状态一起保存在三个本地 0600 sidecar 中，其中包括 `<config>.validation-profiles.json`。校验在临时 detached worktree 中进行，只保护已登记工作区整洁，不是主机级沙箱；只应为可信工作区配置完全信任的命令。详见 [简体中文 README](README.md)。
