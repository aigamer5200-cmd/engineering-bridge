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

## Optional Codex account/profile routing boundary

2026-09-05 Owner 已核准 GOAL 未來以 optional account-router + upstream-derived
`xjoker/codex-switch` 支援多 Codex account/profile，但 **Engineering Bridge Core 不得
因此硬依賴該 plug-in**。

- account router 是 GOAL optional capability，不是 Bridge lifecycle / task authority；
- module disabled/absent/unhealthy/rollback 時，Bridge 既有 native Codex path 必須仍可用；
- 未來若 Bridge contract 增加 profile/account input，必須 explicit、task-scoped、可觀察，
  omitted 時完整保留 current default behavior；
- account/profile selection 不增加 workspace、repo write、C/P、I/W、deploy、production、
  Browser/Desktop、Human-Gate 或 delete authority；
- plug-in 自身更新由 GOAL modular policy 管理：`candidate -> validation -> current`，保留
  `previous` / last-known-good；bad candidate 不得直接覆蓋 active module；
- credential/profile secret 不得進 Bridge repo、config examples、logs、execution receipts。

Current Bridge API **尚未**把 account/profile selector 宣告為已實作功能；不得因這份治理
文件把 planned architecture 誤報成 runtime capability。

Canonical authority：

- `D:\shoestring-goal\docs\policies\MODULAR_CAPABILITY_INTEGRATION_POLICY.md`
- `D:\shoestring-goal\docs\CODEX_MULTI_ACCOUNT_PLUGIN.md`
- `D:\AI_Knowledge_Base\wiki\global\CODEX_MULTI_ACCOUNT_PLUGIN.md`

