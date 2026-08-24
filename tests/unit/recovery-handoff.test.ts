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
  assert.match(watchdog, /an intermediate C\/P is routine recovery state/u);
  assert.match(watchdog, /A final verified C\/P is different/u);
  assert.match(watchdog, /Owner deciding whether to authorize I\/W/u);
  assert.match(watchdog, /after that final C\/P is durable/u);
  assert.match(watchdog, /standalone global npm Codex provider first/u);
  assert.match(watchdog, /VS Code bundled codex\.exe fallback/u);
  assert.match(watchdog, /switch the Shoestring GOAL executor mode to web-gpt-ds/u);
  assert.match(watchdog, /continue the same frozen GOAL with Web GPT \+ DS/u);
  assert.match(watchdog, /Do not stop merely because Codex is unavailable/u);
});
