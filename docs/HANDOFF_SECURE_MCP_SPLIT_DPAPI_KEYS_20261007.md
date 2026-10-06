# Secure MCP split DPAPI Runtime API keys — source-only candidate

Updated 2026-10-07. Worktree: `D:\WORKTREE_ZONE\engineering-bridge-8e25e3a0`.
Branch: `feature/secure-mcp-split-dpapi-keys-20261007`.
Base checkpoint: `4c072dd4699dd8af09c83c1716276649a59dd574`.
Changes remain uncommitted/unpushed. The next commit containing this HANDOFF
will be the candidate C/P checkpoint; no SHA is assigned before that commit.
No deployed-file mutation, commit/push/IW, or real secret-store access occurred.
Current production/deployed DPAPI controllers remain the earlier shared-store
version from main 4c072dd. The shared store is still unseeded; this candidate
has NOT been deployed. No secret migration is required because the old shared
store was never seeded. It must not be used or seeded. Older shared-store
HANDOFF is explicitly obsolete historical text.

## Completed design

Two distinct keys and two distinct stores:

- DevSpace: `D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-devspace-runtime-api-key.dpapi`
- Bridge: `D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-bridge-runtime-api-key.dpapi`

Generic `SecureMcpRuntimeKey.ps1` requires purpose for canonical path selection,
and explicit SecretPath for save/load/check/resolve. The reserved secure-mcp filename namespace admits only the two canonical
filenames; the retired ambiguous filename is rejected. Controllers pin their own purpose and never save/prompt.
Normal Start resolves deliberately supplied process `CONTROL_PLANE_API_KEY`,
then its own DPAPI store, then bounded one-time setup instructions. Empty
explicit env fails closed. Running-tunnel adoption remains unchanged.

Plural `SET_Secure_MCP_Runtime_API_Keys.bat` runs setter `-Purpose All -IfMissing`.
It securely prompts for DevSpace Runtime API Key, then Bridge Runtime API Key,
independently. Default setup preserves valid stores and prompts only for missing
purposes. Existing unreadable stores fail closed. `-Purpose DevSpace|Bridge|All`
supports independent setup/check; `-Force` explicitly rotates/repairs the selected
purpose(s). `-Check` is availability-only. Setter never reuses one process env
key for both stores. The singular BAT now only invokes the plural setup.
`SetupSecureMcpBridge.ps1` metadata records the Bridge-specific store.

DPAPI CurrentUser, same-directory atomic ciphertext write and best-effort ACL
remain. Plaintext is transient only in current process env/memory; buffers/BSTR
are cleared. Never write keys to BAT/Git/YAML/log/manifest/command line. Profiles
remain `env:CONTROL_PLANE_API_KEY`. No secret extraction from process memory,
provider auth, logs or runtime manifests. Managed CLR strings cannot be
promised immediate zeroing. Secure prompts are setup-only; normal Start has no
Read-Host. Do not touch runtime `1.4.2-biaogu.16`, tunnel IDs, routing, GOAL,
Cloudflare Blue or Recovery Blue-only boundary.

## Validation and repo state

Final pre-C/P source validation (supervisor independently reran the checks):

- Initial build could not find tsc because this clean worktree lacked local
  dependencies. `npm ci --ignore-scripts --no-audit --no-fund` installed locked
  dependencies locally; package and lockfile unchanged.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `node --test dist/tests/unit/secure-mcp-runtime-key.test.js dist/tests/unit/recovery-handoff.test.js`:
  PASS, 6/6, 0 failures, 0 skipped; includes real Windows DPAPI functional run.
- `git diff --check`: PASS.
- Supervisor full `npm test`: 423 total / 418 PASS / 0 FAIL / 5 SKIP;
  duration approximately 88.9 seconds.
- Supervisor confirmed active source references only the two split paths:
  DevSpace `secure-mcp-devspace-runtime-api-key.dpapi` and Bridge
  `secure-mcp-bridge-runtime-api-key.dpapi`. No active code uses the ambiguous
  old `secure-mcp-runtime-api-key.dpapi` path. Reserved secure-mcp names outside
  the two canonical filenames are rejected, including the retired shared filename.
- Functional checks prove both missing-purpose orientations preserve the valid
  store, default setup skips both valid stores, explicit DevSpace rotation
  preserves Bridge, and corruption fails closed. Temporary files cleaned.

Focused coverage:
controller purpose pins, no active ambiguous-path reference, two-purpose secure
setup and preservation, DPAPI two-temp-file roundtrip/cross-store separation,
atomic overwrite, env precedence, corruption rejection, bounded output,
PowerShell parsing, env-only profiles and split-key documentation. Functional
tests generate two different dummy secrets in memory and never print values;
only repository-contained temporary ciphertext stores are used and cleaned.
Build-generated dist and local dependencies are ignored, never deployed.

Live cold lifecycle/production acceptance is UNVERIFIED. Source tests do not
prove actual provider key validity. No real controller start/stop is executed.

## Next Human Gate and deployment plan after Owner I/W

Next Human Gate: Owner I/W for main integration, deployment of the split
controllers/helper/setter, two one-time secure seeds (DevSpace then Bridge,
each separately), and cold total stop/start/restart no-prompt validation.

1. Preflight canonical source hashes, branch/checkpoint, deployed controller
   locations and actual Windows launch identity without reading secret values.
   Preserve existing Green/Blue readiness and back up affected controls only.
2. Deploy split helper, controllers, setter PS1, plural BAT and singular
   compatibility BAT; synchronize Bridge setup metadata. Central helper/setter
   location is `D:\Engineering_Bridge_System\control`; DevSpace controller is at
   its actual active secure-control location. Do not recreate profiles/tunnels.
3. Verify the obsolete shared store is absent/unseeded. If unexpected content
   exists, stop for separate authority; do not decrypt, migrate, seed or use it.
4. As the actual controller Windows user, seed DevSpace and Bridge once each
   via plural setup with two distinct Owner-provided Runtime API keys. Preserve
   valid stores. Missing keys require the authorized Owner/provider replacement
   path; never extract keys from process memory. Run `-Purpose All -Check`.
5. Validate cold total stop/start/restart with no prompts and both DevSpace and
   Bridge Green/Blue health, connector E2E, env-only profiles and credential-free
   logs. Verify Green failure/rollback leaves Blue healthy and unattended
   Recovery remains Blue-only. Collect bounded sanitized evidence only.
6. Record actual deployment/live acceptance separately. Preserve Blue and use
   backed-up controls for authorized rollback if needed. No runtime version,
   tunnel IDs, routing, GOAL or Cloudflare changes belong to this rollout.

## Fresh-session resume

A fresh account-bound Codex native session can resume from this durable HANDOFF
and repo state without the previous native thread. Check branch/base, status and
uncommitted diff, then review named helper/controller/setter/tests/docs changes.
Next task: supervisor candidate C/P containing this updated HANDOFF; record
its actual checkpoint reference only after commit creation. Then obtain Owner
I/W at the Human Gate above before main integration, deployment, secure seeds
and live validation. This internal child does not commit/push and returns
evidence immediately without Telegram;
the outer supervisor owns notification. No current production acceptance is
claimed, and no secret values are part of the evidence.
