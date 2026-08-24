# Security design

This document separates enforced behavior from operating assumptions for the Engineering Bridge V1 (1.2.0).

## Enforced in code

- MCP callers select only workspace IDs loaded from trusted startup configuration or registered through approved managed onboarding.
- `run_task`, continued turns, steering, and controlled-patch generation use read-only executor execution. Codex app-server is started without a shell through `codex app-server --stdio`, with approval `never` and network access disabled. DSH runs through the official headless interface with `DSH_PERMISSION_MODE=read-only` pinned per process; the pin cannot be overridden by the host environment, and only an explicit environment allowlist (including `DEEPSEEK_API_KEY` and `DSH_TOOLS_MODE`) is forwarded. Proxy variables are never forwarded.
- Supervisor actions are state checked: `continue` and `accept` require `waiting_for_supervisor_review`; `steer` and `interrupt` require `running`; instructions for `continue` and `steer` must be non-empty. Interrupt completion ends the task as `failed`.
- `partial_output` is returned only from a genuine interrupted executor result; the task state stays `failed`, and ordinary failures never re-expose stderr or partial stdout.
- Codex evidence stays within its existing bounds (string length, changes count, total entry count); truncation and eviction are made visible through explicit markers rather than silently dropped. Markers indicate incomplete diagnostic information, not a complete transcript.
- Write access defaults to disabled. Manual workspaces enable it through `allow_write: true` in `workspaces.json`; managed workspaces grant it only through `authorize_workspace_write` with exact `AUTHORIZE`, which never modifies a manual registration.
- `<config>.execution-receipts.json` is provenance-only state. It contains
  bounded Bridge-authored Codex execution identity/boundary metadata, never
  prompt/output/credentials, and cannot grant controlled-write permission.
- Controlled patch generation and refinement are read-only and require no write authorization; they verify a clean Git top-level (existing HEAD or unborn-base support) and record the base HEAD. Files are not modified during generation or refinement.
- Application requires exact, case-sensitive `APPLY`, a completed one-use proposal, controlled-write permission, and rechecks the canonical Git root, HEAD, and clean tracked worktree/index before validating the patch.
- Patch validation accepts modifications to existing tracked regular files and exact 100644 ordinary text-file additions whose target is absent from base HEAD, the index, and the worktree; unborn bases support additions only.
- Deletions, rename/copy, binary patches, mode changes, executable additions, symlinks, submodules, unsafe paths, duplicate paths, and malformed or inconsistent headers are rejected.
- Bridge invokes only fixed `git apply --check` and `git apply` operations for application. It never automatically tests, stages, commits, or pushes.
- Returned executor failures use fixed safe messages rather than forwarding stderr.

## Workspace trust

Manual registrations are authoritative: the trusted operator controls `workspaces.json`, and MCP callers can select IDs but cannot add or replace manual entries. Managed onboarding is confined to configured `project_root` approved roots: candidate paths are canonicalized with `realpath`, must equal or be contained by an approved root (fail closed otherwise), and `bind_project`/`create_project` require exact `BIND`/`CREATE` confirmation. Managed workspaces start read-only; only exact `AUTHORIZE` grants controlled-write permission, persisted first and applied at runtime. Controlled writes also require the configured root to be a clean Git top-level and recorded base; on filesystems with path aliases, canonical real paths are compared so aliases to the same directory are accepted without treating a genuine subdirectory or different directory as the Git top-level.

The human reviewer must inspect every path and hunk in a proposal before supplying exact `APPLY`. A filename mentioned in a natural-language request is not a semantic file allowlist enforced by the code. Supervisor `accept` accepts read-only task output; it is distinct from `apply_controlled_patch` and does not write files.

## Persistence boundary

Two local state files provide restart persistence, both written atomically (write-temporary-then-rename) with mode 0600:

- `<config>.managed-workspaces.json` — the managed workspace catalog (registrations and controlled-write authorization). Individually invalid records are skipped on load; persist failures roll back the in-memory change.
- `<config>.execution-receipts.json` — newest 500 Bridge-authored successful
  read-only Codex execution receipts. Invalid records are skipped; mutations
  are serialized, temporary files use mode 0600, file contents are synced
  before atomic rename, and failed persistence rolls back the in-memory
  mutation. This guarantees the Bridge's process-restart persistence contract,
  not full power-loss journaling.
- `<config>.controlled-patches.json` — controlled-patch proposals and applied history. Invalid retained records are quarantined without blocking startup; duplicate identity, applied-history contradictions, and other global invariants still fail closed.

These files are not a credential store and not a complete audit log. Active task supervision state (tasks, threads, evidence, review outputs) remains process-local and disappears on restart.

## Executor, state, and prompt boundaries

Codex's read-only sandbox and DSH's pinned read-only permission are the write boundary during tasks and proposal generation. They are not OS-level read jails: executors running as the same user may read other files allowed by the operating system.

Task results can include `review_output`, bounded command/file-change `evidence` (with explicit truncation markers when bounds apply), a real Codex `thread_id`, and `partial_output` from genuine interrupts. These records are review and diagnostic material, not a durable audit log or an additional write authorization mechanism.

The patch-generation prompt constrains expected output but is not relied upon by itself; code validates the returned patch before application.

## Not provided

Bridge has no caller authentication, HTTP or remote service, UI, persistent database, persistent task/thread/evidence supervision history, persistent logs, automatic timeout, automatic acceptance, or restart recovery of active task state. Do not expose the STDIO process through an untrusted wrapper. Do not place credentials or sensitive material in prompts, configuration, or public reports.

See [SECURITY.md](../SECURITY.md) for the operator-facing security policy and [threat-model.md](threat-model.md) for the compact threat summary.
