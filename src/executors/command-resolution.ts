import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

// Minimal shared Windows command-resolution logic for the executors.
//
// On non-Windows platforms resolveCommand always yields `bare`, so the
// existing POSIX launch paths are byte-for-byte unchanged. On Windows it
// resolves a bare command name (for example `codex` or `dsh`) against the
// host PATH with Windows command semantics:
//
//  1. PATH is looked up case-insensitively (the environment may spell it
//     PATH, Path or path).
//  2. Only absolute PATH entries are searched; relative entries are skipped.
//  3. PATHEXT is used for discovery only: entries are split on ";", trimmed,
//     normalized to uppercase with a leading dot, and ordered exactly as the
//     host provided them (".COM;.EXE;.BAT;.CMD" is the default when absent).
//  4. Default priority: a directly spawnable real executable (.COM/.EXE)
//     anywhere on PATH wins over any .BAT/.CMD shim; within one class the
//     first PATH entry and PATHEXT order decide. Callers may explicitly prefer
//     a valid global-layout npm Node shim before real executables when they
//     need a stable package-managed provider (Codex uses this on Windows).
//  5. A .BAT/.CMD npm shim is never launched through a shell: its real Node
//     target is derived from the shim's location via nodeTarget (npm global
//     and local node_modules/.bin layouts) and launched with process.execPath.
//     When the target cannot be derived, resolution fails closed as `bare`
//     and the caller keeps its existing shell-free fallback.
//
// This module performs discovery only: it never builds or runs shell command
// text, and nothing here ever goes through cmd.exe, ComSpec or shell:true.

export type ResolvedCommand =
  | { readonly kind: "direct"; readonly executable: string }
  | { readonly kind: "node-launcher"; readonly scriptPath: string }
  | { readonly kind: "bare" };

export interface ResolveCommandOptions {
  // npm package target derived from a .cmd/.bat shim location, for example
  // ["@openai", "codex", "bin", "codex.js"] or
  // ["@deepseek-ai", "dsh", "lib", "bin.js"]. Tried as
  // <shimDir>\node_modules\<target> (global npm layout) and
  // <shimDir>\..\<target> (local node_modules/.bin layout).
  readonly nodeTarget?: readonly string[];
  // When true, a valid global npm shim (<shimDir>\node_modules\<target>) is
  // selected before any direct .COM/.EXE found on PATH. Local
  // node_modules/.bin shims do not receive this priority and the default
  // direct-executable-first behavior remains unchanged for other callers.
  readonly preferGlobalNodeShim?: boolean;
  // Injectable for tests; defaults to the running platform.
  readonly platform?: NodeJS.Platform;
}

const WINDOWS_PATH_DELIMITER = ";";
const DEFAULT_WINDOWS_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];
const REAL_EXECUTABLE_EXTS = new Set([".COM", ".EXE"]);
const SHIM_EXTS = new Set([".BAT", ".CMD"]);

export function resolveCommand(
  host: Readonly<NodeJS.ProcessEnv>,
  command: string,
  options: ResolveCommandOptions = {}
): ResolvedCommand {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { kind: "bare" };
  if (!/^[A-Za-z0-9._-]+$/u.test(command)) return { kind: "bare" };

  if (options.preferGlobalNodeShim === true && options.nodeTarget !== undefined) {
    const globalNodeTarget = findNodeShimTargetInPath(host, command, options.nodeTarget, true);
    if (globalNodeTarget !== undefined) {
      return { kind: "node-launcher", scriptPath: globalNodeTarget };
    }
  }

  // Real executables first, across the whole PATH.
  const direct = findInPath(host, command, (ext) => REAL_EXECUTABLE_EXTS.has(ext));
  if (direct !== undefined) return { kind: "direct", executable: direct };

  // Then .cmd/.bat shims, across the whole PATH. A shim is only usable when
  // its real Node target can be derived; without nodeTarget (or when the
  // target is missing) there is no shell-free way to launch it, so resolution
  // fails closed as bare.
  if (options.nodeTarget === undefined) return { kind: "bare" };
  const scriptPath = findNodeShimTargetInPath(host, command, options.nodeTarget, false);
  return scriptPath === undefined ? { kind: "bare" } : { kind: "node-launcher", scriptPath };
}

function findNodeShimTargetInPath(
  host: Readonly<NodeJS.ProcessEnv>,
  command: string,
  nodeTarget: readonly string[],
  globalOnly: boolean
): string | undefined {
  const pathValue = envValue(host, "PATH");
  if (pathValue === undefined) return undefined;
  const extensions = pathExtensions(host);
  for (const entry of pathValue.split(WINDOWS_PATH_DELIMITER)) {
    if (!isAbsolute(entry)) continue;
    for (const extension of extensions) {
      if (!SHIM_EXTS.has(extension)) continue;
      const shim = findCaseInsensitive(entry, `${command}${extension}`);
      if (shim === undefined || !isFile(shim)) continue;
      const scriptPath = globalOnly
        ? npmGlobalShimTarget(shim, nodeTarget)
        : npmShimTarget(shim, nodeTarget);
      if (scriptPath !== undefined) return scriptPath;
    }
  }
  return undefined;
}

function findInPath(
  host: Readonly<NodeJS.ProcessEnv>,
  command: string,
  allowed: (extension: string) => boolean
): string | undefined {
  const pathValue = envValue(host, "PATH");
  if (pathValue === undefined) return undefined;
  const extensions = pathExtensions(host);
  for (const entry of pathValue.split(WINDOWS_PATH_DELIMITER)) {
    if (!isAbsolute(entry)) continue;
    for (const extension of extensions) {
      if (!allowed(extension)) continue;
      // Windows filesystem lookup is case-insensitive; the directory scan
      // mirrors that and returns the on-disk casing.
      const candidate = findCaseInsensitive(entry, `${command}${extension}`);
      if (candidate !== undefined && isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function findCaseInsensitive(directory: string, name: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return undefined;
  }
  const wanted = name.toLowerCase();
  const hit = entries.find((entry) => entry.toLowerCase() === wanted);
  return hit === undefined ? undefined : join(directory, hit);
}

function pathExtensions(host: Readonly<NodeJS.ProcessEnv>): string[] {
  const raw = envValue(host, "PATHEXT");
  const entries = (raw ?? DEFAULT_WINDOWS_PATHEXT.join(WINDOWS_PATH_DELIMITER))
    .split(WINDOWS_PATH_DELIMITER)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry !== "");
  if (entries.length === 0) return DEFAULT_WINDOWS_PATHEXT;
  return entries.map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function npmShimTarget(shimPath: string, nodeTarget: readonly string[]): string | undefined {
  const shimDir = dirname(shimPath);
  for (const candidate of [
    join(shimDir, "node_modules", ...nodeTarget),
    join(shimDir, "..", ...nodeTarget)
  ]) {
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function npmGlobalShimTarget(shimPath: string, nodeTarget: readonly string[]): string | undefined {
  const candidate = join(dirname(shimPath), "node_modules", ...nodeTarget);
  return isFile(candidate) ? candidate : undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function envValue(host: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const needle = key.toLowerCase();
  for (const name of Object.keys(host)) {
    if (name.toLowerCase() !== needle) continue;
    const value = host[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  }
  return undefined;
}
