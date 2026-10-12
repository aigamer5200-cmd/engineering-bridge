# Engineering Bridge｜Codex 長任務靜默監測 Phase 1（2026-10-12）

## 本次決策與範圍

- 分支：fix/bridge-codex-idle-watch-20261012
- Worktree：D:/WORKTREE_ZONE/engineering-bridge-idle-watch-20261012
- 起點：origin/main@17999a2b333d8d79a8bb1e6c280c945109642eaf
- 正式 Runtime 仍為 1.4.2-biaogu.16；本次沒有升級、切換、停止或重啟現役 Bridge／DS／Blue／Green。
- Owner 需求：複雜任務長時間沒有協定訊息，不得僅因時間變長就誤判失敗、殺掉 Codex。
- 本次只針對薄型 src/transport/codex-app-server.ts（正式 Secure MCP 的 run_task 路徑）。沒有修改舊版 src/executors/codex-executor.ts 或其執行期限，不能擴大宣稱所有舊 executor 均無逾時。

## 原因與修正

- 既有正式 Bridge 在 Codex turn/start 成功後，若 120 秒沒有符合 thread/turn 的協定事件，就報 Codex app-server stopped responding 並嘗試終止子程序。
- 本次移除 120 秒靜默即終止，改為預設每三分鐘以 Node.js 本機計時器做一次唯讀觀察，不呼叫 DS、不呼叫 AI，也不對進行中的 Codex 傳輸探測要求。
- 觀察資料透過既有 task_result 增加選用 health 欄位：state、process_state、last_protocol_at、last_checked_at、quiet_for_ms、checks、observation。
- quiet_unconfirmed 表示「靜默、無法確認是否卡住」，不是錯誤也不觸發停止；no_exit_observed 只是尚未觀察到程序退出，不是證明 Codex 一定健康。
- 完成、真正程序退出、非法協定、RPC 建立階段逾時（30 秒）以及使用者手動中止仍維持原有處理方式。
- 無定時總時長強制取消（本次薄型傳輸本來就沒有總時長 kill）。
- 不發送自動每三分鐘 DS 呼叫，避免 Web 對話關閉、工具限額或連線重整影響原本健康的長任務。

## 技術與驗證

- 新增單元測試：純安靜任務可連續跨過多個縮短的巡檢週期後正常完成；安靜任務仍可手動中止；健康摘要可由 taskView 讀出且不洩漏 instruction。
- 型別檢查：PASS；初輪目標測試 44/44 PASS。
- 全套 npm test 初輪：430 PASS、0 FAIL、5 SKIP。
- 提交前需重新執行最後改動後的 typecheck／focused tests，並完成 staged diff／Git 安全查核。
- 本次測試使用縮短的監測間隔模擬多次巡檢；正式版 180 秒的自然長任務持續性／Canary E2E 仍需後續驗證，不能將 unit tests 冒稱 Production 驗收。

## 下一步與禁止操作

1. DS 完成最後型別、精準測試、git diff --check、選擇性 C/P。
2. 部署前應由獨立 Canary 驗證 App Server 從啟動到 turn 完成、120 秒以上靜默不中止、任務狀態可讀、取消仍有效。
3. 先確認目前正在執行的 Bridge tasks 不會被 Runtime switch 中斷，再依 Bridge 既有 Production Human Gate、備份、回滾流程執行 I/W 與部署。
4. 不動 DS Tunnel、Blue／Green Secure MCP、Cloudflare、帳號、模型路由、Codex CLI、GOAL、使用者正式專案。
5. 修補後的新狀態只代表候選版；在 Owner I/W／正式部署前，現役正式 Bridge 的 120 秒限制仍存在。

下一視窗可直接由本 Handoff 與已推送分支繼續，不依賴前一 Codex／DS 對話。
