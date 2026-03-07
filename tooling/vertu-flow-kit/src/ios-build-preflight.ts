import type { Result } from "../../../shared/failure";
import type { AppBuildFailureCode } from "../../../contracts/flow-contracts";
import { runCommand, type CommandResult } from "./subprocess";

/** Supported iOS build kinds for the canonical Xcode app-build path. */
export type IosBuildType = "debug" | "release";

/** Xcode project container flags accepted by the canonical iOS build script. */
export type IosBuildProjectKind = "-workspace" | "-project";

/** Stable destination families used for iOS preflight enforcement. */
export type IosBuildDestinationKind = "simulator" | "device";

/** Stable failure codes for iOS preflight enforcement. */
export type IosBuildPreflightFailureCode = AppBuildFailureCode;

/** Inputs required to probe Xcode destinations before running the iOS build. */
export interface IosBuildPreflightOptions {
  /** Requested build type, which determines simulator vs device destination requirements. */
  readonly buildType: IosBuildType;
  /** Xcode container flag (`-workspace` or `-project`). */
  readonly projectKind: IosBuildProjectKind;
  /** Absolute workspace/project path passed to xcodebuild. */
  readonly projectPath: string;
  /** Shared Xcode scheme resolved by the build script. */
  readonly scheme: string;
  /** Optional developer directory override for the selected Xcode toolchain. */
  readonly developerDir?: string;
  /** Optional xcodebuild executable path when the shell resolved a specific Xcode install. */
  readonly xcodebuildBin?: string;
}

/** Successful preflight outcome for an iOS app build. */
export interface IosBuildPreflightSuccess {
  /** Destination kind that was validated successfully. */
  readonly destinationKind: IosBuildDestinationKind;
  /** Human-readable destination label for logs. */
  readonly destinationLabel: string;
  /** Captured xcodebuild `-showdestinations` result. */
  readonly commandResult: CommandResult;
}

/** Failed preflight outcome for an iOS app build. */
export interface IosBuildPreflightFailure {
  /** Stable failure code used by audits and CLI messaging. */
  readonly code: IosBuildPreflightFailureCode;
  /** Human-readable failure message. */
  readonly message: string;
  /** Destination kind that was required for the requested build. */
  readonly destinationKind: IosBuildDestinationKind;
  /** Human-readable destination label for the requested build. */
  readonly destinationLabel: string;
  /** Captured xcodebuild `-showdestinations` result. */
  readonly commandResult: CommandResult;
}

interface IosBuildDestinationRequirement {
  readonly kind: IosBuildDestinationKind;
  readonly label: string;
  readonly platformMarker: string;
  readonly errorMarker: string;
}

interface DestinationInspection {
  readonly hasAvailableDestination: boolean;
  readonly missingPlatformSupport: boolean;
}

function resolveDestinationRequirement(buildType: IosBuildType): IosBuildDestinationRequirement {
  if (buildType === "release") {
    return {
      kind: "device",
      label: "iOS device",
      platformMarker: "platform:iOS",
      errorMarker: "error:iOS",
    };
  }
  return {
    kind: "simulator",
    label: "iOS simulator",
    platformMarker: "platform:iOS Simulator",
    errorMarker: "error:iOS Simulator",
  };
}

function inspectShowDestinationsOutput(
  output: string,
  requirement: IosBuildDestinationRequirement,
): DestinationInspection {
  let hasAvailableDestination = false;
  let missingPlatformSupport = false;

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.includes(requirement.platformMarker)) {
      continue;
    }
    if (line.includes(requirement.errorMarker)) {
      if (
        line.includes("is not installed")
        || line.includes("download and install the platform")
      ) {
        missingPlatformSupport = true;
      }
      continue;
    }
    hasAvailableDestination = true;
  }

  return {
    hasAvailableDestination,
    missingPlatformSupport,
  };
}

function buildShowDestinationsCommand(options: IosBuildPreflightOptions): readonly string[] {
  return [
    options.xcodebuildBin?.trim() || "xcodebuild",
    options.projectKind,
    options.projectPath,
    "-scheme",
    options.scheme,
    "-showdestinations",
  ];
}

function buildPreflightFailure(
  code: IosBuildPreflightFailureCode,
  message: string,
  requirement: IosBuildDestinationRequirement,
  commandResult: CommandResult,
): IosBuildPreflightFailure {
  return {
    code,
    message,
    destinationKind: requirement.kind,
    destinationLabel: requirement.label,
    commandResult,
  };
}

/** Evaluate a captured `xcodebuild -showdestinations` result for the required build destination. */
export function evaluateIosBuildPreflightResult(
  options: IosBuildPreflightOptions,
  commandResult: CommandResult,
): Result<IosBuildPreflightSuccess, IosBuildPreflightFailure> {
  const requirement = resolveDestinationRequirement(options.buildType);
  const combinedOutput = [commandResult.stdout, commandResult.stderr]
    .filter((value) => value.trim().length > 0)
    .join("\n");
  const inspection = inspectShowDestinationsOutput(combinedOutput, requirement);

  if (inspection.hasAvailableDestination && commandResult.success) {
    return {
      ok: true,
      data: {
        destinationKind: requirement.kind,
        destinationLabel: requirement.label,
        commandResult,
      },
    };
  }

  if (inspection.missingPlatformSupport) {
    return {
      ok: false,
      error: buildPreflightFailure(
        "ios_platform_support_missing",
        [
          `Missing ${requirement.label} platform support for scheme ${options.scheme}.`,
          "Provision the required Xcode platform/simulator assets before running the iOS build.",
        ].join(" "),
        requirement,
        commandResult,
      ),
    };
  }

  if (!commandResult.success) {
    return {
      ok: false,
      error: buildPreflightFailure(
        "ios_showdestinations_failed",
        `xcodebuild -showdestinations failed while probing ${requirement.label} availability for scheme ${options.scheme}.`,
        requirement,
        commandResult,
      ),
    };
  }

  return {
    ok: false,
    error: buildPreflightFailure(
      "ios_required_destination_missing",
      `No eligible ${requirement.label} destination is available for scheme ${options.scheme}.`,
      requirement,
      commandResult,
    ),
  };
}

/** Run the canonical typed iOS build preflight before invoking the Xcode app build. */
export async function runIosBuildPreflight(
  options: IosBuildPreflightOptions,
): Promise<Result<IosBuildPreflightSuccess, IosBuildPreflightFailure>> {
  const command = buildShowDestinationsCommand(options);
  const commandResult = await runCommand(command, {
    ...(options.developerDir?.trim()
      ? {
        env: {
          DEVELOPER_DIR: options.developerDir.trim(),
        },
      }
      : {}),
  });
  return evaluateIosBuildPreflightResult(options, commandResult);
}
