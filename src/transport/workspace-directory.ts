import { realpathSync } from "node:fs";
import { lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, sep } from "node:path";

import { isId, newId } from "../core/ids.js";

export interface WorkspaceEntry {
  readonly id: string;
  readonly root: string;
}

export interface BoundWorkspace {
  readonly workspace_id: string;
  readonly root: string;
}

type Registration = {
  readonly id: string;
  readonly root: string;
  readonly canonicalRoot: string;
};

const STATE_VERSION = 1;

export class WorkspaceDirectory {
  private readonly registrations = new Map<string, Registration>();
  private readonly canonicalRoots = new Map<string, string>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  constructor(
    entries: readonly WorkspaceEntry[],
    private readonly projectRoots: readonly string[],
    private readonly stateFilePath: string
  ) {
    for (const entry of entries) {
      if (typeof entry.id !== "string" || entry.id.length === 0 ||
          typeof entry.root !== "string" || entry.root.length === 0 ||
          !isAbsolute(entry.root) || normalize(entry.root) !== entry.root ||
          this.registrations.has(entry.id)) {
        throw new Error("Workspace configuration is invalid.");
      }
      this.add(entry.id, entry.root);
    }
  }

  async load(): Promise<void> {
    let source: string;
    try {
      source = await readFile(this.stateFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("Workspace registrations could not be loaded.");
    }

    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error("Workspace registrations could not be loaded.");
    }
    if (!isObject(value) || value.version !== STATE_VERSION || !Array.isArray(value.workspaces)) {
      throw new Error("Workspace registrations could not be loaded.");
    }

    for (const item of value.workspaces) {
      if (!isObject(item)) continue;
      const { id, root } = item;
      if (typeof id !== "string" || !isId(id) || typeof root !== "string" || root.length === 0 ||
          !isAbsolute(root) || normalize(root) !== root || this.registrations.has(id)) {
        continue;
      }
      if (this.canonicalRoots.has(bestEffortCanonicalRoot(root))) continue;
      this.add(id, root);
    }
  }

  resolve(workspaceId: string): string {
    const registration = this.registrations.get(workspaceId);
    if (registration === undefined) throw new Error("Workspace is not bound.");
    return registration.root;
  }

  async bind(projectPath: string): Promise<BoundWorkspace> {
    const canonical = await this.canonicalizeWithinProjectRoots(projectPath);
    let isDirectory = false;
    try {
      isDirectory = (await lstat(canonical)).isDirectory();
    } catch {
      // The path can disappear between canonicalization and this check.
    }
    if (!isDirectory) throw new Error("Project path is not an existing directory.");

    const mutation = this.mutationQueue.then(async (): Promise<BoundWorkspace> => {
      const existingId = this.canonicalRoots.get(canonical);
      if (existingId !== undefined) {
        const existing = this.registrations.get(existingId);
        if (existing !== undefined) return { workspace_id: existing.id, root: existing.root };
      }

      const id = newId();
      this.add(id, canonical);
      try {
        await this.persist();
      } catch {
        this.registrations.delete(id);
        this.canonicalRoots.delete(canonical);
        throw new Error("Workspace registration could not be saved.");
      }
      return { workspace_id: id, root: canonical };
    });
    this.mutationQueue = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  private add(id: string, root: string): void {
    const canonicalRoot = bestEffortCanonicalRoot(root);
    this.registrations.set(id, { id, root, canonicalRoot });
    if (!this.canonicalRoots.has(canonicalRoot)) this.canonicalRoots.set(canonicalRoot, id);
  }

  private async canonicalizeWithinProjectRoots(path: string): Promise<string> {
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      throw new Error("Project path could not be resolved.");
    }

    for (const root of this.projectRoots) {
      let canonicalRoot: string;
      try {
        canonicalRoot = await realpath(root);
      } catch {
        continue;
      }
      const relativePath = relative(canonicalRoot, canonical);
      if (relativePath === "" ||
          (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))) {
        return canonical;
      }
    }
    throw new Error("Project path is outside the configured project roots.");
  }

  private async persist(): Promise<void> {
    const contents = `${JSON.stringify({
      version: STATE_VERSION,
      workspaces: [...this.registrations.values()]
        .filter(({ id }) => isId(id))
        .map(({ id, root }) => ({ id, root }))
    }, null, 2)}\n`;
    const temporaryPath = `${this.stateFilePath}.${process.pid}.${Date.now()}.${this.writeSequence++}.tmp`;
    try {
      await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.stateFilePath);
    } catch {
      await unlink(temporaryPath).catch((): void => {});
      throw new Error("Workspace registration could not be saved.");
    }
  }
}

function bestEffortCanonicalRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
