/** Error namespace for control-plane error classification. */
export const ERROR_CODES = {
  CONFIG_PARSE_ERROR: "CONFIG_PARSE_ERROR",
  UCP_FETCH_ERROR: "UCP_FETCH_ERROR",
  APP_BUILD_EXECUTION_ERROR: "APP_BUILD_EXECUTION_ERROR",
} as const;

/** Base error type used by control-plane route and service boundaries. */
export interface ControlPlaneErrorOptions {
  /** Stable error code for route-level mapping. */
  readonly code: string;
  /** Optional human-readable detail intended for logs and diagnostics. */
  readonly details?: string;
  /** HTTP status that should be used for the exception, when known. */
  readonly statusCode?: number;
  /** Whether the operation is safe to retry. */
  readonly retryable?: boolean;
}

abstract class ControlPlaneError extends Error {
  public readonly code: string;
  public readonly details: string | undefined;
  public readonly statusCode: number;
  public readonly retryable: boolean;

  protected constructor(message: string, options: ControlPlaneErrorOptions) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = options.code;
    this.details = options.details;
    this.statusCode = options.statusCode ?? 500;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Raised when control-plane configuration files or critical config payloads fail parsing.
 */
export class ConfigParseError extends ControlPlaneError {
  public readonly category = "CONFIG_PARSE";

  public constructor(message: string, options: Omit<ControlPlaneErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.CONFIG_PARSE_ERROR,
      statusCode: 400,
    });
  }
}

/** Raised when UCP discovery fetch/parse flow fails to complete successfully. */
export class UCPFetchError extends ControlPlaneError {
  public readonly category = "UCP_FETCH";

  public constructor(message: string, options: Omit<ControlPlaneErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.UCP_FETCH_ERROR,
      statusCode: 502,
      retryable: options.retryable ?? true,
    });
  }
}

/** Raised when app-build execution cannot be started or completed deterministically. */
export class AppBuildExecutionError extends ControlPlaneError {
  public readonly category = "APP_BUILD";

  public constructor(message: string, options: Omit<ControlPlaneErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.APP_BUILD_EXECUTION_ERROR,
      statusCode: 500,
    });
  }
}
