import { resolve } from "node:path";
import { DEVICE_AI_PROTOCOL_PROFILE } from "./config";
import { DEVICE_AI_READINESS_ROUTE } from "./runtime-constants";
import {
  createDeviceAiReadinessEnvironment,
  evaluateDeviceAiReadiness,
  resolveDeviceAiHostOs,
} from "../../shared/device-ai-readiness";
import {
  commandExists,
  isSimctlAvailable,
  resolveAdbExecutablePath,
} from "../../shared/host-tooling";
import { readLatestAppBuildMatrixReport } from "../../shared/app-build-matrix-report";
import type {
  DeviceAiBuildArtifactState,
  DeviceAiReadinessEnvelope,
  DeviceAiReadinessResult,
} from "../../contracts/flow-contracts";

function coerceBuildStatus(value: string | undefined): DeviceAiBuildArtifactState["status"] {
  if (
    value === "pass"
    || value === "fail"
    || value === "delegated"
    || value === "pending"
    || value === "missing"
  ) {
    return value;
  }
  return "missing";
}

function readLatestBuildArtifacts(): DeviceAiReadinessResult["buildArtifacts"] {
  const reportResult = readLatestAppBuildMatrixReport(resolve(import.meta.dir, "..", ".."));
  if (!reportResult.ok) {
    return {
      android: { platform: "android", status: "missing" },
      ios: { platform: "ios", status: "missing" },
    };
  }

  const android = reportResult.data.platforms.android;
  const ios = reportResult.data.platforms.ios;
  return {
    android: {
      platform: "android",
      status: coerceBuildStatus(android?.status),
      ...(android?.artifactPath ? { artifactPath: android.artifactPath } : {}),
      ...(android?.failureCode ? { failureCode: android.failureCode } : {}),
      ...(android?.failureMessage ? { failureMessage: android.failureMessage } : {}),
    },
    ios: {
      platform: "ios",
      status: coerceBuildStatus(ios?.status),
      ...(ios?.artifactPath ? { artifactPath: ios.artifactPath } : {}),
      ...(ios?.failureCode ? { failureCode: ios.failureCode } : {}),
      ...(ios?.failureMessage ? { failureMessage: ios.failureMessage } : {}),
    },
  };
}

/**
 * Resolve the current host/device readiness envelope for the dashboard build surface.
 */
export function resolveDeviceAiReadinessEnvelope(): DeviceAiReadinessEnvelope {
  const hostOs = resolveDeviceAiHostOs(process.platform);
  const readinessEnvironment = createDeviceAiReadinessEnvironment(process.env);
  const summary = evaluateDeviceAiReadiness(
    DEVICE_AI_PROTOCOL_PROFILE,
    hostOs,
    readinessEnvironment,
    {
      commandExists: (command) => command === "adb"
        ? resolveAdbExecutablePath(process.env) !== null
        : commandExists(command, process.env),
      iosSimctlAvailable: () => isSimctlAvailable(readinessEnvironment),
    },
  );

  return {
    route: DEVICE_AI_READINESS_ROUTE,
    state: summary.status === "ready"
      ? "success"
      : summary.status === "blocked"
        ? "error-non-retryable"
        : "empty",
    data: {
      status: summary.status,
      hostOs: summary.hostOs,
      shouldRun: summary.shouldRun,
      delegated: summary.delegated,
      requirements: summary.requirements.map((requirement) => ({
        code: requirement.code,
        required: requirement.required,
        satisfied: requirement.satisfied,
      })),
      failures: [...summary.failures],
      buildArtifacts: readLatestBuildArtifacts(),
    },
    ...(summary.failures.length > 0 ? { mismatches: [...summary.failures] } : {}),
  };
}
