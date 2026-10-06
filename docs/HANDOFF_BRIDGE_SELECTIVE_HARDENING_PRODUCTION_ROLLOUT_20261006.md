# Bridge selective hardening production rollout

## Release candidate

- Branch: `main`.
- Functional integration base: `82b594da3f8dbdc02c7bbd326f174c21f94bea3b`.
- New immutable runtime version: `1.4.2-biaogu.16`.
- Existing production before rollout: `1.4.2-biaogu.15`.
- Existing production root: `D:\\Engineering_Bridge_System\\BridgeVersions\\1.4.2-biaogu.15`.
- Rollback target must remain the untouched `.15` runtime.

## Scope

This rollout contains the already Owner-accepted selective upstream hardening only: Codex protocol hardening, Windows workspace/path hardening, and routing-policy gap coverage. It does not merge upstream v1.5.0 wholesale. The active MCP surface remains four tools. The fork 16 MiB JSONL frame bound remains. Controlled-patch/APPLY/COMMIT/validation/async-validation surfaces remain absent from active MCP composition.

Secure MCP Green / Cloudflare Blue ingress topology must not be reconfigured by this rollout. Shared workspace/OAuth/tunnel state remains external to the immutable Bridge version.

## Pre-production verification

- Main integration regression before version bump: 413 total / 408 PASS / 0 FAIL / 5 SKIP.
- Version-only release preparation bumped package/package-lock/readme/release metadata to `1.4.2-biaogu.16`.
- Post-version-bump build: PASS.
- Post-version-bump focused active-path suite: 52/52 PASS.
- No functional source change was made during the version bump.

## Rollout sequence

Use the existing painless manager only:

1. prepare exact immutable `1.4.2-biaogu.16` from the release-prep commit;
2. run loopback canary on 8769 and require PASS;
3. switch production 8768 with exact IW confirmation;
4. run manager verify plus live schema/health acceptance;
5. preserve `1.4.2-biaogu.15` as rollback target.

## Pending

The commit containing this HANDOFF is the release-preparation checkpoint. After it is pushed, production prepare/canary/switch/verify may proceed under the Owner's current "OK continue" production-rollout authorization. No additional feature work is authorized.

A fresh account/session can resume from this HANDOFF and repo state without any prior Codex thread.

## Production activation result

- Release-preparation checkpoint: `10d7cfd873665d564124658b5d77e5783ece6139`.
- Immutable prepare: PASS; runtime `1.4.2-biaogu.16`, commit `10d7cfd873665d564124658b5d77e5783ece6139`, contract `thin_codex_v1`; `npm ci`, typecheck, npm test and build all PASS.
- Live canary on 8769: PASS; exact four tools (`bind_project`, `control_task`, `run_task`, `task_result`), real Codex task PASS, explicit routing passthrough PASS, sandbox unchanged.
- Guarded switch: PASS after using the manager-required exact confirmation `SWITCH`; the initial `IW` confirmation attempt was rejected before any production mutation.
- Production manager verify: PASS; local/public MCP unauthenticated status 401 and OAuth metadata 200.
- Production PID at verification: `38976`.
- Current production: `1.4.2-biaogu.16` at `D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.16`.
- Recorded previous / rollback target: `1.4.2-biaogu.15`; its immutable runtime was not overwritten.
- Live production acceptance through the connected Secure MCP Bridge: `run_task` on `bridge-sandbox` completed with exact `gpt-5.6-luna` / `max` / `priority` provenance and marker `BRIDGE_PRODUCTION_THIN_OK`; sandbox Git status remained clean before and after.
- Secure MCP Green / Cloudflare Blue topology was not reconfigured. No upstream wholesale merge, controlled-patch restoration, validation surface, or async validation was introduced.

## Final state

Selective upstream hardening is now active in production as Engineering Bridge `1.4.2-biaogu.16`. Source main, immutable runtime, canary evidence, production pointer, rollback pointer and live Secure MCP acceptance are aligned. A fresh account/session can continue from this HANDOFF without relying on the previous Codex thread.
