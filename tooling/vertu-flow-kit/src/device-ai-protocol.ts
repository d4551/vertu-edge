import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import canonicalProviderRegistryJson from "../../../control-plane/config/providers.json" with { type: "json" };
import type {
  DeviceAiCapability,
  DeviceAiProtocolProfile,
  DeviceAiProtocolRunReport,
  DeviceAiRuntimeProbeResult,
  DeviceAiStageReport,
  DeviceAiStageStatus,
} from "../../../contracts/device-ai-protocol";
import { readStringEnv, safeParseJson, isJsonRecord, toTrimmedString, type JsonValue } from "../../../control-plane/src/config/env";
import type { DeviceAiReadinessEnvironment } from "../../../shared/device-ai-readiness";
import {
  isSimctlAvailable,
  resolveAdbExecutablePath,
  resolveDeveloperDirForSimctl,
} from "../../../shared/host-tooling";
import {
  readLatestAppBuildMatrixReport,
} from "../../../shared/app-build-matrix-report";
import { validateDeviceAiReportFile } from "./commands";
import { REPO_ROOT, createCorrelationId, readDeviceAiProtocolProfile } from "./orchestration";
import { runCommand } from "./subprocess";

const DEVICE_AI_REPORT_SCHEMA_VERSION = "1.0" as const;
const DEVICE_AI_PROTOCOL_REPORT_FILE = "latest.json";
const DEVICE_AI_REPORT_ROOT = resolve(REPO_ROOT, ".artifacts", "device-ai");
const DEVICE_AI_MODEL_DIR_FALLBACK = "vertu-device-ai/models";
const DEVICE_AI_REPORT_DIR_FALLBACK = "vertu-device-ai/reports";
const DEVICE_AI_PROTOCOL_TIMEOUT_MS_FALLBACK = 900_000;
const DEVICE_AI_REPORT_MAX_AGE_MINUTES_FALLBACK = 240;
const ANDROID_APPLICATION_ID_FALLBACK = "com.vertu.edge";
const ANDROID_DEEP_LINK_SCHEME_FALLBACK = "com.vertu.edge";
const IOS_HOST_BUNDLE_ID_FALLBACK = "com.vertu.edge.ios.host";
const IOS_REPORT_STAGE_PREFIX = "ios-";
const ANDROID_REPORT_STAGE_PREFIX = "android-";
const RUNTIME_PROBE_TIMEOUT_MS = 10_000;
const NATIVE_REPORT_POLL_INTERVAL_MS = 2_000;
const ANDROID_BUILD_GRADLE_PATH = resolve(REPO_ROOT, "Android", "src", "app", "build.gradle.kts");
const IOS_PROJECT_FILE = resolve(REPO_ROOT, "iOS", "VertuEdge", "VertuEdgeHost.xcodeproj", "project.pbxproj");
const OLLAMA_DEFAULT_BASE_URL = readStringEnv(
  "OLLAMA_DEFAULT_BASE_URL",
  (() => {
    if (!Array.isArray(canonicalProviderRegistryJson)) {
      throw new Error("control-plane/config/providers.json must export a provider array.");
    }
    const configuredOllamaBaseUrl = canonicalProviderRegistryJson.find((entry) =>
      isJsonRecord(entry)
      && toTrimmedString(entry.id).toLowerCase() === "ollama"
      && toTrimmedString(entry.baseUrl).length > 0)
      ?.[`baseUrl`];
    const normalizedBaseUrl = toTrimmedString(configuredOllamaBaseUrl);
    if (!normalizedBaseUrl) {
      throw new Error("control-plane/config/providers.json must define an Ollama provider baseUrl.");
    }
    return normalizedBaseUrl;
  })(),
);

/** Structured artifact metadata read from native platform protocol reports. */
export interface DeviceAiNativeArtifactSnapshot {
  /** Absolute artifact path in app-managed storage. */
  readonly path: string;
  /** SHA-256 digest for the artifact. */
  readonly sha256: string;
  /** Artifact size in bytes. */
  readonly sizeBytes: number;
}

/** Normalized native Android stage snapshot. */
export interface DeviceAiAndroidNativeStageSnapshot {
  /** Stable stage name emitted by the Android native runner. */
  readonly name: string;
  /** Terminal native status string. */
  readonly status: string;
  /** Stable native code emitted by the runner. */
  readonly code: string;
  /** Human-readable stage summary. */
  readonly message: string;
}

/** Normalized native Android protocol report consumed by the host orchestrator. */
export interface DeviceAiAndroidNativeReportSnapshot {
  /** Global correlation id for the native Android run. */
  readonly correlationId: string;
  /** Terminal stage status emitted by Android. */
  readonly status: string;
  /** Terminal flow execution state emitted by Android. */
  readonly state: string;
  /** Stable terminal result code. */
  readonly code: string;
  /** Human-readable terminal message. */
  readonly message: string;
  /** Native run start timestamp in epoch milliseconds. */
  readonly startedAtEpochMs: number;
  /** Native run completion timestamp in epoch milliseconds. */
  readonly completedAtEpochMs: number;
  /** Optional artifact metadata written by Android. */
  readonly artifact: DeviceAiNativeArtifactSnapshot | null;
  /** Optional resolved model evidence written by Android. */
  readonly model: {
    /** Model reference resolved by the Android allowlist. */
    readonly modelRef: string;
    /** Revision resolved by the Android allowlist. */
    readonly revision: string;
    /** File name staged by the Android runner. */
    readonly fileName: string;
    /** Expected SHA-256 declared by the Android allowlist entry. */
    readonly expectedSha256: string;
    /** Human-readable allowlist model name. */
    readonly resolvedModelName: string;
    /** Canonical capability set emitted by the resolved Android allowlist entry. */
    readonly capabilities: readonly DeviceAiCapability[];
  } | null;
  /** Ordered native stages. */
  readonly stages: readonly DeviceAiAndroidNativeStageSnapshot[];
}

/** Normalized native iOS stage snapshot. */
export interface DeviceAiIosNativeStageSnapshot {
  /** Stable stage name emitted by the iOS native runner. */
  readonly stage: string;
  /** Terminal native status string. */
  readonly status: string;
  /** Correlation id for the native iOS stage. */
  readonly correlationId: string;
  /** ISO8601 stage start timestamp. */
  readonly startedAt: string;
  /** ISO8601 stage end timestamp. */
  readonly endedAt: string;
  /** Human-readable stage summary. */
  readonly message: string;
  /** Whether the native failure can be retried. */
  readonly retryable: boolean;
}

/** Normalized native iOS protocol report consumed by the host orchestrator. */
export interface DeviceAiIosNativeReportSnapshot {
  /** Global correlation id for the native iOS run. */
  readonly correlationId: string;
  /** Terminal flow execution state emitted by iOS. */
  readonly state: string;
  /** Human-readable terminal message. */
  readonly message: string;
  /** Optional artifact metadata written by iOS. */
  readonly artifact: DeviceAiNativeArtifactSnapshot | null;
  /** Optional resolved model evidence written by iOS. */
  readonly model: {
    /** Model reference resolved by the iOS native runner. */
    readonly modelRef: string;
    /** Revision resolved by the iOS native runner. */
    readonly revision: string;
    /** File name staged by the iOS runner. */
    readonly fileName: string;
    /** Expected SHA-256 declared by the iOS required model contract. */
    readonly expectedSha256: string;
    /** Canonical capability set emitted by the resolved iOS model contract. */
    readonly capabilities: readonly DeviceAiCapability[];
  } | null;
  /** Ordered native stages. */
  readonly stages: readonly DeviceAiIosNativeStageSnapshot[];
}

/** Pure report-builder input shared by tests and the protocol runner. */
export interface DeviceAiProtocolReportInput {
  /** Global correlation id for the host protocol run. */
  readonly correlationId: string;
  /** Effective profile used for the run. */
  readonly profile: DeviceAiProtocolProfile;
  /** Runtime availability summary. */
  readonly runtime: DeviceAiRuntimeProbeResult;
  /** Android preflight stage. */
  readonly androidPreflightStage: DeviceAiStageReport;
  /** Whether Android device/runtime preflight succeeded. */
  readonly androidDeviceReady: boolean;
  /** Optional native Android report. */
  readonly androidNativeReport: DeviceAiAndroidNativeReportSnapshot | null;
  /** iOS preflight stage. */
  readonly iosPreflightStage: DeviceAiStageReport;
  /** Whether iOS device/runtime preflight succeeded. */
  readonly iosDeviceReady: boolean;
  /** Optional native iOS report. */
  readonly iosNativeReport: DeviceAiIosNativeReportSnapshot | null;
  /** Flat list of failures accumulated during orchestration. */
  readonly failures: readonly string[];
}

/** Persisted execution outcome returned after the typed protocol runner finishes. */
export interface DeviceAiProtocolExecutionResult {
  /** Absolute path of the run-specific protocol report. */
  readonly reportPath: string;
  /** Absolute path of the latest protocol report copy. */
  readonly latestPath: string;
  /** Typed protocol report payload. */
  readonly report: DeviceAiProtocolRunReport;
}

interface DeviceAiRunPaths {
  readonly reportRoot: string;
  readonly runDirectory: string;
  readonly reportPath: string;
  readonly latestPath: string;
  readonly androidNativeReportPath: string;
  readonly iosNativeReportPath: string;
}

interface DeviceAiResolvedProfile {
  readonly profile: DeviceAiProtocolProfile;
  readonly modelDirectory: string;
  readonly reportDirectory: string;
}

interface DeviceAiResolvedApps {
  readonly androidApplicationId: string;
  readonly androidDeepLinkScheme: string;
  readonly androidActivityComponent: string;
  readonly androidDeviceReportPath: string;
  readonly iosHostBundleId: string;
  readonly iosTargetAppId: string;
}

interface DeviceAiResolvedCorrelationIds {
  readonly global: string;
  readonly android: string;
  readonly ios: string;
}

interface DeviceAiRuntimeProbeExecution {
  readonly runtime: DeviceAiRuntimeProbeResult;
  readonly failures: readonly string[];
}

interface DeviceAiPreflightResult {
  readonly stage: DeviceAiStageReport;
  readonly deviceReady: boolean;
  readonly latestArtifactPath: string | null;
}

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

function writeLine(message: string): void {
  process.stdout.write(`[device-ai] ${message}\n`);
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJsonFile(
  path: string,
  payload:
    | JsonValue
    | DeviceAiProtocolRunReport
    | DeviceAiAndroidNativeReportSnapshot
    | DeviceAiIosNativeReportSnapshot,
): void {
  ensureDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function copyLatestReport(sourcePath: string, latestPath: string): void {
  ensureDirectory(dirname(latestPath));
  copyFileSync(sourcePath, latestPath);
}

function asPositiveInteger(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function asBoolean(value: JsonValue | undefined): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function normalizedStatus(value: string): string {
  return value.trim().toLowerCase();
}

function toStageStatus(value: string): DeviceAiStageStatus {
  const normalized = normalizedStatus(value);
  if (normalized === "pass" || normalized === "success") {
    return "pass";
  }
  if (normalized === "skip" || normalized === "skipped") {
    return "skip";
  }
  return "fail";
}

function toUniqueFailures(failures: readonly string[]): string[] {
  return [...new Set(failures.map((failure) => failure.trim()).filter((failure) => failure.length > 0))];
}

function readJsonFile(path: string): JsonValue {
  const parsed = safeParseJson<JsonValue>(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    throw new Error(`Invalid JSON at ${path}: ${parsed.error}`);
  }
  return parsed.data;
}

function readJsonFromText(raw: string, label: string): JsonValue | null {
  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    writeLine(`${label}: ignored malformed JSON payload (${parsed.error}).`);
    return null;
  }
  return parsed.data;
}

function readLatestBuildArtifactPath(platform: "android" | "ios"): string | null {
  const reportResult = readLatestAppBuildMatrixReport(REPO_ROOT);
  if (!reportResult.ok) {
    return null;
  }
  const artifactPath = reportResult.data.platforms[platform].artifactPath?.trim() ?? "";
  return artifactPath.length > 0 ? artifactPath : null;
}

function parseGradleDefault(name: string, fallback: string): string {
  const source = readFileSync(ANDROID_BUILD_GRADLE_PATH, "utf8");
  const pattern = new RegExp(`name = "${name}", defaultValue = "([^"]+)"`);
  const match = pattern.exec(source);
  return match?.[1]?.trim() || fallback;
}

function parseIosBundleId(fallback: string): string {
  const source = readFileSync(IOS_PROJECT_FILE, "utf8");
  const match = /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/.exec(source);
  return match?.[1]?.trim() || fallback;
}

function resolveAndroidReportRelativeDirectory(modelDirectory: string): string {
  const segments = modelDirectory.split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  const parentSegments = segments.length <= 1 ? ["vertu-device-ai"] : segments.slice(0, -1);
  return [...parentSegments, "protocol"].join("/");
}

function createRunPaths(): DeviceAiRunPaths {
  const reportRoot = process.env.VERTU_DEVICE_AI_PROTOCOL_REPORT_DIR?.trim() || DEVICE_AI_REPORT_ROOT;
  const runDirectory = resolve(reportRoot, createRunTimestamp());
  ensureDirectory(runDirectory);
  return {
    reportRoot,
    runDirectory,
    reportPath: resolve(runDirectory, "protocol-report.json"),
    latestPath: resolve(reportRoot, DEVICE_AI_PROTOCOL_REPORT_FILE),
    androidNativeReportPath: resolve(runDirectory, "android-native-report.json"),
    iosNativeReportPath: resolve(runDirectory, "ios-native-report.json"),
  };
}

function resolveProfile(): DeviceAiResolvedProfile {
  return {
    profile: readDeviceAiProtocolProfile(),
    modelDirectory: process.env.VERTU_DEVICE_AI_MODEL_DIRECTORY?.trim() || DEVICE_AI_MODEL_DIR_FALLBACK,
    reportDirectory: process.env.VERTU_DEVICE_AI_REPORT_DIRECTORY?.trim() || DEVICE_AI_REPORT_DIR_FALLBACK,
  };
}

function resolveApps(modelDirectory: string): DeviceAiResolvedApps {
  const androidApplicationId = process.env.VERTU_APPLICATION_ID?.trim() || parseGradleDefault("VERTU_APPLICATION_ID", ANDROID_APPLICATION_ID_FALLBACK);
  const androidDeepLinkScheme = process.env.VERTU_DEEP_LINK_SCHEME?.trim() || parseGradleDefault("VERTU_DEEP_LINK_SCHEME", ANDROID_DEEP_LINK_SCHEME_FALLBACK);
  const iosHostBundleId = process.env.VERTU_IOS_HOST_BUNDLE_ID?.trim() || parseIosBundleId(IOS_HOST_BUNDLE_ID_FALLBACK);
  const iosTargetAppId = process.env.VERTU_IOS_TARGET_APP_ID?.trim() || iosHostBundleId;
  return {
    androidApplicationId,
    androidDeepLinkScheme,
    androidActivityComponent: `${androidApplicationId}/com.google.ai.edge.gallery.MainActivity`,
    androidDeviceReportPath: `/sdcard/Android/data/${androidApplicationId}/files/${resolveAndroidReportRelativeDirectory(modelDirectory)}/${DEVICE_AI_PROTOCOL_REPORT_FILE}`,
    iosHostBundleId,
    iosTargetAppId,
  };
}

function resolveCorrelationIds(): DeviceAiResolvedCorrelationIds {
  const global = createCorrelationId();
  return {
    global,
    android: `${global}-android`,
    ios: `${global}-ios`,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function probeRuntimeAvailability(profile: DeviceAiProtocolProfile): Promise<DeviceAiRuntimeProbeExecution> {
  const failures: string[] = [];
  const ollamaUrl = `${OLLAMA_DEFAULT_BASE_URL.replace(/\/+$/u, "")}/api/tags`;

  const localAvailable = await fetchWithTimeout(ollamaUrl, { method: "GET" }, RUNTIME_PROBE_TIMEOUT_MS).then(
    (response) => response.ok,
    () => false,
  );
  const localMessage = localAvailable
    ? `Ollama tags endpoint reachable at ${ollamaUrl}`
    : `Unable to reach Ollama tags endpoint at ${ollamaUrl}`;
  if (profile.runtimeRequirements.localOllama && !localAvailable) {
    failures.push(localMessage);
  }

  const token = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim() || "";
  let cloudAvailable = false;
  let cloudMessage: string;
  if (token.length === 0) {
    cloudMessage = "HF_TOKEN or HUGGINGFACE_HUB_TOKEN is required for cloud probe";
  } else {
    cloudAvailable = await fetchWithTimeout(
      "https://huggingface.co/api/whoami-v2",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      RUNTIME_PROBE_TIMEOUT_MS,
    ).then(
      (response) => response.ok,
      () => false,
    );
    cloudMessage = cloudAvailable
      ? "Hugging Face whoami endpoint reachable"
      : "Unable to reach Hugging Face whoami endpoint with provided token";
  }
  if (profile.runtimeRequirements.cloudHuggingFace && !cloudAvailable) {
    failures.push(cloudMessage);
  }

  return {
    runtime: {
      localOllama: {
        required: profile.runtimeRequirements.localOllama,
        available: localAvailable,
        message: localMessage,
      },
      cloudHuggingFace: {
        required: profile.runtimeRequirements.cloudHuggingFace,
        available: cloudAvailable,
        message: cloudMessage,
      },
    },
    failures,
  };
}

function runSimctlCommand(
  args: readonly string[],
  env: DeviceAiReadinessEnvironment,
  additionalEnv?: Record<string, string>,
) {
  const developerDir = resolveDeveloperDirForSimctl(env);
  return runCommand(["xcrun", "simctl", ...args], {
    cwd: REPO_ROOT,
    env: {
      ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}),
      ...additionalEnv,
    },
  });
}

function countConnectedAndroidDevices(output: string): number {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("List of devices attached"))
    .filter((line) => /\sdevice$/u.test(line))
    .length;
}

function createStage(
  stage: string,
  status: DeviceAiStageStatus,
  correlationId: string,
  startedAt: string,
  endedAt: string,
  message: string,
  retryable: boolean,
): DeviceAiStageReport {
  return {
    stage,
    status,
    correlationId,
    startedAt,
    endedAt,
    message,
    retryable,
  };
}

function parseNativeArtifact(value: JsonValue | undefined): DeviceAiNativeArtifactSnapshot | null {
  if (!value || !isJsonRecord(value)) {
    return null;
  }
  const path = toTrimmedString(value.path as JsonValue | undefined);
  const sha256 = toTrimmedString(value.sha256 as JsonValue | undefined).toLowerCase();
  const sizeBytes = asPositiveInteger(value.sizeBytes as JsonValue | undefined);
  if (!path || !sha256 || sizeBytes === null) {
    return null;
  }
  return { path, sha256, sizeBytes };
}

function parseAndroidNativeModel(value: JsonValue | undefined): DeviceAiAndroidNativeReportSnapshot["model"] {
  if (!value || !isJsonRecord(value)) {
    return null;
  }
  const modelRef = toTrimmedString(value.modelRef as JsonValue | undefined);
  const revision = toTrimmedString(value.revision as JsonValue | undefined);
  const fileName = toTrimmedString(value.fileName as JsonValue | undefined);
  const expectedSha256 = toTrimmedString(value.expectedSha256 as JsonValue | undefined).toLowerCase();
  const resolvedModelName = toTrimmedString(value.resolvedModelName as JsonValue | undefined);
  const rawCapabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  const capabilities = rawCapabilities
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item): item is DeviceAiCapability =>
      item === "mobile_actions" || item === "rpa_controls" || item === "flow_commands")
    .filter((item, index, array) => array.indexOf(item) === index);
  if (
    !modelRef
    || !revision
    || !fileName
    || !expectedSha256
    || !resolvedModelName
    || capabilities.length === 0
  ) {
    return null;
  }
  return {
    modelRef,
    revision,
    fileName,
    expectedSha256,
    resolvedModelName,
    capabilities,
  };
}

function parseAndroidNativeReport(value: JsonValue | null): DeviceAiAndroidNativeReportSnapshot | null {
  if (!value || !isJsonRecord(value)) {
    return null;
  }
  const correlationId = toTrimmedString(value.correlationId as JsonValue | undefined);
  const status = toTrimmedString(value.status as JsonValue | undefined);
  const state = toTrimmedString(value.state as JsonValue | undefined);
  const code = toTrimmedString(value.code as JsonValue | undefined);
  const message = toTrimmedString(value.message as JsonValue | undefined);
  const startedAtEpochMs = asPositiveInteger(value.startedAtEpochMs as JsonValue | undefined);
  const completedAtEpochMs = asPositiveInteger(value.completedAtEpochMs as JsonValue | undefined);
  const stagesRaw = Array.isArray(value.stages) ? value.stages : [];
  const stages = stagesRaw
    .map((item) => {
      if (!isJsonRecord(item)) {
        return null;
      }
      const name = toTrimmedString(item.name as JsonValue | undefined);
      const itemStatus = toTrimmedString(item.status as JsonValue | undefined);
      const itemCode = toTrimmedString(item.code as JsonValue | undefined);
      const itemMessage = toTrimmedString(item.message as JsonValue | undefined);
      if (!name || !itemStatus || !itemCode || !itemMessage) {
        return null;
      }
      return {
        name,
        status: itemStatus,
        code: itemCode,
        message: itemMessage,
      } satisfies DeviceAiAndroidNativeStageSnapshot;
    })
    .filter((item): item is DeviceAiAndroidNativeStageSnapshot => item !== null);

  if (!correlationId || !status || !state || !code || !message || startedAtEpochMs === null || completedAtEpochMs === null) {
    return null;
  }

  return {
    correlationId,
    status,
    state,
    code,
    message,
    startedAtEpochMs,
    completedAtEpochMs,
    artifact: parseNativeArtifact(value.artifact as JsonValue | undefined),
    model: parseAndroidNativeModel(value.model as JsonValue | undefined),
    stages,
  };
}

function parseIosNativeReport(value: JsonValue | null): DeviceAiIosNativeReportSnapshot | null {
  if (!value || !isJsonRecord(value)) {
    return null;
  }
  const correlationId = toTrimmedString(value.correlationId as JsonValue | undefined);
  const state = toTrimmedString(value.state as JsonValue | undefined);
  const message = toTrimmedString(value.message as JsonValue | undefined);
  const stagesRaw = Array.isArray(value.stages) ? value.stages : [];
  const stages = stagesRaw
    .map((item) => {
      if (!isJsonRecord(item)) {
        return null;
      }
      const stage = toTrimmedString(item.stage as JsonValue | undefined);
      const status = toTrimmedString(item.status as JsonValue | undefined);
      const stageCorrelationId = toTrimmedString(item.correlationId as JsonValue | undefined);
      const startedAt = toTrimmedString(item.startedAt as JsonValue | undefined);
      const endedAt = toTrimmedString(item.endedAt as JsonValue | undefined);
      const stageMessage = toTrimmedString(item.message as JsonValue | undefined);
      const retryable = asBoolean(item.retryable as JsonValue | undefined);
      if (!stage || !status || !stageCorrelationId || !startedAt || !endedAt || !stageMessage || retryable === null) {
        return null;
      }
      return {
        stage,
        status,
        correlationId: stageCorrelationId,
        startedAt,
        endedAt,
        message: stageMessage,
        retryable,
      } satisfies DeviceAiIosNativeStageSnapshot;
    })
    .filter((item): item is DeviceAiIosNativeStageSnapshot => item !== null);

  if (!correlationId || !state || !message) {
    return null;
  }

  return {
    correlationId,
    state,
    message,
    artifact: parseNativeArtifact(value.artifact as JsonValue | undefined),
    model: parseIosNativeModel(value.model as JsonValue | undefined),
    stages,
  };
}

function parseIosNativeModel(value: JsonValue | undefined): DeviceAiIosNativeReportSnapshot["model"] {
  if (!value || !isJsonRecord(value)) {
    return null;
  }
  const modelRef = toTrimmedString(value.modelRef as JsonValue | undefined);
  const revision = toTrimmedString(value.revision as JsonValue | undefined);
  const fileName = toTrimmedString(value.fileName as JsonValue | undefined);
  const expectedSha256 = toTrimmedString(value.expectedSha256 as JsonValue | undefined).toLowerCase();
  const rawCapabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  const capabilities = rawCapabilities
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item): item is DeviceAiCapability =>
      item === "mobile_actions" || item === "rpa_controls" || item === "flow_commands")
    .filter((item, index, array) => array.indexOf(item) === index);
  if (!modelRef || !revision || !fileName || !expectedSha256 || capabilities.length === 0) {
    return null;
  }
  return {
    modelRef,
    revision,
    fileName,
    expectedSha256,
    capabilities,
  };
}

function createAndroidQueryString(correlationId: string, profile: DeviceAiProtocolProfile): string {
  return new URLSearchParams({
    correlationId,
    modelRef: profile.requiredModelRef,
    revision: profile.revision,
    fileName: profile.requiredModelFile,
    sha256: profile.requiredModelSha256,
  }).toString();
}

async function readAndroidNativeReport(
  adbPath: string,
  deviceReportPath: string,
  expectedCorrelationId: string,
): Promise<DeviceAiAndroidNativeReportSnapshot | null> {
  const result = await runCommand([adbPath, "exec-out", "sh", "-c", `cat '${deviceReportPath}'`], { cwd: REPO_ROOT });
  if (!result.success || result.stdout.trim().length === 0) {
    return null;
  }
  const parsed = parseAndroidNativeReport(readJsonFromText(result.stdout, "android-native-report"));
  if (!parsed || parsed.correlationId !== expectedCorrelationId) {
    return null;
  }
  return parsed;
}

async function pollAndroidNativeReport(
  adbPath: string,
  deviceReportPath: string,
  expectedCorrelationId: string,
  timeoutMs: number,
  outputPath: string,
): Promise<DeviceAiAndroidNativeReportSnapshot | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const report = await readAndroidNativeReport(adbPath, deviceReportPath, expectedCorrelationId);
    if (report) {
      writeJsonFile(outputPath, report);
      return report;
    }
    await Bun.sleep(NATIVE_REPORT_POLL_INTERVAL_MS);
  }
  return null;
}

async function readIosNativeReport(reportPath: string, expectedCorrelationId: string): Promise<DeviceAiIosNativeReportSnapshot | null> {
  if (!existsSync(reportPath)) {
    return null;
  }
  const parsed = parseIosNativeReport(readJsonFile(reportPath));
  if (!parsed || parsed.correlationId !== expectedCorrelationId) {
    return null;
  }
  return parsed;
}

async function pollIosNativeReport(
  reportPath: string,
  expectedCorrelationId: string,
  timeoutMs: number,
  outputPath: string,
): Promise<DeviceAiIosNativeReportSnapshot | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const report = await readIosNativeReport(reportPath, expectedCorrelationId);
    if (report) {
      writeJsonFile(outputPath, report);
      return report;
    }
    await Bun.sleep(NATIVE_REPORT_POLL_INTERVAL_MS);
  }
  return null;
}

async function prepareIosInstallAppPath(artifactPath: string, runDirectory: string): Promise<string | null> {
  if (!existsSync(artifactPath)) {
    return null;
  }
  if (!artifactPath.endsWith(".zip")) {
    return statSync(artifactPath).isDirectory() ? artifactPath : null;
  }
  const installRoot = resolve(runDirectory, "ios-install");
  rmSync(installRoot, { recursive: true, force: true });
  ensureDirectory(installRoot);
  const extractResult = await runCommand(["ditto", "-x", "-k", artifactPath, installRoot], { cwd: REPO_ROOT });
  if (!extractResult.success) {
    return null;
  }
  for await (const match of new Bun.Glob("**/*.app").scan({ cwd: installRoot, absolute: true, onlyFiles: false })) {
    return match;
  }
  return null;
}

async function runAndroidPreflight(
  adbPath: string | null,
  apps: DeviceAiResolvedApps,
): Promise<DeviceAiPreflightResult> {
  const startedAt = nowIso();
  let deviceReady = false;
  let latestArtifactPath: string | null = null;
  let message: string;

  if (!adbPath) {
    message = "adb is not installed or resolvable from Android SDK";
  } else {
    const devicesResult = await runCommand([adbPath, "devices"], { cwd: REPO_ROOT });
    const deviceCount = devicesResult.success ? countConnectedAndroidDevices(devicesResult.stdout) : 0;
    if (deviceCount === 0) {
      message = "adb available but no connected Android device/emulator";
    } else {
      latestArtifactPath = readLatestBuildArtifactPath("android");
      if (latestArtifactPath && existsSync(latestArtifactPath)) {
        await runCommand([adbPath, "install", "-r", latestArtifactPath], { cwd: REPO_ROOT });
      }
      const installedResult = await runCommand([adbPath, "shell", "pm", "path", apps.androidApplicationId], { cwd: REPO_ROOT });
      if (installedResult.success) {
        deviceReady = true;
        message = latestArtifactPath && existsSync(latestArtifactPath)
          ? `adb available with ${deviceCount} connected device(s); latest Android artifact installed`
          : `adb available with ${deviceCount} connected device(s) and app installed`;
      } else if (latestArtifactPath && !existsSync(latestArtifactPath)) {
        message = `Latest Android build artifact path is missing: ${latestArtifactPath}`;
      } else if (!latestArtifactPath) {
        message = `No latest Android build artifact is available and app ${apps.androidApplicationId} is not installed on the connected device`;
      } else {
        message = `Android app ${apps.androidApplicationId} could not be installed from the latest artifact or is not present on the connected device`;
      }
    }
  }

  return {
    stage: createStage(
      "android-preflight",
      deviceReady ? "pass" : "fail",
      `${createCorrelationId()}-android-preflight`,
      startedAt,
      nowIso(),
      message,
      true,
    ),
    deviceReady,
    latestArtifactPath,
  };
}

async function runIosPreflight(
  env: DeviceAiReadinessEnvironment,
  apps: DeviceAiResolvedApps,
  runDirectory: string,
): Promise<DeviceAiPreflightResult> {
  const startedAt = nowIso();
  let deviceReady = false;
  let latestArtifactPath: string | null = null;
  let message: string;

  if (process.platform !== "darwin" || !isSimctlAvailable(env)) {
    message = "iOS preflight requires macOS + xcrun simctl";
  } else {
    const listResult = await runSimctlCommand(["list", "devices", "booted"], env);
    if (!listResult.success || !listResult.stdout.includes("Booted")) {
      message = "xcrun/simctl available but no booted iOS simulator";
    } else {
      latestArtifactPath = readLatestBuildArtifactPath("ios");
      let installAppPath: string | null = null;
      if (latestArtifactPath) {
        installAppPath = await prepareIosInstallAppPath(latestArtifactPath, runDirectory);
        if (installAppPath) {
          await runSimctlCommand(["install", "booted", installAppPath], env);
        }
      }
      const containerResult = await runSimctlCommand(["get_app_container", "booted", apps.iosHostBundleId, "data"], env);
      const simulatorDataPath = containerResult.success ? containerResult.stdout.trim() : "";
      if (simulatorDataPath.length > 0) {
        deviceReady = true;
        message = installAppPath
          ? "xcrun/simctl available with booted simulator; latest iOS artifact installed"
          : "xcrun/simctl available with booted simulator and host app installed";
      } else if (latestArtifactPath && !installAppPath) {
        message = `Latest iOS build artifact could not be prepared for simulator install: ${latestArtifactPath}`;
      } else if (!latestArtifactPath) {
        message = `No latest iOS build artifact is available and host app ${apps.iosHostBundleId} is not installed on the booted simulator`;
      } else {
        message = `iOS host app ${apps.iosHostBundleId} could not be installed from the latest artifact or is not present on the booted simulator`;
      }
    }
  }

  return {
    stage: createStage(
      "ios-preflight",
      deviceReady ? "pass" : "fail",
      `${createCorrelationId()}-ios-preflight`,
      startedAt,
      nowIso(),
      message,
      true,
    ),
    deviceReady,
    latestArtifactPath,
  };
}

function createModelEvidence(
  profile: DeviceAiProtocolProfile,
  androidNativeReport: DeviceAiAndroidNativeReportSnapshot | null,
  iosNativeReport: DeviceAiIosNativeReportSnapshot | null,
) {
  const artifact = androidNativeReport?.artifact ?? iosNativeReport?.artifact ?? null;
  const nativeModel = androidNativeReport?.model ?? iosNativeReport?.model;
  return {
    modelRef: nativeModel?.modelRef ?? profile.requiredModelRef,
    revision: nativeModel?.revision ?? profile.revision,
    fileName: nativeModel?.fileName ?? profile.requiredModelFile,
    downloaded: artifact !== null,
    verified: artifact !== null,
    ...(artifact ? { artifactPath: artifact.path } : {}),
    sha256: artifact?.sha256 ?? nativeModel?.expectedSha256 ?? profile.requiredModelSha256.toLowerCase(),
    sizeBytes: artifact?.sizeBytes ?? 0,
    capabilities: nativeModel?.capabilities ? [...nativeModel.capabilities] : [...profile.requiredCapabilities],
  };
}

function createAndroidStages(
  preflightStage: DeviceAiStageReport,
  nativeReport: DeviceAiAndroidNativeReportSnapshot | null,
): DeviceAiStageReport[] {
  return [
    preflightStage,
    ...((nativeReport?.stages ?? []).map((stage) => createStage(
      `${ANDROID_REPORT_STAGE_PREFIX}${stage.name}`,
      toStageStatus(stage.status),
      nativeReport?.correlationId ?? stage.name,
      new Date(nativeReport?.startedAtEpochMs ?? Date.now()).toISOString(),
      new Date(nativeReport?.completedAtEpochMs ?? Date.now()).toISOString(),
      stage.message,
      normalizedStatus(stage.code) === "protocol_timeout" || normalizedStatus(nativeReport?.state ?? "") === "error_retryable",
    ))),
  ];
}

function createIosStages(
  preflightStage: DeviceAiStageReport,
  nativeReport: DeviceAiIosNativeReportSnapshot | null,
): DeviceAiStageReport[] {
  return [
    preflightStage,
    ...((nativeReport?.stages ?? []).map((stage) => createStage(
      `${IOS_REPORT_STAGE_PREFIX}${stage.stage}`,
      toStageStatus(stage.status),
      stage.correlationId,
      stage.startedAt,
      stage.endedAt,
      stage.message,
      stage.retryable,
    ))),
  ];
}

/** Build the canonical device-AI protocol report from typed preflight and native snapshots. */
export function createDeviceAiProtocolRunReport(input: DeviceAiProtocolReportInput): DeviceAiProtocolRunReport {
  const failures = [...input.failures];
  const androidNativeFailed = input.androidNativeReport && toStageStatus(input.androidNativeReport.status) !== "pass";
  const iosNativeFailed = input.iosNativeReport && normalizedStatus(input.iosNativeReport.state) !== "success";
  if (androidNativeFailed) {
    failures.push(input.androidNativeReport?.message ?? "Android native protocol failed.");
  }
  if (iosNativeFailed) {
    failures.push(input.iosNativeReport?.message ?? "iOS native protocol failed.");
  }

  const androidStatus: DeviceAiStageStatus = input.androidDeviceReady && input.androidNativeReport && toStageStatus(input.androidNativeReport.status) === "pass"
    ? "pass"
    : (input.profile.platforms.android.required ? "fail" : "skip");
  const iosStatus: DeviceAiStageStatus = input.iosDeviceReady && input.iosNativeReport && normalizedStatus(input.iosNativeReport.state) === "success"
    ? "pass"
    : (input.profile.platforms.ios.required ? "fail" : "skip");
  const normalizedFailures = toUniqueFailures(failures);

  return {
    schemaVersion: DEVICE_AI_REPORT_SCHEMA_VERSION,
    generatedAt: nowIso(),
    correlationId: input.correlationId,
    profile: input.profile,
    runtime: input.runtime,
    model: createModelEvidence(input.profile, input.androidNativeReport, input.iosNativeReport),
    platforms: {
      android: {
        platform: "android",
        required: input.profile.platforms.android.required,
        status: androidStatus,
        deviceReady: input.androidDeviceReady,
        stagingReady: Boolean(input.androidNativeReport?.artifact?.path),
        smokeReady: normalizedStatus(input.androidNativeReport?.code ?? "") === "ok" && normalizedStatus(input.androidNativeReport?.state ?? "") === "success",
        stages: createAndroidStages(input.androidPreflightStage, input.androidNativeReport),
      },
      ios: {
        platform: "ios",
        required: input.profile.platforms.ios.required,
        status: iosStatus,
        deviceReady: input.iosDeviceReady,
        stagingReady: Boolean(input.iosNativeReport?.artifact?.path),
        smokeReady: normalizedStatus(input.iosNativeReport?.state ?? "") === "success",
        stages: createIosStages(input.iosPreflightStage, input.iosNativeReport),
      },
    },
    status: normalizedFailures.length === 0 ? "pass" : "fail",
    failures: normalizedFailures,
  };
}

async function executeAndroidProtocol(
  adbPath: string | null,
  apps: DeviceAiResolvedApps,
  profile: DeviceAiProtocolProfile,
  correlationIds: DeviceAiResolvedCorrelationIds,
  paths: DeviceAiRunPaths,
  preflight: DeviceAiPreflightResult,
): Promise<DeviceAiAndroidNativeReportSnapshot | null> {
  if (!adbPath || !preflight.deviceReady) {
    return null;
  }
  const deepLink = `${apps.androidDeepLinkScheme}://device_ai_protocol/run?${createAndroidQueryString(correlationIds.android, profile)}`;
  const launchResult = await runCommand(
    [adbPath, "shell", "am", "start", "-W", "-n", apps.androidActivityComponent, "-a", "android.intent.action.VIEW", "-d", deepLink],
    { cwd: REPO_ROOT },
  );
  if (!launchResult.success) {
    return null;
  }
  return pollAndroidNativeReport(
    adbPath,
    apps.androidDeviceReportPath,
    correlationIds.android,
    profile.protocolTimeoutMs,
    paths.androidNativeReportPath,
  );
}

async function executeIosProtocol(
  env: DeviceAiReadinessEnvironment,
  apps: DeviceAiResolvedApps,
  profile: DeviceAiProtocolProfile,
  correlationIds: DeviceAiResolvedCorrelationIds,
  paths: DeviceAiRunPaths,
  preflight: DeviceAiPreflightResult,
  reportDirectory: string,
): Promise<DeviceAiIosNativeReportSnapshot | null> {
  if (!preflight.deviceReady || process.platform !== "darwin" || !isSimctlAvailable(env)) {
    return null;
  }
  const containerResult = await runSimctlCommand(["get_app_container", "booted", apps.iosHostBundleId, "data"], env);
  if (!containerResult.success) {
    return null;
  }
  const simulatorDataPath = containerResult.stdout.trim();
  if (simulatorDataPath.length === 0) {
    return null;
  }
  await runSimctlCommand(["terminate", "booted", apps.iosHostBundleId], env);
  const token = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim() || "";
  const launchResult = await runSimctlCommand(
    ["launch", "booted", apps.iosHostBundleId],
    env,
    {
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_MODE: "run",
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_APP_ID: apps.iosTargetAppId,
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_MODEL_REF: profile.requiredModelRef,
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_MODEL_REVISION: profile.revision,
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_MODEL_FILE: profile.requiredModelFile,
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_MODEL_SHA256: profile.requiredModelSha256,
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_HF_TOKEN: token,
      SIMCTL_CHILD_VERTU_DEVICE_AI_PROTOCOL_CORRELATION_ID: correlationIds.ios,
    },
  );
  if (!launchResult.success) {
    return null;
  }
  const latestReportPath = resolve(simulatorDataPath, "Library", "Application Support", reportDirectory, DEVICE_AI_PROTOCOL_REPORT_FILE);
  return pollIosNativeReport(latestReportPath, correlationIds.ios, profile.protocolTimeoutMs, paths.iosNativeReportPath);
}

/** Execute the native device-AI protocol through the typed flow-kit orchestration layer. */
export async function runDeviceAiProtocol(): Promise<DeviceAiProtocolExecutionResult> {
  const paths = createRunPaths();
  const { profile, modelDirectory, reportDirectory } = resolveProfile();
  const apps = resolveApps(modelDirectory);
  const correlationIds = resolveCorrelationIds();
  const env: DeviceAiReadinessEnvironment = {
    ...(typeof process.env.ANDROID_SDK_ROOT === "string" ? { ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT } : {}),
    ...(typeof process.env.ANDROID_HOME === "string" ? { ANDROID_HOME: process.env.ANDROID_HOME } : {}),
    ...(typeof process.env.DEVELOPER_DIR === "string" ? { DEVELOPER_DIR: process.env.DEVELOPER_DIR } : {}),
  };

  const runtimeProbe = await probeRuntimeAvailability(profile);
  const failures = [...runtimeProbe.failures];
  const adbPath = resolveAdbExecutablePath({ ...env });
  const androidPreflight = await runAndroidPreflight(adbPath, apps);
  if (!androidPreflight.deviceReady && profile.platforms.android.required) {
    failures.push(androidPreflight.stage.message);
  }
  const iosPreflight = await runIosPreflight(env, apps, paths.runDirectory);
  if (!iosPreflight.deviceReady && profile.platforms.ios.required) {
    failures.push(iosPreflight.stage.message);
  }

  const androidNativeReport = await executeAndroidProtocol(adbPath, apps, profile, correlationIds, paths, androidPreflight);
  if (!androidNativeReport && androidPreflight.deviceReady && profile.platforms.android.required) {
    failures.push("Timed out waiting for Android native protocol report");
  }
  const iosNativeReport = await executeIosProtocol(env, apps, profile, correlationIds, paths, iosPreflight, reportDirectory);
  if (!iosNativeReport && iosPreflight.deviceReady && profile.platforms.ios.required) {
    failures.push("Timed out waiting for iOS native protocol report");
  }

  const report = createDeviceAiProtocolRunReport({
    correlationId: correlationIds.global,
    profile: {
      ...profile,
      protocolTimeoutMs: profile.protocolTimeoutMs || DEVICE_AI_PROTOCOL_TIMEOUT_MS_FALLBACK,
      reportMaxAgeMinutes: profile.reportMaxAgeMinutes || DEVICE_AI_REPORT_MAX_AGE_MINUTES_FALLBACK,
    },
    runtime: runtimeProbe.runtime,
    androidPreflightStage: {
      ...androidPreflight.stage,
      correlationId: `${correlationIds.global}-android-preflight`,
    },
    androidDeviceReady: androidPreflight.deviceReady,
    androidNativeReport,
    iosPreflightStage: {
      ...iosPreflight.stage,
      correlationId: `${correlationIds.global}-ios-preflight`,
    },
    iosDeviceReady: iosPreflight.deviceReady,
    iosNativeReport,
    failures,
  });

  writeJsonFile(paths.reportPath, report);
  copyLatestReport(paths.reportPath, paths.latestPath);
  validateDeviceAiReportFile(paths.reportPath);
  writeLine(`Device AI protocol report written to: ${paths.reportPath}`);
  writeLine(`Device AI protocol latest report: ${paths.latestPath}`);

  if (report.status !== "pass") {
    throw new Error("Device AI protocol failed.");
  }

  return {
    reportPath: paths.reportPath,
    latestPath: paths.latestPath,
    report,
  };
}
