import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const AUDIT_DOC = resolve(ROOT, "docs", "CAPABILITY_AUDIT.md");
const FLOW_REFERENCE_DOC = resolve(ROOT, "docs", "FLOW_REFERENCE.md");
const FLOW_CONTRACTS = resolve(ROOT, "contracts", "flow-contracts.ts");
const CONTROL_PLANE_CONFIG = resolve(ROOT, "control-plane", "src", "config.ts");

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

const REQUIRED_CAPABILITIES = [
  "/api/flows/validate",
  "/api/models/pull",
  "/api/models/pull/:jobId",
  "/api/apps/build",
  "/api/apps/build/:jobId",
  "/api/ai/providers/validate",
  "Ramalama model pull capability",
  "iOS build unsupported on non-mac hosts",
];

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

function loadFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function parseControlPlaneDefaultPort(): number {
  const source = loadFile(CONTROL_PLANE_CONFIG);
  const match = /export const CONTROL_PLANE_DEFAULT_PORT = (\d+);/.exec(source);
  if (!match?.[1]) {
    return 3310;
  }
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

  const rows = rawRows
    .map((line) => {
      const parts = line.split("|").slice(1, -1).map((value) => value.trim());
      if (parts.length < 8) {
        return null;
      }

      const [nameRaw, sourceRaw, statusRaw, ownerRaw, gapTypeRaw, contractRaw, testRaw, runtimeRaw] = parts;
      const name = stripMarkdownCode(nameRaw);
      const source_of_claim = stripMarkdownCode(sourceRaw);
      const status = stripMarkdownCode(statusRaw);
      const owner = stripMarkdownCode(ownerRaw);
      const gap_type = stripMarkdownCode(gapTypeRaw);
      const contract_ref = stripMarkdownCode(contractRaw);
      const test_ref = stripMarkdownCode(testRaw);
      const runtime_ref = stripMarkdownCode(runtimeRaw);
      if (!name || !source_of_claim || !status || !owner) {
        return null;
      }

      if (!["implemented", "partial", "stub", "unsupported"].includes(status)) {
        throw new Error(`Unknown capability status "${status}" in ${filePath}`);
      }

      return {
        name,
        source_of_claim,
        status: status as CapabilityStatus,
        owner,
        gap_type,
        contract_ref,
        test_ref,
        runtime_ref,
      };
    })
    .filter((row): row is AuditRow => row !== null);

  return rows;
}

function parseSupportedCommands(filePath: string): Set<string> {
  const markdown = loadFile(filePath);
  const sectionMatch = /## Supported commands([\s\S]*?)(\n## |\n# |$)/.exec(markdown);
  if (!sectionMatch) {
    throw new Error(`Cannot find Supported commands section in ${filePath}`);
  }

  const section = sectionMatch[1];
  const items = [...section.matchAll(/^\s*-\s*`([^`]+)`\s*$/gm)].map((match) => match[1]);
  return new Set(items.map((item) => item.trim()));
}

function parseReferencedRoutes(filePath: string): Set<string> {
  const markdown = loadFile(filePath);
  const sectionMatch = /## API routes([\s\S]*?)(\n## |\n# |$)/.exec(markdown);
  if (!sectionMatch) {
    return new Set();
  }

  const section = sectionMatch[1];
  const items = [...section.matchAll(/`(\/api\/[^`]+)`/g)].map((match) => match[1]);
  return new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0));
}

function parseCommandRegistry(filePath: string): Set<string> {
  const source = loadFile(filePath);
  const set = new Set<string>();
  const blockMatch = /export const SUPPORTED_FLOW_COMMANDS[\s\S]*?=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/.exec(source);
  if (!blockMatch) {
    throw new Error(`Cannot find SUPPORTED_FLOW_COMMANDS in ${filePath}`);
  }

  const block = blockMatch[1] ?? "";
  const commandMatch = /\{\s*type:\s*"(.*?)"\s*,[\s\S]*?\}/g;
  const iterator = block.matchAll(commandMatch);
  for (const item of iterator) {
    const command = item[1]?.trim();
    if (command) {
      set.add(command);
    }
  }

  return set;
}

function validateCommandParity(
  errors: string[],
  docsCommands: Set<string>,
  registryCommands: Set<string>,
  rows: readonly AuditRow[],
): void {
  const missingInRegistry = [...docsCommands].filter((command) => !registryCommands.has(command));
  if (missingInRegistry.length > 0) {
    for (const command of missingInRegistry) {
      errors.push(`FLOW_REFERENCE.md claims command "${command}" but it is not in SUPPORTED_FLOW_COMMANDS`);
    }
  }

  const documentedCommandRows = new Set(
    rows.filter((row) => /^[a-zA-Z-]+$/.test(row.name)).map((row) => row.name),
  );
  for (const command of [...registryCommands]) {
    if (!docsCommands.has(command) && !documentedCommandRows.has(command)) {
      errors.push(`Flow command "${command}" is registered but undocumented in FLOW_REFERENCE.md`);
    }
  }
}

function validateAuditRows(errors: string[], rows: readonly AuditRow[]): void {
  for (const row of rows) {
    if (row.status === "stub") {
      if (row.owner.length === 0 || row.owner.toLowerCase() === "none") {
        errors.push(`Stub capability "${row.name}" must include owner`);
      }
      if (row.gap_type.length === 0 || row.gap_type.toLowerCase() === "none") {
        errors.push(`Stub capability "${row.name}" must include gap_type rationale`);
      }
    }

    if ((row.status === "implemented" || row.status === "partial") && !row.test_ref.trim()) {
      errors.push(`Implemented/partial capability "${row.name}" must include test_ref`);
    }

    if ((row.status === "implemented" || row.status === "partial") && !row.contract_ref.trim()) {
      errors.push(`Implemented/partial capability "${row.name}" must include contract_ref`);
    }

    if ((row.status === "implemented" || row.status === "partial") && !row.runtime_ref.trim()) {
      errors.push(`Implemented/partial capability "${row.name}" must include runtime_ref`);
    }
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
  if (!text.includes("3310")) {
    return;
  }

  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes(String(expectedPort))) {
      continue;
    }
    const referencesConfig = /CONTROL_PLANE_DEFAULT_PORT|CONTROL_PLANE_PORT|PORT|control-plane\/src\/config/.test(line);
    if (!referencesConfig) {
      errors.push(`${filePath}:${index + 1} hardcodes ${expectedPort} without config reference`);
    }
  }
}

function validateDaisyUiRefs(filePath: string, text: string, errors: string[]): void {
  for (const match of [...text.matchAll(/daisyui@([0-9][0-9.]*)/g)]) {
    const version = match[1];
    if (!(version === "5" || version.startsWith("5."))) {
      errors.push(`${filePath} references daisyUI ${version}, expected version 5`);
      break;
    }
  }
}

function validateHtmxRefs(filePath: string, text: string, errors: string[]): void {
  const versions = [...text.matchAll(/htmx\.org@([0-9][0-9.]*)/g)].map((match) => match[1]);
  if (versions.length === 0) {
    errors.push(`${filePath} is missing an explicit htmx.org version pin`);
    return;
  }

  for (const version of versions) {
    if (version !== EXPECTED_HTMX_VERSION) {
      errors.push(`${filePath} references htmx.org@${version}, expected ${EXPECTED_HTMX_VERSION}`);
    }
  }

  const extVersions = [...text.matchAll(/htmx-ext-sse@([0-9][0-9.]*)/g)].map((match) => match[1]);
  if (extVersions.length === 0) {
    errors.push(`${filePath} is missing an explicit htmx-ext-sse version pin`);
    return;
  }
  for (const version of extVersions) {
    if (version !== EXPECTED_HTMX_SSE_EXTENSION_VERSION) {
      errors.push(
        `${filePath} references htmx-ext-sse@${version}, expected ${EXPECTED_HTMX_SSE_EXTENSION_VERSION}`,
      );
    }
  }
}

function validateBunWorkflowVersion(filePath: string, text: string, errors: string[]): void {
  const versions = [...text.matchAll(/bun-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/g)].map((match) => match[1]);
  if (versions.length === 0) {
    errors.push(`${filePath} is missing explicit bun-version pins`);
    return;
  }

  for (const version of versions) {
    if (version !== EXPECTED_BUN_VERSION) {
      errors.push(`${filePath} references bun-version ${version}, expected ${EXPECTED_BUN_VERSION}`);
    }
  }
}

function fail(errors: string[]): never {
  throw new Error(`Capability audit checks failed:\n${errors.map((entry) => `- ${entry}`).join("\n")}`);
}

function main(): void {
  const controlPlanePort = parseControlPlaneDefaultPort();
  const rows = parseMarkdownTable(AUDIT_DOC);
  const docsCommands = parseSupportedCommands(FLOW_REFERENCE_DOC);
  const registryCommands = parseCommandRegistry(FLOW_CONTRACTS);

  const errors: string[] = [];

  validateCommandParity(errors, docsCommands, registryCommands, rows);
  validateAuditRows(errors, rows);
  validateRequiredCapabilities(errors, rows);
  validateDocsRouteParity(errors, rows);

  for (const file of DAISYUI_CHECK_FILES) {
    const text = loadFile(file);
    validateDaisyUiRefs(file, text, errors);
  }

  for (const file of HTMX_CHECK_FILES) {
    const text = loadFile(file);
    validateHtmxRefs(file, text, errors);
  }

  validateBunWorkflowVersion(BUN_VERSION_CHECK_FILE, loadFile(BUN_VERSION_CHECK_FILE), errors);

  for (const file of PORT_REQUIRES_REFERENCE_FILES) {
    const text = loadFile(file);
    validateFileReferences(file, text, controlPlanePort, errors);
  }

  if (errors.length > 0) {
    fail(errors);
  }

  process.stdout.write(
    [
      `CAPABILITY_AUDIT checks passed: ${rows.length} capabilities, ${docsCommands.size} documented commands, ${registryCommands.size} registry commands.`,
      "",
    ].join("\n"),
  );
}
main();
