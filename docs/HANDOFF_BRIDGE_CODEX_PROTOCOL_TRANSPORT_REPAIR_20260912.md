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

## Final acceptance and production closeout

The repair checkpoint was committed and pushed before runtime promotion:

```text
Commit: 892e8dce5e61b37de337902d48a65ce39dc16084
Branch: fix/codex-protocol-astra-20260912
Push: PASS, upstream synchronized
```

Immutable `1.4.2-biaogu.4` was prepared through the existing painless-upgrade
manager from that exact commit. Preparation validation passed `npm ci`,
typecheck, the full test suite, and build.

Initial isolated 8769 Canary with account B passed before the later B-account
availability incident:

```text
Task: 822ebdda-0ea1-41d7-9cc9-3703c8c410c1
Account: B
Model profile: gpt-5.6-luna / max / priority
Result: PASS
```

A real B + Astra/LOW long repository audit then crossed the exact large-event
failure class that had produced `CODEX_PROTOCOL_ERROR` on `.3`: multiple large
UTF-8 `Get-Content -Raw` commands completed and the task reached
`waiting_for_supervisor_review` without protocol failure. This demonstrated
that the repaired transport accepts the valid large app-server frames in the
original workload shape.

After that proof, account B began failing immediately before any command
evidence with generic `CODEX_EXECUTION_FAILED`. The failure reproduced with
both B + Astra and B + Luna, including the manager's own account-B Canary, while
the same `.4` runtime passed with account A. This is therefore tracked as an
account/upstream execution-availability incident rather than a Bridge parser
regression. No further unbounded B retries were performed.

Cross-account/runtime isolation evidence:

```text
A + Astra/LOW/standard: PASS, waiting_for_supervisor_review, evidence present
B + Luna/MAX/priority: immediate CODEX_EXECUTION_FAILED, zero evidence
Manager Canary account B: same immediate CODEX_EXECUTION_FAILED
Manager Canary account A: PASS
```

Owner-authorized production promotion then switched the managed runtime from
`.3` to `.4`:

```text
Production version: 1.4.2-biaogu.4
Production commit: 892e8dce5e61b37de337902d48a65ce39dc16084
Previous version / rollback target: 1.4.2-biaogu.3
Manager switch verification: PASS
Post-switch manager verify: PASS
```

Fresh Engineering Bridge discovery after the switch still exposed the complete
13-tool surface, including the `run_task` account/model/reasoning/service-tier
and sandbox routing fields.

Two real post-promotion tasks were then executed through the actual production
Connector against the Phase 6 worktree:

```text
Task: 97f576d6-ce5d-4717-af86-ab0282285693
Route: A + gpt-6-astra / low / standard / danger-full-access
Workload: substantive long audit, >10 real files, large UTF-8 reads
Result: waiting_for_supervisor_review
Marker: BRIDGE_PROD_ASTRA_LONG_AUDIT_OK
Protocol error: none
Target repo mutation: none

Task: 268e7754-db03-42bc-9978-aa8ba00e6265
Route: A + gpt-5.6-luna / max / priority / danger-full-access
Workload: short production lifecycle smoke
Result: waiting_for_supervisor_review
Marker: BRIDGE_PROD_LUNA_OK
Protocol error: none
```

The long production audit also demonstrated that individual failed discovery
commands remain ordinary command evidence and do not poison a later successful
turn, as intended by the `.4` repair.

## Closeout status

Engineering Bridge transport repair `1.4.2-biaogu.4` is production-accepted.
The original false `CODEX_PROTOCOL_ERROR` blocker is closed.

Account B's current generic pre-command execution failure remains an external
availability item. Before product work intentionally depends on account B
again, perform one bounded B smoke after that account is available; do not
reopen the Bridge transport repair unless the failure is again specifically a
protocol/parser error.

The Taiwan-stock Phase 6 mainline may resume from its previously recorded safe
checkpoint. Scheduler activation, LINE enablement, GitHub Actions changes, or
historical backfill remain governed by that product project's own explicit
activation gates; this Bridge closeout does not perform any of them.

## Follow-up: account-B quota classification repair

After `.4` production acceptance, account B continued to fail before any Codex
command evidence was emitted. Direct `codex-switch` usage inspection proved the
account itself was at the active five-hour usage ceiling rather than suffering
an auth/profile or Bridge transport failure:

```text
Account B plan: plus
Primary 5h window used: 100%
Primary remaining: 0%
Reset credits available: 0
Primary reset: 2026-09-12 14:39:30 Asia/Taipei
```

The B profile auth file exists and has the same required structural fields as
the healthy A profile. The local `codex-switch` cache also reports B as
`account_limited=true` with `rate_limit_reached` while A remains available.

Release target `1.4.2-biaogu.5` therefore adds a narrow routing guard rather
than weakening account provenance or attempting to bypass provider quota:

- explicit account routing consults only the non-secret alias-keyed local
  usage cache;
- active 100% primary-window exhaustion returns
  `CODEX_ACCOUNT_QUOTA_EXHAUSTED` before launching the wrapper;
- a reset timestamp already in the past no longer blocks launch;
- missing/malformed cache data is ignored and preserves the prior launch path;
- explicit B never silently falls back to A.

This follow-up repairs the misleading failure classification. It cannot create
provider quota that the B account does not currently have; B becomes usable
again automatically when the provider usage window resets.

### `.5` production acceptance

The quota-classification follow-up completed full validation and was promoted
through the existing painless-upgrade path:

```text
Release: 1.4.2-biaogu.5
Source commit: 8141e83845d12da4d33ef38489632b568be0f657
Full unit suite: 393 tests / 388 pass / 0 fail / 5 platform skips
Immutable prepare: PASS
Canary account A: PASS
Production switch: PASS
Post-switch manager verify: PASS
Previous / rollback runtime: 1.4.2-biaogu.4
```

Fresh Connector discovery after promotion still exposed the complete 13-tool
surface and the existing account/model/reasoning/service-tier/sandbox routing
schema.

Production account-B classification smoke:

```text
Task: 5f317d1d-9f93-48aa-a3e5-6421ee5dd9b6
Route: B + gpt-5.6-luna / max / priority / danger-full-access
State: failed before Codex command evidence
Error: CODEX_ACCOUNT_QUOTA_EXHAUSTED
Evidence: 0
```

The same production runtime immediately passed a healthy explicit-account path:

```text
Task: aeed62a2-e200-4320-a7be-06a68fd82c6b
Route: A + gpt-5.6-luna / max / priority / danger-full-access
State: waiting_for_supervisor_review
Marker: BRIDGE_A_POST_QUOTA_FIX_OK
```

Therefore the previous generic `CODEX_EXECUTION_FAILED` symptom for the current
B-account condition is closed. While B remains at provider quota 0%, the
correct operational state is `CODEX_ACCOUNT_QUOTA_EXHAUSTED`; after the
2026-09-12 14:39:30 Asia/Taipei reset timestamp passes, the cached guard no
longer blocks B and the normal launch path is retried automatically.

This handoff is durable enough for a fresh Web GPT / DS / Codex session to
continue without the previous native session.
