export const ERROR_CODES = [
  "INTERNAL_ERROR",
  "INVALID_STATE_TRANSITION",
  "UNKNOWN_WORKSPACE",
  "WORKSPACE_BOUNDARY_VIOLATION",
  "WORKSPACE_PRECONDITION_FAILED",
  "APPLY_RECOVERY_CONFLICT",
  "CODEX_UNAVAILABLE",
  "CODEX_ACCOUNT_UNAVAILABLE",
  "CODEX_ACCOUNT_QUOTA_EXHAUSTED",
  "ACCOUNT_5H_QUOTA_EXHAUSTED",
  "ACCOUNT_WEEKLY_QUOTA_EXHAUSTED",
  "ACCOUNT_AUTH_INVALID",
  "ACCOUNT_PROFILE_UNAVAILABLE",
  "MODEL_CAPACITY",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TRANSIENT",
  "PROCESS_SPAWN_FAILURE",
  "NETWORK_RPC_FAILURE",
  "BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED",
  "FAILOVER_REVIEW_REQUIRED",
  "UNKNOWN_EXECUTOR_FAILURE",
  "CODEX_PROTOCOL_ERROR",
  "CODEX_EXECUTION_FAILED",
  "EXECUTOR_STALLED",
  "DSH_UNAVAILABLE",
  "DSH_PROTOCOL_ERROR",
  "DSH_EXECUTION_FAILED",
  "TASK_INTERRUPTED",
  "UNSUPPORTED_ACTION"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
}

const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INTERNAL_ERROR: "The request could not be completed.",
  INVALID_STATE_TRANSITION: "The requested state transition is not allowed.",
  UNKNOWN_WORKSPACE: "The requested workspace is not registered.",
  WORKSPACE_BOUNDARY_VIOLATION: "The workspace boundary could not be verified.",
  WORKSPACE_PRECONDITION_FAILED: "The workspace preconditions were not met.",
  APPLY_RECOVERY_CONFLICT: "The applied patch state could not be recovered safely.",
  CODEX_UNAVAILABLE: "Codex is unavailable.",
  CODEX_ACCOUNT_UNAVAILABLE: "The requested Codex account/profile is unavailable.",
  CODEX_ACCOUNT_QUOTA_EXHAUSTED: "The requested Codex account has exhausted its current usage window.",
  ACCOUNT_5H_QUOTA_EXHAUSTED: "The requested Codex account has exhausted its five-hour usage window.",
  ACCOUNT_WEEKLY_QUOTA_EXHAUSTED: "The requested Codex account has exhausted its weekly usage window.",
  ACCOUNT_AUTH_INVALID: "The requested Codex account authentication is invalid.",
  ACCOUNT_PROFILE_UNAVAILABLE: "The requested Codex account profile is unavailable.",
  MODEL_CAPACITY: "The selected Codex model is at capacity.",
  PROVIDER_RATE_LIMIT: "The Codex provider rate limit was reached.",
  PROVIDER_TRANSIENT: "The Codex provider returned a transient failure.",
  PROCESS_SPAWN_FAILURE: "The Codex process could not be started.",
  NETWORK_RPC_FAILURE: "The Codex RPC transport failed.",
  BOTH_CODEX_ACCOUNTS_QUOTA_EXHAUSTED: "Both configured Codex accounts have exhausted their current usage windows.",
  FAILOVER_REVIEW_REQUIRED: "Automatic failover stopped because prior mutation evidence requires supervisor review.",
  UNKNOWN_EXECUTOR_FAILURE: "The executor failed for an unclassified reason.",
  CODEX_PROTOCOL_ERROR: "Codex returned an invalid response.",
  CODEX_EXECUTION_FAILED: "Codex execution failed.",
  EXECUTOR_STALLED: "The executor stopped producing protocol activity.",
  DSH_UNAVAILABLE: "DSH is unavailable.",
  DSH_PROTOCOL_ERROR: "DSH returned an invalid response.",
  DSH_EXECUTION_FAILED: "DSH execution failed.",
  TASK_INTERRUPTED: "The task was interrupted.",
  UNSUPPORTED_ACTION: "The requested action is not supported."
};

function isErrorCode(value: unknown): value is ErrorCode {
  return ERROR_CODES.some((code) => code === value);
}

export class CoreError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CoreError";
  }
}

export function serializeError(error: unknown): SerializedError {
  const code = error instanceof CoreError && isErrorCode(error.code)
    ? error.code
    : "INTERNAL_ERROR";
  return {
    code,
    message: ERROR_MESSAGES[code]
  };
}
