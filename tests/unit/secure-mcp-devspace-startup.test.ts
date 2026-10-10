import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const script = readFileSync(
  join(process.cwd(), "ops", "windows", "recovery", "SecureMcpDevSpace.ps1"),
  "utf8",
).replace(/\r\n/gu, "\n");

test("Green DevSpace cold start gets 120 seconds without widening other service waits", () => {
  assert.match(script, /-Port \$GreenUpstreamPort -ExpectedName "node\.exe" -CommandPattern [^\n]+ -Seconds 120/u);
  assert.match(script, /within 120 seconds\. Inspect \$stderr/u);
  assert.match(script, /-Port \$GreenProxyPort -ExpectedName "node\.exe" -CommandPattern [^\n]+ -Seconds 30/u);
  assert.match(script, /-Port \$TunnelHealthPort -ExpectedName "tunnel-client\.exe" -CommandPattern [^\n]+\n/u);
  assert.match(script, /\[int\]\$Seconds = 45/u);
});

test("Green startup logs bounded stage outcomes and failure reasons without raw exception content", () => {
  for (const stage of ["preflight", "green_devspace", "green_guard", "green_tunnel", "verification"]) {
    assert.ok(script.includes(`Start-StartupStage -Stage "${stage}"`));
  }
  assert.match(script, /green-startup-events\.jsonl/u);
  assert.match(script, /timestamp_utc = \[DateTime\]::UtcNow/u);
  assert.match(script, /elapsed_ms = \$ElapsedMs/u);
  assert.match(script, /Complete-StartupStage -Status \$\(if \(\$devspaceWasReady\) \{ "REUSED" \} else \{ "READY" \}\)/u);
  assert.match(script, /-Status "FAILED" -ElapsedMs \$ms -Detail \$reason/u);
  assert.match(script, /Do not persist raw exception messages/u);
  assert.doesNotMatch(script, /-Detail \$ErrorObject\.Message/u);
  assert.match(script, /"Start" \{\s*try \{ Start-Green \}\s*catch \{\s*Fail-StartupStage -ErrorObject \$_\.Exception\s*throw/u);
});

test("Blue verification and stop boundaries remain intact", () => {
  assert.match(script, /\$blue = Assert-Blue/u);
  assert.match(script, /Save-RuntimeManifest -Blue \$blue -Green \$green/u);
  assert.match(script, /Stop-Green \{[\s\S]*?\$blueBefore = Assert-Blue/u);
  assert.match(script, /Stop-Green \{[\s\S]*?Stop-VerifiedListener -Port \$TunnelHealthPort[\s\S]*?Stop-VerifiedListener -Port \$GreenProxyPort[\s\S]*?Stop-VerifiedListener -Port \$GreenUpstreamPort/u);
  assert.doesNotMatch(script, /Stop-VerifiedListener -Port \$Blue/u);
});
