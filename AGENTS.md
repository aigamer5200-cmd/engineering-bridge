# Engineering Bridge Agent Rules

本 repo 的實際軟體開發工作遵守 Shoestring GOAL 的全域 TG 停流規則。

- 一旦 development execution 已開始，只要目前 user-visible task 真的停止、等待或
  yield，就必須先發 Telegram；原因分類不影響是否通知。
- bounded tool yield、polling、立即且無縫的 retry/recovery 只有在整體任務從未
  真的停下時才不通知。
- GOAL-managed stop delivery 採 fail-closed：`complete`、`block`、`interrupt`、
  `pause`、`codex-failure` 只有 `telegram_status=delivered` 才算成功；
  `STOP_AND_NOTIFY_REQUIRED` 在真正通知完成前仍是 non-success；不允許
  `--no-telegram` bypass；stop-intent launcher failure 必須走 canonical
  last-resort notifier 並保留原 nonzero exit status。
- 自動化 non-GOAL caller 使用
  `D:\shoestring-goal\scripts\notify_development_stop.ps1` 並提供 stable EventId。
- Bridge 若提供 development-stop notification helper，只能是 notification-only；
  不得增加或改變 workspace、Codex、GOAL、repo write、C/P、I/W、deploy、
  production 或 Human-Gate authority。

Canonical authority：

- `D:\shoestring-goal\docs\policies\DEVELOPMENT_STOP_NOTIFICATION_POLICY.md`
- `D:\AI_Knowledge_Base\wiki\global\DEVELOPMENT_STOP_NOTIFICATION.md`

