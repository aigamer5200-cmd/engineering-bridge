# Release notes

## v1.4.2-biaogu.6

This release upgrades the `.5` single-account quota guard into a bounded
runtime failover controller for explicit A/B Codex tasks while preserving the
accepted `.4` transport repair and exact execution-profile routing.

### Usage and failure classification

- The non-secret `codex-switch` cache now distinguishes both the primary
  five-hour window and the secondary weekly window, including reset times.
- Stale cache state is boundedly refreshed through `codex-switch --json list`;
  command output is discarded and is never copied into Bridge logs or task
  artifacts.
- If a stale cache cannot be refreshed, the usage state becomes `unknown` and
  cannot drive automatic failover from stale quota evidence.
- Structured app-server failures are classified before generic process text:
  account auth/profile, model capacity, provider rate limit/transient,
  protocol, process spawn, RPC transport, stalled, interrupted, generic, and
  unknown failure lanes remain distinct.
- Generic provider or protocol failures are not inferred to be quota failures
  while the usage state still has quota.

### Bounded A/B failover

- An explicitly requested exhausted A account may fail over once to B, and B
  may fail over once to A. Automatic failover is strictly A<->B even if the
  configured allowlist later contains other aliases. `AUTO` remains fail-closed.
- Model, reasoning, service tier, sandbox, workspace, web-research setting, and
  Knowledge Preflight boundaries are preserved exactly; Bridge never lowers
  execution quality to make a retry succeed.
- A replacement account always starts a new native Codex thread. A thread from
  one account is never resumed under another account.
- Mid-task write-capable failover is allowed only when a bounded Git checkpoint
  proves the workspace was clean before the attempt, remains clean afterwards,
  HEAD is unchanged, and no mutation evidence was emitted. Otherwise Bridge
  stops with `FAILOVER_REVIEW_REQUIRED` instead of risking duplicate mutation.
- Account failover is bounded to one cycle; A -> B -> A ping-pong is forbidden.

### Both accounts exhausted and durable provenance

- When both accounts are quota exhausted, Bridge does not silently substitute
  DSH for DevSpace/DS. Bridge returns
  `BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED` and writes a durable
  `handoff_required` receipt with `fallback_executor=ds` so the upper GOAL/DS
  orchestrator can continue from the explicit safe checkpoint.
- `task_result`, execution receipts, and the observer expose only bounded
  failover provenance: requested/resolved alias, reason, quota window, reset
  time, fallback executor, retry count, and mutation-checkpoint state.
- Tokens, auth files, email addresses, API keys, raw provider payloads, prompt
  bodies, and raw stdout/stderr are excluded from this provenance.

### Validation checkpoint

- Deterministic failover acceptance: PASS for normal A/B, five-hour and weekly
  A<->B routing, exact-profile preservation, fresh native thread, both-account
  exhaustion, mutation protection, loop bounding, stale/expired cache handling,
  credential-safe receipts, and observer provenance.
- Full unit suite: 413 tests, 408 passed, 0 failed, 5 platform skips.

## v1.4.2-biaogu.5

This bounded account-routing repair preserves the production-accepted `.4`
transport behavior while distinguishing an exhausted explicit Codex account
from a Bridge execution failure.

### Explicit account quota classification

- When `account=A|B` is explicitly requested, Bridge now reads only the
  non-secret local `codex-switch` usage cache for that alias before launch.
- An alias is classified as exhausted only when the cache says the account is
  limited, the primary usage window is at 100%, the limit reason is
  `rate_limit_reached`, and the cached reset timestamp is still in the future.
- That state returns `CODEX_ACCOUNT_QUOTA_EXHAUSTED` instead of the misleading
  generic `CODEX_EXECUTION_FAILED`.
- Once the cached reset timestamp has passed, the old exhausted entry no longer
  blocks launch, so the account automatically resumes without a configuration
  change.
- Missing or malformed cache data is ignored and falls back to the existing
  launch path. No auth/token/API-key content is read or returned.
- Explicit account provenance is preserved: Bridge never silently substitutes
  account A for an explicitly requested B account.

### Validation checkpoint

- Targeted account/error regression suite: PASS, 59 tests, 0 failed.
- Active cached quota exhaustion is rejected before subprocess launch.
- Expired cached quota exhaustion allows the normal Codex launch path.
- `.4` large-frame transport, account routing, sandbox, model/reasoning, and
  service-tier behavior remain unchanged by this bounded repair.

## v1.4.2-biaogu.4

This bounded transport repair keeps the `1.4.2-biaogu.3` routing and
`danger-full-access` policy unchanged while fixing false
`CODEX_PROTOCOL_ERROR` failures during large Codex app-server events.

### Codex protocol transport repair

- Valid JSONL app-server frames are no longer rejected at the old 64 KiB
  boundary. `commandExecution` events may legitimately carry large
  `aggregatedOutput` values after repository reads, so Bridge now accepts valid
  frames up to a defensive 16 MiB transport ceiling.
- Incomplete/chunked JSONL frames continue to buffer until a newline completes
  the frame. A truly overlong unterminated frame still fails closed.
- A failed shell command remains diagnostic evidence and does not itself turn
  an otherwise successful Codex turn into a protocol failure.
- Unknown non-dangerous notification variants continue to be ignored unless
  they violate the basic JSON-RPC envelope shape.
- Traditional Chinese, emoji, multiline final output, and long final answers
  remain UTF-8-safe.

### Bounded failure diagnostics

- `CODEX_PROTOCOL_ERROR` can now retain content-free protocol metadata such as
  parser stage, event sequence, frame byte length, last method/item type,
  terminal-frame presence, subprocess exit code, and bounded stdout/stderr
  tail length + SHA-256.
- Raw stdout, stderr, instructions, credentials, and response bodies are not
  persisted in protocol diagnostics.
- Generic execution failures and interrupted tasks keep the previous
  no-protocol-diagnostics boundary.

### Validation checkpoint

- Root cause reproduced with a valid >64 KiB `commandExecution` frame before
  the fix.
- Targeted protocol regressions: PASS.
- Full unit suite: 391 tests, 386 passed, 0 failed, 5 platform skips.
- Existing Codex account/model/reasoning/service-tier routing, DSH read-only
  behavior, controlled patches, and `danger-full-access` default remain green.

## v1.4.2-biaogu.3

This release keeps the Owner-approved `1.4.2-biaogu.2` Codex full-access
execution behavior and adds an exact task-local service-tier routing dimension.
It is the production runtime required by the 2026-09-11 GOAL role-routing split.

### Task-local Codex routing

- `run_task` accepts optional Codex-only `service_tier=standard|priority`.
- An explicit tier is forwarded to native Codex app-server
  `thread/start.serviceTier` and `turn/start.serviceTier`.
- `task_result` and durable execution receipts preserve the explicit
  non-secret service-tier provenance.
- DSH rejects the Codex-only service-tier field and remains read-only.

### Preserved `biaogu.2` behavior

- Codex `run_task` still defaults to `danger-full-access` under the explicit
  Owner-approved local policy, with optional narrowing to `workspace-write` or
  `read-only`.
- Controlled-patch proposal paths and DSH remain read-only.
- Sandbox provenance and truthful `read_only` receipt semantics are retained.

### GOAL routing policy

- Engineering Bridge itself does not infer GOAL roles.
- Machine-global / ordinary executor default remains
  `gpt-5.6-luna / max / priority`.
- GOAL callers pin Child A / explicit `A代理` as
  `gpt-6-astra / low / standard`.
- GOAL B/C/D executors pin `gpt-5.6-luna / max / priority`; task complexity no
  longer auto-escalates executor model cost.

### Validation checkpoint

- TypeScript build/typecheck: PASS via `npm test`.
- Full unit suite: 386 tests, 381 passed, 0 failed, 5 platform skips.
- Full-access sandbox mapping and task-local service-tier forwarding are both
  covered in the merged regression suite.

## v1.4.2-biaogu.2

This Owner-authorized local release removes the hard-coded read-only sandbox
from ordinary Codex `run_task` execution while preserving the existing
controlled-patch and DSH safety lanes.

### Codex full access

- Codex MCP `run_task` now defaults to native `danger-full-access`.
- Callers may explicitly narrow a Codex task to `workspace-write` or
  `read-only`.
- `task_result` and the durable Bridge execution receipt report the exact
  sandbox and truthful `read_only` value.
- Supervisor `continue` retains the task's original sandbox.

### Preserved boundaries

- DSH remains pinned read-only and rejects sandbox expansion.
- Controlled patch generation/refinement remain read-only; `AUTHORIZE` still
  gates controlled-patch `APPLY` only.
- No Codex auth/token payload or `CODEX_HOME` credential file is modified by
  this release.
- Full access does not imply Git push, I/W, production activation, or any
  target-repository authority reserved to its Owner.

### Validation checkpoint

- TypeScript typecheck: PASS.
- Full unit suite: 385 tests, 380 passed, 0 failed, 5 platform skips.
- Native app-server mapping is covered for `danger-full-access` ->
  `dangerFullAccess`.

## v1.4.2-biaogu.1

This Biaogu integration release reconciles upstream `v1.4.2` into the current
Shoestring GOAL Engineering Bridge fork while preserving the existing local
GOAL execution contract and rollback boundary.

### Biaogu integration

- Preserve task-scoped Codex account routing through the optional
  `codex-switch` adapter, including isolated `CODEX_HOME` handling and explicit
  fail-closed account selection.
- Preserve exact model/reasoning routing, native live web research,
  Knowledge Preflight Receipt injection, Bridge-authored execution receipts,
  and the read-only task observer.
- Keep the Windows global-npm Codex provider preference while retaining
  upstream v1.4.2 executor liveness and controlled validation/commit behavior.
- Add a Windows-safe fallback for upstream controlled-COMMIT untracked-file
  fingerprinting when Node does not expose `O_NOFOLLOW`; POSIX continues to use
  native `O_NOFOLLOW` semantics.

### Upgrade policy

- The Owner selected the simplified upgrade path: no pre-promotion full
  rollback drill is required, but the current `1.2.1-biaogu.6` runtime and
  rollback capability must remain intact.
- Promotion is allowed only after candidate/canary compatibility acceptance;
  an actual production failure must downgrade to the retained previous runtime.

### Validation checkpoint

- Full upstream + fork unit suite: 377 tests, 372 passed, 0 failed, 5
  Windows-specific platform skips.
- Biaogu critical regression: 112 passed, 0 failed, covering account routing,
  reasoning, live web research, execution receipts, MCP schema, and supervised
  task behavior.

## v1.4.2

v1.4.2 is a correctness release for controlled initial commits in fresh Git repositories with no existing commit.

### Fixed

- Support controlled `COMMIT` for an applied proposal in a fresh/unborn Git repository, creating a root commit from exactly the proposal targets.
- Preserve proposal-target-only staging and leave unrelated untracked recovery anchors unchanged, untracked, and unstaged.
- Before creating the root commit, recheck the unborn state and expected branch ref so concurrent HEAD or ref creation is rejected.
- After creating the root commit, verify that it has no parent, contains exactly the proposal paths, and leaves the index and tracked worktree clean.
- If post-commit verification fails, report the failure without resetting, amending, or otherwise rewriting the commit that was already created.

### Compatibility

- Controlled `COMMIT` for repositories with a normal existing `HEAD` keeps the v1.4.1 semantics and safety boundaries unchanged.

## v1.4.1

v1.4.1 is an emergency correctness release for Windows-authored workspace configuration, active Codex turn liveness, and controlled-commit recovery safety.

### Fixed

- Accept a workspace configuration whose first character is one UTF-8 BOM (`U+FEFF`) while preserving strict JSON parsing; a second BOM and all other malformed JSON remain rejected.
- Reset the Codex inactivity watchdog on any app-server notification only when both `threadId` and `turnId` exactly match the active turn. Other threads, other turns, global notifications, and RPC responses cannot keep the turn alive.
- Preserve stable unrelated untracked recovery anchors during controlled `COMMIT`, stage and commit only exact proposal targets, reject pre-existing staged or unrelated tracked dirt, and leave history advanced rather than rewriting it if post-commit recovery-anchor verification fails.

### Windows operation notes

- A foreground `tunnel-client run` belongs to its PowerShell process; closing that PowerShell window terminates the foreground tunnel.
- Installing Codex Desktop does not guarantee that the `codex` CLI exists on the `PATH` inherited by the process that starts Bridge.
- Workspace registration controls which roots MCP callers may select. It is separate from filesystem read isolation: Bridge's read-only executor settings restrict writes but do not create an OS-level read sandbox.

## v1.4.0

v1.4.0 closes the supervised controlled-write loop while keeping publication outside Bridge.

### Added

- Add optional controlled-patch validation through `configure_validation_profile` and `validate_controlled_patch`. Validation runs only when explicitly requested, uses a fixed per-workspace profile in a temporary detached worktree, and reports `PASS`, `FAIL`, or `INCOMPLETE`; it does not authorize or imply `APPLY`.
- Add `commit_controlled_patch` as a separate exact `COMMIT` gate for an already-`APPLY`ed controlled patch. It creates one Git commit containing only that applied patch and never pushes.

### Release boundary

- The local STDIO MCP surface is now 13 tools.
- `APPLY` remains the explicit filesystem-mutation gate; `COMMIT` is a separate Git-history gate. Neither gate implies push or Release creation.
- Fresh-chat catalog verification confirmed all 13 tools, and a disposable controlled-COMMIT E2E confirmed that `APPLY` leaves HEAD unchanged and `COMMIT` alone advances HEAD while leaving the worktree clean.

## v1.3.0

v1.3.0 has been published as a Git tag and GitHub Release. This does not indicate npm publication.

### Added

- Add `submit_controlled_patch` for registering a caller-provided complete unified Git diff against the exact current `base_head`. Submission runs the shared read-only preflight, records `source: "submitted"` without an executor identity, survives restart, and still requires human review, write authorization, and exact `APPLY`.
- Let `generate_controlled_patch` and `refine_controlled_patch` select Codex or DSH per call (default Codex), while keeping application deterministic and model-free. Refinement does not inherit the source proposal's executor.
- Add optional Codex-only `model` and `reasoning_effort` inputs to `run_task`, `generate_controlled_patch`, and `refine_controlled_patch`; requested values are checked against Codex `model/list`. DSH rejects these options.
- Allow running generated or refined proposal tasks to be interrupted through `control_task`; interrupted tasks finish with `TASK_INTERRUPTED`.

### Fixed

- Bound executor termination across normal completion, interruption, direct-child exit, inherited open pipes, hard deadlines, and live Windows process trees so tasks settle without leaving the one-shot executor process tree running.
- Preserve the beginning and true end of oversized DSH stdout, including interrupted output, within the existing 1 MiB bound.
- Harden controlled-patch application recovery, serialize concurrent applications per workspace, and persist final applied metadata before releasing the retained task.
- Bound controlled-patch and onboarding Git subprocesses, preserve supported public error classifications, and finalize tasks when terminal-result handlers fail.

### Reliability / Performance

- Bound short Codex JSON-RPC calls to 30 seconds independently of the 15-minute executor deadline; active Codex turns also fail after two minutes without matching protocol activity.
- Restore retained controlled-patch tasks in one validated batch, eliminating repeated global terminal-retention scans while preserving task order and provenance.

The v1.2.1 Windows validation boundary is unchanged; full multi-client / all-Windows certification is not claimed.

## v1.2.1

v1.2.1 is a Windows launch-compatibility patch for both executors. The DSH executor itself was added in v1.2.0; v1.2.1 does not add an executor, it fixes how npm-installed Codex and DSH CLIs are resolved and launched on Windows.

### Windows CLI compatibility

- Fix Windows command resolution for npm-installed Codex and DSH CLIs.
- Standard Windows npm installs expose:

  ```
  codex.cmd
  dsh.cmd
  ```

- Bridge now resolves those npm shims to their official Node entrypoints:

  ```
  @openai/codex/bin/codex.js
  @deepseek-ai/dsh/lib/bin.js
  ```

- The launch path uses `process.execPath` + the JS entrypoint.
- A real `codex.exe` / `dsh.exe` remains directly supported and preferred.

### Safety

- No `cmd.exe` / `ComSpec` runtime path.
- No `shell: true`.
- The Codex instruction still travels through JSON-RPC stdin.
- The DSH instruction remains a single argv argument.
- Unresolved shim targets fail closed through the existing shell-free fallback chain.

### Verification

Validated on a real GitHub Actions `windows-latest` runner with Node 22 and actual npm-installed `@openai/codex` and `@deepseek-ai/dsh` packages.

Windows smoke confirmed:

- real `codex.cmd` and `dsh.cmd` layouts
- resolver discovery
- both official Node launchers start successfully
- focused executor tests pass

Windows compatibility improved and this specific npm CLI path is now verified; full multi-client / all-Windows-environment certification is not claimed.

## v1.2.0

v1.2.0 keeps the Codex behavior of v1.1.0 (including its default selection) and adds a second executor, managed workspace onboarding, restart persistence for controlled patches, and more honest task reporting.

### Executors

- `run_task` accepts an optional `executor: "codex" | "dsh"`; omitting it still defaults to `codex`, so existing calls are unchanged.
- DSH runs through the official headless interface, pinned to read-only per process (`DSH_PERMISSION_MODE=read-only`); the bridge forwards only an explicit environment allowlist, including `DEEPSEEK_API_KEY` and `DSH_TOOLS_MODE`, and never forwards proxy variables.
- DSH returns a legitimate empty output for a successful run with no agent text, and an interrupted DSH task keeps its real partial stdout as `partial_output`.

### Workspace onboarding and write authorization

- New `project_root` configuration entries define approved root directories.
- `bind_project` registers an existing directory inside a `project_root` after exact `BIND` confirmation.
- `create_project` creates and git-initializes a new directory inside a `project_root` after exact `CREATE` confirmation (the repository is left unborn; no commit is made).
- Managed workspaces are registered read-only by default. `authorize_workspace_write` grants controlled-write permission to a managed workspace only, after exact `AUTHORIZE` confirmation.
- Manual workspaces from `workspaces.json` remain authoritative for their own `allow_write`; `AUTHORIZE` never modifies a manual entry.

### Controlled patches

- `generate_controlled_patch` and `refine_controlled_patch` are read-only proposals and work in any registered workspace; no write authorization is needed to generate or refine.
- Write authorization (managed `AUTHORIZE` or a manual `allow_write: true` entry) is required only at `apply_controlled_patch` with exact `APPLY`.
- Controlled-patch proposals and applied history now survive a bridge restart; invalid retained records are quarantined safely instead of blocking startup.
- Unborn repositories (for example, fresh `create_project` workspaces) are supported: proposals may add ordinary 100644 text files. The bridge still never stages, commits, or pushes.

### Honest task reporting

- `task_result` reports the fixed `executor` and, for Codex tasks, the real native app-server thread id. DSH has no machine-resumable headless session, so it never gets a fabricated thread id; a DSH `continue` starts a new execution.
- `partial_output` appears only when a genuine interrupt produced real partial output; the task still ends `failed`, and ordinary failures never re-expose stderr or partial stdout.
- Codex evidence truncation is now visible: oversized strings are marked `[truncated]`, oversized change lists report how many changes were omitted, and evidence evicted by the count limit is reported through a synthetic drop item. Bounds are unchanged; the markers only say the diagnostic information is incomplete.

### Not changed

- The Codex default path, controlled-`APPLY` validation, and safety checks from v1.1.0 are unchanged; the bridge still never automatically tests, stages, commits, pushes, or releases.

## v1.1.0

v1.1.0 adds `refine_controlled_patch` for refining an existing completed controlled-patch proposal into a new complete proposal against the same `base_head`, preserving the source proposal and still requiring explicit `APPLY` before workspace modification.

## v1.0.0

controlled APPLY now accepts valid Codex-generated patches with Markdown fence context, stale hunk counts, and zero-context hunks, while retaining existing workspace, target, and explicit APPLY safeguards.

## v1.0.0-rc.2

Failed Codex turns with `codexErrorInfo=serverOverloaded` are surfaced as a clear model-capacity failure instead of only the generic `CODEX_EXECUTION_FAILED` message. Raw upstream error details remain hidden.

## 1.0.0 stable

This stable V1 release exposes five STDIO MCP tools: `run_task`, `task_result`, `control_task`, `generate_controlled_patch`, and `apply_controlled_patch`. Ordinary `run_task` execution is always read-only. Successful interactive turns enter `waiting_for_supervisor_review`; `task_result` exposes state/readiness, bounded evidence, and `review_output` before acceptance, then final `output` or `error` after finalization. `control_task` is restricted to interactive `run_task` task IDs and state-checks `continue`, `steer`, `interrupt`, and `accept`. Continue preserves native Codex thread continuity; interrupt is available only while an interactive task is running and finalizes it as failed.

Controlled patch generation remains on the legacy proposal-task path. Poll its returned patch task ID through `task_result` until `state=completed`, when the unified diff is returned as `output`. Proposal tasks do not enter `waiting_for_supervisor_review`, do not expose `review_output`, and cannot be accepted through `control_task`. Human review occurs outside task state; an acceptable completed diff is passed directly to `apply_controlled_patch` with that `patch_task_id` and exact `APPLY`.

The Codex backend uses `codex app-server --stdio` without a shell, with approval `never` and network disabled. Ordinary/supervisor tasks and proposal generation stay read-only; exact reviewed `APPLY` is the filesystem write path. Bridge does not automatically test, stage, commit, or push. State is process-local with no restart recovery or automatic timeout; explicit interruption exists only for running interactive tasks. Alpha.4 project binding is not implemented, so `workspace_id` remains required.

This is the stable V1 / 1.0.0 release. It does not indicate npm publication.

## v0.2.0-alpha.3 release candidate

This release candidate reduces the public STDIO MCP interface to four tools: `run_task`, `task_result`, `generate_controlled_patch`, and `apply_controlled_patch`. `task_result` is now the single polling tool and reports active tasks with `ready: false`, completed output, or a fixed safe error. Serialized errors contain exactly `code` and `message` while preserving the existing error codes and non-leakage behavior.

Controlled patches may continue to modify existing tracked regular text files and may now add an ordinary text file when the diff uses exact `new file mode 100644` and matching `/dev/null` headers, contains a text hunk, and targets a safe path absent from base HEAD, the current index, and the worktree. Deletions and other unsafe patch forms remain rejected. Documentation has been reduced and aligned with this interface and behavior.

This is a release candidate description only. It does not assert that a v0.2.0-alpha.3 tag, GitHub Release, or npm publication exists.

## v0.2.0-alpha.2

Engineering Bridge v0.2.0-alpha.2 adds opt-in controlled writes while keeping every workspace read-only by default. A write-enabled clean Git workspace can generate a patch proposal without changing files; application requires human review and confirmation exactly equal to `APPLY`. Bridge rechecks repository state and patch targets before applying, and never automatically tests, stages, commits, or pushes.

This release also compares canonical real paths during controlled-write Git-root validation, so macOS aliases such as `/tmp` and `/private/tmp` no longer cause the same directory to be rejected. The English and Chinese READMEs explain client compatibility, component roles, a generic STDIO MCP configuration, a reproducible first read-only run, and the complete controlled-write flow. The architecture, security, threat-model, and tool-reference documents are aligned with the current implementation.

Current limits remain: no cancellation or timeout, no persistence across restart, no caller authentication or remote service, and no OS-level read containment for ordinary read-only tasks. Every proposal still requires human review.

This version has been published as a Git tag and GitHub Release.
