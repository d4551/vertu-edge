/**
 * Audit subcommands for the canonical `vertu-flow` CLI.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import type { DeviceAiProtocolRunReport } from "../../../contracts/device-ai-protocol";
import type { DeviceAiJsonValue } from "../../../contracts/device-ai-protocol";
import { auditProviderCredentialIntegrity } from "../../../control-plane/src/provider-credential-integrity";
import { loadSchemaValidators } from "./schema";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, "..", "..", "..");

function toRepoRelative(filePath: string): string {
  return relative(ROOT, filePath).replaceAll("\\", "/");
}

function loadFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
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

function fail(label: string, errors: string[]): never {
  throw new Error(`${label} failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

function formatRepoPath(path: string): string {
  return path.startsWith(ROOT) ? toRepoRelative(path) : path;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type CapabilityStatus = "implemented" | "partial" | "stub" | "unsupported";

interface AuditRow {
  name: string;
  source_of_claim: string;
  status: CapabilityStatus;
  owner: string;
  gap_type: string;
  contract_ref: string;
  test_ref: string;
  runtime_ref: string;
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

type DepGroups = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// ===========================================================================
// 1. Code Practices Audit
// ===========================================================================

const CODE_PRACTICE_SOURCE_ROOTS = [
  resolve(ROOT, "contracts"),
  resolve(ROOT, "control-plane", "src"),
  resolve(ROOT, "control-plane", "test"),
  resolve(ROOT, "tooling", "vertu-flow-kit", "src"),
  resolve(ROOT, "tooling", "vertu-flow-kit", "test"),
  resolve(ROOT, "scripts"),
];

const CODE_PRACTICE_PACKAGE_JSON_FILES = [
  resolve(ROOT, "package.json"),
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
  "contracts/flow-parser.ts",
  "control-plane/src/ucp-discovery.ts",
  "control-plane/src/app-builds.ts",
  "control-plane/test/ai-providers-huggingface.test.ts",
  "control-plane/test/flow-parser.test.ts",
  "tooling/vertu-flow-kit/src/commands.ts",
  "tooling/vertu-flow-kit/test/flow-cli.test.ts",
  "tooling/vertu-flow-kit/src/audit.ts",
]);

const UNKNOWN_TYPE_ALLOWLIST = new Set<string>([
  "control-plane/src/app.ts",
  "control-plane/src/i18n.ts",
  "control-plane/test/flow-parser.test.ts",
]);

async function validateNoLatestDependencyTags(errors: string[]): Promise<void> {
  for (const packageJsonPath of CODE_PRACTICE_PACKAGE_JSON_FILES) {
    const packageJsonSource = loadFile(packageJsonPath);
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
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        if (typeof version === "string" && version.trim().toLowerCase() === "latest") {
          errors.push(`${toRepoRelative(packageJsonPath)} uses non-deterministic "latest" for ${name} in ${group}`);
        }
      }
    }
  }
}

async function validateCanonicalRootBuildScripts(errors: string[]): Promise<void> {
  const rootPackageJsonPath = resolve(ROOT, "package.json");
  const rootPackageJsonSource = loadFile(rootPackageJsonPath);
  let rootPackageJson: PackageManifest;
  try {
    rootPackageJson = JSON.parse(rootPackageJsonSource) as PackageManifest;
  } catch {
    errors.push(`${toRepoRelative(rootPackageJsonPath)} contains invalid JSON`);
    return;
  }

  const expectedScripts: Record<string, string> = {
    "build:android": "bun run --cwd tooling/vertu-flow-kit src/cli.ts build android",
    "build:ios": "bun run --cwd tooling/vertu-flow-kit src/cli.ts build ios",
    "build:desktop": "bun run --cwd tooling/vertu-flow-kit src/cli.ts build desktop",
    "build:matrix": "bun run --cwd tooling/vertu-flow-kit src/cli.ts build matrix",
  };
  for (const [scriptName, expectedCommand] of Object.entries(expectedScripts)) {
    const actualCommand = rootPackageJson.scripts?.[scriptName];
    if (actualCommand !== expectedCommand) {
      errors.push(`${toRepoRelative(rootPackageJsonPath)} must define ${scriptName} as "${expectedCommand}"`);
    }
  }
}

async function validateTryAndUnknownUsage(errors: string[]): Promise<void> {
  const tryPattern = /\btry\s*\{|\bcatch\s*(\(|\{)/g;
  const opaqueTypePattern = /:\s*unknown\b|<\s*unknown\s*>|=\s*unknown\b|\bas\s+unknown\b|\bunknown\[\]/g;
  for (const root of CODE_PRACTICE_SOURCE_ROOTS) {
    const files = await walkFiles(root);
    for (const file of files) {
      const rel = toRepoRelative(file);
      const source = loadFile(file);
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
    const files = extname(item) ? [item] : await walkFiles(item);
    for (const file of files) {
      const source = loadFile(file);
      const rel = toRepoRelative(file);
      const hasLocalhostUrl = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i.test(source);
      if (hasLocalhostUrl && !LOCALHOST_ALLOWED_FILES.has(rel)) {
        errors.push(`${rel} contains hardcoded localhost URL outside approved config/script files`);
      }
    }
  }
}

async function validateRuntimePolicyConstants(errors: string[]): Promise<void> {
  const modelManager = loadFile(MODEL_MANAGER_FILE);
  const appBuilds = loadFile(APP_BUILDS_FILE);
  const modelJobs = loadFile(MODEL_JOBS_FILE);

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
  const runtimeConstants = loadFile(RUNTIME_CONSTANTS_FILE);
  const hasRequiredConstants = runtimeConstants.includes("MODEL_PULL_ROUTE")
    && runtimeConstants.includes("APP_BUILD_ROUTE")
    && runtimeConstants.includes("FLOW_KIT_DIRECTORY_RELATIVE")
    && runtimeConstants.includes("FLOW_KIT_CLI_RELATIVE");

  if (!hasRequiredConstants) {
    errors.push(`${toRepoRelative(RUNTIME_CONSTANTS_FILE)} is missing required runtime constants`);
  }

  const files = [CONTROL_PLANE_APP_FILE, MODEL_MANAGER_FILE, APP_BUILDS_FILE, MODEL_JOBS_FILE];
  for (const file of files) {
    const source = loadFile(file);
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
    const source = loadFile(file);
    if (broadObjectPattern.test(source)) {
      errors.push(`${toRepoRelative(file)} contains broad object typing in failure flows`);
    }
  }
}

/** Run the full code practices audit. Throws on failure. */
export async function auditCodePractices(): Promise<void> {
  const errors: string[] = [];
  await validateNoLatestDependencyTags(errors);
  await validateCanonicalRootBuildScripts(errors);
  await validateTryAndUnknownUsage(errors);
  await validateNoUnexpectedLocalhostUrls(errors);
  await validateRuntimePolicyConstants(errors);
  await validateRouteAndScriptConstantSourcing(errors);
  await validateNoBroadObjectFailureTypes(errors);

  if (errors.length > 0) {
    fail("Code practice audit", errors);
  }

  process.stdout.write("Code practice audit checks passed.\n");
}

// ===========================================================================
// 2. Capability Gaps Audit
// ===========================================================================

const AUDIT_DOC = resolve(ROOT, "docs", "CAPABILITY_AUDIT.md");
const FLOW_REFERENCE_DOC = resolve(ROOT, "docs", "FLOW_REFERENCE.md");
const FLOW_CONTRACTS = resolve(ROOT, "contracts", "flow-contracts.ts");
const CAP_CONTROL_PLANE_CONFIG = resolve(ROOT, "control-plane", "src", "config.ts");

const PORT_REQUIRES_REFERENCE_FILES = [
  resolve(ROOT, "README.md"),
  resolve(ROOT, "DEVELOPMENT.md"),
  resolve(ROOT, "control-plane", "README.md"),
  resolve(ROOT, "control-plane", "src", "layout.ts"),
  resolve(ROOT, ".github", "workflows", "vertu-ci.yaml"),
  resolve(ROOT, "scripts", "run_control_plane.sh"),
  resolve(ROOT, "scripts", "dev_bootstrap.sh"),
  resolve(ROOT, "scripts", "verify_all.sh"),
];

const DAISYUI_CHECK_FILES = [
  resolve(ROOT, "control-plane", "src", "layout.ts"),
  resolve(ROOT, ".github", "workflows", "vertu-ci.yaml"),
  resolve(ROOT, "DEVELOPMENT.md"),
  resolve(ROOT, "README.md"),
  resolve(ROOT, "control-plane", "README.md"),
];

const HTMX_CHECK_FILES = [
  resolve(ROOT, "control-plane", "src", "layout.ts"),
];

const BUN_VERSION_CHECK_FILE = resolve(ROOT, ".github", "workflows", "vertu-ci.yaml");
const EXPECTED_BUN_VERSION = "1.3.10";
const EXPECTED_HTMX_VERSION = "2.0.8";
const EXPECTED_HTMX_SSE_EXTENSION_VERSION = "2.2.4";
const DEVICE_AI_REPORT_DEFAULT_PATH = resolve(ROOT, ".artifacts", "device-ai", "latest.json");
const DEVICE_AI_REPORT_MAX_AGE_MINUTES_DEFAULT = 240;

const REQUIRED_CAPABILITIES = [
  "/api/flows/validate",
  "/api/models/pull",
  "/api/models/pull/:jobId",
  "/api/apps/build",
  "/api/apps/build/:jobId",
  "/api/ai/providers/validate",
  "Ramalama model pull capability",
  "iOS build unsupported on non-mac hosts",
  "Device AI protocol report schema validation",
  "Android device AI protocol pass",
  "iOS device AI protocol pass",
];

function parseControlPlaneDefaultPort(): number {
  const source = loadFile(CAP_CONTROL_PLANE_CONFIG);
  const match = /export const CONTROL_PLANE_DEFAULT_PORT = (\d+);/.exec(source);
  if (!match?.[1]) return 3310;
  return Number.parseInt(match[1], 10);
}

function parseMarkdownTable(filePath: string): AuditRow[] {
  const stripMarkdownCode = (value: string): string => value.replace(/^`+|`+$/g, "").trim();
  const lines = loadFile(filePath).split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|\s*name\s*\|/.test(line));
  if (headerIndex === -1) {
    throw new Error(`Missing capability table in ${filePath}`);
  }

  const rawRows = lines
    .slice(headerIndex + 2)
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\s*\|[\s-]*\|/.test(line));

  return rawRows
    .map((line) => {
      const parts = line.split("|").slice(1, -1).map((value) => value.trim());
      if (parts.length < 8) return null;

      const name = stripMarkdownCode(parts[0] ?? "");
      const source_of_claim = stripMarkdownCode(parts[1] ?? "");
      const status = stripMarkdownCode(parts[2] ?? "");
      const owner = stripMarkdownCode(parts[3] ?? "");
      const gap_type = stripMarkdownCode(parts[4] ?? "");
      const contract_ref = stripMarkdownCode(parts[5] ?? "");
      const test_ref = stripMarkdownCode(parts[6] ?? "");
      const runtime_ref = stripMarkdownCode(parts[7] ?? "");
      if (!name || !source_of_claim || !status || !owner) return null;
      if (!["implemented", "partial", "stub", "unsupported"].includes(status)) {
        throw new Error(`Unknown capability status "${status}" in ${filePath}`);
      }
      return { name, source_of_claim, status: status as CapabilityStatus, owner, gap_type, contract_ref, test_ref, runtime_ref };
    })
    .filter((row): row is AuditRow => row !== null);
}

function parseSupportedCommands(filePath: string): Set<string> {
  const markdown = loadFile(filePath);
  const sectionMatch = /## Supported commands([\s\S]*?)(\n## |\n# |$)/.exec(markdown);
  if (!sectionMatch) throw new Error(`Cannot find Supported commands section in ${filePath}`);
  const section = sectionMatch[1] ?? "";
  const items = [...section.matchAll(/^\s*-\s*`([^`]+)`\s*$/gm)].map((match) => match[1] ?? "").filter(Boolean);
  return new Set(items.map((item) => item.trim()));
}

function parseReferencedRoutes(filePath: string): Set<string> {
  const markdown = loadFile(filePath);
  const sectionMatch = /## API routes([\s\S]*?)(\n## |\n# |$)/.exec(markdown);
  if (!sectionMatch) return new Set();
  const section = sectionMatch[1] ?? "";
  const items = [...section.matchAll(/`(\/api\/[^`]+)`/g)].map((match) => match[1]);
  return new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0));
}

function parseCommandRegistry(filePath: string): Set<string> {
  const source = loadFile(filePath);
  const set = new Set<string>();
  const blockMatch = /export const SUPPORTED_FLOW_COMMANDS[\s\S]*?=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/.exec(source);
  if (!blockMatch) throw new Error(`Cannot find SUPPORTED_FLOW_COMMANDS in ${filePath}`);
  const block = blockMatch[1] ?? "";
  const commandMatch = /\{\s*type:\s*"(.*?)"\s*,[\s\S]*?\}/g;
  for (const item of block.matchAll(commandMatch)) {
    const command = item[1]?.trim();
    if (command) set.add(command);
  }
  return set;
}

function validateCommandParity(errors: string[], docsCommands: Set<string>, registryCommands: Set<string>, rows: readonly AuditRow[]): void {
  for (const command of [...docsCommands].filter((c) => !registryCommands.has(c))) {
    errors.push(`FLOW_REFERENCE.md claims command "${command}" but it is not in SUPPORTED_FLOW_COMMANDS`);
  }
  const documentedCommandRows = new Set(rows.filter((row) => /^[a-zA-Z-]+$/.test(row.name)).map((row) => row.name));
  for (const command of [...registryCommands]) {
    if (!docsCommands.has(command) && !documentedCommandRows.has(command)) {
      errors.push(`Flow command "${command}" is registered but undocumented in FLOW_REFERENCE.md`);
    }
  }
}

function validateAuditRows(errors: string[], rows: readonly AuditRow[]): void {
  for (const row of rows) {
    if (row.status === "stub") {
      if (row.owner.length === 0 || row.owner.toLowerCase() === "none") errors.push(`Stub capability "${row.name}" must include owner`);
      if (row.gap_type.length === 0 || row.gap_type.toLowerCase() === "none") errors.push(`Stub capability "${row.name}" must include gap_type rationale`);
    }
    if ((row.status === "implemented" || row.status === "partial") && !row.test_ref.trim()) errors.push(`Implemented/partial capability "${row.name}" must include test_ref`);
    if ((row.status === "implemented" || row.status === "partial") && !row.contract_ref.trim()) errors.push(`Implemented/partial capability "${row.name}" must include contract_ref`);
    if ((row.status === "implemented" || row.status === "partial") && !row.runtime_ref.trim()) errors.push(`Implemented/partial capability "${row.name}" must include runtime_ref`);
  }
}

function validateRequiredCapabilities(errors: string[], rows: readonly AuditRow[]): void {
  for (const required of REQUIRED_CAPABILITIES) {
    if (!rows.some((row) => row.name === required)) {
      errors.push(`CAPABILITY_AUDIT missing required capability row for "${required}"`);
    }
  }
}

function validateDocsRouteParity(errors: string[], rows: readonly AuditRow[]): void {
  const docRoutes = parseReferencedRoutes(FLOW_REFERENCE_DOC);
  const auditRoutes = new Set(rows.filter((row) => row.name.startsWith("/api/")).map((row) => row.name));
  for (const route of docRoutes) {
    if (route.startsWith("/api/") && !auditRoutes.has(route)) {
      errors.push(`CAPABILITY_AUDIT missing route row for documented route "${route}"`);
    }
  }
}

function validateFileReferences(filePath: string, text: string, expectedPort: number, errors: string[]): void {
  if (!text.includes("3310")) return;
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes(String(expectedPort))) continue;
    const referencesConfig = /CONTROL_PLANE_DEFAULT_PORT|CONTROL_PLANE_PORT|PORT|control-plane\/src\/config/.test(line);
    if (!referencesConfig) errors.push(`${filePath}:${index + 1} hardcodes ${expectedPort} without config reference`);
  }
}

function validateDaisyUiRefs(filePath: string, text: string, errors: string[]): void {
  for (const match of [...text.matchAll(/daisyui@([0-9][0-9.]*)/g)]) {
    const version = match[1] ?? "";
    if (!(version === "5" || version.startsWith("5."))) {
      errors.push(`${filePath} references daisyUI ${version}, expected version 5`);
      break;
    }
  }
}

function validateHtmxRefs(filePath: string, text: string, errors: string[]): void {
  const versions = [...text.matchAll(/htmx\.org@([0-9][0-9.]*)/g)].map((match) => match[1] ?? "").filter(Boolean);
  if (versions.length === 0) { errors.push(`${filePath} is missing an explicit htmx.org version pin`); return; }
  for (const version of versions) {
    if (version !== EXPECTED_HTMX_VERSION) errors.push(`${filePath} references htmx.org@${version}, expected ${EXPECTED_HTMX_VERSION}`);
  }
  const extVersions = [...text.matchAll(/htmx-ext-sse@([0-9][0-9.]*)/g)].map((match) => match[1] ?? "").filter(Boolean);
  if (extVersions.length === 0) { errors.push(`${filePath} is missing an explicit htmx-ext-sse version pin`); return; }
  for (const version of extVersions) {
    if (version !== EXPECTED_HTMX_SSE_EXTENSION_VERSION) errors.push(`${filePath} references htmx-ext-sse@${version}, expected ${EXPECTED_HTMX_SSE_EXTENSION_VERSION}`);
  }
}

function validateBunWorkflowVersion(filePath: string, text: string, errors: string[]): void {
  const versions = [...text.matchAll(/bun-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/g)].map((match) => match[1] ?? "").filter(Boolean);
  if (versions.length === 0) { errors.push(`${filePath} is missing explicit bun-version pins`); return; }
  for (const version of versions) {
    if (version !== EXPECTED_BUN_VERSION) errors.push(`${filePath} references bun-version ${version}, expected ${EXPECTED_BUN_VERSION}`);
  }
}

/** Run the full capability gaps audit. Throws on failure. */
export function auditCapabilityGaps(): void {
  const controlPlanePort = parseControlPlaneDefaultPort();
  const rows = parseMarkdownTable(AUDIT_DOC);
  const docsCommands = parseSupportedCommands(FLOW_REFERENCE_DOC);
  const registryCommands = parseCommandRegistry(FLOW_CONTRACTS);

  const errors: string[] = [];
  validateCommandParity(errors, docsCommands, registryCommands, rows);
  validateAuditRows(errors, rows);
  validateRequiredCapabilities(errors, rows);
  validateDocsRouteParity(errors, rows);

  for (const file of DAISYUI_CHECK_FILES) { validateDaisyUiRefs(file, loadFile(file), errors); }
  for (const file of HTMX_CHECK_FILES) { validateHtmxRefs(file, loadFile(file), errors); }
  validateBunWorkflowVersion(BUN_VERSION_CHECK_FILE, loadFile(BUN_VERSION_CHECK_FILE), errors);
  for (const file of PORT_REQUIRES_REFERENCE_FILES) { validateFileReferences(file, loadFile(file), controlPlanePort, errors); }

  if (errors.length > 0) {
    fail("Capability audit", errors);
  }

  process.stdout.write(
    `CAPABILITY_AUDIT checks passed: ${rows.length} capabilities, ${docsCommands.size} documented commands, ${registryCommands.size} registry commands.\n`,
  );
}

// ===========================================================================
// 3. Device AI Readiness Audit
// ===========================================================================

/** Run device AI readiness audit. Throws on failure. */
export function auditDeviceReadiness(): void {
  const configuredPath = process.env.VERTU_DEVICE_AI_REPORT_PATH?.trim();
  const reportPath = configuredPath ? resolve(ROOT, configuredPath) : DEVICE_AI_REPORT_DEFAULT_PATH;
  const maxAgeMinutes = parsePositiveIntEnv("VERTU_DEVICE_AI_REPORT_MAX_AGE_MINUTES", DEVICE_AI_REPORT_MAX_AGE_MINUTES_DEFAULT);
  const maxAgeMs = maxAgeMinutes * 60_000;

  const errors: string[] = [];
  if (!existsSync(reportPath)) {
    errors.push(`Device AI report file does not exist at ${toRepoRelative(reportPath)}`);
    fail("Device readiness audit", errors);
  }

  const rawReport = loadFile(reportPath);
  let parsedReport: DeviceAiJsonValue | undefined;
  try {
    parsedReport = JSON.parse(rawReport) as DeviceAiJsonValue;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    errors.push(`Device AI report JSON parse failed: ${message}`);
    fail("Device readiness audit", errors);
  }

  const validators = loadSchemaValidators();
  if (!validators.deviceAiReport(parsedReport)) {
    const details = (validators.deviceAiReport.errors ?? [])
      .map((entry) => `${entry.instancePath} ${entry.message}`)
      .join("; ");
    errors.push(`Device AI report schema validation failed: ${details || "unknown error"}`);
    fail("Device readiness audit", errors);
  }

  const report = parsedReport as DeviceAiProtocolRunReport;
  if (report.status !== "pass") {
    errors.push(`Device AI protocol status must be 'pass' but was '${report.status}'`);
  }

  const generatedAtMs = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    errors.push("Device AI report generatedAt is not a valid ISO timestamp.");
  } else {
    const ageMs = Date.now() - generatedAtMs;
    if (ageMs > maxAgeMs) {
      errors.push(`Device AI report is stale (age ${Math.floor(ageMs / 60_000)}m, max ${maxAgeMinutes}m).`);
    }
  }

  const fileAgeMs = Date.now() - statSync(reportPath).mtimeMs;
  if (fileAgeMs > maxAgeMs) {
    errors.push(`Device AI report file mtime is stale (age ${Math.floor(fileAgeMs / 60_000)}m, max ${maxAgeMinutes}m).`);
  }

  if (!report.model.modelRef.trim()) {
    errors.push("Device AI report model evidence is missing modelRef.");
  }
  if (!report.profile.revision.trim()) {
    errors.push("Device AI report profile is missing revision.");
  }
  if (!report.profile.requiredModelFile.trim()) {
    errors.push("Device AI report profile is missing requiredModelFile.");
  }
  if (!/^[a-f0-9]{64}$/i.test(report.profile.requiredModelSha256.trim())) {
    errors.push("Device AI report profile is missing a valid requiredModelSha256.");
  }
  if (!report.model.revision.trim()) {
    errors.push("Device AI report model evidence is missing revision.");
  }
  if (!report.model.fileName.trim()) {
    errors.push("Device AI report model evidence is missing fileName.");
  }
  if (!report.model.downloaded) {
    errors.push("Device AI report requires downloaded=true in model evidence.");
  }
  if (!report.model.verified) {
    errors.push("Device AI report requires verified=true in model evidence.");
  }
  if (!/^[a-f0-9]{64}$/i.test(report.model.sha256.trim())) {
    errors.push("Device AI report model evidence must include a valid sha256.");
  }
  if (!report.model.artifactPath?.trim()) {
    errors.push("Device AI report model evidence must include artifactPath.");
  }
  if (report.model.sha256.trim().toLowerCase() !== report.profile.requiredModelSha256.trim().toLowerCase()) {
    errors.push("Device AI report model sha256 must match profile requiredModelSha256.");
  }
  if (report.model.fileName.trim() !== report.profile.requiredModelFile.trim()) {
    errors.push("Device AI report model fileName must match profile requiredModelFile.");
  }
  if (report.model.revision.trim() !== report.profile.revision.trim()) {
    errors.push("Device AI report model revision must match profile revision.");
  }
  if (report.model.modelRef.trim().toLowerCase() !== report.profile.requiredModelRef.trim().toLowerCase()) {
    errors.push("Device AI report modelRef must match profile requiredModelRef.");
  }

  const requiredCapabilities = report.profile.requiredCapabilities;
  for (const capability of requiredCapabilities) {
    if (!report.model.capabilities.includes(capability)) {
      errors.push(`Device AI report model capabilities missing required flag '${capability}'.`);
    }
  }

  if (report.profile.runtimeRequirements.localOllama && !report.runtime.localOllama.available) {
    errors.push("Device AI report requires localOllama.available=true.");
  }
  if (report.profile.runtimeRequirements.cloudHuggingFace && !report.runtime.cloudHuggingFace.available) {
    errors.push("Device AI report requires cloudHuggingFace.available=true.");
  }

  if (report.profile.platforms.android.required && report.platforms.android.status !== "pass") {
    errors.push("Device AI report requires Android platform status=pass.");
  }
  if (report.profile.platforms.ios.required && report.platforms.ios.status !== "pass") {
    errors.push("Device AI report requires iOS platform status=pass.");
  }

  if (errors.length > 0) {
    fail("Device readiness audit", errors);
  }

  process.stdout.write(`Device readiness checks passed (report=${toRepoRelative(reportPath)}).\n`);
}

// ===========================================================================
// 4. Provider Credential Integrity Audit
// ===========================================================================

/** Run provider credential integrity audit. Throws on failure. */
export function auditProviderCredentials(): void {
  const report = auditProviderCredentialIntegrity();
  if (report.status === "fail") {
    fail("Provider credential integrity audit", report.issues.map((issue) =>
      `${issue.provider} (${issue.code})${issue.updatedAt ? ` [updatedAt=${issue.updatedAt}]` : ""}: ${issue.message}`));
  }

  process.stdout.write(
    `Provider credential integrity checks passed (credentials=${report.credentialCount}, db=${formatRepoPath(report.dbPath)}).\n`,
  );
}

// ===========================================================================
// 5. Version Freshness Audit
// ===========================================================================

const FRESHNESS_CONTROL_PLANE_PACKAGE = resolve(ROOT, "control-plane", "package.json");
const FRESHNESS_TOOLING_PACKAGE = resolve(ROOT, "tooling", "vertu-flow-kit", "package.json");
const FRESHNESS_LAYOUT_FILE = resolve(ROOT, "control-plane", "src", "layout.ts");
const FRESHNESS_WORKFLOW_FILE = resolve(ROOT, ".github", "workflows", "vertu-ci.yaml");
const NPM_VERSION_LOOKUP_MAX_ATTEMPTS = 3;

const npmVersionCache = new Map<string, string | null>();

function parsePackageManifest(filePath: string): PackageManifest {
  return JSON.parse(loadFile(filePath)) as PackageManifest;
}

function collectDependencies(filePath: string): PinnedDependency[] {
  const manifest = parsePackageManifest(filePath);
  const groups: readonly DepGroups[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const entries: PinnedDependency[] = [];
  for (const group of groups) {
    const deps = manifest[group];
    if (!deps) continue;
    for (const [packageName, versionRange] of Object.entries(deps)) {
      entries.push({ packageName, versionRange, sourceFile: filePath });
    }
  }
  return entries;
}

function parseCdnPins(filePath: string): CdnPin[] {
  const source = loadFile(filePath);
  const pins: CdnPin[] = [];
  const daisyui = /daisyui@([0-9]+\.[0-9]+\.[0-9]+)/.exec(source)?.[1];
  const tailwind = /@tailwindcss\/browser@([0-9]+\.[0-9]+\.[0-9]+)/.exec(source)?.[1];
  const htmx = /htmx\.org@([0-9]+\.[0-9]+\.[0-9]+)/.exec(source)?.[1];
  if (daisyui) pins.push({ packageName: "daisyui", version: daisyui, sourceFile: filePath });
  if (tailwind) pins.push({ packageName: "@tailwindcss/browser", version: tailwind, sourceFile: filePath });
  if (htmx) pins.push({ packageName: "htmx.org", version: htmx, sourceFile: filePath });
  return pins;
}

function parseFreshnessWorkflowBunVersions(filePath: string): string[] {
  return [...loadFile(filePath).matchAll(/bun-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/g)].map((match) => match[1] ?? "").filter(Boolean);
}

function stripRangePrefix(versionRange: string): string | null {
  const match = /^(?:\^|~)?([0-9]+\.[0-9]+\.[0-9]+)$/.exec(versionRange.trim());
  return match?.[1] ?? null;
}

function parseRangeMajor(versionRange: string): number | null {
  const majorText = /^(?:\^|~)?([0-9]+)(?:\.[0-9]+){0,2}$/.exec(versionRange.trim())?.[1];
  if (!majorText) return null;
  return Number.parseInt(majorText, 10);
}

function parseMajor(version: string): number | null {
  const major = /^([0-9]+)\./.exec(version)?.[1];
  if (!major) return null;
  return Number.parseInt(major, 10);
}

function queryLatestNpmVersion(packageName: string): string | null {
  const cached = npmVersionCache.get(packageName);
  if (cached !== undefined) return cached;
  for (let attempt = 1; attempt <= NPM_VERSION_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
    const proc = Bun.spawnSync(["bun", "pm", "view", packageName, "version"], {
      cwd: resolve(ROOT, "control-plane"),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) continue;
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
  if (proc.exitCode !== 0) return null;
  const version = proc.stdout.toString().trim();
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) ? version : null;
}

function validateOfflinePins(errors: string[]): void {
  const deps = [...collectDependencies(FRESHNESS_CONTROL_PLANE_PACKAGE), ...collectDependencies(FRESHNESS_TOOLING_PACKAGE)];
  for (const dep of deps) {
    const lower = dep.versionRange.trim().toLowerCase();
    if (lower === "latest" || lower === "*") {
      errors.push(`${dep.sourceFile} uses non-deterministic version '${dep.versionRange}' for ${dep.packageName}`);
    }
    if (parseRangeMajor(dep.versionRange) === null) {
      errors.push(`${dep.sourceFile} uses unsupported version range '${dep.versionRange}' for ${dep.packageName}`);
    }
  }
  const cdnPins = parseCdnPins(FRESHNESS_LAYOUT_FILE);
  if (cdnPins.length !== 3) {
    errors.push(`${FRESHNESS_LAYOUT_FILE} must pin daisyui, @tailwindcss/browser, and htmx.org with exact semver versions`);
  }
  const bunVersions = parseFreshnessWorkflowBunVersions(FRESHNESS_WORKFLOW_FILE);
  if (bunVersions.length === 0) {
    errors.push(`${FRESHNESS_WORKFLOW_FILE} must pin bun-version entries explicitly`);
  }
}

function validateOnlineFreshness(errors: string[]): void {
  const deps = [...collectDependencies(FRESHNESS_CONTROL_PLANE_PACKAGE), ...collectDependencies(FRESHNESS_TOOLING_PACKAGE)];
  for (const dep of deps) {
    const pinnedMajor = parseRangeMajor(dep.versionRange);
    if (pinnedMajor === null) continue;
    const pinnedVersion = stripRangePrefix(dep.versionRange);
    const latest = queryLatestNpmVersion(dep.packageName);
    if (!latest) { errors.push(`Unable to resolve latest npm version for ${dep.packageName}`); continue; }
    const latestMajor = parseMajor(latest);
    if (pinnedMajor !== null && latestMajor !== null && pinnedMajor !== latestMajor) {
      errors.push(`${dep.packageName} major drift detected (${dep.versionRange} vs latest ${latest}) in ${dep.sourceFile}`);
      continue;
    }
    if (pinnedVersion && pinnedVersion !== latest) {
      errors.push(`${dep.packageName} is outdated in ${dep.sourceFile}: pinned ${pinnedVersion}, latest ${latest}`);
    }
  }
  const cdnPins = parseCdnPins(FRESHNESS_LAYOUT_FILE);
  for (const pin of cdnPins) {
    const latest = queryLatestNpmVersion(pin.packageName);
    if (!latest) { errors.push(`Unable to resolve latest npm version for CDN pin ${pin.packageName}`); continue; }
    if (pin.version !== latest) errors.push(`${pin.packageName} CDN pin is outdated in ${pin.sourceFile}: pinned ${pin.version}, latest ${latest}`);
  }
  const localBunVersion = readLocalBunVersion();
  const workflowPins = parseFreshnessWorkflowBunVersions(FRESHNESS_WORKFLOW_FILE);
  if (!localBunVersion) { errors.push("Unable to resolve local Bun version with 'bun --version'"); return; }
  for (const pin of workflowPins) {
    if (pin !== localBunVersion) errors.push(`${FRESHNESS_WORKFLOW_FILE} pins bun-version ${pin}, but local Bun is ${localBunVersion}`);
  }
}

/** Run version freshness audit. Throws on failure. */
export function auditVersionFreshness(options?: { online?: boolean }): void {
  const online = options?.online ?? (process.env.VERSION_FRESHNESS_MODE ?? "offline").toLowerCase() === "online";

  const errors: string[] = [];
  validateOfflinePins(errors);
  if (online) validateOnlineFreshness(errors);

  if (errors.length > 0) {
    fail("Version freshness", errors);
  }

  process.stdout.write(`Version freshness checks passed (mode=${online ? "online" : "offline"}).\n`);
}
