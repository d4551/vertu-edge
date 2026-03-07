import { describe, expect, test } from "bun:test";
import type { DeviceAiProtocolProfile, DeviceAiStageReport } from "../../../contracts/device-ai-protocol";
import { createDeviceAiProtocolRunReport } from "../src/device-ai-protocol";

function createProfile(overrides: Partial<DeviceAiProtocolProfile> = {}): DeviceAiProtocolProfile {
  return {
    profileVersion: "1.0",
    requiredModelRef: "THUDM/AutoGLM-Phone-500M",
    revision: "main",
    requiredModelFile: "model.gguf",
    requiredModelSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    requiredCapabilities: ["mobile_actions", "rpa_controls"],
    runtimeRequirements: {
      localOllama: false,
      cloudHuggingFace: true,
      ...(overrides.runtimeRequirements ?? {}),
    },
    platforms: {
      android: { required: true },
      ios: { required: false },
      ...(overrides.platforms ?? {}),
    },
    protocolTimeoutMs: 900000,
    reportMaxAgeMinutes: 240,
    ...overrides,
  };
}

function createStage(stage: string, status: "pass" | "fail" | "skip", message: string): DeviceAiStageReport {
  return {
    stage,
    status,
    correlationId: `${stage}-corr`,
    startedAt: "2026-03-07T00:00:00.000Z",
    endedAt: "2026-03-07T00:01:00.000Z",
    message,
    retryable: status !== "pass",
  };
}

describe("device ai protocol report builder", () => {
  test("creates a passing report from Android native evidence and optional iOS skip", () => {
    const report = createDeviceAiProtocolRunReport({
      correlationId: "corr-1",
      profile: createProfile({
        requiredCapabilities: ["mobile_actions"],
      }),
      runtime: {
        localOllama: {
          required: false,
          available: false,
          message: "Local runtime not required.",
        },
        cloudHuggingFace: {
          required: true,
          available: true,
          message: "Hugging Face reachable.",
        },
      },
      androidPreflightStage: createStage("android-preflight", "pass", "Android ready."),
      androidDeviceReady: true,
      androidNativeReport: {
        correlationId: "corr-1-android",
        status: "pass",
        state: "success",
        code: "OK",
        message: "Android native protocol passed.",
        startedAtEpochMs: Date.parse("2026-03-07T00:00:00.000Z"),
        completedAtEpochMs: Date.parse("2026-03-07T00:01:00.000Z"),
        artifact: {
          path: "/tmp/android/model.gguf",
          sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          sizeBytes: 4096,
        },
        model: {
          modelRef: "THUDM/AutoGLM-Phone-500M",
          revision: "main",
          fileName: "model.gguf",
          expectedSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          resolvedModelName: "AutoGLM-Phone-500M",
          capabilities: ["mobile_actions", "flow_commands"],
        },
        stages: [
          {
            name: "download_model",
            status: "pass",
            code: "OK",
            message: "Model downloaded.",
          },
        ],
      },
      iosPreflightStage: createStage("ios-preflight", "fail", "No booted simulator."),
      iosDeviceReady: false,
      iosNativeReport: null,
      failures: [],
    });

    expect(report.status).toBe("pass");
    expect(report.platforms.android.status).toBe("pass");
    expect(report.platforms.ios.status).toBe("skip");
    expect(report.model.artifactPath).toBe("/tmp/android/model.gguf");
    expect(report.model.downloaded).toBe(true);
    expect(report.model.capabilities).toEqual(["mobile_actions", "flow_commands"]);
    expect(report.failures).toEqual([]);
  });

  test("deduplicates failures and marks required platform gaps as fail", () => {
    const report = createDeviceAiProtocolRunReport({
      correlationId: "corr-2",
      profile: createProfile({
        platforms: {
          android: { required: true },
          ios: { required: true },
        },
      }),
      runtime: {
        localOllama: {
          required: false,
          available: true,
          message: "Local runtime available.",
        },
        cloudHuggingFace: {
          required: true,
          available: false,
          message: "Missing token.",
        },
      },
      androidPreflightStage: createStage("android-preflight", "fail", "adb unavailable"),
      androidDeviceReady: false,
      androidNativeReport: null,
      iosPreflightStage: createStage("ios-preflight", "fail", "simctl unavailable"),
      iosDeviceReady: false,
      iosNativeReport: null,
      failures: ["Missing token.", "Missing token.", "simctl unavailable"],
    });

    expect(report.status).toBe("fail");
    expect(report.platforms.android.status).toBe("fail");
    expect(report.platforms.ios.status).toBe("fail");
    expect(report.failures).toEqual(["Missing token.", "simctl unavailable"]);
    expect(report.model.downloaded).toBe(false);
    expect(report.model.verified).toBe(false);
    expect(report.model.capabilities).toEqual(["mobile_actions", "rpa_controls"]);
  });

  test("uses iOS native model capabilities when Android native evidence is absent", () => {
    const report = createDeviceAiProtocolRunReport({
      correlationId: "corr-3",
      profile: createProfile({
        requiredCapabilities: ["mobile_actions"],
      }),
      runtime: {
        localOllama: {
          required: false,
          available: true,
          message: "Local runtime available.",
        },
        cloudHuggingFace: {
          required: true,
          available: true,
          message: "Hugging Face reachable.",
        },
      },
      androidPreflightStage: createStage("android-preflight", "skip", "Android not required."),
      androidDeviceReady: false,
      androidNativeReport: null,
      iosPreflightStage: createStage("ios-preflight", "pass", "Simulator ready."),
      iosDeviceReady: true,
      iosNativeReport: {
        correlationId: "corr-3-ios",
        state: "success",
        message: "iOS native protocol passed.",
        artifact: {
          path: "/tmp/ios/model.gguf",
          sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          sizeBytes: 8192,
        },
        model: {
          modelRef: "THUDM/AutoGLM-Phone-500M",
          revision: "main",
          fileName: "model.gguf",
          expectedSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          capabilities: ["mobile_actions", "rpa_controls", "flow_commands"],
        },
        stages: [
          {
            stage: "ios-stage",
            status: "pass",
            correlationId: "corr-3-ios",
            startedAt: "2026-03-07T00:00:00.000Z",
            endedAt: "2026-03-07T00:01:00.000Z",
            message: "Model downloaded and verified in app-managed storage.",
            retryable: false,
          },
        ],
      },
      failures: [],
    });

    expect(report.status).toBe("pass");
    expect(report.platforms.ios.status).toBe("pass");
    expect(report.model.artifactPath).toBe("/tmp/ios/model.gguf");
    expect(report.model.capabilities).toEqual(["mobile_actions", "rpa_controls", "flow_commands"]);
  });
});
