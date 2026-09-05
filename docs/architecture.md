# Architecture

This document describes the Engineering Bridge V1 (1.2.0) behavior.

Engineering Bridge is a local STDIO MCP server with nine tools and a small layered structure:

1. `src/mcp-stdio.ts` loads trusted workspace configuration (manual entries plus `project_root` approved roots), loads the managed-workspace catalog, registers all nine tools (`run_task`, `task_result`, `control_task`, `bind_project`, `create_project`, `authorize_workspace_write`, `generate_controlled_patch`, `refine_controlled_patch`, `apply_controlled_patch`), and connects the MCP STDIO transport.
2. `RegisteredWorkspaceRegistry` maps fixed caller-visible IDs to absolute configured roots, distinguishing manual registrations (authoritative through `workspaces.json`) from managed registrations. `ManagedWorkspaceCatalog` persists managed registrations and their controlled-write authorization to `<config>.managed-workspaces.json` with atomic 0600 writes. `WorkspaceOnboardingService` implements `bind_project`/`create_project` (exact `BIND`/`CREATE`, canonical containment inside `project_root`) and `authorize_workspace_write` (exact `AUTHORIZE`, managed workspaces only, persist-before-apply).
3. `RegisteredWorkspaceTaskService` assigns UUID task IDs and holds task, supervisor-review, thread, output, partial-output, error, and evidence state in process memory. It resolves the requested executor through an `ExecutorFactory` and drives `CodexExecutor` or `DshExecutor`. `ExecutionReceiptStore` separately persists bounded Bridge-authored provenance for successful read-only Codex executions to `<config>.execution-receipts.json` with serialized mutation, 0600 temporary files, an explicit file `sync()` before atomic rename, and a fixed retention cap; it stores no prompt or executor output and grants no write authority. This is process-restart persistence, not a claim of full filesystem/power-loss journaling.
4. `CodexExecutor` starts the local `codex app-server --stdio` protocol with fixed read-only task settings. `DshExecutor` starts the official headless `dsh` interface with a per-process `DSH_PERMISSION_MODE=read-only` pin and an explicit environment allowlist (including `DEEPSEEK_API_KEY` and `DSH_TOOLS_MODE`; proxy variables excluded). `ControlledPatchService` records proposal metadata (persisted to `<config>.controlled-patches.json`) and uses fixed Git commands to validate and apply reviewed patches.

On Windows, Codex provider selection is deliberately package-stable. When PATH exposes a valid global npm `codex.cmd` whose sibling `node_modules/@openai/codex/bin/codex.js` exists, `CodexExecutor` selects that official global npm installation before any directly spawnable `codex.exe` (for example a VS Code extension-bundled copy). The npm shim itself is never executed through `cmd.exe`; Bridge launches its resolved JavaScript target with `process.execPath`. If the global npm package is absent or incomplete, normal direct-executable resolution remains the fallback. Local `node_modules/.bin` shims are still supported, but they do not outrank a real executable merely because global-provider preference is enabled.

Codex **account/profile routing is intentionally a separate concern from
provider executable selection**. The optional task-scoped `account` field now
exists behind a thin GOAL adapter. Omitting it preserves the existing native
Codex behavior and does not load the plug-in. An explicit alias is validated
against `ENGINEERING_BRIDGE_CODEX_ACCOUNT_ALLOWLIST`, then the adapter starts
the configured immutable upstream-derived module as:

`codex-switch --json launch <alias> -- app-server --stdio`

`--json` suppresses wrapper pre-launch chatter, leaving the inner Codex
app-server as the active JSON-RPC stdout. The upstream launcher continues to own
profile staging/restore and token-refresh handling; Bridge does not reimplement
or persist auth material. On normal completion Bridge does not kill the wrapper
before its restore guard can finish. The executable and profile-store root are
supplied by GOAL through `ENGINEERING_BRIDGE_CODEX_SWITCH_EXECUTABLE` and
`ENGINEERING_BRIDGE_CODEX_SWITCH_HOME`. The account-routed child also receives a
dedicated isolated `CODEX_HOME` from
`ENGINEERING_BRIDGE_CODEX_MULTI_ACCOUNT_CODEX_HOME`; it must never use the
Owner's native `~/.codex`, because upstream profile discovery/list behavior may
auto-save the currently active native account.

Task/result/receipt state may contain the non-secret requested alias so the
supervisor can verify routing provenance. It never contains profile contents,
`auth.json`, access/refresh tokens, cookies, or browser state. `AUTO` is
intentionally unsupported in the first slice because the exact resolved account
must be provable in dispatch evidence rather than guessed after execution.

Codex model and reasoning routing are also explicit task-scoped inputs. Model is
sent through native app-server `thread/start.model` with provider model fallback
disabled. Reasoning is sent through `turn/start.effort` and is preserved for
subsequent turns. Bridge does not guess a config key, lower the requested effort,
or silently retry with another model. `task_result` and the durable execution
receipt may persist only the non-secret routing provenance (`model`, `reasoning`,
`account`) so Shoestring GOAL can verify the frozen route.

Account selection never expands workspace, repository-write, C/P, I/W,
deployment, production, Human-Gate, or deletion authority. Missing/disabled
plug-in state leaves every task that omits `account` on the unchanged native
Codex path; an explicit account request fails closed if the router is unavailable.

Shoestring GOAL treats Bridge as the single formal Codex entrypoint. A caller may
use shell/DS execution for bounded provider diagnostics, but a formal Codex task
must be represented by a Bridge task/proposal and its task identity. Recovery
must distinguish task-local stalls from provider failure: a stale task/thread,
stdin/EOF wrapper issue, internal Codex delegation/memory stall, Windows
sandbox/SID/Git-ownership friction, or project write-authority conflict causes a
fresh Bridge task while keeping the Codex executor lane. It does not justify
advancing from global npm to bundled or from Codex to another executor. Under
GOAL v3.1, when that retry/fallback can keep user-visible forward progress
continuous, the recovery is seamless: only the stale task/thread/child is
discarded, healthy sibling tasks continue, and no Telegram interruption or
Human Gate is created. This is only because the user-visible task never stops.
Once development execution has started, any real stop/yield requires Telegram
first regardless of normal/abnormal, success/failure, recoverability, or
system/Owner cause. GOAL-managed stop delivery is fail-closed: stop commands
are successful only with `telegram_status=delivered`,
`STOP_AND_NOTIFY_REQUIRED` remains non-success until a real notification
transition completes, and no `--no-telegram` bypass is allowed. Automated
non-GOAL callers use the canonical Shoestring stop notifier with a stable
EventId. Any Bridge notification helper remains notification-only and grants no
workspace/Codex/GOAL/write/C/P/I/W/deploy/production/Human-Gate authority.
Telegram is required when forward execution really
stops or yields before recovery.

GOAL V3.2 Harness Lite does not change Engineering Bridge Core or add a second
Bridge transport. It is an optional Shoestring GOAL control layer that composes
the existing `run_task` / `task_result` / `control_task` contract with durable
Task Graph state, Task→Worker bindings, execution receipts, separate Web GPT/DS
verification receipts, retry history, convergence, and resume projection. The
existing V3.1 WorkerRegistry/ResourceScheduler remains worker/resource
authority, and Bridge remains the single formal Codex execution entrypoint.
Bridge ready/completed execution provenance is still executor evidence only:
Harness may mark a task `COMPLETED` and unlock dependents only after independent
Web GPT + DS verification records PASS. Harness disable/failure must fall back
to unchanged V3.1 execution semantics and must not grant write, Human Gate,
C/P, I/W, deploy, or production authority.

For the Owner's GOAL-managed Windows profile, Bridge also inherits the global
Worktree location boundary: **every new GOAL worktree must live under
`D:\WORKTREE_ZONE`, and that path is the only authorized GOAL `project_root`.**
Bridge/managed-onboarding failure does not authorize Web GPT, DS, Codex, or an
operator workflow to try repo-local/sibling directories, `C:\`, Temp, another
drive, or any alternate Worktree root. Recovery must repair/reuse a clean WT
inside `D:\WORKTREE_ZONE` or surface the real blocker. Existing out-of-Zone
registrations/worktrees are legacy only and must not be selected for new GOAL
tasks. This is a GOAL profile constraint layered on Bridge's generic
`project_root` mechanism; it does not broaden Bridge authority.

Repository mutation authority is deliberately outside Bridge provider
selection. `generate_controlled_patch` and `refine_controlled_patch` remain
read-only. `apply_controlled_patch` remains a generic exact-`APPLY` capability,
but a project may impose a stricter DS-only mutation rule; in that case the
proposal is applied by the project-authorized DS path and independently
regressed there. For ordinary isolated-worktree Lane A/B work, DS `apply_patch`
is the preferred mutation lane unless the target project explicitly authorizes
Bridge controlled writes; the existence of Bridge's exact `APPLY` token does
not create a Human Gate by itself.

Bridge provider selection is only the Codex layer of the wider Shoestring GOAL continuity chain. The orchestrator treats `CODEX_UNAVAILABLE` after the allowed provider fallback (and equivalent Codex-capacity unavailability) as a recoverable executor interruption when DS remains available: Telegram is emitted through the shared GOAL runtime, executor mode is switched durably to `web-gpt-ds`, and the same frozen GOAL continues under Web GPT direction with DS execution. Bridge itself does not invoke DevSpace or silently replace Codex with DS; that third-tier routing decision remains in the authoritative GOAL orchestration layer.

There is no HTTP server, UI, database, account system, background daemon, remote transport, or general command runner.

## Read-only supervised task flow

`run_task` is always read-only and accepts an optional `executor: "codex" | "dsh"` (default `codex`). Codex-only routing may include exact `model`, `reasoning`, and `account`; DSH plus any of those routing pins fails closed. Codex runs with approval `never`, a read-only sandbox policy, and network access disabled. The Codex executor starts native app-server threads with `thread/start`; after supervisor feedback it preserves the returned thread ID and uses `thread/resume`, followed by a new turn, so the conversation continues on the same Codex thread. The DSH executor runs each task as a headless invocation; it has no machine-resumable session seam, so a DSH `continue` is a new execution and no thread id is fabricated.

`task_result` reports `queued` or `running` with `ready: false`. A successful turn moves to `waiting_for_supervisor_review` with `ready: true` and `review_output`. For a successful Codex task it also exposes the matching **Bridge-authored durable `execution_receipt`** (`workspace_id`, exact registered `workspace_root`, `task_id`, executor, Bridge operation, `read_only: true`, receipt state, timestamp). The receipt is persisted independently of task supervision, contains no prompt/output text, and is provenance only—not write authorization or semantic acceptance. The response also includes the fixed `executor`, a real native `thread_id` when one exists (Codex only), the bounded, process-local `evidence` collected from command-execution and file-change protocol items, and `partial_output` when a genuine interrupt produced real partial output (the task still ends `failed`). Evidence is diagnostic task output, not authorization to write or proof that a requested semantic result is correct; when existing bounds truncate or evict evidence, explicit markers (`[truncated]`, changes-omitted counts, an `evidence-drop` item) make the incompleteness visible.

`control_task` supplies the supervisor transitions. `continue` requires a non-empty instruction while waiting for review and resumes the same Codex thread for another read-only turn (DSH: a new headless execution). Before a Codex continuation is queued, Bridge removes the previous ready receipt from the durable store; a new receipt is written only if the new turn reaches review again. This prevents stale prior-turn provenance from surviving a failed continuation. `steer` requires a non-empty instruction while a turn is running and sends it to that turn (Codex only). `interrupt` is valid only while running; an interrupted turn ends in `failed`, not in a resumable review state. `accept` is valid only while waiting for review and promotes the reviewed output to `completed` as `output` and upgrades the receipt state to `completed`.

Active task supervision state (tasks, threads, evidence, review outputs) is process-local and disappears on restart. Controlled-patch proposals/applied history, the managed workspace catalog, and bounded Codex execution receipts persist across restarts through their three dedicated state files. The execution-receipt store retains only the newest 500 valid records and deliberately omits prompt/output payloads. There is no automatic timeout, automatic acceptance, or general persistent task/audit history.

These executor parameters restrict writes performed by Codex and DSH, but Bridge does not create OS-level filesystem read containment. A same-user executor process may read paths outside the workspace when the operating system permits it.

## Controlled patch flow

Controlled writes are a separate path. `generate_controlled_patch` and `refine_controlled_patch` are read-only proposal flows available in any registered workspace; no write authorization is required. Generation verifies that the configured root resolves to the Git top-level and that tracked state and the index are clean (with an existing HEAD, or unborn-repository support for added-file proposals), records the base HEAD, and schedules the executor, still read-only, to produce a textual unified-diff proposal. Proposals and applied history persist to `<config>.controlled-patches.json`; invalid retained records are quarantined without blocking startup, while replay/applied ambiguity and global invariants fail closed.

`apply_controlled_patch` is the single controlled-write checkpoint: it requires controlled-write permission (managed `AUTHORIZE` or a manual `allow_write: true` entry), confirmation equal to exact, case-sensitive `APPLY`, a known completed proposal that has not already been applied, the original HEAD (including unborn base), a clean tracked worktree and index, and a safe unified text patch. Targets may modify existing tracked regular files or add an ordinary text file using exact mode 100644 when that path is absent from base HEAD, the current index, and the worktree. Bridge then runs fixed `git apply --check` and `git apply` commands without a shell. It does not run tests, stage, commit, or push.

The generation prompt asks the executor for a narrow valid diff, but prompt compliance is not a security boundary. Patch validation is code-enforced; whether the proposed semantic change is desirable remains a human review decision.
