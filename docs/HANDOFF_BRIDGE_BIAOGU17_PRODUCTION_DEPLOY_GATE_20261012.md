# Bridge 1.4.2-biaogu.17｜Production Deploy Gate (2026-10-12)

## FINAL DEPLOYMENT ACCEPTED — 2026-10-12 (supersedes earlier safety block)

- Owner 明確回覆目前 Blue／Green 沒有正在執行中、需要保留的任務，同意立即切換。
- 既有版本管理器執行 `switch --version 1.4.2-biaogu.17 --confirmation SWITCH`
  成功；`status=SWITCHED`，Blue 新 production PID 13120。
- Runtime current-root/current-version 指向
  `D:/Engineering_Bridge_System/BridgeVersions/1.4.2-biaogu.17`，
  `previous_version=1.4.2-biaogu.16`。
- 使用正式 `STOP_Secure_MCP_Bridge.bat` 關閉舊 Green，回報
  `SECURE_MCP_BRIDGE_STOP_PASS`，期間 Blue 保持 READY。
- 使用正式 `START_Secure_MCP_Bridge.bat` 重啟 Green，回報
  `SECURE_MCP_BRIDGE_START_PASS`，HTTP /readyz=200。控制腳本
  輸出 PASS，但工具 session 仍持續占用輸出 handle；後續以實際連線驗證。
- Green 新連線實際呼叫 `gpt-6.1-sol / medium / standard` 回覆
  `BRIDGE_GREEN_BIAOGU17_OK`，`task_result` 包含新 `health`
  結構（running 及 completed 均可讀），可證實 Green 載入 .17 而非只看 Tunnel READY。
- Blue 新連線實際呼叫同模型回覆 `BRIDGE_BLUE_BIAOGU17_OK`，
  `task_result.health` 同樣成功。
- 切換後版本管理器 `verify`：PASS；MCP unauth local/public 401、
  OAuth metadata local/public 200，Codex provider pointers 正常。
- Root 系統 `CHECK_CHANNELS.bat` Exit 0；DevSpace Blue／Green、Bridge
  Blue／Green、local/public OAuth、Cloudflare metrics 和 Recovery 全部 READY。
- 不動 DS、Tunnel ID/profile、帳號、GOAL、模型路由、任何正式產品 Repository。
  舊 .16 immutable runtime 完整保留；不需重新建立 OpenAI/Cloudflare connector。

### 殘留註記

- 本次之前已有隔離真實時間 125 秒靜默協定模擬 PASS，證明不再因
  120 秒靜默無條件殺掉；本次正式環境完成的是真實短任務 Blue／Green
  往返，尚未額外佔用模型執行一個真正的 125 秒全靜默長任務。
- 健康觀察中的 `quiet_unconfirmed` 不代表真正卡死，只供監測與後續 DS 排查。
- 若正式日後出現確定性退化，可用版本管理器受控回滾到 .16；
  回滾前仍需確認沒有正在執行中的 Codex 任務。

以下原始 PREPARED／BLOCKED 段落保留為切換之前的歷史查核證據，
**不再代表目前狀態**。

## Release and intent

- Owner explicitly approved formal Production deployment after source I/W.
- Canonical source main release commit: aafd08aa61e94d32feef413b1a8f95f8cb060801
- Release version: 1.4.2-biaogu.17.
- Intended fix: replace thin Codex app-server 120-second silent-turn termination with 180-second observation-only health sampling. No change to model/account routing, existing Blue/Green ingress, GOAL, DS, OAuth, or credentials.

## PREPARED / CANARY-PASS (not yet switched)

- Immutable candidate root: D:/Engineering_Bridge_System/BridgeVersions/1.4.2-biaogu.17
- Manifest commit: aafd08aa61e94d32feef413b1a8f95f8cb060801
- Manifest lock SHA256: 2DBE59CAD9E03068EA97ED5E0E5240CAE488E8573A65E5ABAE11B40826DC39E1
- Version manager prepare: npm ci PASS, typecheck PASS, npm test PASS, build PASS.
- Version manager canary: PASS, four MCP tools, real Codex tasks, sandbox unchanged, loopback-only port 8769.
- Prior source-integration tests: 430 PASS / 0 FAIL / 5 SKIP, candidate real app-server smoke PASS, 125-second wall-clock silent protocol simulation PASS.
- Existing immutable 1.4.2-biaogu.16 remains the current production root and future immediate rollback candidate. The manager's pre-switch state still lists .15 as the previous version until the authorized switch succeeds.

## DEPLOYMENT BLOCKED BY ACTIVE-PROCESS SAFETY GATE

- Blue had an app-server process tree with node PID 41012 -> codex PID 5496 (started ~13:29 Taiwan).
- Green had an app-server process tree with node PID 41056 -> codex PID 45896 (started ~13:37 Taiwan).
- Independent ChatGPT desktop Codex PID 40020 was deliberately excluded from any Bridge control.
- Both Bridge app-server trees remained present on repeated read-only checks, with nearly unchanged CPU usage. Low CPU is NOT sufficient evidence that a task finished.
- Existing thin Bridge interface has no cross-session task-enumeration or guaranteed drain proof; no safe conclusion can be made that these long-running app servers are idle/orphaned.
- To honor the Owner's no-interruption objective, DID NOT run version-manager switch, stop/start Bridge, force-kill, change runtime pointers, alter tunnels, or change current auth/profile.

## Current verified live health

- Current runtime / pointer: 1.4.2-biaogu.16
- Version manager production verify: PASS. Local /mcp unauth 401; local OAuth 200; public /mcp unauth 401; public OAuth 200.
- Secure MCP Green /readyz HTTP 200.
- Candidate 1.4.2-biaogu.17 canary report: PASS and commit/lock bound.

## Next gate — no silent override

1. Determine that every affected Bridge-backed Codex turn has ended by authoritative task result / Owner confirmation; process presence alone must not be interpreted as safe to kill.
2. Verify no new Bridge task dispatch and Blue/Green active sessions drained before cutover.
3. Run the existing version manager switch using target 1.4.2-biaogu.17 and exact confirmation SWITCH.
4. Verify local/public OAuth, Bridge Blue and Secure MCP Green path, authenticated real Codex task, task_result.health and optional long-task semantics. If the Green bridge was kept live across pointer switch, arrange a guarded Green lifecycle with no active turns to ensure it actually loads .17. Do not claim both lanes updated based on pointer alone.
5. On verified regression, immediately use the preserved .16 rollback candidate and relevant native control scripts; never restart an active turn without explicit authorization.

This is an honest partial deployment checkpoint: RELEASE BUILT and CANARY ACCEPTED, PRODUCTION SWITCH NOT EXECUTED.
