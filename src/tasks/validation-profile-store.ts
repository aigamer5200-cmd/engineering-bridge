import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { CoreError } from "../core/errors.js";

export interface ValidationStep {
  readonly name: string;
  readonly argv: readonly [string, ...string[]];
  readonly timeoutSeconds?: number;
}

export interface ValidationProfile {
  readonly preparation: readonly ValidationStep[];
  readonly validation: readonly ValidationStep[];
  readonly defaultStepTimeoutSeconds: number;
  readonly totalTimeoutSeconds: number;
}

interface PersistedStep {
  name: string;
  argv: string[];
  timeout_seconds?: number;
}

interface PersistedProfile {
  workspace_id: string;
  preparation: PersistedStep[];
  validation: PersistedStep[];
  default_step_timeout_seconds: number;
  total_timeout_seconds: number;
}

interface PersistedEnvelope {
  version: 1;
  profiles: PersistedProfile[];
}

type PlainObject = Record<string, unknown>;

const VERSION = 1;
const DEFAULT_STATE_FILE_PATH = join(
  homedir(),
  ".engineering-bridge",
  "validation-profiles.json",
);

export class ValidationProfileStore {
  readonly #stateFilePath: string;
  #profiles = new Map<string, ValidationProfile>();
  #loaded = false;
  #operations: Promise<void> = Promise.resolve();
  #nextTemporaryId = 0;

  constructor(stateFilePath: string = DEFAULT_STATE_FILE_PATH) {
    this.#stateFilePath = stateFilePath;
  }

  get(workspaceId: string): Promise<ValidationProfile | undefined> {
    return this.#enqueue(async () => {
      await this.#ensureLoaded();
      const profile = this.#profiles.get(workspaceId);
      return profile === undefined ? undefined : cloneProfile(profile);
    });
  }

  configure(
    workspaceId: string,
    profile: ValidationProfile,
  ): Promise<ValidationProfile> {
    return this.#enqueue(async () => {
      await this.#ensureLoaded();
      const nextProfile = parseProfile(profile);
      if (workspaceId.length === 0 || nextProfile === undefined) {
        throw new CoreError("INTERNAL_ERROR");
      }

      const previousProfiles = this.#profiles;
      this.#profiles = new Map(previousProfiles);
      this.#profiles.set(workspaceId, nextProfile);

      try {
        await this.#persist();
      } catch {
        this.#profiles = previousProfiles;
        throw new CoreError("INTERNAL_ERROR");
      }

      return cloneProfile(nextProfile);
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(operation, operation);
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) {
      await this.#load();
    }
  }

  async #load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.#stateFilePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.#profiles = new Map();
        this.#loaded = true;
        return;
      }
      throw new CoreError("INTERNAL_ERROR");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CoreError("INTERNAL_ERROR");
    }

    if (!isEnvelope(parsed)) {
      throw new CoreError("INTERNAL_ERROR");
    }

    const profiles = new Map<string, ValidationProfile>();
    for (const record of parsed.profiles) {
      const parsedRecord = parsePersistedProfile(record);
      if (parsedRecord !== undefined) {
        profiles.set(parsedRecord.workspaceId, parsedRecord.profile);
      }
    }

    this.#profiles = profiles;
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    const envelope: PersistedEnvelope = {
      version: VERSION,
      profiles: [...this.#profiles].map(([workspaceId, profile]) => ({
        workspace_id: workspaceId,
        preparation: profile.preparation.map(toPersistedStep),
        validation: profile.validation.map(toPersistedStep),
        default_step_timeout_seconds: profile.defaultStepTimeoutSeconds,
        total_timeout_seconds: profile.totalTimeoutSeconds,
      })),
    };
    const parent = dirname(this.#stateFilePath);
    const temporaryPath = join(
      parent,
      `.${basename(this.#stateFilePath)}.${process.pid}.${this.#nextTemporaryId++}.tmp`,
    );

    await mkdir(parent, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(envelope)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.#stateFilePath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (!isNodeError(cleanupError) || cleanupError.code !== "ENOENT") {
          void cleanupError;
        }
      }
      throw error;
    }
  }
}

function isEnvelope(value: unknown): value is {
  version: 1;
  profiles: unknown[];
} {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["version", "profiles"]) &&
    value.version === VERSION &&
    Array.isArray(value.profiles)
  );
}

function parsePersistedProfile(
  value: unknown,
): { workspaceId: string; profile: ValidationProfile } | undefined {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "workspace_id",
      "preparation",
      "validation",
      "default_step_timeout_seconds",
      "total_timeout_seconds",
    ]) ||
    typeof value.workspace_id !== "string" ||
    value.workspace_id.length === 0
  ) {
    return undefined;
  }

  const profile = parsePersistedProfileValue(value);
  return profile === undefined
    ? undefined
    : { workspaceId: value.workspace_id, profile };
}

function parsePersistedProfileValue(
  value: PlainObject,
): ValidationProfile | undefined {
  if (
    !Array.isArray(value.preparation) ||
    !Array.isArray(value.validation) ||
    !isPositiveInteger(value.default_step_timeout_seconds) ||
    !isPositiveInteger(value.total_timeout_seconds)
  ) {
    return undefined;
  }

  const preparation = parseSteps(value.preparation, parsePersistedStep);
  const validation = parseSteps(value.validation, parsePersistedStep);
  if (preparation === undefined || validation === undefined) {
    return undefined;
  }

  return freezeProfile(
    preparation,
    validation,
    value.default_step_timeout_seconds,
    value.total_timeout_seconds,
  );
}

function parseProfile(value: unknown): ValidationProfile | undefined {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "preparation",
      "validation",
      "defaultStepTimeoutSeconds",
      "totalTimeoutSeconds",
    ]) ||
    !Array.isArray(value.preparation) ||
    !Array.isArray(value.validation) ||
    !isPositiveInteger(value.defaultStepTimeoutSeconds) ||
    !isPositiveInteger(value.totalTimeoutSeconds)
  ) {
    return undefined;
  }

  const preparation = parseSteps(value.preparation, parseStep);
  const validation = parseSteps(value.validation, parseStep);
  if (preparation === undefined || validation === undefined) {
    return undefined;
  }

  return freezeProfile(
    preparation,
    validation,
    value.defaultStepTimeoutSeconds,
    value.totalTimeoutSeconds,
  );
}

function parseSteps(
  values: readonly unknown[],
  parser: (value: unknown) => ValidationStep | undefined,
): readonly ValidationStep[] | undefined {
  const steps: ValidationStep[] = [];
  for (const value of values) {
    const step = parser(value);
    if (step === undefined) {
      return undefined;
    }
    steps.push(step);
  }
  return Object.freeze(steps);
}

function parseStep(value: unknown): ValidationStep | undefined {
  return parseStepWithTimeoutKey(value, "timeoutSeconds");
}

function parsePersistedStep(value: unknown): ValidationStep | undefined {
  return parseStepWithTimeoutKey(value, "timeout_seconds");
}

function parseStepWithTimeoutKey(
  value: unknown,
  timeoutKey: "timeoutSeconds" | "timeout_seconds",
): ValidationStep | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const timeout = value[timeoutKey];
  if (
    !hasExactKeys(
      value,
      timeout === undefined ? ["name", "argv"] : ["name", "argv", timeoutKey],
    ) ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    !Array.isArray(value.argv) ||
    value.argv.length === 0 ||
    !value.argv.every((argument) => typeof argument === "string") ||
    (timeout !== undefined && !isPositiveInteger(timeout))
  ) {
    return undefined;
  }

  return Object.freeze({
    name: value.name,
    argv: Object.freeze([...value.argv]) as readonly [string, ...string[]],
    ...(timeout === undefined ? {} : { timeoutSeconds: timeout }),
  });
}

function freezeProfile(
  preparation: readonly ValidationStep[],
  validation: readonly ValidationStep[],
  defaultStepTimeoutSeconds: number,
  totalTimeoutSeconds: number,
): ValidationProfile {
  return Object.freeze({
    preparation: Object.freeze([...preparation]),
    validation: Object.freeze([...validation]),
    defaultStepTimeoutSeconds,
    totalTimeoutSeconds,
  });
}

function cloneProfile(profile: ValidationProfile): ValidationProfile {
  return freezeProfile(
    profile.preparation.map(cloneStep),
    profile.validation.map(cloneStep),
    profile.defaultStepTimeoutSeconds,
    profile.totalTimeoutSeconds,
  );
}

function cloneStep(step: ValidationStep): ValidationStep {
  return Object.freeze({
    name: step.name,
    argv: Object.freeze([...step.argv]) as readonly [string, ...string[]],
    ...(step.timeoutSeconds === undefined
      ? {}
      : { timeoutSeconds: step.timeoutSeconds }),
  });
}

function toPersistedStep(step: ValidationStep): PersistedStep {
  return {
    name: step.name,
    argv: [...step.argv],
    ...(step.timeoutSeconds === undefined
      ? {}
      : { timeout_seconds: step.timeoutSeconds }),
  };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isPlainObject(value: unknown): value is PlainObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: PlainObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
