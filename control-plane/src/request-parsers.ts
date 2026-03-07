import { parseFlowTarget } from "./flow-target-parser";
import {
  DEFAULT_FLOW_TARGET,
  MAX_MODEL_PULL_TIMEOUT_MS,
  parseKnownModelSourceId,
} from "./config";
import {
  type RequestBodyRecord,
  type RequestFieldValue,
  parseOptionalInt,
  parseOptionalTrimmedString,
} from "./http-helpers";
import {
  createFlowCapabilityError,
  type AppBuildRequest,
  type BuildType,
  type FlowRunRequest,
  type ModelPullRequest,
} from "../../contracts/flow-contracts";

/** Coerce flexible request values into booleans for form-driven HTMX submissions. */
export function parseOptionalBoolean(value: RequestFieldValue): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "false" || normalized === "0" || normalized === "off") {
      return false;
    }
    if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") {
      return true;
    }
  }
  return undefined;
}

/** Validate that a URL is an http(s) endpoint accepted by provider settings. */
export function isSupportedHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }

  const parsed = new URL(value);
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** Validate a persisted model identifier used by preferences and provider state. */
export function isValidModelIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= 256
    && !/[\s]/.test(trimmed)
    && !trimmed.includes("\u0000")
    && !trimmed.includes("\r")
    && !trimmed.includes("\n");
}

/** Parse the flow run request body used by synchronous and async flow execution routes. */
export function parseFlowRunRequestBody(body: RequestBodyRecord | null | undefined): FlowRunRequest {
  if (!body) {
    return { yaml: "", target: DEFAULT_FLOW_TARGET };
  }

  return {
    yaml: parseOptionalTrimmedString(body.yaml) ?? "",
    target: parseFlowTarget(body.target),
    maxAttempts: parseOptionalInt(body.maxAttempts),
    commandTimeoutMs: parseOptionalInt(body.commandTimeoutMs),
    retryDelayMs: parseOptionalInt(body.retryDelayMs),
    correlationId: parseOptionalTrimmedString(body.correlationId),
  };
}

/** Parse and validate the model pull request body for runtime job dispatch. */
export function parseModelPullRequestBody(body: RequestBodyRecord | null | undefined): ModelPullRequest {
  if (!body) {
    return {};
  }

  if (body.modelRef !== undefined && typeof body.modelRef !== "string") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "modelRef",
      reason: "modelRef must be a string when provided.",
      retryable: false,
      surface: "model_pull",
    });
  }

  if (body.source !== undefined && typeof body.source !== "string") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "source",
      reason: "source must be a string when provided.",
      retryable: false,
      surface: "model_pull",
    });
  }

  if (body.platform !== undefined && typeof body.platform !== "string") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: "platform must be a string when provided.",
      retryable: false,
      surface: "model_pull",
    });
  }

  if (body.correlationId !== undefined && typeof body.correlationId !== "string") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "correlationId",
      reason: "correlationId must be a string when provided.",
      retryable: false,
      surface: "model_pull",
    });
  }

  const modelRef = parseOptionalTrimmedString(body.modelRef);
  const sourceValue = parseOptionalTrimmedString(body.source);
  const source = sourceValue ? parseKnownModelSourceId(sourceValue) : undefined;
  if (sourceValue !== undefined && source === null) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: sourceValue,
      reason: `Unknown model source '${sourceValue}'.`,
      retryable: false,
      surface: "model_pull",
      resource: sourceValue,
    });
  }

  const platform = parseOptionalTrimmedString(body.platform);
  const force = parseOptionalBoolean(body.force);
  if (body.force !== undefined && force === undefined) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "force",
      reason: "force must be a boolean, number, or string alias (true/false/1/0/on/off/yes/no) when provided.",
      retryable: false,
      surface: "model_pull",
    });
  }

  const timeoutMs = parseOptionalInt(body.timeoutMs);
  if (body.timeoutMs !== undefined && timeoutMs === undefined) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "timeoutMs",
      reason: "timeoutMs must be a positive integer when provided.",
      retryable: false,
      surface: "model_pull",
    });
  }
  if (timeoutMs !== undefined && (timeoutMs <= 0 || timeoutMs > MAX_MODEL_PULL_TIMEOUT_MS)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "timeoutMs",
      reason: `timeoutMs must be between 1 and ${MAX_MODEL_PULL_TIMEOUT_MS}.`,
      retryable: false,
      surface: "model_pull",
    });
  }

  return {
    modelRef,
    source: source ?? undefined,
    platform,
    force,
    timeoutMs,
    correlationId: parseOptionalTrimmedString(body.correlationId),
  };
}

function isSupportedBuildType(value: string): value is BuildType {
  return value === "debug" || value === "release";
}

/** Parse and validate the app build request body used by Android and iOS build jobs. */
export function parseAppBuildRequestBody(body: RequestBodyRecord | null | undefined): AppBuildRequest {
  if (!body) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "payload",
      reason: "App build payload must be an object.",
      retryable: false,
      surface: "app_build",
    });
  }

  const platform = parseOptionalTrimmedString(body.platform)?.toLowerCase();
  if (!platform) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: "platform is required for app builds.",
      retryable: false,
      surface: "app_build",
    });
  }
  if (platform !== "android" && platform !== "ios") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "platform",
      reason: "platform must be android or ios.",
      retryable: false,
      surface: "app_build",
    });
  }

  const buildType = parseOptionalTrimmedString(body.buildType);
  return {
    platform,
    buildType: buildType && isSupportedBuildType(buildType) ? buildType : undefined,
    variant: parseOptionalTrimmedString(body.variant),
    outputDir: parseOptionalTrimmedString(body.outputDir),
    skipTests: parseOptionalBoolean(body.skipTests),
    clean: parseOptionalBoolean(body.clean),
    correlationId: parseOptionalTrimmedString(body.correlationId),
  };
}

/** Parse the provider validation request body. */
export function parseProviderValidationBody(body: RequestBodyRecord | null | undefined): { connectivity: boolean } {
  return {
    connectivity: parseOptionalBoolean(body?.connectivity) ?? false,
  };
}
