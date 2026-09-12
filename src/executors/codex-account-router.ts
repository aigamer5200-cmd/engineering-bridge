import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { CoreError } from "../core/errors.js";

const ACCOUNT_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const DEFAULT_USAGE_CACHE_MAX_AGE_MS = 5 * 60_000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function epochIso(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const value = new Date(seconds * 1000);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function cacheMaxAgeMs(hostEnvironment: Readonly<NodeJS.ProcessEnv>): number {
  const raw = hostEnvironment.ENGINEERING_BRIDGE_CODEX_USAGE_CACHE_MAX_AGE_MS;
  if (raw === undefined) return DEFAULT_USAGE_CACHE_MAX_AGE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_USAGE_CACHE_MAX_AGE_MS;
}

export type CodexQuotaWindow = "5h" | "weekly";
export type CodexAccountAvailability = "available" | "quota_exhausted" | "unknown";

export interface CodexAccountUsageState {
  readonly account: string;
  readonly availability: CodexAccountAvailability;
  readonly quotaWindow?: CodexQuotaWindow;
  readonly resetAt?: string;
  readonly primaryUsed?: number;
  readonly primaryReset?: string;
  readonly secondaryUsed?: number;
  readonly secondaryReset?: string;
  readonly cacheFresh: boolean;
}

function configuredSwitchHome(hostEnvironment: Readonly<NodeJS.ProcessEnv>): string | undefined {
  const switchHome = hostEnvironment.ENGINEERING_BRIDGE_CODEX_SWITCH_HOME?.trim();
  return switchHome && isAbsolute(switchHome) ? switchHome : undefined;
}

function refreshUsageCache(hostEnvironment: Readonly<NodeJS.ProcessEnv>, switchHome: string): void {
  const executable = hostEnvironment.ENGINEERING_BRIDGE_CODEX_SWITCH_EXECUTABLE?.trim();
  if (!executable || !isAbsolute(executable) || !existsSync(executable)) return;
  try {
    // `list` refreshes codex-switch's non-secret usage cache. Raw command output
    // can contain account metadata, so it is deliberately discarded and never
    // enters Bridge logs, receipts, diagnostics, or task output.
    execFileSync(executable, ["--json", "list"], {
      shell: false,
      stdio: "ignore",
      timeout: 10_000,
      windowsHide: true,
      env: { ...hostEnvironment, CODEX_SWITCH_HOME: switchHome }
    });
  } catch {
    // Refresh is bounded and best-effort. The caller will re-read the local
    // cache and treat absent/malformed state as unknown rather than quota.
  }
}

function readUsageState(
  switchHome: string,
  alias: string,
  nowMs: number,
  maxAgeMs: number
): CodexAccountUsageState {
  const cachePath = join(switchHome, "cache.json");
  if (!existsSync(cachePath)) return { account: alias, availability: "unknown", cacheFresh: false };
  try {
    const stat = statSync(cachePath);
    const cacheFresh = nowMs - stat.mtimeMs <= maxAgeMs;
    const cache: unknown = JSON.parse(readFileSync(cachePath, "utf8"));
    if (!object(cache) || !object(cache.entries)) {
      return { account: alias, availability: "unknown", cacheFresh };
    }
    const entry = cache.entries[alias];
    if (!object(entry)) return { account: alias, availability: "unknown", cacheFresh };

    const primaryUsed = finiteNumber(entry.primary_used);
    const primaryResetSeconds = finiteNumber(entry.primary_reset);
    const secondaryUsed = finiteNumber(entry.secondary_used);
    const secondaryResetSeconds = finiteNumber(entry.secondary_reset);
    const primaryReset = epochIso(primaryResetSeconds);
    const secondaryReset = epochIso(secondaryResetSeconds);
    const activelyLimited = entry.account_limited === true &&
      entry.rate_limit_reached_type === "rate_limit_reached";
    const weeklyExhausted = activelyLimited &&
      secondaryUsed !== undefined && secondaryUsed >= 100 &&
      secondaryResetSeconds !== undefined && secondaryResetSeconds * 1000 > nowMs;
    const primaryExhausted = activelyLimited &&
      primaryUsed !== undefined && primaryUsed >= 100 &&
      primaryResetSeconds !== undefined && primaryResetSeconds * 1000 > nowMs;

    if (weeklyExhausted) {
      return {
        account: alias,
        availability: "quota_exhausted",
        quotaWindow: "weekly",
        ...(secondaryReset === undefined ? {} : { resetAt: secondaryReset }),
        ...(primaryUsed === undefined ? {} : { primaryUsed }),
        ...(primaryReset === undefined ? {} : { primaryReset }),
        ...(secondaryUsed === undefined ? {} : { secondaryUsed }),
        ...(secondaryReset === undefined ? {} : { secondaryReset }),
        cacheFresh
      };
    }
    if (primaryExhausted) {
      return {
        account: alias,
        availability: "quota_exhausted",
        quotaWindow: "5h",
        ...(primaryReset === undefined ? {} : { resetAt: primaryReset }),
        ...(primaryUsed === undefined ? {} : { primaryUsed }),
        ...(primaryReset === undefined ? {} : { primaryReset }),
        ...(secondaryUsed === undefined ? {} : { secondaryUsed }),
        ...(secondaryReset === undefined ? {} : { secondaryReset }),
        cacheFresh
      };
    }

    return {
      account: alias,
      availability: "available",
      ...(primaryUsed === undefined ? {} : { primaryUsed }),
      ...(primaryReset === undefined ? {} : { primaryReset }),
      ...(secondaryUsed === undefined ? {} : { secondaryUsed }),
      ...(secondaryReset === undefined ? {} : { secondaryReset }),
      cacheFresh
    };
  } catch {
    return { account: alias, availability: "unknown", cacheFresh: false };
  }
}

export function inspectCodexAccountUsage(
  account: string,
  hostEnvironment: Readonly<NodeJS.ProcessEnv>,
  options: {
    readonly forceRefresh?: boolean;
    readonly nowMs?: number;
    readonly refreshUsageCache?: () => void;
  } = {}
): CodexAccountUsageState {
  const alias = account.trim();
  if (!ACCOUNT_PATTERN.test(alias) || alias.toUpperCase() === "AUTO") {
    return { account: alias, availability: "unknown", cacheFresh: false };
  }
  const switchHome = configuredSwitchHome(hostEnvironment);
  if (switchHome === undefined) return { account: alias, availability: "unknown", cacheFresh: false };
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = cacheMaxAgeMs(hostEnvironment);
  let state = readUsageState(switchHome, alias, nowMs, maxAgeMs);
  if (options.forceRefresh === true || !state.cacheFresh) {
    if (options.refreshUsageCache !== undefined) options.refreshUsageCache();
    else refreshUsageCache(hostEnvironment, switchHome);
    state = readUsageState(switchHome, alias, nowMs, maxAgeMs);
  }
  if (!state.cacheFresh) {
    return {
      account: state.account,
      availability: "unknown",
      ...(state.primaryUsed === undefined ? {} : { primaryUsed: state.primaryUsed }),
      ...(state.primaryReset === undefined ? {} : { primaryReset: state.primaryReset }),
      ...(state.secondaryUsed === undefined ? {} : { secondaryUsed: state.secondaryUsed }),
      ...(state.secondaryReset === undefined ? {} : { secondaryReset: state.secondaryReset }),
      cacheFresh: false
    };
  }
  return state;
}

export function alternateCodexAccount(
  account: string,
  hostEnvironment: Readonly<NodeJS.ProcessEnv>
): string | undefined {
  const rawAllowlist = hostEnvironment.ENGINEERING_BRIDGE_CODEX_ACCOUNT_ALLOWLIST?.trim();
  if (!rawAllowlist) return undefined;
  const allowed = new Set(rawAllowlist.split(",").map((item) => item.trim()).filter((item) => ACCOUNT_PATTERN.test(item)));
  if (account === "A" && allowed.has("B")) return "B";
  if (account === "B" && allowed.has("A")) return "A";
  return undefined;
}

export interface CodexAccountLaunch {
  readonly account: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environmentOverlay: Readonly<NodeJS.ProcessEnv>;
}

/** Resolve the optional xjoker/codex-switch launch adapter. */
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
  if (!allowed.has(alias)) throw new CoreError("ACCOUNT_PROFILE_UNAVAILABLE");

  const executable = hostEnvironment.ENGINEERING_BRIDGE_CODEX_SWITCH_EXECUTABLE?.trim();
  if (!executable || !isAbsolute(executable) || !existsSync(executable)) {
    throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
  }
  const switchHome = hostEnvironment.ENGINEERING_BRIDGE_CODEX_SWITCH_HOME?.trim();
  if (switchHome !== undefined && switchHome !== "" && !isAbsolute(switchHome)) {
    throw new CoreError("CODEX_ACCOUNT_UNAVAILABLE");
  }
  const usage = inspectCodexAccountUsage(alias, hostEnvironment);
  if (usage.availability === "quota_exhausted") {
    throw new CoreError(usage.quotaWindow === "weekly"
      ? "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED"
      : "ACCOUNT_5H_QUOTA_EXHAUSTED");
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
