# HANDOFF｜Engineering Bridge Codex Full Access｜2026-09-08

## Current checkpoint

```text
source_worktree = D:/WORKTREE_ZONE/engineering-bridge-v1.4.2-biaogu-20260906-dc46235c
source_branch = feature/bridge-codex-full-access-20260908
source_base = 93a3b60f084acdde3d102bbd6d8a56c6a7940231
release_version = 1.4.2-biaogu.2
checkpoint = commit containing this HANDOFF / branch HEAD
```

Owner request：Bridge 啟動的 Codex CLI 必須可使用「完整存取權」，避免普通工程任務被
Bridge 固定 read-only sandbox 阻塞。

## Implemented

- MCP `run_task`：Codex 預設 `danger-full-access`。
- Codex caller 可明確降權為 `workspace-write` / `read-only`。
- app-server mapping：
  - `thread/start.sandbox = danger-full-access`
  - `turn/start.sandboxPolicy.type = dangerFullAccess`
- `continue` 保留原 task sandbox。
- `task_result` 與 Bridge-authored execution receipt 誠實記錄 `sandbox` 與
  `read_only`。
- 舊 execution receipt 若沒有 `sandbox` 且 `read_only=true`，仍以
  `read-only` 相容讀取。
- DSH 仍固定 read-only，任何 sandbox expansion 均 fail closed。
- controlled-patch generate/refine 仍為 read-only；`authorize_workspace_write`
  只控制 `APPLY`，不再被誤認為 Codex full-access 開關。

## Explicitly unchanged

- 不讀、不改、不輸出 Codex token/auth payload。
- 不修改 `C:/Users/User/.codex` credential state。
- 不改 controlled-patch `APPLY` / `COMMIT` confirmation contract。
- 不替 target repo 自動取得 push / I/W / production / secret authority。
- DSH 不升權。

## Validation

```text
npm ci                                             PASS
npm run typecheck                                  PASS
focused full-access regression                     118 / 118 PASS
npm test                                           380 PASS / 5 SKIP / 0 FAIL
git diff --check                                   PASS
```

The `npm ci` audit reported two pre-existing dependency advisories (1 moderate,
1 high). They are not changed by this sandbox feature and are recorded as
non-blocking pending rather than expanded into this permission fix.

## Promotion plan

Use the existing simplified guarded Bridge upgrade path:

1. selective C/P this exact feature checkpoint;
2. build immutable `1.4.2-biaogu.2` candidate runtime;
3. start isolated Canary on port 8769;
4. bind/create a disposable test workspace under the approved Worktree root;
5. execute Codex `run_task` without a sandbox override and prove:
   - returned sandbox = `danger-full-access`;
   - execution receipt `read_only=false`;
   - Codex can create/read a harmless marker inside only the disposable test
     workspace;
6. verify DSH / controlled-patch read-only regression;
7. only after Canary PASS, switch Production 8768 to `1.4.2-biaogu.2` and run
   immediate MCP/health/full-access smoke;
8. retain `1.4.2-biaogu.1` as rollback runtime.

Do not I/W this feature branch into the fork mainline without separate Owner
authorization. Another fresh session can continue from this HANDOFF + branch
HEAD without depending on any previous Codex native thread.
