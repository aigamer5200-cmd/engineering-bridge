# Engineering Bridge MCP ToolAnnotations handoff — 2026-09-28

## Goal

Add truthful standard MCP ToolAnnotations to the existing four-tool thin Bridge
surface so MCP hosts can classify each tool without inferring behavior from its
name or description. Keep Bridge as a pure transport to the official Codex CLI
app-server; do not add a policy bypass or new governance layer.

## Worktree checkpoint

- source repo: `D:\Engineering_Bridge_System\engineering-bridge`
- isolated WT: `D:\WORKTREE_ZONE\engineering-bridge-58d97892`
- base HEAD: `6d3df5735c36abf13137b97e68f7e7e55a5863cf`
- target version: `1.4.2-biaogu.14`

## I/W completion

- Owner-authorized I/W completed on 2026-09-28.
- Integration mode: fast-forward only; no merge commit and no force push.
- `main` / `origin/main` integrated implementation checkpoint:
  `b52bbe0e5b52063d2b2b11e7409d71ae54752e59`.
- Governed painless upgrade promoted immutable runtime
  `D:\Engineering_Bridge_System\BridgeVersions\1.4.2-biaogu.14` from that exact
  checkpoint.
- Candidate preparation: `npm ci`, typecheck, full `npm test`, and build PASS.
- Canary: PASS; four-tool pure-Codex transport surface; real Codex task PASS;
  sandbox unchanged.
- Production switch: PASS; version `1.4.2-biaogu.14`, production PID `47512` at
  switch verification, local/public MCP no-auth `401`, local/public OAuth
  metadata `200`.
- Recorded rollback target: `1.4.2-biaogu.13`.
- Production runtime remains `pure_codex_transport_v1`; no routing, auth,
  account, model, reasoning, or governance layer was added.

## Implemented

- `bind_project`: `readOnlyHint=false`, `destructiveHint=false`,
  `idempotentHint=true`, `openWorldHint=false`.
- `run_task`: `readOnlyHint=false`, `destructiveHint=true`,
  `idempotentHint=false`, `openWorldHint=true`.
- `task_result`: `readOnlyHint=true`, `openWorldHint=false`.
- `control_task`: `readOnlyHint=false`, `destructiveHint=true`,
  `idempotentHint=true`, `openWorldHint=false`.
- Added human-readable annotation titles and more explicit descriptions.
- Added MCP list-tools assertions that verify annotations are actually exposed
  over the protocol.
- Updated package/release/readme version and documentation.

`run_task.openWorldHint=true` is intentionally conservative and truthful: Bridge
does not impose its own network/search policy, and the official Codex CLI plus
its local permissions may interact with external resources. The metadata must
not be falsified merely to reduce host safety checks.

## Acceptance

Completed in the isolated worktree:

- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- focused `node --test dist/tests/unit/mcp-stdio.test.js`: 2/2 PASS.
- full `npm test`: 367 total, 362 passed, 0 failed, 5 skipped.
- MCP `listTools` regression proves the public surface remains exactly four
  tools and the emitted annotations match this document.
- `git diff --check`: PASS.

## Pending / next step

Refresh/reconnect the Engineering Bridge MCP in ChatGPT so the host performs a
fresh `tools/list` discovery and receives the new annotations. Then perform an
A/B observation in ChatGPT: compare DS-only operations with Bridge
`task_result` and one bounded Bridge `run_task`. The presence or absence of
ChatGPT's additional safety-check banner is host-side behavior and cannot be
proven by unit tests or by the Bridge production smoke alone.

## Do not touch

- no Codex auth/account/profile changes;
- no model or reasoning routing changes;
- no new Bridge governance/policy layer;
- no attempt to suppress, evade, or mislabel host safety checks.

This handoff is sufficient for another clean session to continue from repository
state without relying on the current chat or Codex native thread.
