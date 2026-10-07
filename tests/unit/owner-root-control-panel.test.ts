import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const base = join(process.cwd(), "ops/windows/recovery");
const wrappers = join(base, "operator-root");
const mappings = new Map([
  ["00_總啟動_開發雙通道.bat", "START_ALL_CHANNELS"],
  ["01_總關閉_開發雙通道.bat", "STOP_ALL_CHANNELS"],
  ["02_總重啟_開發雙通道.bat", "RESTART_ALL_CHANNELS"],
  ["90_檢查_全部通道狀態.bat", "CHECK_CHANNELS"],
  ["91_設定_Secure_MCP_Runtime_API_Keys.bat", "SET_Secure_MCP_Runtime_API_Keys"],
]);
const names = [...mappings.keys(), "99_Engineering_Recovery.bat"].sort();
const obsolete = ["HANDOFF_BRIDGE_SECURE_MCP_CURRENT_STATUS.md", "HANDOFF_BRIDGE_SECURE_MCP_TUNNEL_20261006.md"];
const read = (name: string): string => readFileSync(join(base, name), "utf8").replace(/\r\n/gu, "\n");

test("canonical Owner wrappers contain exactly the six approved names and mappings", () => {
  assert.deepEqual(readdirSync(wrappers).sort(), names);
  for (const [name, target] of mappings) {
    assert.equal(read(`operator-root/${name}`), `@echo off\nsetlocal EnableExtensions\nset "SCRIPT=%~dp0control\\${target}.bat"\nif not exist "%SCRIPT%" exit /b 60\ncall "%SCRIPT%"\nexit /b %ERRORLEVEL%\n`);
  }
  assert.equal(read("operator-root/99_Engineering_Recovery.bat"), read("06_Engineering_Recovery.bat").replace("D:\\Engineering_Bridge_System\\control\\", "%~dp0control\\"));
});

test("Blue launches hidden detached runners and retains identity/OAuth gates", () => {
  const start = read("START_BRIDGE_CHANNEL.bat");
  assert.doesNotMatch(start, /\bstart\s+"Engineering Bridge (Gateway|Tunnel)"|\/min\b/iu);
  assert.equal(start.split('-File "%HIDDEN_LAUNCHER%"').length - 1, 2);
  assert.ok(start.includes('-Runner "%GATEWAY_RUNNER%" -LogPath "%LOG_DIR%\\bridge-gateway.log"'));
  assert.ok(start.includes('-Runner "%TUNNEL_RUNNER%"'));
  for (const gate of ["8768", "20242", "Get-CimInstance Win32_Process", "mcp-stdio\\.exe.*serve.*--port 8768", "cloudflared.exe", "--metrics 127\\.0\\.0\\.1:20242", "PUBLIC_AUTH_READY.flag", 'if not exist "%TOKEN_FILE%" exit /b 26', "http://127.0.0.1:8768/.well-known/oauth-authorization-server", "https://bridge.twmarketlab.com/.well-known/oauth-authorization-server", "1..40", "exit /b 23", "exit /b 24", "exit /b 27", "exit /b 28"]) {
    assert.ok(start.includes(gate), `retained Blue gate: ${gate}`);
  }
  const helper = read("StartHiddenBridgeRunner.ps1");
  assert.match(helper, /Start-Process[^\n]+-WindowStyle Hidden/u);
  assert.doesNotMatch(helper, /Start-Process[^\n]+-Wait\b/u);
  assert.ok(helper.includes(">> \""));
  assert.ok(helper.includes(">nul 2>&1"));
  assert.doesNotMatch(helper, /ReadAllText|Get-Content|TOKEN_FILE|CONTROL_PLANE_API_KEY/u);
});

test("Recovery watchdog launches without a persistent console window", () => {
  const start = read("START_RECOVERY_WATCHDOG.bat");
  assert.doesNotMatch(start, /\bstart\s+"Engineering Recovery Watchdog"|\/min\b/iu);
  assert.ok(start.includes("System.Diagnostics.ProcessStartInfo"));
  assert.ok(start.includes("CreateNoWindow=$true"));
  assert.ok(start.includes("ProcessWindowStyle]::Hidden"));
  assert.ok(start.includes("engineering_recovery_watchdog.ps1"));
  assert.ok(start.includes("recovery-watchdog.pid"));
});

const windows = process.platform === "win32";
const powershell = (file: string, args: string[]) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(base, file), ...args], { encoding: "utf8", timeout: 30_000, windowsHide: true });

test("deployment backs up and replaces direct files only, preserves control, and reruns safely", { skip: !windows }, () => {
  const root = mkdtempSync(join(process.cwd(), ".owner-root-test-"));
  try {
    mkdirSync(join(root, "control"));
    mkdirSync(join(root, "runtime"));
    mkdirSync(join(root, "keep.bat"));
    writeFileSync(join(root, "control", "internal.bat"), "canonical control");
    writeFileSync(join(root, "runtime", "binary.exe"), "runtime sentinel");
    writeFileSync(join(root, "history.md"), "history");
    const prior = ["obsolete.bat", "OLD.BAT", ...obsolete];
    for (const name of prior) writeFileSync(join(root, name), `original ${name}`);
    const denied = powershell("DeployOwnerRootControlPanel.ps1", ["-SystemRoot", root]);
    assert.notEqual(denied.status, 0);
    assert.equal(readFileSync(join(root, "obsolete.bat"), "utf8"), "original obsolete.bat");
    for (let run = 0; run < 2; run++) {
      const result = powershell("DeployOwnerRootControlPanel.ps1", ["-SystemRoot", root, "-OwnerIWApproved"]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(readdirSync(root, { withFileTypes: true }).filter(x => x.isFile() && /\.bat$/iu.test(x.name)).map(x => x.name).sort(), names);
      for (const name of names) assert.deepEqual(readFileSync(join(root, name)), readFileSync(join(wrappers, name)));
      for (const name of obsolete) assert.ok(!readdirSync(root).includes(name));
      assert.equal(readFileSync(join(root, "control", "internal.bat"), "utf8"), "canonical control");
      assert.equal(readFileSync(join(root, "runtime", "binary.exe"), "utf8"), "runtime sentinel");
      assert.equal(readFileSync(join(root, "history.md"), "utf8"), "history");
      assert.ok(readdirSync(root, { withFileTypes: true }).some(x => x.name === "keep.bat" && x.isDirectory()));
    }
    const backups = readdirSync(join(root, "runtime", "painless-upgrade")).sort();
    assert.equal(backups.length, 2);
    for (const name of prior) assert.equal(readFileSync(join(root, "runtime", "painless-upgrade", backups[0]!, name), "utf8"), `original ${name}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hidden helper executes a harmless spaced BAT runner with redirected output", { skip: !windows }, async () => {
  const root = mkdtempSync(join(process.cwd(), ".hidden-runner-test-"));
  try {
    const runner = join(root, "harmless runner.bat");
    const log = join(root, "runner output.log");
    writeFileSync(runner, "@echo off\r\necho HIDDEN_RUNNER_OK\r\nexit /b 0\r\n");
    const result = powershell("StartHiddenBridgeRunner.ps1", ["-Runner", runner, "-LogPath", log]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let output = "";
    for (let i = 0; i < 40; i++) {
      try { output = readFileSync(log, "utf8"); } catch { /* detached cmd has not opened log yet */ }
      if (output.includes("HIDDEN_RUNNER_OK")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(output, /HIDDEN_RUNNER_OK/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
