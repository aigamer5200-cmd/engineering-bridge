import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  resolveCommand
} from "../../../src/executors/command-resolution.js";
import type { ResolveCommandOptions } from "../../../src/executors/command-resolution.js";

const CODEX_NODE_TARGET = ["@openai", "codex", "bin", "codex.js"];
const DSH_NODE_TARGET = ["@deepseek-ai", "dsh", "lib", "bin.js"];

function directory(): string {
  return mkdtempSync(join(tmpdir(), "bridge-win-resolve-"));
}

function touch(...segments: string[]): string {
  const path = join(...segments);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  return path;
}

function resolve(host: Record<string, string>, command: string, options: ResolveCommandOptions = {}) {
  return resolveCommand(host, command, { platform: "win32", ...options });
}

test("non-Windows platforms always resolve to the bare command (POSIX unchanged)", () => {
  const dir = directory();
  touch(dir, "codex.exe");
  const result = resolveCommand({ PATH: dir }, "codex", { platform: "darwin" });
  assert.deepEqual(result, { kind: "bare" });
  const linux = resolveCommand({ PATH: dir }, "codex", { platform: "linux" });
  assert.deepEqual(linux, { kind: "bare" });
});

test("a real .exe on PATH resolves as a direct executable", () => {
  const dir = directory();
  const exe = touch(dir, "codex.exe");
  const result = resolve({ PATH: dir }, "codex");
  assert.deepEqual(result, { kind: "direct", executable: exe });
});

test("a real .com on PATH resolves as a direct executable", () => {
  const dir = directory();
  const com = touch(dir, "dsh.com");
  const result = resolve({ PATH: dir }, "dsh");
  assert.deepEqual(result, { kind: "direct", executable: com });
});

test("a real executable is preferred over a .cmd shim anywhere on PATH", () => {
  const shimDir = directory();
  const exeDir = directory();
  touch(shimDir, "codex.cmd");
  const exe = touch(exeDir, "codex.exe");
  const result = resolve({ PATH: `${shimDir};${exeDir}` }, "codex", { nodeTarget: CODEX_NODE_TARGET });
  assert.deepEqual(result, { kind: "direct", executable: exe });
  const reversed = resolve({ PATH: `${exeDir};${shimDir}` }, "codex", { nodeTarget: CODEX_NODE_TARGET });
  assert.deepEqual(reversed, { kind: "direct", executable: exe });
});

test("preferGlobalNodeShim selects a valid global npm shim before a real executable", () => {
  const globalShimDir = directory();
  const exeDir = directory();
  touch(globalShimDir, "codex.cmd");
  const binJs = touch(globalShimDir, "node_modules", "@openai", "codex", "bin", "codex.js");
  touch(exeDir, "codex.exe");
  const options = { nodeTarget: CODEX_NODE_TARGET, preferGlobalNodeShim: true } as const;

  assert.deepEqual(resolve({ PATH: `${exeDir};${globalShimDir}` }, "codex", options), {
    kind: "node-launcher", scriptPath: binJs
  });
  assert.deepEqual(resolve({ PATH: `${globalShimDir};${exeDir}` }, "codex", options), {
    kind: "node-launcher", scriptPath: binJs
  });
});

test("preferGlobalNodeShim falls back to a real executable when the global npm package is incomplete", () => {
  const shimDir = directory();
  const exeDir = directory();
  touch(shimDir, "codex.cmd");
  const exe = touch(exeDir, "codex.exe");

  assert.deepEqual(resolve({ PATH: `${shimDir};${exeDir}` }, "codex", {
    nodeTarget: CODEX_NODE_TARGET,
    preferGlobalNodeShim: true
  }), { kind: "direct", executable: exe });
});

test("preferGlobalNodeShim skips an incomplete earlier shim and finds a later valid global npm package", () => {
  const brokenShimDir = directory();
  const bundledExeDir = directory();
  const validGlobalDir = directory();
  touch(brokenShimDir, "codex.cmd");
  touch(bundledExeDir, "codex.exe");
  touch(validGlobalDir, "codex.cmd");
  const binJs = touch(validGlobalDir, "node_modules", "@openai", "codex", "bin", "codex.js");

  assert.deepEqual(resolve({
    PATH: `${brokenShimDir};${bundledExeDir};${validGlobalDir}`
  }, "codex", {
    nodeTarget: CODEX_NODE_TARGET,
    preferGlobalNodeShim: true
  }), { kind: "node-launcher", scriptPath: binJs });
});

test("preferGlobalNodeShim does not promote a local node_modules/.bin shim over a real executable", () => {
  const root = directory();
  const localBinDir = join(root, "node_modules", ".bin");
  mkdirSync(localBinDir, { recursive: true });
  touch(localBinDir, "codex.cmd");
  touch(root, "node_modules", "@openai", "codex", "bin", "codex.js");
  const exeDir = directory();
  const exe = touch(exeDir, "codex.exe");

  assert.deepEqual(resolve({ PATH: `${localBinDir};${exeDir}` }, "codex", {
    nodeTarget: CODEX_NODE_TARGET,
    preferGlobalNodeShim: true
  }), { kind: "direct", executable: exe });
});

test("an npm codex.cmd shim with a derivable global-layout target becomes a node launcher", () => {
  const dir = directory();
  touch(dir, "codex.cmd");
  const binJs = touch(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
  const result = resolve({ PATH: dir }, "codex", { nodeTarget: CODEX_NODE_TARGET });
  assert.deepEqual(result, { kind: "node-launcher", scriptPath: binJs });
});

test("an npm codex.cmd shim with a derivable local node_modules/.bin layout becomes a node launcher", () => {
  const dir = join(directory(), "node_modules", ".bin");
  mkdirSync(dir, { recursive: true });
  touch(dir, "codex.cmd");
  const binJs = touch(dir, "..", "@openai", "codex", "bin", "codex.js");
  const result = resolve({ PATH: dir }, "codex", { nodeTarget: CODEX_NODE_TARGET });
  assert.deepEqual(result, { kind: "node-launcher", scriptPath: binJs });
});

test("a .bat shim with a derivable target also becomes a node launcher", () => {
  const dir = directory();
  touch(dir, "codex.bat");
  const binJs = touch(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
  const result = resolve({ PATH: dir }, "codex", { nodeTarget: CODEX_NODE_TARGET });
  assert.deepEqual(result, { kind: "node-launcher", scriptPath: binJs });
});

test("an npm dsh.cmd shim with a derivable global-layout target becomes a node launcher", () => {
  const dir = directory();
  touch(dir, "dsh.cmd");
  const binJs = touch(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const result = resolve({ PATH: dir }, "dsh", { nodeTarget: DSH_NODE_TARGET });
  assert.deepEqual(result, { kind: "node-launcher", scriptPath: binJs });
});

test("a shim without a derivable target fails closed as bare for both codex and dsh", () => {
  const codexDir = directory();
  touch(codexDir, "codex.cmd");
  assert.deepEqual(resolve({ PATH: codexDir }, "codex", { nodeTarget: CODEX_NODE_TARGET }), { kind: "bare" });
  const dshDir = directory();
  touch(dshDir, "dsh.cmd");
  assert.deepEqual(resolve({ PATH: dshDir }, "dsh", { nodeTarget: DSH_NODE_TARGET }), { kind: "bare" });
  // Without any nodeTarget a shim is never resolvable: no shell-free launch
  // path exists, so it fails closed as bare.
  assert.deepEqual(resolve({ PATH: codexDir }, "codex"), { kind: "bare" });
});

test("a missing command or empty PATH resolves as bare", () => {
  const dir = directory();
  assert.deepEqual(resolve({ PATH: dir }, "missing"), { kind: "bare" });
  assert.deepEqual(resolve({ PATH: "" }, "codex"), { kind: "bare" });
  assert.deepEqual(resolve({}, "codex"), { kind: "bare" });
});

test("PATH key lookup is case-insensitive (Path / paTh)", () => {
  const dir = directory();
  const exe = touch(dir, "codex.exe");
  assert.deepEqual(resolve({ Path: dir }, "codex"), { kind: "direct", executable: exe });
  assert.deepEqual(resolve({ paTh: dir }, "codex"), { kind: "direct", executable: exe });
});

test("relative PATH entries are skipped", () => {
  const dir = directory();
  touch(dir, "codex.exe");
  const result = resolve({ PATH: `relative-dir;${dir}` }, "codex");
  assert.deepEqual(result, { kind: "direct", executable: join(dir, "codex.exe") });
  assert.deepEqual(resolve({ PATH: "relative-dir" }, "codex"), { kind: "bare" });
});

test("PATHEXT defaults to .COM;.EXE;.BAT;.CMD when absent or empty", () => {
  const dir = directory();
  const exe = touch(dir, "codex.exe");
  assert.deepEqual(resolve({ PATH: dir }, "codex"), { kind: "direct", executable: exe });
  const shimDir = directory();
  touch(shimDir, "dsh.cmd");
  assert.deepEqual(resolve({ PATH: shimDir, PATHEXT: "" }, "dsh", { nodeTarget: DSH_NODE_TARGET }), { kind: "bare" });
});

test("custom PATHEXT order drives discovery inside one class", () => {
  const dir = directory();
  const com = touch(dir, "codex.com");
  const exe = touch(dir, "codex.exe");
  assert.deepEqual(resolve({ PATH: dir, PATHEXT: ".COM;.EXE" }, "codex"), {
    kind: "direct", executable: com
  });
  assert.deepEqual(resolve({ PATH: dir, PATHEXT: ".EXE;.COM" }, "codex"), {
    kind: "direct", executable: exe
  });
});

test("custom PATHEXT without leading dots still finds a shim target", () => {
  const dir = directory();
  touch(dir, "codex.cmd");
  const binJs = touch(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
  assert.deepEqual(resolve({ PATH: dir, PATHEXT: "CMD;EXE" }, "codex", { nodeTarget: CODEX_NODE_TARGET }), {
    kind: "node-launcher", scriptPath: binJs
  });
  // A real executable still wins over a shim even when the shim is first in PATHEXT.
  const exe = touch(dir, "codex.exe");
  assert.deepEqual(resolve({ PATH: dir, PATHEXT: ".CMD;.EXE" }, "codex", { nodeTarget: CODEX_NODE_TARGET }), {
    kind: "direct", executable: exe
  });
});

test("commands with path separators are never searched", () => {
  assert.deepEqual(resolve({ PATH: directory() }, "bin/codex"), { kind: "bare" });
  assert.deepEqual(resolve({ PATH: directory() }, "bin\\codex"), { kind: "bare" });
});
