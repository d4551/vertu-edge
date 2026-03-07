import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import type { Result } from "./failure";

const JAVA21_BREW_FORMULA = "openjdk@21";
const ANDROID_SDK_DEFAULT_BREW_ROOT = "/opt/homebrew/share/android-commandlinetools";
const ANDROID_SDK_DEFAULT_PLATFORM = "platforms;android-35";
const ANDROID_SDK_DEFAULT_BUILD_TOOLS = "build-tools;35.0.0";
const ANDROID_SDK_LICENSE_ACCEPTANCE_INPUT = `${"y\n".repeat(256)}`;

interface HostCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly success: boolean;
}

/** Minimal environment surface used by host readiness and provisioning helpers. */
export interface HostToolingEnvironment {
  /** Additional environment keys passed through to subprocesses. */
  readonly [key: string]: string | undefined;
  /** Process PATH used for command discovery. */
  readonly PATH?: string;
  /** Windows executable suffix list used for command discovery. */
  readonly PATHEXT?: string;
  /** Current user home directory. */
  readonly HOME?: string;
  /** Active Java home directory. */
  readonly JAVA_HOME?: string;
  /** Preferred Android SDK root. */
  readonly ANDROID_SDK_ROOT?: string;
  /** Legacy Android SDK root alias. */
  readonly ANDROID_HOME?: string;
  /** Optional Xcode developer directory override. */
  readonly DEVELOPER_DIR?: string;
}

/** Provenance of the resolved Java 21 home directory. */
export type Java21HomeSource = "env" | "macos-java-home" | "brew";

/** Successful Java 21 resolution details. */
export interface ResolvedJava21Home {
  /** Absolute Java home path containing a Java 21 runtime. */
  readonly javaHome: string;
  /** Source used to discover the Java 21 runtime. */
  readonly source: Java21HomeSource;
}

/** Provenance of the resolved Android SDK root. */
export type AndroidSdkRootSource = "env" | "home-library" | "home-sdk" | "brew";

/** Successful Android SDK root resolution details. */
export interface ResolvedAndroidSdkRoot {
  /** Absolute Android SDK root directory. */
  readonly sdkRoot: string;
  /** Source used to discover the Android SDK root. */
  readonly source: AndroidSdkRootSource;
}

/** Successful host provisioning outcome. */
export interface HostProvisionSuccess<T> {
  /** Success discriminator. */
  readonly ok: true;
  /** Provisioned value payload. */
  readonly data: T;
}

/** Failed host provisioning outcome. */
export interface HostProvisionFailure {
  /** Failure discriminator. */
  readonly ok: false;
  /** Deterministic failure message surfaced to build and doctor flows. */
  readonly message: string;
  /** Optional subprocess stdout captured during provisioning. */
  readonly stdout: string;
  /** Optional subprocess stderr captured during provisioning. */
  readonly stderr: string;
}

/** Result envelope returned by host provisioning helpers. */
export type HostProvisionResult<T> = HostProvisionSuccess<T> | HostProvisionFailure;

/** Resolved Xcode toolchain metadata for iOS build readiness checks. */
export interface XcodeEnvironment {
  /** Active Xcode developer directory used for subprocess execution. */
  readonly developerDir: string;
  /** Absolute `xcodebuild` binary path for the selected toolchain. */
  readonly xcodebuildBin: string;
}

/** Supported Xcode project container flags. */
export type IosProjectKind = "-workspace" | "-project";

/** Resolved iOS project/workspace container used for scheme listing. */
export interface IosProjectContainer {
  /** Xcode flag matching the resolved container. */
  readonly projectKind: IosProjectKind;
  /** Absolute `.xcworkspace` or `.xcodeproj` path. */
  readonly projectPath: string;
}

/** Stable failure codes for shared iOS scheme discovery. */
export type IosSchemeListingFailureCode =
  | "xcode_environment_missing"
  | "project_container_missing"
  | "scheme_listing_failed"
  | "schemes_missing";

/** Failed iOS scheme discovery outcome. */
export interface IosSchemeListingFailure {
  /** Stable failure code for the discovery failure. */
  readonly code: IosSchemeListingFailureCode;
  /** Human-readable failure message. */
  readonly message: string;
  /** Captured stdout from the scheme listing subprocess. */
  readonly stdout: string;
  /** Captured stderr from the scheme listing subprocess. */
  readonly stderr: string;
}

/** Successful iOS scheme discovery outcome. */
export interface IosSchemeListingSuccess {
  /** Selected Xcode environment. */
  readonly environment: XcodeEnvironment;
  /** Resolved Xcode project/workspace container. */
  readonly project: IosProjectContainer;
  /** Shared schemes discovered in the project container. */
  readonly schemes: readonly string[];
  /** Captured stdout from `xcodebuild -list`. */
  readonly stdout: string;
  /** Captured stderr from `xcodebuild -list`. */
  readonly stderr: string;
}

function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  const stats = statSync(filePath);
  return stats.isFile() && (stats.mode & 0o111) !== 0;
}

function appendPathEntry(existingPath: string | undefined, entry: string): string {
  const segments = (existingPath ?? "")
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (!segments.includes(entry)) {
    segments.unshift(entry);
  }
  return segments.join(delimiter);
}

function buildProcessEnv(env: HostToolingEnvironment): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  return merged;
}

async function runHostCommand(
  command: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: HostToolingEnvironment;
    readonly stdin?: Response;
    readonly timeout?: number;
  } = {},
): Promise<HostCommandResult> {
  const proc = Bun.spawn(Array.from(command), {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: buildProcessEnv(options.env) } : {}),
    ...(options.stdin ? { stdin: options.stdin } : {}),
    stdout: "pipe",
    stderr: "pipe",
    ...(typeof options.timeout === "number" ? { timeout: options.timeout } : {}),
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    stdout,
    stderr,
    exitCode,
    success: exitCode === 0,
  };
}

function resolveCommandPath(command: string, env: HostToolingEnvironment = process.env): string | null {
  if (env.PATH === undefined || env.PATH === process.env.PATH) {
    return Bun.which(command) ?? null;
  }
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
      .split(";")
      .map((extension) => extension.trim())
      .filter((extension) => extension.length > 0)
    : [""];
  const segments = env.PATH
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  for (const segment of segments) {
    for (const extension of extensions) {
      const candidate = join(segment, process.platform === "win32" ? `${command}${extension}` : command);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function readJavaVersionMajor(versionOutput: string): number | null {
  const match = /version "([^"]+)"/u.exec(versionOutput);
  const version = match?.[1]?.trim();
  if (!version) {
    return null;
  }
  const majorToken = version.split(".")[0]?.trim();
  if (!majorToken) {
    return null;
  }
  const parsed = Number.parseInt(majorToken, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

async function resolveJavaMajorFromHome(javaHome: string): Promise<number | null> {
  const javaBinary = join(javaHome, "bin", "java");
  if (!isExecutableFile(javaBinary)) {
    return null;
  }
  const result = await runHostCommand([javaBinary, "-version"]);
  return readJavaVersionMajor(`${result.stdout}\n${result.stderr}`.trim());
}

function buildSdkEnv(env: HostToolingEnvironment, sdkRoot: string): HostToolingEnvironment {
  return {
    ...env,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_HOME: sdkRoot,
    PATH: appendPathEntry(env.PATH, join(sdkRoot, "platform-tools")),
  };
}

function findFirstDirectoryWithSuffix(rootPath: string, suffix: string, remainingDepth: number): string | null {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const candidatePath = join(rootPath, entry.name);
    if (entry.name.endsWith(suffix)) {
      return candidatePath;
    }
    if (
      entry.isDirectory()
      && remainingDepth > 0
      && !entry.name.endsWith(".app")
      && !entry.name.endsWith(".xcodeproj")
      && !entry.name.endsWith(".xcworkspace")
    ) {
      const nestedMatch = findFirstDirectoryWithSuffix(candidatePath, suffix, remainingDepth - 1);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }
  return null;
}

/** Check whether a command is available on PATH. */
export function commandExists(command: string, env: HostToolingEnvironment = process.env): boolean {
  return resolveCommandPath(command, env) !== null;
}

/** Resolve Java 21 from the active environment, macOS `java_home`, or Homebrew. */
export async function resolveJava21Home(
  env: HostToolingEnvironment = process.env,
): Promise<ResolvedJava21Home | null> {
  const configuredJavaHome = env.JAVA_HOME?.trim() ?? "";
  if (configuredJavaHome.length > 0) {
    const major = await resolveJavaMajorFromHome(configuredJavaHome);
    if (major === 21) {
      return {
        javaHome: configuredJavaHome,
        source: "env",
      };
    }
  }

  if (process.platform === "darwin" && isExecutableFile("/usr/libexec/java_home")) {
    const systemResult = await runHostCommand(["/usr/libexec/java_home", "-v", "21"]);
    const systemHome = systemResult.stdout.trim();
    if (systemResult.success && systemHome.length > 0 && isExecutableFile(join(systemHome, "bin", "java"))) {
      return {
        javaHome: systemHome,
        source: "macos-java-home",
      };
    }
  }

  if (resolveCommandPath("brew", env)) {
    const brewResult = await runHostCommand(["brew", "--prefix", JAVA21_BREW_FORMULA], {
      ...(env.PATH ? { env: { PATH: env.PATH } } : {}),
    });
    const brewPrefix = brewResult.stdout.trim();
    if (brewResult.success && brewPrefix.length > 0) {
      if (isExecutableFile(join(brewPrefix, "bin", "java"))) {
        return {
          javaHome: brewPrefix,
          source: "brew",
        };
      }
      const macBundleHome = join(brewPrefix, "libexec", "openjdk.jdk", "Contents", "Home");
      if (isExecutableFile(join(macBundleHome, "bin", "java"))) {
        return {
          javaHome: macBundleHome,
          source: "brew",
        };
      }
    }
  }

  return null;
}

/** Build an environment with Java 21 activated on `JAVA_HOME` and `PATH`. */
export function createJava21Environment(
  env: HostToolingEnvironment,
  javaHome: string,
): HostToolingEnvironment {
  return {
    ...env,
    JAVA_HOME: javaHome,
    PATH: appendPathEntry(env.PATH, join(javaHome, "bin")),
  };
}

/** Resolve the Android SDK root from environment overrides or standard host locations. */
export function resolveAndroidSdkRoot(
  env: HostToolingEnvironment = process.env,
): ResolvedAndroidSdkRoot | null {
  const configuredSdkRoot = env.ANDROID_SDK_ROOT?.trim() ?? "";
  if (configuredSdkRoot.length > 0 && existsSync(configuredSdkRoot)) {
    return {
      sdkRoot: configuredSdkRoot,
      source: "env",
    };
  }

  const configuredAndroidHome = env.ANDROID_HOME?.trim() ?? "";
  if (configuredAndroidHome.length > 0 && existsSync(configuredAndroidHome)) {
    return {
      sdkRoot: configuredAndroidHome,
      source: "env",
    };
  }

  const homeDirectory = env.HOME?.trim() ?? "";
  const homeLibrarySdk = homeDirectory ? join(homeDirectory, "Library", "Android", "sdk") : "";
  if (homeLibrarySdk.length > 0 && existsSync(homeLibrarySdk)) {
    return {
      sdkRoot: homeLibrarySdk,
      source: "home-library",
    };
  }

  const homeSdk = homeDirectory ? join(homeDirectory, "Android", "Sdk") : "";
  if (homeSdk.length > 0 && existsSync(homeSdk)) {
    return {
      sdkRoot: homeSdk,
      source: "home-sdk",
    };
  }

  if (existsSync(ANDROID_SDK_DEFAULT_BREW_ROOT)) {
    return {
      sdkRoot: ANDROID_SDK_DEFAULT_BREW_ROOT,
      source: "brew",
    };
  }

  return null;
}

/** Resolve the active `sdkmanager` binary from a discovered Android SDK root or PATH. */
export function resolveSdkManagerPath(
  env: HostToolingEnvironment,
  sdkRoot: string,
): string | null {
  const candidates = [
    join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager"),
    join(sdkRoot, "tools", "bin", "sdkmanager"),
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return resolveCommandPath("sdkmanager", env);
}

/** Check whether the required Android SDK packages are already installed. */
export function androidSdkPackagesInstalled(sdkRoot: string): boolean {
  return existsSync(join(sdkRoot, "platform-tools"))
    && existsSync(join(sdkRoot, "platforms", "android-35"))
    && existsSync(join(sdkRoot, "build-tools", "35.0.0"));
}

/** Build an environment with Android SDK variables and platform-tools on PATH. */
export function createAndroidSdkEnvironment(
  env: HostToolingEnvironment,
  sdkRoot: string,
): HostToolingEnvironment {
  return buildSdkEnv(env, sdkRoot);
}

/** Resolve `adb` from PATH or the canonical Android SDK root locations. */
export function resolveAdbExecutablePath(
  env: HostToolingEnvironment = process.env,
): string | null {
  const fromPath = resolveCommandPath("adb", env);
  if (fromPath !== null) {
    return fromPath;
  }
  const resolvedSdkRoot = resolveAndroidSdkRoot(env);
  if (!resolvedSdkRoot) {
    return null;
  }
  const adbCandidate = join(resolvedSdkRoot.sdkRoot, "platform-tools", "adb");
  return isExecutableFile(adbCandidate) ? adbCandidate : null;
}

/** Resolve the active Xcode developer directory used for `xcrun simctl` commands. */
export function resolveDeveloperDirForSimctl(
  env: HostToolingEnvironment = process.env,
): string | null {
  const candidates = [env.DEVELOPER_DIR?.trim() || "", "/Applications/Xcode.app/Contents/Developer"];
  for (const candidate of candidates) {
    if (candidate.length > 0 && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Check whether `xcrun simctl` is executable on the current host environment. */
export function isSimctlAvailable(
  env: HostToolingEnvironment = process.env,
): boolean {
  if (!commandExists("xcrun", env)) {
    return false;
  }
  const developerDir = resolveDeveloperDirForSimctl(env);
  const result = Bun.spawnSync(["xcrun", "simctl", "help"], {
    stdout: "ignore",
    stderr: "ignore",
    env: buildProcessEnv({
      ...env,
      ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}),
    }),
  });
  return result.exitCode === 0;
}

/** Ensure a Java 21 runtime is available, installing the Homebrew formula when necessary. */
export async function ensureJava21Available(
  env: HostToolingEnvironment = process.env,
): Promise<HostProvisionResult<ResolvedJava21Home>> {
  const resolvedHome = await resolveJava21Home(env);
  if (resolvedHome) {
    return {
      ok: true,
      data: resolvedHome,
    };
  }

  if (!resolveCommandPath("brew", env)) {
    return {
      ok: false,
      message: "Java 21 runtime was not found and Homebrew is unavailable for installation.",
      stdout: "",
      stderr: "",
    };
  }

  const installResult = await runHostCommand(["brew", "install", JAVA21_BREW_FORMULA], {
    ...(env.PATH ? { env: { PATH: env.PATH } } : {}),
  });
  const installedHome = await resolveJava21Home(env);
  if (!installResult.success || !installedHome) {
    return {
      ok: false,
      message: "Java 21 runtime could not be provisioned on this host.",
      stdout: installResult.stdout,
      stderr: installResult.stderr,
    };
  }

  return {
    ok: true,
    data: installedHome,
  };
}

/** Ensure the Android SDK root, platform tools, platform package, and build tools are available. */
export async function ensureAndroidSdkAvailable(
  env: HostToolingEnvironment = process.env,
): Promise<HostProvisionResult<ResolvedAndroidSdkRoot>> {
  let resolvedSdkRoot = resolveAndroidSdkRoot(env);
  if (!resolvedSdkRoot) {
    if (!resolveCommandPath("brew", env)) {
      return {
        ok: false,
        message: "Android SDK was not found and Homebrew is unavailable for installation.",
        stdout: "",
        stderr: "",
      };
    }
    const installSdkRootResult = await runHostCommand(["brew", "install", "--cask", "android-commandlinetools"], {
      ...(env.PATH ? { env: { PATH: env.PATH } } : {}),
    });
    resolvedSdkRoot = resolveAndroidSdkRoot(env);
    if (!installSdkRootResult.success || !resolvedSdkRoot) {
      return {
        ok: false,
        message: "Android command line tools could not be provisioned on this host.",
        stdout: installSdkRootResult.stdout,
        stderr: installSdkRootResult.stderr,
      };
    }
  }

  if (androidSdkPackagesInstalled(resolvedSdkRoot.sdkRoot)) {
    return {
      ok: true,
      data: resolvedSdkRoot,
    };
  }

  const sdkEnvironment = buildSdkEnv(env, resolvedSdkRoot.sdkRoot);
  const sdkManagerPath = resolveSdkManagerPath(env, resolvedSdkRoot.sdkRoot);
  if (!sdkManagerPath) {
    return {
      ok: false,
      message: "Android SDK manager was not found for the resolved Android SDK root.",
      stdout: "",
      stderr: "",
    };
  }

  const licenseResult = await runHostCommand(
    [sdkManagerPath, `--sdk_root=${resolvedSdkRoot.sdkRoot}`, "--licenses"],
    {
      env: sdkEnvironment,
      stdin: new Response(ANDROID_SDK_LICENSE_ACCEPTANCE_INPUT),
    },
  );
  if (!licenseResult.success) {
    return {
      ok: false,
      message: "Android SDK licenses could not be accepted on this host.",
      stdout: licenseResult.stdout,
      stderr: licenseResult.stderr,
    };
  }

  const installPackagesResult = await runHostCommand(
    [
      sdkManagerPath,
      `--sdk_root=${resolvedSdkRoot.sdkRoot}`,
      "platform-tools",
      ANDROID_SDK_DEFAULT_PLATFORM,
      ANDROID_SDK_DEFAULT_BUILD_TOOLS,
    ],
    {
      env: sdkEnvironment,
    },
  );
  if (!installPackagesResult.success || !androidSdkPackagesInstalled(resolvedSdkRoot.sdkRoot)) {
    return {
      ok: false,
      message: "Required Android SDK packages could not be provisioned on this host.",
      stdout: installPackagesResult.stdout,
      stderr: installPackagesResult.stderr,
    };
  }

  return {
    ok: true,
    data: resolvedSdkRoot,
  };
}

/** Resolve the active Xcode developer directory used for iOS build tooling. */
export async function resolveXcodeEnvironment(
  env: HostToolingEnvironment = process.env,
): Promise<XcodeEnvironment | null> {
  const candidates: string[] = [];
  const developerDirOverride = env.DEVELOPER_DIR?.trim();
  if (developerDirOverride) {
    candidates.push(developerDirOverride);
  }

  const selectedDeveloperDirectory = await runHostCommand(["xcode-select", "-p"], {
    ...(env.PATH ? { env: { PATH: env.PATH } } : {}),
  });
  if (selectedDeveloperDirectory.success) {
    const selected = selectedDeveloperDirectory.stdout.trim();
    if (selected.length > 0) {
      candidates.push(selected);
    }
  }

  if (existsSync("/Applications")) {
    for (const entry of readdirSync("/Applications", { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("Xcode") || !entry.name.endsWith(".app")) {
        continue;
      }
      candidates.push(join("/Applications", entry.name, "Contents", "Developer"));
    }
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const xcodebuildBin = join(candidate, "usr", "bin", "xcodebuild");
    if (!isExecutableFile(xcodebuildBin)) {
      continue;
    }
    const versionResult = await runHostCommand([xcodebuildBin, "-version"], {
      env: {
        ...env,
        DEVELOPER_DIR: candidate,
      },
    });
    if (versionResult.success) {
      return {
        developerDir: candidate,
        xcodebuildBin,
      };
    }
  }

  return null;
}

/** Resolve the first available iOS Xcode workspace/project container for a repository path. */
export function resolveIosProjectContainer(projectDirectory: string): IosProjectContainer | null {
  const workspacePath = findFirstDirectoryWithSuffix(projectDirectory, ".xcworkspace", 1);
  if (workspacePath) {
    return {
      projectKind: "-workspace",
      projectPath: workspacePath,
    };
  }
  const projectPath = findFirstDirectoryWithSuffix(projectDirectory, ".xcodeproj", 1);
  if (!projectPath) {
    return null;
  }
  return {
    projectKind: "-project",
    projectPath,
  };
}

/** Parse shared Xcode scheme names from `xcodebuild -list` output. */
export function parseXcodeSchemes(output: string): readonly string[] {
  const schemes: string[] = [];
  let insideSchemes = false;
  for (const rawLine of output.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();
    if (!insideSchemes) {
      if (trimmedLine === "Schemes:") {
        insideSchemes = true;
      }
      continue;
    }
    if (trimmedLine.length === 0) {
      continue;
    }
    if (trimmedLine.endsWith(":")) {
      break;
    }
    const normalized = trimmedLine.startsWith("-") ? trimmedLine.slice(1).trim() : trimmedLine;
    if (normalized.length > 0) {
      schemes.push(normalized);
    }
  }
  return schemes;
}

/** List shared iOS schemes using the resolved Xcode environment and project container. */
export async function listIosSchemes(
  projectDirectory: string,
  env: HostToolingEnvironment = process.env,
): Promise<Result<IosSchemeListingSuccess, IosSchemeListingFailure>> {
  const xcodeEnvironment = await resolveXcodeEnvironment(env);
  if (!xcodeEnvironment) {
    return {
      ok: false,
      error: {
        code: "xcode_environment_missing",
        message: "Unable to resolve an active Xcode toolchain for iOS scheme discovery.",
        stdout: "",
        stderr: "",
      },
    };
  }

  const projectContainer = resolveIosProjectContainer(projectDirectory);
  if (!projectContainer) {
    return {
      ok: false,
      error: {
        code: "project_container_missing",
        message: `Unable to locate an .xcworkspace or .xcodeproj under ${projectDirectory}.`,
        stdout: "",
        stderr: "",
      },
    };
  }

  const listingResult = await runHostCommand(
    [xcodeEnvironment.xcodebuildBin, "-list", projectContainer.projectKind, projectContainer.projectPath],
    {
      cwd: projectDirectory,
      env: {
        ...env,
        DEVELOPER_DIR: xcodeEnvironment.developerDir,
      },
    },
  );
  if (!listingResult.success) {
    return {
      ok: false,
      error: {
        code: "scheme_listing_failed",
        message: "xcodebuild -list failed while enumerating iOS app schemes.",
        stdout: listingResult.stdout,
        stderr: listingResult.stderr,
      },
    };
  }

  const schemes = parseXcodeSchemes(`${listingResult.stdout}\n${listingResult.stderr}`);
  if (schemes.length === 0) {
    return {
      ok: false,
      error: {
        code: "schemes_missing",
        message: "No shared iOS app schemes were discovered in the active Xcode project.",
        stdout: listingResult.stdout,
        stderr: listingResult.stderr,
      },
    };
  }

  return {
    ok: true,
    data: {
      environment: xcodeEnvironment,
      project: projectContainer,
      schemes,
      stdout: listingResult.stdout,
      stderr: listingResult.stderr,
    },
  };
}

/** Write `Android/src/local.properties` with the resolved Android SDK root. */
export function ensureAndroidLocalProperties(
  repoRoot: string,
  sdkRoot: string,
): void {
  const localPropertiesPath = resolve(repoRoot, "Android", "src", "local.properties");
  writeFileSync(localPropertiesPath, `sdk.dir=${sdkRoot.replaceAll("/", "\\/")}\n`);
}

/** Format combined stdout/stderr text from a provisioning subprocess. */
export function formatProvisioningDiagnostics(
  stdout: string,
  stderr: string,
): string {
  const segments = [stdout.trim(), stderr.trim()].filter((segment) => segment.length > 0);
  return segments.join("\n");
}

/** Format a stable doctor status line. */
export function formatDoctorStatus(
  name: string,
  status: string,
): string {
  return `${name.padEnd(28, " ")} ${status}`;
}

/** Format a subprocess failure result for doctor/status output. */
export function formatProvisioningStatus(
  result: HostProvisionFailure | { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
): string {
  const diagnostics = formatProvisioningDiagnostics(result.stdout, result.stderr);
  return diagnostics.length > 0 ? diagnostics : ("message" in result ? result.message : `Command failed with exit ${result.exitCode}.`);
}
