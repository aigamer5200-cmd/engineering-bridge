# Execution usage decision (2026-08-27)

## Evidence and rationale

Real timing measurements put tiny read-only Codex executor calls at about 17–19 seconds. A `continue` on the same task and native thread took about 16 seconds, so preserving the thread did not materially remove executor cost.

This evidence does not justify adding a session manager, executor pool, event bus, worker system, or a large Fast Path/lifecycle rewrite solely for this performance issue. Keep Engineering Bridge thin, and do not reopen that overengineering trade-off without new evidence.

## Operating rules

- Give one engineering problem to one Worker task as a reasonably complete work package when possible.
- For corrections within the same problem, prefer `continue` or `steer` to preserve context, not because either is proven to remove startup cost.
- For important or complex code changes, a fresh independent Codex Auditor may review the result after the Worker finishes. Chat/Supervisor remains the final reviewer; the Worker must not self-certify.
- Treat the observed approximately 25-minute Chat/tool-call window as an operational budget. Keep one work package comfortably below it—roughly 15–20 minutes where practical—and split genuinely longer work at meaningful checkpoints.
- Chat/Supervisor should poll task status automatically within the same turn instead of requiring the user to send another `continue` message.
- Internal asynchronous task state is acceptable, but the user-visible workflow must not depend on a later proactive assistant message.
- `BIND`, `AUTHORIZE`, `APPLY`, `COMMIT`, and `PUSH` remain explicit, separate user gates.

## Revisit condition

These measurements are current evidence, not a permanent performance guarantee. Revisit this decision only when new measurements justify it.
