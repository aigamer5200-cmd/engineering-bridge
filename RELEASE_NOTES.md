# Release notes

## v1.2.1-biaogu.6 (custom fork) — explicit Codex model routing

- `run_task` accepts an optional non-empty `model` for `executor=codex`.
- The selected model is passed through native Codex app-server `thread/start`;
  it is never placed in shell/process arguments.
- `task_result` reports an explicitly pinned model for orchestration evidence.
- The model remains fixed for the supervised task/native Codex thread,
  including later `continue` turns on that thread.
- `executor=dsh` plus `model` fails closed instead of ignoring the selection.
- Omitting `model` preserves the previous default-model behavior.
- Bridge does not implement silent model substitution or a hidden fallback
  chain. Model routing grants no additional authority.

## GOAL v3.1 source-alignment note (2026-08-30)

- Task-local Bridge/Codex failures now distinguish seamless recovery from a
  real execution stop: safe retry/fallback that keeps user-visible forward
  progress continuous discards only the stale task/thread/child, preserves
  healthy sibling tasks, keeps the Codex executor lane, and does not emit an
  interruption Telegram or create a Human Gate. Telegram remains mandatory
  when forward execution actually stops or yields before recovery.
- Ordinary isolated-worktree Lane A/B mutation prefers project-authorized DS
  `apply_patch`; Bridge controlled `APPLY` remains available only where the
  project explicitly authorizes that lane, and the confirmation token itself
  does not manufacture a Human Gate.
- Parallel 2-4 Codex child fan-out remains an upper-layer Shoestring GOAL
  orchestration decision; Bridge stays the formal entry/provenance transport
  for each bounded Codex child and does not acquire reducer/reviewer authority.
- This is source/recovery-handoff alignment only. It does not deploy or mutate
  any production Bridge runtime or control copy.

## v1.2.1-biaogu.5 (custom fork) — bounded Codex live web research

- `run_task` accepts optional `web_research: true` for the Codex executor only.
- The option enables Codex native live Responses `web_search` while preserving the existing read-only workspace sandbox and `networkAccess: false` OS/shell boundary.
- DSH rejects `web_research: true` instead of silently widening its execution mode.
- Live-provider validation confirmed public web research works through the native tool without enabling shell networking.
- This change grants research capability only. It does not grant write, upload, POST, credential, browser-control, deployment, or deletion authority.

## v1.2.1-biaogu.4 (custom fork)

This custom build promotes the read-only Shoestring GOAL Codex Observer already
integrated on `main` into a distinct immutable runtime version. It preserves the
`biaogu.3` Bridge/Codex execution behavior and the current Web GPT + DS / Codex
role boundary.

- `ENGINEERING_BRIDGE_OBSERVER_MODE=log` enables bounded task observation in a
  sidecar log; `window` additionally opens the detached Windows PowerShell
  observer titled `Shoestring GOAL - Codex Observer`.
- Windows `window` mode uses a per-log-path live-process lease so concurrent MCP
  backend sessions reuse the same observer window instead of opening duplicate
  PowerShell tails.
- The observer is read-only and best-effort. It never becomes a controller,
  planner, reviewer, repair authority, C/P authority, or I/W authority; Bridge
  remains the sole Codex execution controller.
- Observer output is intentionally bounded: task/executor/state, native thread
  id, bounded command evidence, and changed-file paths only. Full task prompts,
  result bodies, diff bodies, credentials, and secrets are not emitted.
- The observer log is capped at approximately 512 KiB and observer failures are
  non-fatal to Bridge task execution.
- Observer mode remains environment-controlled so the same immutable runtime can
  be canary-tested, switched, and rolled back through the existing painless
  upgrade control plane.
- The Biaogu production control plane runs bounded observation in `log` mode
  while keeping the visible observer UI closed by default. The tail window may
  be opened at the start of a task or midway through an existing task without
  restarting Bridge or replacing the active Codex native thread; closing the
  UI leaves bounded background logging active.

## v1.2.1-biaogu.3 (custom fork)

This custom build hardens the GOAL Codex single-entry contract on top of
`biaogu.2` without changing the production topology or Codex execution profile.

- Recovery handoff now freezes the orchestration boundary that formal Codex
  tasks enter only through Engineering Bridge; DS/shell direct Codex invocation
  is diagnostic-only and cannot substitute for a Bridge task.
- Task-local stalls (stdin/EOF, stale task/thread, internal delegation/memory,
  Windows sandbox/SID/Git ownership, or write-authority conflicts) remain on the
  Codex lane and recover through a fresh Bridge task instead of incorrectly
  advancing the provider fallback chain.
- Project-local mutation authority remains authoritative: DS-only-write
  projects use Codex for read-only patch proposals, DS for application and
  independent regression; generic Bridge controlled APPLY remains available
  only where the project explicitly permits it.
- Global npm -> bundled provider fallback is reserved for actual provider
  unavailability; web-gpt-ds is reserved for provider-chain exhaustion or
  token/capacity unavailability.
- Successful Codex `run_task` and controlled-patch generate/refine executions
  now emit Bridge-authored durable provenance into
  `<config>.execution-receipts.json`; `task_result` exposes the matching bounded
  receipt so Shoestring GOAL can verify exact workspace/task/operation/read-only
  provenance instead of trusting caller self-attestation. The store is atomic,
  serializes mutations, syncs the temporary file before rename, is capped at
  500 records, contains no prompt/output text, and grants no write authority.
  A Codex `continue` removes the previous ready receipt before the next turn so
  a failed/running continuation cannot leave stale ready evidence behind; DSH
  intentionally emits no Codex execution receipt.

## v1.2.1-biaogu.2 (custom fork)

This custom build keeps the upstream v1.2.1 Windows launch model and the
`biaogu.1` workflow integration, while making the official standalone global
npm Codex installation the stable primary Windows provider.

### Standalone Codex CLI primary provider

- When Windows `PATH` exposes a valid global npm `codex.cmd` together with its
  official `node_modules/@openai/codex/bin/codex.js`, Bridge selects that
  package-managed Codex before any directly spawnable `codex.exe`, including a
  VS Code extension-bundled copy.
- Bridge still launches the npm Codex JavaScript entrypoint directly through
  `process.execPath`; it never runs the `.cmd` through `cmd.exe` and never turns
  on `shell: true`.
- If the global npm package is missing or incomplete, direct executable
  resolution remains the fallback. A broken earlier shim cannot hide a later
  valid global npm installation.
- Local `node_modules/.bin` shims remain supported but do not gain global
  provider priority. DSH keeps its existing native-executable-first behavior.
- GOAL orchestration keeps a third continuity tier above Bridge provider
  selection: if standalone global npm Codex and the bundled `codex.exe`
  fallback cannot provide a usable Codex executor (or Codex is otherwise
  unavailable), the runtime emits the required interruption Telegram, switches
  durably to `web-gpt-ds`, and continues the same frozen GOAL with DS.

### Verification

- Windows resolver/executor tests freeze global-npm-primary, bundled-exe
  fallback, incomplete-package fallback, and broken-shim scanning behavior.
- A real local smoke with the VS Code bundled directory intentionally placed
  before the global npm directory still selected
  `@openai/codex/bin/codex.js`, started `app-server --stdio`, returned a native
  Codex thread, and completed successfully.

## v1.2.1-biaogu.1 (custom fork)

This custom build is based on upstream Engineering Bridge v1.2.1. The `biaogu.1` suffix identifies local workflow integration and avoids claiming or colliding with a future upstream v1.3.0 release.

### Bounded Knowledge Preflight Receipt

- `run_task`, `generate_controlled_patch`, and `refine_controlled_patch` now accept an optional structured `preflight_receipt` carrying the orchestrator's bounded current context: Knowledge Base path/HEAD, project profile, GOAL summary, acceptance criteria, relevant topics, and critical boundaries.
- Bridge appends the actual registered `workspace_id`, registered workspace root, selected executor, and `sandbox: read-only` to the executor-facing receipt. Callers do not provide or override that execution boundary.
- The receipt is context only. It never grants write, release, credential, network, or scope-expansion authority; existing controlled-`APPLY` and executor sandbox rules remain unchanged.
- Interactive `continue` keeps the current task receipt while replacing only the turn instruction. A new generate/refine delegation receives only the receipt explicitly supplied for that call, so old proposal context is not silently inherited.
- Omitting `preflight_receipt` preserves the legacy executor instruction byte-for-byte.

### Windows release-gate test portability

- Temporary Git fixtures now pin LF behavior instead of inheriting a developer's global `core.autocrlf`, directory-alias tests use Windows junctions where ordinary symlink privileges are unavailable, and synthetic workspace/catalog roots use platform-native absolute paths.
- POSIX command-resolution tests now inject an explicit POSIX platform rather than assuming the host OS. This restores the local Windows full-suite release gate without weakening production workspace, patch, or executor checks.

Controlled-patch proposals can now be generated and refined by either executor, while application remains a deterministic, model-free step.

- `generate_controlled_patch` and `refine_controlled_patch` accept an optional `executor: "codex" | "dsh"`, selected per call and defaulting to `codex` when omitted; refinement never inherits the source proposal's executor.
- DSH-generated proposals use the same retained read-only proposal lifecycle and exact `APPLY` flow as Codex proposals, including restart retention. `apply_controlled_patch` itself takes no executor and invokes no model.
- Retained proposals persist their executor; legacy records without the field restore as `codex`, records with an invalid executor value are quarantined fail-closed, and restored tasks report the real executor.

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
