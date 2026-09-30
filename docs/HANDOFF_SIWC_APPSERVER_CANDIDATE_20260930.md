# HANDOFF — SIWC app-server candidate — 2026-09-30

## Frozen goal

Add an isolated candidate path that lets the existing thin Engineering Bridge
drive official Codex app-server with Sign in with ChatGPT plan usage, while
keeping production/LKG untouched and preserving the four-tool MCP surface.

Bridge remains a transport only:

```text
Web GPT / DS -> MCP -> Engineering Bridge -> Codex app-server -> Responses API
```

OAuth/account/token lifecycle stays outside Bridge Core.

## Repository state

- authoritative repo: `D:\Engineering_Bridge_System\engineering-bridge`
- production/main base HEAD: `0c998c3a3835f51d2f43dc3b03694536737428a3`
- production/main status at this checkpoint: clean and untouched
- candidate WT: `D:\WORKTREE_ZONE\engineering-bridge-siwc-appserver-candidate`
- candidate branch: `feature/siwc-appserver-candidate`
- this phase checkpoint commit: see Git history immediately after this HANDOFF
  is committed

The candidate can be continued from repo state and this HANDOFF without any
previous native Codex thread/session.

## Completed

- Added `ops/siwc/siwc-runtime.mjs` with:
  - first-time dynamic registration via `client_id=dynamic_agent_client`;
  - stable repo-external `ext_agent_host_id`;
  - loopback `127.0.0.1` OAuth callback;
  - fresh state, nonce, and S256 PKCE per sign-in;
  - required ChatGPT-plan scopes and Responses resource;
  - issued client-ID persistence per explicit profile label;
  - returning sign-in with retained `id_token_hint` / `login_hint`;
  - ID-token signature validation against OpenAI JWKS plus issuer, audience,
    expiry, nonce, and subject checks;
  - protected repo-external credential storage;
  - near-expiry OAuth refresh with rotating refresh tokens;
  - cross-process per-profile refresh serialization to avoid refresh-token races;
  - dedicated repo-external candidate `CODEX_HOME` generation;
  - `openai_chatgpt_plan` Responses provider config;
  - candidate environment isolation with `OPENAI_API_KEY` / `CODEX_API_KEY`
    removed and short-lived `ACCESS_TOKEN` supplied only to the candidate.
- Added explicit SIWC CLI/launcher commands under `ops/siwc/`.
- Added `ops/siwc/siwc-live-smoke.mjs` for bounded candidate-only live E2E
  without exposing token material.
- Added candidate docs in `docs/SIWC_CANDIDATE.md`.
- Kept the public MCP surface exactly four tools; `src/mcp-stdio.ts` is unchanged.
- Added `clientInfo.title="Engineering Bridge"` to app-server initialize while
  preserving stable `name="engineering-bridge"` and package version.
- Added SIWC unit tests without any live OAuth/login requirement.
- Confirmed installed Codex CLI `0.159.2` accepts both current `--stdio` and
  current official `--listen stdio://` transport forms.
- Used `codex doctor --json` with a dummy candidate token and isolated
  validation `CODEX_HOME` to confirm:
  - candidate `config.toml` parses;
  - active provider resolves to `openai_chatgpt_plan`;
  - provider auth resolves from `ACCESS_TOKEN`;
  - `requires_openai_auth=false` means no separate native Codex sign-in;
  - Responses endpoint/provider reachability is recognized;
  - WebSocket mode is disabled as intended.
- Removed the temporary validation runtime after the doctor check.
- Completed the first real browser `Continue with ChatGPT` login for explicit
  profile A. The callback succeeded, the required direct-plan scope was
  granted, and no credential payload was written to the repository.
- Completed live candidate E2E through the isolated launcher:
  - read-only inference returned `SIWC_OK`;
  - write + local shell readback created the expected fixture content and
    returned `SIWC_WRITE_OK`;
  - explicit interrupt stopped a 60-second shell task in about 3 seconds and
    surfaced the task as interrupted;
  - forced OAuth refresh rotated the renewable session successfully, and a new
    app-server process using the refreshed token completed another inference;
  - an unconnected SIWC profile failed closed before MCP startup, with no
    native/API-key fallback;
  - the existing production/LKG Bridge remained independently healthy and
    returned `LKG_OK` during the same validation phase.
- First write-capable live test exposed one expected isolation difference: the
  new candidate `CODEX_HOME` did not inherit the Owner's native non-interactive
  approval/sandbox settings. This was repaired outside Bridge Core by placing
  `approval_policy="never"` and the already Owner-approved
  `sandbox_mode="danger-full-access"` in the candidate-only Codex config while
  continuing to exclude `ACCESS_TOKEN` from shell subprocess environments.
- Increased the loopback OAuth callback lifetime from 5 to 20 minutes after
  the first browser attempt legitimately outlived the initial listener.

## Verification

Latest full offline regression after final repairs:

```text
npm run typecheck                         PASS
npm test                                 PASS
existing suite: 370 total / 365 pass / 5 skip / 0 fail
SIWC suite:       9 total /   9 pass / 0 skip / 0 fail
git diff --check                         PASS
```

Latest live checks after the offline regression prerequisites:

```text
SIWC browser OAuth profile A             PASS
ChatGPT-plan read-only inference         PASS
write + shell readback                   PASS
native turn interrupt                    PASS
OAuth refresh + post-refresh inference   PASS
invalid-profile fail-closed              PASS
production/LKG isolation smoke           PASS
```

The existing skipped tests are pre-existing platform-specific skips; none are
new SIWC failures.

## Official contract checked on 2026-09-30

Implementation was rechecked against the current OpenAI developer docs for:

- SIWC open-source registration/sign-in;
- accounts, sessions, and rotating token refresh;
- Codex app-server ChatGPT-plan provider configuration;
- preview limitations and error behavior.

Important current-preview constraint: an unsupported model, execution feature,
tool, or `service_tier` override can fail with
`subscription_sharing_unsupported_capability`. The first live SIWC proof should
therefore omit optional `service_tier` overrides rather than having Bridge
silently rewrite them.

## Pending / Human Gate

The first live OAuth and core execution E2E are complete. Remaining promotion
gates are intentionally deferred:

1. optional profile-B browser authorization and explicit A/B isolation proof;
2. longer soak across repeated bounded phases and ordinary development work;
3. large live output / quota-exhaustion observations if they occur naturally;
4. Owner decision to promote SIWC candidate to current after the soak window.

No promotion to current is authorized by this checkpoint. Production/LKG must
remain the rollback path until Owner acceptance after live E2E and soak.

## Do not touch

- Do not modify or reconnect production/current merely to test SIWC.
- Do not copy native Codex `auth.json`, browser cookies, API keys, OAuth tokens,
  email/account secrets, or other credential payloads into this repo.
- Do not add automatic fallback, quota-driven account switching, model policy,
  retry orchestration, or extra MCP tools to Bridge Core.
- Do not promote the candidate or perform I/W without the later Owner Human Gate.
