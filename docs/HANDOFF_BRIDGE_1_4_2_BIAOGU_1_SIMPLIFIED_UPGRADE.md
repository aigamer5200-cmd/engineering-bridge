# Engineering Bridge 1.4.2-biaogu.1 Simplified Upgrade Handoff

## Current execution context

```text
source repo: D:\Engineering_Bridge_System\engineering-bridge
isolated WT: D:\WORKTREE_ZONE\engineering-bridge-v1.4.2-biaogu-20260906
branch: candidate/bridge-v1.4.2-biaogu-20260906
base HEAD: fd6c208931f833301698eaeaa4593d92e401b706
upstream tag: v1.4.2
upstream commit: de09c35de9f7611bc0ee8c592bef4feb38e22e32
target version: 1.4.2-biaogu.1
```

GOAL runtime:

```text
session: engineering-bridge-20260906T035600Z-448297f3-f3af8a
executor_mode: web-gpt-ds
repository_write_authority: ds_apply_patch
```

## Production before promotion

At the start of this upgrade phase, the authoritative Bridge manager reported:

```text
production version: 1.2.1-biaogu.6
production port: 8768
canary port: 8769
previous version: 1.2.1-biaogu.5
```

No production Bridge switch has occurred at this checkpoint.

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

Current pre-candidate checkpoint:

```text
npm ci: PASS
npm run typecheck: PASS

full upstream + fork suite:
377 total
372 PASS
0 FAIL
5 SKIP

Biaogu critical regression:
112 PASS
0 FAIL
0 SKIP
```

The five full-suite skips are Windows platform limitations for tests that
require unsupported POSIX/symlink primitives in the current Windows execution
environment. They are explicitly reported rather than treated as passes.

## Do-not-touch boundaries

Until candidate/canary acceptance is complete:

- do not replace or overwrite the production `1.2.1-biaogu.6` runtime;
- do not delete previous Bridge versions;
- do not mutate `C:\Users\User\.codex`;
- do not expose credentials, account tokens, cookies, or auth files;
- do not I/W this candidate branch to the fork `main` without explicit Owner
  authorization;
- do not broaden Worktree authority outside `D:\WORKTREE_ZONE`.

## Next exact task

```text
1. Finalize the v1.4.2 reconciliation merge and checkpoint the candidate branch.
2. Inspect the existing painless-upgrade manager's prepare/canary/switch
   contracts against the upstream 1.4.2 13-tool MCP surface.
3. Confirm 1.2.1-biaogu.6 rollback capability remains intact.
4. Prepare immutable 1.4.2-biaogu.1 candidate runtime.
5. Start/verify canary on 8769.
6. Run MCP + GOAL compatibility smoke, including Biaogu routing/receipt paths.
7. If all canary gates pass, guarded-switch production 8768.
8. Run post-promotion production smoke.
9. On actual failure only, downgrade to retained 1.2.1-biaogu.6.
10. Update this HANDOFF, selective C/P, then wait for Owner I/W.
```

The next window/account can continue from this repository state plus this
handoff without relying on a previous Codex or chat session.
