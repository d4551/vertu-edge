import { resolve } from "node:path";
import { REPO_ROOT, readDeviceAiProtocolProfile, runAppBuildMatrix } from "./orchestration";
import { runDeviceAiProtocol as runTypedDeviceAiProtocol } from "./device-ai-protocol";
import {
  commandExists,
  createAndroidSdkEnvironment,
  createJava21Environment,
  ensureAndroidLocalProperties,
  ensureAndroidSdkAvailable,
  ensureJava21Available,
  isSimctlAvailable,
  resolveAdbExecutablePath,
} from "../../../shared/host-tooling";
import { runCommand } from "./subprocess";
import {
  createDeviceAiReadinessEnvironment,
  getDeviceAiProtocolPreflightFailures as getSharedDeviceAiProtocolPreflightFailures,
  hostSupportsIosBuilds,
  iosBuildIsDelegated,
  resolveDeviceAiHostOs,
  shouldRunDeviceAiProtocol,
  type DeviceAiHostOs,
  type DeviceAiReadinessEnvironment,
} from "../../../shared/device-ai-readiness";

export { hostSupportsIosBuilds, iosBuildIsDelegated, shouldRunDeviceAiProtocol };
export { resolveAdbExecutablePath } from "../../../shared/host-tooling";

/** Stable host operating system names used by verification policy. */
export type VerificationHostOs = DeviceAiHostOs;

/** Minimal environment surface consumed by verification policy. */
export type VerificationEnvironment = DeviceAiReadinessEnvironment;

function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

function buildVerificationEnvironment(): VerificationEnvironment {
  return createDeviceAiReadinessEnvironment(process.env);
}
function writeLine(message: string): void {
  process.stdout.write(`[verify] ${message}\n`);
}

function writeStepOutput(result: { readonly stdout: string; readonly stderr: string }): void {
  if (result.stdout.trim().length > 0) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr.trim().length > 0) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

function assertCommandSucceeded(
  result: { readonly success: boolean; readonly exitCode: number; readonly stdout: string; readonly stderr: string },
  failureMessage: string,
): void {
  writeStepOutput(result);
  if (!result.success) {
    throw new Error(`${failureMessage} (exit ${result.exitCode})`);
  }
}

/** Resolve the normalized host OS name from the current Bun runtime. */
export function getVerificationHostOs(): VerificationHostOs {
  return resolveDeviceAiHostOs(process.platform);
}

/** Compute fast-fail prerequisite gaps for the full native device-AI protocol. */
export function getDeviceAiProtocolPreflightFailures(
  hostOs: VerificationHostOs,
  env: VerificationEnvironment,
): string[] {
  return getSharedDeviceAiProtocolPreflightFailures(
    readDeviceAiProtocolProfile(),
    hostOs,
    env,
    {
      commandExists: (command) => {
        if (command === "adb") {
          return resolveAdbExecutablePath({ ...env }) !== null;
        }
        return commandExists(command);
      },
      iosSimctlAvailable: () => {
        if (hostOs !== "Darwin") {
          return false;
        }
        return isSimctlAvailable(env);
      },
    },
  );
}

function assertDeviceAiProtocolPreflight(hostOs: VerificationHostOs, env: VerificationEnvironment): void {
  const failures = getDeviceAiProtocolPreflightFailures(hostOs, env);
  if (failures.length === 0) {
    return;
  }
  throw new Error(
    [
      "Device AI protocol prerequisites are missing.",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
}

async function runVerificationStep(label: string, command: readonly string[], cwd: string): Promise<void> {
  await runVerificationStepWithEnv(label, command, cwd);
}

async function runVerificationStepWithEnv(
  label: string,
  command: readonly string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<void> {
  writeLine(label);
  const result = await runCommand(command, {
    cwd,
    ...(env ? { env } : {}),
  });
  assertCommandSucceeded(result, label);
}

async function runAndroidTests(): Promise<void> {
  const java21Availability = await ensureJava21Available(process.env);
  if (!java21Availability.ok) {
    throw new Error(java21Availability.message);
  }
  const javaEnvironment = createJava21Environment(process.env, java21Availability.data.javaHome);

  const androidSdkAvailability = await ensureAndroidSdkAvailable(javaEnvironment);
  if (!androidSdkAvailability.ok) {
    throw new Error(androidSdkAvailability.message);
  }
  const androidEnvironment = createAndroidSdkEnvironment(javaEnvironment, androidSdkAvailability.data.sdkRoot);
  ensureAndroidLocalProperties(REPO_ROOT, androidSdkAvailability.data.sdkRoot);

  await runVerificationStepWithEnv(
    "Android/KMP unit tests",
    ["./gradlew", ":vertu-core:jvmTest", ":vertu-android-rpa:testDebugUnitTest"],
    repoPath("Android", "src"),
    androidEnvironment,
  );
}

async function runIosTests(hostOs: VerificationHostOs, env: VerificationEnvironment): Promise<void> {
  if (iosBuildIsDelegated(env)) {
    writeLine("Skipping iOS swift package tests because VERTU_IOS_BUILD_MODE=delegate.");
    return;
  }
  if (!hostSupportsIosBuilds(hostOs)) {
    writeLine("Skipping iOS swift package tests on non-macOS host.");
    return;
  }
  await runVerificationStep(
    "iOS swift package tests",
    ["swift", "test"],
    repoPath("iOS", "VertuEdge"),
  );
}

async function runAppGenerationBuildMatrix(): Promise<void> {
  writeLine("Application generation build matrix");
  const report = await runAppBuildMatrix();
  writeLine(`Android build status: ${report.platforms.android.status}`);
  writeLine(`iOS build status: ${report.platforms.ios.status}`);
  writeLine(`Desktop build status: ${report.platforms.desktop.status}`);
}

async function runDeviceAiProtocol(hostOs: VerificationHostOs, env: VerificationEnvironment): Promise<void> {
  if (!shouldRunDeviceAiProtocol(hostOs, env)) {
    writeLine("Skipping device AI protocol on this host. Full device gate runs on macOS CI or when VERTU_VERIFY_DEVICE_AI_PROTOCOL=1.");
    return;
  }
  writeLine("Device AI protocol (Android + iOS + HF download + smoke)");
  await runTypedDeviceAiProtocol();
}

async function runPolicyAudits(hostOs: VerificationHostOs, env: VerificationEnvironment): Promise<void> {
  writeLine("Repository policy audits");
  const cwd = repoPath("tooling", "vertu-flow-kit");
  assertCommandSucceeded(await runCommand(["bun", "src/cli.ts", "audit", "code-practices"], { cwd }), "Repository policy audits");
  assertCommandSucceeded(await runCommand(["bun", "src/cli.ts", "audit", "capability-gaps"], { cwd }), "Repository policy audits");
  assertCommandSucceeded(await runCommand(["bun", "src/cli.ts", "audit", "provider-credentials"], { cwd }), "Repository policy audits");
  if (shouldRunDeviceAiProtocol(hostOs, env)) {
    assertCommandSucceeded(await runCommand(["bun", "src/cli.ts", "audit", "device-readiness"], { cwd }), "Repository policy audits");
  } else {
    writeLine("Skipping device-readiness audit on this host. Run on macOS CI or set VERTU_VERIFY_DEVICE_AI_PROTOCOL=1.");
  }
  assertCommandSucceeded(await runCommand(["bun", "src/cli.ts", "audit", "version-freshness"], { cwd }), "Repository policy audits");
}

async function resolveControlPlanePort(): Promise<number> {
  const envPort = process.env.CONTROL_PLANE_PORT?.trim() || process.env.PORT?.trim();
  if (envPort) {
    const parsed = Number.parseInt(envPort, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  const command = [
    process.execPath,
    "-e",
    "import { CONTROL_PLANE_DEFAULT_PORT } from './control-plane/src/config'; process.stdout.write(String(CONTROL_PLANE_DEFAULT_PORT));",
  ] as const;
  const result = await runCommand(command, { cwd: REPO_ROOT });
  assertCommandSucceeded(result, "Resolve control-plane port");
  const parsed = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("Unable to resolve control-plane port.");
  }
  return parsed;
}

async function waitForHealth(url: string, attempts: number, delayMs: number): Promise<boolean> {
  let remaining = attempts;
  while (remaining > 0) {
    const ok = await fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    if (ok) {
      return true;
    }
    remaining -= 1;
    if (remaining > 0) {
      await Bun.sleep(delayMs);
    }
  }
  return false;
}

/** Smoke boot the control-plane server and verify the health route responds. */
export async function runControlPlaneSmokeTest(): Promise<void> {
  const port = await resolveControlPlanePort();
  writeLine("Smoke testing control-plane HTTP server");
  const proc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: repoPath("control-plane"),
    env: {
      ...process.env,
      CONTROL_PLANE_PORT: String(port),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const healthOk = await waitForHealth(`http://127.0.0.1:${port}/api/health`, 10, 500);
  proc.kill();
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (healthOk) {
    if (stdout.trim().length > 0) {
      process.stdout.write(stdout);
      if (!stdout.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
    return;
  }
  if (stderr.trim().length > 0) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
  throw new Error(`Control-plane smoke test failed (exit ${exitCode}).`);
}

/** Run the full typed verification sequence for the repository. */
export async function runVerificationAll(): Promise<void> {
  const hostOs = getVerificationHostOs();
  const env = buildVerificationEnvironment();
  assertDeviceAiProtocolPreflight(hostOs, env);

  await runVerificationStep(
    "Control-plane: typecheck + lint + test",
    ["bash", "-lc", "bun run typecheck && bun run lint && bun test"],
    repoPath("control-plane"),
  );
  await runVerificationStep(
    "Flow-kit: typecheck + lint + test + doctor",
    ["bash", "-lc", "bun run typecheck && bun run lint && bun test && bun run doctor"],
    repoPath("tooling", "vertu-flow-kit"),
  );
  await runIosTests(hostOs, env);
  await runAndroidTests();
  await runControlPlaneSmokeTest();
  await runAppGenerationBuildMatrix();
  await runDeviceAiProtocol(hostOs, env);
  await runPolicyAudits(hostOs, env);
}
