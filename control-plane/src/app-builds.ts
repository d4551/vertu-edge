import { join, resolve, sep } from "path";
import { mkdir } from "node:fs/promises";
import {
  DEFAULT_JOB_TIMEOUT_MS,
  type AppBuildEnvelope,
  type AppBuildRequest,
  type BuildKind,
  type BuildType,
  createFlowCapabilityError,
  isSupportedBuildKind,
} from "../../contracts/flow-contracts";
import {
  APP_BUILD_CANCELLED_MESSAGE,
  APP_BUILD_FAILURE_FALLBACK_MESSAGE,
  APP_BUILD_IOS_MAC_ONLY_REASON,
  APP_BUILD_IOS_SCHEME_MISSING_REASON,
  APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON,
  APP_BUILD_IOS_TOOLING_MISSING_REASON,
  APP_BUILD_JOB_PAYLOAD_INVALID_REASON,
  APP_BUILD_OUTPUT_DIR_TRAVERSE_REASON,
  APP_BUILD_RESUMED_MESSAGE,
  APP_BUILD_SUCCESS_MESSAGE,
  APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON,
  APP_BUILD_UNSUPPORTED_PLATFORM_REASON,
  DEFAULT_BUILD_TYPE,
  SUPPORTED_BUILD_TYPES,
} from "./config";

const SUPPORTED_BUILD_TYPES_SET = new Set<string>(SUPPORTED_BUILD_TYPES);
import {
  appendCapabilityJobEvent,
  createCapabilityJob,
  getCapabilityJob,
  listCapabilityJobEvents,
  updateCapabilityJob,
} from "./db";
import {
  buildAppBuildEnvelope,
  parseAppBuildPayload,
  serializeAppBuildPayload,
  type AppBuildJobPayload,
} from "./model-jobs";
import { APP_BUILD_ROUTE, RUN_ANDROID_BUILD_SCRIPT, RUN_IOS_BUILD_SCRIPT } from "./runtime-constants";
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
export function getAppBuildJobLogEvents(jobId: string, afterEventId?: string | null): import("./db").CapabilityJobEventRecord[] {
  return listCapabilityJobEvents(jobId, afterEventId);
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
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: `${APP_BUILD_UNSUPPORTED_PLATFORM_REASON} '${platform}'.`,
      retryable: false,
      surface: "app_build",
      resource: platform,
    });
  }

  const buildType = request.buildType ?? DEFAULT_BUILD_TYPE;
  if (!isBuildTypeValue(buildType)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "buildType",
      reason: `${APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON} '${buildType}'.`,
      retryable: false,
      surface: "app_build",
      resource: buildType,
    });
  }

  const outputDir = request.outputDir?.trim();
  if (outputDir) {
    await validateWritableOutputDir(outputDir);
  }

  return {
    platform,
    buildType,
    variant: request.variant?.trim(),
    skipTests: request.skipTests === true,
    outputDir,
    clean: request.clean === true,
    correlationId: request.correlationId?.trim(),
  };
}

function isBuildTypeValue(value: string): value is BuildType {
  return SUPPORTED_BUILD_TYPES_SET.has(value);
}

async function validateBuildTooling(platform: BuildKind, requestedVariant?: string): Promise<void> {
  if (platform === "android") {
    validateBinary("java", "Java runtime");
    return;
  }

  if (platform === "ios") {
    if (process.platform !== "darwin") {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "platform",
        reason: APP_BUILD_IOS_MAC_ONLY_REASON,
        retryable: false,
        surface: "app_build",
        resource: platform,
      });
    }

    const hasXcodeBuildTools = commandExists("xcodebuild");
    if (!hasXcodeBuildTools) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "platform",
        reason: APP_BUILD_IOS_TOOLING_MISSING_REASON,
        retryable: false,
        surface: "app_build",
        resource: platform,
      });
    }

    await validateIosSchemeAvailability(requestedVariant);
  }
}

function validateBinary(command: string, label: string): void {
  const ok = commandExists(command);
  if (!ok) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command,
      reason: `${label} is not available.`,
      retryable: false,
      surface: "app_build",
      resource: command,
    });
  }
}

/**
 * Check whether a system command is available on PATH.
 * Uses `Bun.which()` for consistency with flow-engine.ts and app.ts,
 * replacing the previous custom synchronous PATH-scan implementation.
 */
function commandExists(command: string): boolean {
  return Bun.which(command) !== null;
}

async function validateIosSchemeAvailability(requestedVariant?: string): Promise<void> {
  const iosDir = resolve(import.meta.dir, "..", "..", "iOS", "VertuEdge");
  const workspacePath = resolve(iosDir, "VertuEdge.xcworkspace");
  const projectPath = resolve(iosDir, "VertuEdge.xcodeproj");
  const listArgs: string[] = [];

  if (await Bun.file(workspacePath).exists()) {
    listArgs.push("-list", "-workspace", workspacePath);
  } else if (await Bun.file(projectPath).exists()) {
    listArgs.push("-list", "-project", projectPath);
  } else {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: APP_BUILD_IOS_SCHEME_MISSING_REASON,
      retryable: false,
      surface: "app_build",
      resource: iosDir,
    });
  }

  const schemeListing = Bun.spawnSync(["xcodebuild", ...listArgs], {
    cwd: iosDir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: DEFAULT_JOB_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

  if (schemeListing.exitCode !== 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: APP_BUILD_IOS_TOOLING_MISSING_REASON,
      retryable: false,
      surface: "app_build",
      resource: "xcodebuild",
    });
  }

  const outputText = new TextDecoder().decode(schemeListing.stdout ?? new Uint8Array());
  const schemes = parseXcodeSchemeNames(outputText);
  if (schemes.length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: APP_BUILD_IOS_SCHEME_MISSING_REASON,
      retryable: false,
      surface: "app_build",
      resource: "xcodebuild",
    });
  }

  if (requestedVariant) {
    const hasRequestedScheme = schemes.includes(requestedVariant);
    if (!hasRequestedScheme) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "variant",
        reason: `${APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON} '${requestedVariant}'.`,
        retryable: false,
        surface: "app_build",
        resource: requestedVariant,
      });
    }
  }
}

function parseXcodeSchemeNames(output: string): string[] {
  const lines = output.split(/\r?\n/);
  let inSchemes = false;
  const schemes: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "Schemes:") {
      inSchemes = true;
      continue;
    }
    if (!inSchemes) {
      continue;
    }
    if (line.length === 0) {
      continue;
    }
    if (line.endsWith(":")) {
      break;
    }

    const normalized = line.startsWith("- ") ? line.slice(2).trim() : line.startsWith("-") ? line.slice(1).trim() : line;
    if (normalized.length > 0) {
      schemes.push(normalized);
    }
  }

  return schemes;
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
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "outputDir",
      reason: APP_BUILD_OUTPUT_DIR_TRAVERSE_REASON,
      retryable: false,
      surface: "app_build",
      resource: outputDir,
    });
  }

  await mkdir(normalized, { recursive: true });
}

/** Execute a background build job and persist lifecycle state. */
async function executeAppBuildJob(jobId: string, payload: AppBuildJobPayload): Promise<void> {
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Build started for ${payload.platform} (${payload.buildType})`,
  });

  const repoRoot = resolve(import.meta.dir, "..");
  const scriptName = payload.platform === "android" ? RUN_ANDROID_BUILD_SCRIPT : RUN_IOS_BUILD_SCRIPT;
  const script = join(repoRoot, "..", "scripts", scriptName);
  if (!(await Bun.file(script).exists())) {
    throw new AppBuildExecutionError(`Build script not found: ${script}`, { retryable: false, details: script });
  }
  const args = buildScriptArgs(payload);
  const env = buildBuildScriptEnvironment(payload.correlationId);

  try {
    const proc = Bun.spawn([script, ...args], {
      cwd: repoRoot,
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
      stderr: failureMessage,
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

function buildScriptArgs(payload: AppBuildJobPayload): string[] {
  const args: string[] = [
    `--platform=${payload.platform}`,
    `--build-type=${payload.buildType}`,
  ];

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
