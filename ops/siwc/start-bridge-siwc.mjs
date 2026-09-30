#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCandidateEnvironment,
  defaultStorageRoot,
  ensureFreshProfile,
  prepareCandidateCodexHome
} from "./siwc-runtime.mjs";

function usage() {
  return "Usage: node ops/siwc/start-bridge-siwc.mjs --profile <label> --config <absolute-workspaces.json>";
}

function parseArgs(argv) {
  let profile;
  let config;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--profile") {
      profile = argv[index + 1];
      index += 1;
    } else if (key === "--config") {
      config = argv[index + 1];
      index += 1;
    } else {
      throw new Error(usage());
    }
  }
  if (!profile || !config) throw new Error(usage());
  return { profile, config: resolve(config) };
}

async function main() {
  const { profile, config } = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const bridgeEntry = resolve(repoRoot, "dist", "src", "mcp-stdio.js");
  await access(bridgeEntry);
  await access(config);

  const storageRoot = defaultStorageRoot();
  const credentials = await ensureFreshProfile(profile, { storageRoot });
  const codexHome = await prepareCandidateCodexHome(profile, storageRoot);
  const env = buildCandidateEnvironment(process.env, credentials, codexHome);

  const child = spawn(process.execPath, [bridgeEntry, config], {
    cwd: repoRoot,
    env,
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      resolveCode(signal ? 1 : (exitCode ?? 1));
    });
  });
  process.exitCode = code;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "SIWC candidate Bridge failed to start."}\n`);
  process.exitCode = 1;
});

