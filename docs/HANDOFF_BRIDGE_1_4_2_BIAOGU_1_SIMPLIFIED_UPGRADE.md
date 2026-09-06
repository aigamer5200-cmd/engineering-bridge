# Engineering Bridge 1.4.2-biaogu.1 Simplified Upgrade Handoff

## 2026-09-06 post-acceptance connectivity follow-up

Owner reported that the current Web ChatGPT window could still create Bridge
tasks but a default Codex `run_task` ended as `CODEX_EXECUTION_FAILED`.

This follow-up did **not** identify a Bridge Production regression.

Current Production verification:

```text
Bridge Production: 1.4.2-biaogu.1
local MCP / OAuth health: PASS
public MCP / OAuth health: PASS
local authenticated tools/list: exact 13 tools / PASS
public authenticated tools/list: exact 13 tools / PASS
explicit B Codex real turn via local Production: PASS
explicit B Codex real turn via public Production: PASS
sandbox unchanged in both E2E checks: PASS
```

The account router's non-secret usage status showed that the currently native /
default account had exhausted its long-window quota while explicit alias `B`
still had available quota. The accepted product rule remains unchanged:

```text
no silent A -> B account fallback
account routing stays explicit and task-scoped
AUTO remains fail-closed
```

The active ChatGPT connector session in the reporting window still exposed the
pre-1.4 exact 10-tool schema. In particular, its cached `run_task` schema did
not expose the 1.4.2 `account` / exact model / reasoning routing inputs. A fresh
authenticated call made directly to the same public Production endpoint
returned the exact 13-tool 1.4.2 surface and completed an explicit `B` real
Codex turn successfully.

Therefore the remaining limitation is a **stale Web ChatGPT connector/tool
schema in that already-open conversation**, not a local Bridge runtime,
tunnel, OAuth, or Codex-executor defect. Do not patch Bridge Core or silently
change the default account to work around an old conversation schema. Open a
fresh ChatGPT window / connector session and re-run tools discovery; the fresh
session should receive the current 13-tool schema and can then route explicit
`B` normally.

The earlier diagnostic `DSH_UNAVAILABLE` refers to Bridge's separate optional
DeepSeek Shell executor. It is not DevSpace (DS) and is not a blocker for the
Codex Bridge path verified above. No DSH installation/change was performed in
this follow-up.

No credential, token, cookie, auth-file payload, email address, or account ID
was written to this handoff.

## Current execution context

```text
source repo: D:\Engineering_Bridge_System\engineering-bridge
isolated WT: D:\WORKTREE_ZONE\engineering-bridge-v1.4.2-biaogu-20260906
branch: candidate/bridge-v1.4.2-biaogu-20260906
base HEAD: fd6c208931f833301698eaeaa4593d92e401b706
upstream tag: v1.4.2
upstream commit: de09c35de9f7611bc0ee8c592bef4feb38e22e32
target version: 1.4.2-biaogu.1
runtime source commit: 53b87af1ad800bfbb9c4b533a46d6ce3c295df95
```

GOAL runtime:

```text
session: engineering-bridge-20260906T035600Z-448297f3-f3af8a
executor_mode: web-gpt-ds
repository_write_authority: ds_apply_patch
```

## Production promotion result

At the start of this upgrade phase, Production was:

```text
production version: 1.2.1-biaogu.6
production port: 8768
canary port: 8769
previous version: 1.2.1-biaogu.5
```

The simplified guarded promotion completed successfully on 2026-09-06:

```text
current production version: 1.4.2-biaogu.1
current production root: D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.1
production port: 8768
production PID at promotion/verification: 49696
recorded previous version: 1.2.1-biaogu.6
recorded previous root: D:\Engineering_Bridge_System\BridgeVersions\1.2.1-biaogu.6
canary port after acceptance: closed / no listener
```

The manager's guarded switch verified both local and public surfaces:

```text
local /mcp unauthenticated: 401
local OAuth metadata: 200
public /mcp unauthenticated: 401
public OAuth metadata: 200
```

No rollback was required.

## Owner-approved simplified upgrade policy

The Owner explicitly selected the same simplified policy used for the DevSpace
1.0.8 upgrade:

```text
do not require a complete rollback drill before promotion
retain the full current known-good runtime
retain required config/state backup and rollback capability
validate a separate candidate/canary first
perform a guarded production switch only after acceptance
run production health / MCP / GOAL smoke immediately after promotion
downgrade to the retained previous runtime only if production actually fails
```

Therefore rollback **capability is mandatory**, while a pre-promotion rollback
**drill is not**.

## Upstream reconciliation

The fork and upstream had materially diverged after the prior common base, so
this upgrade is a real reconciliation rather than a version-string update.

The reconciliation rule is:

```text
upstream v1.4.2 core behavior is the baseline
-> preserve only still-required Biaogu / Shoestring GOAL overlays
-> do not overwrite new upstream validation / controlled-COMMIT behavior with
   obsolete fork patches
```

Upstream v1.4.2 additions retained include controlled validation,
`submit_controlled_patch`, controlled `COMMIT`, fresh/unborn repository commit
support, executor liveness hardening, model/reasoning validation, and the
expanded 13-tool MCP surface.

## Biaogu / GOAL overlays preserved

The current candidate preserves the local production contract for:

- task-scoped explicit Codex account routing through the optional
  `codex-switch` adapter;
- isolated multi-account `CODEX_HOME` handling and fail-closed account aliases;
- Windows global-npm Codex provider preference with safe executable fallback;
- exact model routing and the existing `reasoning` alias mapped to upstream
  `turn/start.effort` semantics;
- Codex-only native live web research while OS/shell networking remains
  disabled;
- Knowledge Preflight Receipt injection;
- Bridge-authored bounded execution receipts;
- read-only task observer;
- existing GOAL role/authority separation and no implicit write expansion.

## Windows compatibility repair

Upstream v1.4.2 controlled-COMMIT fingerprints unrelated untracked files with
`O_NOFOLLOW`. Node on Windows does not expose that flag, which caused a real
Windows fail-closed path whenever unrelated untracked files were present.

The candidate keeps native `O_NOFOLLOW` on supported platforms and uses a
bounded Windows fallback that verifies:

- ordinary-file `lstat` before opening;
- unchanged canonical `realpath`;
- opened-file metadata equals the pre-open metadata;
- content hash from a read-only handle;
- unchanged path/file metadata after reading;
- the path did not become a symlink;
- canonical path remains unchanged after reading.

This is a Windows compatibility repair, not a relaxation of controlled-COMMIT
scope or authority.

## Validation evidence

Final candidate source validation:

```text
npm ci: PASS
npm run typecheck: PASS

full upstream + fork suite:
382 total
377 PASS
0 FAIL
5 SKIP

candidate commit: 53b87af1ad800bfbb9c4b533a46d6ce3c295df95
candidate branch pushed: PASS
candidate branch ahead/behind origin: 0 / 0
```

The five full-suite skips are Windows platform limitations for tests that
require unsupported POSIX/symlink primitives in the current Windows execution
environment. They are explicitly reported rather than treated as passes.

The painless-upgrade manager then prepared the exact immutable runtime from
`53b87af1ad800bfbb9c4b533a46d6ce3c295df95`:

```text
runtime: D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.1
manifest version: 1.4.2-biaogu.1
manifest commit: 53b87af1ad800bfbb9c4b533a46d6ce3c295df95
package-lock SHA256: 0419772A30F17461668F0891F30DFEEE7C3D799B721630983BBFB9FB1D620445
npm ci: PASS
typecheck: PASS
npm test: PASS
build: PASS via npm test
```

### Canary acceptance

The first Canary attempt correctly fail-closed because the old smoke harness
still expected the pre-1.4 exact 10-tool surface. The harness was made
version-aware: pre-1.4 remains exact 10 tools and 1.4+ requires exact 13 tools.

The next live task failed with `CODEX_EXECUTION_FAILED`. A same-time Canary of
the still-current `1.2.1-biaogu.6` failed identically. A direct read-only Codex
diagnostic then proved the native account had reached its usage limit, so this
was not a Bridge 1.4.2 regression.

The already-authorized multi-account module showed alias B with available
quota. After completing the missing optional Bridge multi-account environment
wiring, the 1.4.2 Canary passed with explicit alias B:

```text
Canary version: 1.4.2-biaogu.1
Canary port: 8769
MCP tools: exact 13 / PASS
Codex task: PASS
real thread_id: PASS
account routing: B / PASS
marker: BRIDGE_CANARY_OK
sandbox unchanged: PASS
Canary report status: PASS
```

No credential, token, cookie, auth-file content, or account identifier is
stored in the handoff or Canary report; only the non-secret alias is retained.

### Post-promotion production smoke

After the guarded switch, the existing local OAuth access store was used only
in-memory to authenticate a local 8768 MCP client; the token was never printed.

```text
server version: 1.4.2-biaogu.1
authenticated MCP connection: PASS
MCP tools: exact 13 / PASS
explicit B account task: PASS
real Codex thread: PASS
marker: BRIDGE_PRODUCTION_OK
sandbox unchanged: PASS
```

### Rollback capability after promotion

No pre-upgrade full rollback drill was performed, per the Owner-approved
simplified policy. After promotion, a non-switching rollback-capability check
confirmed:

```text
rollback target runtime 1.2.1-biaogu.6: valid
rollback target Canary authority: PASS
rollback target commit: 8a3e3be63911a34c664a13822d387afe0f79b87d
manager previous pointer: 1.2.1-biaogu.6
```

Therefore downgrade capability remains live without having disrupted the
healthy 1.4.2 Production runtime.

## Operational control-plane reconciliation

The versioned Bridge source is not the only upgrade authority. The external
control plane under `D:\Engineering_Bridge_System` was also reconciled:

- `control\apply_bridge_local_overlays.py`
  - retains the legacy 1.2.x overlay path;
  - supports the upstream 1.4.2 executor shape;
  - keeps upstream default model behavior unchanged when no Bridge profile env
    is loaded;
  - applies the sanctioned Bridge profile only when its environment authority
    is present.
- `control\manage_bridge_painless_upgrade.py`
  - materializes only the five non-secret multi-account routing fields from the
    canonical Shoestring multi-account manager;
  - loads them optionally in Canary and Production wrappers;
  - supports an explicit Canary account alias;
  - keeps missing/disabled multi-account state on the native Codex path;
  - emits UTF-8-safe CLI output.
- `runtime\bridge-canary-http-smoke.cjs`
  - exact 10-tool acceptance for pre-1.4 runtimes;
  - exact 13-tool acceptance for 1.4+;
  - optional explicit account routing for acceptance only.
- `runtime\bridge-production-http-smoke.cjs`
  - authenticates to local Production with an already-existing OAuth token
    entirely in memory;
  - never prints the credential;
  - verifies exact 13 tools, a real B-account turn, and sandbox invariance.
- `control\BRIDGE_PAINLESS_UPGRADE_POLICY.md`
  - records the Owner-approved simplified upgrade policy;
  - explicitly preserves rollback capability while removing a mandatory
    pre-upgrade rollback rehearsal;
  - records current Production `1.4.2-biaogu.1` and previous
    `1.2.1-biaogu.6`.

The runtime now also has
`runtime\bridge-codex-multi-account.env`. It contains only the five sanctioned
non-secret routing keys (switch executable path, switch state path, isolated
Codex home, alias allowlist, and Codex binary directory). It contains no token
or auth payload.

## Do-not-touch boundaries after promotion

- do not delete or overwrite the previous `1.2.1-biaogu.6` rollback runtime;
- do not delete previous Bridge versions;
- do not mutate `C:\Users\User\.codex`;
- do not expose credentials, account tokens, cookies, or auth files;
- do not I/W this candidate branch to the fork `main` without explicit Owner
  authorization;
- do not broaden Worktree authority outside `D:\WORKTREE_ZONE`.

## Remaining Owner gate

```text
Upgrade execution: COMPLETE
Production acceptance: PASS
Rollback capability: PRESERVED
Candidate source branch: checkpointed/pushed

Next action requires Owner authorization:
I/W candidate/bridge-v1.4.2-biaogu-20260906 into the fork main, or leave the
source candidate branch isolated while Production continues to run the
immutable 1.4.2-biaogu.1 runtime.
```

The next window/account can continue from this repository state plus this
handoff without relying on a previous Codex or chat session.
