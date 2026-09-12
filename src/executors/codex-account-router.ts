import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { CoreError } from "../core/errors.js";

const ACCOUNT_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function accountQuotaExhausted(switchHome: string, alias: string, nowMs = Date.now()): boolean {
  const cachePath = join(switchHome, "cache.json");
  if (!existsSync(cachePath)) return false;
  try {
    const cache: unknown = JSON.parse(readFileSync(cachePath, "utf8"));
    if (!object(cache) || !object(cache.entries)) return false;
    const entry = cache.entries[alias];
    if (!object(entry)) return false;
    const primaryUsed = entry.primary_used;
    const primaryReset = entry.primary_reset;
    return entry.account_limited === true &&
      entry.rate_limit_reached_type === "rate_limit_reached" &&
      typeof primaryUsed === "number" && primaryUsed >= 100 &&
      typeof primaryReset === "number" && Number.isFinite(primaryReset) &&
      primaryReset * 1000 > nowMs;
  } catch {
    // Routing must not become dependent on the optional usage cache. A missing,
    // stale, or malformed cache simply falls back to the existing launch path.
    return false;
  }
}

export interface CodexAccountLaunch {
  readonly account: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environmentOverlay: Readonly<NodeJS.ProcessEnv>;
}

/**
 * Resolve the optional xjoker/codex-switch launch adapter.
 *
 * No account means no plug-in lookup at all: the caller must keep the exact
 * native Codex path. An explicit account is fail-closed if the plug-in is not
 * configured. `AUTO` is deliberately not exposed in the first production
 * slice because GOAL requires the resolved account identity to be durable
 * evidence; explicit A/B routing lands first without weakening that rule.
 */
export function resolveCodexAccountLaunch(
  account: string | undefined,
  hostEnvironment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform
): CodexAccountLaunch | undefined {
  if (account === undefined) return undefined;
  const alias = account.trim();
  if (!ACCOUNT_PATTERN.test(alias) || alias.toUpperCase() === "AUTO") {
    throw new CoreError("UNSUPPORTED_ACTION");
  }

  const rawAllowlist = hostEnvironment.ENGINEERING_BRIDGE_CODEX_ACCOUNT_ALLOWLIST?.trim();
  if (!rawAllowlist) throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
  const allowed = new Set(
    rawAllowlist.split(",").map((item) => item.trim()).filter((item) => ACCOUNT_PATTERN.test(item))
  );
  if (!allowed.has(alias)) throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");

  const executable = hostEnvironment.ENGINEERING_BRIDGE_CODEX_SWITCH_EXECUTABLE?.trim();
  if (!executable || !isAbsolute(executable) || !existsSync(executable)) {
    throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
  }
  const switchHome = hostEnvironment.ENGINEERING_BRIDGE_CODEX_SWITCH_HOME?.trim();
  if (switchHome !== undefined && switchHome !== "" && !isAbsolute(switchHome)) {
    throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
  }
  if (switchHome && accountQuotaExhausted(switchHome, alias)) {
    throw new CoreError("CODEX_ACCOUNT_QUOTA_EXHAUSTED");
  }
  const isolatedCodexHome = hostEnvironment.ENGINEERING_BRIDGE_CODEX_MULTI_ACCOUNT_CODEX_HOME?.trim();
  if (!isolatedCodexHome || !isAbsolute(isolatedCodexHome)) {
    throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
  }

  const environmentOverlay: NodeJS.ProcessEnv = {
    ...(switchHome ? { CODEX_SWITCH_HOME: switchHome } : {}),
    CODEX_HOME: isolatedCodexHome
  };
  if (platform === "win32") {
    const codexBinDir = hostEnvironment.ENGINEERING_BRIDGE_CODEX_MULTI_ACCOUNT_CODEX_BIN_DIR?.trim();
    if (!codexBinDir || !isAbsolute(codexBinDir) || !existsSync(join(codexBinDir, "codex.exe"))) {
      throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
    }
    const hostPath = environmentValue(hostEnvironment, "PATH");
    environmentOverlay.PATH = hostPath ? `${codexBinDir};${hostPath}` : codexBinDir;
  }

  return {
    account: alias,
    executable,
    // Global --json suppresses the wrapper's human-facing pre-launch stdout.
    // The inner Codex app-server inherits stdio byte-for-byte. Its JSON-RPC is
    // therefore still the only stdout while the supervised turn is active.
    args: ["--json", "launch", alias, "--", "app-server", "--stdio"],
    environmentOverlay
  };
}

function environmentValue(host: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const needle = key.toLowerCase();
  for (const name of Object.keys(host)) {
    if (name.toLowerCase() !== needle) continue;
    const value = host[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  }
  return undefined;
}
