# HANDOFF — Codex Profile / Reasoning Routing

Date: 2026-09-05

## Branch / checkpoint

- Repo: `D:\Engineering_Bridge_System\engineering-bridge`
- Feature branch: `goal/codex-profile-reasoning-20260905`
- Feature checkpoint integrated to main: `91afcdf97150616bfaf8fbec8c47f0352a722282`.
- I/W method: `ff-only`; pushed to `origin/main` on 2026-09-05.

## Completed

- Added Codex-only `reasoning` routing to `run_task`.
- Native protocol mapping is exact: `reasoning -> turn/start.effort`.
- Existing exact model routing remains `thread/start.model` with provider model
  fallback disabled.
- Task result and durable execution receipt report non-secret `model`,
  `reasoning`, and `account` provenance.
- DSH plus `reasoning` fails closed.
- Existing optional A/B account router remains the only account-routing system.

## Verification

- Post-I/W full Bridge regression: 262 PASS / 0 FAIL / 1 POSIX-only SKIP.
- Real B turns succeeded for Astra/medium, Sol/xhigh, Sol/medium, Luna/max.
- A account-scoped validation is healthy, but current A real turns are blocked
  by exhausted long-window usage quota. Do not bypass by routing to B or lowering
  model/reasoning.

## Secret boundary

Receipts may contain only routing provenance. Credentials, `auth.json`, access/
refresh tokens, OAuth/API secrets, cookies, email/account identity data are not
receipt fields and must not enter this repo.

## Pending / do-not-touch

- Re-run A Astra/medium and A Sol/xhigh real-turn E2E after quota reset.
- Do not change account auth or consume/reset quota merely to close this test.
- Future rollback or further main mutation still requires the normal Owner / GOAL authority boundary.

## WT state / continuation

- Original WT: `D:\WORKTREE_ZONE\engineering-bridge-363099fc`
- Physical main now contains the verified feature checkpoint via ff-only I/W.
- Local main and `origin/main` were verified equal after push.
- Another Codex account/session can continue from this HANDOFF + repository
  state without the previous native Codex thread.

## Next step

No immediate Bridge implementation remains. Re-run A Astra/medium and A
Sol/xhigh real-turn E2E after the A long-window quota resets.
