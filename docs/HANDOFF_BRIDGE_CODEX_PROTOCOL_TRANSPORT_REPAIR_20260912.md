# Engineering Bridge Codex Protocol Transport Repair Handoff

Date: 2026-09-12

## Frozen objective

Repair false `CODEX_PROTOCOL_ERROR / Codex returned an invalid response`
failures observed on B + `gpt-6-astra` / LOW repository audits without
weakening the current routing, sandbox, or credential boundaries.

The Taiwan-stock Phase 6 live Scheduler wiring remains paused until this Bridge
repair passes real Canary acceptance.

## Starting production checkpoint

```text
Production runtime: 1.4.2-biaogu.3
Production commit: 3cedd7442b32a99e34daba0782f7e271a7c3e1df
Repair branch: fix/codex-protocol-astra-20260912
Repair base: release/bridge-1.4.2-biaogu.3-20260911
Repair WT: D:\WORKTREE_ZONE\engineering-bridge-baf69a80
```

The repair is intentionally based on the live `.3` release lineage rather than
source `main`, because `.3` contains the already-verified full-access and
service-tier overlays that are not represented by the current `main` ancestry.

## Root cause

Bridge previously rejected any single Codex app-server JSONL line larger than
65,536 bytes before attempting JSON parsing.

This is not a safe protocol assumption. Current Codex app-server
`commandExecution` items legitimately include `aggregatedOutput` in the same
JSONL frame. The failing Astra task read these files in one PowerShell command:

```text
.agents/skills/bioguard-windows-shell-safe-execution/SKILL.md       12,734 bytes
.agents/skills/bioguard-window-handoff-and-codex-prompt-routing/SKILL.md
                                                                    6,053 bytes
docs/HANDOFF_GCP_EXECUTION_MIGRATION_CURRENT_STATUS.md             146,106 bytes
docs/GCP_EXECUTION_MIGRATION_PHASE6_FULL_NATURAL_9_CARD_CYCLE_PREPARATION_20260911.md
                                                                   13,184 bytes
TOTAL                                                              178,077 bytes
```

The resulting valid `item/completed -> commandExecution` frame therefore
exceeded Bridge's 64 KiB line ceiling and was incorrectly mapped to
`CODEX_PROTOCOL_ERROR`. This also explains why shortening the final chat answer
did not fix the failure: the crash happened on an intermediate tool event.

The current Codex CLI is `0.154.0`; generated app-server v2 bindings confirm
that `commandExecution` includes `aggregatedOutput`, `exitCode`, and
`durationMs`, while `agentMessage.text` remains a string. The agent-message
shape hypothesis was therefore ruled out.

## Repair

Release target: `1.4.2-biaogu.4`.

- Valid complete JSONL frames are accepted up to a defensive 16 MiB transport
  ceiling.
- Partial/chunked frames continue to buffer until newline completion.
- A truly oversized unterminated frame still fails closed.
- Evidence stays independently bounded; large `aggregatedOutput` is not copied
  into `evidence` or `task_result`.
- A failed shell command remains evidence and does not itself become a protocol
  failure when the Codex turn later completes normally.
- Unknown non-dangerous notification methods are tolerated when their basic
  JSON-RPC envelope is valid.
- Completed agent messages are normalized from current `text` and a compatible
  text-content fallback.
- `CODEX_PROTOCOL_ERROR` now preserves bounded content-free diagnostics:
  parser stage, event sequence, frame bytes, last method/item type,
  final-frame presence, subprocess exit code, byte counts, and SHA-256 of
  bounded stdout/stderr tails.
- Raw stdout/stderr, instructions, response bodies, tokens, auth files, and
  credentials are not persisted in those diagnostics.
- Generic failures and interrupted tasks retain the previous diagnostics
  boundary.

## Preserved boundaries

- Codex interactive `run_task` default remains `danger-full-access`.
- A caller may still narrow Codex to `workspace-write` or `read-only`.
- DSH remains pinned read-only.
- Controlled-patch generation/refinement remain read-only.
- Account/model/reasoning/service-tier routing semantics are unchanged.
- No auth/token/API key content is read, logged, staged, or committed.
- This repair does not grant Git push, I/W, deployment, or target-product
  production authority.

## Regression evidence before release Canary

The original bug was first captured as a RED test: a valid large
`commandExecution` frame produced `failed / CODEX_PROTOCOL_ERROR` on `.3`.

After the repair, targeted coverage passes for:

- valid >64 KiB commandExecution frame;
- chunked JSON frame buffering;
- Traditional Chinese + emoji final output;
- failed command inside otherwise successful audit;
- unknown optional notification;
- truly overlong unterminated frame;
- bounded safe protocol diagnostics exposed only for `CODEX_PROTOCOL_ERROR`.

Full source suite after repair:

```text
npm test: PASS
391 tests
386 pass
0 fail
5 platform skips
```

Existing dependency-audit baseline remains 3 findings (2 moderate, 1 high).
No unrelated dependency upgrade is included in this bounded repair.

## Remaining acceptance before product mainline resumes

1. C/P this exact repair branch/checkpoint.
2. Build immutable `1.4.2-biaogu.4` through the existing painless-upgrade
   manager.
3. Run isolated 8769 Canary.
4. Run a real B + Astra/LOW/standard + `danger-full-access` audit against
   `D:\WORKTREE_ZONE\biaogu-gcp-migration-phase6-20260910`, reading at least ten
   real files and returning substantive architecture findings with multiple
   commandExecution evidence items.
5. Cross-check A + Astra/LOW and B + Luna/MAX.
6. Only after Canary/regression PASS may Production promotion be considered.
7. Production promotion/restart remains a separate operational authority; do
   not silently replace `.3`.

This handoff is durable enough for a fresh Web GPT / DS / Codex session to
continue without the previous native session.
