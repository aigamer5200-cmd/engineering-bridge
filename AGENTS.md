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

## Global phase checkpoint / HANDOFF hard rule

本 repo 的一般開發與 GOAL-managed 開發都必須遵守：

```text
階段完成 -> 整理 Repo -> 更新 HANDOFF -> C/P -> 下一階段／換帳號／換視窗
```

- 每一個正式 phase-complete C/P 前都必須先更新 durable HANDOFF，且 HANDOFF 要跟該
  checkpoint 一起進 Git；不能只留在聊天、開場白或上一條 Codex session。
- HANDOFF 至少記錄：最新 branch / checkpoint commit reference、已完成、pending、已知
  問題與禁止碰範圍、測試/驗證、下一步明確任務、WT/repo 狀態，以及另一個 Codex
  account/session 可不依賴上一條 native session 直接接手的聲明。
- A/B account 切換必須建立新的 account-bound Codex native session/thread；不得把 A 的
  native thread 直接換成 B。新的 account 從 durable HANDOFF + repo state 恢復。
- intermediate C/P 仍不構成 Human Gate；HANDOFF + C/P 後直接繼續剩餘工作。final C/P
  仍依既有 TG / I/W Human Gate 規則處理。

Canonical authority：

- `D:\shoestring-goal\docs\policies\CHECKPOINT_POLICY.md`
- `D:\AI_Knowledge_Base\wiki\DEVELOPMENT_WORKFLOW.md`

## Optional Codex account/profile routing boundary

2026-09-05 Owner 已核准 GOAL 未來以 optional account-router + upstream-derived
`xjoker/codex-switch` 支援多 Codex account/profile，但 **Engineering Bridge Core 不得
因此硬依賴該 plug-in**。

- account router 是 GOAL optional capability，不是 Bridge lifecycle / task authority；
- module disabled/absent/unhealthy/rollback 時，Bridge 既有 native Codex path 必須仍可用；
- Current feature implementation 已加入 Codex-only `account` input；必須 explicit、
  task-scoped、可觀察，omitted 時完整保留 current default behavior；
- account/profile selection 不增加 workspace、repo write、C/P、I/W、deploy、production、
  Browser/Desktop、Human-Gate 或 delete authority；
- plug-in 自身更新由 GOAL modular policy 管理：`candidate -> validation -> current`，保留
  `previous` / last-known-good；bad candidate 不得直接覆蓋 active module；
- credential/profile secret 不得進 Bridge repo、config examples、logs、execution receipts。
- account-routed process 必須同時使用 dedicated `CODEX_SWITCH_HOME` + dedicated
  `CODEX_HOME`；不得把 optional multi-account plug-in 指向 Owner native `~/.codex`。

Current first slice 只接受 explicit alias（例如 A/B）。Alias 必須通過 GOAL-provided
allowlist；指定 account 才載入 optional `xjoker/codex-switch` adapter。`AUTO` 目前
fail-closed，不得靜默挑選一個無法在 dispatch/receipt 證明的 account。

Current `main` 已包含 first-slice explicit A/B routing，以及 Codex-only exact reasoning
routing（`reasoning -> turn/start.effort`）。2026-09-05 Profile Selector / reasoning integration
已完成 C/P + Owner I/W；B 四組 real-turn E2E 已成功，A 目前僅因 long-window quota exhausted
而待補 real-turn E2E。不得為了關閉測試偷切 B、降 reasoning 或換 model。`AUTO` 仍維持
fail-closed。

2026-09-05 Profile Selector extension 另外允許 GOAL 將既有 explicit `account` 與 exact
`model`、exact `reasoning` 綁成 session Active Profile。Bridge `run_task` 的 `reasoning`
只適用 Codex，必須映射到 native app-server `turn/start.effort`；`model` 維持
`thread/start.model` 且禁止 provider model fallback。DSH + model/reasoning/account 必須
fail-closed。`task_result` / execution receipt 只可保存非敏感 routing provenance，絕不可
保存 token、auth.json、email、OAuth/API secret。Selector 本身仍屬 GOAL optional layer；
不用 Selector 時 Bridge/Core 原路徑不得受影響。

Canonical authority：

- `D:\shoestring-goal\docs\policies\MODULAR_CAPABILITY_INTEGRATION_POLICY.md`
- `D:\shoestring-goal\docs\CODEX_MULTI_ACCOUNT_PLUGIN.md`
- `D:\shoestring-goal\docs\CODEX_PROFILE_SELECTOR.md`
- `D:\AI_Knowledge_Base\wiki\global\CODEX_MULTI_ACCOUNT_PLUGIN.md`

