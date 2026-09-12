import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { alternateCodexAccount, inspectCodexAccountUsage } from "../../../src/executors/codex-account-router.js";

function fixture(entries: Record<string, unknown>): {
  readonly switchHome: string;
  readonly cachePath: string;
  readonly environment: NodeJS.ProcessEnv;
} {
  const root = mkdtempSync(join(tmpdir(), "bridge-account-usage-"));
  const switchHome = join(root, "switch-home");
  mkdirSync(switchHome);
  const cachePath = join(switchHome, "cache.json");
  writeFileSync(cachePath, JSON.stringify({ entries }), "utf8");
  return {
    switchHome,
    cachePath,
    environment: {
      ENGINEERING_BRIDGE_CODEX_SWITCH_HOME: switchHome,
      ENGINEERING_BRIDGE_CODEX_USAGE_CACHE_MAX_AGE_MS: "300000"
    }
  };
}

test("classifies active five-hour quota exhaustion with a safe reset timestamp", () => {
  const now = Date.now();
  const reset = Math.floor(now / 1000) + 3600;
  const { environment } = fixture({
    A: {
      account_limited: true,
      rate_limit_reached_type: "rate_limit_reached",
      primary_used: 100,
      primary_reset: reset,
      secondary_used: 50,
      secondary_reset: reset + 86_400
    }
  });

  const state = inspectCodexAccountUsage("A", environment, { nowMs: now });

  assert.equal(state.availability, "quota_exhausted");
  assert.equal(state.quotaWindow, "5h");
  assert.equal(state.primaryUsed, 100);
  assert.equal(state.resetAt, new Date(reset * 1000).toISOString());
});

test("weekly exhaustion takes precedence over a still-available five-hour window", () => {
  const now = Date.now();
  const weeklyReset = Math.floor(now / 1000) + 3 * 86_400;
  const { environment } = fixture({
    B: {
      account_limited: true,
      rate_limit_reached_type: "rate_limit_reached",
      primary_used: 40,
      primary_reset: Math.floor(now / 1000) + 3600,
      secondary_used: 100,
      secondary_reset: weeklyReset
    }
  });

  const state = inspectCodexAccountUsage("B", environment, { nowMs: now });

  assert.equal(state.availability, "quota_exhausted");
  assert.equal(state.quotaWindow, "weekly");
  assert.equal(state.secondaryUsed, 100);
  assert.equal(state.resetAt, new Date(weeklyReset * 1000).toISOString());
});

test("expired quota cache automatically becomes available instead of blocking launch", () => {
  const now = Date.now();
  const expired = Math.floor(now / 1000) - 1;
  const { environment } = fixture({
    B: {
      account_limited: true,
      rate_limit_reached_type: "rate_limit_reached",
      primary_used: 100,
      primary_reset: expired,
      secondary_used: 80,
      secondary_reset: expired
    }
  });

  const state = inspectCodexAccountUsage("B", environment, { nowMs: now });

  assert.equal(state.availability, "available");
  assert.equal(state.quotaWindow, undefined);
});

test("stale usage cache is refreshed and re-read before quota classification", () => {
  const now = Date.now();
  const reset = Math.floor(now / 1000) + 3600;
  const { environment, cachePath } = fixture({
    A: {
      account_limited: true,
      rate_limit_reached_type: "rate_limit_reached",
      primary_used: 100,
      primary_reset: reset
    }
  });
  environment.ENGINEERING_BRIDGE_CODEX_USAGE_CACHE_MAX_AGE_MS = "1";
  const stale = new Date(now - 60_000);
  utimesSync(cachePath, stale, stale);
  let refreshes = 0;

  const state = inspectCodexAccountUsage("A", environment, {
    nowMs: now,
    refreshUsageCache: () => {
      refreshes += 1;
      writeFileSync(cachePath, JSON.stringify({
        entries: {
          A: {
            account_limited: false,
            primary_used: 25,
            primary_reset: reset,
            secondary_used: 50,
            secondary_reset: reset + 86_400
          }
        }
      }), "utf8");
    }
  });

  assert.equal(refreshes, 1);
  assert.equal(state.availability, "available");
  assert.equal(state.primaryUsed, 25);
  assert.equal(state.cacheFresh, true);
});

test("stale cache that cannot be refreshed is unknown and cannot drive automatic quota failover", () => {
  const now = Date.now();
  const reset = Math.floor(now / 1000) + 3600;
  const { environment, cachePath } = fixture({
    A: {
      account_limited: true,
      rate_limit_reached_type: "rate_limit_reached",
      primary_used: 100,
      primary_reset: reset
    }
  });
  environment.ENGINEERING_BRIDGE_CODEX_USAGE_CACHE_MAX_AGE_MS = "1";
  const stale = new Date(now - 60_000);
  utimesSync(cachePath, stale, stale);

  const state = inspectCodexAccountUsage("A", environment, {
    nowMs: now,
    refreshUsageCache: () => undefined
  });

  assert.equal(state.cacheFresh, false);
  assert.equal(state.availability, "unknown");
  assert.equal(state.quotaWindow, undefined);
  assert.equal(state.resetAt, undefined);
});

test("generic provider state with quota remaining is never inferred as quota exhaustion", () => {
  const now = Date.now();
  const { environment } = fixture({
    A: {
      account_limited: false,
      rate_limit_reached_type: null,
      primary_used: 75,
      primary_reset: Math.floor(now / 1000) + 3600,
      secondary_used: 60,
      secondary_reset: Math.floor(now / 1000) + 86_400
    }
  });

  assert.equal(inspectCodexAccountUsage("A", environment, { nowMs: now }).availability, "available");
});

test("automatic failover aliases are strictly A to B or B to A even if the allowlist grows", () => {
  const environment = { ENGINEERING_BRIDGE_CODEX_ACCOUNT_ALLOWLIST: "A,B,C" };
  assert.equal(alternateCodexAccount("A", environment), "B");
  assert.equal(alternateCodexAccount("B", environment), "A");
  assert.equal(alternateCodexAccount("C", environment), undefined);
});
