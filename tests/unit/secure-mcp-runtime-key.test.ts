import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const base = join(process.cwd(), "ops/windows/recovery");
const source = (name: string) => readFileSync(join(base, name), "utf8");
const helper = source("SecureMcpRuntimeKey.ps1");

test("both Green controllers resolve centrally without prompting or saving keys", () => {
  for (const name of ["SecureMcpBridge.ps1", "SecureMcpDevSpace.ps1"]) {
    const controller = source(name);
    assert.doesNotMatch(controller, /Read-Host|Save-SecureMcpRuntimeKey|SecureStringToBSTR/u);
    assert.match(controller, /D:\\Engineering_Bridge_System\\control\\SecureMcpRuntimeKey\.ps1/u);
    assert.match(controller, /\. \$keyHelper\s+\$runtimeKey = Resolve-SecureMcpRuntimeKey/u);
    assert.match(controller, /api_key: "env:CONTROL_PLANE_API_KEY"/u);
    assert.match(controller, /finally \{\s+\$runtimeKey = \$null/u);
    assert.match(controller, /Remove-Item Env:\\CONTROL_PLANE_API_KEY/u);
    assert.doesNotMatch(controller, /(?:Write-Host|WriteAllText|ArgumentList)[^\r\n]*\$(?:runtimeKey|oldKey)/u);
  }
  const resolver = helper.slice(helper.indexOf("function Resolve-SecureMcpRuntimeKey"));
  assert.ok(resolver.indexOf("GetEnvironmentVariable") < resolver.indexOf("Load-SecureMcpRuntimeKey"));
  assert.ok(resolver.indexOf("Load-SecureMcpRuntimeKey") < resolver.indexOf("Runtime API key missing"));
  assert.match(resolver, /SET_Secure_MCP_Runtime_API_Key\.bat/u);
});

test("setter securely seeds shared store; ciphertext writes are atomic and user-bound", () => {
  const setter = source("SetSecureMcpRuntimeKey.ps1");
  assert.match(setter, /Join-Path \$PSScriptRoot 'SecureMcpRuntimeKey\.ps1'/u);
  assert.equal((setter.match(/Read-Host/gu) ?? []).length, 1);
  assert.match(setter, /Read-Host[^\r\n]*-AsSecureString/u);
  assert.match(setter, /Save-SecureMcpRuntimeKey -Secret \$secure -SecretPath \$SecretPath/u);
  assert.match(source("SET_Secure_MCP_Runtime_API_Key.bat"), /-IfMissing/u);
  assert.doesNotMatch(source("SET_Secure_MCP_Runtime_API_Key.bat"), /set \/p|%\*/iu);
  assert.match(helper, /ProtectedData\]::Protect/u);
  assert.match(helper, /ProtectedData\]::Unprotect/u);
  assert.equal((helper.match(/DataProtectionScope\]::CurrentUser/gu) ?? []).length, 2);
  assert.doesNotMatch(helper, /LocalMachine|ConvertFrom-SecureString|Read-Host/u);
  assert.match(helper, /WriteAllBytes\(\$temporary, \$encrypted\)/u);
  assert.match(helper, /File\]::Replace\(\$temporary, \$SecretPath, \[NullString\]::Value\)/u);
  assert.match(helper, /File\]::Move\(\$temporary, \$SecretPath\)/u);
  assert.match(helper, /Array\]::Clear/u);
  assert.match(helper, /ZeroFreeBSTR/u);
  assert.match(helper, /S-1-5-18/u);
  assert.match(helper, /S-1-5-32-544/u);
});

test("documentation and setup preserve env-only profiles and Blue-only recovery", () => {
  const setup = source("SetupSecureMcpBridge.ps1");
  assert.match(setup, /runtime_api_key_persistence = "Windows DPAPI CurrentUser encrypted-at-rest"/u);
  assert.match(setup, /api_key: "env:CONTROL_PLANE_API_KEY"/u);
  const readme = source("README.md");
  assert.match(readme, /unattended recovery remains Blue-only/u);
  assert.match(readme, /total stop\/start\/restart no longer prompts after one-time setup/u);
  assert.match(readme, /SET_Secure_MCP_Runtime_API_Key\.bat/u);
});

test("Windows DPAPI roundtrip and env precedence never emit the in-process dummy", { skip: process.platform !== "win32" }, () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(process.cwd(), "tests/unit/secure-mcp-runtime-key.functional.ps1")], {
    encoding: "utf8", timeout: 30000,
  });
  // Do not include subprocess output in assertion diagnostics.
  assert.equal(result.status, 0, "Isolated DPAPI functional checks must pass");
  assert.ok(result.stdout.trim() === "SECURE_MCP_DPAPI_TEST_PASS", "Only bounded success output is allowed");
  assert.ok(result.stderr.trim() === "", "No error output is allowed");
});
