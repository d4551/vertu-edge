import { expect, test, describe } from "bun:test";
import { initDb } from "../src/db";
import {
  isSupportedBuildKind,
  SUPPORTED_BUILD_KINDS,
} from "../../contracts/flow-contracts";
import { parseAppBuildPayload, serializeAppBuildPayload } from "../src/model-jobs";
import {
  SUPPORTED_DESKTOP_BUILD_VARIANTS,
  APP_BUILD_DESKTOP_BUN_MISSING_REASON,
  APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON,
} from "../src/config";
import { resolveDefaultDesktopBuildVariant } from "../../shared/app-build";

initDb();

// ---------------------------------------------------------------------------
// BuildKind includes desktop
// ---------------------------------------------------------------------------

describe("BuildKind desktop support", () => {
  test("desktop is a supported BuildKind", () => {
    expect(isSupportedBuildKind("desktop")).toBe(true);
  });

  test("SUPPORTED_BUILD_KINDS includes desktop", () => {
    expect(SUPPORTED_BUILD_KINDS).toContain("desktop");
  });

  test("android and ios remain supported", () => {
    expect(isSupportedBuildKind("android")).toBe(true);
    expect(isSupportedBuildKind("ios")).toBe(true);
  });

  test("unknown platforms remain rejected", () => {
    expect(isSupportedBuildKind("web")).toBe(false);
    expect(isSupportedBuildKind("wasm")).toBe(false);
    expect(isSupportedBuildKind("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AppBuildJobPayload serialization/deserialization for desktop
// ---------------------------------------------------------------------------

describe("AppBuildJobPayload desktop round-trip", () => {
  test("serializes and parses desktop platform payload", () => {
    const payload = {
      platform: "desktop" as const,
      buildType: "release" as const,
      variant: "linux-x64",
      skipTests: true,
      clean: false,
      outputDir: undefined,
      correlationId: "test-corr-1",
    };
    const serialized = serializeAppBuildPayload(payload);
    const parsed = parseAppBuildPayload(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed!.platform).toBe("desktop");
    expect(parsed!.buildType).toBe("release");
    expect(parsed!.variant).toBe("linux-x64");
    expect(parsed!.skipTests).toBe(true);
    expect(parsed!.clean).toBe(false);
    expect(parsed!.correlationId).toBe("test-corr-1");
  });

  test("serializes desktop payload without variant", () => {
    const payload = {
      platform: "desktop" as const,
      buildType: "debug" as const,
      skipTests: false,
      clean: true,
    };
    const serialized = serializeAppBuildPayload(payload);
    const parsed = parseAppBuildPayload(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed!.platform).toBe("desktop");
    expect(parsed!.buildType).toBe("debug");
    expect(parsed!.variant).toBeUndefined();
    expect(parsed!.clean).toBe(true);
  });

  test("preserves backward compat for android/ios payloads", () => {
    const androidPayload = {
      platform: "android" as const,
      buildType: "debug" as const,
      skipTests: false,
      clean: false,
    };
    const parsed = parseAppBuildPayload(serializeAppBuildPayload(androidPayload));
    expect(parsed).not.toBeNull();
    expect(parsed!.platform).toBe("android");

    const iosPayload = {
      platform: "ios" as const,
      buildType: "release" as const,
      skipTests: true,
      clean: true,
    };
    const parsedIos = parseAppBuildPayload(serializeAppBuildPayload(iosPayload));
    expect(parsedIos).not.toBeNull();
    expect(parsedIos!.platform).toBe("ios");
  });
});

// ---------------------------------------------------------------------------
// Desktop build variant validation
// ---------------------------------------------------------------------------

describe("desktop build variant constants", () => {
  test("SUPPORTED_DESKTOP_BUILD_VARIANTS includes all expected targets", () => {
    expect(SUPPORTED_DESKTOP_BUILD_VARIANTS).toContain("linux-x64");
    expect(SUPPORTED_DESKTOP_BUILD_VARIANTS).toContain("linux-arm64");
    expect(SUPPORTED_DESKTOP_BUILD_VARIANTS).toContain("darwin-arm64");
    expect(SUPPORTED_DESKTOP_BUILD_VARIANTS).toContain("darwin-x64");
    expect(SUPPORTED_DESKTOP_BUILD_VARIANTS).toContain("windows-x64");
  });

  test("variant count is exactly 5", () => {
    expect(SUPPORTED_DESKTOP_BUILD_VARIANTS.length).toBe(5);
  });

  test("host desktop variant resolver maps supported hosts", () => {
    expect(resolveDefaultDesktopBuildVariant("darwin", "arm64")).toBe("darwin-arm64");
    expect(resolveDefaultDesktopBuildVariant("linux", "x64")).toBe("linux-x64");
    expect(resolveDefaultDesktopBuildVariant("win32", "x64")).toBe("windows-x64");
  });

  test("host desktop variant resolver rejects unsupported hosts", () => {
    expect(resolveDefaultDesktopBuildVariant("win32", "arm64")).toBeNull();
    expect(resolveDefaultDesktopBuildVariant("freebsd", "x64")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Config constants exist
// ---------------------------------------------------------------------------

describe("desktop build config constants", () => {
  test("APP_BUILD_DESKTOP_BUN_MISSING_REASON is a non-empty string", () => {
    expect(typeof APP_BUILD_DESKTOP_BUN_MISSING_REASON).toBe("string");
    expect(APP_BUILD_DESKTOP_BUN_MISSING_REASON.length).toBeGreaterThan(0);
  });

  test("APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON is a non-empty string", () => {
    expect(typeof APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON).toBe("string");
    expect(APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Desktop build prerequisite alignment
// ---------------------------------------------------------------------------

describe("runtime prerequisite alignment", () => {
  test("Bun is available (required for desktop builds)", () => {
    expect(Bun.which("bun")).not.toBeNull();
  });

  test("Java availability for Android builds", () => {
    // Java 21 must be available for Android builds
    const javaPath = Bun.which("java");
    expect(javaPath).not.toBeNull();
  });

  test("desktop build wrapper exists", async () => {
    const { resolve } = await import("path");
    const scriptPath = resolve(import.meta.dir, "..", "..", "scripts", "run_desktop_build.sh");
    const file = Bun.file(scriptPath);
    expect(await file.exists()).toBe(true);
  });

  test("android build wrapper exists", async () => {
    const { resolve } = await import("path");
    const scriptPath = resolve(import.meta.dir, "..", "..", "scripts", "run_android_build.sh");
    const file = Bun.file(scriptPath);
    expect(await file.exists()).toBe(true);
  });

  test("ios build script exists", async () => {
    const { resolve } = await import("path");
    const scriptPath = resolve(import.meta.dir, "..", "..", "scripts", "run_ios_build.sh");
    const file = Bun.file(scriptPath);
    expect(await file.exists()).toBe(true);
  });
});
