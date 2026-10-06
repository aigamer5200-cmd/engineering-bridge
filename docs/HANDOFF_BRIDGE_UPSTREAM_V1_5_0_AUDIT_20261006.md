# Engineering Bridge upstream v1.5.0 audit — 2026-10-06

Status: AUDIT COMPLETE / CHECKPOINT READY — no production change, no version promotion

## Scope

This phase audited upstream `wudy29/engineering-bridge` v1.5.0 against the
current accepted Biaogu production line. It intentionally did **not** merge,
promote, restart, or modify production.

Current authority at audit start:

```text
fork repo       = D:\Engineering_Bridge_System\engineering-bridge
fork main       = f4e19a3f2a1300ff94992ef7fe721e9ae5b2a1b4
runtime version = 1.4.2-biaogu.15
upstream tag    = v1.5.0
upstream SHA    = 33904f37f5aea530fa02da948a6f54d3968d0bf8
audit branch    = audit/upstream-v1.5.0-20261006
```

The accepted production ingress remains unchanged:

```text
Primary Green: Web GPT -> OpenAI Secure MCP Tunnel -> local STDIO Bridge -> official Codex app-server
Rollback Blue: Web GPT -> Cloudflare/:8768 -> local Bridge -> official Codex app-server
```

## Upstream v1.5.0 content

`v1.5.0` is the current upstream `main` tag. Its headline feature is retained
asynchronous controlled-patch validation:

- `start_controlled_patch_validation`
- `get_controlled_patch_validation`
- durable validation-run domain/store/ownership/worktree lifecycle
- service-owned async validation execution and retained results

Upstream tool catalog therefore grows from 13 to **15 tools**.

The v1.4.3/v1.4.4 commits included before v1.5.0 also add/fix:

- Codex app-server protocol hardening;
- optional explicit Codex routing policy;
- Windows workspace/path canonicalization and identity handling;
- larger bounded Codex JSONL frames (upstream 8 MiB hard cap);
- DSH interruption preservation;
- validation-process lifecycle hardening;
- Windows Server 2025 CI coverage.

## Current fork architecture differs intentionally

Current production deliberately exposes only four MCP tools:

```text
bind_project
run_task
task_result
control_task
```

This is the accepted **thin / pure Codex transport** architecture. The fork
removed the wider controlled-patch / APPLY / COMMIT / validation MCP surface
from the active catalog on purpose.

Important current fork capabilities already go beyond some upstream 1.4.4
bounds:

- current Codex JSONL hard cap is **16 MiB**, while upstream v1.4.4 uses 8 MiB;
- current task-local model/reasoning/service-tier routing is already integrated
  with the thin native app-server transport;
- current account/quota failover, execution receipts, Knowledge Preflight,
  development-stop guard, Secure MCP ingress, and GOAL-specific provenance do
  not exist in upstream;
- current Windows path/canonical handling and thin transport have their own
  regression coverage.

Therefore `v1.5.0` cannot be treated as a simple newer superset of the current
production fork.

## Divergence evidence

Common merge base:

```text
de09c35de9f7611bc0ee8c592bef4feb38e22e32
```

From that base:

```text
fork unique commits          = 93
upstream unique commits      = 25
fork changed files           = 102
upstream changed files       = 63
overlapping changed files    = 27
```

`git cherry HEAD v1.5.0` found no patch-equivalent upstream commits already
present verbatim in the fork. That does **not** mean all fixes are semantically
missing; several areas were independently rewritten in the thin transport.

## Dry-merge result

`git merge-tree --write-tree HEAD v1.5.0` fails with **22 textual conflicts**.

Core conflicts include:

```text
src/core/errors.ts
src/executors/codex-executor.ts
src/executors/executor.ts
src/mcp-stdio.ts
src/tasks/registered-workspace-task-service.ts
package.json
package-lock.json
```

There are also conflicts in the corresponding tests and project/docs metadata.

Conclusion: **direct merge is rejected**. This requires reconciliation, not a
normal merge upgrade.

## Windows test evidence

### Current fork (`1.4.2-biaogu.15`)

Same owner machine, fresh `npm ci && npm test`:

```text
tests   = 370
pass    = 365
fail    = 0
skip    = 5
```

Result: PASS.

### Upstream `v1.5.0`

Fresh detached worktree on the same owner machine:

```text
tests   = 650
pass    = 547
fail    = 6
skip    = 97
```

All six failures are Windows `EPERM` failures while tests try to create
symlinks without the required local symlink privilege. They are environment /
test-portability failures rather than evidence that the validation state
machine itself failed. However, the upstream tag is **not zero-fail on this
actual owner machine** under the current Windows policy.

## Dependency audit evidence

Both current fork and upstream v1.5.0 report the same production dependency
audit summary after fresh install:

```text
moderate = 3
high     = 1
critical = 1
total    = 5
```

The affected transitive packages are:

```text
fast-uri    high
hono        moderate
ip-address  moderate
proxy-addr  critical
qs          moderate
```

These are **not introduced by v1.5.0**; the current fork has the same findings.
Do not misclassify them as a v1.5.0 regression. They should be handled as a
separate dependency-security maintenance item with normal compatibility tests.

## Decision

### Rejected: direct merge / full catalog restoration

Do not merge `v1.5.0` directly into current main and then resolve conflicts.
That would simultaneously:

- cross 22 textual conflict boundaries;
- restore a 15-tool controlled-patch/validation surface that production
  intentionally removed;
- risk replacing current task-local routing / receipts / account failover /
  Secure MCP and GOAL transport semantics;
- create unnecessary migration risk for functionality not currently required.

### Recommended: selective reconciliation candidate

The next bounded implementation phase should start from current fork `main`,
not from a production switch, and selectively compare/port only upstream
hardening that benefits the **active four-tool transport**.

Priority order:

1. **Codex protocol hardening**
   - audit `f905ac2` and `274eee7` against the current thin
     `src/transport/codex-app-server.ts` plus current executor path;
   - port only missing protocol validation/error-classification tests or logic;
   - keep the current 16 MiB bounded frame unless evidence requires a change.
2. **Windows workspace/path hardening**
   - audit `dc838f9`, `3b4b9f0`, `06de0f9` against the current
     `workspace-directory` / registry/onboarding behavior;
   - port only missing containment/canonical-identity protections.
3. **Routing hard gate**
   - compare upstream `e8a15dd` with the current explicit task-local
     model/reasoning/service-tier design;
   - do not replace the current Owner-approved global-default + task-override
     semantics with upstream environment policy unless a real gap is proven.
4. **DSH / controlled-patch / validation fixes**
   - treat as inactive/legacy unless a current four-tool execution path proves
     they are still reachable;
   - do not re-expose controlled-patch or validation MCP tools just to claim
     v1.5.0 parity.
5. **Async validation (`7fc92bc`, `43127b8`, `2cbbab3`)**
   - exclude from the next candidate by default;
   - reconsider only if the Owner explicitly decides that Bridge should again
     own controlled-patch validation instead of remaining a thin transport.

## Versioning guidance

Do **not** label the next candidate `1.5.0-biaogu.*` merely because some
v1.5.0 fixes are selectively ported. That label would imply the upstream
v1.5.0 feature surface is present.

Until a true v1.5.0 baseline reconciliation is intentionally completed, keep
the current fork line and use the next Biaogu patch candidate (for example the
next `1.4.2-biaogu.*`) for selective hardening.

If a future requirement explicitly wants full upstream v1.5.0 semantics, open
a separate architecture migration whose acceptance includes the deliberate
decision whether the 15-tool surface should exist.

## Production / do-not-touch boundary

This audit made no production mutation. Do not change during the next
candidate phase without a later explicit production gate:

- current `1.4.2-biaogu.15` runtime;
- Secure MCP Green profile / tunnel / connector;
- Cloudflare Blue rollback lane;
- Codex auth/account profiles;
- GOAL main or Knowledge Base main;
- current four-tool public MCP surface unless the Owner explicitly changes the
  Bridge product boundary.

## Next explicit task

Create a fresh isolated candidate from the current fork and perform **selective
upstream hardening reconciliation** for the active four-tool path only. First
slice: Codex protocol + Windows path behavior, with focused tests before any
version bump or canary packaging.

Fresh Web GPT / DS / Codex sessions can continue from this document plus the
repository state; no prior native Codex thread is required.
