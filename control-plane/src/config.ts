/** Shared control-plane runtime configuration constants. */

import { ConfigParseError } from "./errors";
import { join } from "node:path";
import canonicalModelPullPresetConfigJson from "../config/model-pull-presets.json" with { type: "json" };
import canonicalModelSourceRegistryJson from "../config/model-sources.json" with { type: "json" };
import canonicalProviderRegistryJson from "../config/providers.json" with { type: "json" };
import {
  CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE,
  CHAT_TTS_OUTPUT_MIME_TYPES,
  SUPPORTED_BUILD_TYPES as SHARED_SUPPORTED_BUILD_TYPES,
  SUPPORTED_DESKTOP_BUILD_VARIANTS as SHARED_SUPPORTED_DESKTOP_BUILD_VARIANTS,
} from "../../contracts/flow-contracts";
import type {
  BuildKind,
  BuildType,
  ControlPlaneState as SharedControlPlaneState,
  DesktopBuildVariant,
  FlowRunTarget,
  ModelRefValidationMode,
  ModelRefValidationPolicy,
  ModelSource,
  ChatTtsOutputMimeType,
} from "../../contracts/flow-contracts";
import { type DeviceAiProtocolProfile } from "../../contracts/device-ai-protocol";
import {
  isJsonRecord,
  readOptionalUrlEnv,
  readPositiveIntEnv,
  readStringArrayEnv,
  readStringEnv,
  safeParseJson,
  toTrimmedString,
  type JsonInput,
  type JsonValue,
} from "./config/env";
import { DEVICE_AI_PROFILE_CONFIG_PATH, readDeviceAiProfileFile } from "./config/device-ai-profile";
export {
  isJsonRecord,
  readOptionalUrlEnv,
  readPositiveIntEnv,
  readStringArrayEnv,
  readStringEnv,
  safeParseJson,
  toTrimmedString,
  type JsonRecord,
  type JsonInput,
  type JsonScalar,
  type JsonValue,
  type ParseResult,
} from "./config/env";

interface ProviderRegistryConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  requiresKey: boolean;
  defaultModels: string[];
  docsUrl: string;
  /** Optional placeholder for API key input (e.g. "Token from huggingface.co/settings/tokens"). */
  keyHint?: string;
  /** If true, show base URL config input (e.g. Ollama). */
  hasBaseUrlConfig?: boolean;
}

interface ModelPullPresetConfig {
  defaultModelRef: string;
  presets: readonly string[];
  modelRefPlaceholder: string;
}

interface ModelSourceConfigInput {
  id: string;
  displayName: string;
  description?: string;
  modelRefPlaceholder?: string;
  modelRefHint?: string;
  modelRefValidation: ModelRefValidationMode;
  canonicalHost?: string;
  ramalamaTransportPrefix?: string;
  aliases?: readonly string[];
  enforceAllowlist?: boolean;
}

interface ModelSourceRegistryConfig {
  defaultSource?: string;
  sources: readonly ModelSourceConfigInput[];
}

/** Typed model-source descriptor consumed by model pull validation and UI forms. */
export interface ModelSourceConfig {
  /** Canonical source identifier passed through request payloads. */
  id: ModelSource;
  /** Human-readable source label. */
  displayName: string;
  /** Optional source description for UI clients. */
  description?: string;
  /** Placeholder value shown for model reference input fields. */
  modelRefPlaceholder: string;
  /** Optional hint text rendered by client forms. */
  modelRefHint?: string;
  /** Validation mode used by source-specific model-ref normalization. */
  modelRefValidation: ModelRefValidationMode;
  /** Canonical host for host-normalized source references. */
  canonicalHost?: string;
  /** Optional transport prefix added before normalized refs for ramalama pull calls. */
  ramalamaTransportPrefix?: string;
  /** Optional aliases that resolve to `id`. */
  aliases: readonly string[];
  /** Whether source pulls should enforce RAMALAMA model allow-list checks. */
  enforceAllowlist: boolean;
}

const DEFAULT_DESKTOP_TARGET: FlowRunTarget = process.platform === "darwin"
  ? "osx"
  : process.platform === "win32"
    ? "windows"
    : "linux";
/** Default flow target for desktop-first automation runs. */
export const DEFAULT_FLOW_TARGET: FlowRunTarget = DEFAULT_DESKTOP_TARGET;
/** Canonical list of supported flow targets. */
export const FLOW_RUN_TARGETS: readonly FlowRunTarget[] = ["android", "ios", "osx", "windows", "linux"] as const;
/** Default build platform for generated app payloads. */
export const DEFAULT_BUILD_PLATFORM: BuildKind = "android";
/** Default build type for app-build jobs. */
export const DEFAULT_BUILD_TYPE: BuildType = "debug";
/** Canonical supported build types. */
export const SUPPORTED_BUILD_TYPES: readonly BuildType[] = SHARED_SUPPORTED_BUILD_TYPES;
/** Default flow script scroll step count when omitted. */
export const FLOW_ENGINE_SCROLL_STEP_DEFAULT = 1;
/** Default scroll distance fraction for ADB-based scroll commands (see also ADB_SWIPE below). */
export const FLOW_ENGINE_ADB_SCROLL_DISTANCE_FRACTION_DEFAULT = 0.5;
/** Default waitForAnimation timeout (ms) when omitted from flow YAML. */
export const FLOW_ENGINE_WAIT_FOR_ANIMATION_DEFAULT_MS = 600;
/** Maximum retry delay cap (ms) to prevent unbounded backoff growth. */
export const FLOW_ENGINE_MAX_RETRY_DELAY_MS = 30_000;
/** ADB input swipe animation duration (ms). */
export const FLOW_ENGINE_ADB_SWIPE_DURATION_MS = 200;
/** Default swipe distance fraction for adb swipe commands. */
export const FLOW_ENGINE_ADB_SWIPE_DISTANCE_FRACTION_DEFAULT = 0.6;
/** Environment keys for control-plane port discovery. */
export const CONTROL_PLANE_PORT_KEYS = ["CONTROL_PLANE_PORT", "PORT"] as const;
/** Default control-plane listen port. */
export const CONTROL_PLANE_DEFAULT_PORT = 3310;
/** Breakpoint (px) below which drawer is mobile/off-canvas. Matches Tailwind lg (1024px). */
export const LAYOUT_BREAKPOINT_LG_PX = 1024;
/** App version for footer; override via APP_VERSION env. */
export const APP_VERSION = process.env.APP_VERSION ?? "1.0";
/** Smallest valid TCP port value. */
export const CONTROL_PLANE_MIN_PORT = 1;
/** Largest valid TCP port value. */
export const CONTROL_PLANE_MAX_PORT = 65535;
/** Flow state fallback for in-progress telemetry rows. */
export const FLOW_PENDING_STATE_LABEL = "pending";
/** Message shown when action attempts are missing. */
export const FLOW_NO_ATTEMPTS_MESSAGE = "No attempts were recorded for this action.";
/** Placeholder artifact value for running jobs. */
export const APP_BUILD_ARTIFACT_PENDING_LABEL = "pending";
/** Fallback command identifier used for chat failures. */
export const CHAT_COMMAND_FALLBACK_LABEL = "model";
/** Standard fallback error for provider model-list transport failures. */
export const AI_PROVIDER_LIST_REQUEST_ERROR = "Model list request failed.";
/** Standard fallback error when Ollama model listing fails. */
export const AI_PROVIDER_OLLAMA_LIST_ERROR = "Unable to list Ollama models.";
/** Standard fallback error for generic provider list request failures. */
export const AI_PROVIDER_MODEL_LIST_ERROR = "Unable to fetch provider model list.";
/** Standard fallback error when a provider returns no model payload. */
export const AI_PROVIDER_NO_MODELS_ERROR = "Provider model endpoint returned no models.";
/** Standard fallback error when provider and fallbacks are both unavailable. */
export const AI_PROVIDER_NO_FALLBACK_MODELS_ERROR = "No fallback models are configured.";
/** Default app-build variant placeholder in UI forms. */
export const APP_BUILD_VARIANT_PLACEHOLDER = "default";
/** Placeholder text for provider API key forms. */
export const PROVIDER_API_KEY_PLACEHOLDER = "sk-...";
/** Suffix added when truncating async job logs. */
export const MODEL_JOB_LOG_TRUNCATION_SUFFIX = "\n... [truncated]";
/** Reserved character budget for log truncation suffix. */
export const MODEL_JOB_LOG_TRUNCATION_RESERVED_CHARS = 24;
/** Reason when model pull job is not found. */
export const MODEL_PULL_JOB_NOT_FOUND_REASON = "Requested model pull job could not be found.";
/** Reason when model pull job payload is invalid. */
export const MODEL_PULL_JOB_PAYLOAD_INVALID_REASON = "Model pull job payload could not be parsed.";
/** Reason when model pull is in progress. */
export const MODEL_PULL_IN_PROGRESS_REASON = "model pull is in progress";
/** Reason when model pull is paused. */
export const MODEL_PULL_PAUSED_REASON = "model pull is paused";
/** User-facing message when a model pull is cancelled. */
export const MODEL_PULL_CANCELLED_MESSAGE = "Model pull cancelled by operator";
/** User-facing message when a model pull is resumed. */
export const MODEL_PULL_RESUMED_MESSAGE = "Model pull resumed (requeued) by operator";
/** Reason when app build job is not found. */
export const APP_BUILD_JOB_NOT_FOUND_REASON = "Requested app build job could not be found.";
/** Reason when app build job payload is invalid. */
export const APP_BUILD_JOB_PAYLOAD_INVALID_REASON = "App build job payload could not be parsed.";
/** Reason when app build is in progress. */
export const APP_BUILD_IN_PROGRESS_REASON = "app build is in progress";
/** Message when build job is cancelled. */
export const APP_BUILD_CANCELLED_MESSAGE = "Build job cancelled by operator";
/** Message when build job is resumed. */
export const APP_BUILD_RESUMED_MESSAGE = "Build job resumed (requeued) by operator";
/** Reason when build platform is unsupported. */
export const APP_BUILD_UNSUPPORTED_PLATFORM_REASON = "Unsupported build platform";
/** Reason when build type is unsupported. */
export const APP_BUILD_UNSUPPORTED_BUILD_TYPE_REASON = "Unsupported buildType";
/** Reason when Android build Java runtime is unavailable. */
export const APP_BUILD_ANDROID_JAVA_MISSING_REASON = "Android build requires Java runtime on this host.";
/** Reason when iOS build is attempted on non-macOS. */
export const APP_BUILD_IOS_MAC_ONLY_REASON = "iOS build is only supported on macOS hosts.";
/** Reason when iOS toolchain is unavailable. */
export const APP_BUILD_IOS_TOOLING_MISSING_REASON = "iOS build requires Xcode build tooling on this host.";
/** Reason when no buildable iOS app scheme is configured. */
export const APP_BUILD_IOS_SCHEME_MISSING_REASON = "iOS build requires at least one shared Xcode app scheme.";
/** Reason when the requested iOS app scheme is not configured. */
export const APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON = "The requested iOS scheme is not available.";
/** Reason when desktop build Bun runtime is unavailable. */
export const APP_BUILD_DESKTOP_BUN_MISSING_REASON = "Desktop build requires Bun runtime on this host.";
/** Reason when desktop build variant (target triple) is unsupported. */
export const APP_BUILD_DESKTOP_UNSUPPORTED_VARIANT_REASON = "Unsupported desktop build variant.";
/** Supported desktop build target triples. */
export const SUPPORTED_DESKTOP_BUILD_VARIANTS: readonly DesktopBuildVariant[] = SHARED_SUPPORTED_DESKTOP_BUILD_VARIANTS;
/** Content type for desktop standalone binaries. */
export const DESKTOP_BUILD_CONTENT_TYPE = "application/octet-stream";
/** Reason when outputDir traverses parent directories. */
export const APP_BUILD_OUTPUT_DIR_TRAVERSE_REASON = "outputDir must not traverse parent directories.";
/** Reason when outputDir cannot be prepared for a build. */
export const APP_BUILD_OUTPUT_DIR_INVALID_REASON = "Build outputDir is invalid or unavailable on this host.";
/** Reason when the selected build script cannot be found. */
export const APP_BUILD_SCRIPT_MISSING_REASON = "App build script is not available for the selected platform.";
/** Reason when app build execution cannot be started or completed deterministically. */
export const APP_BUILD_EXECUTION_FAILED_REASON = "App build could not be started or completed on this host.";
/** Message when build completes successfully. */
export const APP_BUILD_SUCCESS_MESSAGE = "Build completed successfully";
/** Fallback message when app build process fails. */
export const APP_BUILD_FAILURE_FALLBACK_MESSAGE = "App build process failed.";
/** Provider request timeout for model/list + chat compatibility calls. */
export const AI_PROVIDER_REQUEST_TIMEOUT_MS = readPositiveIntEnv("AI_PROVIDER_REQUEST_TIMEOUT_MS", 8_000);
/** Timeout for `ramalama list` subprocess used by `/api/models`. */
export const RAMALAMA_LIST_TIMEOUT_MS = readPositiveIntEnv("RAMALAMA_LIST_TIMEOUT_MS", 4_000);
/** Shared chat max token cap for provider completions. */
export const AI_CHAT_MAX_TOKENS = readPositiveIntEnv("AI_CHAT_MAX_TOKENS", 2_048);
/** Maximum timeout for model pull requests. */
export const MAX_MODEL_PULL_TIMEOUT_MS = readPositiveIntEnv("MODEL_PULL_TIMEOUT_MAX_MS", 24 * 60 * 60 * 1000);
/** Minimum free disk space (bytes) required before starting a model pull (default 2 GB). */
export const MIN_FREE_DISK_BYTES = readPositiveIntEnv("MIN_FREE_DISK_BYTES", 2 * 1024 * 1024 * 1024);
/** Timeout for HuggingFace API metadata lookups (ms). */
export const HF_METADATA_TIMEOUT_MS = readPositiveIntEnv("HF_METADATA_TIMEOUT_MS", 5_000);
/** Maximum age (ms) of terminal jobs before housekeeping pruning (default 30 days). */
export const JOB_PRUNE_MAX_AGE_MS = readPositiveIntEnv("JOB_PRUNE_MAX_AGE_MS", 30 * 24 * 60 * 60 * 1000);
/** Interval (ms) between automatic job/event pruning passes (default 6 hours). */
export const JOB_PRUNE_INTERVAL_MS = readPositiveIntEnv("JOB_PRUNE_INTERVAL_MS", 6 * 60 * 60 * 1000);
/** Interval (ms) between automatic SQLite VACUUM runs (default 24 hours). */
export const SQLITE_VACUUM_INTERVAL_MS = readPositiveIntEnv("SQLITE_VACUUM_INTERVAL_MS", 24 * 60 * 60 * 1000);
/** Rate limit window for chat completions (ms). */
export const CHAT_RATE_LIMIT_WINDOW_MS = readPositiveIntEnv("CHAT_RATE_LIMIT_WINDOW_MS", 1_000);
/** Maximum allowed YAML body size for flow submission (bytes). */
export const MAX_YAML_BYTES = readPositiveIntEnv("MAX_YAML_BYTES", 64 * 1024);
/** Default flow adapter command timeout (ms). */
export const FLOW_ADAPTER_COMMAND_TIMEOUT_MS = readPositiveIntEnv("FLOW_ADAPTER_COMMAND_TIMEOUT_MS", 10_000);
/**
 * Optional remote iOS driver agent URL. When set, the iOS adapter forwards
 * commands to this HTTP endpoint instead of requiring local macOS + xcrun.
 * This enables running iOS flows from any host (Linux CI, cloud, etc.).
 * Expected format: "http://mac-host:9400" (no trailing slash).
 */
export const IOS_REMOTE_AGENT_URL = readOptionalUrlEnv("IOS_REMOTE_AGENT_URL");
/**
 * Optional remote Android driver agent URL. When set, the Android adapter
 * forwards commands to this HTTP endpoint instead of local adb.
 */
export const ANDROID_REMOTE_AGENT_URL = readOptionalUrlEnv("ANDROID_REMOTE_AGENT_URL");
/** Anthropic API version header. */
export const ANTHROPIC_API_VERSION = "2023-06-01";
/** Ollama model listing endpoint suffix. */
export const OLLAMA_TAGS_PATH = "/api/tags";
/** Ollama chat completion path suffix. */
export const OLLAMA_CHAT_COMPLETION_SUFFIX = "/v1/chat/completions";
/** OpenAI-style chat completion path suffix. */
export const OPENAI_CHAT_COMPLETION_SUFFIX = "/chat/completions";
/** OpenAI-style speech-to-text path suffix. */
export const OPENAI_STT_SUFFIX = "/audio/transcriptions";
/** OpenAI-style text-to-speech path suffix. */
export const OPENAI_TTS_SUFFIX = "/audio/speech";
/** Default request body format for OpenAI-compatible TTS responses. */
export const OPENAI_TTS_DEFAULT_FORMAT: ChatTtsOutputMimeType = CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE;
export const CHAT_TTS_OUTPUT_FORMATS = CHAT_TTS_OUTPUT_MIME_TYPES;
/** Default voice used for OpenAI-compatible TTS requests. */
export const DEFAULT_CHAT_TTS_VOICE = readStringEnv("DEFAULT_CHAT_TTS_VOICE", "alloy");

function sanitizeModelPullPreset(value: JsonInput | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function parseModelPullPresetConfig(input: JsonInput | undefined): ModelPullPresetConfig {
  if (!isJsonRecord(input)) {
    throw new ConfigParseError("Invalid model pull preset config: expected JSON object", {
      details: "control-plane/config/model-pull-presets.json must export an object.",
    });
  }

  const defaultModelRef = sanitizeModelPullPreset(input.defaultModelRef);
  const modelRefPlaceholder = sanitizeModelPullPreset(input.modelRefPlaceholder);
  const presets = Array.isArray(input.presets)
    ? input.presets.map(sanitizeModelPullPreset).filter((value) => value.length > 0)
    : [];

  const sanitizedPresets = presets.length > 0 ? Array.from(new Set(presets)) : [];
  const resolvedDefaultModelRef = defaultModelRef.length > 0
    ? defaultModelRef
    : sanitizedPresets.at(0);
  if (!resolvedDefaultModelRef) {
    throw new ConfigParseError("Model pull preset config requires at least one modelRef", {
      details: "Provide defaultModelRef or at least one presets entry in control-plane/config/model-pull-presets.json.",
    });
  }
  if (!modelRefPlaceholder) {
    throw new ConfigParseError("Model pull preset config requires modelRefPlaceholder", {
      details: "Provide modelRefPlaceholder in control-plane/config/model-pull-presets.json.",
    });
  }

  return {
    defaultModelRef: resolvedDefaultModelRef,
    presets: sanitizedPresets.length > 0 ? sanitizedPresets : [resolvedDefaultModelRef],
    modelRefPlaceholder,
  };
}

function normalizeModelSourceConfig(input: JsonInput | undefined, sourceLabel: string, index: number): ModelSourceConfigInput {
  if (!isJsonRecord(input)) {
    throw new ConfigParseError(
      `Invalid model source entry at index ${index} in ${sourceLabel}`,
      { details: "Each source entry must be a JSON object." },
    );
  }
  const id = toTrimmedString(input.id).toLowerCase();
  const displayName = toTrimmedString(input.displayName);
  const description = toTrimmedString(input.description);
  const modelRefPlaceholder = toTrimmedString(input.modelRefPlaceholder);
  const modelRefHint = toTrimmedString(input.modelRefHint);
  const canonicalHost = toTrimmedString(input.canonicalHost).toLowerCase();
  const ramalamaTransportPrefix = toTrimmedString(input.ramalamaTransportPrefix).toLowerCase();
  const modelRefValidationRaw = toTrimmedString(input.modelRefValidation).toLowerCase();
  if (!id || !displayName || !modelRefPlaceholder) {
    throw new ConfigParseError(
      `Invalid model source entry '${id || `index ${index}`}' in ${sourceLabel}`,
      { details: "Model source entries require id, displayName, and modelRefPlaceholder." },
    );
  }
  if (modelRefValidationRaw !== "huggingface" && modelRefValidationRaw !== "opaque") {
    throw new ConfigParseError(
      `Invalid modelRefValidation for source '${id}' in ${sourceLabel}`,
      { details: "Supported values are 'huggingface' and 'opaque'." },
    );
  }
  const modelRefValidation: ModelRefValidationMode = modelRefValidationRaw;

  const aliases = Array.isArray(input.aliases)
    ? input.aliases
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value) => value.length > 0 && value !== id)
    : [];
  const dedupedAliases = Array.from(new Set(aliases));
  const resolvedCanonicalHost = modelRefValidation === "huggingface"
    ? (canonicalHost || "huggingface.co")
    : undefined;

  return {
    id,
    displayName: displayName || id,
    ...(description ? { description } : {}),
    ...(modelRefPlaceholder ? { modelRefPlaceholder } : {}),
    ...(modelRefHint ? { modelRefHint } : {}),
    modelRefValidation,
    ...(resolvedCanonicalHost ? { canonicalHost: resolvedCanonicalHost } : {}),
    ...(ramalamaTransportPrefix ? { ramalamaTransportPrefix } : {}),
    aliases: dedupedAliases,
    enforceAllowlist: input.enforceAllowlist === true,
  };
}

function parseModelSourceRegistryConfig(input: JsonInput | undefined, sourceLabel: string): ModelSourceRegistryConfig {
  if (!isJsonRecord(input)) {
    throw new ConfigParseError(
      `Invalid model source registry in ${sourceLabel}`,
      { details: "Expected JSON object with a non-empty sources array." },
    );
  }

  const defaultSource = toTrimmedString(input.defaultSource).toLowerCase();
  const rawSources = Array.isArray(input.sources) ? input.sources : [];
  if (rawSources.length === 0) {
    throw new ConfigParseError(
      `Invalid model source registry in ${sourceLabel}`,
      { details: "Expected sources array with at least one entry." },
    );
  }
  const seenSourceIds = new Set<string>();
  const sources = rawSources.map((entry, index) => {
    const normalized = normalizeModelSourceConfig(entry, sourceLabel, index);
    if (seenSourceIds.has(normalized.id)) {
      throw new ConfigParseError(
        `Duplicate model source '${normalized.id}' in ${sourceLabel}`,
        { details: "Each source id must be unique." },
      );
    }
    seenSourceIds.add(normalized.id);
    return normalized;
  });

  if (defaultSource && !seenSourceIds.has(defaultSource)) {
    throw new ConfigParseError(
      `Unknown defaultSource '${defaultSource}' in ${sourceLabel}`,
      { details: "defaultSource must match one of the configured source ids." },
    );
  }

  return {
    ...(defaultSource ? { defaultSource } : {}),
    sources,
  };
}

function readModelSourceRegistryEnv(name: string): ModelSourceRegistryConfig | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    throw new ConfigParseError(`Invalid JSON for ${name}: ${parsed.error}`, { details: parsed.error });
  }
  return parseModelSourceRegistryConfig(parsed.data, name);
}

function resolveModelSourceRegistry(): ModelSourceRegistryConfig {
  const fromEnv = readModelSourceRegistryEnv("MODEL_SOURCE_REGISTRY_JSON");
  if (fromEnv) {
    return fromEnv;
  }
  return parseModelSourceRegistryConfig(canonicalModelSourceRegistryJson, "control-plane/config/model-sources.json");
}

function readProviderRegistryEnv(name: string): ProviderRegistryConfig[] | null {
  const raw = process.env[name];
  if (raw) {
    const parsed = safeParseJson<JsonValue>(raw);
    if (!parsed.ok) {
      throw new ConfigParseError(`Invalid JSON for ${name}: ${parsed.error}`, { details: parsed.error });
    }
    return parseProviderRegistryConfig(parsed.data, name);
  }
  return null;
}

function resolveProviderRegistry(): ProviderRegistryConfig[] {
  const fromEnv = readProviderRegistryEnv("AI_PROVIDER_REGISTRY_JSON");
  if (fromEnv) {
    return fromEnv;
  }
  return parseProviderRegistryConfig(canonicalProviderRegistryJson, "control-plane/config/providers.json");
}

function normalizeProviderConfig(input: JsonInput | undefined, sourceLabel: string, index: number): ProviderRegistryConfig {
  if (!isJsonRecord(input)) {
    throw new ConfigParseError(
      `Invalid provider registry entry at index ${index} in ${sourceLabel}`,
      { details: "Each provider entry must be a JSON object." },
    );
  }
  const id = toTrimmedString(input.id).toLowerCase();
  const displayName = toTrimmedString(input.displayName);
  const baseUrl = toTrimmedString(input.baseUrl);
  const docsUrl = toTrimmedString(input.docsUrl);
  const requiresKey = input.requiresKey === true;
  const defaultModels = Array.isArray(input.defaultModels)
    ? input.defaultModels.map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
    : [];

  if (!id || !displayName || !baseUrl || !docsUrl) {
    throw new ConfigParseError(
      `Invalid provider registry entry '${id || `index ${index}`}' in ${sourceLabel}`,
      { details: "Provider entries require id, displayName, baseUrl, and docsUrl." },
    );
  }

  const keyHint = typeof input.keyHint === "string" ? input.keyHint.trim() : undefined;
  const hasBaseUrlConfig = input.hasBaseUrlConfig === true;

  return {
    id,
    displayName,
    baseUrl,
    requiresKey,
    defaultModels,
    docsUrl,
    ...(keyHint ? { keyHint } : {}),
    ...(hasBaseUrlConfig ? { hasBaseUrlConfig } : {}),
  };
}

function parseProviderRegistryConfig(input: JsonInput | undefined, sourceLabel: string): ProviderRegistryConfig[] {
  if (!Array.isArray(input)) {
    throw new ConfigParseError(
      `Invalid provider registry in ${sourceLabel}`,
      { details: "Expected JSON array of providers." },
    );
  }
  if (input.length === 0) {
    throw new ConfigParseError(
      `Invalid provider registry in ${sourceLabel}`,
      { details: "Provider registry must contain at least one provider." },
    );
  }
  const seenProviderIds = new Set<string>();
  return input.map((entry, index) => {
    const normalized = normalizeProviderConfig(entry, sourceLabel, index);
    if (seenProviderIds.has(normalized.id)) {
      throw new ConfigParseError(
        `Duplicate provider '${normalized.id}' in ${sourceLabel}`,
        { details: "Each provider id must be unique." },
      );
    }
    seenProviderIds.add(normalized.id);
    return normalized;
  });
}

const MODEL_SOURCE_REGISTRY_CONFIG = resolveModelSourceRegistry();

function buildModelSourceRegistry(sources: readonly ModelSourceConfigInput[]): ModelSourceConfig[] {
  const seen = new Set<string>();
  const out: ModelSourceConfig[] = [];
  for (const source of sources) {
    const id = source.id.trim().toLowerCase();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      displayName: source.displayName.trim() || id,
      ...(source.description ? { description: source.description.trim() } : {}),
      modelRefPlaceholder: source.modelRefPlaceholder?.trim() || source.displayName.trim() || id,
      ...(source.modelRefHint ? { modelRefHint: source.modelRefHint.trim() } : {}),
      modelRefValidation: source.modelRefValidation,
      ...(source.canonicalHost ? { canonicalHost: source.canonicalHost.trim().toLowerCase() } : {}),
      ...(source.ramalamaTransportPrefix
        ? { ramalamaTransportPrefix: source.ramalamaTransportPrefix.trim().toLowerCase() }
        : {}),
      aliases: source.aliases ?? [],
      enforceAllowlist: source.enforceAllowlist === true,
    });
  }
  if (out.length === 0) {
    throw new ConfigParseError("Model source registry is empty", {
      details: "At least one model source must be configured.",
    });
  }
  return out;
}

/** Canonical model-source registry used by model pull forms and validation. */
export const MODEL_SOURCE_REGISTRY: readonly ModelSourceConfig[] = buildModelSourceRegistry(
  MODEL_SOURCE_REGISTRY_CONFIG.sources,
);

const MODEL_SOURCE_LOOKUP = new Map<string, ModelSource>();
for (const source of MODEL_SOURCE_REGISTRY) {
  MODEL_SOURCE_LOOKUP.set(source.id, source.id);
  for (const alias of source.aliases) {
    MODEL_SOURCE_LOOKUP.set(alias.trim().toLowerCase(), source.id);
  }
}

function resolveKnownModelSourceId(raw: string): ModelSource | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return MODEL_SOURCE_LOOKUP.get(normalized) ?? null;
}

/** Return the typed descriptor for a known source, or `null` if not configured. */
export function findModelSourceConfig(source: string | null | undefined): ModelSourceConfig | null {
  const resolvedId = normalizeModelSourceId(source);
  return MODEL_SOURCE_REGISTRY.find((entry) => entry.id === resolvedId) ?? null;
}

function resolveDefaultModelSource(): ModelSource {
  const envDefault = readStringEnv("DEFAULT_MODEL_SOURCE", "");
  const configured = resolveKnownModelSourceId(envDefault);
  if (configured) {
    return configured;
  }
  const fromRegistry = MODEL_SOURCE_REGISTRY_CONFIG.defaultSource
    ? resolveKnownModelSourceId(MODEL_SOURCE_REGISTRY_CONFIG.defaultSource)
    : null;
  if (fromRegistry) {
    return fromRegistry;
  }
  const configuredSource = MODEL_SOURCE_REGISTRY.at(0)?.id;
  if (!configuredSource) {
    throw new ConfigParseError("Model source registry is empty", { details: "No model sources are configured." });
  }
  return configuredSource;
}

/** Default model source for pull requests. */
export const DEFAULT_MODEL_SOURCE: ModelSource = resolveDefaultModelSource();
/** Fallback source list when no override is supplied. */
export const MODEL_SOURCE_DEFAULTS = MODEL_SOURCE_REGISTRY.map((source) => source.id);

/** Resolve a model source id from user input, aliases, and defaults. */
export function normalizeModelSourceId(source: string | null | undefined): ModelSource {
  if (!source) {
    return DEFAULT_MODEL_SOURCE;
  }
  const normalized = source.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_MODEL_SOURCE;
  }
  return resolveKnownModelSourceId(normalized) ?? normalized;
}

/**
 * Resolve a user-provided model source to a configured, known source id.
 * Returns `null` when the candidate is not part of the configured registry.
 */
export function parseKnownModelSourceId(rawSource: string): ModelSource | null {
  const normalized = normalizeModelSourceId(rawSource);
  return findModelSourceConfig(normalized) ? normalized : null;
}

/** Resolve typed model-source config from optional source input. */
export function resolveModelSourceConfig(source: string | null | undefined): ModelSourceConfig {
  const resolvedId = normalizeModelSourceId(source);
  const knownConfig = findModelSourceConfig(resolvedId);
  if (!knownConfig) {
    throw new ConfigParseError("Unknown model source", {
      details: `Source '${(source ?? "").trim() || DEFAULT_MODEL_SOURCE}' is not configured.`,
    });
  }
  return knownConfig;
}

/** Build a `ModelRefValidationPolicy` for source-specific model-ref normalization. */
export function getModelSourceValidationPolicy(source: string | null | undefined): ModelRefValidationPolicy {
  const config = resolveModelSourceConfig(source);
  return {
    mode: config.modelRefValidation,
    ...(config.canonicalHost ? { canonicalHost: config.canonicalHost } : {}),
  };
}

/** Default AI provider registry. Loaded from control-plane/config/providers.json at startup; overridden by AI_PROVIDER_REGISTRY_JSON env. */
export const PROVIDER_REGISTRY = resolveProviderRegistry();

const MODEL_PULL_PRESET_CONFIG = parseModelPullPresetConfig(canonicalModelPullPresetConfigJson);

/** Fallback model presets for pull UI and default model preference values. */
export const MODEL_PULL_PRESETS = readStringArrayEnv("MODEL_PULL_PRESETS", MODEL_PULL_PRESET_CONFIG.presets);
/** Default fallback model ref for pull requests when no explicit default override is supplied. */
export const MODEL_PULL_PRESET_DEFAULT = MODEL_PULL_PRESET_CONFIG.defaultModelRef;
const DEFAULT_MODEL_SOURCE_PLACEHOLDER = resolveModelSourceConfig(DEFAULT_MODEL_SOURCE).modelRefPlaceholder;
/** Configurable UI placeholder for model-ref inputs. */
export const MODEL_PULL_MODEL_REF_PLACEHOLDER = readStringEnv(
  "MODEL_PULL_MODEL_REF_PLACEHOLDER",
  MODEL_PULL_PRESET_CONFIG.modelRefPlaceholder || DEFAULT_MODEL_SOURCE_PLACEHOLDER,
);

const DEVICE_AI_PROFILE_CONFIG = await readDeviceAiProfileFile(DEVICE_AI_PROFILE_CONFIG_PATH);

/** Required model reference for device AI protocol runs. */
export const VERTU_REQUIRED_MODEL_REF = readStringEnv(
  "VERTU_REQUIRED_MODEL_REF",
  DEVICE_AI_PROFILE_CONFIG.requiredModelRef || MODEL_PULL_PRESET_DEFAULT,
);

/** Required revision pin for device AI protocol model pulls. */
export const VERTU_REQUIRED_MODEL_REVISION = readStringEnv(
  "VERTU_REQUIRED_MODEL_REVISION",
  DEVICE_AI_PROFILE_CONFIG.revision,
);

/** Required model file for device AI protocol downloads. */
export const VERTU_REQUIRED_MODEL_FILE = readStringEnv(
  "VERTU_REQUIRED_MODEL_FILE",
  DEVICE_AI_PROFILE_CONFIG.requiredModelFile,
);

/** Required model SHA-256 for device AI protocol downloads. */
export const VERTU_REQUIRED_MODEL_SHA256 = readStringEnv(
  "VERTU_REQUIRED_MODEL_SHA256",
  DEVICE_AI_PROFILE_CONFIG.requiredModelSha256,
);

/** Timeout budget in milliseconds for device AI protocol stages. */
export const VERTU_DEVICE_AI_PROTOCOL_TIMEOUT_MS = readPositiveIntEnv(
  "VERTU_DEVICE_AI_PROTOCOL_TIMEOUT_MS",
  DEVICE_AI_PROFILE_CONFIG.protocolTimeoutMs,
);

/** Maximum age (minutes) accepted by device AI readiness audit for latest report. */
export const VERTU_DEVICE_AI_REPORT_MAX_AGE_MINUTES = readPositiveIntEnv(
  "VERTU_DEVICE_AI_REPORT_MAX_AGE_MINUTES",
  DEVICE_AI_PROFILE_CONFIG.reportMaxAgeMinutes,
);

/** Effective device AI protocol profile after env overrides are applied. */
export const DEVICE_AI_PROTOCOL_PROFILE: DeviceAiProtocolProfile = {
  ...DEVICE_AI_PROFILE_CONFIG,
  requiredModelRef: VERTU_REQUIRED_MODEL_REF,
  revision: VERTU_REQUIRED_MODEL_REVISION,
  requiredModelFile: VERTU_REQUIRED_MODEL_FILE,
  requiredModelSha256: VERTU_REQUIRED_MODEL_SHA256,
  protocolTimeoutMs: VERTU_DEVICE_AI_PROTOCOL_TIMEOUT_MS,
  reportMaxAgeMinutes: VERTU_DEVICE_AI_REPORT_MAX_AGE_MINUTES,
};

/** Configurable model source options for pull request forms. */
export const MODEL_PULL_SOURCES = (() => {
  const requested = readStringArrayEnv("MODEL_PULL_SOURCES", MODEL_SOURCE_DEFAULTS);
  const deduped: ModelSource[] = [];
  const seen = new Set<string>();
  for (const source of requested) {
    const normalized = resolveKnownModelSourceId(source);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }
  return deduped.length > 0 ? deduped : [DEFAULT_MODEL_SOURCE];
})();

const configuredChatModel = readStringEnv("DEFAULT_CHAT_MODEL", "");
const configuredPullModel = readStringEnv("DEFAULT_CHAT_PULL_MODEL", "");
const configuredFlowRunAttempts = readStringEnv("FLOW_RUN_MAX_ATTEMPTS", "");
const configuredFlowRunCommandTimeout = readStringEnv("FLOW_RUN_COMMAND_TIMEOUT_MS", "");
const configuredFlowRunRetryDelay = readStringEnv("FLOW_RUN_RETRY_DELAY_MS", "");

/** Fallback theme used by initial DB bootstrap and UI hydration. */
export const DEFAULT_THEME = "dark";

/** Supported theme preferences — Vertu-branded themes only. */
export const SUPPORTED_THEMES = [
  "dark", "light", "luxury",
] as const;

/** Default pull target used by `/api/models/pull` when no modelRef is supplied. */
export const DEFAULT_CHAT_PULL_MODEL = configuredPullModel.length > 0
  ? configuredPullModel
  : MODEL_PULL_PRESET_DEFAULT;

/** Default max attempts for flow automation commands. */
export const FLOW_RUN_MAX_ATTEMPTS = configuredFlowRunAttempts.length > 0
  ? Math.max(1, Number.parseInt(configuredFlowRunAttempts, 10) || 2)
  : 2;

/** Default command execution timeout for flow automation commands. */
export const FLOW_RUN_COMMAND_TIMEOUT_MS = configuredFlowRunCommandTimeout.length > 0
  ? Math.max(1_000, Number.parseInt(configuredFlowRunCommandTimeout, 10) || 20_000)
  : 20_000;

/** Default retry backoff for flow automation command failures. */
export const FLOW_RUN_RETRY_DELAY_MS = configuredFlowRunRetryDelay.length > 0
  ? Math.max(100, Number.parseInt(configuredFlowRunRetryDelay, 10) || 250)
  : 250;

/** Resolved default chat model from environment and provider registry. */
export const DEFAULT_CHAT_MODEL = configuredChatModel.length > 0
  ? configuredChatModel
  : deriveDefaultChatModel(PROVIDER_REGISTRY);

function deriveDefaultChatModel(providerRegistry: readonly ProviderRegistryConfig[]): string {
  // Prioritize the default model source (e.g. "huggingface" from model-sources.json)
  const defaultSourceId = MODEL_SOURCE_REGISTRY_CONFIG.defaultSource?.toLowerCase();
  if (defaultSourceId) {
    const matchingProvider = providerRegistry.find((p) => p.id.toLowerCase() === defaultSourceId);
    const sourceModel = matchingProvider?.defaultModels.at(0)?.trim();
    if (sourceModel) return sourceModel;
  }
  for (const provider of providerRegistry) {
    const configuredDefaultModel = provider.defaultModels.at(0)?.trim();
    if (configuredDefaultModel) {
      return configuredDefaultModel;
    }
  }
  throw new ConfigParseError("No provider default models are configured", {
    details: "Configure at least one defaultModels entry in control-plane/config/providers.json or set DEFAULT_CHAT_MODEL.",
  });
}

/** Default Ollama API base URL used when no provider override is configured. */
export const OLLAMA_DEFAULT_BASE_URL = readStringEnv(
  "OLLAMA_DEFAULT_BASE_URL",
  PROVIDER_REGISTRY.find((provider) => provider.id === "ollama")?.baseUrl.trim()
    ?? (() => {
      throw new ConfigParseError("Ollama provider is not configured", {
        details: "Configure an 'ollama' entry in control-plane/config/providers.json or set OLLAMA_DEFAULT_BASE_URL.",
      });
    })(),
);

/** OpenRouter referer header used for request attribution. */
export const OPENROUTER_HTTP_REFERER = readStringEnv("OPENROUTER_HTTP_REFERER", "https://vertu-edge.local");

/** OpenRouter request title header used for request attribution. */
export const OPENROUTER_APP_TITLE = readStringEnv("OPENROUTER_APP_TITLE", "Vertu Edge Control Plane");

/** Timeout for UCP discovery fetch calls. */
export const UCP_DISCOVERY_TIMEOUT_MS = readPositiveIntEnv("UCP_DISCOVERY_TIMEOUT_MS", 5_000);

/** Maximum retry attempts for outbound AI HTTP requests after the initial attempt. */
export const AI_HTTP_MAX_RETRIES = readPositiveIntEnv("AI_HTTP_MAX_RETRIES", 2);

/** Initial retry backoff delay (ms) for outbound AI HTTP requests. */
export const AI_HTTP_RETRY_BASE_DELAY_MS = readPositiveIntEnv("AI_HTTP_RETRY_BASE_DELAY_MS", 250);

/** Maximum retry backoff delay (ms) for outbound AI HTTP requests. */
export const AI_HTTP_RETRY_MAX_DELAY_MS = readPositiveIntEnv("AI_HTTP_RETRY_MAX_DELAY_MS", 2_000);

/** Timeout for reading response body after HTTP response headers arrive (ms). */
export const RESPONSE_BODY_READ_TIMEOUT_MS = readPositiveIntEnv("AI_RESPONSE_BODY_READ_TIMEOUT_MS", 30_000);

/** SSE log stream poll interval between batches (ms). */
export const SSE_POLL_INTERVAL_MS = 500;

/** Delay before auto-triggering provider validation on page load (ms). */
export const AUTO_VALIDATION_DELAY_MS = 100;

/** Maximum length for user-entered model identifiers. */
export const MODEL_IDENTIFIER_MAX_LENGTH = 256;

/** Maximum display length for sanitized API error messages. */
export const ERROR_DISPLAY_MAX_LENGTH = 120;

/** Truncation suffix offset for display errors (max - offset = slice point). */
export const ERROR_DISPLAY_TRUNCATION_OFFSET = 3;

/** Error message when OpenAI-compatible response has no content. */
export const AI_CHAT_NO_CONTENT_ERROR = "No content in response" as const;

/** Error message when Anthropic response has no text block. */
export const AI_ANTHROPIC_NO_TEXT_ERROR = "No text content in Anthropic response" as const;

/** Success message for image generation results. */
export const AI_IMAGE_GENERATED_MESSAGE = "Image generated successfully." as const;

/** Maximum number of in-memory cached job results (flow runs + workflow results). */
export const MAX_CACHED_JOB_RESULTS = 500;

/** Maximum number of conversation history messages to include in multi-turn chat context. */
export const MAX_CONVERSATION_HISTORY_MESSAGES = 20;

/** Starter flow templates for the saved flows library. */
export const FLOW_TEMPLATES: ReadonlyArray<{ name: string; description: string; yaml: string }> = [
  {
    name: "Tap element by text",
    description: "Tap an element identified by its visible text label.",
    yaml: `appId: com.example.app
---
- tapOn:
    text: "Submit"
`,
  },
  {
    name: "Scroll and assert",
    description: "Scroll down and verify an element is visible.",
    yaml: `appId: com.example.app
---
- scroll
- assertVisible:
    text: "Welcome"
`,
  },
  {
    name: "Launch and navigate",
    description: "Launch an app and navigate through multiple screens.",
    yaml: `appId: com.example.app
---
- launchApp
- tapOn:
    text: "Settings"
- tapOn:
    text: "Account"
`,
  },
  {
    name: "Screenshot test",
    description: "Take a screenshot for visual regression testing.",
    yaml: `appId: com.example.app
---
- launchApp
- takeScreenshot: "home_screen"
`,
  },
];

/** Output directory for persisted AI workflow artifacts. */
export const AI_WORKFLOW_ARTIFACT_DIR = readStringEnv(
  "AI_WORKFLOW_ARTIFACT_DIR",
  join(import.meta.dir, "..", "artifacts", "ai-workflows"),
);

/** Default image model for local Ollama image generation path. */
export const AI_WORKFLOW_LOCAL_IMAGE_MODEL = readStringEnv("AI_WORKFLOW_LOCAL_IMAGE_MODEL", "gpt-image");

/** Default image model for Hugging Face fallback path. */
export const AI_WORKFLOW_HF_IMAGE_MODEL = readStringEnv(
  "AI_WORKFLOW_HF_IMAGE_MODEL",
  "black-forest-labs/FLUX.1-schnell",
);

/** Base URL for Hugging Face image generation fallback requests. */
export const AI_WORKFLOW_HF_IMAGE_BASE_URL = readStringEnv(
  "AI_WORKFLOW_HF_IMAGE_BASE_URL",
  "https://api-inference.huggingface.co/models",
);

/** Resolve the control-plane listen port from environment variables with hardening. */
export function resolveControlPlanePort(): number {
  const candidate = CONTROL_PLANE_PORT_KEYS
    .map((key) => process.env[key]?.trim())
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (!candidate) {
    return CONTROL_PLANE_DEFAULT_PORT;
  }
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed < CONTROL_PLANE_MIN_PORT || parsed > CONTROL_PLANE_MAX_PORT) {
    return CONTROL_PLANE_DEFAULT_PORT;
  }
  return parsed;
}

/** Supported server response states used by rendered UI envelopes. */
export type ControlPlaneState = SharedControlPlaneState;
