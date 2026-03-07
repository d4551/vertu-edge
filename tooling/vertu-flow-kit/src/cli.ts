#!/usr/bin/env bun

import {
  compileFlowFile,
  doctor,
  validateDeviceAiProfileFile,
  validateDeviceAiReportFile,
  validateFlowFile,
  validateModelManifestFile,
} from "./commands";
import {
  downloadPinnedDeviceAiModel,
  runBootstrap,
  runAppBuildPlatform,
  runAppBuildMatrix,
} from "./orchestration";
import { runDeviceAiProtocol } from "./device-ai-protocol";
import {
  runControlPlaneSmokeTest,
  runVerificationAll,
} from "./verification";
import { runIosBuildPreflight, type IosBuildProjectKind, type IosBuildType } from "./ios-build-preflight";
import { formatAppBuildFailureMetadata } from "../../../shared/app-build-failures";
import {
  auditCodePractices,
  auditDeviceReadiness,
  auditCapabilityGaps,
  auditProviderCredentials,
  auditVersionFreshness,
} from "./audit";

/** Entry point for vertu-flow command line usage. */
async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(
      [
        "Usage:",
        "  vertu-flow validate <flow.yaml>",
        "  vertu-flow validate-model-manifest <manifest.json>",
        "  vertu-flow validate-device-ai-profile <profile.json>",
        "  vertu-flow validate-device-ai-report <report.json>",
        "  vertu-flow compile <flow.yaml> [output.json]",
        "  vertu-flow build matrix",
        "  vertu-flow build android [--build-type=debug|release] [--variant=<flavor>] [--skip-tests] [--clean] [--output-dir=<path>]",
        "  vertu-flow build ios [--build-type=debug|release] [--variant=<scheme>] [--skip-tests] [--clean] [--output-dir=<path>]",
        "  vertu-flow build desktop [--build-type=debug|release] [--variant=<target-triple>] [--skip-tests] [--clean] [--output-dir=<path>]",
        "  vertu-flow ios-build preflight --project-kind=-workspace|--project-kind=-project --project-path=<path> --scheme=<name> --build-type=debug|release [--developer-dir=<path>] [--xcodebuild-bin=<path>]",
        "  vertu-flow bootstrap",
        "  vertu-flow device-ai download-model",
        "  vertu-flow device-ai run-protocol",
        "  vertu-flow verify all",
        "  vertu-flow verify smoke-control-plane",
        "  vertu-flow doctor",
        "  vertu-flow audit code-practices",
        "  vertu-flow audit capability-gaps",
        "  vertu-flow audit provider-credentials",
        "  vertu-flow audit device-readiness",
        "  vertu-flow audit version-freshness [--online]",
      ].join("\n") + "\n",
    );
    return 0;
  }

  if (command === "validate") {
    const flowPath = rest[0];
    if (!flowPath) {
      throw new Error("Missing flow path for validate command");
    }
    validateFlowFile(flowPath);
    return 0;
  }

  if (command === "validate-model-manifest") {
    const manifestPath = rest[0];
    if (!manifestPath) {
      throw new Error("Missing manifest path for validate-model-manifest command");
    }
    validateModelManifestFile(manifestPath);
    return 0;
  }

  if (command === "compile") {
    const flowPath = rest[0];
    const outputPath = rest[1];
    if (!flowPath) {
      throw new Error("Missing flow path for compile command");
    }
    compileFlowFile(flowPath, outputPath);
    return 0;
  }

  if (command === "build") {
    const target = rest[0];
    if (target === "matrix") {
      await runAppBuildMatrix();
      return 0;
    }
    if (target === "android" || target === "ios" || target === "desktop") {
      const result = await runAppBuildPlatform(target, parseBuildCommandOptions(rest.slice(1)));
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
      return result.exitCode;
    }
    throw new Error(`Unknown build target: ${target ?? ""}`);
  }

  if (command === "ios-build") {
    const subcommand = rest[0];
    if (subcommand === "preflight") {
      const options = parseIosBuildPreflightOptions(rest.slice(1));
      const result = await runIosBuildPreflight(options);
      if (!result.ok) {
        process.stderr.write(`${formatAppBuildFailureMetadata({
          code: result.error.code,
          message: result.error.message,
        })}\n`);
        throw new Error(result.error.message);
      }
      process.stdout.write(
        `OK: ${result.data.destinationLabel} destination is available for scheme ${options.scheme}.\n`,
      );
      return 0;
    }
    throw new Error(`Unknown ios-build subcommand: ${subcommand ?? ""}`);
  }

  if (command === "bootstrap") {
    await runBootstrap();
    return 0;
  }

  if (command === "device-ai") {
    const subcommand = rest[0];
    if (subcommand === "download-model") {
      await downloadPinnedDeviceAiModel();
      return 0;
    }
    if (subcommand === "run-protocol") {
      await runDeviceAiProtocol();
      return 0;
    }
    throw new Error(`Unknown device-ai subcommand: ${subcommand ?? ""}`);
  }

  if (command === "verify") {
    const target = rest[0];
    if (target === "all") {
      await runVerificationAll();
      return 0;
    }
    if (target === "smoke-control-plane") {
      await runControlPlaneSmokeTest();
      return 0;
    }
    throw new Error(`Unknown verify target: ${target ?? ""}`);
  }

  if (command === "validate-device-ai-profile") {
    const profilePath = rest[0];
    if (!profilePath) {
      throw new Error("Missing profile path for validate-device-ai-profile command");
    }
    validateDeviceAiProfileFile(profilePath);
    return 0;
  }

  if (command === "validate-device-ai-report") {
    const reportPath = rest[0];
    if (!reportPath) {
      throw new Error("Missing report path for validate-device-ai-report command");
    }
    validateDeviceAiReportFile(reportPath);
    return 0;
  }

  if (command === "doctor") {
    await doctor();
    return 0;
  }

  if (command === "audit") {
    const subcommand = rest[0];
    if (!subcommand || subcommand === "--help" || subcommand === "-h") {
      process.stdout.write(
        [
          "Usage:",
          "  vertu-flow audit code-practices",
          "  vertu-flow audit capability-gaps",
          "  vertu-flow audit provider-credentials",
          "  vertu-flow audit device-readiness",
          "  vertu-flow audit version-freshness [--online]",
        ].join("\n") + "\n",
      );
      return 0;
    }

    if (subcommand === "code-practices") {
      await auditCodePractices();
      return 0;
    }

    if (subcommand === "capability-gaps") {
      auditCapabilityGaps();
      return 0;
    }

    if (subcommand === "provider-credentials") {
      auditProviderCredentials();
      return 0;
    }

    if (subcommand === "version-freshness") {
      const online = rest.includes("--online");
      auditVersionFreshness({ online });
      return 0;
    }

    if (subcommand === "device-readiness") {
      auditDeviceReadiness();
      return 0;
    }

    throw new Error(`Unknown audit subcommand: ${subcommand}`);
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseIosBuildPreflightOptions(args: readonly string[]): {
  readonly buildType: IosBuildType;
  readonly projectKind: IosBuildProjectKind;
  readonly projectPath: string;
  readonly scheme: string;
  readonly developerDir?: string;
  readonly xcodebuildBin?: string;
} {
  let buildType: IosBuildType | null = null;
  let projectKind: IosBuildProjectKind | null = null;
  let projectPath: string | null = null;
  let scheme: string | null = null;
  let developerDir: string | undefined;
  let xcodebuildBin: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--build-type=")) {
      const value = arg.slice("--build-type=".length);
      if (value === "debug" || value === "release") {
        buildType = value;
        continue;
      }
      throw new Error(`Unsupported iOS build type: ${value}`);
    }
    if (arg.startsWith("--project-kind=")) {
      const value = arg.slice("--project-kind=".length);
      if (value === "-workspace" || value === "-project") {
        projectKind = value;
        continue;
      }
      throw new Error(`Unsupported iOS project kind: ${value}`);
    }
    if (arg.startsWith("--project-path=")) {
      projectPath = arg.slice("--project-path=".length);
      continue;
    }
    if (arg.startsWith("--scheme=")) {
      scheme = arg.slice("--scheme=".length);
      continue;
    }
    if (arg.startsWith("--developer-dir=")) {
      developerDir = arg.slice("--developer-dir=".length);
      continue;
    }
    if (arg.startsWith("--xcodebuild-bin=")) {
      xcodebuildBin = arg.slice("--xcodebuild-bin=".length);
      continue;
    }
    throw new Error(`Unknown ios-build preflight argument: ${arg}`);
  }

  if (!buildType) {
    throw new Error("Missing --build-type for ios-build preflight");
  }
  if (!projectKind) {
    throw new Error("Missing --project-kind for ios-build preflight");
  }
  if (!projectPath) {
    throw new Error("Missing --project-path for ios-build preflight");
  }
  if (!scheme) {
    throw new Error("Missing --scheme for ios-build preflight");
  }

  return {
    buildType,
    projectKind,
    projectPath,
    scheme,
    ...(developerDir ? { developerDir } : {}),
    ...(xcodebuildBin ? { xcodebuildBin } : {}),
  };
}

function parseBuildCommandOptions(args: readonly string[]): {
  readonly buildType: "debug" | "release";
  readonly variant?: string;
  readonly skipTests: boolean;
  readonly clean: boolean;
  readonly outputDir?: string;
} {
  let buildType: "debug" | "release" = "debug";
  let variant: string | undefined;
  let skipTests = false;
  let clean = false;
  let outputDir: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--build-type=")) {
      const value = arg.slice("--build-type=".length);
      if (value !== "debug" && value !== "release") {
        throw new Error(`Unsupported build type: ${value}`);
      }
      buildType = value;
      continue;
    }
    if (arg.startsWith("--variant=")) {
      variant = arg.slice("--variant=".length).trim() || undefined;
      continue;
    }
    if (arg === "--skip-tests") {
      skipTests = true;
      continue;
    }
    if (arg === "--clean") {
      clean = true;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length).trim() || undefined;
      continue;
    }
    if (arg.startsWith("--platform=")) {
      continue;
    }
    throw new Error(`Unknown build argument: ${arg}`);
  }

  return {
    buildType,
    ...(variant ? { variant } : {}),
    skipTests,
    clean,
    ...(outputDir ? { outputDir } : {}),
  };
}

Promise.resolve()
  .then(() => main(process.argv.slice(2)))
  .then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (failure) => {
      const message = failure instanceof Error ? failure.message : String(failure);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    },
  );
