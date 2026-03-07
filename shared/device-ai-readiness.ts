import type { DeviceAiProtocolProfile } from "../contracts/device-ai-protocol";
import type { HostToolingEnvironment } from "./host-tooling";

/** Stable host operating system names used by device-AI readiness policy. */
export type DeviceAiHostOs = "Darwin" | "Linux" | "Windows_NT";

/** Minimal environment surface consumed by device-AI readiness policy. */
export interface DeviceAiReadinessEnvironment {
  /** Additional environment keys passed through to subprocess-based readiness probes. */
  readonly [key: string]: string | undefined;
  /** iOS build mode override. */
  readonly VERTU_IOS_BUILD_MODE?: string;
  /** Force device-AI protocol execution on local hosts. */
  readonly VERTU_VERIFY_DEVICE_AI_PROTOCOL?: string;
  /** CI host indicator. */
  readonly CI?: string;
  /** Primary Hugging Face token. */
  readonly HF_TOKEN?: string;
  /** Alternate Hugging Face token. */
  readonly HUGGINGFACE_HUB_TOKEN?: string;
  /** Android SDK root used for resolving platform-tools/adb. */
  readonly ANDROID_SDK_ROOT?: string;
  /** Legacy Android SDK root alias used for resolving platform-tools/adb. */
  readonly ANDROID_HOME?: string;
  /** Optional Xcode developer directory override for xcrun/simctl checks. */
  readonly DEVELOPER_DIR?: string;
}

/** Resolve the normalized host operating system name from a runtime platform string. */
export function resolveDeviceAiHostOs(
  platform: NodeJS.Platform = process.platform,
): DeviceAiHostOs {
  if (platform === "darwin") {
    return "Darwin";
  }
  if (platform === "win32") {
    return "Windows_NT";
  }
  return "Linux";
}

/** Project a host environment onto the shared device-AI readiness contract. */
export function createDeviceAiReadinessEnvironment(
  env: HostToolingEnvironment = process.env,
): DeviceAiReadinessEnvironment {
  return {
    ...(typeof env.VERTU_IOS_BUILD_MODE === "string"
      ? { VERTU_IOS_BUILD_MODE: env.VERTU_IOS_BUILD_MODE }
      : {}),
    ...(typeof env.VERTU_VERIFY_DEVICE_AI_PROTOCOL === "string"
      ? { VERTU_VERIFY_DEVICE_AI_PROTOCOL: env.VERTU_VERIFY_DEVICE_AI_PROTOCOL }
      : {}),
    ...(typeof env.CI === "string"
      ? { CI: env.CI }
      : {}),
    ...(typeof env.HF_TOKEN === "string"
      ? { HF_TOKEN: env.HF_TOKEN }
      : {}),
    ...(typeof env.HUGGINGFACE_HUB_TOKEN === "string"
      ? { HUGGINGFACE_HUB_TOKEN: env.HUGGINGFACE_HUB_TOKEN }
      : {}),
    ...(typeof env.ANDROID_SDK_ROOT === "string"
      ? { ANDROID_SDK_ROOT: env.ANDROID_SDK_ROOT }
      : {}),
    ...(typeof env.ANDROID_HOME === "string"
      ? { ANDROID_HOME: env.ANDROID_HOME }
      : {}),
    ...(typeof env.DEVELOPER_DIR === "string"
      ? { DEVELOPER_DIR: env.DEVELOPER_DIR }
      : {}),
  };
}

/** Stable requirement identifiers used by the device-AI readiness summary. */
export type DeviceAiRequirementCode =
  | "hf_token"
  | "android_adb"
  | "ios_macos_host"
  | "ios_xcrun"
  | "ios_simctl";

/** Deterministic readiness modes rendered by CLI and dashboard surfaces. */
export type DeviceAiReadinessStatus = "ready" | "blocked" | "skipped" | "delegated";

/** One requirement row in the device-AI readiness summary. */
export interface DeviceAiRequirementStatus {
  /** Stable requirement identifier. */
  readonly code: DeviceAiRequirementCode;
  /** Whether the requirement applies to the effective protocol profile. */
  readonly required: boolean;
  /** Whether the requirement is currently satisfied on this host. */
  readonly satisfied: boolean;
  /** Machine-oriented failure message for CLI and reports. */
  readonly failureMessage: string;
}

/** Summary produced by the shared device-AI readiness evaluator. */
export interface DeviceAiReadinessSummary {
  /** Terminal readiness mode. */
  readonly status: DeviceAiReadinessStatus;
  /** Normalized host operating system. */
  readonly hostOs: DeviceAiHostOs;
  /** Whether the full device protocol should run on this host. */
  readonly shouldRun: boolean;
  /** Whether iOS execution was explicitly delegated. */
  readonly delegated: boolean;
  /** Ordered list of requirement checks. */
  readonly requirements: readonly DeviceAiRequirementStatus[];
  /** Fast-fail reasons applied when the full protocol is active. */
  readonly failures: readonly string[];
}

/** Detect whether the current host can execute native iOS builds and simulator tooling. */
export function hostSupportsIosBuilds(hostOs: DeviceAiHostOs): boolean {
  return hostOs === "Darwin";
}

/** Detect whether iOS execution has been explicitly delegated away from the local host. */
export function iosBuildIsDelegated(env: DeviceAiReadinessEnvironment): boolean {
  return (env.VERTU_IOS_BUILD_MODE?.trim() || "native") === "delegate";
}

/** Decide whether the full device-AI protocol should execute on the current host. */
export function shouldRunDeviceAiProtocol(
  hostOs: DeviceAiHostOs,
  env: DeviceAiReadinessEnvironment,
): boolean {
  if (iosBuildIsDelegated(env)) {
    return false;
  }
  if ((env.VERTU_VERIFY_DEVICE_AI_PROTOCOL?.trim() || "") === "1") {
    return true;
  }
  return (env.CI?.trim() || "") === "true" && hostSupportsIosBuilds(hostOs);
}

function hasHuggingFaceToken(env: DeviceAiReadinessEnvironment): boolean {
  return (env.HF_TOKEN?.trim() || env.HUGGINGFACE_HUB_TOKEN?.trim() || "").length > 0;
}

/**
 * Evaluate current host readiness for the canonical native device-AI protocol.
 * This helper is pure apart from the injected command probes.
 */
export function evaluateDeviceAiReadiness(
  profile: DeviceAiProtocolProfile,
  hostOs: DeviceAiHostOs,
  env: DeviceAiReadinessEnvironment,
  probes: {
    /** Check whether a command is available on PATH. */
    readonly commandExists: (command: string) => boolean;
    /** Check whether xcrun can invoke simctl successfully. */
    readonly iosSimctlAvailable: () => boolean;
  },
): DeviceAiReadinessSummary {
  const delegated = iosBuildIsDelegated(env);
  const shouldRun = shouldRunDeviceAiProtocol(hostOs, env);
  const iosHostSatisfied = !profile.platforms.ios.required || hostSupportsIosBuilds(hostOs);
  const xcrunRequired = profile.platforms.ios.required && iosHostSatisfied;
  const xcrunSatisfied = !xcrunRequired || probes.commandExists("xcrun");
  const simctlRequired = xcrunRequired && xcrunSatisfied;
  const requirements: DeviceAiRequirementStatus[] = [
    {
      code: "hf_token",
      required: profile.runtimeRequirements.cloudHuggingFace,
      satisfied: !profile.runtimeRequirements.cloudHuggingFace || hasHuggingFaceToken(env),
      failureMessage: "HF_TOKEN or HUGGINGFACE_HUB_TOKEN is required for the mandatory Hugging Face runtime probe.",
    },
    {
      code: "android_adb",
      required: profile.platforms.android.required,
      satisfied: !profile.platforms.android.required || probes.commandExists("adb"),
      failureMessage: "adb is required for the mandatory Android device protocol.",
    },
    {
      code: "ios_macos_host",
      required: profile.platforms.ios.required,
      satisfied: iosHostSatisfied,
      failureMessage: "The mandatory iOS device protocol requires a macOS host.",
    },
    {
      code: "ios_xcrun",
      required: xcrunRequired,
      satisfied: xcrunSatisfied,
      failureMessage: "xcrun is required for the mandatory iOS device protocol.",
    },
    {
      code: "ios_simctl",
      required: simctlRequired,
      satisfied: !simctlRequired || probes.iosSimctlAvailable(),
      failureMessage: "xcrun simctl is required for the mandatory iOS device protocol.",
    },
  ];

  const failures = shouldRun
    ? requirements.filter((requirement) => requirement.required && !requirement.satisfied).map((requirement) => requirement.failureMessage)
    : [];

  if (delegated) {
    return {
      status: "delegated",
      hostOs,
      shouldRun,
      delegated,
      requirements,
      failures,
    };
  }
  if (!shouldRun) {
    return {
      status: "skipped",
      hostOs,
      shouldRun,
      delegated,
      requirements,
      failures,
    };
  }
  return {
    status: failures.length === 0 ? "ready" : "blocked",
    hostOs,
    shouldRun,
    delegated,
    requirements,
    failures,
  };
}

/** Extract fast-fail prerequisite failures for the explicit native device gate. */
export function getDeviceAiProtocolPreflightFailures(
  profile: DeviceAiProtocolProfile,
  hostOs: DeviceAiHostOs,
  env: DeviceAiReadinessEnvironment,
  probes: {
    /** Check whether a command is available on PATH. */
    readonly commandExists: (command: string) => boolean;
    /** Check whether xcrun can invoke simctl successfully. */
    readonly iosSimctlAvailable: () => boolean;
  },
): string[] {
  return [...evaluateDeviceAiReadiness(profile, hostOs, env, probes).failures];
}
