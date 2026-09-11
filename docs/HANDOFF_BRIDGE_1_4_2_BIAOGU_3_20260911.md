# Engineering Bridge 1.4.2-biaogu.3 Release Handoff

Date: 2026-09-11

## Owner-approved objective

Promote the current Bridge runtime without losing the `1.4.2-biaogu.2`
full-access overlay, while adding task-local `service_tier` routing required by
the new GOAL role split:

```text
Bridge global / ordinary executor
  gpt-5.6-luna / max / priority

GOAL Child A / explicit A代理 only
  gpt-6-astra / low / standard

GOAL B/C/D executors
  gpt-5.6-luna / max / priority
```

Bridge Core remains role-neutral; the GOAL caller supplies the role-specific
task route.

## Release construction

```text
release branch:
  release/bridge-1.4.2-biaogu.3-20260911

base live runtime source:
  6a741c7ca914354bdaab9ac508a8cada6515ae51
  1.4.2-biaogu.2 full-access overlay

service-tier source feature:
  102ab24da7fa190ffb47c9c2881d24a69b9ca54b

release version:
  1.4.2-biaogu.3
```

The service-tier feature was reconciled onto the live `.2` source rather than
promoting source `main` directly, because the `.2` full-access overlay is not
an ancestor of current source `main`.

## Preserved boundaries

- Codex `run_task` default sandbox remains `danger-full-access` by current
  Owner policy.
- DSH remains read-only and rejects Codex-only routing fields / sandbox
  expansion.
- Controlled-patch generation/refinement remain read-only.
- `service_tier` changes compute routing only; it grants no Git push, I/W,
  production, credential, or target-project authority.
- No auth/token/credential payload is persisted in routing provenance.

## Verification

Release WT:

```text
D:\WORKTREE_ZONE\engineering-bridge-1.4.2-biaogu.3-20260911
```

Source regression:

```text
npm ci: PASS
npm test: PASS
386 tests / 381 pass / 0 fail / 5 platform skips
```

`npm ci` reports the existing dependency-audit baseline of 3 vulnerabilities
(2 moderate, 1 high). No unrelated dependency auto-upgrade was performed in
this bounded routing release.

## Next explicit task

After this release branch is C/P + pushed:

1. prepare immutable `1.4.2-biaogu.3` candidate through the governed painless
   upgrade manager;
2. run 8769 Canary with an explicitly authorized account only if needed for
   quota;
3. promote 8768 only after Canary PASS;
4. set the Bridge machine-global profile to exact Luna/MAX/priority at this
   already Owner-approved I/W boundary;
5. verify production health/schema plus ordinary Luna/MAX/priority and explicit
   A-agent Astra/LOW/standard provenance;
6. retain `1.4.2-biaogu.2` as immediate rollback runtime.

A fresh Web GPT / DS / Codex session can continue from this handoff and Git
state without any prior native-thread context.
