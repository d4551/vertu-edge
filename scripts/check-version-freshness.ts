import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const QUERY_CWD = resolve(ROOT, "control-plane");
const CONTROL_PLANE_PACKAGE = resolve(ROOT, "control-plane", "package.json");
const TOOLING_PACKAGE = resolve(ROOT, "tooling", "vertu-flow-kit", "package.json");
const LAYOUT_FILE = resolve(ROOT, "control-plane", "src", "layout.ts");
const WORKFLOW_FILE = resolve(ROOT, ".github", "workflows", "vertu-ci.yaml");
const VERSION_FRESHNESS_MODE_OFFLINE = "offline";
const VERSION_FRESHNESS_MODE_ONLINE = "online";
const NPM_VERSION_LOOKUP_MAX_ATTEMPTS = 3;

const ONLINE_MODE = (process.env.VERSION_FRESHNESS_MODE ?? VERSION_FRESHNESS_MODE_OFFLINE).toLowerCase() === VERSION_FRESHNESS_MODE_ONLINE;
const npmVersionCache = new Map<string, string | null>();

type DepGroups = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

interface PinnedDependency {
  readonly packageName: string;
  readonly versionRange: string;
  readonly sourceFile: string;
}

interface CdnPin {
  readonly packageName: "daisyui" | "@tailwindcss/browser" | "htmx.org";
  readonly version: string;
  readonly sourceFile: string;
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function parsePackageManifest(filePath: string): PackageManifest {
  const source = readText(filePath);
  return JSON.parse(source) as PackageManifest;
}

function collectDependencies(filePath: string): PinnedDependency[] {
  const manifest = parsePackageManifest(filePath);
  const groups: readonly DepGroups[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const entries: PinnedDependency[] = [];

  for (const group of groups) {
    const deps = manifest[group];
    if (!deps) {
      continue;
    }
    for (const [packageName, versionRange] of Object.entries(deps)) {
      entries.push({
        packageName,
        versionRange,
        sourceFile: filePath,
      });
    }
  }

  return entries;
}

function parseCdnPins(filePath: string): CdnPin[] {
  const source = readText(filePath);
  const pins: CdnPin[] = [];

  const daisyui = /daisyui@([0-9]+\.[0-9]+\.[0-9]+)/.exec(source)?.[1];
  const tailwind = /@tailwindcss\/browser@([0-9]+\.[0-9]+\.[0-9]+)/.exec(source)?.[1];
  const htmx = /htmx\.org@([0-9]+\.[0-9]+\.[0-9]+)/.exec(source)?.[1];

  if (daisyui) {
    pins.push({ packageName: "daisyui", version: daisyui, sourceFile: filePath });
  }
  if (tailwind) {
    pins.push({ packageName: "@tailwindcss/browser", version: tailwind, sourceFile: filePath });
  }
  if (htmx) {
    pins.push({ packageName: "htmx.org", version: htmx, sourceFile: filePath });
  }

  return pins;
}

function parseWorkflowBunVersions(filePath: string): string[] {
  const source = readText(filePath);
  return [...source.matchAll(/bun-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/g)].map((match) => match[1]);
}

function stripRangePrefix(versionRange: string): string | null {
  const trimmed = versionRange.trim();
  const match = /^(?:\^|~)?([0-9]+\.[0-9]+\.[0-9]+)$/.exec(trimmed);
  return match?.[1] ?? null;
}

function parseRangeMajor(versionRange: string): number | null {
  const trimmed = versionRange.trim();
  const majorText = /^(?:\^|~)?([0-9]+)(?:\.[0-9]+){0,2}$/.exec(trimmed)?.[1];
  if (!majorText) {
    return null;
  }
  return Number.parseInt(majorText, 10);
}

function parseMajor(version: string): number | null {
  const major = /^([0-9]+)\./.exec(version)?.[1];
  if (!major) {
    return null;
  }
  return Number.parseInt(major, 10);
}

function queryLatestNpmVersion(packageName: string): string | null {
  const cached = npmVersionCache.get(packageName);
  if (cached !== undefined) {
    return cached;
  }

  for (let attempt = 1; attempt <= NPM_VERSION_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
    const proc = Bun.spawnSync(["bun", "pm", "view", packageName, "version"], {
      cwd: QUERY_CWD,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (proc.exitCode !== 0) {
      continue;
    }

    const version = proc.stdout.toString().trim();
    if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
      npmVersionCache.set(packageName, version);
      return version;
    }
  }

  npmVersionCache.set(packageName, null);
  return null;
}

function readLocalBunVersion(): string | null {
  const proc = Bun.spawnSync(["bun", "--version"], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    return null;
  }
  const version = proc.stdout.toString().trim();
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) ? version : null;
}

function validateOfflinePins(errors: string[]): void {
  const deps = [...collectDependencies(CONTROL_PLANE_PACKAGE), ...collectDependencies(TOOLING_PACKAGE)];
  for (const dep of deps) {
    const lower = dep.versionRange.trim().toLowerCase();
    if (lower === "latest" || lower === "*") {
      errors.push(`${dep.sourceFile} uses non-deterministic version '${dep.versionRange}' for ${dep.packageName}`);
    }

    if (parseRangeMajor(dep.versionRange) === null) {
      errors.push(`${dep.sourceFile} uses unsupported version range '${dep.versionRange}' for ${dep.packageName}`);
    }
  }

  const cdnPins = parseCdnPins(LAYOUT_FILE);
  if (cdnPins.length !== 3) {
    errors.push(`${LAYOUT_FILE} must pin daisyui, @tailwindcss/browser, and htmx.org with exact semver versions`);
  }

  const bunVersions = parseWorkflowBunVersions(WORKFLOW_FILE);
  if (bunVersions.length === 0) {
    errors.push(`${WORKFLOW_FILE} must pin bun-version entries explicitly`);
  }
}

function validateOnlineFreshness(errors: string[]): void {
  const deps = [...collectDependencies(CONTROL_PLANE_PACKAGE), ...collectDependencies(TOOLING_PACKAGE)];
  for (const dep of deps) {
    const pinnedMajor = parseRangeMajor(dep.versionRange);
    if (pinnedMajor === null) {
      continue;
    }
    const pinnedVersion = stripRangePrefix(dep.versionRange);

    const latest = queryLatestNpmVersion(dep.packageName);
    if (!latest) {
      errors.push(`Unable to resolve latest npm version for ${dep.packageName}`);
      continue;
    }

    const latestMajor = parseMajor(latest);
    if (pinnedMajor !== null && latestMajor !== null && pinnedMajor !== latestMajor) {
      errors.push(`${dep.packageName} major drift detected (${dep.versionRange} vs latest ${latest}) in ${dep.sourceFile}`);
      continue;
    }

    if (pinnedVersion && pinnedVersion !== latest) {
      errors.push(`${dep.packageName} is outdated in ${dep.sourceFile}: pinned ${pinnedVersion}, latest ${latest}`);
    }
  }

  const cdnPins = parseCdnPins(LAYOUT_FILE);
  for (const pin of cdnPins) {
    const latest = queryLatestNpmVersion(pin.packageName);
    if (!latest) {
      errors.push(`Unable to resolve latest npm version for CDN pin ${pin.packageName}`);
      continue;
    }
    if (pin.version !== latest) {
      errors.push(`${pin.packageName} CDN pin is outdated in ${pin.sourceFile}: pinned ${pin.version}, latest ${latest}`);
    }
  }

  const localBunVersion = readLocalBunVersion();
  const workflowPins = parseWorkflowBunVersions(WORKFLOW_FILE);
  if (!localBunVersion) {
    errors.push("Unable to resolve local Bun version with 'bun --version'");
    return;
  }

  for (const pin of workflowPins) {
    if (pin !== localBunVersion) {
      errors.push(`${WORKFLOW_FILE} pins bun-version ${pin}, but local Bun is ${localBunVersion}`);
    }
  }
}

function fail(errors: string[]): never {
  throw new Error(`Version freshness checks failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

function main(): void {
  const errors: string[] = [];
  validateOfflinePins(errors);

  if (ONLINE_MODE) {
    validateOnlineFreshness(errors);
  }

  if (errors.length > 0) {
    fail(errors);
  }

  process.stdout.write(`Version freshness checks passed (mode=${ONLINE_MODE ? "online" : "offline"}).\n`);
}

main();
