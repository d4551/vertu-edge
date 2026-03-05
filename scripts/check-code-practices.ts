import { extname, relative, resolve } from "bun:path";

const ROOT = resolve(import.meta.dir, "..");

const SOURCE_ROOTS = [
  resolve(ROOT, "contracts"),
  resolve(ROOT, "control-plane", "src"),
  resolve(ROOT, "control-plane", "test"),
  resolve(ROOT, "tooling", "vertu-flow-kit", "src"),
  resolve(ROOT, "tooling", "vertu-flow-kit", "test"),
  resolve(ROOT, "scripts"),
];

const PACKAGE_JSON_FILES = [
  resolve(ROOT, "control-plane", "package.json"),
  resolve(ROOT, "tooling", "vertu-flow-kit", "package.json"),
];

const LOCALHOST_SCAN_FILES = [
  resolve(ROOT, "control-plane", "src"),
  resolve(ROOT, "scripts"),
  resolve(ROOT, ".github", "workflows", "vertu-ci.yaml"),
];

const LOCALHOST_ALLOWED_FILES = new Set<string>([
  "control-plane/src/config.ts",
  "scripts/dev_bootstrap.sh",
  ".github/workflows/vertu-ci.yaml",
]);

const RUNTIME_CONSTANTS_FILE = resolve(ROOT, "control-plane", "src", "runtime-constants.ts");
const CONTROL_PLANE_APP_FILE = resolve(ROOT, "control-plane", "src", "app.ts");
const MODEL_MANAGER_FILE = resolve(ROOT, "control-plane", "src", "model-manager.ts");
const APP_BUILDS_FILE = resolve(ROOT, "control-plane", "src", "app-builds.ts");
const MODEL_JOBS_FILE = resolve(ROOT, "control-plane", "src", "model-jobs.ts");

const TRY_CATCH_ALLOWLIST = new Set<string>([
  "control-plane/src/ucp-discovery.ts",
  "control-plane/src/app-builds.ts",
  "control-plane/test/ai-providers-huggingface.test.ts",
  "tooling/vertu-flow-kit/src/commands.ts",
  "scripts/check-code-practices.ts",
]);

const UNKNOWN_TYPE_ALLOWLIST = new Set<string>([
  "control-plane/src/app.ts",
]);

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function toRepoRelative(filePath: string): string {
  return relative(ROOT, filePath).replaceAll("\\", "/");
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

async function walkFiles(path: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*");
  const walker = glob.scan({ cwd: path, onlyFiles: true, absolute: true });
  for await (const entry of walker) {
    files.push(entry);
  }
  return files;
}

async function readTextFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

async function validateNoLatestDependencyTags(errors: string[]): Promise<void> {
  for (const packageJsonPath of PACKAGE_JSON_FILES) {
    const packageJsonSource = await readTextFile(packageJsonPath);
    let packageJson: PackageManifest;
    try {
      packageJson = JSON.parse(packageJsonSource) as PackageManifest;
    } catch {
      errors.push(`${toRepoRelative(packageJsonPath)} contains invalid JSON`);
      continue;
    }

    const groups = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
    for (const group of groups) {
      const deps = packageJson[group];
      if (!deps) {
        continue;
      }
      for (const [name, version] of Object.entries(deps)) {
        if (typeof version === "string" && version.trim().toLowerCase() === "latest") {
          errors.push(`${toRepoRelative(packageJsonPath)} uses non-deterministic "latest" for ${name} in ${group}`);
        }
      }
    }
  }
}

async function validateTryAndUnknownUsage(errors: string[]): Promise<void> {
  const tryPattern = /\btry\s*\{|\bcatch\s*(\(|\{)/g;
  const opaqueTypePattern = /:\s*unknown\b|<\s*unknown\s*>|=\s*unknown\b|\bas\s+unknown\b|\bunknown\[\]/g;
  for (const root of SOURCE_ROOTS) {
    const files = await walkFiles(root);
    for (const file of files) {
      const rel = toRepoRelative(file);
      const source = await readTextFile(file);
      const tryCount = countMatches(source, tryPattern);
      const opaqueTypeCount = countMatches(source, opaqueTypePattern);

      if (tryCount > 0 && !TRY_CATCH_ALLOWLIST.has(rel)) {
        errors.push(`${rel} contains try/catch usage`);
      }
      if (opaqueTypeCount > 0 && !UNKNOWN_TYPE_ALLOWLIST.has(rel)) {
        errors.push(`${rel} contains unknown typing usage`);
      }
    }
  }
}

async function validateNoUnexpectedLocalhostUrls(errors: string[]): Promise<void> {
  for (const item of LOCALHOST_SCAN_FILES) {
    const files = extname(item)
      ? [item]
      : await walkFiles(item);
    for (const file of files) {
      const source = await readTextFile(file);
      const rel = toRepoRelative(file);
      const hasLocalhostUrl = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i.test(source);
      if (hasLocalhostUrl && !LOCALHOST_ALLOWED_FILES.has(rel)) {
        errors.push(`${rel} contains hardcoded localhost URL outside approved config/script files`);
      }
    }
  }
}

async function validateRuntimePolicyConstants(errors: string[]): Promise<void> {
  const modelManager = await readTextFile(MODEL_MANAGER_FILE);
  const appBuilds = await readTextFile(APP_BUILDS_FILE);
  const modelJobs = await readTextFile(MODEL_JOBS_FILE);

  if (!modelManager.includes("DEFAULT_JOB_TIMEOUT_MS")) {
    errors.push(`${toRepoRelative(MODEL_MANAGER_FILE)} must source default timeout from DEFAULT_JOB_TIMEOUT_MS`);
  }
  if (!appBuilds.includes("DEFAULT_JOB_TIMEOUT_MS")) {
    errors.push(`${toRepoRelative(APP_BUILDS_FILE)} must source default timeout from DEFAULT_JOB_TIMEOUT_MS`);
  }
  if (!modelJobs.includes("MAX_JOB_LOG_CHARS")) {
    errors.push(`${toRepoRelative(MODEL_JOBS_FILE)} must source log truncation from MAX_JOB_LOG_CHARS`);
  }

  const timeoutLiteralPattern = /timeout:\s*[0-9_]+/;
  if (timeoutLiteralPattern.test(modelManager)) {
    errors.push(`${toRepoRelative(MODEL_MANAGER_FILE)} contains hardcoded timeout literal`);
  }
  if (timeoutLiteralPattern.test(appBuilds)) {
    errors.push(`${toRepoRelative(APP_BUILDS_FILE)} contains hardcoded timeout literal`);
  }
}

async function validateRouteAndScriptConstantSourcing(errors: string[]): Promise<void> {
  const runtimeConstants = await readTextFile(RUNTIME_CONSTANTS_FILE);
  const hasRequiredConstants = runtimeConstants.includes("MODEL_PULL_ROUTE")
    && runtimeConstants.includes("APP_BUILD_ROUTE")
    && runtimeConstants.includes("RUN_ANDROID_BUILD_SCRIPT")
    && runtimeConstants.includes("RUN_IOS_BUILD_SCRIPT");

  if (!hasRequiredConstants) {
    errors.push(`${toRepoRelative(RUNTIME_CONSTANTS_FILE)} is missing required runtime constants`);
  }

  const files = [CONTROL_PLANE_APP_FILE, MODEL_MANAGER_FILE, APP_BUILDS_FILE, MODEL_JOBS_FILE];
  for (const file of files) {
    const source = await readTextFile(file);
    if (!source.includes("runtime-constants")) {
      errors.push(`${toRepoRelative(file)} must import route/script constants from runtime-constants.ts`);
    }
    const forbiddenRouteLiteral = /["'`](\/api\/models\/pull|\/api\/apps\/build)["'`]/;
    const forbiddenScriptLiteral = /["'`](run_android_build\.sh|run_ios_build\.sh)["'`]/;
    if (forbiddenRouteLiteral.test(source)) {
      errors.push(`${toRepoRelative(file)} contains hardcoded capability route literals`);
    }
    if (forbiddenScriptLiteral.test(source)) {
      errors.push(`${toRepoRelative(file)} contains hardcoded build script names`);
    }
  }
}

async function validateNoBroadObjectFailureTypes(errors: string[]): Promise<void> {
  const files = [CONTROL_PLANE_APP_FILE, MODEL_MANAGER_FILE, APP_BUILDS_FILE];
  const broadObjectPattern = /\|\s*object\b|:\s*object\b/g;
  for (const file of files) {
    const source = await readTextFile(file);
    if (broadObjectPattern.test(source)) {
      errors.push(`${toRepoRelative(file)} contains broad object typing in failure flows`);
    }
  }
}

function fail(errors: string[]): never {
  throw new Error(`Code practice audit failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

async function main(): Promise<void> {
  const errors: string[] = [];
  await validateNoLatestDependencyTags(errors);
  await validateTryAndUnknownUsage(errors);
  await validateNoUnexpectedLocalhostUrls(errors);
  await validateRuntimePolicyConstants(errors);
  await validateRouteAndScriptConstantSourcing(errors);
  await validateNoBroadObjectFailureTypes(errors);

  if (errors.length > 0) {
    fail(errors);
  }

  process.stdout.write("Code practice audit checks passed.\n");
}

void main();
