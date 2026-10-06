# Selective upstream hardening candidate

## Candidate and authority

- Branch: `candidate/selective-upstream-hardening-20261006`.
- Base/unchanged HEAD: `f4e19a3f2a1300ff94992ef7fe721e9ae5b2a1b4`.
- Initial worktree: clean. Candidate changes are uncommitted; no C/P performed.
- Final pre-C/P state: C/P is authorized on this candidate feature branch only.
  The next commit containing this HANDOFF is the phase-safe/handoff checkpoint;
  its SHA is not yet assigned. No I/W, main or production authorization.
- Scope: active `bind_project`, `run_task`, `task_result`, `control_task` only.
- Active chain verified from current source: `mcp-stdio` -> `WorkspaceDirectory` /
  `ThinCodexTaskService` -> `CodexAppServerTransport`. Legacy executors/services
  are outside MCP composition.
- Internal executor: outer supervisor owns Telegram and further review.
- No production, main, Secure MCP Green/Cloudflare Blue, deploy, I/W or remote
  runtime changes. No merge/cherry-pick, account/quota, Knowledge Preflight,
  GOAL receipt or TG guard changes. Completed v1.5.0 audit was not repeated.

## Ref-by-ref reconciliation

| Ref | Already covered at base | True active-path gap reconciled | Intentionally excluded |
| --- | --- | --- | --- |
| `f905ac2` | RPC timeouts; generic sanitized errors; bounded cooperative interrupt and process-tree cleanup; matching terminal thread/turn checks; partial-output interruption | Fatal streaming UTF-8 decoding; strict object/envelope and consumed notification validation; reject server requests without acting on them; bind thread/turn IDs synchronously before next coalesced line; correlate agent items; replay early events only against response ID; stop chunk processing after terminal; dispatch valid final frame at stdout EOF; start 120-second protocol inactivity watchdog at turn response, even without started event | Legacy diagnostics/evidence receipts, model enumeration/validation, controlled-patch consumers, thread resume/steer, 15-minute absolute execution deadline. These are outside the active thin contract; no overall task-duration cap imported |
| `274eee7` | Fork already accepts up to **16 MiB** per JSONL frame and checks unfinished buffer by UTF-8 byte count; output is not truncated | Independent **64 KiB aggregate** early-event buffer; tests for >8 MiB valid frame, >16 MiB rejected frames and coalesced valid frames exceeding 16 MiB in aggregate | Upstream 8 MiB limit, evidence/text truncation |
| `dc838f9` | Canonical project binding; relative-path containment (already handles drive roots/case/sibling prefixes); queued/idempotent persistence; MCP entry schema delegates root checking | Shared active-path lexical root validation rejects Windows root-relative and device namespaces, accepts normalized drive/ordinary UNC roots; validates manual, approved and loaded managed roots | Legacy catalog/onboarding imports and controlled-patch tool surfaces; no second containment implementation |
| `3b4b9f0` | Relative containment already uses native `node:path` behavior | Use `realpathSync.native` for active canonical registration identity; Windows case and junction tests | Controlled-patch test changes and legacy registry edits |
| `06de0f9` | Canonical map and bind reuse exist | Refresh manual canonical identities before load duplicate checks and queued bind lookup, so a path created after construction retains its manual ID; managed records retain their captured canonical identity | Legacy registry implementation copied wholesale |
| `e8a15dd` | Optional exact model/reasoning/service-tier passthrough, omitted fields absent, native environment inherited, task result provenance already covered | Audit concluded no policy gap under current Owner thin-transport contract; add tests for independently optional dimensions and legacy explicit-policy environment not overriding omitted routing | No policy parser/env enforcement, mandatory model/reasoning pair, provider model list/fallback, DSH or controlled-patch routing policy. Upstream opt-in enforcement would contradict current optional task-local routing and native default inheritance |

## Changes and compatibility

- `src/transport/codex-app-server.ts`: protocol protections only; retain 16 MiB,
  exact native routing fields, environment inheritance, full output,
  content-array agent output and existing cleanup behavior. Unknown notification
  methods retain arbitrary JSON params compatibility. Unsupported server requests
  fail safely without approval, tools, credential refresh or input elicitation.
- `src/transport/workspace-paths.ts`: lexical helper scoped to thin path.
- `src/transport/workspace-directory.ts`: root validation, native identity and
  manual identity refresh; canonical containment and persistence remain local.
- `src/mcp-stdio.ts`: remove duplicate project-root check; directory now validates
  both configured root categories before startup. Four tools and schemas unchanged.
- `tests/unit/codex-app-server-transport.test.ts`: correlate simulated official
  item events; protect inherited/partial routing behavior.
- `tests/unit/thin-codex-protocol.test.ts`: deterministic fake-process protocol
  tests; no provider calls or credentials.
- `tests/unit/thin-workspace-directory.test.ts`: native Windows junction/case,
  boundary, persisted identity and lexical drive/UNC/namespace tests.

## Verification

All protocol verification is offline. Windows tests run on the local Windows filesystem;
ordinary UNC acceptance is lexical, not a live network-share probe.

- `npm ci`: successful; no package or lockfile change.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Supervisor independently reran the focused suite after build:
  **52 passed / 0 failed / 0 skipped**, using:

  ```powershell
  node --test dist/tests/unit/thin-codex-protocol.test.js dist/tests/unit/thin-workspace-directory.test.js dist/tests/unit/codex-app-server-transport.test.js dist/tests/unit/tasks/thin-codex-task-service.test.js dist/tests/unit/mcp-stdio.test.js
  ```

- Initial `npm test`: 409 total / 404 passed / 0 failed / 5 skipped.
  Supervisor independently reran final `npm test`: **413 total / 408 passed /
  0 failed / 5 skipped**, duration about **86.6s**.
  Five skips are existing platform-specific POSIX/legacy controlled-patch
  cases; all focused Windows and active MCP tests ran.
- Supervisor confirmed via tests that the active MCP surface remains exactly
  **4 tools**, and confirmed `MAX_JSONL_FRAME_BYTES` remains **16 MiB**.
- Supervisor reviewed the diff: no controlled-patch/APPLY/COMMIT/validation/
  async-validation surface was added to the active thin transport.
- Supervisor confirmed current optional Owner routing semantics remain:
  `e8a15dd` policy enforcement was intentionally not imported; only coverage for
  omitted/independently optional routing behavior was added.
- `git diff --check`: passed. Git only reports expected LF-to-CRLF conversion
  warnings for edited files.
- Pre-C/P branch and base HEAD were rechecked before checkpoint creation; the checkpoint commit containing this HANDOFF becomes the new candidate HEAD.
- Final regression log (local, outside repo):
  `%TEMP%\bridge-selective-hardening-regression-final-20261006.log`.
- Pre-C/P worktree contained four modified source/test files and four untracked
  candidate helper/test/HANDOFF files. The final candidate C/P stages these exact
  files together; generated `dist` and installed dependencies remain ignored build artifacts.

## Pending and next step

- Outer supervisor's independent verification and diff review are complete.
  Next: authorized final C/P on `candidate/selective-upstream-hardening-20261006`
  with this HANDOFF included in the phase-safe/handoff checkpoint.
- After C/P: Owner acceptance / decision whether to authorize I/W later.
  No I/W, main or production action is authorized.
- No known candidate failure at handoff. No live Codex/provider or production
  acceptance claimed. Dependency install reports 5 existing vulnerabilities
  (3 moderate, 1 high, 1 critical); dependency remediation is outside this task.
- A different Codex account/session can resume directly from this document,
  current branch and worktree state without the prior native thread. Use a new
  account-bound thread; do not cross-account resume.
