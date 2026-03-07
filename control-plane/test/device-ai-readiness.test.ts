import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { resolveDeviceAiReadinessEnvelope } from "../src/device-ai-readiness";

function makeExecutableScript(filePath: string, source: string): void {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}

const environmentKeys = [
  "ANDROID_SDK_ROOT",
  "ANDROID_HOME",
  "PATH",
  "VERTU_VERIFY_DEVICE_AI_PROTOCOL",
] as const;

const originalEnvironment = new Map<string, string | undefined>(
  environmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
});

describe("device ai readiness envelope", () => {
  test("uses shared adb resolution from ANDROID_SDK_ROOT when PATH is empty", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-control-plane-adb-"));
    const sdkRoot = join(sandbox, "sdk");
    const adbPath = join(sdkRoot, "platform-tools", "adb");
    mkdirSync(join(sdkRoot, "platform-tools"), { recursive: true });
    makeExecutableScript(adbPath, "#!/usr/bin/env bash\nexit 0\n");

    process.env.ANDROID_SDK_ROOT = sdkRoot;
    process.env.PATH = "";
    process.env.VERTU_VERIFY_DEVICE_AI_PROTOCOL = "1";

    const envelope = resolveDeviceAiReadinessEnvelope();
    const adbRequirement = envelope.data?.requirements.find((requirement) => requirement.code === "android_adb");

    expect(adbRequirement).toBeDefined();
    expect(adbRequirement?.required).toBe(true);
    expect(adbRequirement?.satisfied).toBe(true);

    rmSync(sandbox, { recursive: true, force: true });
  });
});
