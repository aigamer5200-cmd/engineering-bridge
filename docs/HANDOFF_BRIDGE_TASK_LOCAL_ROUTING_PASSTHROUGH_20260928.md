# Handoff: Bridge Task-Local Routing Passthrough Repair (2026-09-28)

## Objective

Repair only the active thin/pure Engineering Bridge transport so `run_task`
can pass through optional caller-supplied `model`, `reasoning`, and
`service_tier` values. The Bridge must not infer GOAL roles or choose routing
defaults.

## Durable checkpoint

- worktree: `D:\WORKTREE_ZONE\engineering-bridge-5090287d`
- repository: Engineering Bridge
- branch: `fix/bridge-task-routing-passthrough-20260928`
- source checkpoint before this repair: `6c55f4e5094ce2be6672a9dd25b3df12dc368552`
- implementation checkpoint: `f663b657507ea44a992c226a6e4041fce4916a21`
- current package version: `1.4.2-biaogu.15`
- implementation is C/P'd on the feature branch; no integration, deploy, or
  production action was performed.

## Implemented

- `run_task` accepts optional `model`, `reasoning`, and `service_tier` fields;
- omitted routing fields remain absent from the executor request and native
  `thread/start` / `turn/start` JSON, preserving native Codex/local behavior;
- explicit `model` and `service_tier` map to native `model` and `serviceTier`
  on both starts;
- explicit `reasoning` maps to native `effort` on `turn/start`;
- `task_result` reports only explicitly requested, non-secret routing
  provenance;
- the public MCP tool count remains exactly four and existing ToolAnnotations
  remain unchanged;
- no shell routing arguments, model-list call, account/profile routing,
  governance, sandbox, web-search, or other policy layer was added.

## Changed files

- `package.json`
- `package-lock.json`
- `src/mcp-stdio.ts`
- `src/tasks/thin-codex-task-service.ts`
- `src/transport/codex-app-server.ts`
- `tests/unit/mcp-stdio.test.ts`
- `tests/unit/codex-app-server-transport.test.ts`
- `tests/unit/tasks/thin-codex-task-service.test.ts`
- `README.md`
- `RELEASE_NOTES.md`
- this handoff file

## Verification

- `npm ci`: PASS; local dependencies restored. npm reported 3 dependency audit
  findings (2 moderate, 1 high); no audit fix was run.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- focused protocol/MCP/service command: 9 passed, 0 failed.
- `npm test`: 370 total, 365 passed, 0 failed, 5 skipped.
- `git diff --check`: PASS.
- `.tmp_appschema` diagnostic directory: removed.
- Independent DS verification repeated typecheck, build, the 9 focused tests,
  the complete 370-test regression, and `git diff --check`: all PASS with the
  same five platform-specific skips and zero failures.
- DS additionally aligned `README.en.md` and `README.zh-CN.md` to version
  `1.4.2-biaogu.15` and the optional routing-passthrough contract.
- Current official Codex CLI is `0.156.0`; generated app-server types confirm
  `thread/start` accepts `model` / `serviceTier` and `turn/start` accepts
  `model` / `serviceTier` / `effort`.

## Pending / constraints

- Do not modify legacy `CodexExecutor` routing, governance modules, account or
  profile selectors, auth material, global Codex configuration, deployment,
  integration, commit, or push as part of this repair.
- Another Web GPT/Codex account/session can continue from this handoff,
  `f663b657507ea44a992c226a6e4041fce4916a21`, and repository state without
  relying on the prior native Codex thread/session.
- Production remains `1.4.2-biaogu.14`. Do not activate `.15` until separate
  Owner I/W authorization. After I/W/production promotion, refresh the ChatGPT
  Engineering Bridge connector so its discovered `run_task` schema exposes the
  three new optional fields, then run one bounded real task with explicit
  routing and verify the returned provenance before resuming A/B/C/D role
  dispatch.
