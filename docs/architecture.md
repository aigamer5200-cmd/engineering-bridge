# Architecture

This document describes the Engineering Bridge V1 (1.2.0) behavior.

Engineering Bridge is a local STDIO MCP server with nine tools and a small layered structure:

1. `src/mcp-stdio.ts` loads trusted workspace configuration (manual entries plus `project_root` approved roots), loads the managed-workspace catalog, registers all nine tools (`run_task`, `task_result`, `control_task`, `bind_project`, `create_project`, `authorize_workspace_write`, `generate_controlled_patch`, `refine_controlled_patch`, `apply_controlled_patch`), and connects the MCP STDIO transport.
2. `RegisteredWorkspaceRegistry` maps fixed caller-visible IDs to absolute configured roots, distinguishing manual registrations (authoritative through `workspaces.json`) from managed registrations. `ManagedWorkspaceCatalog` persists managed registrations and their controlled-write authorization to `<config>.managed-workspaces.json` with atomic 0600 writes. `WorkspaceOnboardingService` implements `bind_project`/`create_project` (exact `BIND`/`CREATE`, canonical containment inside `project_root`) and `authorize_workspace_write` (exact `AUTHORIZE`, managed workspaces only, persist-before-apply).
3. `RegisteredWorkspaceTaskService` assigns UUID task IDs and holds task, supervisor-review, thread, output, partial-output, error, and evidence state in process memory. It resolves the requested executor through an `ExecutorFactory` and drives `CodexExecutor` or `DshExecutor`. `ExecutionReceiptStore` separately persists bounded Bridge-authored provenance for successful read-only Codex executions to `<config>.execution-receipts.json` with serialized mutation, 0600 temporary files, an explicit file `sync()` before atomic rename, and a fixed retention cap; it stores no prompt or executor output and grants no write authority. This is process-restart persistence, not a claim of full filesystem/power-loss journaling.
4. `CodexExecutor` starts the local `codex app-server --stdio` protocol with fixed read-only task settings. `DshExecutor` starts the official headless `dsh` interface with a per-process `DSH_PERMISSION_MODE=read-only` pin and an explicit environment allowlist (including `DEEPSEEK_API_KEY` and `DSH_TOOLS_MODE`; proxy variables excluded). `ControlledPatchService` records proposal metadata (persisted to `<config>.controlled-patches.json`) and uses fixed Git commands to validate and apply reviewed patches.

On Windows, Codex provider selection is deliberately package-stable. When PATH exposes a valid global npm `codex.cmd` whose sibling `node_modules/@openai/codex/bin/codex.js` exists, `CodexExecutor` selects that official global npm installation before any directly spawnable `codex.exe` (for example a VS Code extension-bundled copy). The npm shim itself is never executed through `cmd.exe`; Bridge launches its resolved JavaScript target with `process.execPath`. If the global npm package is absent or incomplete, normal direct-executable resolution remains the fallback. Local `node_modules/.bin` shims are still supported, but they do not outrank a real executable merely because global-provider preference is enabled.

Shoestring GOAL treats Bridge as the single formal Codex entrypoint. A caller may
use shell/DS execution for bounded provider diagnostics, but a formal Codex task
must be represented by a Bridge task/proposal and its task identity. Recovery
must distinguish task-local stalls from provider failure: a stale task/thread,
stdin/EOF wrapper issue, internal Codex delegation/memory stall, Windows
sandbox/SID/Git-ownership friction, or project write-authority conflict causes a
fresh Bridge task while keeping the Codex executor lane. It does not justify
advancing from global npm to bundled or from Codex to another executor.

Repository mutation authority is deliberately outside Bridge provider
selection. `generate_controlled_patch` and `refine_controlled_patch` remain
read-only. `apply_controlled_patch` remains a generic exact-`APPLY` capability,
but a project may impose a stricter DS-only mutation rule; in that case the
proposal is applied by the project-authorized DS path and independently
regressed there.

Bridge provider selection is only the Codex layer of the wider Shoestring GOAL continuity chain. The orchestrator treats `CODEX_UNAVAILABLE` after the allowed provider fallback (and equivalent Codex-capacity unavailability) as a recoverable executor interruption when DS remains available: Telegram is emitted through the shared GOAL runtime, executor mode is switched durably to `web-gpt-ds`, and the same frozen GOAL continues under Web GPT direction with DS execution. Bridge itself does not invoke DevSpace or silently replace Codex with DS; that third-tier routing decision remains in the authoritative GOAL orchestration layer.

There is no HTTP server, UI, database, account system, background daemon, remote transport, or general command runner.

## Read-only supervised task flow

`run_task` is always read-only and accepts an optional `executor: "codex" | "dsh"` (default `codex`). Codex runs with approval `never`, a read-only sandbox policy, and network access disabled. The Codex executor starts native app-server threads with `thread/start`; after supervisor feedback it preserves the returned thread ID and uses `thread/resume`, followed by a new turn, so the conversation continues on the same Codex thread. The DSH executor runs each task as a headless invocation; it has no machine-resumable session seam, so a DSH `continue` is a new execution and no thread id is fabricated.

`task_result` reports `queued` or `running` with `ready: false`. A successful turn moves to `waiting_for_supervisor_review` with `ready: true` and `review_output`. For a successful Codex task it also exposes the matching **Bridge-authored durable `execution_receipt`** (`workspace_id`, exact registered `workspace_root`, `task_id`, executor, Bridge operation, `read_only: true`, receipt state, timestamp). The receipt is persisted independently of task supervision, contains no prompt/output text, and is provenance only—not write authorization or semantic acceptance. The response also includes the fixed `executor`, a real native `thread_id` when one exists (Codex only), the bounded, process-local `evidence` collected from command-execution and file-change protocol items, and `partial_output` when a genuine interrupt produced real partial output (the task still ends `failed`). Evidence is diagnostic task output, not authorization to write or proof that a requested semantic result is correct; when existing bounds truncate or evict evidence, explicit markers (`[truncated]`, changes-omitted counts, an `evidence-drop` item) make the incompleteness visible.

`control_task` supplies the supervisor transitions. `continue` requires a non-empty instruction while waiting for review and resumes the same Codex thread for another read-only turn (DSH: a new headless execution). Before a Codex continuation is queued, Bridge removes the previous ready receipt from the durable store; a new receipt is written only if the new turn reaches review again. This prevents stale prior-turn provenance from surviving a failed continuation. `steer` requires a non-empty instruction while a turn is running and sends it to that turn (Codex only). `interrupt` is valid only while running; an interrupted turn ends in `failed`, not in a resumable review state. `accept` is valid only while waiting for review and promotes the reviewed output to `completed` as `output` and upgrades the receipt state to `completed`.

Active task supervision state (tasks, threads, evidence, review outputs) is process-local and disappears on restart. Controlled-patch proposals/applied history, the managed workspace catalog, and bounded Codex execution receipts persist across restarts through their three dedicated state files. The execution-receipt store retains only the newest 500 valid records and deliberately omits prompt/output payloads. There is no automatic timeout, automatic acceptance, or general persistent task/audit history.

These executor parameters restrict writes performed by Codex and DSH, but Bridge does not create OS-level filesystem read containment. A same-user executor process may read paths outside the workspace when the operating system permits it.

## Controlled patch flow

Controlled writes are a separate path. `generate_controlled_patch` and `refine_controlled_patch` are read-only proposal flows available in any registered workspace; no write authorization is required. Generation verifies that the configured root resolves to the Git top-level and that tracked state and the index are clean (with an existing HEAD, or unborn-repository support for added-file proposals), records the base HEAD, and schedules the executor, still read-only, to produce a textual unified-diff proposal. Proposals and applied history persist to `<config>.controlled-patches.json`; invalid retained records are quarantined without blocking startup, while replay/applied ambiguity and global invariants fail closed.

`apply_controlled_patch` is the single controlled-write checkpoint: it requires controlled-write permission (managed `AUTHORIZE` or a manual `allow_write: true` entry), confirmation equal to exact, case-sensitive `APPLY`, a known completed proposal that has not already been applied, the original HEAD (including unborn base), a clean tracked worktree and index, and a safe unified text patch. Targets may modify existing tracked regular files or add an ordinary text file using exact mode 100644 when that path is absent from base HEAD, the current index, and the worktree. Bridge then runs fixed `git apply --check` and `git apply` commands without a shell. It does not run tests, stage, commit, or push.

The generation prompt asks the executor for a narrow valid diff, but prompt compliance is not a security boundary. Patch validation is code-enforced; whether the proposed semantic change is desirable remains a human review decision.
