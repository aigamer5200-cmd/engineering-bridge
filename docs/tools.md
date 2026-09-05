# MCP tool reference

This is the tool surface of Engineering Bridge V1. The local STDIO MCP server exposes ten tools.

## Knowledge Preflight Receipt

`run_task`, `generate_controlled_patch`, and `refine_controlled_patch` accept an optional `preflight_receipt` object with these bounded fields:

- `knowledge_base_path`
- `knowledge_base_head` (7-64 lowercase hexadecimal characters)
- `project_profile`
- optional `goal_id`
- `goal_summary`
- `acceptance_criteria`
- `relevant_topics`
- `critical_boundaries`

The three list fields require 1-32 single-line values. Other receipt strings are also single-line and bounded. Bridge prepends this receipt to the selected executor's instruction and adds the actual registered `workspace_id`, registered workspace root, selected executor, and `sandbox: read-only` execution boundary.

The receipt is delegation context, not an authority grant. It does not enable writes, credentials, network, release, or scope expansion. Bridge does not read or adjudicate the external Knowledge Base; the orchestrator remains responsible for preflight and current-rule selection. Omitting the receipt preserves the legacy executor instruction unchanged.

## `run_task`

Inputs: `workspace_id`, `instruction`, optional `executor` (`"codex" | "dsh"`, default `codex`), optional Codex-only `model`, optional Codex-only `web_research`, optional `preflight_receipt`.

Current contract note (2026-09-05): `run_task` does **not** yet expose a Codex
account/profile selector. Shoestring GOAL has approved that capability as a
future optional plug-in/router, but it must remain additive: an omitted/disabled
router preserves the current native Codex path, and account/profile selection
must not change any Bridge workspace/write/approval authority. Do not invent an
`account` argument until a separately implemented and tested Bridge contract
actually adds one.

Starts a supervised task with the selected executor and returns `task_id`. `run_task` is always read-only: Codex uses approval `never`, a read-only sandbox policy, and disabled network access; DSH is pinned read-only per process. For Codex, an explicit non-empty `model` is pinned when the native app-server thread starts and is reported in `task_result`; omitting it preserves Codex's existing default selection. DSH plus `model` fails closed, and Bridge does not silently substitute a different model. An unknown workspace becomes a failed task; it does not grant access to a new path. The executor selection is fixed for the task lifetime and reported honestly in `task_result`.

## `task_result`

For a successful Codex task, `task_result` may include a Bridge-authored durable
`execution_receipt` containing the exact registered `workspace_id`,
`workspace_root`, `task_id`, executor=`codex`, Bridge operation,
`read_only: true`, receipt state (`waiting_for_supervisor_review` or
`completed`), and `recorded_at`. The receipt is persisted separately in
`<config>.execution-receipts.json`, is bounded to the newest 500 valid records,
contains no prompt/output text, and grants no write/release/acceptance
authority. Shoestring GOAL uses this Bridge-authored record to reject caller
self-attestation when closing a formal Codex Execution phase.

If a reviewed Codex `run_task` is continued, the prior ready receipt is removed
before the next turn starts. `task_result` exposes a receipt only when the
current task state matches that receipt (`waiting_for_supervisor_review` or
`completed`), so a running/failed continuation cannot surface stale evidence.
DSH executions intentionally produce no Codex execution receipt.

Input: `task_id`.

Returns the task state, readiness, fixed `executor`, an explicitly pinned `model` when one was requested, and current bounded `evidence`. Queued and running tasks have `ready: false`. A successful turn has state `waiting_for_supervisor_review`, `ready: true`, and `review_output`. After acceptance, state is `completed` and the reviewed text is returned as `output`. Failures return a safe `{code,message}` error. An unknown task ID returns `UNKNOWN_TASK`.

Conditional fields:

- `thread_id`: present only for Codex tasks once a real native app-server thread exists. DSH headless has no machine-resumable session seam, so DSH tasks never carry a fabricated `thread_id`.
- `partial_output`: present only when a genuine interrupt produced real partial output (for example, DSH cached partial stdout or the last completed Codex agent message). The task state is still `failed`; `partial_output` is never completed `output` and never appears in `error`.

`evidence` contains bounded command-execution and file-change items. When the existing bounds truncate or evict evidence, explicit markers are returned: strings cut by the size bound end with `[truncated]`, an oversized changes list gains a `[truncated: N additional changes omitted]` entry, and evidence evicted by the total count limit is reported through a synthetic `evidence-drop` item. These markers mean the diagnostic information is incomplete.

For Shoestring GOAL specifically, Bridge's `waiting_for_supervisor_review` /
`review_output` names describe transport state only. They do not assign a
reviewer role to Codex. Web GPT + DS retain planning, architecture, execution
direction, review/audit, repair, C/P, and authorized I/W authority; Codex only
executes the bounded instruction and reports progress/results/problems.

### Optional read-only task observer

Bridge can expose the same bounded task activity to a local observer without
creating a second controller. Set `ENGINEERING_BRIDGE_OBSERVER_MODE` before
starting the MCP server:

- unset / any other value: observer disabled (default);
- `log`: append a bounded sidecar log at `<workspaces-config>.observer.log`;
- `window`: use the same sidecar log and, on Windows, launch one detached
  PowerShell window titled `Shoestring GOAL - Codex Observer` that tails it.
  Non-Windows hosts degrade to log-only behavior.

The observer records task id, selected executor, state transitions, native
Codex thread id when available, bounded command evidence, and file-change
paths/status. It never receives or writes the full task instruction/prompt and
never writes diff contents. The sidecar is bounded to approximately 512 KiB and
lives next to the external Bridge workspace configuration, not inside a target
repository. Observer failures are best-effort/non-fatal and cannot steer,
interrupt, accept, continue, or otherwise change task execution.

## `control_task`

Inputs: `task_id`, `action`, and optional `instruction`.

The actions are state-specific:

- `continue`: while `waiting_for_supervisor_review`, requires a non-empty instruction, queues another read-only turn, and preserves app-server thread continuity with `thread/resume` for Codex. For DSH, `continue` starts a new headless execution; there is no native resume. If the task was started with a Knowledge Preflight Receipt, the same receipt is prepended to the continued turn while only the task instruction is replaced.
- `steer`: while `running`, requires a non-empty instruction and steers the active turn (Codex only).
- `interrupt`: while `running`, interrupts the active turn. When interruption completes, the task ends as `failed`; genuine partial output may be exposed as `partial_output`.
- `accept`: while `waiting_for_supervisor_review`, marks the reviewed output `completed` without starting another turn.

Invalid actions for the current state return `INVALID_STATE_TRANSITION`. There is no automatic timeout, automatic acceptance, or persistent task supervision state.

## `bind_project`

Inputs: `project_path`, `confirmation` (must equal `BIND` exactly).

Registers an existing directory inside a configured `project_root` as a read-only managed workspace. The path must already exist, resolve inside an approved root (canonical real-path containment), and not already be registered. Returns the `workspace_id`; registration persists to `<config>.managed-workspaces.json`. A managed workspace does not gain controlled-write permission from binding.

## `create_project`

Inputs: `parent`, `name`, `confirmation` (must equal `CREATE` exactly).

Creates and git-initializes a new single-segment directory inside a configured `project_root` and registers it as a read-only managed workspace. Only `mkdir` and `git init` are performed; the repository is left unborn (no commit) and no files are added. Returns the `workspace_id`; registration persists to `<config>.managed-workspaces.json`.

## `authorize_workspace_write`

Inputs: `workspace_id`, `confirmation` (must equal `AUTHORIZE` exactly).

Grants persistent controlled-write permission to one managed workspace only; manual workspaces remain authoritative through `workspaces.json`. The authorization is persisted first, then applied at runtime. This permission gates only `apply_controlled_patch`; it is not direct-write access and does not change `run_task` (which stays read-only).

## `generate_controlled_patch`

Inputs: `workspace_id`, `change_request`, optional `executor` (`"codex" | "dsh"`, default `codex`), optional `preflight_receipt`.

Read-only proposal flow available in any registered workspace; no write authorization is required to generate. It verifies that the configured root resolves to the Git top-level and that tracked state and the index are clean (with an existing HEAD, or unborn-repository support for added-file proposals), records and returns `base_head`, and starts a separate read-only proposal task that does not modify files. The proposal and its applied history persist to `<config>.controlled-patches.json`.

## `refine_controlled_patch`

Inputs: `patch_task_id`, `change_request`, optional `executor` (`"codex" | "dsh"`, default `codex`), optional `preflight_receipt`.

Read-only refinement of a completed controlled-patch proposal: returns a new complete proposal against the same `base_head`, preserving the source proposal. The executor is selected per call and defaults to `codex`; it is not inherited from the parent proposal. The Knowledge Preflight Receipt is also selected per call and is not silently inherited from the parent proposal. Requires the source task to be `completed` and the workspace base to be unchanged. No write authorization is required; it never modifies files.

## `submit_controlled_patch`

Inputs: `workspace_id`, `base_head`, `diff`.

Registers a caller-provided complete unified text diff as a retained read-only proposal against exactly the current commit HEAD. No executor runs, so task reporting uses `source: "submitted"` and never fabricates an executor identity. The submitted diff must pass the same controlled-patch structural and workspace preflight used by APPLY. It does not modify files until a later exact `APPLY` call, and it does not accept a Knowledge Preflight Receipt because there is no executor delegation.

## `apply_controlled_patch`

Inputs: `patch_task_id`, `confirmation`.

The single controlled-write checkpoint. Confirmation must equal `APPLY` exactly, the proposal must be known, completed, and not already applied, and the workspace must hold controlled-write permission (managed `AUTHORIZE` or a manual `allow_write: true` entry). The tool rechecks the canonical Git root, clean tracked state and index, and exact base HEAD (including unborn-base validation) before validating and applying the patch once. It can modify existing tracked regular text files or add an absent ordinary text file from an exact 100644 text diff. A new target must be absent from base HEAD, the current index, and the worktree. It never tests, stages, commits, or pushes.
