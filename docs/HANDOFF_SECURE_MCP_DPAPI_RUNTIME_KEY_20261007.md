# Secure MCP shared DPAPI Runtime API key — source candidate

Updated: 2026-10-07. Worktree:
`D:\WORKTREE_ZONE\engineering-bridge-c075b10b`.
Branch: `feature/secure-mcp-dpapi-runtime-key-20261007`.
Base checkpoint: `910c27c5c3d6b1048e71b9e5a54c3599cf011ad6`.
Candidate is uncommitted/unpushed; no new checkpoint commit exists. The next
commit containing this HANDOFF will be the candidate C/P; its SHA is pending
commit creation and must not be invented beforehand. Production
and deployed files, real tunnel profiles and the canonical secret store were
not read for secret extraction or modified. No I/W performed. Bridge runtime
`1.4.2-biaogu.16`, Codex routing and GOAL behavior remain unchanged.

## Objective and completed files

Remove recurring Runtime API key prompts from both Secure MCP Green controllers
using one Windows DPAPI CurrentUser encrypted local credential store.

- `ops/windows/recovery/SecureMcpRuntimeKey.ps1`: shared save/load/check/resolve,
  local path override for tests, atomic ciphertext save, best-effort ACL.
- `ops/windows/recovery/SetSecureMcpRuntimeKey.ps1` and
  `SET_Secure_MCP_Runtime_API_Key.bat`: one-time secure setup, env-backed setup,
  availability-only `-Check`, and no-overwrite `-IfMissing`.
- `ops/windows/recovery/SecureMcpBridge.ps1` and `SecureMcpDevSpace.ps1`:
  load central helper at tunnel launch; no Read-Host; retain env restoration.
  DevSpace now also validates the existing env-only profile requirement.
  Bridge doctor output is suppressed; exit-code verification remains.
- `ops/windows/recovery/SetupSecureMcpBridge.ps1`: truthful DPAPI persistence
  metadata and transient process env/memory usage; profile remains env-only.
- `ops/windows/recovery/README.md` and
  `HANDOFF_BRIDGE_SECURE_MCP_CURRENT_STATUS.md`: setup/resume policy and explicit
  candidate-versus-historical-production distinction.
- `tests/unit/secure-mcp-runtime-key.test.ts` and
  `secure-mcp-runtime-key.functional.ps1`: focused static and isolated Windows
  functional checks. This HANDOFF records the candidate evidence.

## Security model and boundaries

Canonical helper:
`D:\Engineering_Bridge_System\control\SecureMcpRuntimeKey.ps1`.
Shared store:
`D:\Engineering_Bridge_System\runtime\secrets\secure-mcp-runtime-api-key.dpapi`.
Both Green controllers use explicit process `CONTROL_PLANE_API_KEY` first,
otherwise decrypt this store, otherwise fail with bounded setup instructions.
Explicit empty env input fails closed. Normal Start never prompts or saves keys.
An already-running tunnel can still be adopted without loading a key.

Store bytes use Windows DPAPI CurrentUser, never LocalMachine, and stay local.
Parents are created; the secrets directory and ciphertext file receive
best-effort ACL access for current user, SYSTEM and Administrators only. ACL
hardening unavailability does not defeat valid DPAPI encryption. Same-directory
File.Move/File.Replace commits ciphertext atomically; temporary ciphertext is
removed on failure. PowerShell 5.1 requires `[NullString]::Value` for the absent
File.Replace backup name. Byte buffers and BSTR are explicitly cleared.

Plaintext is transient in process memory/env, passed to tunnel-client through
its inherited environment, never command arguments or persisted YAML/env files,
BAT, manifest, Git, docs or logs. The controller restores its earlier env in
finally. Managed strings cannot be guaranteed immediately zeroed by the CLR.
No key is included in helper diagnostics, test output or handoff evidence.
Profiles reference only `env:CONTROL_PLANE_API_KEY`. Live client logging remains
subject to credential-free validation after authorized deployment.

DPAPI setup and both controller launches must use the same Windows user. No
account portability or automatic Green recovery is added. Unattended recovery
remains Blue-only; Green/Blue topology, ports, owner checks and rollback remain.
Do not touch deployed controls, runtime, provider auth, production profiles,
GOAL/routing, or runtime versions under this source-only task. Do not commit,
push or perform I/W without separate authority. Historical older handoffs remain
historical and are not rewritten as new acceptance evidence.

## Validation

Initial build/typecheck could not run because this clean worktree lacked node
dependencies (`tsc` missing). `npm ci --ignore-scripts --no-audit --no-fund`
installed lockfile dependencies locally; no package/lockfile changes.

Final results:

- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `node --test dist/tests/unit/secure-mcp-runtime-key.test.js dist/tests/unit/recovery-handoff.test.js`:
  PASS, 5 tests, 0 failures, 0 skipped.
- Functional test runs real Windows DPAPI with randomly generated dummy values
  entirely inside the test process and an isolated path under this worktree:
  missing-store failure, encrypt/decrypt equality, ciphertext boundary, atomic
  overwrite, env precedence even with corrupt store, corrupt-store rejection,
  setter env-backed seeding/check, IfMissing preservation/rejection, and parsing
  all changed PowerShell scripts. Temporary credential directory is deleted and
  subprocess env restored. No real controller/start/stop is executed.
- `git diff --check`: PASS.

Final pre-C/P supervisor evidence (independently rerun):

- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- Focused tests: 5/5 PASS.
- `git diff --check`: PASS.
- Full `npm test`: 422 total / 417 PASS / 0 FAIL / 5 SKIP;
  duration approximately 87.2 seconds.
- Supervisor checked only the presence, never the value, of
  `CONTROL_PLANE_API_KEY` in its current process environment: `false`.

These are source-scope results; production and deployed files remain untouched.
No I/W or deployment has happened.

Full production total restart/connector E2E is UNVERIFIED and intentionally
pending Owner I/W. Focused tests do not claim production acceptance.

## Deployment plan after Owner I/W

1. Preflight branch/source hashes, actual control paths, Windows launch identity,
   current Green/Blue readiness and runtime `1.4.2-biaogu.16`. Back up affected
   deployed scripts using the existing deployment process, without copying any
   plaintext key. Do not change env-only profiles or topology.
2. Deploy helper, setter PS1 and setter BAT to central
   `D:\Engineering_Bridge_System\control`. Deploy updated Bridge controller
   there and updated DevSpace controller to its actual Secure MCP control
   location resolved from the active DevSpace BAT (source wrapper currently uses
   `D:\Engineering_Bridge_System\DevSpace\canary\secure-tunnel-beta\control`). Both must reference the same
   central helper/store. Deploy updated setup controller for future setup
   metadata; do not recreate existing Tunnel IDs/profiles just for this change.
3. Seed DPAPI store once only if missing, as the actual controller Windows user,
   via `SET_Secure_MCP_Runtime_API_Key.bat` (`-IfMissing`). This necessarily
   requires one final Owner-provided existing/replacement Runtime API Key:
   the supervisor's current process has no `CONTROL_PLANE_API_KEY`. A future
   deployment process may instead explicitly supply `CONTROL_PLANE_API_KEY`;
   setup then encrypts it without prompting. An
   existing unreadable store fails closed, requiring an explicit rotation
   decision. Never pass the key on a command line or dump environment contents.
4. Check availability with `SetSecureMcpRuntimeKey.ps1 -Check`. Validate both
   profiles still reference only env. Test total stop/start/restart without a
   recurring key prompt, Green readyz/connector E2E and Blue health. Confirm
   Green failure/rollback preserves Blue and unattended recovery stays Blue-only.
   Collect only sanitized statuses/results; never raw credential-bearing output.
5. Record post-deployment acceptance separately. If validation fails, preserve
   Blue and restore backed-up controls within approved rollout authority. Do not
   attempt secret extraction as a recovery step.

Do not attempt extraction from tunnel-client process memory or runtime
manifests. Without an explicitly supplied future deployment process env key,
DPAPI seeding remains pending one final Owner-provided existing/replacement
Runtime API Key. If the Owner does not have the existing key, obtain a
replacement through the authorized provider/Owner path in a separate step.

## Fresh-session resume

A fresh account-bound Codex session can resume solely from this durable HANDOFF,
the branch and repo state without the prior native session/thread. Verify the
branch/base and uncommitted diff; review the named files and evidence above.
Next task is the candidate C/P containing this HANDOFF; record the actual
checkpoint SHA only after commit creation. This internal child does not commit
or push. Next Human Gate is Owner I/W for main integration, deployed
controllers/helper/setter, one-time DPAPI seed, and live total
stop/start/restart no-prompt validation. No I/W, deployment or production
acceptance has happened. A fresh session can continue from this HANDOFF plus
repo state without depending on the previous native session. Notification is
owned by the outer supervisor; this internal
child returns evidence without Telegram.
