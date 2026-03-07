import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseDeviceAiProtocolProfile,
  type DeviceAiJsonValue,
  type DeviceAiProtocolProfile,
} from "../../../contracts/device-ai-protocol";
import {
  type AppBuildFailureCode,
  type BuildKind,
  type BuildType,
  isSupportedBuildType,
  isSupportedDesktopBuildVariant,
} from "../../../contracts/flow-contracts";
import { createAppBuildFailureError, formatAppBuildFailureMetadata, parseAppBuildFailureMetadata, type AppBuildFailureMetadata } from "../../../shared/app-build-failures";
import { resolveDefaultDesktopBuildVariant } from "../../../shared/app-build";
import {
  APP_BUILD_ANDROID_JAVA_MISSING_REASON,
  APP_BUILD_DESKTOP_BUN_MISSING_REASON,
  APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON,
  APP_BUILD_EXECUTION_FAILED_REASON,
  APP_BUILD_IOS_MAC_ONLY_REASON,
  APP_BUILD_IOS_SCHEME_MISSING_REASON,
  APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON,
  APP_BUILD_IOS_TOOLING_MISSING_REASON,
  APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON,
} from "../../../control-plane/src/config";
import {
  createAndroidSdkEnvironment,
  createJava21Environment,
  ensureAndroidLocalProperties,
  ensureAndroidSdkAvailable,
  ensureJava21Available,
  formatProvisioningDiagnostics,
  resolveAndroidSdkRoot,
} from "../../../shared/host-tooling";
import {
  createAppBuildMatrixReport,
  hasFailedAppBuildMatrix,
  resolveAppBuildMatrixReportDirectory,
  resolveLatestAppBuildMatrixReportPath,
  resolveRunAppBuildMatrixReportPath,
  type AppBuildMatrixReport,
  type AppBuildMatrixStatus,
  type AppBuildPlatform,
  type AppBuildPlatformReport,
} from "../../../shared/app-build-matrix-report";
import { runIosBuildPreflight, type IosBuildProjectKind } from "./ios-build-preflight";
import { runCommand, type CommandResult } from "./subprocess";

/** Root directory of the repository workspace. */
export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** Artifact metadata emitted by the platform build scripts. */
export interface ArtifactMetadata {
  /** Absolute artifact path. */
  readonly artifactPath: string;
  /** SHA-256 checksum for the artifact. */
  readonly artifactSha256: string;
  /** Artifact size in bytes. */
  readonly artifactSizeBytes: number;
  /** Artifact content type. */
  readonly artifactContentType: string;
  /** Artifact creation timestamp. */
  readonly artifactCreatedAt: string;
}

/** Typed report written by the pinned device-AI model download command. */
export interface DeviceAiModelDownloadReport {
  /** Schema version for the report payload. */
  readonly schemaVersion: "1.0";
  /** ISO8601 generation time. */
  readonly generatedAt: string;
  /** Model reference from the effective protocol profile. */
  readonly modelRef: string;
  /** Exact pinned revision used for the download. */
  readonly revision: string;
  /** Downloaded file name. */
  readonly fileName: string;
  /** Absolute run directory where cache/model artifacts were written. */
  readonly runDirectory: string;
  /** Absolute artifact path. */
  readonly artifactPath: string;
  /** Verified SHA-256 checksum. */
  readonly artifactSha256: string;
  /** Artifact size in bytes. */
  readonly artifactSizeBytes: number;
}

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | { readonly [key: string]: JsonValue } | readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };
type JsonDocument = JsonObject | AppBuildMatrixReport | DeviceAiModelDownloadReport;

/** Build execution options accepted by canonical per-platform build owners. */
export interface AppBuildExecutionOptions {
  /** Requested build type. */
  readonly buildType: BuildType;
  /** Optional platform variant or scheme. */
  readonly variant?: string;
  /** Whether unit/integration tests should be skipped. */
  readonly skipTests?: boolean;
  /** Whether a clean build should be forced first. */
  readonly clean?: boolean;
  /** Optional artifact staging directory. */
  readonly outputDir?: string;
  /** Optional correlation id forwarded to artifact metadata. */
  readonly correlationId?: string;
}

interface BootstrapStep {
  readonly label: string;
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly optional?: boolean;
}

const ANDROID_LOCAL_PROPERTIES_FILE = resolve(REPO_ROOT, "Android", "src", "vertu.local.properties");
const ANDROID_LOCAL_PROPERTIES_TEMPLATE = resolve(
  REPO_ROOT,
  "Android",
  "src",
  "vertu.local.properties.example",
);
const FLOW_KIT_DIRECTORY = resolve(REPO_ROOT, "tooling", "vertu-flow-kit");
const ANDROID_PROJECT_DIRECTORY = resolve(REPO_ROOT, "Android", "src");
const ANDROID_APPLICATION_DIRECTORY = resolve(ANDROID_PROJECT_DIRECTORY, "app");
const CONTROL_PLANE_DIRECTORY = resolve(REPO_ROOT, "control-plane");
const IOS_PROJECT_DIRECTORY = resolve(REPO_ROOT, "iOS", "VertuEdge");
const IOS_PACKAGE_SWIFT_PATH = resolve(IOS_PROJECT_DIRECTORY, "Package.swift");
const IOS_DERIVED_DATA_DIRECTORY = resolve(REPO_ROOT, "iOS", "build");
const IOS_ARTIFACT_FALLBACK_DIRECTORY = resolve(REPO_ROOT, ".artifacts", "ios-builds");
const IOS_ARTIFACT_CONTENT_TYPE = "application/zip";
const IOS_ARTIFACT_ARCHIVER = "ditto";
const IOS_XCODE_CORE_SCHEMES = new Set(["VertuEdgeCore", "VertuEdgeDriver", "VertuEdgeUI"]);
const ANDROID_KOTLIN_CACHE_RECOVERY_PATTERNS =
  /StreamCorruptedException|unexpected EOF in middle of data block|Storage .* is already registered|Could not close incremental caches|Incremental compilation was attempted but failed/i;
const ANDROID_CONTENT_TYPE = "application/vnd.android.package-archive";
const DESKTOP_CONTENT_TYPE = "application/octet-stream";

function nowIso(): string {
  return new Date().toISOString();
}

function createRunTimestamp(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function toLowerCaseSha(value: string): string {
  return value.trim().toLowerCase();
}

function getHostOs(): string {
  return process.platform === "darwin"
    ? "Darwin"
    : process.platform === "win32"
      ? "Windows_NT"
      : "Linux";
}

function writeCommandReport(path: string, result: CommandResult): void {
  writeJsonFile(path, {
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function writeBootstrapLine(message: string): void {
  process.stdout.write(`[bootstrap] ${message}\n`);
}

function writeCommandOutput(result: CommandResult): void {
  if (result.stdout.trim().length > 0) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr.trim().length > 0) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

function resolveBuildFailureMetadata(result: CommandResult): AppBuildFailureMetadata | null {
  return parseAppBuildFailureMetadata([result.stdout, result.stderr].join("\n"));
}

function appendText(base: string, suffix: string): string {
  if (!suffix.trim()) {
    return base;
  }
  return base.trim().length > 0 ? `${base}\n${suffix}` : suffix;
}

function createFailureCommandResult(
  command: readonly string[],
  cwd: string,
  metadata: AppBuildFailureMetadata,
  stderrPrefix = "",
): CommandResult {
  return {
    command,
    cwd,
    stdout: "",
    stderr: appendText(stderrPrefix, formatAppBuildFailureMetadata(metadata)),
    exitCode: 1,
    success: false,
  };
}

async function createArtifactMetadata(
  artifactPath: string,
  artifactContentType: string,
  createdAt = nowIso(),
): Promise<ArtifactMetadata> {
  const artifactSha256 = await hashFileSha256(artifactPath);
  const artifactSizeBytes = Bun.file(artifactPath).size;
  return {
    artifactPath,
    artifactSha256,
    artifactSizeBytes,
    artifactContentType,
    artifactCreatedAt: createdAt,
  };
}

function formatArtifactMetadata(metadata: ArtifactMetadata, correlationId?: string): string {
  return [
    `ARTIFACT_PATH=${metadata.artifactPath}`,
    `ARTIFACT_SHA256=${metadata.artifactSha256}`,
    `ARTIFACT_SIZE_BYTES=${metadata.artifactSizeBytes}`,
    `ARTIFACT_CONTENT_TYPE=${metadata.artifactContentType}`,
    `ARTIFACT_CREATED_AT=${metadata.artifactCreatedAt}`,
    `ARTIFACT_METADATA_JSON=${JSON.stringify({
      artifactPath: metadata.artifactPath,
      sha256: metadata.artifactSha256,
      sizeBytes: metadata.artifactSizeBytes,
      createdAt: metadata.artifactCreatedAt,
      contentType: metadata.artifactContentType,
      signature: process.env.VERTU_ARTIFACT_SIGNATURE ?? "",
      correlationId: correlationId ?? process.env.VERTU_CORRELATION_ID ?? "unknown",
    })}`,
  ].join("\n");
}

function stageArtifact(artifactPath: string, outputDirectory: string | undefined): string {
  if (!outputDirectory) {
    return artifactPath;
  }
  ensureDirectory(outputDirectory);
  const stagedPath = resolve(outputDirectory, basename(artifactPath));
  copyFileSync(artifactPath, stagedPath);
  return stagedPath;
}

function buildAndroidGradleTasks(options: AppBuildExecutionOptions): {
  readonly task: string;
  readonly taskLabel: string;
  readonly gradleTasks: readonly string[];
  readonly defaultArtifactPath: string;
} {
  const buildType = options.buildType.toLowerCase();
  if (!isSupportedBuildType(buildType)) {
    throw createAppBuildFailureError({
      code: "app_build_unsupported_build_type",
      command: "buildType",
      category: "validation",
      reason: `${APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON} '${options.buildType}'.`,
      resource: options.buildType,
    });
  }
  const taskLabel = `${buildType.charAt(0).toUpperCase()}${buildType.slice(1)}`;
  const variant = options.variant?.trim();
  const variantLabel = variant ? `${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : "";
  const task = variant ? `:app:assemble${variantLabel}${taskLabel}` : `:app:assemble${taskLabel}`;
  const gradleTasks = [
    ...(options.clean ? [":app:clean"] : []),
    task,
    ...(options.skipTests ? [] : [`:app:test${taskLabel}`]),
  ] as const;
  const defaultArtifactPath = variant
    ? resolve(ANDROID_APPLICATION_DIRECTORY, "build", "outputs", "apk", variant, buildType, `app-${variant}-${buildType}.apk`)
    : resolve(ANDROID_APPLICATION_DIRECTORY, "build", "outputs", "apk", buildType, `app-${buildType}.apk`);
  return {
    task,
    taskLabel,
    gradleTasks,
    defaultArtifactPath,
  };
}

function ensureAndroidLocalPropertiesFile(): void {
  if (existsSync(ANDROID_LOCAL_PROPERTIES_FILE)) {
    return;
  }
  const resolvedSdkRoot = resolveAndroidSdkRoot(process.env);
  if (resolvedSdkRoot) {
    ensureAndroidLocalProperties(REPO_ROOT, resolvedSdkRoot.sdkRoot);
    writeBootstrapLine(`Created Android/src/local.properties from resolved SDK root ${resolvedSdkRoot.sdkRoot}.`);
    return;
  }
  if (!existsSync(ANDROID_LOCAL_PROPERTIES_TEMPLATE)) {
    throw new Error(
      [
        "Android local properties are missing and no template is available.",
        `Expected file: ${ANDROID_LOCAL_PROPERTIES_FILE}`,
        `Expected template: ${ANDROID_LOCAL_PROPERTIES_TEMPLATE}`,
      ].join("\n"),
    );
  }
  copyFileSync(ANDROID_LOCAL_PROPERTIES_TEMPLATE, ANDROID_LOCAL_PROPERTIES_FILE);
  writeBootstrapLine("Created Android/src/vertu.local.properties from template.");
}

/** Read and validate the effective device-AI protocol profile from repo config. */
export function readDeviceAiProtocolProfile(): DeviceAiProtocolProfile {
  const profilePath = resolve(REPO_ROOT, "control-plane", "config", "device-ai-profile.json");
  const raw = readFileSync(profilePath, "utf-8");
  const parsed = JSON.parse(raw) as DeviceAiJsonValue;
  const profile = parseDeviceAiProtocolProfile(parsed);
  if (!profile) {
    throw new Error(`Invalid device AI profile at ${profilePath}`);
  }
  return profile;
}

function resolveModelRepoId(modelRef: string): string {
  return modelRef
    .replace(/^https?:\/\//u, "")
    .replace(/^huggingface\.co\//u, "")
    .replace(/^www\.huggingface\.co\//u, "");
}

async function hashFileSha256(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(filePath).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

function writeJsonFile(path: string, payload: JsonDocument): void {
  ensureDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function copyLatestReport(sourcePath: string, latestPath: string): void {
  ensureDirectory(dirname(latestPath));
  copyFileSync(sourcePath, latestPath);
}

/** Create a stable UUID correlation id for orchestration reports. */
export function createCorrelationId(): string {
  return crypto.randomUUID().toLowerCase();
}

export { resolveDefaultDesktopBuildVariant } from "../../../shared/app-build";

/** Run the canonical Android app build owner with Gradle retry recovery and artifact staging. */
export async function runAndroidBuild(options: AppBuildExecutionOptions): Promise<CommandResult> {
  const command = [process.execPath, "src/cli.ts", "build", "android"] as const;
  if (!isSupportedBuildType(options.buildType)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_unsupported_build_type",
      message: `${APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON} '${options.buildType}'.`,
    });
  }

  const java21Availability = await ensureJava21Available(process.env);
  if (!java21Availability.ok) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_android_java_missing",
      message: APP_BUILD_ANDROID_JAVA_MISSING_REASON,
    }, appendText(java21Availability.message, formatProvisioningDiagnostics(java21Availability.stdout, java21Availability.stderr)));
  }

  const javaEnvironment = createJava21Environment(process.env, java21Availability.data.javaHome);
  const androidSdkAvailability = await ensureAndroidSdkAvailable(javaEnvironment);
  if (!androidSdkAvailability.ok) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_execution_failed",
      message: androidSdkAvailability.message,
    }, formatProvisioningDiagnostics(androidSdkAvailability.stdout, androidSdkAvailability.stderr));
  }

  const androidEnvironment = createAndroidSdkEnvironment(javaEnvironment, androidSdkAvailability.data.sdkRoot);
  ensureAndroidLocalProperties(REPO_ROOT, androidSdkAvailability.data.sdkRoot);

  const plan = buildAndroidGradleTasks(options);
  let result = await runCommand(["./gradlew", "--no-daemon", ...plan.gradleTasks], {
    cwd: ANDROID_PROJECT_DIRECTORY,
    env: androidEnvironment,
  });

  if (!result.success && ANDROID_KOTLIN_CACHE_RECOVERY_PATTERNS.test(`${result.stdout}\n${result.stderr}`)) {
    rmSync(resolve(ANDROID_APPLICATION_DIRECTORY, "build", "kotlin"), { recursive: true, force: true });
    rmSync(resolve(ANDROID_PROJECT_DIRECTORY, "vertu-android-rpa", "build", "kotlin"), { recursive: true, force: true });
    result = await runCommand(["./gradlew", "--no-daemon", "--rerun-tasks", ":app:clean", ...plan.gradleTasks], {
      cwd: ANDROID_PROJECT_DIRECTORY,
      env: androidEnvironment,
    });
  }

  if (!result.success) {
    return result;
  }

  if (!existsSync(plan.defaultArtifactPath)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_execution_failed",
      message: `Android APK not found at ${plan.defaultArtifactPath}.`,
    }, result.stderr);
  }

  const artifactPath = stageArtifact(plan.defaultArtifactPath, options.outputDir);
  const metadata = await createArtifactMetadata(artifactPath, ANDROID_CONTENT_TYPE);
  return {
    ...result,
    stdout: appendText(result.stdout, formatArtifactMetadata(metadata, options.correlationId)),
  };
}

/** Run the canonical desktop app build owner with Bun-native compilation and artifact staging. */
export async function runDesktopBuild(options: AppBuildExecutionOptions): Promise<CommandResult> {
  const command = [process.execPath, "src/cli.ts", "build", "desktop"] as const;
  if (!isSupportedBuildType(options.buildType)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_unsupported_build_type",
      message: `${APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON} '${options.buildType}'.`,
    });
  }
  if (Bun.which("bun") === null) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_desktop_bun_missing",
      message: APP_BUILD_DESKTOP_BUN_MISSING_REASON,
    });
  }

  const resolvedVariant = options.variant?.trim() || resolveDefaultDesktopBuildVariant(process.platform, process.arch);
  if (!resolvedVariant || !isSupportedDesktopBuildVariant(resolvedVariant)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_desktop_variant_unsupported",
      message: `${APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON} '${options.variant ?? `${process.platform}/${process.arch}`}'.`,
    });
  }

  if (options.clean) {
    rmSync(resolve(CONTROL_PLANE_DIRECTORY, "dist"), { recursive: true, force: true });
  }

  let stdout = "";
  let stderr = "";
  if (!options.skipTests) {
    const testResult = await runCommand(["bun", "test"], { cwd: CONTROL_PLANE_DIRECTORY });
    stdout = appendText(stdout, testResult.stdout);
    stderr = appendText(stderr, testResult.stderr);
    if (!testResult.success) {
      return {
        command,
        cwd: CONTROL_PLANE_DIRECTORY,
        stdout,
        stderr,
        exitCode: testResult.exitCode,
        success: false,
      };
    }
  }

  const outfileName = resolvedVariant === "windows-x64" ? `vertu-cp-${resolvedVariant}.exe` : `vertu-cp-${resolvedVariant}`;
  const artifactPath = resolve(CONTROL_PLANE_DIRECTORY, "dist", outfileName);
  ensureDirectory(dirname(artifactPath));
  const buildArguments = [
    "build",
    "--compile",
    "--target",
    `bun-${resolvedVariant}`,
    "--outfile",
    artifactPath,
    resolve(CONTROL_PLANE_DIRECTORY, "src", "index.ts"),
    ...(options.buildType === "release" ? ["--minify-whitespace", "--minify-syntax"] : []),
  ] as const;
  const buildResult = await runCommand(["bun", ...buildArguments], { cwd: REPO_ROOT });
  stdout = appendText(stdout, buildResult.stdout);
  stderr = appendText(stderr, buildResult.stderr);
  if (!buildResult.success) {
    return {
      command,
      cwd: REPO_ROOT,
      stdout,
      stderr,
      exitCode: buildResult.exitCode,
      success: false,
    };
  }
  if (!existsSync(artifactPath)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_execution_failed",
      message: `Desktop build artifact was not produced at ${artifactPath}.`,
    }, stderr);
  }

  const stagedArtifactPath = stageArtifact(artifactPath, options.outputDir);
  const metadata = await createArtifactMetadata(stagedArtifactPath, DESKTOP_CONTENT_TYPE);
  return {
    command,
    cwd: CONTROL_PLANE_DIRECTORY,
    stdout: appendText(stdout, formatArtifactMetadata(metadata, options.correlationId)),
    stderr,
    exitCode: 0,
    success: true,
  };
}

interface XcodeEnvironment {
  readonly developerDir: string;
  readonly xcodebuildBin: string;
}

interface IosProjectContainer {
  readonly projectKind: IosBuildProjectKind;
  readonly projectPath: string;
}

function findFirstDirectoryWithSuffix(rootPath: string, suffix: string, remainingDepth: number): string | null {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const candidatePath = join(rootPath, entry.name);
    if (entry.name.endsWith(suffix)) {
      return candidatePath;
    }
    if (
      entry.isDirectory()
      && remainingDepth > 0
      && !entry.name.endsWith(".app")
      && !entry.name.endsWith(".xcodeproj")
      && !entry.name.endsWith(".xcworkspace")
    ) {
      const nestedMatch = findFirstDirectoryWithSuffix(candidatePath, suffix, remainingDepth - 1);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }
  return null;
}

function resolveIosProjectContainer(): IosProjectContainer | null {
  const workspacePath = findFirstDirectoryWithSuffix(IOS_PROJECT_DIRECTORY, ".xcworkspace", 1);
  if (workspacePath) {
    return {
      projectKind: "-workspace",
      projectPath: workspacePath,
    };
  }
  const projectPath = findFirstDirectoryWithSuffix(IOS_PROJECT_DIRECTORY, ".xcodeproj", 1);
  if (!projectPath) {
    return null;
  }
  return {
    projectKind: "-project",
    projectPath,
  };
}

async function resolveXcodeEnvironment(): Promise<XcodeEnvironment | null> {
  const candidates: string[] = [];
  const developerDirOverride = process.env.DEVELOPER_DIR?.trim();
  if (developerDirOverride) {
    candidates.push(developerDirOverride);
  }

  const selectionResult = await runCommand(["xcode-select", "-p"], { cwd: REPO_ROOT });
  if (selectionResult.success) {
    const selectedDeveloperDir = selectionResult.stdout.trim();
    if (selectedDeveloperDir) {
      candidates.push(selectedDeveloperDir);
    }
  }

  if (existsSync("/Applications")) {
    for (const entry of readdirSync("/Applications", { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("Xcode") || !entry.name.endsWith(".app")) {
        continue;
      }
      candidates.push(join("/Applications", entry.name, "Contents", "Developer"));
    }
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const xcodebuildBin = join(candidate, "usr", "bin", "xcodebuild");
    if (!existsSync(xcodebuildBin)) {
      continue;
    }
    const versionResult = await runCommand([xcodebuildBin, "-version"], {
      cwd: REPO_ROOT,
      env: { DEVELOPER_DIR: candidate },
    });
    if (versionResult.success) {
      return {
        developerDir: candidate,
        xcodebuildBin,
      };
    }
  }
  return null;
}

function parseXcodeSchemes(output: string): readonly string[] {
  const schemes: string[] = [];
  let insideSchemes = false;
  for (const rawLine of output.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();
    if (!insideSchemes) {
      if (trimmedLine === "Schemes:") {
        insideSchemes = true;
      }
      continue;
    }
    if (trimmedLine.length === 0) {
      continue;
    }
    if (trimmedLine.endsWith(":")) {
      break;
    }
    const normalized = trimmedLine.startsWith("-") ? trimmedLine.slice(1).trim() : trimmedLine;
    if (normalized.length > 0) {
      schemes.push(normalized);
    }
  }
  return schemes;
}

function resolveIosScheme(
  availableSchemes: readonly string[],
  requestedVariant: string | undefined,
): { readonly ok: true; readonly scheme: string } | { readonly ok: false; readonly code: AppBuildFailureCode; readonly message: string } {
  const requestedScheme = requestedVariant?.trim();
  if (requestedScheme) {
    if (availableSchemes.includes(requestedScheme)) {
      return { ok: true, scheme: requestedScheme };
    }
    return {
      ok: false,
      code: "app_build_ios_scheme_not_found",
      message: `${APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON} '${requestedScheme}'.`,
    };
  }

  if (availableSchemes.includes("VertuEdgeHost")) {
    return { ok: true, scheme: "VertuEdgeHost" };
  }
  for (const scheme of availableSchemes) {
    if (!IOS_XCODE_CORE_SCHEMES.has(scheme)) {
      return { ok: true, scheme };
    }
  }
  const [firstAvailableScheme] = availableSchemes;
  if (firstAvailableScheme) {
    return { ok: true, scheme: firstAvailableScheme };
  }
  return {
    ok: false,
    code: "app_build_ios_scheme_missing",
    message: APP_BUILD_IOS_SCHEME_MISSING_REASON,
  };
}

function resolveIosArchivePath(archiveName: string, outputDir: string | undefined): string {
  const archiveDirectory = outputDir ? resolve(outputDir) : IOS_ARTIFACT_FALLBACK_DIRECTORY;
  ensureDirectory(archiveDirectory);
  return resolve(archiveDirectory, archiveName);
}

async function runXcodebuild(
  environment: XcodeEnvironment,
  args: readonly string[],
): Promise<CommandResult> {
  return runCommand([environment.xcodebuildBin, ...args], {
    cwd: REPO_ROOT,
    env: {
      DEVELOPER_DIR: environment.developerDir,
    },
  });
}

async function archivePathWithDitto(sourcePath: string, archivePath: string): Promise<CommandResult> {
  rmSync(archivePath, { force: true });
  return runCommand([IOS_ARTIFACT_ARCHIVER, "-c", "-k", "--keepParent", sourcePath, archivePath], {
    cwd: REPO_ROOT,
  });
}

function combineCommandOutput(result: CommandResult): string {
  return [result.stdout, result.stderr].filter((value) => value.trim().length > 0).join("\n");
}

/** Run the canonical iOS app build owner with typed Xcode/SwiftPM execution and artifact staging. */
export async function runIosBuild(options: AppBuildExecutionOptions): Promise<CommandResult> {
  const command = [process.execPath, "src/cli.ts", "build", "ios"] as const;
  if (!isSupportedBuildType(options.buildType)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_unsupported_build_type",
      message: `${APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON} '${options.buildType}'.`,
    });
  }

  if (process.platform !== "darwin") {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_ios_mac_only",
      message: APP_BUILD_IOS_MAC_ONLY_REASON,
    });
  }

  const projectContainer = resolveIosProjectContainer();
  const hasSwiftPackage = existsSync(IOS_PACKAGE_SWIFT_PATH);
  if (!projectContainer && !hasSwiftPackage) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_execution_failed",
      message: `${APP_BUILD_EXECUTION_FAILED_REASON} Unable to locate an Xcode project, workspace, or Package.swift under ${IOS_PROJECT_DIRECTORY}.`,
    });
  }

  const xcodeEnvironment = projectContainer ? await resolveXcodeEnvironment() : null;
  if (projectContainer && !xcodeEnvironment) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_ios_tooling_missing",
      message: APP_BUILD_IOS_TOOLING_MISSING_REASON,
    });
  }

  let stdout = "";
  let stderr = "";
  if (projectContainer && xcodeEnvironment) {
    const schemeListResult = await runXcodebuild(xcodeEnvironment, [
      projectContainer.projectKind,
      projectContainer.projectPath,
      "-list",
    ]);
    stdout = appendText(stdout, schemeListResult.stdout);
    stderr = appendText(stderr, schemeListResult.stderr);
    if (!schemeListResult.success) {
      return {
        command,
        cwd: REPO_ROOT,
        stdout,
        stderr: appendText(stderr, formatAppBuildFailureMetadata({
          code: "app_build_execution_failed",
          message: `${APP_BUILD_EXECUTION_FAILED_REASON} Unable to enumerate schemes for ${projectContainer.projectPath}.`,
        })),
        exitCode: schemeListResult.exitCode,
        success: false,
      };
    }

    const schemeResolution = resolveIosScheme(parseXcodeSchemes(schemeListResult.stdout), options.variant);
    if (!schemeResolution.ok) {
      return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
        code: schemeResolution.code,
        message: schemeResolution.message,
      }, stderr);
    }

    const preflight = await runIosBuildPreflight({
      buildType: options.buildType,
      projectKind: projectContainer.projectKind,
      projectPath: projectContainer.projectPath,
      scheme: schemeResolution.scheme,
      developerDir: xcodeEnvironment.developerDir,
      xcodebuildBin: xcodeEnvironment.xcodebuildBin,
    });
    if (!preflight.ok) {
      const preflightOutput = combineCommandOutput(preflight.error.commandResult);
      return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
        code: preflight.error.code,
        message: preflight.error.message,
      }, appendText(stderr, preflightOutput));
    }

    const configuration = `${options.buildType.charAt(0).toUpperCase()}${options.buildType.slice(1)}`;
    const buildArgs = [
      projectContainer.projectKind,
      projectContainer.projectPath,
      "-scheme",
      schemeResolution.scheme,
      "-configuration",
      configuration,
      "-sdk",
      options.buildType === "release" ? "iphoneos" : "iphonesimulator",
      "-derivedDataPath",
      IOS_DERIVED_DATA_DIRECTORY,
      ...(options.buildType === "debug" ? ["-destination", "generic/platform=iOS Simulator"] : []),
    ] as const;

    if (options.clean) {
      const cleanResult = await runXcodebuild(xcodeEnvironment, [...buildArgs, "clean"]);
      stdout = appendText(stdout, cleanResult.stdout);
      stderr = appendText(stderr, cleanResult.stderr);
      if (!cleanResult.success) {
        return {
          command,
          cwd: REPO_ROOT,
          stdout,
          stderr,
          exitCode: cleanResult.exitCode,
          success: false,
        };
      }
    }

    const buildResult = await runXcodebuild(xcodeEnvironment, [...buildArgs, "build"]);
    stdout = appendText(stdout, buildResult.stdout);
    stderr = appendText(stderr, buildResult.stderr);
    if (!buildResult.success) {
      return {
        command,
        cwd: REPO_ROOT,
        stdout,
        stderr,
        exitCode: buildResult.exitCode,
        success: false,
      };
    }

    const appBundlePath = findFirstDirectoryWithSuffix(IOS_DERIVED_DATA_DIRECTORY, ".app", 6);
    if (!appBundlePath) {
      return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
        code: "app_build_execution_failed",
        message: `${APP_BUILD_EXECUTION_FAILED_REASON} Unable to locate the built .app bundle in ${IOS_DERIVED_DATA_DIRECTORY}.`,
      }, stderr);
    }

    const archivePath = resolveIosArchivePath(`${basename(appBundlePath, ".app")}.zip`, options.outputDir);
    const archiveResult = await archivePathWithDitto(appBundlePath, archivePath);
    stdout = appendText(stdout, archiveResult.stdout);
    stderr = appendText(stderr, archiveResult.stderr);
    if (!archiveResult.success || !existsSync(archivePath)) {
      return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
        code: "app_build_execution_failed",
        message: `${APP_BUILD_EXECUTION_FAILED_REASON} Unable to package the iOS app artifact at ${archivePath}.`,
      }, stderr);
    }

    if (!options.skipTests && hasSwiftPackage) {
      const swiftTestResult = await runCommand(["swift", "test"], { cwd: IOS_PROJECT_DIRECTORY });
      stdout = appendText(stdout, swiftTestResult.stdout);
      stderr = appendText(stderr, swiftTestResult.stderr);
      if (!swiftTestResult.success) {
        return {
          command,
          cwd: IOS_PROJECT_DIRECTORY,
          stdout,
          stderr,
          exitCode: swiftTestResult.exitCode,
          success: false,
        };
      }
    }

    const metadata = await createArtifactMetadata(archivePath, IOS_ARTIFACT_CONTENT_TYPE);
    return {
      command,
      cwd: IOS_PROJECT_DIRECTORY,
      stdout: appendText(stdout, formatArtifactMetadata(metadata, options.correlationId)),
      stderr,
      exitCode: 0,
      success: true,
    };
  }

  const swiftBinary = Bun.which("swift");
  if (swiftBinary === null) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_ios_tooling_missing",
      message: APP_BUILD_IOS_TOOLING_MISSING_REASON,
    });
  }

  if (options.clean) {
    const cleanResult = await runCommand(["swift", "package", "clean"], { cwd: IOS_PROJECT_DIRECTORY });
    if (!cleanResult.success) {
      return {
        command,
        cwd: IOS_PROJECT_DIRECTORY,
        stdout: cleanResult.stdout,
        stderr: cleanResult.stderr,
        exitCode: cleanResult.exitCode,
        success: false,
      };
    }
  }

  const buildResult = await runCommand([
    "swift",
    "build",
    "--configuration",
    options.buildType,
  ], { cwd: IOS_PROJECT_DIRECTORY });
  stdout = appendText(stdout, buildResult.stdout);
  stderr = appendText(stderr, buildResult.stderr);
  if (!buildResult.success) {
    return {
      command,
      cwd: IOS_PROJECT_DIRECTORY,
      stdout,
      stderr,
      exitCode: buildResult.exitCode,
      success: false,
    };
  }

  if (!options.skipTests) {
    const swiftTestResult = await runCommand(["swift", "test"], { cwd: IOS_PROJECT_DIRECTORY });
    stdout = appendText(stdout, swiftTestResult.stdout);
    stderr = appendText(stderr, swiftTestResult.stderr);
    if (!swiftTestResult.success) {
      return {
        command,
        cwd: IOS_PROJECT_DIRECTORY,
        stdout,
        stderr,
        exitCode: swiftTestResult.exitCode,
        success: false,
      };
    }
  }

  const swiftBuildDirectory = existsSync(resolve(IOS_PROJECT_DIRECTORY, ".build", options.buildType))
    ? resolve(IOS_PROJECT_DIRECTORY, ".build", options.buildType)
    : resolve(IOS_PROJECT_DIRECTORY, ".build");
  const archivePath = resolveIosArchivePath(`VertuEdge-swiftpm-${options.buildType}.zip`, options.outputDir);
  const archiveResult = await archivePathWithDitto(swiftBuildDirectory, archivePath);
  stdout = appendText(stdout, archiveResult.stdout);
  stderr = appendText(stderr, archiveResult.stderr);
  if (!archiveResult.success || !existsSync(archivePath)) {
    return createFailureCommandResult(command, FLOW_KIT_DIRECTORY, {
      code: "app_build_execution_failed",
      message: `${APP_BUILD_EXECUTION_FAILED_REASON} Unable to package the SwiftPM artifact at ${archivePath}.`,
    }, stderr);
  }

  const metadata = await createArtifactMetadata(archivePath, IOS_ARTIFACT_CONTENT_TYPE);
  return {
    command,
    cwd: IOS_PROJECT_DIRECTORY,
    stdout: appendText(stdout, formatArtifactMetadata(metadata, options.correlationId)),
    stderr,
    exitCode: 0,
    success: true,
  };
}

/** Run one platform build through the canonical typed app-build owner. */
export async function runAppBuildPlatform(
  platform: BuildKind,
  options: AppBuildExecutionOptions,
): Promise<CommandResult> {
  if (platform === "android") {
    return runAndroidBuild(options);
  }
  if (platform === "desktop") {
    return runDesktopBuild(options);
  }
  return runIosBuild(options);
}

/** Parse key-value artifact metadata emitted by platform build scripts. */
export function parseArtifactMetadata(output: string): ArtifactMetadata | null {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key.length === 0 || value.length === 0) {
      continue;
    }
    fields.set(key, value);
  }

  const artifactPath = fields.get("ARTIFACT_PATH");
  const artifactSha256 = fields.get("ARTIFACT_SHA256");
  const artifactSizeBytesRaw = fields.get("ARTIFACT_SIZE_BYTES");
  const artifactContentType = fields.get("ARTIFACT_CONTENT_TYPE");
  const artifactCreatedAt = fields.get("ARTIFACT_CREATED_AT");
  if (!artifactPath || !artifactSha256 || !artifactSizeBytesRaw || !artifactContentType || !artifactCreatedAt) {
    return null;
  }

  const artifactSizeBytes = Number.parseInt(artifactSizeBytesRaw, 10);
  if (!Number.isFinite(artifactSizeBytes) || artifactSizeBytes < 0) {
    return null;
  }

  return {
    artifactPath,
    artifactSha256,
    artifactSizeBytes,
    artifactContentType,
    artifactCreatedAt,
  };
}

/** Run the host-aware Android+iOS+desktop build matrix and persist a deterministic report. */
export async function runAppBuildMatrix(): Promise<AppBuildMatrixReport> {
  const runTimestamp = createRunTimestamp();
  const reportRoot = resolveAppBuildMatrixReportDirectory(
    REPO_ROOT,
    process.env.VERTU_APP_BUILD_REPORT_DIR,
  );
  const runDirectory = resolve(reportRoot, runTimestamp);
  const reportPath = resolveRunAppBuildMatrixReportPath(runDirectory);
  const latestPath = resolveLatestAppBuildMatrixReportPath(REPO_ROOT, reportRoot);
  const correlationId = createCorrelationId();
  ensureDirectory(runDirectory);
  const artifactDirectory = resolve(runDirectory, "artifacts");
  const androidArtifactDirectory = resolve(artifactDirectory, "android");
  const iosArtifactDirectory = resolve(artifactDirectory, "ios");
  const desktopArtifactDirectory = resolve(artifactDirectory, "desktop");
  ensureDirectory(androidArtifactDirectory);
  ensureDirectory(iosArtifactDirectory);
  ensureDirectory(desktopArtifactDirectory);

  const androidLogPath = resolve(runDirectory, "android-build.log");
  const iosLogPath = resolve(runDirectory, "ios-build.log");
  const desktopLogPath = resolve(runDirectory, "desktop-build.log");
  const hostOs = getHostOs();
  const iosBuildMode = process.env.VERTU_IOS_BUILD_MODE?.trim() || "native";
  const desktopVariant = resolveDefaultDesktopBuildVariant(process.platform, process.arch);
  const androidResult = await runAndroidBuild({
    buildType: "debug",
    skipTests: true,
    outputDir: androidArtifactDirectory,
    correlationId,
  });
  writeCommandReport(androidLogPath, androidResult);
  const androidMetadata = parseArtifactMetadata(androidResult.stdout);
  const androidFailure = resolveBuildFailureMetadata(androidResult);
  const androidReport = buildPlatformReport(
    "android",
    androidResult.success ? "pass" : "fail",
    androidResult.success ? "Android debug build completed" : (androidFailure?.message ?? "Android debug build failed"),
    androidLogPath,
    androidMetadata,
    androidFailure,
  );

  let iosReport: AppBuildPlatformReport;
  if (iosBuildMode === "delegate") {
    writeJsonFile(iosLogPath, {
      delegated: true,
      reason: "VERTU_IOS_BUILD_MODE=delegate",
    });
    iosReport = {
      platform: "ios",
      status: "delegated",
      message: "iOS build delegated by VERTU_IOS_BUILD_MODE=delegate. Use the macOS CI host-build job or a remote Mac builder.",
      logPath: iosLogPath,
    };
  } else if (hostOs !== "Darwin") {
    writeJsonFile(iosLogPath, {
      delegated: true,
      reason: "Host is not macOS",
    });
    iosReport = {
      platform: "ios",
      status: "delegated",
      message: "iOS builds require macOS + Xcode; use the macOS CI host-build job or a remote Mac builder.",
      logPath: iosLogPath,
    };
  } else {
    const iosResult = await runIosBuild({
      buildType: "debug",
      skipTests: true,
      outputDir: iosArtifactDirectory,
      correlationId,
    });
    writeCommandReport(iosLogPath, iosResult);
    const iosMetadata = parseArtifactMetadata(iosResult.stdout);
    const iosFailure = resolveBuildFailureMetadata(iosResult);
    iosReport = buildPlatformReport(
      "ios",
      iosResult.success ? "pass" : "fail",
      iosResult.success ? "iOS debug build completed" : (iosFailure?.message ?? "iOS debug build failed"),
      iosLogPath,
      iosMetadata,
      iosFailure,
    );
  }

  let desktopReport: AppBuildPlatformReport;
  if (!desktopVariant) {
    writeJsonFile(desktopLogPath, {
      delegated: true,
      reason: `Unsupported desktop build host variant: ${process.platform}/${process.arch}`,
    });
    desktopReport = {
      platform: "desktop",
      status: "delegated",
      message: `Desktop build delegated because ${process.platform}/${process.arch} does not map to a supported desktop artifact variant.`,
      logPath: desktopLogPath,
    };
  } else {
    const desktopResult = await runDesktopBuild({
      buildType: "debug",
      variant: desktopVariant,
      skipTests: true,
      outputDir: desktopArtifactDirectory,
      correlationId,
    });
    writeCommandReport(desktopLogPath, desktopResult);
    const desktopMetadata = parseArtifactMetadata(desktopResult.stdout);
    const desktopFailure = resolveBuildFailureMetadata(desktopResult);
    desktopReport = buildPlatformReport(
      "desktop",
      desktopResult.success ? "pass" : "fail",
      desktopResult.success
        ? `Desktop debug build completed (${desktopVariant})`
        : (desktopFailure?.message ?? `Desktop debug build failed (${desktopVariant})`),
      desktopLogPath,
      desktopMetadata,
      desktopFailure,
    );
  }

  const report = createAppBuildMatrixReport(correlationId, hostOs, {
    android: androidReport,
    ios: iosReport,
    desktop: desktopReport,
  }, nowIso());

  writeJsonFile(reportPath, report);
  copyLatestReport(reportPath, latestPath);
  process.stdout.write(`App build report written to: ${reportPath}\n`);
  process.stdout.write(`Latest app build report: ${latestPath}\n`);

  if (hasFailedAppBuildMatrix(report)) {
    throw new Error("App build matrix failed");
  }
  return report;
}

function buildPlatformReport(
  platform: AppBuildPlatform,
  status: AppBuildMatrixStatus,
  message: string,
  logPath: string,
  artifact: ArtifactMetadata | null,
  failure: AppBuildFailureMetadata | null,
): AppBuildPlatformReport {
  if (!artifact) {
    return {
      platform,
      status,
      message,
      logPath,
      ...(status === "fail" && failure
        ? {
          failureCode: failure.code,
          failureMessage: failure.message,
        }
        : {}),
    };
  }
  return {
    platform,
    status,
    message,
    logPath,
    ...(status === "fail" && failure
      ? {
        failureCode: failure.code,
        failureMessage: failure.message,
      }
      : {}),
    artifactPath: artifact.artifactPath,
    artifactSha256: artifact.artifactSha256,
  };
}

function createBootstrapSteps(): readonly BootstrapStep[] {
  return [
    {
      label: "Installing control-plane dependencies",
      command: ["bun", "install"],
      cwd: resolve(REPO_ROOT, "control-plane"),
    },
    {
      label: "Installing flow-kit dependencies",
      command: ["bun", "install"],
      cwd: resolve(REPO_ROOT, "tooling", "vertu-flow-kit"),
    },
  ];
}

/** Bootstrap repo dependencies and run the canonical typed verification path. */
export async function runBootstrap(): Promise<void> {
  ensureAndroidLocalPropertiesFile();
  for (const step of createBootstrapSteps()) {
    writeBootstrapLine(step.label);
    const result = await runCommand(step.command, {
      ...(step.cwd ? { cwd: step.cwd } : {}),
      ...(step.env ? { env: step.env } : {}),
    });
    writeCommandOutput(result);
    if (!result.success) {
      if (step.optional) {
        writeBootstrapLine(`Optional step failed and was skipped: ${step.label}`);
        continue;
      }
      throw new Error(`${step.label} failed (exit ${result.exitCode})`);
    }
  }

  writeBootstrapLine("Running canonical typed verification");
  const verificationResult = await runCommand(["bun", "src/cli.ts", "verify", "all"], {
    cwd: resolve(REPO_ROOT, "tooling", "vertu-flow-kit"),
  });
  writeCommandOutput(verificationResult);
  if (!verificationResult.success) {
    throw new Error(`Canonical typed verification failed (exit ${verificationResult.exitCode})`);
  }

  writeBootstrapLine("Bootstrap complete");
}

/** Download the pinned device-AI model from Hugging Face and verify its checksum. */
export async function downloadPinnedDeviceAiModel(): Promise<DeviceAiModelDownloadReport> {
  const profile = readDeviceAiProtocolProfile();
  const repoId = resolveModelRepoId(profile.requiredModelRef);
  const outputRoot = process.env.VERTU_DEVICE_AI_DOWNLOAD_DIR?.trim()
    || resolve(REPO_ROOT, ".artifacts", "model-downloads");
  const runTimestamp = createRunTimestamp();
  const runDirectory = resolve(outputRoot, `${runTimestamp}-autoglm-phone`);
  const localDirectory = resolve(runDirectory, "model");
  const cacheDirectory = resolve(runDirectory, "cache");
  const stateDirectory = resolve(runDirectory, "state");
  const reportPath = resolve(runDirectory, "download-report.json");
  const latestPath = resolve(outputRoot, "latest.json");
  const hfExecutable = Bun.which("hf");

  if (!hfExecutable) {
    throw new Error("hf CLI is required. Install huggingface_hub CLI before downloading the device AI model.");
  }

  ensureDirectory(localDirectory);
  ensureDirectory(cacheDirectory);
  ensureDirectory(stateDirectory);

  process.stdout.write(
    [
      `REPO_ID=${repoId}`,
      `REVISION=${profile.revision}`,
      `FILE_NAME=${profile.requiredModelFile}`,
      `RUN_DIR=${runDirectory}`,
    ].join("\n") + "\n",
  );

  const downloadResult = await runCommand(
    [
      hfExecutable,
      "download",
      repoId,
      profile.requiredModelFile,
      "--repo-type",
      "model",
      "--revision",
      profile.revision,
      "--local-dir",
      localDirectory,
    ],
    {
      env: {
        HF_HOME: stateDirectory,
        HF_HUB_CACHE: cacheDirectory,
      },
    },
  );

  if (!downloadResult.success) {
    process.stderr.write(downloadResult.stdout);
    process.stderr.write(downloadResult.stderr);
    throw new Error("Pinned device AI model download failed");
  }

  const artifactPath = resolve(localDirectory, profile.requiredModelFile);
  if (!existsSync(artifactPath)) {
    throw new Error(`Expected model artifact was not written to ${artifactPath}.`);
  }

  const artifactSha256 = await hashFileSha256(artifactPath);
  if (toLowerCaseSha(artifactSha256) !== toLowerCaseSha(profile.requiredModelSha256)) {
    throw new Error(
      [
        `Model checksum mismatch for ${artifactPath}.`,
        `Expected: ${profile.requiredModelSha256}`,
        `Actual:   ${artifactSha256}`,
      ].join("\n"),
    );
  }

  const artifactSizeBytes = Bun.file(artifactPath).size;
  const report: DeviceAiModelDownloadReport = {
    schemaVersion: "1.0",
    generatedAt: nowIso(),
    modelRef: profile.requiredModelRef,
    revision: profile.revision,
    fileName: profile.requiredModelFile,
    runDirectory,
    artifactPath,
    artifactSha256,
    artifactSizeBytes,
  };

  writeJsonFile(reportPath, report);
  copyLatestReport(reportPath, latestPath);
  process.stdout.write(`ARTIFACT_PATH=${artifactPath}\n`);
  process.stdout.write(`ARTIFACT_SHA256=${artifactSha256}\n`);
  process.stdout.write(`ARTIFACT_SIZE_BYTES=${artifactSizeBytes}\n`);
  process.stdout.write(`ARTIFACT_CREATED_AT=${report.generatedAt}\n`);
  process.stdout.write(`REPORT_PATH=${reportPath}\n`);
  return report;
}
