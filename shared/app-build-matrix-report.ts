import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAppBuildFailureCode, type AppBuildFailureCode } from "../contracts/flow-contracts";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonRecord | readonly JsonValue[];
type JsonRecord = { readonly [key: string]: JsonValue };

/** Stable build platform identifier for canonical app-build matrix reports. */
export type AppBuildPlatform = "android" | "ios" | "desktop";

/** Terminal status emitted by the canonical app-build matrix. */
export type AppBuildMatrixStatus = "pass" | "fail" | "delegated" | "pending";

/** Schema version emitted by canonical app-build matrix reports. */
export const APP_BUILD_MATRIX_REPORT_SCHEMA_VERSION = "1.0" as const;

/** Default repository-relative directory for app-build matrix artifacts. */
export const APP_BUILD_MATRIX_REPORT_DIRECTORY = ".artifacts/app-builds" as const;

/** Stable file name for the latest app-build matrix snapshot. */
export const APP_BUILD_MATRIX_LATEST_REPORT_FILE = "latest.json" as const;

/** Stable file name for a single app-build matrix run report. */
export const APP_BUILD_MATRIX_RUN_REPORT_FILE = "build-report.json" as const;

/** Per-platform build result row in the canonical app-build matrix report. */
export interface AppBuildPlatformReport {
  /** Platform identifier. */
  readonly platform: AppBuildPlatform;
  /** Terminal build status. */
  readonly status: AppBuildMatrixStatus;
  /** Human-readable build summary. */
  readonly message: string;
  /** Log file path for the platform build execution. */
  readonly logPath: string;
  /** Optional typed failure code when the platform build terminates with a structured error. */
  readonly failureCode?: AppBuildFailureCode;
  /** Optional typed failure message when the platform build terminates with a structured error. */
  readonly failureMessage?: string;
  /** Optional artifact path from the platform build. */
  readonly artifactPath?: string;
  /** Optional artifact checksum from the platform build. */
  readonly artifactSha256?: string;
}

/** Typed per-platform rows emitted by the canonical app-build matrix. */
export interface AppBuildMatrixPlatforms {
  /** Android build result. */
  readonly android: AppBuildPlatformReport;
  /** iOS build result. */
  readonly ios: AppBuildPlatformReport;
  /** Desktop build result. */
  readonly desktop: AppBuildPlatformReport;
}

/** Typed report written by the canonical app-build matrix owner. */
export interface AppBuildMatrixReport {
  /** Schema version for the report payload. */
  readonly schemaVersion: typeof APP_BUILD_MATRIX_REPORT_SCHEMA_VERSION;
  /** ISO8601 generation time. */
  readonly generatedAt: string;
  /** Correlation id covering the full matrix run. */
  readonly correlationId: string;
  /** Host metadata captured for the run. */
  readonly host: {
    /** Host operating system. */
    readonly os: string;
  };
  /** Android/iOS/Desktop platform results. */
  readonly platforms: AppBuildMatrixPlatforms;
}

/** Typed result returned when reading a canonical app-build matrix report from disk. */
export type AppBuildMatrixReportReadResult =
  | {
    /** Indicates a successful typed read. */
    readonly ok: true;
    /** Parsed canonical report. */
    readonly data: AppBuildMatrixReport;
    /** Absolute report path used for the read. */
    readonly path: string;
  }
  | {
    /** Indicates a failed read. */
    readonly ok: false;
    /** Machine-readable reason for the failure. */
    readonly reason: "missing" | "invalid";
    /** Human-readable failure detail. */
    readonly message: string;
    /** Absolute report path used for the read. */
    readonly path: string;
  };

function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppBuildPlatform(value: JsonValue | undefined): value is AppBuildPlatform {
  return value === "android" || value === "ios" || value === "desktop";
}

function isAppBuildMatrixStatus(value: JsonValue | undefined): value is AppBuildMatrixStatus {
  return value === "pass" || value === "fail" || value === "delegated" || value === "pending";
}

function parseJsonDocument(raw: string): { ok: true; data: JsonValue } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      data: JSON.parse(raw) as JsonValue,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON payload.";
    return { ok: false, message: `Invalid JSON payload: ${message}` };
  }
}

function parsePlatformReport(value: JsonValue | undefined, expectedPlatform: AppBuildPlatform): AppBuildPlatformReport | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  const platform = value.platform;
  const status = value.status;
  const message = value.message;
  const logPath = value.logPath;
  if (
    !isAppBuildPlatform(platform)
    || platform !== expectedPlatform
    || !isAppBuildMatrixStatus(status)
    || typeof message !== "string"
    || message.trim().length === 0
    || typeof logPath !== "string"
    || logPath.trim().length === 0
  ) {
    return null;
  }

  const failureCode = value.failureCode;
  const failureMessage = value.failureMessage;
  const artifactPath = value.artifactPath;
  const artifactSha256 = value.artifactSha256;

  if (failureCode !== undefined && (typeof failureCode !== "string" || !isAppBuildFailureCode(failureCode))) {
    return null;
  }
  if (failureMessage !== undefined && (typeof failureMessage !== "string" || failureMessage.trim().length === 0)) {
    return null;
  }
  if (artifactPath !== undefined && (typeof artifactPath !== "string" || artifactPath.trim().length === 0)) {
    return null;
  }
  if (artifactSha256 !== undefined && (typeof artifactSha256 !== "string" || artifactSha256.trim().length === 0)) {
    return null;
  }

  return {
    platform,
    status,
    message,
    logPath,
    ...(failureCode ? { failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    ...(artifactSha256 ? { artifactSha256 } : {}),
  };
}

function parseAppBuildMatrixReportDocument(document: JsonValue): AppBuildMatrixReport | null {
  if (!isJsonRecord(document)) {
    return null;
  }

  const schemaVersion = document.schemaVersion;
  const generatedAt = document.generatedAt;
  const correlationId = document.correlationId;
  const host = document.host;
  const platforms = document.platforms;
  if (
    schemaVersion !== APP_BUILD_MATRIX_REPORT_SCHEMA_VERSION
    || typeof generatedAt !== "string"
    || generatedAt.trim().length === 0
    || typeof correlationId !== "string"
    || correlationId.trim().length === 0
    || !isJsonRecord(host)
    || typeof host.os !== "string"
    || host.os.trim().length === 0
    || !isJsonRecord(platforms)
  ) {
    return null;
  }

  const android = parsePlatformReport(platforms.android, "android");
  const ios = parsePlatformReport(platforms.ios, "ios");
  const desktop = parsePlatformReport(platforms.desktop, "desktop");
  if (!android || !ios || !desktop) {
    return null;
  }

  return {
    schemaVersion: APP_BUILD_MATRIX_REPORT_SCHEMA_VERSION,
    generatedAt,
    correlationId,
    host: { os: host.os },
    platforms: {
      android,
      ios,
      desktop,
    },
  };
}

/** Build a deterministic canonical app-build matrix report from per-platform results. */
export function createAppBuildMatrixReport(
  correlationId: string,
  hostOs: string,
  platforms: AppBuildMatrixPlatforms,
  generatedAt: string = new Date().toISOString(),
): AppBuildMatrixReport {
  return {
    schemaVersion: APP_BUILD_MATRIX_REPORT_SCHEMA_VERSION,
    generatedAt,
    correlationId,
    host: { os: hostOs },
    platforms,
  };
}

/** Detect whether any platform in the matrix ended in a terminal failure state. */
export function hasFailedAppBuildMatrix(report: AppBuildMatrixReport): boolean {
  return Object.values(report.platforms).some((platform) => platform.status === "fail");
}

/** Resolve the canonical app-build report directory for a repository root. */
export function resolveAppBuildMatrixReportDirectory(repoRoot: string, reportRoot?: string): string {
  const normalizedOverride = reportRoot?.trim() ?? "";
  return normalizedOverride.length > 0
    ? normalizedOverride
    : resolve(repoRoot, APP_BUILD_MATRIX_REPORT_DIRECTORY);
}

/** Resolve the canonical latest app-build report path for a repository root. */
export function resolveLatestAppBuildMatrixReportPath(repoRoot: string, reportRoot?: string): string {
  return resolve(resolveAppBuildMatrixReportDirectory(repoRoot, reportRoot), APP_BUILD_MATRIX_LATEST_REPORT_FILE);
}

/** Resolve the canonical per-run app-build report path for a run directory. */
export function resolveRunAppBuildMatrixReportPath(runDirectory: string): string {
  return resolve(runDirectory, APP_BUILD_MATRIX_RUN_REPORT_FILE);
}

/** Read and validate a canonical app-build matrix report from an absolute file path. */
export function readAppBuildMatrixReport(reportPath: string): AppBuildMatrixReportReadResult {
  if (!existsSync(reportPath)) {
    return {
      ok: false,
      reason: "missing",
      message: "App-build matrix report does not exist.",
      path: reportPath,
    };
  }

  const decoded = parseJsonDocument(readFileSync(reportPath, "utf-8"));
  if (!decoded.ok) {
    return {
      ok: false,
      reason: "invalid",
      message: decoded.message,
      path: reportPath,
    };
  }

  const report = parseAppBuildMatrixReportDocument(decoded.data);
  if (!report) {
    return {
      ok: false,
      reason: "invalid",
      message: "App-build matrix report does not match the canonical schema.",
      path: reportPath,
    };
  }

  return {
    ok: true,
    data: report,
    path: reportPath,
  };
}

/** Read and validate the latest canonical app-build matrix report for a repository root. */
export function readLatestAppBuildMatrixReport(repoRoot: string, reportRoot?: string): AppBuildMatrixReportReadResult {
  return readAppBuildMatrixReport(resolveLatestAppBuildMatrixReportPath(repoRoot, reportRoot));
}
