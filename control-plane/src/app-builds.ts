import { join, resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  DEFAULT_JOB_TIMEOUT_MS,
  type AppBuildEnvelope,
  type AppBuildRequest,
  type BuildKind,
  type BuildType,
  createFlowCapabilityError,
  isAppBuildFailureCode,
  isSupportedBuildKind,
  isSupportedBuildType,
  isSupportedDesktopBuildVariant,
} from "../../contracts/flow-contracts";
import {
  APP_BUILD_CANCELLED_MESSAGE,
  APP_BUILD_ANDROID_JAVA_MISSING_REASON,
  APP_BUILD_DESKTOP_BUN_MISSING_REASON,
  APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON,
  APP_BUILD_EXECUTION_FAILED_REASON,
  APP_BUILD_FAILURE_FALLBACK_MESSAGE,
  APP_BUILD_IOS_MAC_ONLY_REASON,
  APP_BUILD_IOS_SCHEME_MISSING_REASON,
  APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON,
  APP_BUILD_IOS_TOOLING_MISSING_REASON,
  APP_BUILD_JOB_PAYLOAD_INVALID_REASON,
  APP_BUILD_OUTPUT_DIR_INVALID_REASON,
  APP_BUILD_OUTPUT_DIR_TRAVERSE_REASON,
  APP_BUILD_SCRIPT_MISSING_REASON,
  APP_BUILD_RESUMED_MESSAGE,
  APP_BUILD_SUCCESS_MESSAGE,
  APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON,
  APP_BUILD_UNSUPPORTED_PLATFORM_REASON,
  DEFAULT_BUILD_TYPE,
  SUPPORTED_DESKTOP_BUILD_VARIANTS,
} from "./config";
import {
  appendAppBuildFailureMetadata,
  createAppBuildFailureError,
  type AppBuildFailureMetadata,
} from "../../shared/app-build-failures";
import {
  commandExists,
  listIosSchemes,
  resolveJava21Home,
} from "../../shared/host-tooling";

import {
  appendCapabilityJobEvent,
  createCapabilityJob,
  getCapabilityJob,
  listCapabilityJobEvents,
  updateCapabilityJob,
} from "./db";
import { resolveDefaultDesktopBuildVariant } from "../../shared/app-build";
import {
  buildAppBuildEnvelope,
  parseAppBuildPayload,
  serializeAppBuildPayload,
  type AppBuildJobPayload,
} from "./model-jobs";
import {
  APP_BUILD_ROUTE,
  FLOW_KIT_CLI_RELATIVE,
  FLOW_KIT_DIRECTORY_RELATIVE,
} from "./runtime-constants";
import { parseArtifactMetadata, verifyArtifactMetadata } from "./artifact-metadata";
import { AppBuildExecutionError } from "./errors";

const activeBuildProcesses = new Map<string, Bun.Subprocess>();

/** Start an app build workflow job and return a loading envelope. */
export async function startAppBuildJob(
  request: AppBuildRequest,
  requestedBy?: string,
): Promise<AppBuildEnvelope> {
  const payload = await buildValidatedBuildPayload(request);
  await validateBuildTooling(payload.platform, payload.variant);

  const jobId = createCapabilityJob({
    kind: "app_build",
    requestedPayload: serializeAppBuildPayload(payload),
    requestedBy,
    correlationId: payload.correlationId,
  });

  void executeAppBuildJob(jobId, payload);

  return {
    route: APP_BUILD_ROUTE,
    state: "loading",
    jobId,
    data: {
      platform: payload.platform,
      buildType: payload.buildType,
      variant: payload.variant,
      status: "queued",
      exitCode: null,
      stdout: "",
      stderr: "",
      artifactPath: null,
      elapsedMs: 0,
    },
    mismatches: [],
  };
}

/** Return a pollable envelope for an app build job id. */
export function getAppBuildJobEnvelope(jobId: string): AppBuildEnvelope {
  return buildAppBuildEnvelope(getCapabilityJob(jobId));
}

/** Return structured build log events for polling/SSE routes. */
export function getAppBuildJobLogEvents(jobId: string, afterCursor?: string | null): import("./db").CapabilityJobEventRecord[] {
  return listCapabilityJobEvents(jobId, afterCursor);
}

/** Cancel a running app build job and mark terminal state. */
export function cancelAppBuildJob(jobId: string): AppBuildEnvelope {
  const proc = activeBuildProcesses.get(jobId);
  if (proc) {
    proc.kill();
    activeBuildProcesses.delete(jobId);
  }
  updateCapabilityJob(jobId, {
    status: "cancelled",
    cancelRequestedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
  appendCapabilityJobEvent({
    jobId,
    level: "warn",
    message: APP_BUILD_CANCELLED_MESSAGE,
  });
  return getAppBuildJobEnvelope(jobId);
}

/** Resume a cancelled/failed build job as deterministic requeue on same job id. */
export function resumeAppBuildJob(jobId: string): AppBuildEnvelope {
  const job = getCapabilityJob(jobId);
  if (!job) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "jobId",
      code: "APP_BUILD_JOB_NOT_FOUND",
      category: "validation",
      reason: `App build job '${jobId}' was not found`,
      retryable: false,
      surface: "app_build",
      resource: jobId,
    });
  }
  const payload = parseAppBuildPayload(job.requestedPayload);
  if (!payload) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "requestedPayload",
      code: "APP_BUILD_PAYLOAD_INVALID",
      category: "validation",
      reason: APP_BUILD_JOB_PAYLOAD_INVALID_REASON,
      retryable: false,
      surface: "app_build",
      resource: jobId,
    });
  }

  updateCapabilityJob(jobId, {
    status: "queued",
    stdout: "",
    stderr: "",
    exitCode: null,
    artifactPath: null,
    startedAt: null,
    endedAt: null,
    cancelRequestedAt: null,
  });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: APP_BUILD_RESUMED_MESSAGE,
  });
  void executeAppBuildJob(jobId, payload);
  return getAppBuildJobEnvelope(jobId);
}

async function buildValidatedBuildPayload(request: AppBuildRequest): Promise<AppBuildJobPayload> {
  const platform = request.platform;
  if (!isSupportedBuildKind(platform)) {
    throw createAppBuildFailureError({
      code: "app_build_unsupported_platform",
      command: "platform",
      category: "validation",
      reason: `${APP_BUILD_UNSUPPORTED_PLATFORM_REASON} '${platform}'.`,
      resource: platform,
    });
  }

  const buildType = request.buildType ?? DEFAULT_BUILD_TYPE;
  if (!isBuildTypeValue(buildType)) {
    throw createAppBuildFailureError({
      code: "app_build_unsupported_build_type",
      command: "buildType",
      category: "validation",
      reason: `${APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON} '${buildType}'.`,
      resource: buildType,
    });
  }

  const outputDir = request.outputDir?.trim();
  if (outputDir) {
    await validateWritableOutputDir(outputDir);
  }

  const requestedVariant = request.variant?.trim();
  const resolvedVariant =
    platform === "desktop"
      ? requestedVariant || resolveDefaultDesktopBuildVariant(process.platform, process.arch) || undefined
      : requestedVariant;
  if (platform === "desktop" && !resolvedVariant) {
    throw createAppBuildFailureError({
      code: "app_build_desktop_variant_unsupported",
      command: "variant",
      category: "validation",
      reason: `${APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON} '${process.platform}/${process.arch}'. Supported: ${SUPPORTED_DESKTOP_BUILD_VARIANTS.join(", ")}`,
      resource: `${process.platform}/${process.arch}`,
    });
  }

  return {
    platform,
    buildType,
    variant: resolvedVariant,
    skipTests: request.skipTests === true,
    outputDir,
    clean: request.clean === true,
    correlationId: request.correlationId?.trim(),
  };
}

function isBuildTypeValue(value: string): value is BuildType {
  return isSupportedBuildType(value);
}

async function validateBuildTooling(platform: BuildKind, requestedVariant?: string): Promise<void> {
  if (platform === "android") {
    const java21Home = await resolveJava21Home(process.env);
    if (!java21Home && !commandExists("brew", process.env)) {
      throw createAppBuildFailureError({
        code: "app_build_android_java_missing",
        command: "java",
        reason: APP_BUILD_ANDROID_JAVA_MISSING_REASON,
        resource: "java",
      });
    }
    return;
  }

  if (platform === "desktop") {
    if (!commandExists("bun", process.env)) {
      throw createAppBuildFailureError({
        code: "app_build_desktop_bun_missing",
        command: "bun",
        reason: APP_BUILD_DESKTOP_BUN_MISSING_REASON,
        resource: "bun",
      });
    }
    if (requestedVariant && !isSupportedDesktopBuildVariant(requestedVariant)) {
      throw createAppBuildFailureError({
        code: "app_build_desktop_variant_unsupported",
        command: "variant",
        category: "validation",
        reason: `${APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON} '${requestedVariant}'. Supported: ${SUPPORTED_DESKTOP_BUILD_VARIANTS.join(", ")}`,
        resource: requestedVariant,
      });
    }
    return;
  }

  if (platform === "ios") {
    if (process.platform !== "darwin") {
      throw createAppBuildFailureError({
        code: "app_build_ios_mac_only",
        command: "platform",
        reason: APP_BUILD_IOS_MAC_ONLY_REASON,
        resource: platform,
      });
    }

    const iosDirectory = resolve(import.meta.dir, "..", "..", "iOS", "VertuEdge");
    const schemeListing = await listIosSchemes(iosDirectory, process.env);
    if (!schemeListing.ok) {
      if (schemeListing.error.code === "project_container_missing" || schemeListing.error.code === "schemes_missing") {
        throw createAppBuildFailureError({
          code: "app_build_ios_scheme_missing",
          command: "platform",
          reason: APP_BUILD_IOS_SCHEME_MISSING_REASON,
          resource: iosDirectory,
        });
      }
      throw createAppBuildFailureError({
        code: "app_build_ios_tooling_missing",
        command: "platform",
        reason: APP_BUILD_IOS_TOOLING_MISSING_REASON,
        resource: "xcodebuild",
      });
    }

    if (requestedVariant && !schemeListing.data.schemes.includes(requestedVariant)) {
      throw createAppBuildFailureError({
        code: "app_build_ios_scheme_not_found",
        command: "variant",
        category: "validation",
        reason: `${APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON} '${requestedVariant}'.`,
        resource: requestedVariant,
      });
    }
  }
}

async function validateWritableOutputDir(outputDir: string): Promise<void> {
  const normalized = resolve(outputDir);
  // `resolve()` already collapses `..` segments, so checking for ".." in the
  // resolved path components is dead code. Instead, verify that the resolved
  // path starts with an allowed base directory to prevent path traversal into
  // sensitive system directories. We reject any path that resolves outside the
  // current working directory tree or to a sensitive root.
  const cwd = resolve(".");
  // Ensure the resolved path is a subdirectory of the current working directory.
  // Append sep to both paths to avoid matching a directory like /foobar when the
  // allowed base is /foo.
  const allowedBase = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (!normalized.startsWith(allowedBase) && normalized !== cwd) {
    throw createAppBuildFailureError({
      code: "app_build_output_dir_invalid",
      command: "outputDir",
      category: "validation",
      reason: APP_BUILD_OUTPUT_DIR_TRAVERSE_REASON,
      resource: outputDir,
    });
  }

  try {
    await mkdir(normalized, { recursive: true });
  } catch {
    throw createAppBuildFailureError({
      code: "app_build_output_dir_invalid",
      command: "outputDir",
      category: "validation",
      reason: APP_BUILD_OUTPUT_DIR_INVALID_REASON,
      resource: outputDir,
    });
  }
}

/** Execute a background build job and persist lifecycle state. */
async function executeAppBuildJob(jobId: string, payload: AppBuildJobPayload): Promise<void> {
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Build started for ${payload.platform} (${payload.buildType})`,
  });

  const repoRoot = resolve(import.meta.dir, "..", "..");
  const flowKitDir = join(repoRoot, FLOW_KIT_DIRECTORY_RELATIVE);
  const flowKitCli = join(repoRoot, FLOW_KIT_CLI_RELATIVE);
  const args = buildScriptArgs(payload);
  const env = buildBuildScriptEnvironment(payload.correlationId);

  try {
    if (!(await Bun.file(flowKitCli).exists())) {
      throw createAppBuildFailureError({
        code: "app_build_script_missing",
        command: "vertu-flow",
        reason: APP_BUILD_SCRIPT_MISSING_REASON,
        resource: flowKitCli,
      });
    }
    const proc = Bun.spawn([process.execPath, "src/cli.ts", "build", payload.platform, ...args], {
      cwd: flowKitDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: DEFAULT_JOB_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    activeBuildProcesses.set(jobId, proc);
    const [stdout, stderr] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ]);
    const resolvedExitCode = await proc.exited;
    const artifactPath = await findBuildArtifact(payload.platform, stdout, stderr);
    const metadata = parseArtifactMetadata(stdout, stderr, artifactPath, payload.correlationId);
    const integrity = await verifyArtifactMetadata(metadata);
    const exitCode = integrity.ok ? resolvedExitCode : 1;

    updateCapabilityJob(jobId, {
      status: exitCode === 0 ? "succeeded" : "failed",
      stdout: metadata ? `${stdout}\nARTIFACT_METADATA_JSON=${JSON.stringify(metadata)}` : stdout,
      stderr: integrity.ok ? stderr : `${stderr}\n${integrity.reason}`,
      exitCode,
      artifactPath: metadata?.artifactPath ?? null,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId,
      level: exitCode === 0 ? "info" : "error",
      message: exitCode === 0
        ? APP_BUILD_SUCCESS_MESSAGE
        : `Build failed with exit code ${exitCode}${integrity.ok ? "" : ` (${integrity.reason})`}`,
    });
    activeBuildProcesses.delete(jobId);
  } catch (failure) {
    const metadata = failure instanceof Error
      ? resolveAppBuildFailureMetadata(failure)
      : typeof failure === "string" || typeof failure === "number" || typeof failure === "boolean" || failure === null || failure === undefined
        ? resolveAppBuildFailureMetadata(failure)
        : typeof failure === "object"
          ? resolveAppBuildFailureMetadata(failure as BuildFailureDetails)
          : null;
    const failureMessage = failure instanceof Error
      ? normalizeFailureMessage(failure)
      : typeof failure === "string" || typeof failure === "number" || typeof failure === "boolean"
        ? normalizeFailureMessage(failure)
        : (typeof failure === "object"
            && failure !== null
            && "message" in failure
            && typeof failure.message === "string")
          ? normalizeFailureMessage({ message: failure.message })
          : normalizeFailureMessage(null);
    activeBuildProcesses.delete(jobId);
    updateCapabilityJob(jobId, {
      status: "failed",
      stdout: "",
      stderr: metadata ? appendAppBuildFailureMetadata(failureMessage, metadata) : failureMessage,
      exitCode: 1,
      artifactPath: null,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId,
      level: "error",
      message: `Build failed: ${failureMessage}`,
    });
  }
}

function resolveAppBuildFailureMetadata(failure: BuildFailure | BuildFailureDetails): AppBuildFailureMetadata | null {
  if (
    typeof failure === "object"
    && failure !== null
    && "code" in failure
    && typeof failure.code === "string"
  ) {
    const code = failure.code;
    if (isAppBuildFailureCode(code)) {
      return {
        code,
        message: "reason" in failure && typeof failure.reason === "string" ? failure.reason : APP_BUILD_EXECUTION_FAILED_REASON,
      };
    }
  }

  if (failure instanceof AppBuildExecutionError) {
    return {
      code: "app_build_execution_failed",
      message: failure.message,
    };
  }

  if (failure instanceof Error) {
    return {
      code: "app_build_execution_failed",
      message: failure.message,
    };
  }

  if (typeof failure === "string" || typeof failure === "number" || typeof failure === "boolean") {
    return {
      code: "app_build_execution_failed",
      message: normalizeFailureMessage(failure),
    };
  }

  if (
    typeof failure === "object"
    && failure !== null
    && "message" in failure
    && typeof failure.message === "string"
  ) {
    return {
      code: "app_build_execution_failed",
      message: failure.message,
    };
  }

  return null;
}

function buildScriptArgs(payload: AppBuildJobPayload): string[] {
  const args: string[] = [`--build-type=${payload.buildType}`];

  if (payload.variant) {
    args.push(`--variant=${payload.variant}`);
  }
  if (payload.skipTests) {
    args.push("--skip-tests");
  }
  if (payload.clean) {
    args.push("--clean");
  }
  if (payload.outputDir) {
    args.push(`--output-dir=${payload.outputDir}`);
  }

  return args;
}

async function findBuildArtifact(platform: BuildKind, stdout: string, stderr: string): Promise<string | null> {
  const artifactFromOutput = [
    ...stdout.matchAll(/ARTIFACT_PATH=([^\n\r]+)/g),
    ...stderr.matchAll(/ARTIFACT_PATH=([^\n\r]+)/g),
  ]
    .map((entry) => entry[1]?.trim())
    .find((value): value is string => typeof value === "string" && value.length > 0);

  if (artifactFromOutput) {
    return artifactFromOutput;
  }

  if (platform === "android") {
    const buildRoot = resolve(import.meta.dir, "..", "..", "Android", "src", "app", "build", "outputs");
    const releasePath = join(buildRoot, "apk", "release", "app-release.apk");
    const debugPath = join(buildRoot, "apk", "debug", "app-debug.apk");
    if (await Bun.file(releasePath).exists()) {
      return releasePath;
    }
    if (await Bun.file(debugPath).exists()) {
      return debugPath;
    }
  }

  if (platform === "ios") {
    const workspaceRoot = resolve(import.meta.dir, "..", "..", "iOS");
    const archivePath = join(workspaceRoot, "build", "iOS", "app.xcarchive");
    if (await Bun.file(archivePath).exists()) {
      return archivePath;
    }
  }

  if (platform === "desktop") {
    const distRoot = resolve(import.meta.dir, "..", "dist");
    // Desktop builds emit ARTIFACT_PATH from the script; if not found, probe dist/ for known naming patterns.
    const candidates = [
      "vertu-cp-darwin-arm64",
      "vertu-cp-darwin-x64",
      "vertu-cp-linux-x64",
      "vertu-cp-linux-arm64",
      "vertu-cp-windows-x64.exe",
    ];
    for (const candidate of candidates) {
      const candidatePath = join(distRoot, candidate);
      if (await Bun.file(candidatePath).exists()) {
        return candidatePath;
      }
    }
  }

  return null;
}

type BuildFailure =
  | Error
  | { message?: string }
  | string
  | number
  | boolean
  | null
  | undefined;

type BuildFailureDetails = {
  readonly code?: string;
  readonly reason?: string;
  readonly message?: string;
};

function normalizeFailureMessage(value: BuildFailure): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object" && value !== null && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return APP_BUILD_FAILURE_FALLBACK_MESSAGE;
}

function buildBuildScriptEnvironment(correlationId?: string): Record<string, string> {
  const baseEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const safeLocale = sanitizeLocale(baseEnvironment.LC_ALL)
    ?? sanitizeLocale(baseEnvironment.LC_CTYPE)
    ?? sanitizeLocale(baseEnvironment.LANG)
    ?? "C";

  return {
    ...baseEnvironment,
    LC_ALL: safeLocale,
    LC_CTYPE: safeLocale,
    LANG: safeLocale,
    ...(correlationId ? { VERTU_CORRELATION_ID: correlationId } : {}),
  };
}

function sanitizeLocale(value?: string): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized === "C.UTF-8" ? "C" : normalized;
}
