import {
  createFlowCapabilityError,
  isAppBuildFailureCode,
  type AppBuildFailureCode,
  type FlowCapabilityError,
  type FlowErrorCategory,
} from "../contracts/flow-contracts";

/** Stable machine-readable key used when canonical build owners emit failure codes. */
export const APP_BUILD_FAILURE_CODE_KEY = "APP_BUILD_FAILURE_CODE";

/** Stable machine-readable key used when canonical build owners emit failure messages. */
export const APP_BUILD_FAILURE_MESSAGE_KEY = "APP_BUILD_FAILURE_MESSAGE";

/** Typed build-failure metadata shared across CLI, reports, and server-rendered UI. */
export interface AppBuildFailureMetadata {
  /** Machine-readable failure code. */
  readonly code: AppBuildFailureCode;
  /** Human-readable failure message. */
  readonly message: string;
}

/** Parameters for constructing a typed app-build capability error. */
export interface AppBuildFailureErrorInput {
  /** Stable machine-readable build failure code. */
  readonly code: AppBuildFailureCode;
  /** Command or request field responsible for the failure. */
  readonly command: string;
  /** Human-readable explanation surfaced to operators. */
  readonly reason: string;
  /** Error category propagated through the shared envelope. */
  readonly category?: FlowErrorCategory;
  /** Whether retrying the action is expected to succeed. */
  readonly retryable?: boolean;
  /** Optional correlation id from the caller. */
  readonly correlationId?: string;
  /** Optional resource identifier attached to the failure. */
  readonly resource?: string;
}

function sanitizeMetadataValue(value: string): string {
  return value.replace(/\r?\n/gu, " ").trim();
}

/** Serialize typed build-failure metadata into deterministic key-value lines. */
export function formatAppBuildFailureMetadata(metadata: AppBuildFailureMetadata): string {
  const sanitizedMessage = sanitizeMetadataValue(metadata.message);
  return [
    `${APP_BUILD_FAILURE_CODE_KEY}=${metadata.code}`,
    `${APP_BUILD_FAILURE_MESSAGE_KEY}=${sanitizedMessage}`,
  ].join("\n");
}

/** Append typed app-build failure metadata to stderr/stdout text deterministically. */
export function appendAppBuildFailureMetadata(output: string, metadata: AppBuildFailureMetadata): string {
  const suffix = formatAppBuildFailureMetadata(metadata);
  return output.trim().length > 0 ? `${output}\n${suffix}` : suffix;
}

/** Parse deterministic build-failure metadata from combined stdout/stderr output. */
export function parseAppBuildFailureMetadata(output: string): AppBuildFailureMetadata | null {
  let code: AppBuildFailureCode | null = null;
  let message: string | null = null;

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith(`${APP_BUILD_FAILURE_CODE_KEY}=`)) {
      const value = line.slice(`${APP_BUILD_FAILURE_CODE_KEY}=`.length).trim();
      if (isAppBuildFailureCode(value)) {
        code = value;
      }
      continue;
    }
    if (line.startsWith(`${APP_BUILD_FAILURE_MESSAGE_KEY}=`)) {
      const value = line.slice(`${APP_BUILD_FAILURE_MESSAGE_KEY}=`.length).trim();
      if (value.length > 0) {
        message = value;
      }
    }
  }

  if (!code || !message) {
    return null;
  }

  return {
    code,
    message,
  };
}

/** Create a canonical app-build capability error that preserves the typed failure code. */
export function createAppBuildFailureError(input: AppBuildFailureErrorInput): FlowCapabilityError {
  return createFlowCapabilityError({
    commandIndex: -1,
    command: input.command,
    code: input.code,
    category: input.category ?? "runtime",
    reason: input.reason,
    retryable: input.retryable ?? false,
    surface: "app_build",
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.resource ? { resource: input.resource } : {}),
  });
}
