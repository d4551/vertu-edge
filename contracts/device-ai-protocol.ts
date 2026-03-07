/**
 * Canonical contract types for the local-first device AI build protocol.
 */

/** Supported capability flags required by device AI protocol runs. */
export type DeviceAiCapability = "mobile_actions" | "rpa_controls" | "flow_commands";

/** Stable pass/fail/skip status for protocol stages and platform summaries. */
export type DeviceAiStageStatus = "pass" | "fail" | "skip";

/** Supported mobile platform identifiers covered by the protocol. */
export type DeviceAiPlatform = "android" | "ios";

/** Runtime requirement declaration for local and remote AI provider availability. */
export interface DeviceAiRuntimeRequirements {
  /** Require local Ollama reachability for protocol pass. */
  localOllama: boolean;
  /** Require Hugging Face cloud API reachability for protocol pass. */
  cloudHuggingFace: boolean;
}

/** Platform requirement declaration. */
export interface DeviceAiPlatformRequirement {
  /** Whether this platform must pass for overall protocol success. */
  required: boolean;
}

/** Per-platform requirement map for protocol profiles. */
export interface DeviceAiPlatformRequirements {
  /** Android platform requirement declaration. */
  android: DeviceAiPlatformRequirement;
  /** iOS platform requirement declaration. */
  ios: DeviceAiPlatformRequirement;
}

/** Canonical protocol profile loaded from config and env overrides. */
export interface DeviceAiProtocolProfile {
  /** Schema/profile version for compatibility checks. */
  profileVersion: string;
  /** Required Hugging Face model reference to validate and stage. */
  requiredModelRef: string;
  /** Required revision pin (branch/tag/commit) for deterministic pulls. */
  revision: string;
  /** Required model file to download from the repository revision. */
  requiredModelFile: string;
  /** Required SHA-256 digest for the exact model artifact. */
  requiredModelSha256: string;
  /** Required capability flags expected from the staged model/runtime path. */
  requiredCapabilities: DeviceAiCapability[];
  /** Runtime provider availability requirements. */
  runtimeRequirements: DeviceAiRuntimeRequirements;
  /** Platform pass/fail requirements. */
  platforms: DeviceAiPlatformRequirements;
  /** Default timeout budget for protocol execution stages (ms). */
  protocolTimeoutMs: number;
  /** Maximum allowed age for protocol reports (minutes). */
  reportMaxAgeMinutes: number;
}

/** Runtime probe result row for one external dependency boundary. */
export interface DeviceAiRuntimeProbe {
  /** Whether this probe is required by profile policy. */
  required: boolean;
  /** Whether the probe succeeded. */
  available: boolean;
  /** Human-readable probe summary. */
  message: string;
}

/** Runtime probe summary set attached to protocol reports. */
export interface DeviceAiRuntimeProbeResult {
  /** Local Ollama probe result. */
  localOllama: DeviceAiRuntimeProbe;
  /** Hugging Face cloud probe result. */
  cloudHuggingFace: DeviceAiRuntimeProbe;
}

/** Per-stage trace row for deterministic execution reporting. */
export interface DeviceAiStageReport {
  /** Stable stage identifier. */
  stage: string;
  /** Stage status value. */
  status: DeviceAiStageStatus;
  /** Per-stage correlation id for traceability. */
  correlationId: string;
  /** ISO8601 start timestamp. */
  startedAt: string;
  /** ISO8601 end timestamp. */
  endedAt: string;
  /** Human-readable stage details. */
  message: string;
  /** Whether a failure in this stage can be retried. */
  retryable: boolean;
}

/** Evidence record proving model acquisition and verification outcomes. */
export interface DeviceAiModelEvidence {
  /** Model reference validated by the protocol run. */
  modelRef: string;
  /** Required revision pin used during pull/download. */
  revision: string;
  /** Required model file name validated by the run. */
  fileName: string;
  /** Whether the model was downloaded successfully. */
  downloaded: boolean;
  /** Whether checksum/integrity verification passed. */
  verified: boolean;
  /** Optional absolute local artifact path for downloaded content. */
  artifactPath?: string;
  /** Required SHA-256 digest of the downloaded artifact. */
  sha256: string;
  /** Required size in bytes of downloaded artifact. */
  sizeBytes: number;
  /** Capability flags associated with the resolved model. */
  capabilities: DeviceAiCapability[];
}

/** Per-platform execution result row for staging + smoke checks. */
export interface DeviceAiPlatformReport {
  /** Platform identifier. */
  platform: DeviceAiPlatform;
  /** Whether platform pass is mandatory by policy. */
  required: boolean;
  /** Terminal platform status. */
  status: DeviceAiStageStatus;
  /** Whether device/simulator runtime was ready. */
  deviceReady: boolean;
  /** Whether model staging completed for this platform. */
  stagingReady: boolean;
  /** Whether smoke automation succeeded. */
  smokeReady: boolean;
  /** Ordered stage trace for this platform. */
  stages: DeviceAiStageReport[];
}

/** Full protocol run report persisted by `run_device_ai_protocol.sh`. */
export interface DeviceAiProtocolRunReport {
  /** Report schema version. */
  schemaVersion: string;
  /** ISO8601 report generation timestamp. */
  generatedAt: string;
  /** Global correlation id for this protocol run. */
  correlationId: string;
  /** Effective profile used by the run. */
  profile: DeviceAiProtocolProfile;
  /** Runtime local/cloud probe result set. */
  runtime: DeviceAiRuntimeProbeResult;
  /** Model evidence for the required model reference. */
  model: DeviceAiModelEvidence;
  /** Platform report map for Android and iOS. */
  platforms: {
    /** Android platform report. */
    android: DeviceAiPlatformReport;
    /** iOS platform report. */
    ios: DeviceAiPlatformReport;
  };
  /** Terminal protocol status. */
  status: Exclude<DeviceAiStageStatus, "skip">;
  /** Flat list of terminal failure reasons. */
  failures: string[];
}

/** JSON scalar value accepted by protocol parser helpers. */
export type DeviceAiJsonScalar = string | number | boolean | null;

/** JSON object value accepted by protocol parser helpers. */
export type DeviceAiJsonRecord = { [key: string]: DeviceAiJsonValue };

/** JSON value accepted by protocol parser helpers. */
export type DeviceAiJsonValue = DeviceAiJsonScalar | DeviceAiJsonRecord | DeviceAiJsonValue[];

function isRecord(
  value: DeviceAiJsonValue | DeviceAiProtocolRunReport | undefined,
): value is DeviceAiJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: DeviceAiJsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveInteger(value: DeviceAiJsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function parseCapability(value: string): DeviceAiCapability | null {
  if (value === "mobile_actions" || value === "rpa_controls" || value === "flow_commands") {
    return value;
  }
  return null;
}

/**
 * Parse and validate a protocol profile object from JSON-like data.
 * Returns `null` when required fields are missing/invalid.
 */
export function parseDeviceAiProtocolProfile(value: DeviceAiJsonValue | undefined): DeviceAiProtocolProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const profileVersion = asTrimmedString(value.profileVersion);
  const requiredModelRef = asTrimmedString(value.requiredModelRef);
  const revisionRaw = asTrimmedString(value.revision);
  const requiredModelFile = asTrimmedString(value.requiredModelFile);
  const requiredModelSha256 = asTrimmedString(value.requiredModelSha256).toLowerCase();
  const timeoutMs = asPositiveInteger(value.protocolTimeoutMs);
  const reportMaxAge = asPositiveInteger(value.reportMaxAgeMinutes);
  const hasValidSha256 = /^[a-f0-9]{64}$/.test(requiredModelSha256);
  if (
    !profileVersion
    || !requiredModelRef
    || !revisionRaw
    || !requiredModelFile
    || !hasValidSha256
    || timeoutMs === null
    || reportMaxAge === null
  ) {
    return null;
  }

  const requiredCapabilitiesRaw = Array.isArray(value.requiredCapabilities)
    ? value.requiredCapabilities
    : [];
  const requiredCapabilities: DeviceAiCapability[] = [];
  for (const item of requiredCapabilitiesRaw) {
    const capability = parseCapability(typeof item === "string" ? item.trim() : "");
    if (!capability || requiredCapabilities.includes(capability)) {
      continue;
    }
    requiredCapabilities.push(capability);
  }
  if (requiredCapabilities.length === 0) {
    return null;
  }

  const runtimeRequirements = isRecord(value.runtimeRequirements)
    ? value.runtimeRequirements
    : null;
  const platforms = isRecord(value.platforms)
    ? value.platforms
    : null;
  const android = platforms && isRecord(platforms.android) ? platforms.android : null;
  const ios = platforms && isRecord(platforms.ios) ? platforms.ios : null;
  if (!runtimeRequirements || !android || !ios) {
    return null;
  }

  const localOllama = runtimeRequirements.localOllama === true;
  const cloudHuggingFace = runtimeRequirements.cloudHuggingFace === true;
  const androidRequired = android.required === true;
  const iosRequired = ios.required === true;

  return {
    profileVersion,
    requiredModelRef,
    revision: revisionRaw,
    requiredModelFile,
    requiredModelSha256,
    requiredCapabilities,
    runtimeRequirements: {
      localOllama,
      cloudHuggingFace,
    },
    platforms: {
      android: { required: androidRequired },
      ios: { required: iosRequired },
    },
    protocolTimeoutMs: timeoutMs,
    reportMaxAgeMinutes: reportMaxAge,
  };
}

/**
 * Runtime guard for device AI protocol run reports.
 */
export function isDeviceAiProtocolRunReport(
  value: DeviceAiJsonValue | DeviceAiProtocolRunReport | undefined,
): value is DeviceAiProtocolRunReport {
  if (!isRecord(value)) {
    return false;
  }
  const status = asTrimmedString(value.status);
  if (status !== "pass" && status !== "fail") {
    return false;
  }
  if (!Array.isArray(value.failures)) {
    return false;
  }
  const profile = parseDeviceAiProtocolProfile(value.profile);
  if (!profile) {
    return false;
  }
  return true;
}
