/** Shared control-plane runtime configuration constants. */

import { ConfigParseError } from "./errors";
import { join } from "path";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import {
  CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE,
  CHAT_TTS_OUTPUT_MIME_TYPES,
} from "../../contracts/flow-contracts";
import type {
  BuildKind,
  BuildType,
  ControlPlaneState as SharedControlPlaneState,
  FlowRunTarget,
  ModelRefValidationMode,
  ModelRefValidationPolicy,
  ModelSource,
  ChatTtsOutputMimeType,
} from "../../contracts/flow-contracts";
/** Strict JSON scalar type used for config/runtime decoding. */
export type JsonScalar = string | number | boolean | null;
/** Strict JSON object type used for config/runtime decoding. */
export type JsonRecord = { [key: string]: JsonValue };
/** Strict JSON value used instead of opaque `unknown` types. */
export type JsonValue = JsonScalar | JsonRecord | JsonValue[];

/** Result of a safe JSON parse. Avoids try/catch in callers. */
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Parse JSON without throwing. Returns Result for explicit error handling. */
export function safeParseJson<T extends JsonValue>(raw: string): ParseResult<T> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Empty input" };
  }
  const errors: ParseError[] = [];
  const decoded = parseJsonc(trimmed, errors, { allowTrailingComma: false, disallowComments: true }) as JsonValue;
  if (errors.length > 0) {
    const firstError = errors[0];
    if (!firstError) {
      return { ok: false, error: "JSON parse error: invalid payload" };
    }
    const parseCode = printParseErrorCode(firstError.error);
    return { ok: false, error: `JSON parse error: ${parseCode} at offset ${firstError.offset}` };
  }
  if (decoded === null || typeof decoded === "string" || typeof decoded === "number" || typeof decoded === "boolean") {
    return { ok: true, data: decoded as T };
  }
  if (Array.isArray(decoded)) {
    return { ok: true, data: decoded as T };
  }
  if (typeof decoded === "object" && decoded !== null) {
    return { ok: true, data: decoded as T };
  }
  return { ok: false, error: "Invalid JSON structure" };
}

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

const SAFE_DEFAULT_CHAT_MODEL = "gpt-4o-mini";
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
export const SUPPORTED_BUILD_TYPES = ["debug", "release"] as const;
/** Default flow script scroll step count when omitted. */
export const FLOW_ENGINE_SCROLL_STEP_DEFAULT = 1;
/** Default flow script swipe distance fraction when omitted. */
export const FLOW_ENGINE_SWIPE_DISTANCE_FRACTION_DEFAULT = 0.5;
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
/** Reason when iOS build is attempted on non-macOS. */
export const APP_BUILD_IOS_MAC_ONLY_REASON = "iOS build is only supported on macOS hosts.";
/** Reason when iOS toolchain is unavailable. */
export const APP_BUILD_IOS_TOOLING_MISSING_REASON = "iOS build requires Xcode build tooling on this host.";
/** Reason when no buildable iOS app scheme is configured. */
export const APP_BUILD_IOS_SCHEME_MISSING_REASON = "iOS build requires at least one shared Xcode app scheme.";
/** Reason when the requested iOS app scheme is not configured. */
export const APP_BUILD_IOS_SCHEME_NOT_FOUND_REASON = "The requested iOS scheme is not available.";
/** Reason when outputDir traverses parent directories. */
export const APP_BUILD_OUTPUT_DIR_TRAVERSE_REASON = "outputDir must not traverse parent directories.";
/** Message when build completes successfully. */
export const APP_BUILD_SUCCESS_MESSAGE = "Build completed successfully";
/** Fallback message when app build process fails. */
export const APP_BUILD_FAILURE_FALLBACK_MESSAGE = "App build process failed.";
/** Provider request timeout for model/list + chat compatibility calls. */
export const AI_PROVIDER_REQUEST_TIMEOUT_MS = readPositiveIntEnv("AI_PROVIDER_REQUEST_TIMEOUT_MS", 8_000);
/** Shared chat max token cap for provider completions. */
export const AI_CHAT_MAX_TOKENS = readPositiveIntEnv("AI_CHAT_MAX_TOKENS", 2_048);
/** Maximum timeout for model pull requests. */
export const MAX_MODEL_PULL_TIMEOUT_MS = readPositiveIntEnv("MODEL_PULL_TIMEOUT_MAX_MS", 24 * 60 * 60 * 1000);
/** Rate limit window for chat completions (ms). */
export const CHAT_RATE_LIMIT_WINDOW_MS = readPositiveIntEnv("CHAT_RATE_LIMIT_WINDOW_MS", 1_000);
/** Maximum allowed YAML body size for flow submission (bytes). */
export const MAX_YAML_BYTES = readPositiveIntEnv("MAX_YAML_BYTES", 64 * 1024);
/** Default flow adapter command timeout (ms). */
export const FLOW_ADAPTER_COMMAND_TIMEOUT_MS = readPositiveIntEnv("FLOW_ADAPTER_COMMAND_TIMEOUT_MS", 10_000);
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

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function readStringEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readStringArrayEnv(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return [...fallback];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [...fallback];
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed = safeParseJson<JsonValue>(trimmed);
    if (!parsed.ok) return [...fallback];
    const decoded = parsed.data;
    if (!Array.isArray(decoded)) return [...fallback];
    const values = decoded
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
    return values.length > 0 ? values : [...fallback];
  }

  const values = trimmed
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : [...fallback];
}

function sanitizeModelPullPreset(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

const FALLBACK_MODEL_PULL_PRESET_PLACEHOLDER = "owner/repo";

function parseModelPullPresetConfig(input: JsonValue): ModelPullPresetConfig {
  const fallback = {
    defaultModelRef: SAFE_DEFAULT_CHAT_MODEL,
    presets: [SAFE_DEFAULT_CHAT_MODEL],
    modelRefPlaceholder: FALLBACK_MODEL_PULL_PRESET_PLACEHOLDER,
  } as const;

  if (!isJsonRecord(input)) {
    return fallback;
  }

  const defaultModelRef = sanitizeModelPullPreset(input.defaultModelRef);
  const modelRefPlaceholder = sanitizeModelPullPreset(input.modelRefPlaceholder);
  const presets = Array.isArray(input.presets)
    ? input.presets.map(sanitizeModelPullPreset).filter((value) => value.length > 0)
    : [];

  const sanitizedPresets = presets.length > 0 ? Array.from(new Set(presets)) : [];
  const resolvedDefaultModelRef = defaultModelRef.length > 0
    ? defaultModelRef
    : sanitizedPresets.at(0) ?? fallback.defaultModelRef;

  return {
    defaultModelRef: resolvedDefaultModelRef,
    presets: sanitizedPresets.length > 0 ? sanitizedPresets : fallback.presets,
    modelRefPlaceholder: modelRefPlaceholder.length > 0 ? modelRefPlaceholder : fallback.modelRefPlaceholder,
  };
}

async function readModelPullPresetFile(path: string): Promise<ModelPullPresetConfig> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new ConfigParseError(
      `Model pull preset file is missing at '${path}'`,
      { details: "Missing control-plane config file." },
    );
  }

  const raw = await file.text();
  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    throw new ConfigParseError(`Failed to parse model pull preset JSON from '${path}': ${parsed.error}`, {
      details: parsed.error,
    });
  }

  return parseModelPullPresetConfig(parsed.data);
}

function normalizeModelSourceConfig(input: JsonValue): ModelSourceConfigInput | null {
  if (!isJsonRecord(input)) {
    return null;
  }
  const id = toTrimmedString(input.id).toLowerCase();
  if (!id) {
    return null;
  }

  const displayName = toTrimmedString(input.displayName);
  const description = toTrimmedString(input.description);
  const modelRefPlaceholder = toTrimmedString(input.modelRefPlaceholder);
  const modelRefHint = toTrimmedString(input.modelRefHint);
  const canonicalHost = toTrimmedString(input.canonicalHost).toLowerCase();
  const ramalamaTransportPrefix = toTrimmedString(input.ramalamaTransportPrefix).toLowerCase();
  const modelRefValidationRaw = toTrimmedString(input.modelRefValidation).toLowerCase();
  const modelRefValidation: ModelRefValidationMode = modelRefValidationRaw === "huggingface" ? "huggingface" : "opaque";

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

function parseModelSourceRegistryConfig(input: JsonValue): ModelSourceRegistryConfig | null {
  if (Array.isArray(input)) {
    const sources = input
      .map((entry) => normalizeModelSourceConfig(entry))
      .filter((entry): entry is ModelSourceConfigInput => entry !== null);
    return sources.length > 0 ? { sources } : null;
  }

  if (!isJsonRecord(input)) {
    return null;
  }

  const defaultSource = toTrimmedString(input.defaultSource).toLowerCase();
  const rawSources = Array.isArray(input.sources) ? input.sources : [];
  const sources = rawSources
    .map((entry) => normalizeModelSourceConfig(entry))
    .filter((entry): entry is ModelSourceConfigInput => entry !== null);

  if (sources.length === 0) {
    return null;
  }

  return {
    ...(defaultSource ? { defaultSource } : {}),
    sources,
  };
}

async function loadModelSourceRegistryFromFile(path: string): Promise<ModelSourceRegistryConfig | null> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    return null;
  }
  const raw = await file.text();
  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    throw new ConfigParseError(
      `Failed to parse model source registry JSON from file '${path}': ${parsed.error}`,
      { details: parsed.error },
    );
  }

  const normalized = parseModelSourceRegistryConfig(parsed.data);
  if (!normalized) {
    throw new ConfigParseError(
      `Invalid model source registry payload in file '${path}'`,
      { details: "Expected sources array with at least one entry" },
    );
  }
  return normalized;
}

async function readModelSourceRegistryEnv(name: string): Promise<ModelSourceRegistryConfig | null> {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    throw new ConfigParseError(`Invalid JSON for ${name}: ${parsed.error}`, { details: parsed.error });
  }
  const normalized = parseModelSourceRegistryConfig(parsed.data);
  if (!normalized) {
    throw new ConfigParseError(
      `Invalid value for ${name}: expected model source config with non-empty sources`,
      { details: "Expected sources array with at least one entry" },
    );
  }
  return normalized;
}

async function resolveModelSourceRegistry(
  fallback: ModelSourceRegistryConfig,
): Promise<ModelSourceRegistryConfig> {
  const fromEnv = await readModelSourceRegistryEnv("MODEL_SOURCE_REGISTRY_JSON");
  if (fromEnv && fromEnv.sources.length > 0) {
    return fromEnv;
  }

  const configDir = join(import.meta.dir, "..", "config");
  const filePath = join(configDir, "model-sources.json");
  const fromFile = await loadModelSourceRegistryFromFile(filePath);
  if (fromFile && fromFile.sources.length > 0) {
    return fromFile;
  }

  return fallback;
}

async function loadProviderRegistryFromFile(path: string): Promise<ProviderRegistryConfig[]> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    return [];
  }
  const raw = await file.text();
  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    throw new ConfigParseError(
      `Failed to parse provider registry JSON from file '${path}': ${parsed.error}`,
      { details: parsed.error },
    );
  }
  if (!Array.isArray(parsed.data)) {
    throw new ConfigParseError(
      `Invalid provider registry payload in file '${path}': expected JSON array`,
      { details: "Expected JSON array" },
    );
  }

  const filtered = parsed.data
    .map((entry) => normalizeProviderConfig(entry))
    .filter((entry): entry is ProviderRegistryConfig => entry !== null);
  if (filtered.length === 0) {
    return [];
  }
  return filtered;
}

async function readProviderRegistryEnv(name: string): Promise<ProviderRegistryConfig[] | null> {
  const raw = process.env[name];
  if (raw) {
    const parsed = safeParseJson<JsonValue>(raw);
    if (!parsed.ok) {
      throw new ConfigParseError(`Invalid JSON for ${name}: ${parsed.error}`, { details: parsed.error });
    }
    if (!Array.isArray(parsed.data)) {
      throw new ConfigParseError(
        `Invalid value for ${name}: expected JSON array of providers`,
        { details: "Expected JSON array" },
      );
    }

    const filtered = parsed.data
      .map((entry) => normalizeProviderConfig(entry))
      .filter((entry): entry is ProviderRegistryConfig => entry !== null);
    if (filtered.length > 0) {
      return filtered;
    }
    throw new ConfigParseError(`No valid provider entries found in ${name}`, { details: "No valid providers" });
  }
  return null;
}

async function resolveProviderRegistry(fallback: readonly ProviderRegistryConfig[]): Promise<ProviderRegistryConfig[]> {
  const fromEnv = await readProviderRegistryEnv("AI_PROVIDER_REGISTRY_JSON");
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }

  const configDir = join(import.meta.dir, "..", "config");
  const filePath = join(configDir, "providers.json");
  const fromFile = await loadProviderRegistryFromFile(filePath);
  if (fromFile.length > 0) {
    return fromFile;
  }

  return [...fallback];
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeProviderConfig(input: JsonValue): ProviderRegistryConfig | null {
  if (!isJsonRecord(input)) {
    return null;
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
    return null;
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

function toTrimmedString(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString().trim();
  }
  return "";
}

const MODEL_SOURCE_REGISTRY_FALLBACK: ModelSourceRegistryConfig = {
  sources: [
    {
      id: "huggingface",
      displayName: "Hugging Face",
      description: "Remote models from huggingface.co repositories.",
      modelRefPlaceholder: "owner/repo or huggingface.co/owner/repo",
      modelRefHint: "Format: owner/repo or huggingface.co/owner/repo",
      modelRefValidation: "huggingface",
      canonicalHost: "huggingface.co",
      ramalamaTransportPrefix: "huggingface://",
      aliases: ["hf"],
      enforceAllowlist: true,
    },
    {
      id: "ollama",
      displayName: "Ollama",
      description: "Local/remote Ollama model library (for example llama3.2).",
      modelRefPlaceholder: "llama3.2",
      modelRefHint: "Use an Ollama model tag, for example llama3.2 or mistral:7b.",
      modelRefValidation: "opaque",
      ramalamaTransportPrefix: "ollama://",
      aliases: [],
      enforceAllowlist: false,
    },
  ],
};
const FALLBACK_MODEL_SOURCE_ID: ModelSource = MODEL_SOURCE_REGISTRY_FALLBACK.sources[0]?.id ?? "";

const MODEL_SOURCE_REGISTRY_CONFIG = await resolveModelSourceRegistry(MODEL_SOURCE_REGISTRY_FALLBACK);

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
      modelRefPlaceholder: source.modelRefPlaceholder?.trim() || "owner/repo",
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
  return out.length > 0
    ? out
    : buildModelSourceRegistry(MODEL_SOURCE_REGISTRY_FALLBACK.sources);
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
  const fallbackSource = MODEL_SOURCE_REGISTRY.at(0)?.id ?? FALLBACK_MODEL_SOURCE_ID;
  if (fallbackSource) {
    return fallbackSource;
  }
  throw new ConfigParseError("Model source registry is empty", { details: "No model sources are configured." });
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
    canonicalHost: config.canonicalHost,
  };
}

/** Minimal fallback when config/providers.json is missing and AI_PROVIDER_REGISTRY_JSON is unset. */
const PROVIDER_REGISTRY_FALLBACK: ProviderRegistryConfig[] = [
  {
    id: "ollama",
    displayName: "Ollama",
    baseUrl: "http://localhost:11434",
    requiresKey: false,
    defaultModels: [],
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md",
  },
];

/** Default AI provider registry. Loaded from config/providers.json at startup; overridden by AI_PROVIDER_REGISTRY_JSON env. */
export const PROVIDER_REGISTRY = await resolveProviderRegistry(PROVIDER_REGISTRY_FALLBACK);

const MODEL_PULL_PRESET_CONFIG_PATH = join(import.meta.dir, "..", "config", "model-pull-presets.json");
const MODEL_PULL_PRESET_CONFIG = await readModelPullPresetFile(MODEL_PULL_PRESET_CONFIG_PATH);

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

/** Legacy alias retained for compatibility with existing render paths. */
export const AUTOGLM_MODEL_PRESETS: readonly string[] = MODEL_PULL_PRESETS;

const configuredChatModel = readStringEnv("DEFAULT_CHAT_MODEL", "");
const configuredPullModel = readStringEnv("DEFAULT_CHAT_PULL_MODEL", "");
const configuredFlowRunAttempts = readStringEnv("FLOW_RUN_MAX_ATTEMPTS", "");
const configuredFlowRunCommandTimeout = readStringEnv("FLOW_RUN_COMMAND_TIMEOUT_MS", "");
const configuredFlowRunRetryDelay = readStringEnv("FLOW_RUN_RETRY_DELAY_MS", "");

/** Fallback theme used by initial DB bootstrap and UI hydration. */
export const DEFAULT_THEME = "dark";

/** Supported theme preferences. */
export const SUPPORTED_THEMES = ["dark", "light", "luxury"] as const;

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
  for (const provider of providerRegistry) {
    const fallback = provider.defaultModels.at(0)?.trim();
    if (fallback) {
      return fallback;
    }
  }
  return SAFE_DEFAULT_CHAT_MODEL;
}

/** Default Ollama API base URL used when no provider override is configured. */
export const OLLAMA_DEFAULT_BASE_URL = readStringEnv("OLLAMA_DEFAULT_BASE_URL", "http://localhost:11434");

/** OpenRouter referer header used for request attribution. */
export const OPENROUTER_HTTP_REFERER = readStringEnv("OPENROUTER_HTTP_REFERER", "https://vertu-edge.local");

/** OpenRouter request title header used for request attribution. */
export const OPENROUTER_APP_TITLE = readStringEnv("OPENROUTER_APP_TITLE", "Vertu Edge Control Plane");

/** Timeout for UCP discovery fetch calls. */
export const UCP_DISCOVERY_TIMEOUT_MS = readPositiveIntEnv("UCP_DISCOVERY_TIMEOUT_MS", 5_000);

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
