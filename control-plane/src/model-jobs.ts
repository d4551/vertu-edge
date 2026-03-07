import {
  type AppBuildFailureCode,
  type AppBuildEnvelope,
  type AppBuildResult,
  type BuildKind,
  type BuildType,
  type CapabilityJobState,
  type ControlPlaneState,
  type ModelPullEnvelope,
  type ModelPullResult,
  type ModelSource,
  createFlowCapabilityError,
  isSupportedBuildType,
  MAX_JOB_LOG_CHARS,
} from "../../contracts/flow-contracts";
import { parseAppBuildFailureMetadata } from "../../shared/app-build-failures";
import {
  APP_BUILD_IN_PROGRESS_REASON,
  APP_BUILD_JOB_NOT_FOUND_REASON,
  APP_BUILD_JOB_PAYLOAD_INVALID_REASON,
  DEFAULT_BUILD_PLATFORM,
  DEFAULT_BUILD_TYPE,
  MODEL_JOB_LOG_TRUNCATION_RESERVED_CHARS,
  MODEL_JOB_LOG_TRUNCATION_SUFFIX,
  MODEL_PULL_IN_PROGRESS_REASON,
  MODEL_PULL_JOB_NOT_FOUND_REASON,
  MODEL_PULL_JOB_PAYLOAD_INVALID_REASON,
  MODEL_PULL_PAUSED_REASON,
  MAX_MODEL_PULL_TIMEOUT_MS,
  parseKnownModelSourceId,
} from "./config";
import type { CapabilityJobRecord } from "./db";
import { APP_BUILD_ROUTE, MODEL_PULL_ROUTE } from "./runtime-constants";
import { parseArtifactMetadata } from "./artifact-metadata";

/** Persisted payload for model pull capabilities. */
export interface ModelPullJobPayload {
  /** User-requested model reference. */
  modelRef: string;
  /** Normalized model reference used by ramalama. */
  normalizedModelRef: string;
  /** Model source namespace. */
  source: ModelSource;
  /** Optional execution platform hint. */
  platform?: string;
  /** Retry policy override. */
  force: boolean;
  /** Job timeout in milliseconds. */
  timeoutMs: number;
  /** Optional caller-provided correlation id. */
  correlationId?: string;
}

/** Persisted payload for app build capabilities. */
export interface AppBuildJobPayload {
  /** Build target platform. */
  platform: BuildKind;
  /** Build variant. */
  buildType: BuildType;
  /** Optional build variant for app flavor selection. */
  variant?: string;
  /** Skip tests for faster execution. */
  skipTests: boolean;
  /** Optional custom artifact output path. */
  outputDir?: string;
  /** Clean workspace before execution. */
  clean: boolean;
  /** Optional caller-provided correlation id. */
  correlationId?: string;
}

/** Serialize model pull payloads into deterministic storage format. */
export function serializeModelPullPayload(payload: ModelPullJobPayload): string {
  const params = new URLSearchParams();
  params.set("kind", "model_pull");
  params.set("modelRef", payload.modelRef);
  params.set("normalizedModelRef", payload.normalizedModelRef);
  params.set("source", payload.source);
  params.set("force", payload.force ? "1" : "0");
  params.set("timeoutMs", String(payload.timeoutMs));
  if (payload.platform) {
    params.set("platform", payload.platform);
  }
  if (payload.correlationId) {
    params.set("correlationId", payload.correlationId);
  }
  return params.toString();
}

/** Serialize app build payloads into deterministic storage format. */
export function serializeAppBuildPayload(payload: AppBuildJobPayload): string {
  const params = new URLSearchParams();
  params.set("kind", "app_build");
  params.set("platform", payload.platform);
  params.set("buildType", payload.buildType);
  params.set("skipTests", payload.skipTests ? "1" : "0");
  params.set("clean", payload.clean ? "1" : "0");
  if (payload.variant) {
    params.set("variant", payload.variant);
  }
  if (payload.outputDir) {
    params.set("outputDir", payload.outputDir);
  }
  if (payload.correlationId) {
    params.set("correlationId", payload.correlationId);
  }
  return params.toString();
}

/** Convert internal job lifetime state into UI-visible control-plane state. */
export function mapJobStateToControlState(
  status: CapabilityJobState,
  hasExplicitFailure: boolean,
): ControlPlaneState {
  if (status === "queued" || status === "running" || status === "paused") {
    return "loading";
  }
  if (status === "succeeded") {
    return hasExplicitFailure ? "error-non-retryable" : "success";
  }
  if (status === "cancelled") {
    return "error-non-retryable";
  }
  return "error-non-retryable";
}

/** Parse serialized model-pull payload into a typed payload if valid. */
export function parseModelPullPayload(rawPayload: string): ModelPullJobPayload | null {
  const params = new URLSearchParams(rawPayload);
  if (params.get("kind") !== "model_pull") {
    return null;
  }
  const modelRef = params.get("modelRef")?.trim();
  const normalizedModelRef = params.get("normalizedModelRef")?.trim();
  const source = parseKnownModelSourceId(params.get("source")?.trim() ?? "");
  const force = parseBooleanFlag(params.get("force"));
  const timeoutMs = parsePositiveInteger(params.get("timeoutMs"));
  const platform = params.get("platform");
  const correlationId = params.get("correlationId");

  if (
    !modelRef
    || !normalizedModelRef
    || source === null
    || force === null
    || timeoutMs === null
  ) {
    return null;
  }

  return {
    modelRef,
    normalizedModelRef,
    source,
    platform: platform && platform.length > 0 ? platform : undefined,
    force,
    timeoutMs,
    correlationId: correlationId && correlationId.length > 0 ? correlationId : undefined,
  };
}

/** Parse serialized app-build payload into a typed payload if valid. */
export function parseAppBuildPayload(rawPayload: string): AppBuildJobPayload | null {
  const params = new URLSearchParams(rawPayload);
  if (params.get("kind") !== "app_build") {
    return null;
  }
  const platform = params.get("platform");
  const rawBuildType = params.get("buildType");
  const buildType = parseBuildType(rawBuildType);
  const skipTests = parseBooleanFlag(params.get("skipTests"));
  const clean = parseBooleanFlag(params.get("clean"));
  const variant = params.get("variant");
  const outputDir = params.get("outputDir");
  const correlationId = params.get("correlationId");

  if (
    (platform !== "android" && platform !== "ios" && platform !== "desktop")
    || buildType === null
    || skipTests === null
    || clean === null
  ) {
    return null;
  }

  return {
    platform,
    buildType,
    variant: variant && variant.length > 0 ? variant : undefined,
    skipTests,
    outputDir: outputDir && outputDir.length > 0 ? outputDir : undefined,
    clean,
    correlationId: correlationId && correlationId.length > 0 ? correlationId : undefined,
  };
}

/** Resolve the elapsed runtime in milliseconds from persisted job metadata. */
export function resolveJobElapsedMs(job: Pick<CapabilityJobRecord, "createdAt" | "updatedAt">): number {
  return Math.max(0, Date.parse(job.updatedAt) - Date.parse(job.createdAt));
}

function truncateJobLog(value: string): string {
  if (value.length <= MAX_JOB_LOG_CHARS) {
    return value;
  }
  const visible = Math.max(0, MAX_JOB_LOG_CHARS - MODEL_JOB_LOG_TRUNCATION_RESERVED_CHARS);
  return `${value.slice(0, visible)}${MODEL_JOB_LOG_TRUNCATION_SUFFIX}`;
}

function parseBooleanFlag(value: string | null): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_MODEL_PULL_TIMEOUT_MS) {
    return null;
  }
  return parsed;
}

function parseBuildType(rawBuildType: string | null): BuildType | null {
  const normalizedBuildType = (rawBuildType ?? "").trim();
  if (isBuildTypeValue(normalizedBuildType)) {
    return normalizedBuildType;
  }
  return null;
}

function isBuildTypeValue(value: string): value is BuildType {
  return isSupportedBuildType(value);
}

/** Build a complete `ModelPullEnvelope` from a persisted job row. */
export function buildModelPullEnvelope(job: CapabilityJobRecord | null): ModelPullEnvelope {
  if (!job) {
    return {
      route: MODEL_PULL_ROUTE,
      state: "error-non-retryable",
      jobId: "",
      mismatches: ["model_pull_job_not_found"],
      error: createFlowCapabilityError({
        commandIndex: -1,
        command: "modelPull",
        reason: MODEL_PULL_JOB_NOT_FOUND_REASON,
        retryable: false,
        surface: "model_pull",
      }),
    };
  }

  const payload = parseModelPullPayload(job.requestedPayload);
  if (!payload) {
    return {
      route: MODEL_PULL_ROUTE,
      state: "error-non-retryable",
      jobId: job.id,
      mismatches: ["model_pull_job_payload_invalid"],
      error: createFlowCapabilityError({
        commandIndex: -1,
        command: "requestedPayload",
        reason: MODEL_PULL_JOB_PAYLOAD_INVALID_REASON,
        retryable: false,
        surface: "model_pull",
        resource: job.requestedPayload,
      }),
      data: {
        requestedModelRef: "",
        normalizedModelRef: "",
        status: job.status,
        exitCode: job.exitCode,
        stdout: truncateJobLog(job.stdout),
        stderr: truncateJobLog(job.stderr),
        artifactPath: job.artifactPath,
        elapsedMs: resolveJobElapsedMs(job),
      },
    };
  }

  const mismatch = deriveFailureMismatch(payload.normalizedModelRef, job.status, job.exitCode, job.stderr);
  const data: ModelPullResult = {
    requestedModelRef: payload.modelRef,
    normalizedModelRef: payload.normalizedModelRef,
    status: job.status,
    exitCode: job.exitCode,
    stdout: truncateJobLog(job.stdout),
    stderr: truncateJobLog(job.stderr),
    artifactPath: job.artifactPath,
    artifact: parseArtifactMetadata(job.stdout, job.stderr, job.artifactPath, payload.correlationId) ?? undefined,
    elapsedMs: resolveJobElapsedMs(job),
    platform: payload.platform,
  };

  const state = mapJobStateToControlState(job.status, job.exitCode !== null && job.exitCode !== 0);
  if (state === "success") {
    return {
      route: MODEL_PULL_ROUTE,
      state: "success",
      jobId: job.id,
      data,
      mismatches: [],
    };
  }

  const mismatchReason = job.status === "running" || job.status === "queued" || job.status === "paused"
    ? MODEL_PULL_IN_PROGRESS_REASON
    : mismatch;

  if (job.status === "running" || job.status === "queued" || job.status === "paused") {
    return {
      route: MODEL_PULL_ROUTE,
      state,
      jobId: job.id,
      data,
      mismatches: [mismatchReason],
    };
  }

  return {
    route: MODEL_PULL_ROUTE,
    state,
    jobId: job.id,
    data,
    mismatches: mismatchReason ? [mismatchReason] : [],
    error: mismatchReason
      ? createFlowCapabilityError({
        commandIndex: -1,
        command: payload.normalizedModelRef,
        reason: mismatchReason,
        retryable: false,
        surface: "model_pull",
        resource: payload.normalizedModelRef,
      })
      : undefined,
  };
}

/** Build a complete `AppBuildEnvelope` from a persisted job row. */
export function buildAppBuildEnvelope(job: CapabilityJobRecord | null): AppBuildEnvelope {
  if (!job) {
    return {
      route: APP_BUILD_ROUTE,
      state: "error-non-retryable",
      jobId: "",
      mismatches: ["app_build_job_not_found"],
      error: createFlowCapabilityError({
        commandIndex: -1,
        command: "appBuild",
        reason: APP_BUILD_JOB_NOT_FOUND_REASON,
        retryable: false,
        surface: "app_build",
      }),
    };
  }

  const payload = parseAppBuildPayload(job.requestedPayload);
  if (!payload) {
    return {
      route: APP_BUILD_ROUTE,
      state: "error-non-retryable",
      jobId: job.id,
      mismatches: ["app_build_job_payload_invalid"],
      error: createFlowCapabilityError({
        commandIndex: -1,
        command: "requestedPayload",
        reason: APP_BUILD_JOB_PAYLOAD_INVALID_REASON,
        retryable: false,
        surface: "app_build",
        resource: job.requestedPayload,
      }),
      data: {
        platform: DEFAULT_BUILD_PLATFORM,
        buildType: DEFAULT_BUILD_TYPE,
        exitCode: job.exitCode,
        status: job.status,
        stdout: truncateJobLog(job.stdout),
        stderr: truncateJobLog(job.stderr),
        artifactPath: job.artifactPath,
        elapsedMs: resolveJobElapsedMs(job),
      },
    };
  }

  const buildFailure = resolveAppBuildFailure(job.stderr);
  const data: AppBuildResult = {
    platform: payload.platform,
    buildType: payload.buildType,
    variant: payload.variant,
    status: job.status,
    exitCode: job.exitCode,
    stdout: truncateJobLog(job.stdout),
    stderr: truncateJobLog(job.stderr),
    artifactPath: job.artifactPath,
    ...(buildFailure
      ? {
        failureCode: buildFailure.code,
        failureMessage: buildFailure.message,
      }
      : {}),
    artifact: parseArtifactMetadata(job.stdout, job.stderr, job.artifactPath, payload.correlationId) ?? undefined,
    elapsedMs: resolveJobElapsedMs(job),
  };

  const state = mapJobStateToControlState(job.status, job.exitCode !== null && job.exitCode !== 0);
  if (state === "success") {
    return {
      route: APP_BUILD_ROUTE,
      state: "success",
      jobId: job.id,
      data,
      mismatches: [],
    };
  }

  const mismatchReason = job.status === "running" || job.status === "queued" || job.status === "paused"
    ? APP_BUILD_IN_PROGRESS_REASON
    : deriveAppBuildFailureMismatch(payload.platform, job.exitCode, job.stderr);

  if (job.status === "running" || job.status === "queued" || job.status === "paused") {
    return {
      route: APP_BUILD_ROUTE,
      state,
      jobId: job.id,
      data,
      mismatches: [mismatchReason],
    };
  }

  return {
    route: APP_BUILD_ROUTE,
    state,
    jobId: job.id,
    data,
    mismatches: mismatchReason ? [mismatchReason] : [],
    error: mismatchReason
      ? createFlowCapabilityError({
        commandIndex: -1,
        command: payload.platform,
        ...(buildFailure ? { code: buildFailure.code } : {}),
        reason: mismatchReason,
        retryable: false,
        surface: "app_build",
        resource: payload.platform,
      })
      : undefined,
  };
}

function resolveAppBuildFailure(stderr: string): { readonly code: AppBuildFailureCode; readonly message: string } | null {
  return parseAppBuildFailureMetadata(stderr);
}

function deriveFailureMismatch(
  modelRef: string,
  status: CapabilityJobState,
  exitCode: number | null,
  stderr: string,
): string {
  if (status === "queued" || status === "running") {
    return MODEL_PULL_IN_PROGRESS_REASON;
  }
  if (status === "paused") {
    return MODEL_PULL_PAUSED_REASON;
  }
  if (status === "succeeded") {
    return exitCode === 0 ? "" : `model pull failed for ${modelRef}`;
  }
  if (status === "cancelled") {
    return `model pull was cancelled for ${modelRef}`;
  }
  if (stderr.length > 0) {
    return `model pull failed for ${modelRef}: ${stderr}`;
  }
  return `model pull failed for ${modelRef}`;
}

function deriveAppBuildFailureMismatch(
  platform: AppBuildJobPayload["platform"],
  exitCode: number | null,
  stderr: string,
): string {
  if (exitCode === null) {
    return `app build for ${platform} is in progress`;
  }
  if (exitCode === 0) {
    return "";
  }
  if (stderr.length > 0) {
    return `app build failed for ${platform}: ${stderr}`;
  }
  return `app build failed for ${platform}`;
}
