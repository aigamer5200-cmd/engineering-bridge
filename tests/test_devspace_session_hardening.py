from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
OPS_PATH = REPO_ROOT / "ops" / "devspace_session_hardening.py"
FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "devspace-process-sessions-1.0.8.js"


def load_hardening_module():
    spec = importlib.util.spec_from_file_location("devspace_session_hardening", OPS_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load {OPS_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


hardening = load_hardening_module()


class DevspaceSessionHardeningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.module_root = Path(self.temp_dir.name) / "node_modules" / "@waishnav" / "devspace"
        self.module_dist = self.module_root / "dist"
        self.module_dist.mkdir(parents=True)
        (self.module_root / "package.json").write_text(
            '{"name":"@waishnav/devspace","version":"1.0.8","type":"module"}\n',
            encoding="utf-8",
            newline="\n",
        )
        self.target = self.module_dist / "process-sessions.js"
        shutil.copyfile(FIXTURE_PATH, self.target)
        self.original = self.target.read_bytes()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(OPS_PATH), *arguments],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_terminal_write_replays_same_result_until_ttl_cleanup(self) -> None:
        result = hardening.operate(self.target)
        self.assertEqual(result.mode, "applied")
        self.assertIsNotNone(result.backup)
        self.assertEqual(result.backup.read_bytes(), self.original)
        patched_source = self.target.read_text(encoding="utf-8")
        self.assertIn("const COMPLETED_SESSION_TTL_MS = 60 * 60 * 1_000;", patched_source)
        self.assertEqual(patched_source.count(hardening.REMOVE_AFTER_CONSUME), 1)

        runner = Path(self.temp_dir.name) / "replay-check.mjs"
        runner.write_text(
            """
import { pathToFileURL } from "node:url";
const { ProcessSessionManager } = await import(pathToFileURL(process.argv[2]).href);
const manager = new ProcessSessionManager();
const started = await manager.start({
  workspaceId: "workspace-test",
  command: "fixture-command",
  cwd: process.cwd(),
  tty: false,
  yieldTimeMs: 0,
  completeAfterMs: 25,
  output: "terminal-result\\n",
  exitCode: 23,
});
if (!started.running || started.sessionId === undefined)
  throw new Error(`fixture did not return a running session: ${JSON.stringify(started)}`);
const first = await manager.write({
  workspaceId: "workspace-test",
  sessionId: started.sessionId,
  yieldTimeMs: 100,
  maxOutputTokens: 100,
});
const retainedAfterFirst = manager.sessions.has(started.sessionId);
const second = await manager.write({
  workspaceId: "workspace-test",
  sessionId: started.sessionId,
  maxOutputTokens: 100,
});
const retainedAfterSecond = manager.sessions.has(started.sessionId);
manager.shutdown();
if (JSON.stringify(first) !== JSON.stringify(second))
  throw new Error(`terminal result was not replayed: ${JSON.stringify({ first, second })}`);
if (first.output !== "terminal-result\\n" || first.exitCode !== 23 || first.running !== false)
  throw new Error(`unexpected terminal result: ${JSON.stringify(first)}`);
if (!retainedAfterFirst || !retainedAfterSecond)
  throw new Error("completed session was removed before TTL expiry");
console.log(JSON.stringify({ first, second, retainedAfterFirst, retainedAfterSecond }));
""".lstrip(),
            encoding="utf-8",
            newline="\n",
        )
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node.js is required for the module-copy regression")
        completed = subprocess.run(
            [node, str(runner), str(self.target)],
            cwd=self.temp_dir.name,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["first"], report["second"])
        self.assertTrue(report["retainedAfterFirst"])
        self.assertTrue(report["retainedAfterSecond"])

    def test_idempotence_dry_run_verify_and_create_only_backup(self) -> None:
        before = self.target.read_bytes()
        dry_run = self.run_cli("--dry-run", str(self.target))
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
        self.assertIn("DRY_RUN_PASS", dry_run.stdout)
        self.assertEqual(self.target.read_bytes(), before)
        self.assertEqual(list(self.target.parent.glob("process-sessions.js.bak.*")), [])

        first = hardening.operate(self.target)
        self.assertEqual(first.mode, "applied")
        self.assertRegex(
            first.backup.name,
            r"^process-sessions\.js\.bak\.\d{8}T\d{6}\.\d{6}Z(?:\.\d+)?$",
        )
        patched = self.target.read_bytes()
        backups = sorted(self.target.parent.glob("process-sessions.js.bak.*"))
        self.assertEqual(backups, [first.backup])

        second = hardening.operate(self.target)
        self.assertEqual(second.mode, "already-patched")
        self.assertIsNone(second.backup)
        self.assertEqual(self.target.read_bytes(), patched)
        self.assertEqual(sorted(self.target.parent.glob("process-sessions.js.bak.*")), backups)

        verify = self.run_cli("--verify", str(self.target))
        self.assertEqual(verify.returncode, 0, verify.stderr)
        self.assertIn("VERIFY_PASS", verify.stdout)

    def test_unexpected_source_fails_closed_without_write_or_backup(self) -> None:
        altered = self.original.replace(
            b"const COMPLETED_SESSION_TTL_MS = 5 * 60 * 1_000;",
            b"const COMPLETED_SESSION_TTL_MS = 5 * 30 * 1_000;",
            1,
        )
        self.target.write_bytes(altered)
        failed = self.run_cli(str(self.target))
        self.assertEqual(failed.returncode, 2)
        self.assertIn("FAIL_CLOSED", failed.stderr)
        self.assertEqual(self.target.read_bytes(), altered)
        self.assertEqual(list(self.target.parent.glob("process-sessions.js.bak.*")), [])

    def test_verify_rejects_original_without_mutation(self) -> None:
        failed = self.run_cli("--verify", str(self.target))
        self.assertEqual(failed.returncode, 2)
        self.assertIn("FAIL_CLOSED", failed.stderr)
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(list(self.target.parent.glob("process-sessions.js.bak.*")), [])


if __name__ == "__main__":
    unittest.main()
