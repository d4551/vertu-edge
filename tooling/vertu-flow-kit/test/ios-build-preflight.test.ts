import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runIosBuildPreflight } from "../src/ios-build-preflight";

const PRELIGHT_SANDBOXES: string[] = [];

function createFakeXcodebuild(stdout: string, stderr: string = "", exitCode: number = 0): string {
  const sandbox = mkdtempSync(join(tmpdir(), "vertu-ios-preflight-"));
  const scriptPath = join(sandbox, "xcodebuild");
  const escapedStdout = JSON.stringify(stdout);
  const escapedStderr = JSON.stringify(stderr);
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s' ${escapedStdout}`,
      `printf '%s' ${escapedStderr} >&2`,
      `exit ${exitCode}`,
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o755);
  PRELIGHT_SANDBOXES.push(sandbox);
  return sandbox;
}

afterEach(() => {
  while (PRELIGHT_SANDBOXES.length > 0) {
    const sandbox = PRELIGHT_SANDBOXES.pop();
    if (sandbox) {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
});

describe("runIosBuildPreflight", () => {
  test("passes when a debug build has an eligible simulator destination", async () => {
    const sandbox = createFakeXcodebuild(
      [
        "Available destinations for scheme VertuEdgeHost:",
        "  { platform:iOS Simulator, id:dvtdevice-DVTiOSDeviceSimulatorPlaceholder-iphonesimulator:placeholder, name:Any iOS Simulator Device }",
      ].join("\n"),
    );

    const result = await runIosBuildPreflight({
      buildType: "debug",
      projectKind: "-workspace",
      projectPath: "/tmp/VertuEdge.xcworkspace",
      scheme: "VertuEdgeHost",
      xcodebuildBin: join(sandbox, "xcodebuild"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.destinationKind).toBe("simulator");
    }
  });

  test("fails when simulator platform support is missing", async () => {
    const sandbox = createFakeXcodebuild(
      [
        "Ineligible destinations for scheme VertuEdgeHost:",
        "  { platform:iOS Simulator, id:dvtdevice-DVTiOSDeviceSimulatorPlaceholder-iphonesimulator:placeholder, name:Any iOS Simulator Device, error:iOS Simulator 18.2 is not installed. To use with Xcode, first download and install the platform }",
      ].join("\n"),
    );

    const result = await runIosBuildPreflight({
      buildType: "debug",
      projectKind: "-workspace",
      projectPath: "/tmp/VertuEdge.xcworkspace",
      scheme: "VertuEdgeHost",
      xcodebuildBin: join(sandbox, "xcodebuild"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ios_platform_support_missing");
      expect(result.error.destinationKind).toBe("simulator");
    }
  });

  test("fails when xcodebuild cannot enumerate destinations", async () => {
    const sandbox = createFakeXcodebuild(
      "",
      "xcodebuild: error: unable to load project",
      70,
    );

    const result = await runIosBuildPreflight({
      buildType: "release",
      projectKind: "-project",
      projectPath: "/tmp/VertuEdge.xcodeproj",
      scheme: "VertuEdgeHost",
      xcodebuildBin: join(sandbox, "xcodebuild"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ios_showdestinations_failed");
      expect(result.error.destinationKind).toBe("device");
    }
  });
});
