import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  getDeviceAiProtocolPreflightFailures,
  getVerificationHostOs,
  hostSupportsIosBuilds,
  iosBuildIsDelegated,
  resolveAdbExecutablePath,
  shouldRunDeviceAiProtocol,
  type VerificationEnvironment,
} from "../src/verification";

describe("verification policy", () => {
  test("hostSupportsIosBuilds only permits Darwin", () => {
    expect(hostSupportsIosBuilds("Darwin")).toBe(true);
    expect(hostSupportsIosBuilds("Linux")).toBe(false);
    expect(hostSupportsIosBuilds("Windows_NT")).toBe(false);
  });

  test("iosBuildIsDelegated respects explicit delegate mode", () => {
    const delegatedEnv: VerificationEnvironment = { VERTU_IOS_BUILD_MODE: "delegate" };
    const nativeEnv: VerificationEnvironment = { VERTU_IOS_BUILD_MODE: "native" };
    expect(iosBuildIsDelegated(delegatedEnv)).toBe(true);
    expect(iosBuildIsDelegated(nativeEnv)).toBe(false);
    expect(iosBuildIsDelegated({})).toBe(false);
  });

  test("shouldRunDeviceAiProtocol follows host-aware policy", () => {
    expect(shouldRunDeviceAiProtocol("Darwin", { CI: "true" })).toBe(true);
    expect(shouldRunDeviceAiProtocol("Linux", { CI: "true" })).toBe(false);
    expect(shouldRunDeviceAiProtocol("Darwin", { VERTU_IOS_BUILD_MODE: "delegate", CI: "true" })).toBe(false);
    expect(shouldRunDeviceAiProtocol("Linux", { VERTU_VERIFY_DEVICE_AI_PROTOCOL: "1" })).toBe(true);
  });

  test("getVerificationHostOs returns a supported enum", () => {
    expect(["Darwin", "Linux", "Windows_NT"]).toContain(getVerificationHostOs());
  });

  test("getDeviceAiProtocolPreflightFailures requires macOS for mandatory iOS protocol", () => {
    const failures = getDeviceAiProtocolPreflightFailures("Linux", { VERTU_VERIFY_DEVICE_AI_PROTOCOL: "1" });
    expect(failures).toContain("The mandatory iOS device protocol requires a macOS host.");
  });

  test("getDeviceAiProtocolPreflightFailures is empty when protocol is not requested", () => {
    expect(getDeviceAiProtocolPreflightFailures("Linux", {})).toEqual([]);
  });

  test("resolveAdbExecutablePath resolves adb from ANDROID_SDK_ROOT when PATH is missing", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-adb-test-"));
    const platformTools = join(sandbox, "platform-tools");
    const adbPath = join(platformTools, "adb");
    mkdirSync(platformTools, { recursive: true });
    writeFileSync(adbPath, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(adbPath, 0o755);

    const resolvedPath = resolveAdbExecutablePath({ ANDROID_SDK_ROOT: sandbox });
    expect(resolvedPath).toBe(adbPath);

    rmSync(sandbox, { recursive: true, force: true });
  });
});
