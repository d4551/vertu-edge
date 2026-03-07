import { describe, expect, test } from "bun:test";
import {
  createCorrelationId,
  parseArtifactMetadata,
  resolveDefaultDesktopBuildVariant,
} from "../src/orchestration";
import {
  createAppBuildMatrixReport,
  hasFailedAppBuildMatrix,
} from "../../../shared/app-build-matrix-report";

describe("orchestration helpers", () => {
  test("createCorrelationId returns a lowercase UUID", () => {
    const correlationId = createCorrelationId();
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(correlationId).toBe(correlationId.toLowerCase());
  });

  test("parseArtifactMetadata extracts emitted artifact fields", () => {
    const metadata = parseArtifactMetadata(
      [
        "ARTIFACT_PATH=/tmp/app-debug.apk",
        "ARTIFACT_SHA256=abc123",
        "ARTIFACT_SIZE_BYTES=2048",
        "ARTIFACT_CONTENT_TYPE=application/vnd.android.package-archive",
        "ARTIFACT_CREATED_AT=2026-03-06T00:00:00.000Z",
      ].join("\n"),
    );

    expect(metadata).not.toBeNull();
    expect(metadata).toEqual({
      artifactPath: "/tmp/app-debug.apk",
      artifactSha256: "abc123",
      artifactSizeBytes: 2048,
      artifactContentType: "application/vnd.android.package-archive",
      artifactCreatedAt: "2026-03-06T00:00:00.000Z",
    });
  });

  test("parseArtifactMetadata rejects incomplete output", () => {
    const metadata = parseArtifactMetadata("ARTIFACT_PATH=/tmp/app-debug.apk");
    expect(metadata).toBeNull();
  });

  test("resolveDefaultDesktopBuildVariant maps supported host combinations", () => {
    expect(resolveDefaultDesktopBuildVariant("darwin", "arm64")).toBe("darwin-arm64");
    expect(resolveDefaultDesktopBuildVariant("linux", "x64")).toBe("linux-x64");
    expect(resolveDefaultDesktopBuildVariant("win32", "x64")).toBe("windows-x64");
  });

  test("resolveDefaultDesktopBuildVariant rejects unsupported host combinations", () => {
    expect(resolveDefaultDesktopBuildVariant("freebsd", "x64")).toBeNull();
    expect(resolveDefaultDesktopBuildVariant("win32", "arm64")).toBeNull();
  });

  test("createAppBuildMatrixReport persists desktop alongside Android and iOS", () => {
    const report = createAppBuildMatrixReport("corr-1", "Darwin", {
      android: {
        platform: "android",
        status: "pass",
        message: "Android passed",
        logPath: "/tmp/android.log",
      },
      ios: {
        platform: "ios",
        status: "delegated",
        message: "iOS delegated",
        logPath: "/tmp/ios.log",
      },
      desktop: {
        platform: "desktop",
        status: "pass",
        message: "Desktop passed",
        logPath: "/tmp/desktop.log",
      },
    }, "2026-03-06T00:00:00.000Z");

    expect(report.platforms.desktop.platform).toBe("desktop");
    expect(report.platforms.desktop.status).toBe("pass");
    expect(report.generatedAt).toBe("2026-03-06T00:00:00.000Z");
    expect(hasFailedAppBuildMatrix(report)).toBe(false);
  });

  test("createAppBuildMatrixReport preserves typed failure metadata", () => {
    const report = createAppBuildMatrixReport("corr-3", "Darwin", {
      android: {
        platform: "android",
        status: "pass",
        message: "Android passed",
        logPath: "/tmp/android.log",
      },
      ios: {
        platform: "ios",
        status: "fail",
        message: "Missing iOS simulator platform support for scheme VertuEdgeHost.",
        logPath: "/tmp/ios.log",
        failureCode: "ios_platform_support_missing",
        failureMessage: "Missing iOS simulator platform support for scheme VertuEdgeHost.",
      },
      desktop: {
        platform: "desktop",
        status: "pass",
        message: "Desktop passed",
        logPath: "/tmp/desktop.log",
      },
    });

    expect(report.platforms.ios.failureCode).toBe("ios_platform_support_missing");
    expect(report.platforms.ios.failureMessage).toBe("Missing iOS simulator platform support for scheme VertuEdgeHost.");
  });

  test("hasFailedAppBuildMatrix detects terminal failures without treating delegation as failure", () => {
    const report = createAppBuildMatrixReport("corr-2", "Linux", {
      android: {
        platform: "android",
        status: "pass",
        message: "Android passed",
        logPath: "/tmp/android.log",
      },
      ios: {
        platform: "ios",
        status: "delegated",
        message: "iOS delegated",
        logPath: "/tmp/ios.log",
      },
      desktop: {
        platform: "desktop",
        status: "fail",
        message: "Desktop failed",
        logPath: "/tmp/desktop.log",
      },
    });

    expect(hasFailedAppBuildMatrix(report)).toBe(true);
  });
});
