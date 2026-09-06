# Controlled Patch Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, trusted, isolated validation of retained controlled-patch proposals without making ordinary Engineering Bridge paths heavier.

**Architecture:** Store one trusted validation profile per registered workspace in a Bridge-owned sidecar file, loaded lazily only when configuration or validation is invoked. `ControlledPatchService` exposes the retained proposal and its existing preflight through a narrow read-only adapter; `ControlledPatchValidationService` creates one temporary detached Git worktree, applies the candidate patch there, executes fixed argv steps sequentially through a no-shell bounded process runner, cleans up, and returns `PASS`, `FAIL`, or `INCOMPLETE`. Two MCP tools expose configuration and validation; no existing task/proposal/apply lifecycle is changed.

**Tech Stack:** Node.js >=22, TypeScript 5.8.3, `@modelcontextprotocol/sdk`, Zod 3, `node:test`, Git worktrees, Node `child_process.spawn`.

**Spec:** `docs/superpowers/specs/2026-08-27-controlled-patch-validation-design.md`

## Global Constraints

- Keep the existing `run_task`, `task_result`, controlled-patch proposal, and APPLY paths cold with respect to validation: no project scan, worktree creation, validator subprocess, validation wait, or validation profile lookup from those paths.
- Validation profiles are Bridge-owned local configuration outside the project tree; repository files never define or replace executable validation commands.
- `configure_validation_profile` requires exact `CONFIGURE`. Do not reuse `AUTHORIZE`.
- One workspace has one complete current profile in v1; replacement is atomic.
- Configured commands are non-empty argv arrays and always execute with `shell: false`; validation-time callers cannot supply commands, argv, shell text, environment scripts, or timeout overrides.
- `validate_controlled_patch` accepts only `patch_task_id`.
- Reuse the existing controlled-patch workspace/base/patch preflight; do not duplicate its safety rules.
- A retained proposal with absent/null `base_head` returns `INCOMPLETE` with reason `unsupported_unborn_base` before temporary-worktree creation or command execution.
- Default per-step timeout is 600 seconds; total validation timeout is 1200 seconds. A fixed cleanup bound is implementation-owned and must remain small.
- Run one temporary worktree and one subprocess at a time. Stop on first definite nonzero configured-command exit or any timeout.
- Keep only a fixed bounded output tail per process. Do not add persistent full logs.
- Overall result is exactly `PASS`, `FAIL`, or `INCOMPLETE`; cleanup/infrastructure failure prevents `PASS` or `FAIL` from being reported as complete.
- Validation never mutates proposal/task lifecycle state, never grants APPLY, and is not automatically bound to APPLY in v1.
- No dynamic focused-test selection, retries, matrices, parallel runners, background workers, queues, event bus, executor pool, session manager, Docker/VM sandbox, persistent log service, validation history, artifact retention, or profile language.
- Temporary-worktree isolation protects the registered Git workspace but is not a host-level sandbox.
- Follow TDD. For each task, land RED evidence before GREEN implementation where practical.
- Every implementation Worker must load the repository's `private-house-code` skill plus the relevant Superpowers execution/TDD skill before writing code.
- Existing user gates remain authoritative. Never execute `BIND`, `AUTHORIZE`, `APPLY`, `COMMIT`, or `PUSH` without the user's exact corresponding confirmation. Any commit step below is a checkpoint: stop and request exact `COMMIT` before running it.

---

## File Structure

**Create**
- `src/tasks/validation-profile-store.ts` — lazy, atomic Bridge-owned storage for one resolved validation profile per workspace.
- `src/tasks/validation-process-runner.ts` — direct argv subprocess execution with no shell, timeout control, and bounded output tail.
- `src/tasks/controlled-patch-validation-service.ts` — configuration boundary plus proposal validation coordinator/worktree lifecycle.
- `tests/unit/tasks/validation-profile-store.test.ts`
- `tests/unit/tasks/validation-process-runner.test.ts`
- `tests/unit/tasks/controlled-patch-validation-service.test.ts`

**Modify**
- `src/tasks/controlled-patch-service.ts` — expose a narrow read-only retained-proposal/preflight adapter for validation.
- `tests/unit/tasks/controlled-patch-service.test.ts` — prove the adapter reuses existing preflight and does not mutate proposal state.
- `src/mcp-stdio.ts` — instantiate the validation components lazily and register the two new MCP tools.
- `tests/unit/mcp-stdio.test.ts` — tool schema/gate/wiring/non-regression coverage.
- `README.md`
- `README.zh-CN.md`
- `SECURITY.md`

No other production file is required by the approved v1 design. If implementation discovers a genuine need for another production module or a new lifecycle/state concept, stop and return to design review instead of expanding scope.

---

### Task 1: Add the lazy trusted validation profile store

**Files:**
- Create: `src/tasks/validation-profile-store.ts`
- Test: `tests/unit/tasks/validation-profile-store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ValidationStep {
  readonly name: string;
  readonly argv: readonly [string, ...string[]];
  readonly timeoutSeconds?: number;
}

export interface ValidationProfile {
  readonly preparation: readonly ValidationStep[];
  readonly validation: readonly ValidationStep[];
  readonly defaultStepTimeoutSeconds: number;
  readonly totalTimeoutSeconds: number;
}

export class ValidationProfileStore {
  constructor(stateFilePath?: string);
  get(workspaceId: string): Promise<ValidationProfile | undefined>;
  configure(workspaceId: string, profile: ValidationProfile): Promise<ValidationProfile>;
}
```

- Persistence envelope:

```json
{
  "version": 1,
  "profiles": [
    {
      "workspace_id": "workspace-id",
      "preparation": [],
      "validation": [],
      "default_step_timeout_seconds": 600,
      "total_timeout_seconds": 1200
    }
  ]
}
```

- `get()` and `configure()` call a private `ensureLoaded()`; constructor/startup does no file I/O.
- `configure()` replaces the whole workspace profile atomically and serializes concurrent mutations with the same queue pattern already used by `ManagedWorkspaceCatalog`.
- State writes use a sibling temporary file, mode `0o600`, then `rename`; failed persistence rolls back in-memory state.
- Persisted records are parsed as data only. Invalid individual records are ignored safely; malformed top-level JSON/envelope/version fails closed with `CoreError("INTERNAL_ERROR")`.
- Store cloned/frozen plain data so callers cannot mutate the stored profile through returned references.

- [ ] **Step 1: Write failing lazy-load and round-trip tests**

Add tests that:
1. construct `ValidationProfileStore` with a state path whose parent exists but whose file is malformed and prove construction itself does not read it;
2. call `get("workspace-a")` and expect `INTERNAL_ERROR` from malformed top-level state;
3. configure a resolved profile in a fresh store, create a second store over the same file, and assert exact round-trip values;
4. replace the same workspace profile and assert only the replacement remains;
5. configure two workspace ids and assert both survive;
6. simulate a failed atomic write and assert the previous in-memory profile remains.

Use a representative profile:

```ts
const PROFILE: ValidationProfile = {
  preparation: [{ name: "install", argv: ["npm", "ci", "--ignore-scripts"] }],
  validation: [{ name: "test", argv: ["npm", "test"], timeoutSeconds: 90 }],
  defaultStepTimeoutSeconds: 600,
  totalTimeoutSeconds: 1200
};
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/validation-profile-store.test.js
```

Expected: FAIL because `validation-profile-store.ts` / `ValidationProfileStore` does not exist.

- [ ] **Step 3: Implement the minimal lazy atomic store**

Implement only the interfaces and persistence behavior above. Mirror the existing atomic-write discipline from `src/workspaces/managed-workspace-catalog.ts`; do not introduce a generic configuration framework.

Profile parsing must enforce:
- non-empty `workspace_id`;
- `preparation` and `validation` arrays;
- non-empty step `name`;
- non-empty argv array whose items are strings;
- optional positive integer `timeout_seconds`;
- positive integer `default_step_timeout_seconds`;
- positive integer `total_timeout_seconds`.

Persist the resolved field names shown in the envelope. Do not infer commands from the repository.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/validation-profile-store.test.js
npm run typecheck
```

Expected: all focused tests PASS and typecheck PASS.

- [ ] **Step 5: Supervisor review checkpoint**

Review only the new store and test for lazy I/O, atomic replacement, strict data parsing, rollback, and absence of repository inspection or command execution.

- [ ] **Step 6: Commit gate**

Proposed commit message:

```text
feat: add validation profile store
```

STOP and request exact `COMMIT`. Do not stage or commit before that gate.

---

### Task 2: Expose retained proposal data and the existing preflight for validation

**Files:**
- Modify: `src/tasks/controlled-patch-service.ts`
- Test: `tests/unit/tasks/controlled-patch-service.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ControlledPatchValidationProposal {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly baseHead: string | null;
  readonly patch: string;
}

validationProposal(patchTaskId: string): ControlledPatchValidationProposal;
preflightValidationProposal(patchTaskId: string): Promise<ControlledPatchValidationProposal>;
```

- `validationProposal()` is read-only. It requires a retained proposal and a completed task result, then returns workspace identity/root, `baseHead` (`null` for unborn), and the complete patch.
- `preflightValidationProposal()` calls `validationProposal()`, then reuses the existing private `preflightPatch()` against that same proposal base/patch and returns the same proposal view.
- Neither method changes proposal state, pinning, retention, APPLY authorization, or task lifecycle.

- [ ] **Step 1: Add failing adapter tests**

Extend `controlled-patch-service.test.ts` with tests proving:
1. a completed retained commit-based proposal returns exact workspace id/root/base SHA/patch;
2. an unborn retained proposal returns `baseHead: null`;
3. unknown/incomplete proposal ids fail with the existing safe state error rather than fabricating data;
4. `preflightValidationProposal()` observes HEAD/workspace drift through the same `WORKSPACE_PRECONDITION_FAILED` behavior as APPLY/submit preflight;
5. calling either adapter leaves proposal state and APPLY eligibility unchanged.

Use the existing service test helpers and fake Git process style already present in the file; do not create a second patch parser or a second workspace verifier in tests or production.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/controlled-patch-service.test.js
```

Expected: FAIL because the two adapter methods/interfaces do not exist.

- [ ] **Step 3: Implement the minimal adapter**

Add the exported interface and the two methods next to the existing public controlled-patch methods. Reuse:
- `this.proposals`;
- `this.tasks.result(...)`;
- the proposal's stored `base`;
- existing `preflightPatch(...)`.

Do not change `preflightPatch`, APPLY semantics, retained-state format, proposal state values, or task state values.

- [ ] **Step 4: Run focused tests and full controlled-patch regression**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/controlled-patch-service.test.js
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Independent Supervisor review**

Confirm the adapter is a read-only view over existing state and that preflight is actually reused rather than copied.

- [ ] **Step 6: Commit gate**

Proposed commit message:

```text
feat: expose patch validation preflight
```

STOP and request exact `COMMIT`.

---

### Task 3: Add the no-shell bounded validation process runner

**Files:**
- Create: `src/tasks/validation-process-runner.ts`
- Test: `tests/unit/tasks/validation-process-runner.test.ts`

**Interfaces:**
- Produces:

```ts
export type ValidationProcessOutcome =
  | {
      readonly kind: "exit";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly outputTail: string;
    }
  | {
      readonly kind: "timeout" | "spawn_error" | "signal";
      readonly durationMs: number;
      readonly outputTail: string;
    };

export interface ValidationProcessRequest {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly input?: string;
}

export type ValidationProcessStarter = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export interface ValidationTimer {
  now(): number;
  set(callback: () => void, delayMs: number): NodeJS.Timeout;
  clear(handle: NodeJS.Timeout): void;
}

export class ValidationProcessRunner {
  constructor(startProcess?: ValidationProcessStarter, timer?: ValidationTimer);
  run(request: ValidationProcessRequest): Promise<ValidationProcessOutcome>;
}
```

Implementation constants:

```ts
const MAX_OUTPUT_TAIL_BYTES = 65_536;
```

- The first argv item is the executable; the rest are literal arguments.
- Spawn options are exactly compatible with `{ cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] }`.
- Capture a combined bounded tail from stdout/stderr as data arrives; never retain unbounded full output.
- Timeout terminates the active child and resolves as `kind: "timeout"`.
- Spawn failure resolves as `spawn_error`; signal termination without a numeric exit resolves as `signal`.
- Duration uses an injectable/replaceable clock or test-controlled timer seam so tests do not depend on wall-clock thresholds.

- [ ] **Step 1: Write failing runner behavior tests**

Cover:
1. executable/argv/cwd are passed exactly and `shell === false`;
2. an argument such as `"; rm -rf /"` reaches the fake spawn unchanged as one literal argument;
3. stdin input is forwarded and closed;
4. exit code 0 and nonzero exit codes are preserved;
5. stdout + stderr larger than 65,536 bytes retains only the bounded tail;
6. timeout kills the child and returns `timeout`;
7. `error` before close returns `spawn_error`;
8. close with signal/no numeric exit returns `signal`;
9. timer cleanup prevents a timeout firing after normal exit.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/validation-process-runner.test.js
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement the runner**

Use `node:child_process.spawn` directly; no shell helper, command string parser, retry mechanism, output file, or background process manager.

Keep tail accounting byte-bounded. If truncation cuts through a UTF-8 sequence, normalize the retained buffer/string safely before returning; never increase the bound to recover earlier output.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/validation-process-runner.test.js
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Supervisor security review**

Check `shell: false`, literal argv preservation, bounded memory, deterministic timeout behavior, and absence of retry/background logic.

- [ ] **Step 6: Commit gate**

Proposed commit message:

```text
feat: add validation process runner
```

STOP and request exact `COMMIT`.

---

### Task 4: Implement isolated controlled-patch validation

**Files:**
- Create: `src/tasks/controlled-patch-validation-service.ts`
- Test: `tests/unit/tasks/controlled-patch-validation-service.test.ts`
- Consume: `src/tasks/controlled-patch-service.ts`
- Consume: `src/tasks/validation-profile-store.ts`
- Consume: `src/tasks/validation-process-runner.ts`

**Interfaces:**
- Produces:

```ts
export type ValidationStatus = "PASS" | "FAIL" | "INCOMPLETE";

export interface ValidationStepResult {
  readonly name: string;
  readonly status: ValidationStatus;
  readonly exit_code?: number;
  readonly duration_ms: number;
  readonly output_tail: string;
}

export interface ControlledPatchValidationReport {
  readonly status: ValidationStatus;
  readonly patch_task_id: string;
  readonly workspace_id: string;
  readonly base_head: string | null;
  readonly total_duration_ms: number;
  readonly steps: readonly ValidationStepResult[];
  readonly cleanup: "success" | "failed";
  readonly reason?: string;
}

export class ControlledPatchValidationService {
  constructor(
    registry: RegisteredWorkspaceRegistry,
    controlledPatches: ControlledPatchService,
    profiles: ValidationProfileStore,
    runner: ValidationProcessRunner,
    nowMs?: () => number,
    makeTempParent?: () => Promise<string>
  );
  configure(workspaceId: string, profile: ValidationProfile): Promise<ValidationProfile>;
  validate(patchTaskId: string): Promise<ControlledPatchValidationReport>;
}
```

Constructor dependencies must stay narrow: `RegisteredWorkspaceRegistry`, `ControlledPatchService`, `ValidationProfileStore`, `ValidationProcessRunner`, plus test seams for current time/temp directory creation if needed. Do not create a service hierarchy.

Bridge-owned implementation constants:

```ts
const CLEANUP_TIMEOUT_MS = 5_000;
const DEFAULT_STEP_TIMEOUT_SECONDS = 600;
const DEFAULT_TOTAL_TIMEOUT_SECONDS = 1_200;
```

`configure()`:
1. verifies `workspaceId` exists through `RegisteredWorkspaceRegistry.resolve`;
2. stores the already-resolved profile through `ValidationProfileStore.configure`;
3. executes nothing and inspects no repository file.

`validate()` flow:
1. resolve retained proposal via `ControlledPatchService.validationProposal`;
2. lazily get the workspace profile; if missing, return `INCOMPLETE` with `reason: "validation_profile_missing"` and `cleanup: "success"` (nothing was created), and do not create temporary state;
3. if `baseHead === null`, return `INCOMPLETE` with exact `reason: "unsupported_unborn_base"` and `cleanup: "success"` before preflight/worktree/commands;
4. call `preflightValidationProposal`; on preflight failure return `INCOMPLETE` with `reason: "preflight_failed"`;
5. create a temporary parent with `mkdtemp(join(tmpdir(), "engineering-bridge-validation-"))`; use a non-existing child path such as `<temp>/worktree`;
6. create exactly one detached worktree with literal argv equivalent to:

```text
git -C <registered-workspace-root> worktree add --detach <temp-worktree> <base-head>
```

7. apply the candidate only inside that worktree using literal argv `git apply --recount --unidiff-zero` and the patch on stdin;
8. run `preparation` then `validation` steps sequentially in the temp worktree;
9. worktree creation and candidate-patch apply also consume the remaining 1200-second total budget; if the main budget is exhausted, stop as `INCOMPLETE` rather than starting more work;
10. for each configured step, pass `min(step timeout, remaining total budget)` to the process runner;
11. first definite configured-command nonzero exit records a step `FAIL`, stops later steps, and makes overall `FAIL` unless cleanup/infrastructure later makes the run incomplete;
12. timeout/spawn/signal/setup/apply errors make overall `INCOMPLETE` and stop later steps;
13. always attempt cleanup once temporary state may exist:

```text
git -C <registered-workspace-root> worktree remove --force <temp-worktree>
```

then best-effort remove the temporary parent directory;
14. cleanup failure changes overall status to `INCOMPLETE` while preserving earlier step evidence;
15. return one structured report; never mutate the retained proposal/task or registered workspace.

- [ ] **Step 1: Write RED classification and early-exit tests with fakes**

Using fake `ControlledPatchService`, profile store, and process runner, cover:
- missing profile => `INCOMPLETE/validation_profile_missing`, zero process calls;
- unborn => `INCOMPLETE/unsupported_unborn_base`, zero preflight/worktree/command calls;
- preflight failure => `INCOMPLETE/preflight_failed`, zero worktree/command calls;
- preparation nonzero => `FAIL`, later steps not started;
- validation nonzero => `FAIL`, later steps not started;
- configured step timeout => `INCOMPLETE`, later steps not started;
- spawn/signal => `INCOMPLETE`;
- cleanup failure overrides otherwise PASS or FAIL to `INCOMPLETE`;
- successful preparation + validation + cleanup => `PASS`;
- per-step timeout is capped by remaining total budget.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/controlled-patch-validation-service.test.js
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement the minimal coordinator until fake-based tests pass**

Implement only the flow above. Do not add retries, parallelism, validation state, background jobs, caching, or artifact retention.

- [ ] **Step 4: Add real temporary-Git isolation tests**

In the same test file, use temporary repositories to prove:
1. a clean commit-based registered workspace and retained patch can create a detached temp worktree;
2. candidate changes appear in the temp worktree only;
3. a validation command may create build artifacts in the temp worktree and none appear in the registered workspace;
4. PASS cleanup removes the worktree;
5. FAIL cleanup removes the worktree;
6. timeout/incomplete cleanup removes the worktree when possible;
7. proposal content/state and registered workspace `git status --short` remain unchanged.

Use only harmless Node/Git commands in test profiles, for example:

```ts
["node", "-e", "require('node:fs').writeFileSync('validation-artifact.txt','ok')"]
```

and assertions against the temporary test repository. Do not use real package installation or network access.

- [ ] **Step 5: Run coordinator tests, controlled-patch tests, and typecheck**

Run:

```bash
npm run build
node --test dist/tests/unit/tasks/controlled-patch-validation-service.test.js
node --test dist/tests/unit/tasks/controlled-patch-service.test.js
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Fresh independent Auditor review**

Use a fresh Codex/Auditor context for this security-sensitive task. Ask it to attack:
- registered-workspace mutation;
- shell injection;
- proposal/base drift;
- unborn handling order;
- timeout budget escapes;
- cleanup misclassification;
- lifecycle/APPLY mutation;
- leaked temp worktrees/artifacts.

Supervisor/Chat reviews both Worker evidence and Auditor findings. Any defect returns to the Worker for correction before commit.

- [ ] **Step 7: Commit gate**

Proposed commit message:

```text
feat: validate controlled patches in isolation
```

STOP and request exact `COMMIT`.

---

### Task 5: Wire the two MCP tools without touching existing hot paths

**Files:**
- Modify: `src/mcp-stdio.ts`
- Modify: `tests/unit/mcp-stdio.test.ts`

**Interfaces:**

Add Zod schemas equivalent to:

```ts
const ValidationStepSchema = z.object({
  name: z.string().min(1),
  argv: z.array(z.string()).min(1),
  timeout_seconds: z.number().int().positive().optional()
}).strict();

const ValidationProfileSchema = z.object({
  preparation: z.array(ValidationStepSchema),
  validation: z.array(ValidationStepSchema),
  default_step_timeout_seconds: z.number().int().positive().optional().default(600),
  total_timeout_seconds: z.number().int().positive().optional().default(1200)
}).strict();
```

Register:

```text
configure_validation_profile(workspace_id, profile, confirmation="CONFIGURE")
validate_controlled_patch(patch_task_id)
```

Runtime wiring:
- create `ValidationProfileStore` at `${configPath}.validation-profiles.json`;
- do **not** call `get`, `configure`, or an eager `load` at startup;
- create one `ValidationProcessRunner`;
- create one `ControlledPatchValidationService` from existing registry + controlled-patch service + store + runner;
- no existing MCP handler calls the validation service/store.

`configure_validation_profile` converts snake_case input to the internal resolved `ValidationProfile` and calls `validation.configure(...)`. The exact confirmation is enforced by `z.literal("CONFIGURE")`.

`validate_controlled_patch` accepts only `{ patch_task_id }`, calls `validation.validate(...)`, and returns the structured report through the existing `jsonContent` pattern.

- [ ] **Step 1: Add RED tool-contract tests**

Extend `mcp-stdio.test.ts` to assert:
1. tool listing includes the two new tools with exact names;
2. `configure_validation_profile` accepts exact `CONFIGURE`;
3. `AUTHORIZE`, lowercase `configure`, and omitted confirmation are rejected by the MCP schema and do not write a profile;
4. empty argv is rejected;
5. validation tool schema exposes only `patch_task_id`;
6. configuration defaults resolve to 600/1200 before persistence;
7. a missing profile produces `INCOMPLETE/validation_profile_missing` for a valid retained proposal;
8. `validate_controlled_patch` cannot carry ad-hoc command or timeout fields because the schema is strict.

- [ ] **Step 2: Add the startup/hot-path non-regression test**

Create an intentionally malformed `${configPath}.validation-profiles.json`, then start the MCP server and exercise an existing non-validation tool path that does not require validation (for example tool listing plus the existing safe workspace/task smoke already used by this test suite).

Expected: startup and the existing tool path still work because validation profile state is lazy. Only invoking configuration/validation should attempt to load that sidecar and surface its safe error.

This test is the explicit regression guard that the new feature does not add validation profile I/O or validation work to ordinary Bridge startup/use.

- [ ] **Step 3: Run MCP tests and verify RED**

Run:

```bash
npm run build
node --test dist/tests/unit/mcp-stdio.test.js
```

Expected: FAIL because the tools/wiring do not exist.

- [ ] **Step 4: Implement the minimal MCP wiring**

Add imports, schemas, four small object-conversion helpers only if necessary, service construction, and the two `registerTool` calls. Do not refactor unrelated MCP registration code.

- [ ] **Step 5: Run MCP tests and full task/workspace regression**

Run:

```bash
npm run build
node --test dist/tests/unit/mcp-stdio.test.js
node --test dist/tests/unit/tasks/*.test.js
node --test dist/tests/unit/workspaces/*.test.js
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Supervisor review checkpoint**

Specifically inspect that existing handlers do not reference validation components and that startup does not eagerly read the validation sidecar.

- [ ] **Step 7: Commit gate**

Proposed commit message:

```text
feat: expose controlled patch validation tools
```

STOP and request exact `COMMIT`.

---

### Task 6: Document the trusted execution boundary

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `SECURITY.md`

**Interfaces:**
- Documentation only; no runtime behavior.

Required documentation:
- list `configure_validation_profile` and `validate_controlled_patch`;
- show that configuration is one fixed trusted profile per workspace and requires exact `CONFIGURE`;
- show a minimal argv example, not a shell-string example;
- state that validation is opt-in/on-demand and not automatically tied to APPLY;
- explain `PASS`, `FAIL`, `INCOMPLETE`, including `unsupported_unborn_base`;
- state 600-second default step / 1200-second total budget;
- state that temporary worktree isolation protects workspace cleanliness but **does not sandbox host access**;
- state that only trusted workspace commands should be configured;
- state that ordinary Bridge paths remain unchanged and validation adds no background worker/queue.

- [ ] **Step 1: Write documentation changes only**

Keep both README variants semantically aligned. Add the host-security warning to `SECURITY.md` next to the existing local execution / trust-boundary guidance rather than creating a new security framework.

- [ ] **Step 2: Validate documentation diff**

Run:

```bash
git diff --check
git diff -- README.md README.zh-CN.md SECURITY.md
```

Expected: no whitespace errors; docs match implemented tool names and schemas exactly.

- [ ] **Step 3: Supervisor docs review**

Cross-check every command/tool/result field against implementation; remove any claim of host sandboxing, automatic APPLY, dynamic test selection, or background notification.

- [ ] **Step 4: Commit gate**

Proposed commit message:

```text
docs: document controlled patch validation
```

STOP and request exact `COMMIT`.

---

### Task 7: Final verification and acceptance

**Files:**
- No new production files.
- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Run static/build verification**

Run:

```bash
npm run typecheck
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Run the full unit suite**

Run:

```bash
npm test
```

Expected: all tests PASS. Record the exact pass/fail count from this run; do not reuse an earlier count.

- [ ] **Step 3: Run focused security regressions once more**

Run:

```bash
node --test dist/tests/unit/tasks/validation-profile-store.test.js
node --test dist/tests/unit/tasks/validation-process-runner.test.js
node --test dist/tests/unit/tasks/controlled-patch-validation-service.test.js
node --test dist/tests/unit/tasks/controlled-patch-service.test.js
node --test dist/tests/unit/mcp-stdio.test.js
```

Expected: PASS.

- [ ] **Step 4: Verify scope and repository cleanliness**

Inspect:

```bash
git status --short
git diff --stat HEAD
git diff -- src/tasks src/mcp-stdio.ts tests/unit README.md README.zh-CN.md SECURITY.md
```

Verify:
- no unrelated refactor;
- no new task/proposal states;
- no APPLY behavior change;
- no generic shell/workspace command tool;
- no background worker/queue/session manager;
- no runtime dependency added;
- registered workspace remains clean after validation tests.

- [ ] **Step 5: Fresh final Auditor review**

Use a fresh independent Codex/Auditor context over the complete implementation diff and approved spec. Require explicit findings for:
- spec coverage;
- command-injection boundary;
- workspace isolation;
- base/preflight reuse;
- timeout/output bounds;
- cleanup correctness;
- cold-path non-regression;
- lifecycle/gate separation;
- test adequacy.

Fix any real finding through the Worker + RED/GREEN loop, rerun affected focused tests, then rerun the full suite.

- [ ] **Step 6: Final Supervisor acceptance**

Supervisor/Chat verifies the fresh full-suite evidence and Auditor findings. Do not state the feature is complete without both.

- [ ] **Step 7: Final commit/push gates**

If any final corrective diff remains, STOP and request exact `COMMIT` before committing it.

After the local implementation is fully committed and clean, STOP and request exact `PUSH`. `PUSH` remains a separate gate and must never be implied by `COMMIT`.
