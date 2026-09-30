import {
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature
} from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const APP_NAME = "engineering-bridge";
export const APP_TITLE = "Engineering Bridge";
export const AUTH_ENDPOINT = "https://auth.openai.com/api/accounts/authorize";
export const TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token";
export const JWKS_URI = "https://auth.openai.com/.well-known/jwks.json";
export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";
export const REQUESTED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  REQUIRED_SCOPE
];

const CALLBACK_PATH = "/auth/callback";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const OAUTH_FETCH_TIMEOUT_MS = 30 * 1000;
const REFRESH_LOCK_TIMEOUT_MS = 15 * 1000;
const REFRESH_LOCK_STALE_MS = 2 * 60 * 1000;

function base64UrlJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function audienceMatches(aud, clientId) {
  if (typeof aud === "string") return aud === clientId;
  return Array.isArray(aud) && aud.includes(clientId);
}

function normalizeEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeEpochMs(numeric);
  }
  return undefined;
}

function ensureProfileLabel(label) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(label)) {
    throw new Error("Profile label must use only letters, digits, dot, underscore, or hyphen.");
  }
  return label;
}

export function defaultStorageRoot(env = process.env, platform = process.platform) {
  if (env.ENGINEERING_BRIDGE_SIWC_HOME) return env.ENGINEERING_BRIDGE_SIWC_HOME;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "EngineeringBridge", "siwc");
  }
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "engineering-bridge", "siwc");
}

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
  return { verifier, challenge };
}

export function createAuthorizationUrl({
  clientId,
  extAgentHostId,
  redirectUri,
  state,
  nonce,
  challenge,
  firstRegistration,
  idTokenHint,
  loginHint
}) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  if (firstRegistration) url.searchParams.set("agent_name_hint", APP_NAME);
  url.searchParams.set("ext_agent_host_id", extAgentHostId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", REQUESTED_SCOPES.join(" "));
  url.searchParams.set("resource", RESOURCE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  if (!firstRegistration && idTokenHint) url.searchParams.set("id_token_hint", idTokenHint);
  if (!firstRegistration && loginHint) url.searchParams.set("login_hint", loginHint);
  return url;
}

async function protectFile(path, env = process.env, platform = process.platform) {
  if (platform !== "win32") {
    await chmod(path, 0o600);
    return;
  }
  const username = env.USERNAME;
  if (!username) throw new Error("Cannot secure SIWC credentials: USERNAME is unavailable.");
  const principal = env.USERDOMAIN ? `${env.USERDOMAIN}\\${username}` : username;
  const secured = spawnSync(
    "icacls",
    [path, "/inheritance:r", "/grant:r", `${principal}:(F)`],
    { shell: false, windowsHide: true, stdio: "ignore" }
  );
  if (secured.status !== 0) throw new Error("Cannot secure SIWC credential file ACL.");
}

async function atomicWriteJson(path, value, options = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await protectFile(tmp, options.env, options.platform);
  await rename(tmp, path);
  await protectFile(path, options.env, options.platform);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function hostPath(storageRoot) {
  return join(storageRoot, "host.json");
}

function profilePath(storageRoot, label) {
  return join(storageRoot, "profiles", `${ensureProfileLabel(label)}.json`);
}

export async function ensureHostId(storageRoot = defaultStorageRoot(), options = {}) {
  const path = hostPath(storageRoot);
  const existing = await readJson(path);
  if (typeof existing?.ext_agent_host_id === "string" && existing.ext_agent_host_id !== "") {
    return existing.ext_agent_host_id;
  }
  const extAgentHostId = `urn:uuid:${randomUUID()}`;
  await atomicWriteJson(path, { ext_agent_host_id: extAgentHostId }, options);
  return extAgentHostId;
}

export async function loadProfile(label, storageRoot = defaultStorageRoot()) {
  return readJson(profilePath(storageRoot, label));
}

async function saveProfile(label, profile, storageRoot, options = {}) {
  await atomicWriteJson(profilePath(storageRoot, label), profile, options);
}

export function publicProfile(profile, label) {
  const expiresAt = profileExpiryMs(profile);
  return {
    label,
    connected: Boolean(profile?.client_id && profile?.access_token && profile?.refresh_token),
    email: typeof profile?.email === "string" ? profile.email : undefined,
    client_id: typeof profile?.client_id === "string" ? profile.client_id : undefined,
    subject: typeof profile?.subject === "string" ? profile.subject : undefined,
    scopes: Array.isArray(profile?.scopes) ? profile.scopes : [],
    expires_at: expiresAt === undefined ? undefined : new Date(expiresAt).toISOString()
  };
}

export function profileExpiryMs(profile) {
  const savedAt = Date.parse(profile?.saved_at ?? "");
  const expiresIn = Number(profile?.expires_in);
  if (!Number.isFinite(savedAt) || !Number.isFinite(expiresIn) || expiresIn <= 0) return undefined;
  return savedAt + expiresIn * 1000;
}

export function needsRefresh(profile, nowMs = Date.now()) {
  const expiresAt = profileExpiryMs(profile);
  if (expiresAt === undefined) return true;
  if (nowMs < expiresAt - REFRESH_SKEW_MS) return false;
  const earliest = normalizeEpochMs(profile?.earliest_refresh_at);
  return earliest === undefined || nowMs >= earliest || nowMs >= expiresAt;
}

function grantedScopes(scopeValue, fallback = []) {
  if (typeof scopeValue !== "string" || scopeValue.trim() === "") return [...fallback];
  return scopeValue.trim().split(/\s+/).filter(Boolean);
}

function assertPlanScope(scopes) {
  if (!scopes.includes(REQUIRED_SCOPE)) {
    throw new Error("ChatGPT plan usage was not granted for this profile.");
  }
}

function fetchSignal(timeoutMs = OAUTH_FETCH_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

async function tokenRequest(params, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: fetchSignal(options.fetchTimeoutMs)
  });
  const text = await response.text();
  let data;
  try {
    data = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new Error(`OpenAI token endpoint returned HTTP ${response.status} with a non-JSON body.`);
  }
  if (!response.ok) {
    const code = typeof data?.error === "string" ? data.error : "oauth_error";
    throw new Error(`OpenAI token exchange failed (HTTP ${response.status}, ${code}).`);
  }
  return data;
}

export async function verifyIdToken(idToken, clientId, nonce, options = {}) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("OpenAI ID token is malformed.");
  const header = base64UrlJson(parts[0]);
  const payload = base64UrlJson(parts[1]);
  const alg = header?.alg;
  const kid = header?.kid;
  if (typeof kid !== "string" || !["RS256", "PS256", "ES256"].includes(alg)) {
    throw new Error("OpenAI ID token uses an unsupported signing algorithm.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.jwksUri ?? JWKS_URI, {
    signal: fetchSignal(options.fetchTimeoutMs)
  });
  if (!response.ok) throw new Error(`OpenAI JWKS request failed (HTTP ${response.status}).`);
  const jwks = await response.json();
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find((key) => key?.kid === kid) : undefined;
  if (!jwk) throw new Error("OpenAI ID token signing key was not found.");

  const key = createPublicKey({ key: jwk, format: "jwk" });
  const input = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = Buffer.from(parts[2], "base64url");
  let verified = false;
  if (alg === "RS256") {
    verified = verifySignature("RSA-SHA256", input, key, signature);
  } else if (alg === "PS256") {
    verified = verifySignature(
      "sha256",
      input,
      { key, padding: cryptoConstants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
      signature
    );
  } else if (alg === "ES256") {
    verified = verifySignature("sha256", input, { key, dsaEncoding: "ieee-p1363" }, signature);
  }
  if (!verified) throw new Error("OpenAI ID token signature verification failed.");

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload?.iss !== ISSUER) throw new Error("OpenAI ID token issuer is invalid.");
  if (!audienceMatches(payload?.aud, clientId)) throw new Error("OpenAI ID token audience is invalid.");
  if (typeof payload?.exp !== "number" || payload.exp <= nowSeconds) throw new Error("OpenAI ID token is expired.");
  if (typeof payload?.nbf === "number" && payload.nbf > nowSeconds) throw new Error("OpenAI ID token is not active yet.");
  if (payload?.nonce !== nonce) throw new Error("OpenAI ID token nonce is invalid.");
  if (typeof payload?.sub !== "string" || payload.sub === "") throw new Error("OpenAI ID token subject is invalid.");
  return payload;
}

function openSystemBrowser(url, platform = process.platform) {
  let command;
  let args;
  if (platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else if (platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, shell: false, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function startCallbackListener(timeoutMs = LOGIN_TIMEOUT_MS) {
  let settle;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    settle = resolve;
    rejectResult = reject;
  });
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><meta charset=\"utf-8\"><title>Engineering Bridge</title><p>Authorization received. You can close this window.</p>");
      settle(Object.fromEntries(url.searchParams.entries()));
    } catch (error) {
      rejectResult(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to start the SIWC loopback callback.");
  }
  const timer = setTimeout(() => rejectResult(new Error("SIWC browser authorization timed out.")), timeoutMs);
  return {
    redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    result: result.finally(() => {
      clearTimeout(timer);
      server.close();
    }),
    close: () => server.close()
  };
}

export async function loginProfile(label, options = {}) {
  ensureProfileLabel(label);
  const storageRoot = options.storageRoot ?? defaultStorageRoot(options.env, options.platform);
  const existing = await loadProfile(label, storageRoot);
  const extAgentHostId = await ensureHostId(storageRoot, options);
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const { verifier, challenge } = createPkce();
  const listener = await startCallbackListener(options.timeoutMs);
  const firstRegistration = !existing?.client_id;
  const requestedClientId = firstRegistration ? "dynamic_agent_client" : existing.client_id;
  const authorizationUrl = createAuthorizationUrl({
    clientId: requestedClientId,
    extAgentHostId,
    redirectUri: listener.redirectUri,
    state,
    nonce,
    challenge,
    firstRegistration,
    idTokenHint: existing?.id_token,
    loginHint: existing?.email
  });

  try {
    (options.openBrowser ?? openSystemBrowser)(authorizationUrl.toString(), options.platform);
    const callback = await listener.result;
    if (callback.state !== state) throw new Error("SIWC callback state did not match.");
    if (callback.error) throw new Error(`SIWC authorization failed (${callback.error}).`);
    if (!callback.code) throw new Error("SIWC callback did not contain an authorization code.");

    const issuedClientId = firstRegistration ? callback.client_id : existing.client_id;
    if (firstRegistration && !issuedClientId) throw new Error("SIWC registration did not return an issued client ID.");
    if (!firstRegistration && callback.client_id && callback.client_id !== existing.client_id) {
      throw new Error("SIWC callback returned a different client ID for the selected profile.");
    }

    const token = await tokenRequest({
      grant_type: "authorization_code",
      client_id: issuedClientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: listener.redirectUri,
      resource: RESOURCE
    }, options);
    if (!token.id_token || !token.access_token || !token.refresh_token) {
      throw new Error("SIWC token response is incomplete.");
    }
    const identity = await verifyIdToken(token.id_token, issuedClientId, nonce, {
      fetchImpl: options.fetchImpl,
      jwksUri: options.jwksUri,
      nowMs: options.nowMs,
      fetchTimeoutMs: options.fetchTimeoutMs
    });
    if (existing?.subject && identity.sub !== existing.subject) {
      throw new Error("SIWC identity does not match the selected saved profile.");
    }
    const scopes = grantedScopes(token.scope);
    assertPlanScope(scopes);
    const profile = {
      email: typeof identity.email === "string" ? identity.email : existing?.email,
      issuer: ISSUER,
      subject: identity.sub,
      client_id: issuedClientId,
      ext_agent_host_id: extAgentHostId,
      id_token: token.id_token,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: token.token_type ?? "Bearer",
      expires_in: Number(token.expires_in) || 3600,
      earliest_refresh_at: token.earliest_refresh_at,
      scopes,
      saved_at: new Date(options.nowMs ?? Date.now()).toISOString()
    };
    await saveProfile(label, profile, storageRoot, options);
    return publicProfile(profile, label);
  } finally {
    listener.close();
  }
}

export function mergeRefreshResponse(existing, token, nowMs = Date.now()) {
  if (!token?.access_token || !token?.refresh_token) {
    throw new Error("SIWC refresh did not return rotated access and refresh tokens.");
  }
  const scopes = grantedScopes(token.scope, existing.scopes ?? []);
  assertPlanScope(scopes);
  return {
    ...existing,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type ?? existing.token_type ?? "Bearer",
    expires_in: Number(token.expires_in) || existing.expires_in || 3600,
    earliest_refresh_at: token.earliest_refresh_at,
    scopes,
    saved_at: new Date(nowMs).toISOString()
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRefreshLock(label, storageRoot, work, options = {}) {
  const lockRoot = join(storageRoot, "locks");
  const lockPath = join(lockRoot, `${ensureProfileLabel(label)}.refresh.lock`);
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  const timeoutMs = options.refreshLockTimeoutMs ?? REFRESH_LOCK_TIMEOUT_MS;
  const staleMs = options.refreshLockStaleMs ?? REFRESH_LOCK_STALE_MS;
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("SIWC refresh is already in progress for this profile.");
      }
      await sleep(100);
    }
  }

  try {
    return await work();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function refreshProfile(label, options = {}) {
  ensureProfileLabel(label);
  const storageRoot = options.storageRoot ?? defaultStorageRoot(options.env, options.platform);
  return withRefreshLock(label, storageRoot, async () => {
    const existing = await loadProfile(label, storageRoot);
    if (!existing?.client_id || !existing?.refresh_token) throw new Error("SIWC profile is not connected.");
    if (options.onlyIfNeeded && !needsRefresh(existing, options.nowMs ?? Date.now())) return existing;
    const token = await tokenRequest({
      grant_type: "refresh_token",
      client_id: existing.client_id,
      refresh_token: existing.refresh_token,
      resource: RESOURCE
    }, options);
    const refreshed = mergeRefreshResponse(existing, token, options.nowMs ?? Date.now());
    await saveProfile(label, refreshed, storageRoot, options);
    return refreshed;
  }, options);
}

export async function ensureFreshProfile(label, options = {}) {
  const storageRoot = options.storageRoot ?? defaultStorageRoot(options.env, options.platform);
  const existing = await loadProfile(label, storageRoot);
  if (!existing?.access_token || !existing?.refresh_token) throw new Error("SIWC profile is not connected.");
  if (!existing.scopes?.includes(REQUIRED_SCOPE)) throw new Error("SIWC profile does not grant ChatGPT plan usage.");
  return needsRefresh(existing, options.nowMs ?? Date.now())
    ? refreshProfile(label, { ...options, storageRoot, onlyIfNeeded: true })
    : existing;
}

export function buildCodexPlanConfig() {
  return [
    'model_provider = "openai_chatgpt_plan"',
    "",
    "[model_providers.openai_chatgpt_plan]",
    'name = "ChatGPT plan"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "ACCESS_TOKEN"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "supports_websockets = false",
    "",
    "[shell_environment_policy]",
    "ignore_default_excludes = true",
    "",
    "[shell_environment_policy.filters]",
    '"ACCESS_TOKEN" = "exclude"',
    ""
  ].join("\n");
}

export async function prepareCandidateCodexHome(label, storageRoot = defaultStorageRoot(), options = {}) {
  ensureProfileLabel(label);
  const codexHome = join(storageRoot, "codex-home", label);
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const configPath = join(codexHome, "config.toml");
  const tmp = `${configPath}.${process.pid}.tmp`;
  await writeFile(tmp, buildCodexPlanConfig(), { encoding: "utf8", mode: 0o600 });
  await protectFile(tmp, options.env, options.platform);
  await rename(tmp, configPath);
  await protectFile(configPath, options.env, options.platform);
  return codexHome;
}

export function buildCandidateEnvironment(baseEnv, profile, codexHome) {
  if (!profile?.access_token) throw new Error("SIWC access token is unavailable.");
  const env = { ...baseEnv };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  env.ACCESS_TOKEN = profile.access_token;
  env.CODEX_HOME = codexHome;
  return env;
}

