import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMaestroFlowYaml } from "../../../contracts/flow-parser";
import { auditProviderCredentialIntegrity } from "../../../control-plane/src/provider-credential-integrity";
import {
  createDeviceAiReadinessEnvironment,
  evaluateDeviceAiReadiness,
  resolveDeviceAiHostOs,
  type DeviceAiHostOs,
} from "../../../shared/device-ai-readiness";
import {
  androidSdkPackagesInstalled,
  commandExists,
  formatDoctorStatus,
  isSimctlAvailable,
  resolveAdbExecutablePath,
  resolveAndroidSdkRoot,
  resolveJava21Home,
  resolveSdkManagerPath,
} from "../../../shared/host-tooling";
import { readDeviceAiProtocolProfile } from "./orchestration";
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

/**
 * Runs schema validation for a device AI protocol profile JSON file.
 */
export function validateDeviceAiProfileFile(profilePath: string): void {
  const raw = readFileSync(resolve(profilePath), "utf-8");
  const parsed = parseJson(raw);
  const validators = loadSchemaValidators();

  if (!validators.deviceAiProfile(parsed)) {
    const details = (validators.deviceAiProfile.errors ?? [])
      .map((entry) => `${entry.instancePath} ${entry.message}`)
      .join("\n");
    throw new Error(`Device-AI profile validation failed:\n${details}`);
  }

  process.stdout.write(`VALID: ${profilePath}\n`);
}

/**
 * Runs schema validation for a device AI protocol run-report JSON file.
 */
export function validateDeviceAiReportFile(reportPath: string): void {
  const raw = readFileSync(resolve(reportPath), "utf-8");
  const parsed = parseJson(raw);
  const validators = loadSchemaValidators();

  if (!validators.deviceAiReport(parsed)) {
    const details = (validators.deviceAiReport.errors ?? [])
      .map((entry) => `${entry.instancePath} ${entry.message}`)
      .join("\n");
    throw new Error(`Device-AI report validation failed:\n${details}`);
  }

  process.stdout.write(`VALID: ${reportPath}\n`);
}

function parseJson(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch (e) {
    throw new Error(`Model-manifest JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

function getDoctorHostOs(): DeviceAiHostOs {
  return resolveDeviceAiHostOs(process.platform);
}

function formatRequirementStatus(required: boolean, satisfied: boolean): string {
  if (!required) {
    return "NOT REQUIRED";
  }
  return satisfied ? "OK" : "MISSING";
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
export async function doctor(dbPath?: string): Promise<void> {
  const requiredFiles = [
    resolve(import.meta.dir, "..", "..", "..", "contracts", "flow-v1.schema.json"),
    resolve(import.meta.dir, "..", "..", "..", "contracts", "model-manifest-v2.schema.json"),
    resolve(import.meta.dir, "..", "..", "..", "contracts", "device-ai-protocol.schema.json"),
    resolve(import.meta.dir, "..", "..", "..", "control-plane", "config", "device-ai-profile.json"),
  ];
  const androidEnvTemplatePath = resolve(import.meta.dir, "..", "..", "..", "Android", "src", "vertu.local.properties.example");

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

  process.stdout.write(`${formatDoctorStatus("bun", commandExists("bun") ? "OK" : "MISSING")}\n`);
  process.stdout.write(`${formatDoctorStatus("swift", commandExists("swift") ? "OK" : "MISSING")}\n`);
  process.stdout.write(`${formatDoctorStatus("brew", commandExists("brew") ? "OK" : "MISSING")}\n`);
  process.stdout.write(`${formatDoctorStatus("python3", commandExists("python3") ? "OK" : "MISSING")}\n`);

  const java21Home = await resolveJava21Home(process.env);
  process.stdout.write(`${formatDoctorStatus("java_runtime", java21Home ? "OK" : "MISSING")}\n`);
  process.stdout.write(`${formatDoctorStatus("java_home_21", java21Home?.javaHome ?? "NOT FOUND")}\n`);

  process.stdout.write(`${formatDoctorStatus("contracts", "OK")}\n`);
  process.stdout.write(
    `${formatDoctorStatus("android_env_template", existsSync(androidEnvTemplatePath) ? "OK" : "MISSING")}\n`,
  );

  const resolvedSdkRoot = resolveAndroidSdkRoot(process.env);
  process.stdout.write(`${formatDoctorStatus("android_sdk_root", resolvedSdkRoot?.sdkRoot ?? "NOT FOUND")}\n`);
  process.stdout.write(
    `${formatDoctorStatus(
      "android_sdk_packages",
      resolvedSdkRoot && androidSdkPackagesInstalled(resolvedSdkRoot.sdkRoot) ? "OK" : "MISSING",
    )}\n`,
  );
  process.stdout.write(
    `${formatDoctorStatus(
      "sdkmanager",
      resolvedSdkRoot ? (resolveSdkManagerPath(process.env, resolvedSdkRoot.sdkRoot) ?? "NOT FOUND") : "NOT FOUND",
    )}\n`,
  );
  process.stdout.write(`${formatDoctorStatus("adb", resolveAdbExecutablePath(process.env) ?? "NOT FOUND")}\n`);
  const readinessEnvironment = createDeviceAiReadinessEnvironment(process.env);

  const deviceAiReadiness = evaluateDeviceAiReadiness(
    readDeviceAiProtocolProfile(),
    getDoctorHostOs(),
    readinessEnvironment,
    {
      commandExists: (command) => {
        if (command === "adb") {
          return resolveAdbExecutablePath(process.env) !== null;
        }
        return commandExists(command);
      },
      iosSimctlAvailable: () => isSimctlAvailable(readinessEnvironment),
    },
  );
  const requirementByCode = new Map(
    deviceAiReadiness.requirements.map((requirement) => [requirement.code, requirement] as const),
  );
  const hfTokenStatus = requirementByCode.get("hf_token");
  const iosMacHostStatus = requirementByCode.get("ios_macos_host");
  const iosXcrunStatus = requirementByCode.get("ios_xcrun");
  const iosSimctlStatus = requirementByCode.get("ios_simctl");
  if (!hfTokenStatus || !iosMacHostStatus || !iosXcrunStatus || !iosSimctlStatus) {
    throw new Error("Device AI readiness requirements are incomplete.");
  }

  process.stdout.write(`${formatDoctorStatus("device_ai_protocol", deviceAiReadiness.status.toUpperCase())}\n`);
  process.stdout.write(
    `${formatDoctorStatus("hf_token", formatRequirementStatus(hfTokenStatus.required, hfTokenStatus.satisfied))}\n`,
  );
  process.stdout.write(
    `${formatDoctorStatus("ios_macos_host", formatRequirementStatus(iosMacHostStatus.required, iosMacHostStatus.satisfied))}\n`,
  );
  process.stdout.write(
    `${formatDoctorStatus("ios_xcrun", formatRequirementStatus(iosXcrunStatus.required, iosXcrunStatus.satisfied))}\n`,
  );
  process.stdout.write(
    `${formatDoctorStatus("ios_simctl", formatRequirementStatus(iosSimctlStatus.required, iosSimctlStatus.satisfied))}\n`,
  );
  process.stdout.write(`${formatDoctorStatus("ramalama", commandExists("ramalama") ? "OK (optional)" : "MISSING (optional)")}\n`);
  process.stdout.write(`${formatDoctorStatus("ollama", commandExists("ollama") ? "OK (optional)" : "MISSING (optional)")}\n`);

  const credentialReport = auditProviderCredentialIntegrity(dbPath);
  if (credentialReport.status === "fail") {
    throw new Error(
      `Provider credential integrity audit failed:\n${
        credentialReport.issues.map((issue) =>
          `- ${issue.provider} (${issue.code})${issue.updatedAt ? ` [updatedAt=${issue.updatedAt}]` : ""}: ${issue.message}`)
          .join("\n")
      }`,
    );
  }

  process.stdout.write(`\nRun full verification with: ${resolve(import.meta.dir, "..", "..", "..", "scripts", "dev_bootstrap.sh")}\n`);
  process.stdout.write(`OK: Bun ${bunVersion}, contracts loaded, provider credentials verified\n`);
}
