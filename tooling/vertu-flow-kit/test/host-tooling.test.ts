import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createAndroidSdkEnvironment,
  createJava21Environment,
  isSimctlAvailable,
  resolveAdbExecutablePath,
  resolveAndroidSdkRoot,
  resolveDeveloperDirForSimctl,
  resolveJava21Home,
  resolveSdkManagerPath,
} from "../../../shared/host-tooling";

function makeExecutableScript(filePath: string, source: string): void {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}

describe("host-tooling", () => {
  test("resolveJava21Home uses configured JAVA_HOME when it contains Java 21", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-java21-home-"));
    const javaHome = join(sandbox, "jdk-21");
    const javaBin = join(javaHome, "bin");
    mkdirSync(javaBin, { recursive: true });
    makeExecutableScript(
      join(javaBin, "java"),
      "#!/usr/bin/env bash\necho 'openjdk version \"21.0.2\"' 1>&2\n",
    );

    const resolved = await resolveJava21Home({ JAVA_HOME: javaHome });
    expect(resolved).not.toBeNull();
    expect(resolved?.javaHome).toBe(javaHome);
    expect(resolved?.source).toBe("env");

    rmSync(sandbox, { recursive: true, force: true });
  });

  test("resolveAndroidSdkRoot prefers ANDROID_SDK_ROOT", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-android-sdk-root-"));
    const sdkRoot = join(sandbox, "sdk");
    mkdirSync(sdkRoot, { recursive: true });

    const resolved = resolveAndroidSdkRoot({ ANDROID_SDK_ROOT: sdkRoot });
    expect(resolved).not.toBeNull();
    expect(resolved?.sdkRoot).toBe(sdkRoot);
    expect(resolved?.source).toBe("env");

    rmSync(sandbox, { recursive: true, force: true });
  });

  test("resolveSdkManagerPath returns the canonical cmdline-tools binary", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-sdkmanager-"));
    const sdkRoot = join(sandbox, "sdk");
    const sdkManager = join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
    mkdirSync(join(sdkRoot, "cmdline-tools", "latest", "bin"), { recursive: true });
    makeExecutableScript(sdkManager, "#!/usr/bin/env bash\nexit 0\n");

    expect(resolveSdkManagerPath({}, sdkRoot)).toBe(sdkManager);

    rmSync(sandbox, { recursive: true, force: true });
  });

  test("resolveAdbExecutablePath uses resolved Android SDK root when PATH is empty", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-adb-root-"));
    const sdkRoot = join(sandbox, "sdk");
    const adbPath = join(sdkRoot, "platform-tools", "adb");
    mkdirSync(join(sdkRoot, "platform-tools"), { recursive: true });
    makeExecutableScript(adbPath, "#!/usr/bin/env bash\nexit 0\n");

    const resolved = resolveAdbExecutablePath({ ANDROID_SDK_ROOT: sdkRoot, PATH: "" });
    expect(resolved).toBe(adbPath);

    rmSync(sandbox, { recursive: true, force: true });
  });

  test("createJava21Environment prepends JAVA_HOME/bin to PATH", () => {
    const environment = createJava21Environment({ PATH: "/usr/bin" }, "/tmp/jdk-21");
    expect(environment.JAVA_HOME).toBe("/tmp/jdk-21");
    expect(environment.PATH?.startsWith("/tmp/jdk-21/bin")).toBe(true);
  });

  test("createAndroidSdkEnvironment sets SDK variables and platform-tools path", () => {
    const environment = createAndroidSdkEnvironment({ PATH: "/usr/bin" }, "/tmp/android-sdk");
    expect(environment.ANDROID_SDK_ROOT).toBe("/tmp/android-sdk");
    expect(environment.ANDROID_HOME).toBe("/tmp/android-sdk");
    expect(environment.PATH?.startsWith("/tmp/android-sdk/platform-tools")).toBe(true);
  });

  test("resolveDeveloperDirForSimctl prefers DEVELOPER_DIR when it exists", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-simctl-developer-dir-"));
    const developerDir = join(sandbox, "Xcode.app", "Contents", "Developer");
    mkdirSync(developerDir, { recursive: true });

    expect(resolveDeveloperDirForSimctl({ DEVELOPER_DIR: developerDir })).toBe(developerDir);

    rmSync(sandbox, { recursive: true, force: true });
  });

  test("isSimctlAvailable honors PATH-scoped xcrun and DEVELOPER_DIR", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vertu-simctl-available-"));
    const binDir = join(sandbox, "bin");
    const developerDir = join(sandbox, "Xcode.app", "Contents", "Developer");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(developerDir, { recursive: true });
    makeExecutableScript(
      join(binDir, "xcrun"),
      `#!/usr/bin/env bash
if [ "$1" = "simctl" ] && [ "$2" = "help" ] && [ "$DEVELOPER_DIR" = "${developerDir}" ]; then
  exit 0
fi
exit 1
`,
    );

    expect(
      isSimctlAvailable({
        PATH: [binDir, process.env.PATH ?? ""].filter((segment) => segment.length > 0).join(":"),
        DEVELOPER_DIR: developerDir,
      }),
    ).toBe(true);

    rmSync(sandbox, { recursive: true, force: true });
  });
});
