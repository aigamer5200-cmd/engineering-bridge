# Sign in with ChatGPT plan usage — isolated candidate

Status: **candidate / preview only**. The production/LKG Engineering Bridge path
is unchanged. This candidate is not the default MCP launch path and has no
automatic fallback to native Codex authentication.

## Boundary

    Web GPT / DS
        |
        | MCP stdio
        v
    Engineering Bridge
        |
        | initialize -> thread/start -> turn/start
        v
    codex app-server
        |
        | openai_chatgpt_plan + ACCESS_TOKEN
        v
    Responses API / ChatGPT plan usage

OAuth, account selection, credential storage, and token refresh are outside
Bridge Core in ops/siwc. The public MCP surface remains exactly bind_project,
run_task, task_result, and control_task.

The candidate never falls back to API-key or native Codex auth. If SIWC is
unavailable, expired beyond refresh, revoked, or not granted
chatgpt.tokens.use.direct, candidate startup fails visibly.

## Official contract implemented

The candidate follows the OpenAI Sign in with ChatGPT open-source/local flow:

- first registration uses client_id=dynamic_agent_client;
- one stable repo-external ext_agent_host_id is reused on the host;
- browser authorization uses a 127.0.0.1 loopback callback, state, OIDC nonce,
  and S256 PKCE;
- requested scopes are openid profile email offline_access resource.invoke
  chatgpt.tokens.use.direct;
- the token resource is https://api.openai.com/v1;
- the returned ID token is signature-checked against OpenAI JWKS and its
  issuer, audience, expiry, nonce, and subject are validated;
- each explicit profile label has a separate issued client ID and rotating
  access/refresh-token record;
- returning sign-in reuses the issued client ID plus retained ID-token/email
  hints, while still validating the newly returned identity before replacement;
- access tokens are refreshed near expiry and refresh-token rotation is
  serialized per profile so parallel candidate processes do not race the same
  renewable session;
- app-server receives the short-lived token only through ACCESS_TOKEN;
- app-server uses an isolated CODEX_HOME whose non-secret provider config is
  openai_chatgpt_plan, Responses API, and supports_websockets=false;
- the candidate CODEX_HOME explicitly excludes ACCESS_TOKEN from shell-tool
  subprocess environments even though app-server itself receives the token;
- the app-server client identity is engineering-bridge / Engineering Bridge /
  the package version.

OpenAI currently documents this route as preview behavior. Do not promote it
to current until live E2E and soak validation are complete.

## Credential location

Nothing under the repository is used for credentials.

Default storage:

- Windows: %LOCALAPPDATA%\EngineeringBridge\siwc
- Linux/macOS: $XDG_CONFIG_HOME/engineering-bridge/siwc, falling back to
  ~/.config/engineering-bridge/siwc

Override only when intentionally testing:

    ENGINEERING_BRIDGE_SIWC_HOME=<repo-external-directory>

Credential writes are atomic. Unix files are chmod 0600; Windows files have
inheritance removed and an ACL granted only to the current user. Token values
must never be copied into repo files, logs, screenshots, handoffs, or support
transcripts.

## Explicit A/B profiles

Profiles are selected explicitly. There is no AUTO, quota-driven switching, or
fallback:

    npm run siwc:login -- --profile A
    npm run siwc:login -- --profile B

The first command opens the system browser and requires human OAuth consent.
Later sign-ins reuse that profile's issued client ID. A returning sign-in that
resolves to a different verified subject is rejected.

Non-secret status:

    npm run siwc:status -- --profile A

Force a refresh:

    npm run siwc:refresh -- --profile A

These commands never print access, refresh, or ID tokens.

## Candidate MCP launch

Build first:

    npm run build

Use a **candidate-specific, repo-external** workspace config so its managed
workspace sidecar cannot touch production state. Then configure the
experimental MCP entry with:

    command: node
    args:
      D:\WORKTREE_ZONE\engineering-bridge-siwc-appserver-candidate\ops\siwc\start-bridge-siwc.mjs
      --profile
      A
      --config
      <absolute path to candidate workspaces.json>

Equivalent manual launch:

    npm run siwc:bridge -- --profile A --config <absolute-candidate-workspaces.json>

The launcher:

1. requires the explicit profile;
2. refreshes it if needed;
3. writes provider-only config to that profile's isolated CODEX_HOME;
4. removes inherited OPENAI_API_KEY and CODEX_API_KEY;
5. sets ACCESS_TOKEN only in the candidate process environment;
6. starts the existing dist/src/mcp-stdio.js;
7. does **not** fall back if any SIWC step fails.

Because Bridge stdio is the MCP protocol channel, the launcher writes no normal
status text to stdout.

## Validation gates before promotion

1. Unit/regression: npm run typecheck and npm test.
2. OAuth: browser consent completes and siwc:status reports the selected
   profile without secrets.
3. First inference: one read-only run_task succeeds through the
   openai_chatgpt_plan provider. For this first proof, omit optional
   service_tier overrides; the current SIWC preview may reject unsupported
   service-tier overrides rather than silently changing them.
4. Engineering E2E: repo read, file edit, shell/test, Git diff, large output,
   interrupt, and task failure are exercised in the candidate WT.
5. Recovery: access-token refresh, process restart, revoked/invalid credential,
   usage-limit, unsupported capability, and transient network paths are
   observed without native/API-key fallback.
6. A/B isolation: A and B each require their own explicit profile and a new
   native app-server thread; no cross-account thread reuse.
7. Soak: repeated bounded phases complete without leaked app-server processes,
   corrupted MCP stdout, or production workspace/catalog mutation.

Promotion remains a separate Owner Human Gate. The current production/LKG
build must remain immediately available for rollback.

