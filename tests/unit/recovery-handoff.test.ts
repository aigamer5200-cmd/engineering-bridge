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
  assert.match(watchdog, /explicit Owner-requested pause\/stop is exempt/u);
});
