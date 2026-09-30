#!/usr/bin/env node

import {
  defaultStorageRoot,
  ensureFreshProfile,
  loadProfile,
  loginProfile,
  publicProfile,
  refreshProfile
} from "./siwc-runtime.mjs";

function usage() {
  return "Usage: node ops/siwc/siwc-cli.mjs <login|status|refresh> --profile <label>";
}

function parseArgs(argv) {
  const command = argv[0];
  let profile;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--profile") {
      profile = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(usage());
  }
  if (!["login", "status", "refresh"].includes(command) || !profile) throw new Error(usage());
  return { command, profile };
}

async function main() {
  const { command, profile } = parseArgs(process.argv.slice(2));
  const storageRoot = defaultStorageRoot();
  let result;
  if (command === "login") {
    result = await loginProfile(profile, { storageRoot });
  } else if (command === "refresh") {
    const refreshed = await refreshProfile(profile, { storageRoot });
    result = publicProfile(refreshed, profile);
  } else {
    const saved = await loadProfile(profile, storageRoot);
    if (!saved) throw new Error("SIWC profile is not connected.");
    const current = await ensureFreshProfile(profile, { storageRoot });
    result = publicProfile(current, profile);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "SIWC operation failed."}\n`);
  process.exitCode = 1;
});

