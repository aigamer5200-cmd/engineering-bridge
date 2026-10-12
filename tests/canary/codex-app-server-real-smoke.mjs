// Opt-in live Canary for candidate transport. This calls the real Codex
// app-server and consumes model quota. No repository or production writes.
// Usage after npm run build:
//   node tests/canary/codex-app-server-real-smoke.mjs
import assert from "node:assert/strict";
import { CodexAppServerTransport } from "../../dist/src/transport/codex-app-server.js";

const transport = new CodexAppServerTransport(process.cwd());
const timeout = setTimeout(() => {
  void transport.interrupt().catch(() => {});
}, 90_000);

try {
  const result = await transport.execute({
    instruction: "Health check only. Do not invoke tools and do not read, write, or modify any file. Reply exactly BRIDGE_CANDIDATE_APP_SERVER_OK.",
    model: "gpt-6.1-sol",
    reasoning: "medium"
  });
  assert.equal(result.kind, "completed", JSON.stringify(result));
  assert.equal(result.output.trim(), "BRIDGE_CANDIDATE_APP_SERVER_OK");
  console.log(JSON.stringify({
    status: "PASS",
    model: "gpt-6.1-sol",
    reasoning: "medium",
    bridge_transport: "candidate",
    output: result.output.trim(),
    health_state: transport.healthSnapshot()?.state
  }));
} finally {
  clearTimeout(timeout);
}
