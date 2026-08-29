import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const watchdog = readFileSync(
  join(process.cwd(), "ops", "windows", "recovery", "engineering_recovery_watchdog.ps1"),
  "utf8"
);

test("recovery handoff freezes the reason-agnostic GOAL Telegram stop rule", () => {
  assert.match(watchdog, /any reason that causes forward execution to stop/u);
  assert.match(watchdog, /notify the Owner through Telegram before yielding or waiting/u);
  assert.match(watchdog, /owner-only decision waits/u);
  assert.match(watchdog, /notify first, then recover and continue automatically when safe/u);
  assert.match(watchdog, /Owner-requested pause\/stop/u);
  assert.match(watchdog, /dedicated PAUSED_BY_OWNER pause notification/u);
  assert.match(watchdog, /still mandatory TG/u);
  assert.match(watchdog, /an intermediate C\/P is routine recovery state/u);
  assert.match(watchdog, /A final verified C\/P is different/u);
  assert.match(watchdog, /Owner deciding whether to authorize I\/W/u);
  assert.match(watchdog, /after that final C\/P is durable/u);
  assert.match(watchdog, /standalone global npm Codex provider first/u);
  assert.match(watchdog, /VS Code bundled codex\.exe fallback/u);
  assert.match(watchdog, /every formal bounded Codex task must enter through Engineering Bridge/u);
  assert.match(watchdog, /Do not use DS exec_command/u);
  assert.match(watchdog, /task-local recoverable failure/u);
  assert.match(watchdog, /keep executor_mode=codex/u);
  assert.match(watchdog, /requires DS apply_patch for writes/u);
  assert.match(watchdog, /Only actual exhaustion of both providers/u);
  assert.match(watchdog, /codex-failure transition/u);
  assert.match(watchdog, /single task-local stall must never advance the provider chain/u);
});
