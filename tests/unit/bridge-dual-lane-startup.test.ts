import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const readControl = (name: string): string =>
  readFileSync(join(process.cwd(), "ops", "windows", "recovery", name), "utf8")
    .replace(/\r\n/gu, "\n");
const call = (name: string): string => `call "%CONTROL%\\${name}.bat"`;

function orderedCalls(source: string, names: string[]): void {
  let previous = -1;
  for (const name of names) {
    const position = source.indexOf(call(name));
    assert.ok(position > previous, `${name} must be called after the preceding step`);
    assert.equal(source.split(call(name)).length - 1, 1, `${name} must be called once`);
    previous = position;
  }
}

test("master startup delegates Bridge and stops before watchdog on failure", () => {
  const master = readControl("START_ALL_CHANNELS.bat");
  orderedCalls(master, ["START_DS_CHANNEL", "START_ENGINEERING_BRIDGE_ALL", "START_RECOVERY_WATCHDOG", "CHECK_CHANNELS"]);
  assert.ok(!master.includes(call("START_BRIDGE_CHANNEL")));
  assert.ok(!master.includes(call("START_Secure_MCP_Bridge")));
  assert.match(master, /START_ENGINEERING_BRIDGE_ALL\.bat"\nif errorlevel 1 \(\n  echo \[FAIL\][^\n]+\n  exit \/b %ERRORLEVEL%\n\)/u);
});

test("Bridge startup reads the current version and verifies Blue then Green before READY", () => {
  const start = readControl("START_ENGINEERING_BRIDGE_ALL.bat");
  assert.ok(start.includes('set "VERSION_FILE=D:\\Engineering_Bridge_System\\runtime\\bridge-current-version.txt"'));
  assert.ok(start.includes('set /p "BRIDGE_VERSION=" < "%VERSION_FILE%"'));
  assert.ok(start.includes("echo Current Bridge runtime version: %BRIDGE_VERSION%"));
  assert.match(start, /if not exist "%VERSION_FILE%" \([\s\S]*?exit \/b 74\n\)/u);
  assert.match(start, /if not defined BRIDGE_VERSION \([\s\S]*?exit \/b 74\n\)/u);
  assert.ok(!start.includes("1.4.2-biaogu.16"));
  orderedCalls(start, ["START_BRIDGE_CHANNEL", "START_Secure_MCP_Bridge", "STATUS_Secure_MCP_Bridge"]);
  assert.match(start, /START_BRIDGE_CHANNEL\.bat"\nif errorlevel 1 \([^)]*exit \/b 72\n\)/u);
  assert.match(start, /START_Secure_MCP_Bridge\.bat"\nif errorlevel 1 \([^)]*Blue rollback remains untouched[^)]*exit \/b 75\n\)/u);
  assert.match(start, /STATUS_Secure_MCP_Bridge\.bat"\nif errorlevel 1 \([^)]*Blue rollback remains untouched[^)]*exit \/b 76\n\)/u);
  assert.ok(start.indexOf("Green primary : READY") > start.indexOf(call("STATUS_Secure_MCP_Bridge")));
  assert.ok(start.includes("Blue rollback : READY"));
  assert.doesNotMatch(start, /call .*STOP_|call .*ROLLBACK_/u);
});

test("Bridge stop aborts on Green failure before touching Blue", () => {
  const stop = readControl("STOP_ENGINEERING_BRIDGE_ALL.bat");
  orderedCalls(stop, ["STOP_Secure_MCP_Bridge", "STOP_BRIDGE_CHANNEL"]);
  assert.match(stop, /STOP_Secure_MCP_Bridge\.bat"\nif errorlevel 1 \(\n  echo \[FAIL\][^\n]+\n  echo Blue rollback remains untouched; dual-lane stop aborted\.\n  exit \/b %ERRORLEVEL%\n\)\n\ncall "%CONTROL%\\STOP_BRIDGE_CHANNEL\.bat"/u);
  assert.match(stop, /STOP_BRIDGE_CHANNEL\.bat"\nif errorlevel 1 \([^)]*exit \/b %ERRORLEVEL%\n\)/u);
});

test("interactive restart composes fail-closed stop, bounded pause, and start", () => {
  const restart = readControl("RESTART_ENGINEERING_BRIDGE_ALL.bat");
  orderedCalls(restart, ["STOP_ENGINEERING_BRIDGE_ALL", "START_ENGINEERING_BRIDGE_ALL"]);
  assert.match(restart, /STOP_ENGINEERING_BRIDGE_ALL\.bat"\nif errorlevel 1 exit \/b %ERRORLEVEL%\n\npowershell -NoProfile -Command Start-Sleep -Seconds 2\nif errorlevel 1 exit \/b %ERRORLEVEL%\ncall "%CONTROL%\\START_ENGINEERING_BRIDGE_ALL\.bat"\nexit \/b %ERRORLEVEL%/u);
});

test("documentation keeps unattended recovery on its Blue-only adapter", () => {
  const readme = readControl("README.md");
  for (const name of ["START", "STOP", "RESTART"]) {
    assert.ok(readme.includes(`\`${name}_ENGINEERING_BRIDGE_ALL.bat\``));
  }
  assert.match(readme, /Interactive Owner-facing Bridge controls use these dual-lane helpers/u);
  assert.match(readme, /`RESTART_BRIDGE_CHANNEL\.bat` remains Blue-only for unattended recovery and must\nnot be repointed to the interactive dual-lane restart/u);
  const watchdog = readControl("engineering_recovery_watchdog.ps1");
  assert.ok(watchdog.includes('$RestartBridge = Join-Path $ControlRoot "RESTART_BRIDGE_CHANNEL.bat"'));
  assert.ok(!watchdog.includes("RESTART_ENGINEERING_BRIDGE_ALL.bat"));
});

test("master stop shuts down DevSpace Green before Blue", function () {
  const stop = readControl("STOP_ALL_CHANNELS.bat");
  assert.ok(stop.includes('set "DEVSPACE_SECURE_CONTROL=D:\\Engineering_Bridge_System\\DevSpace\\canary\\secure-tunnel-beta\\control"'));
  const green = 'call "%DEVSPACE_SECURE_CONTROL%\\STOP_Secure_MCP_DevSpace.bat"';
  const blue = call("STOP_DS_CHANNEL");
  assert.ok(stop.indexOf(green) >= 0);
  assert.ok(stop.indexOf(blue) > stop.indexOf(green));
  assert.ok(stop.includes('set "DS_GREEN_RC=%ERRORLEVEL%"'));
  assert.ok(stop.includes('set "DS_BLUE_RC=%ERRORLEVEL%"'));
  assert.ok(stop.includes('if not "%DS_GREEN_RC%"=="0" exit /b %DS_GREEN_RC%'));
  assert.ok(stop.includes('if not "%DS_BLUE_RC%"=="0" exit /b %DS_BLUE_RC%'));
});
