import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const base = join(process.cwd(), "ops/windows/recovery");
const source = (name: string) => readFileSync(join(base, name), "utf8");
const helper = source("SecureMcpRuntimeKey.ps1");

test("both Green controllers resolve centrally without prompting or saving keys", () => {
  for (const purpose of ["Bridge", "DevSpace"]) {
    const name = `SecureMcp${purpose}.ps1`;
    const controller = source(name);
    assert.doesNotMatch(controller, /Read-Host|Save-SecureMcpRuntimeKey|SecureStringToBSTR/u);
    assert.match(controller, /D:\\Engineering_Bridge_System\\control\\SecureMcpRuntimeKey\.ps1/u);
    assert.ok(controller.includes(`Resolve-SecureMcpRuntimeKey -SecretPath (Get-SecureMcpRuntimeKeyPath -Purpose ${purpose})`));
    assert.doesNotMatch(controller, new RegExp(`-Purpose ${purpose === "Bridge" ? "DevSpace" : "Bridge"}\\b`, "u"));
    assert.match(controller, /api_key: "env:CONTROL_PLANE_API_KEY"/u);
    assert.match(controller, /finally \{\s+\$runtimeKey = \$null/u);
    assert.match(controller, /Remove-Item Env:\\CONTROL_PLANE_API_KEY/u);
    assert.doesNotMatch(controller, /(?:Write-Host|WriteAllText|ArgumentList)[^\r\n]*\$(?:runtimeKey|oldKey)/u);
  }
  const resolver = helper.slice(helper.indexOf("function Resolve-SecureMcpRuntimeKey"));
  assert.ok(resolver.indexOf("GetEnvironmentVariable") < resolver.indexOf("Load-SecureMcpRuntimeKey"));
  assert.ok(resolver.indexOf("Load-SecureMcpRuntimeKey") < resolver.indexOf("Runtime API key missing"));
  assert.match(resolver, /SET_Secure_MCP_Runtime_API_Keys\.bat/u);
});

test("setter securely seeds separate stores; ciphertext writes are atomic and user-bound", () => {
  const setter = source("SetSecureMcpRuntimeKey.ps1");
  assert.match(setter, /Join-Path \$PSScriptRoot 'SecureMcpRuntimeKey\.ps1'/u);
  assert.equal((setter.match(/Read-Host/gu) ?? []).length, 1);
  assert.match(setter, /Read-Host[^\r\n]*-AsSecureString/u);
  assert.match(setter, /Save-SecureMcpRuntimeKey -Secret \$secure -SecretPath \$path/u);
  assert.match(source("SET_Secure_MCP_Runtime_API_Keys.bat"), /-Purpose All -IfMissing/u);
  assert.match(source("SET_Secure_MCP_Runtime_API_Key.bat"), /call "%~dp0SET_Secure_MCP_Runtime_API_Keys\.bat"/u);
  assert.doesNotMatch(setter, /GetEnvironmentVariable|AsPlainText/u);
  assert.match(setter, /@\('DevSpace', 'Bridge'\)/u);
  assert.match(setter, /if \(-not \$Force -and \(Test-Path/u);
  assert.match(setter, /existing encrypted store retained/u);
  assert.match(setter, /Enter \$selected Runtime API Key/u);
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
  assert.match(setup, /runtime_api_key_persistence = "Bridge-specific Windows DPAPI CurrentUser encrypted-at-rest"/u);
  assert.match(setup, /api_key: "env:CONTROL_PLANE_API_KEY"/u);
  const readme = source("README.md");
  assert.match(readme, /unattended recovery remains Blue-only/u);
  assert.match(readme, /total stop\/start\/restart no longer prompts after one-time setup/u);
  assert.match(readme, /SET_Secure_MCP_Runtime_API_Keys\.bat/u);
  for (const doc of [readme, readFileSync("README.md", "utf8"), readFileSync("docs/HANDOFF_SECURE_MCP_SPLIT_DPAPI_KEYS_20261007.md", "utf8")]) {
    assert.match(doc, /[Tt]wo distinct\s+keys and two distinct stores/u);
    assert.match(doc, /secure-mcp-devspace-runtime-api-key\.dpapi/u);
    assert.match(doc, /secure-mcp-bridge-runtime-api-key\.dpapi/u);
  }
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


test("active sources have no ambiguous shared-store path or implicit helper default", () => {
  const obsolete = "secure-mcp-" + "runtime-api-key.dpapi";
  const scan = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(?:ps1|bat|ts|json|ya?ml)$/u.test(entry.name)) {
        assert.ok(!readFileSync(path, "utf8").includes(obsolete), `Ambiguous store reference: ${path}`);
      }
    }
  };
  for (const directory of ["ops", "src", "config", "tests"]) scan(directory);
  assert.match(helper, /ValidateSet\('DevSpace', 'Bridge'\)/u);
  assert.match(helper, /secure-mcp-devspace-runtime-api-key\.dpapi/u);
  assert.match(helper, /secure-mcp-bridge-runtime-api-key\.dpapi/u);
  assert.equal((helper.match(/Parameter\(Mandatory\)\]\[ValidateNotNullOrEmpty\(\)\]\[string\]\$SecretPath/gu) ?? []).length, 4);
  assert.doesNotMatch(helper, /SecretPath =/u);
});
