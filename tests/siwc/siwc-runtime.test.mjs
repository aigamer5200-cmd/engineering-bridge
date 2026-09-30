import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign
} from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  APP_NAME,
  REQUIRED_SCOPE,
  RESOURCE,
  buildCandidateEnvironment,
  buildCodexPlanConfig,
  createAuthorizationUrl,
  createPkce,
  ensureFreshProfile,
  mergeRefreshResponse,
  needsRefresh,
  verifyIdToken
} from "../../ops/siwc/siwc-runtime.mjs";

function jwtPart(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test("PKCE challenge is SHA-256(verifier) in base64url form", () => {
  const { verifier, challenge } = createPkce();
  assert.ok(verifier.length >= 43);
  assert.equal(
    challenge,
    createHash("sha256").update(verifier, "utf8").digest("base64url")
  );
  assert.equal(challenge.includes("="), false);
});

test("initial authorization request uses dynamic registration and full ChatGPT plan scopes", () => {
  const url = createAuthorizationUrl({
    clientId: "dynamic_agent_client",
    extAgentHostId: "urn:uuid:test-host",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    state: "state-1",
    nonce: "nonce-1",
    challenge: "challenge-1",
    firstRegistration: true
  });
  assert.equal(url.origin + url.pathname, "https://auth.openai.com/api/accounts/authorize");
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("agent_name_hint"), APP_NAME);
  assert.equal(url.searchParams.get("ext_agent_host_id"), "urn:uuid:test-host");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(url.searchParams.get("resource"), RESOURCE);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const scopes = new Set(url.searchParams.get("scope").split(" "));
  for (const scope of [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    REQUIRED_SCOPE
  ]) {
    assert.equal(scopes.has(scope), true, scope);
  }
});

test("returning authorization omits agent_name_hint", () => {
  const url = createAuthorizationUrl({
    clientId: "oaiapp_saved",
    extAgentHostId: "urn:uuid:test-host",
    redirectUri: "http://127.0.0.1:54321/auth/callback",
    state: "state-2",
    nonce: "nonce-2",
    challenge: "challenge-2",
    firstRegistration: false,
    idTokenHint: "retained-id-token",
    loginHint: "user@example.com"
  });
  assert.equal(url.searchParams.get("client_id"), "oaiapp_saved");
  assert.equal(url.searchParams.has("agent_name_hint"), false);
  assert.equal(url.searchParams.get("id_token_hint"), "retained-id-token");
  assert.equal(url.searchParams.get("login_hint"), "user@example.com");
});

test("candidate Codex provider config contains no token material", () => {
  const config = buildCodexPlanConfig();
  assert.match(config, /approval_policy = "never"/);
  assert.match(config, /sandbox_mode = "danger-full-access"/);
  assert.match(config, /model_provider = "openai_chatgpt_plan"/);
  assert.match(config, /env_key = "ACCESS_TOKEN"/);
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, /requires_openai_auth = false/);
  assert.match(config, /supports_websockets = false/);
  assert.match(config, /\[shell_environment_policy\.filters\]/);
  assert.match(config, /"ACCESS_TOKEN" = "exclude"/);
  assert.equal(config.includes("secret-token-value"), false);
});

test("candidate environment isolates plan auth and removes API-key ambiguity", () => {
  const env = buildCandidateEnvironment(
    {
      PATH: "C:\\bin",
      OPENAI_API_KEY: "api-secret",
      CODEX_API_KEY: "codex-secret",
      KEEP_ME: "yes"
    },
    { access_token: "plan-token" },
    "C:\\siwc\\codex-home\\A"
  );
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.ACCESS_TOKEN, "plan-token");
  assert.equal(env.CODEX_HOME, "C:\\siwc\\codex-home\\A");
  assert.equal(env.KEEP_ME, "yes");
});

test("refresh decision honors expiry window and earliest refresh time", () => {
  const savedAt = "2026-09-30T10:00:00.000Z";
  const profile = { saved_at: savedAt, expires_in: 3600 };
  assert.equal(needsRefresh(profile, Date.parse("2026-09-30T10:54:59.000Z")), false);
  assert.equal(needsRefresh(profile, Date.parse("2026-09-30T10:55:00.000Z")), true);

  const delayed = {
    ...profile,
    earliest_refresh_at: "2026-09-30T10:58:00.000Z"
  };
  assert.equal(needsRefresh(delayed, Date.parse("2026-09-30T10:56:00.000Z")), false);
  assert.equal(needsRefresh(delayed, Date.parse("2026-09-30T10:58:00.000Z")), true);
  assert.equal(needsRefresh(delayed, Date.parse("2026-09-30T11:00:00.000Z")), true);
});

test("refresh merge requires rotating refresh token and retains plan scope", () => {
  const existing = {
    access_token: "old-access",
    refresh_token: "old-refresh",
    token_type: "Bearer",
    expires_in: 3600,
    scopes: [REQUIRED_SCOPE, "openid"],
    saved_at: "2026-09-30T10:00:00.000Z"
  };
  const refreshed = mergeRefreshResponse(existing, {
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 3600
  }, Date.parse("2026-09-30T10:30:00.000Z"));
  assert.equal(refreshed.access_token, "new-access");
  assert.equal(refreshed.refresh_token, "new-refresh");
  assert.deepEqual(refreshed.scopes, existing.scopes);
  assert.equal(refreshed.saved_at, "2026-09-30T10:30:00.000Z");
  assert.throws(
    () => mergeRefreshResponse(existing, { access_token: "new-access" }),
    /rotated access and refresh tokens/
  );
});

test("concurrent near-expiry checks serialize refresh-token rotation", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "engineering-bridge-siwc-"));
  try {
    const profiles = join(storageRoot, "profiles");
    await mkdir(profiles, { recursive: true });
    await writeFile(join(profiles, "A.json"), JSON.stringify({
      client_id: "oaiapp_test",
      access_token: "old-access",
      refresh_token: "old-refresh",
      scopes: [REQUIRED_SCOPE],
      saved_at: "2026-09-30T10:00:00.000Z",
      expires_in: 3600
    }));
    let refreshCalls = 0;
    const fetchImpl = async (_url, request) => {
      refreshCalls += 1;
      assert.equal(new URLSearchParams(request.body).get("refresh_token"), "old-refresh");
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: REQUIRED_SCOPE
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const options = {
      storageRoot,
      fetchImpl,
      platform: "linux",
      nowMs: Date.parse("2026-09-30T10:58:00.000Z")
    };
    const [first, second] = await Promise.all([
      ensureFreshProfile("A", options),
      ensureFreshProfile("A", options)
    ]);
    assert.equal(refreshCalls, 1);
    assert.equal(first.access_token, "new-access");
    assert.equal(second.access_token, "new-access");
    const saved = JSON.parse(await readFile(join(profiles, "A.json"), "utf8"));
    assert.equal(saved.refresh_token, "new-refresh");
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("ID token verification checks signature, issuer, audience, expiry, and nonce", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  Object.assign(jwk, { kid: "test-key", alg: "RS256", use: "sig" });
  const header = jwtPart({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const payload = jwtPart({
    iss: "https://auth.openai.com",
    aud: "oaiapp_test",
    sub: "subject-1",
    email: "user@example.com",
    nonce: "nonce-1",
    iat: 1_798_000_000,
    exp: 1_798_003_600
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "utf8"), privateKey).toString("base64url");
  const token = `${signingInput}.${signature}`;
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  const identity = await verifyIdToken(token, "oaiapp_test", "nonce-1", {
    fetchImpl,
    nowMs: 1_798_001_000 * 1000
  });
  assert.equal(identity.sub, "subject-1");

  await assert.rejects(
    verifyIdToken(token, "oaiapp_other", "nonce-1", {
      fetchImpl,
      nowMs: 1_798_001_000 * 1000
    }),
    /audience/
  );
  await assert.rejects(
    verifyIdToken(token, "oaiapp_test", "wrong-nonce", {
      fetchImpl,
      nowMs: 1_798_001_000 * 1000
    }),
    /nonce/
  );
});

