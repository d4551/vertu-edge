import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createAppBuildMatrixReport,
  readLatestAppBuildMatrixReport,
  resolveLatestAppBuildMatrixReportPath,
} from "../../../shared/app-build-matrix-report";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), "vertu-app-build-report-"));
  temporaryDirectories.push(sandbox);
  return sandbox;
}

describe("app build matrix report", () => {
  test("reads the latest canonical report from the shared latest path", () => {
    const sandbox = createSandbox();
    const latestPath = resolveLatestAppBuildMatrixReportPath(sandbox);
    mkdirSync(resolve(sandbox, ".artifacts", "app-builds"), { recursive: true });
    writeFileSync(
      latestPath,
      JSON.stringify(
        createAppBuildMatrixReport("corr-1", "Darwin", {
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
        }, "2026-03-07T00:00:00.000Z"),
      ),
    );

    const result = readLatestAppBuildMatrixReport(sandbox);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected report read to succeed.");
    }
    expect(result.path).toBe(latestPath);
    expect(result.data.platforms.android.status).toBe("pass");
    expect(result.data.platforms.ios.status).toBe("delegated");
  });

  test("rejects malformed latest reports", () => {
    const sandbox = createSandbox();
    const latestPath = resolveLatestAppBuildMatrixReportPath(sandbox);
    mkdirSync(resolve(sandbox, ".artifacts", "app-builds"), { recursive: true });
    writeFileSync(latestPath, "{\"schemaVersion\":\"1.0\",\"platforms\":{}}");

    const result = readLatestAppBuildMatrixReport(sandbox);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed report read to fail.");
    }
    expect(result.reason).toBe("invalid");
    expect(result.path).toBe(latestPath);
  });
});
