import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMaestroFlowYaml } from "../../../contracts/flow-parser";
import { loadSchemaValidators } from "./schema";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | { [key: string]: JsonValue } | JsonValue[];

const BUN_VERSION_PART_FALLBACK = "0";
const BUN_REQUIRED_MAJOR = 1;
const BUN_REQUIRED_MINOR = 3;

/**
 * Runs schema validation for a flow YAML file.
 */
export function validateFlowFile(flowPath: string): void {
  const raw = readFileSync(resolve(flowPath), "utf-8");
  const normalized = parseMaestroFlowYaml(raw);
  const validators = loadSchemaValidators();

  if (!validators.flow(normalized)) {
    const details = (validators.flow.errors ?? [])
      .map((entry) => `${entry.instancePath} ${entry.message}`)
      .join("\n");
    throw new Error(`Flow validation failed:\n${details}`);
  }

  process.stdout.write(`VALID: ${flowPath}\n`);
}

/**
 * Runs schema validation for a model manifest JSON file (ModelManifestV2).
 */
export function validateModelManifestFile(manifestPath: string): void {
  const raw = readFileSync(resolve(manifestPath), "utf-8");
  const parsed = parseJson(raw);
  const validators = loadSchemaValidators();

  if (!validators.modelManifest(parsed)) {
    const details = (validators.modelManifest.errors ?? [])
      .map((entry) => `${entry.instancePath} ${entry.message}`)
      .join("\n");
    throw new Error(`Model-manifest validation failed:\n${details}`);
  }

  process.stdout.write(`VALID: ${manifestPath}\n`);
}

function parseJson(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new Error("Model-manifest JSON parse failed");
  }
}

/**
 * Compiles flow YAML to canonical JSON output.
 */
export function compileFlowFile(flowPath: string, outputPath?: string): string {
  const raw = readFileSync(resolve(flowPath), "utf-8");
  const normalized = parseMaestroFlowYaml(raw);
  const validators = loadSchemaValidators();

  if (!validators.flow(normalized)) {
    const details = (validators.flow.errors ?? [])
      .map((entry) => `${entry.instancePath} ${entry.message}`)
      .join("\n");
    throw new Error(`Flow compile failed schema validation:\n${details}`);
  }

  const destination = outputPath ?? `${flowPath}.compiled.json`;
  writeFileSync(resolve(destination), JSON.stringify(normalized, null, 2));
  process.stdout.write(`COMPILED: ${destination}\n`);
  return destination;
}

/**
 * Checks local environment and required contract files.
 */
export function doctor(): void {
  const requiredFiles = [
    resolve(import.meta.dir, "..", "..", "..", "contracts", "flow-v1.schema.json"),
    resolve(import.meta.dir, "..", "..", "..", "contracts", "model-manifest-v2.schema.json"),
  ];

  const missing = requiredFiles.filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(`Missing contract files:\n${missing.join("\n")}`);
  }

  const bunVersion = process.versions.bun;
  if (!bunVersion) {
    throw new Error("Bun runtime is required");
  }

  const bunVersionParts = bunVersion.split(".");
  const major = Number.parseInt(bunVersionParts[0] ?? BUN_VERSION_PART_FALLBACK, 10);
  const minor = Number.parseInt(bunVersionParts[1] ?? BUN_VERSION_PART_FALLBACK, 10);
  const supportsRequiredVersion =
    Number.isFinite(major) && Number.isFinite(minor)
    && (major > BUN_REQUIRED_MAJOR || (major === BUN_REQUIRED_MAJOR && minor >= BUN_REQUIRED_MINOR));
  if (!supportsRequiredVersion) {
    throw new Error(`Bun 1.3+ required, found ${bunVersion}`);
  }

  process.stdout.write(`OK: Bun ${bunVersion}, contracts loaded\n`);
}
