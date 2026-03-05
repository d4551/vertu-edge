import { join } from "path";
import { Elysia, sse, t } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { htmxSpinner } from "./htmx-helpers";
import {
  esc,
  renderStatusEnvelope,
  renderEnvelopeSection,
  renderCommandTable,
  renderPollingEnvelope,
  serializeEnvelope,
  type RetryConfig,
} from "./renderers";
import { DEFAULT_LOCALE, isSupportedLocale, setActiveLocale, t as tStr, tInterp, type Locale } from "./i18n";
import { getPreference, setPreference, encodeJobEventCursor } from "./db";
import { Dashboard } from "./pages";
import { parseMaestroYaml } from "./yaml-parser";
import { parseFlowTarget } from "./flow-target-parser";
import {
  AppBuildExecutionError,
  ConfigParseError,
  UCPFetchError,
} from "./errors";
import {
  discoverBusinessCapabilitiesWithResult,
  type UCPDiscoverError,
} from "./ucp-discovery";
import {
  DEFAULT_CHAT_PULL_MODEL,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_TTS_VOICE,
  DEFAULT_THEME,
  DEFAULT_MODEL_SOURCE,
  MAX_MODEL_PULL_TIMEOUT_MS,
  MODEL_SOURCE_REGISTRY,
  OLLAMA_DEFAULT_BASE_URL,
  CHAT_COMMAND_FALLBACK_LABEL,
  DEFAULT_FLOW_TARGET,
  FLOW_NO_ATTEMPTS_MESSAGE,
  FLOW_PENDING_STATE_LABEL,
  APP_BUILD_ARTIFACT_PENDING_LABEL,
  SUPPORTED_THEMES,
  CHAT_RATE_LIMIT_WINDOW_MS,
  MAX_YAML_BYTES,
  parseKnownModelSourceId,
  type ControlPlaneState,
} from "./config";
import {
  CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE,
  isChatTtsOutputMimeType,
  type ChatTtsOutputMimeType,
} from "../../contracts/flow-contracts";
import {
  type ProviderId,
  PROVIDERS,
  chatCompletion,
  transcribeSpeech,
  synthesizeSpeech,
  getProvider,
  parseProviderId,
  listProviderModels,
  listProviderModelsOrDefaults,
  testConnection,
} from "./ai-providers";
import {
  API_HEALTH_ROUTE,
  APP_BUILD_ROUTE,
  FLOW_AUTOMATION_VALIDATE_ROUTE,
  MODEL_PULL_ROUTE,
  MODEL_SEARCH_ROUTE,
  MODEL_SOURCE_ROUTE,
} from "./runtime-constants";
import {
  deleteApiKey,
  getAllProviderStatuses,
  getApiKey,
  getBaseUrl,
  saveApiKey,
} from "./ai-keys";
import {
  type ApiEnvelope,
  type AppBuildEnvelope,
  type ModelPullEnvelope,
  type ModelPullRequest,
  type FlowRunResult,
  type FlowCommand,
  type FlowRunTarget,
  type FlowRuntimeError,
  type FlowCapabilityError,
  type CapabilityJobState,
  type FlowRunRequest,
  type FlowRunEnvelope,
  type FlowRunJobEnvelope,
  type FlowValidateEnvelope,
  type FlowAutomationValidateEnvelope,
  type FlowAutomationValidationResult,
  type FlowValidationResult,
  type FlowRunAction,
  type BuildType,
  type ChatRunEnvelope,
  type PreferenceRunEnvelope,
  type ProviderValidationEnvelope,
  type ProviderValidationItem,
  type ProviderValidationResult,
  type FlowCommandResult,
  type FlowCapabilityMatrixEnvelope,
  type FlowCapabilitySurface,
  isFlowCapabilityError,
  isFlowCommandType,
  createFlowCapabilityError,
  type AppBuildRequest,
  type ModelSourceRegistryEnvelope,
  type ModelSearchEnvelope,
  type HfModelSearchHit,
} from "../../contracts/flow-contracts";
import { type UCPDiscoverResponse } from "../../contracts/ucp-contracts";
import { commandLogQuerySchema } from "./contracts/http";
import { RPADriver, getFlowCapabilityMatrix, getFlowTargetCapabilityProbe } from "./flow-engine";
import { logger } from "./logger";
import { getModelPullJobEnvelope, startModelPullJob } from "./model-manager";
import { searchHfModels, type HfSort } from "./hf-search";
import {
  cancelAppBuildJob,
  getAppBuildJobEnvelope,
  getAppBuildJobLogEvents,
  resumeAppBuildJob,
  startAppBuildJob,
} from "./app-builds";
import {
  cancelFlowRunJob,
  getFlowRunJobEnvelope,
  getFlowRunLogEvents,
  pauseFlowRunJob,
  replayFlowRunStep,
  resumeFlowRunJob,
  startFlowRunJob,
} from "./flow-runs";

type LogEventLevel = "debug" | "info" | "warn" | "error";
type LogStreamFormat = "json" | "html";
type JobLogEventRecord = {
  id: string;
  level: string;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};
type JobLogEventPayload = {
  id: string;
  level: LogEventLevel;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};

/**
 * Dependency surface for model/build capability routes.
 * Injectable in tests to avoid external runtime side effects.
 */
export interface ControlPlaneServices {
  /** Start model pull execution and return initial envelope. */
  readonly startModelPullJob: (request: ModelPullRequest, requestedBy?: string) => Promise<ModelPullEnvelope>;
  /** Read model pull job status by identifier. */
  readonly getModelPullJobEnvelope: (jobId: string) => ModelPullEnvelope;
  /** Start app build execution and return initial envelope. */
  readonly startAppBuildJob: (request: AppBuildRequest, requestedBy?: string) => Promise<AppBuildEnvelope>;
  /** Read app build job status by identifier. */
  readonly getAppBuildJobEnvelope: (jobId: string) => AppBuildEnvelope;
  /** Cancel running app build job. */
  readonly cancelAppBuildJob?: (jobId: string) => AppBuildEnvelope;
  /** Resume app build job as deterministic requeue. */
  readonly resumeAppBuildJob?: (jobId: string) => AppBuildEnvelope;
  /** List app build log events for polling/SSE. */
  readonly getAppBuildJobLogEvents?: (jobId: string, afterEventId?: string | null) => ReadonlyArray<JobLogEventPayload>;
  /** Execute flow payloads and return deterministic flow run artifacts. */
  readonly runFlow?: (request: FlowRunRequest) => Promise<FlowRunResult>;
  /** Start async flow-run job. */
  readonly startFlowRunJob?: (request: FlowRunRequest, requestedBy?: string) => FlowRunJobEnvelope;
  /** Poll async flow-run job by id. */
  readonly getFlowRunJobEnvelope?: (runId: string) => FlowRunJobEnvelope;
  /** Cancel async flow-run job. */
  readonly cancelFlowRunJob?: (runId: string) => FlowRunJobEnvelope;
  /** Pause async flow-run job. */
  readonly pauseFlowRunJob?: (runId: string) => FlowRunJobEnvelope;
  /** Resume async flow-run job. */
  readonly resumeFlowRunJob?: (runId: string) => FlowRunJobEnvelope;
  /** Replay failed step in async flow-run job. */
  readonly replayFlowRunStep?: (runId: string, commandIndex: number) => FlowRunJobEnvelope;
  /** List run logs for polling/SSE. */
  readonly getFlowRunLogEvents?: (runId: string, afterEventId?: string | null) => ReadonlyArray<JobLogEventPayload>;
}

/** Optional app-factory parameters for route dependency injection. */
export interface CreateControlPlaneAppOptions {
  /** Override runtime services used by model/build endpoints. */
  readonly services?: Partial<ControlPlaneServices>;
}

/** Build default service bindings used in production runtime. */
export function createDefaultControlPlaneServices(): ControlPlaneServices {
  return {
    startModelPullJob,
    getModelPullJobEnvelope,
    startAppBuildJob,
    getAppBuildJobEnvelope,
    cancelAppBuildJob,
    resumeAppBuildJob,
    getAppBuildJobLogEvents,
    startFlowRunJob,
    getFlowRunJobEnvelope,
    cancelFlowRunJob,
    pauseFlowRunJob,
    resumeFlowRunJob,
    replayFlowRunStep,
    getFlowRunLogEvents,
    runFlow: async (request: FlowRunRequest): Promise<FlowRunResult> => {
      const flow = parseMaestroYaml(request.yaml);
      const driver = new RPADriver();
      return driver.executeFlow(flow, {
        target: request.target,
        maxAttempts: request.maxAttempts,
        commandTimeoutMs: request.commandTimeoutMs,
        retryDelayMs: request.retryDelayMs,
      });
    },
  };
}

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * Simple in-memory rate limiter for the AI chat endpoint.
 * Tracks the last accepted request timestamp per client key (IP or session).
 * Rejects requests arriving within CHAT_RATE_LIMIT_WINDOW_MS of the previous one.
 */
const _chatRateLimitMap = new Map<string, number>();
const SUPPORTED_THEMES_SET = new Set<string>(SUPPORTED_THEMES);
type FlowRunRoute = "/api/flows/run" | "/api/flows/trigger";

/** Clean up stale entries older than 10× the window to avoid unbounded growth. */
function _chatRateLimitCleanup(): void {
  const cutoff = Date.now() - CHAT_RATE_LIMIT_WINDOW_MS * 10;
  for (const [key, ts] of _chatRateLimitMap) {
    if (ts < cutoff) {
      _chatRateLimitMap.delete(key);
    }
  }
}

/**
 * Check and update the rate limit for a given client key.
 * Returns true if the request is allowed, false if it should be rejected (429).
 */
export function checkChatRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const last = _chatRateLimitMap.get(clientKey);
  if (last !== undefined && now - last < CHAT_RATE_LIMIT_WINDOW_MS) {
    return false;
  }
  _chatRateLimitMap.set(clientKey, now);
  if (_chatRateLimitMap.size > 1000) {
    _chatRateLimitCleanup();
  }
  return true;
}

/**
 * Reset all rate limit state. Intended for use in tests only.
 */
export function resetChatRateLimitForTest(): void {
  _chatRateLimitMap.clear();
}
type RequestFieldValue = string | number | boolean | null | undefined;
type RequestBodyRecord = Record<string, RequestFieldValue>;
type RequestBodyInput = RequestBodyRecord | RequestFieldValue[] | RequestFieldValue | null | undefined;
type RequestQueryRecord = Record<string, RequestFieldValue>;
type RuntimeErrorRecord = {
  reason?: string;
  command?: string;
  commandIndex?: number;
};

/** Coerce request body input to RequestBodyRecord with runtime validation. */
export function toRequestBody(body: RequestBodyInput): RequestBodyRecord | null | undefined {
  if (body === null || body === undefined) return body;
  if (!isRecord(body)) return null;
  const normalized: RequestBodyRecord = {};
  for (const [key, value] of Object.entries(body)) {
    if (isRequestFieldValue(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/** Coerce Elysia query object to a typed request map with scalar support only. */
function toRequestQuery(query: unknown): RequestQueryRecord | null | undefined {
  if (query === null || query === undefined) {
    return undefined;
  }
  if (!isRecord(query)) {
    return null;
  }
  const entries = query;
  const normalized: RequestQueryRecord = {};
  for (const [key, value] of Object.entries(entries)) {
    if (
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      normalized[key] = value;
    }
  }
  return normalized;
}
type FailureShape = {
  readonly commandIndex?: number | null;
  readonly command?: string | null;
  readonly reason?: string | null;
  readonly retryable?: boolean | null;
  readonly message?: string | null;
};
type CapabilityFailure =
  | FlowRuntimeError
  | Error
  | string
  | number
  | boolean
  | null
  | undefined
  | FailureShape;

/** Type guard for FlowRuntimeError (FlowCapabilityError | FlowParseFailure). */
export function isFlowRuntimeError(e: RuntimeErrorRecord | FlowRuntimeError | null): e is FlowRuntimeError {
  if (e === null || typeof e !== "object") return false;
  return (
    typeof e.reason === "string"
    && typeof e.command === "string"
    && typeof e.commandIndex === "number"
  );
}

function isRequestFieldValue(value: unknown): value is RequestFieldValue {
  return (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Infer canonical route from request path for error envelope. */
export function inferRouteFromRequest(request: Request): string | null {
  const path = new URL(request.url).pathname;
  if (path.startsWith(MODEL_PULL_ROUTE)) return MODEL_PULL_ROUTE;
  if (path.startsWith(APP_BUILD_ROUTE)) return APP_BUILD_ROUTE;
  if (path.startsWith("/api/flows/validate/automation")) return FLOW_AUTOMATION_VALIDATE_ROUTE;
  if (path.startsWith("/api/flows/")) return "/api/flows/run";
  if (path.startsWith("/api/ai/")) return path;
  return null;
}

export function toSafeDomIdSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized.length > 0 ? normalized : "log-stream";
}

function shouldReturnJsonResponse(
  format: string | undefined,
  acceptHeader: string | string[] | undefined,
): boolean {
  if (format?.trim().toLowerCase() === "json") {
    return true;
  }
  const acceptValues = Array.isArray(acceptHeader) ? acceptHeader.join(",") : (acceptHeader ?? "");
  return acceptValues.toLowerCase().includes("application/json");
}

function isFlowRunRoute(route: string): route is FlowRunRoute {
  return route === "/api/flows/run" || route === "/api/flows/trigger";
}

function isSupportedTheme(value: string): value is (typeof SUPPORTED_THEMES)[number] {
  return SUPPORTED_THEMES_SET.has(value);
}

function extractAcceptHeader(headers: unknown): string | string[] | undefined {
  if (!isRecord(headers) || !("accept" in headers)) {
    return undefined;
  }
  const rawAccept = headers.accept;
  if (typeof rawAccept === "string" || Array.isArray(rawAccept)) {
    return rawAccept;
  }
  return undefined;
}

function serializeUCPResponse(
  set: { headers: { [key: string]: string | number } },
  payload: UCPDiscoverResponse,
): string {
  set.headers["content-type"] = JSON_CONTENT_TYPE;
  return JSON.stringify(payload);
}

export function parseLogCursor(query: RequestQueryRecord | null | undefined): string | null {
  const cursor = typeof query?.cursor === "string" ? query.cursor.trim() : "";
  if (cursor && cursor.length > 0) {
    return cursor;
  }
  const after = typeof query?.after === "string" ? query.after.trim() : "";
  if (after && after.length > 0) {
    return after;
  }
  return null;
}

export function parseLogStreamFormat(query: RequestQueryRecord | null | undefined): LogStreamFormat {
  if (typeof query?.format === "string") {
    return query.format.trim().toLowerCase() === "html" ? "html" : "json";
  }
  return "json";
}

export function parseLogTailFlag(query: RequestQueryRecord | null | undefined): boolean {
  const value = typeof query?.tail === "string" ? query.tail.trim().toLowerCase() : undefined;
  return value === "1" || value === "true" || value === "yes";
}

export function normalizeLogEventLevel(value: string): LogEventLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

export function isTerminalJobState(status: CapabilityJobState | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function logLevelBadgeClass(level: LogEventLevel): string {
  if (level === "error") return "badge-error";
  if (level === "warn") return "badge-warning";
  if (level === "debug") return "badge-ghost";
  return "badge-info";
}

export function renderLogEventHtmlRow(event: JobLogEventPayload): string {
  const commandIndexLabel = event.commandIndex === null ? "-" : String(event.commandIndex + 1);
  return `<tr>
    <td class="font-mono text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-xs ${logLevelBadgeClass(event.level)}">${esc(event.level.toUpperCase())}</span>
        <span class="opacity-70">${esc(event.createdAt)}</span>
        <span class="badge badge-ghost badge-xs">#${esc(commandIndexLabel)}</span>
        <span>${esc(event.message)}</span>
      </div>
    </td>
  </tr>`;
}

export function renderLiveLogTable(logRegionId: string, connectPath: string): string {
  return `<div class="mt-3" role="region" aria-label="${esc(tStr("api.logs_sse"))}">
    <h4 class="font-semibold text-sm mb-1">${tStr("api.logs_sse")}</h4>
    <div class="overflow-x-auto rounded-box border border-base-content/10 max-h-56">
      <table class="table table-xs table-pin-rows">
        <thead><tr><th>${tStr("api.logs_sse")}</th></tr></thead>
        <tbody
          id="${esc(logRegionId)}"
          role="log"
          aria-live="polite"
          hx-ext="sse"
          sse-connect="${esc(connectPath)}"
          sse-swap="debug,info,warn,error"
          hx-swap="beforeend show:bottom">
          <tr><td class="text-xs opacity-60">${esc(`${tStr("api.status_running")}...`)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

type LogStreamInput = {
  format: LogStreamFormat;
  tail: boolean;
  initialCursor: string | null;
  request: Request;
  listEvents: (jobId: string, afterEventId?: string | null) => ReadonlyArray<JobLogEventRecord>;
  readStatus: (jobId: string) => CapabilityJobState | undefined;
  jobId: string;
};

/** Stream normalized flow/app log events as SSE with optional tail polling. */
export async function* streamJobLogs({
  format,
  tail,
  initialCursor,
  request,
  listEvents,
  readStatus,
  jobId,
}: LogStreamInput): AsyncGenerator<ReturnType<typeof sse>, void, unknown> {
  let cursor = initialCursor;
  do {
    const events = listEvents(jobId, cursor);
    for (const event of events) {
      cursor = encodeJobEventCursor(event);
      const normalizedEvent: JobLogEventPayload = {
        id: event.id,
        level: normalizeLogEventLevel(event.level),
        message: event.message,
        commandIndex: event.commandIndex,
        createdAt: event.createdAt,
      };
      yield sse({
        event: normalizedEvent.level,
        id: normalizedEvent.id,
        data: format === "html" ? renderLogEventHtmlRow(normalizedEvent) : normalizedEvent,
      });
    }
    if (!tail) {
      break;
    }
    const status = readStatus(jobId);
    if (isTerminalJobState(status)) {
      break;
    }
    await Bun.sleep(500);
  } while (!request.signal.aborted);
}

export function parseOptionalTrimmedString(value: RequestFieldValue): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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

const CHAT_TTS_MIME_ALIAS_MAP: Readonly<Record<string, ChatTtsOutputMimeType>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "opus",
  "audio/opus": "opus",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/pcm": "pcm",
} as const;
const CHAT_TTS_FORMAT_MIME_MAP: Readonly<Record<ChatTtsOutputMimeType, string>> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
} as const;

type ChatSpeechInputRecord = {
  mimeType: string;
  data: string;
};

function parseChatSpeechInput(value: unknown): ChatSpeechInputRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rawMimeType = parseOptionalTrimmedString(
    typeof value.mimeType === "string" ? value.mimeType : undefined,
  );
  const rawData = parseOptionalTrimmedString(
    typeof value.data === "string" ? value.data : undefined,
  );
  if (!rawMimeType || !rawData) {
    return undefined;
  }
  return { mimeType: rawMimeType, data: rawData };
}

function parseHfSearchSort(value: string | undefined): HfSort {
  const normalized = value?.trim();
  if (
    normalized === "downloads"
    || normalized === "likes"
    || normalized === "trending"
    || normalized === "lastModified"
    || normalized === "createdAt"
  ) {
    return normalized;
  }
  return "downloads";
}

function parseChatTtsOutputMimeType(
  value: RequestFieldValue,
  requestTtsEnabled: boolean,
): ChatTtsOutputMimeType | undefined {
  if (!requestTtsEnabled) {
    return undefined;
  }
  const rawValue = parseOptionalTrimmedString(value);
  if (!rawValue) {
    return CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE;
  }
  const normalized = rawValue.toLowerCase();
  if (isChatTtsOutputMimeType(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("audio/ogg") && normalized.includes("opus")) {
    return "opus";
  }
  return CHAT_TTS_MIME_ALIAS_MAP[normalized];
}

function resolveChatTtsPlaybackMimeType(
  value: RequestFieldValue,
  outputFormat: ChatTtsOutputMimeType,
): string {
  const rawValue = parseOptionalTrimmedString(value);
  if (!rawValue) {
    return CHAT_TTS_FORMAT_MIME_MAP[outputFormat];
  }
  const normalized = rawValue.toLowerCase();
  if (normalized.includes("/")) {
    return normalized;
  }
  return CHAT_TTS_FORMAT_MIME_MAP[outputFormat];
}

export function parseOptionalInt(value: RequestFieldValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function isSupportedHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const parsed = new URL(value);
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function isValidModelIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= 256
    && !/[\s]/.test(trimmed)
    && !trimmed.includes("\u0000")
    && !trimmed.includes("\r")
    && !trimmed.includes("\n");
}

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

type ParsedFlowYamlValue = string | number | boolean | null | ParsedFlowYamlObject | ParsedFlowYamlValue[];
type ParsedFlowYamlObject = {
  [key: string]: ParsedFlowYamlValue;
};

function isParsedFlowYamlObject(value: unknown): value is ParsedFlowYamlObject {
  return isRecord(value);
}

function isParsedFlowYamlValue(value: unknown): value is ParsedFlowYamlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isParsedFlowYamlValue(entry));
  }
  if (isRecord(value)) {
    return Object.values(value).every((entry) => isParsedFlowYamlValue(entry));
  }
  return false;
}

type AutomationStepAnalysis = {
  index: number;
  commandType: string;
  supported: boolean;
  reason?: string;
};

interface FlowAutomationCompatibilityResult {
  data: FlowAutomationValidationResult;
  mismatches: string[];
  targetReadinessFailure?: FlowCapabilityError | null;
}

export function isKnownFlowCommandType(commandType: string): commandType is FlowCommand["type"] {
  return isFlowCommandType(commandType);
}

async function analyzeFlowAutomationCompatibility(
  rawYaml: string,
  target: FlowRunTarget,
): Promise<FlowAutomationCompatibilityResult> {
  const { appId, steps } = parseFlowForAutomation(rawYaml);
  const capabilityProbe = getFlowTargetCapabilityProbe(target);
  const readinessFailure = await capabilityProbe.validateTargetReady();

  const analyzed = steps.map((step, index) => {
    const stepAnalysis = analyzeAutomationStep(step, index);
    if (!stepAnalysis.supported) {
      return stepAnalysis;
    }

    if (readinessFailure) {
      return {
        ...stepAnalysis,
        supported: false,
        reason: readinessFailure.reason,
      };
    }

    if (isKnownFlowCommandType(stepAnalysis.commandType) && !capabilityProbe.supportsCommand(stepAnalysis.commandType)) {
      return {
        ...stepAnalysis,
        supported: false,
        reason: `${stepAnalysis.commandType} is not supported on ${capabilityProbe.target} target.`,
      };
    }

    return stepAnalysis;
  });

  const supportedCommandCount = analyzed.filter((step) => step.supported).length;
  const mismatchSet = new Set<string>();
  for (const step of analyzed) {
    if (!step.supported && step.reason) {
      mismatchSet.add(`Unsupported step ${step.index + 1}: ${step.commandType}${step.reason ? ` — ${step.reason}` : ""}`);
    }
  }
  if (readinessFailure) {
    mismatchSet.add(`Target readiness check failed: ${readinessFailure.reason}`);
  }

  return {
    data: {
      appId,
      commandCount: analyzed.length,
      supportedCommandCount,
      steps: analyzed.map((item) => ({
        index: item.index,
        commandType: item.commandType,
        supported: item.supported,
        reason: item.reason,
      })),
    },
    mismatches: [...mismatchSet],
    targetReadinessFailure: readinessFailure,
  };
}

export function parseFlowForAutomation(rawYaml: string): { appId: string; steps: ParsedFlowYamlValue[] } {
  const documents = splitFlowYamlDocuments(rawYaml);
  if (documents.length === 1) {
    const rootDocument = documents.at(0);
    if (rootDocument === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML must include a single document or config+commands documents only.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    const root = asFlowRecord(rootDocument, "Flow YAML must be an object.");
    const appId = asFlowText(root.appId, "Flow YAML config must include appId.");
    const steps = asFlowArray(root.steps, "Flow steps must be an array.");
    return { appId, steps };
  }

  if (documents.length === 2) {
    const configDocument = documents.at(0);
    if (configDocument === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML config document is missing.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    const config = asFlowRecord(configDocument, "Flow YAML config document must be an object.");
    const appId = asFlowText(config.appId, "Flow YAML config document must define appId.");
    const stepsDocument = documents.at(1);
    if (stepsDocument === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML second document is missing.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    const steps = asFlowArray(stepsDocument, "Flow YAML second document must be an array of steps.");
    return { appId, steps };
  }

  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "flow",
    reason: "Flow YAML must include a single document or config+commands documents only.",
    retryable: false,
    surface: "flow_automation",
  });
}

export function splitFlowYamlDocuments(rawYaml: string): ParsedFlowYamlValue[] {
  const source = rawYaml.replace(/\r\n/g, "\n").trim();
  if (source.length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "flow",
      reason: "Flow payload is empty.",
      retryable: false,
      surface: "flow_automation",
    });
  }

  const docs: string[] = [];
  let current: string[] = [];

  for (const line of source.split("\n")) {
    if (line.trim() === "---") {
      if (current.length > 0) {
        docs.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    docs.push(current.join("\n"));
  }

  return docs.map((doc) => {
    const parsed = Bun.YAML.parse(doc);
    if (parsed === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML document is invalid.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    if (!isParsedFlowYamlValue(parsed)) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML document is malformed.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    return parsed;
  });
}

export function analyzeAutomationStep(step: ParsedFlowYamlValue, index: number): AutomationStepAnalysis {
  if (typeof step === "string") {
    const commandType = step.trim();
    if (commandType.length === 0) {
      return {
        index,
        commandType: "empty-step",
        supported: false,
        reason: "Scalar command must not be empty.",
      };
    }
    if (isFlowCommandType(commandType)) {
      return validateScalarAutomationCommand(commandType, undefined, index);
    }
    return {
      index,
      commandType,
      supported: false,
      reason: "Unknown scalar command.",
    };
  }

  if (typeof step === "number" || typeof step === "boolean" || step === null) {
    return {
      index,
      commandType: "invalid",
      supported: false,
      reason: "Flow step must be a mapping or scalar command.",
    };
  }

  if (Array.isArray(step)) {
    return {
      index,
      commandType: "array",
      supported: false,
      reason: "Flow step cannot be an array.",
    };
  }

  if (!isParsedFlowYamlObject(step)) {
    return {
      index,
      commandType: "invalid",
      supported: false,
      reason: "Flow step must be a mapping or scalar command.",
    };
  }

  const rawStep = step;
  if (typeof rawStep.type !== "undefined") {
    if (typeof rawStep.type !== "string") {
      return {
        index,
        commandType: String(rawStep.type),
        supported: false,
        reason: "Command type must be a string.",
      };
    }

    const commandType = rawStep.type.trim();
    if (commandType.length === 0) {
      return {
        index,
        commandType: "empty-type",
        supported: false,
        reason: "Command type must not be empty.",
      };
    }

    if (!isFlowCommandType(commandType)) {
      return {
        index,
        commandType,
        supported: false,
        reason: "Unsupported command type.",
      };
    }
    return validateObjectAutomationCommand(commandType, rawStep, index);
  }

  const keys = Object.keys(rawStep);
  if (keys.length !== 1) {
    return {
      index,
      commandType: "object",
      supported: false,
      reason: "Maestro object command must contain exactly one command key.",
    };
  }

  const [key] = keys;
  if (!key) {
    return {
      index,
      commandType: "empty-command",
      supported: false,
      reason: "Step object is missing a command key.",
    };
  }

  if (!isFlowCommandType(key)) {
    return {
      index,
      commandType: key,
      supported: false,
      reason: "Unsupported command key.",
    };
  }

  return validateScalarAutomationCommand(key, rawStep[key], index);
}

export function validateScalarAutomationCommand(
  commandType: string,
  value: ParsedFlowYamlValue | undefined,
  _index: number,
): AutomationStepAnalysis {
  switch (commandType) {
    case "launchApp":
    case "hideKeyboard":
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: `${commandType} does not accept a scalar value.`,
        };
      }
      return { index: _index, commandType, supported: true };
    case "assertNotVisible":
    case "assertVisible": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: `${commandType} requires a non-empty target string.`,
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "tapOn": {
      if (typeof value === "string" && value.trim().length > 0) {
        return { index: _index, commandType, supported: true };
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const selectorKeys = ["text", "resourceId", "contentDescription"];
        const hasKnownSelector = selectorKeys.some((k) => k in value);
        return {
          index: _index,
          commandType,
          supported: hasKnownSelector,
          ...(!hasKnownSelector ? { reason: "tapOn object must contain a recognized selector (text, resourceId, contentDescription)." } : {}),
        };
      }
      return {
        index: _index,
        commandType,
        supported: false,
        reason: "tapOn requires a non-empty target string or selector object.",
      };
    }
    case "assertText": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "assertText requires a non-empty target::value payload.",
        };
      }
      const rawValue = value.trim();
      const [targetText, expectedValue] = rawValue.split("::", 2);
      if (!targetText || expectedValue === undefined || expectedValue.length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: `assertText syntax at index ${_index} must be "target::value".`,
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "selectOption": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "selectOption requires a non-empty target::option payload.",
        };
      }
      const rawValue = value.trim();
      const [targetText, option] = rawValue.split("::", 2);
      if (!targetText || option === undefined || option.length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: `selectOption syntax at index ${_index} must be "target::option".`,
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "inputText":
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "inputText requires a non-empty value.",
        };
      }
      return { index: _index, commandType, supported: true };
    case "scroll":
    case "swipe":
      if (typeof value !== "string" || !isDirectionValue(value)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: `${commandType} requires direction as one of UP, DOWN, LEFT, RIGHT.`,
        };
      }
      return { index: _index, commandType, supported: true };
    case "screenshot":
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "screenshot does not accept scalar value.",
        };
      }
      return { index: _index, commandType, supported: true };
    case "waitForAnimation":
      if (!isPositiveInteger(value)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "waitForAnimation requires timeoutMs as a positive integer.",
        };
      }
      return { index: _index, commandType, supported: true };
    case "windowFocus":
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "windowFocus requires a non-empty target.",
        };
      }
      return { index: _index, commandType, supported: true };
    case "clipboardRead":
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "clipboardRead does not accept a scalar value.",
        };
      }
      return { index: _index, commandType, supported: true };
    case "clipboardWrite":
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "clipboardWrite requires a non-empty value.",
        };
      }
      return { index: _index, commandType, supported: true };
    default:
      return {
        index: _index,
        commandType,
        supported: false,
        reason: "Unsupported command form.",
      };
  }
}

export function validateObjectAutomationCommand(
  commandType: string,
  rawStep: ParsedFlowYamlObject,
  _index: number,
): AutomationStepAnalysis {
  const unsupportedFields = Object.keys(rawStep).filter((key) => key !== "type" && key !== "target" && key !== "value" && key !== "direction"
    && key !== "steps" && key !== "distanceFraction" && key !== "timeoutMs" && key !== "option");
  if (unsupportedFields.length > 0) {
    return {
      index: _index,
      commandType,
      supported: false,
      reason: `Unsupported command fields: ${unsupportedFields.join(", ")}`,
    };
  }

  switch (commandType) {
    case "launchApp":
    case "hideKeyboard":
      return { index: _index, commandType, supported: Object.keys(rawStep).length === 1 };
    case "tapOn": {
      const targetValue = rawStep.target;
      if (!isTapTargetValue(targetValue)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "tapOn requires a selector target or both x and y coordinates.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "assertVisible":
    case "assertNotVisible": {
      const targetValue = rawStep.target;
      if (!isTargetValue(targetValue)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: `${commandType} requires a selector target.`,
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "assertText": {
      const targetValue = rawStep.target;
      if (!isTargetValue(targetValue)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "assertText requires a selector target.",
        };
      }
      const value = rawStep.value;
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "assertText requires a non-empty value.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "selectOption": {
      const targetValue = rawStep.target;
      if (!isTargetValue(targetValue)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "selectOption requires a selector target.",
        };
      }
      const option = rawStep.option;
      if (typeof option !== "string" || option.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "selectOption requires a non-empty option.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "windowFocus": {
      if (rawStep.target === undefined) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "windowFocus requires a target.",
        };
      }
      if (rawStep.value !== undefined) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "windowFocus does not accept a value.",
        };
      }
      if (!isWindowTargetValue(rawStep.target)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "windowFocus target must include appId and/or title.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "clipboardRead":
      if (rawStep.target !== undefined || rawStep.value !== undefined) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "clipboardRead does not accept a target or value.",
        };
      }
      return { index: _index, commandType, supported: true };
    case "clipboardWrite": {
      if (rawStep.target !== undefined) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "clipboardWrite does not accept a target.",
        };
      }
      const value = rawStep.value;
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "clipboardWrite requires a non-empty value.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "inputText": {
      const value = rawStep.value;
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "inputText requires a non-empty value.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "scroll": {
      const direction = rawStep.direction;
      if (typeof direction !== "string" || !isDirectionValue(direction)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "scroll requires direction: UP | DOWN | LEFT | RIGHT.",
        };
      }
      const stepsValue = rawStep.steps;
      if (stepsValue !== undefined && !isPositiveInteger(stepsValue)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "scroll steps must be a positive integer.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    case "swipe": {
      const direction = rawStep.direction;
      if (typeof direction !== "string" || !isDirectionValue(direction)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "swipe requires direction: UP | DOWN | LEFT | RIGHT.",
        };
      }
      const distance = rawStep.distanceFraction;
      if (distance !== undefined) {
        if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0.2 || distance > 0.95) {
          return {
            index: _index,
            commandType,
            supported: false,
            reason: "swipe distanceFraction must be a number between 0.2 and 0.95.",
          };
        }
      }
      return { index: _index, commandType, supported: true };
    }
    case "screenshot":
      return { index: _index, commandType, supported: true };
    case "waitForAnimation": {
      const timeout = rawStep.timeoutMs;
      if (!isPositiveInteger(timeout)) {
        return {
          index: _index,
          commandType,
          supported: false,
          reason: "waitForAnimation requires timeoutMs as a positive integer.",
        };
      }
      return { index: _index, commandType, supported: true };
    }
    default:
      return {
        index: _index,
        commandType,
        supported: false,
        reason: "Unsupported command.",
      };
  }
}

export function isDirectionValue(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized === "UP" || normalized === "DOWN" || normalized === "LEFT" || normalized === "RIGHT";
}

export function isPositiveInteger(value: ParsedFlowYamlValue | undefined): boolean {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value > 0
  );
}

export function isTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  return isSelectorTargetValue(value);
}

export function isTapTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (!value || typeof value !== "object" || Array.isArray(value) || !isParsedFlowYamlObject(value)) {
    return false;
  }

  const target = value;
  const keys = Object.keys(target);
  if (keys.length === 0) {
    return false;
  }
  const hasCoordinatePair = keys.every((key) => key === "x" || key === "y")
    && typeof target.x === "number"
    && Number.isFinite(target.x)
    && Number.isInteger(target.x)
    && typeof target.y === "number"
    && Number.isFinite(target.y)
    && Number.isInteger(target.y);
  return hasCoordinatePair || isSelectorTargetValue(value);
}

export function isSelectorTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  if (typeof value === "string" && value.trim().length > 0) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !isParsedFlowYamlObject(value)) {
    return false;
  }

  const target = value;
  const selectors = ["resourceId", "text", "contentDescription", "x", "y"];
  const keys = Object.keys(target);
  if (keys.length === 0) {
    return false;
  }
  if (keys.some((key) => !selectors.includes(key))) {
    return false;
  }
  const hasSelector = typeof target.resourceId === "string" && target.resourceId.trim().length > 0
    || typeof target.text === "string" && target.text.trim().length > 0
    || typeof target.contentDescription === "string" && target.contentDescription.trim().length > 0;
  if (!hasSelector) {
    return false;
  }
  return keys.every((key) => {
    const raw = target[key];
    if (key === "resourceId" || key === "text" || key === "contentDescription") {
      return typeof raw === "string" && raw.trim().length > 0;
    }
    if (key === "x" || key === "y") {
      return typeof raw === "number" && Number.isFinite(raw) && Number.isInteger(raw);
    }
    return false;
  });
}

export function isWindowTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  if (typeof value === "string" && value.trim().length > 0) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value) || !isParsedFlowYamlObject(value)) {
    return false;
  }

  const target = value;
  const keys = Object.keys(target);
  if (keys.length === 0) {
    return false;
  }
  if (keys.some((key) => key !== "appId" && key !== "title")) {
    return false;
  }
  const hasAppId = typeof target.appId === "string" && target.appId.trim().length > 0;
  const hasTitle = typeof target.title === "string" && target.title.trim().length > 0;
  return hasAppId || hasTitle;
}

export function asFlowRecord(value: ParsedFlowYamlValue, message: string): ParsedFlowYamlObject {
  if (isParsedFlowYamlObject(value)) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "flow",
    reason: message,
    retryable: false,
    surface: "flow_automation",
  });
}

export function asFlowArray(value: ParsedFlowYamlValue | undefined, message: string): ParsedFlowYamlValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "steps",
    reason: message,
    retryable: false,
    surface: "flow_automation",
  });
}

export function asFlowText(value: ParsedFlowYamlValue | undefined, message: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "appId",
    reason: message,
    retryable: false,
    surface: "flow_automation",
  });
}

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
  const correlationId = parseOptionalTrimmedString(body.correlationId);

  return {
    modelRef,
    source: source ?? undefined,
    platform,
    force,
    timeoutMs,
    correlationId,
  };
}

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
  const variant = parseOptionalTrimmedString(body.variant);
  const outputDir = parseOptionalTrimmedString(body.outputDir);
  const skipTests = parseOptionalBoolean(body.skipTests);
  const clean = parseOptionalBoolean(body.clean);
  const correlationId = parseOptionalTrimmedString(body.correlationId);

  return {
    platform,
    buildType: buildType && isSupportedBuildType(buildType) ? buildType : undefined,
    variant,
    skipTests,
    outputDir,
    clean,
    correlationId,
  };
}

function isSupportedBuildType(value: string): value is BuildType {
  return value === "debug" || value === "release";
}

export function renderFlowArtifactCell(artifactPath: string | null | undefined): string {
  if (!artifactPath) {
    return "<span class=\"text-base-content/40\">-</span>";
  }

  return `<a class="link link-primary text-xs font-mono" href="${esc(artifactPath)}" target="_blank" rel="noopener">${esc(artifactPath)}</a>`;
}

export function renderFlowCommandResultRows(
  results: readonly FlowCommandResult[],
  includeArtifacts: boolean,
): string {
  if (results.length === 0) {
    return `<tr><td colspan="${includeArtifacts ? 5 : 4}" class="text-base-content/60">${tStr("api.flows_no_yaml_detail")}</td></tr>`;
  }

  return results
    .map((item) => {
      const stateClass = item.state === "success" ? "text-success" : "text-error";
      const details = item.error
        ? `<span class="text-xs block">${esc(`${item.error.reason}${item.error.retryable ? " (retryable)" : ""}`)}</span>`
        : "";
      const artifact = includeArtifacts
        ? `<td>${renderFlowArtifactCell(item.artifactPath)}</td>`
        : "";
      return `<tr>
        <td>${item.commandIndex + 1}</td>
        <td><code>${esc(item.commandType)}</code></td>
        <td class="${stateClass}">${esc(item.state)}</td>
        <td>${esc(item.message)}${details}</td>
        ${artifact}
      </tr>`;
    })
    .join("");
}

/** Render flow policy summary details for each run. */
export function renderFlowRunPolicySummary(data: FlowRunResult): string {
  if (!data.policy) {
    return `<div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full text-sm">
      <div class="stat">
        <div class="stat-title">${tStr("flow_engine.stat_target")}</div>
        <div class="stat-value text-sm">${data.target ?? DEFAULT_FLOW_TARGET}</div>
      </div>
    </div>`;
  }

  return `<div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full text-sm">
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_target")}</div>
        <div class="stat-value text-sm">${data.target ?? DEFAULT_FLOW_TARGET}</div>
      </div>
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_max_attempts")}</div>
      <div class="stat-value text-lg">${data.policy.maxAttempts}</div>
    </div>
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_timeout")}</div>
      <div class="stat-value text-lg">${data.policy.commandTimeoutMs}ms</div>
    </div>
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_retry_delay")}</div>
      <div class="stat-value text-lg">${data.policy.retryDelayMs}ms</div>
    </div>
  </div>`;
}

/** Render action summary rows from command attempts. */
export function renderFlowActionSummaryRows(actions: readonly FlowRunAction[]): string {
  if (actions.length === 0) {
    return `<tr><td colspan="6" class="text-base-content/60">${tStr("api.no_action_telemetry")}</td></tr>`;
  }

  return actions
    .map((action) => {
      const lastAttempt = action.attempts.at(-1);
      const stateClass = lastAttempt?.state === "success" ? "text-success" : "text-error";
      return `<tr>
        <td>${action.commandIndex + 1}</td>
        <td><code>${esc(action.commandType)}</code></td>
        <td><span class="badge badge-ghost badge-sm">${esc(action.target)}</span></td>
        <td>${action.attempts.length}</td>
        <td class="${stateClass}">${esc(lastAttempt?.state ?? FLOW_PENDING_STATE_LABEL)}</td>
        <td>${esc(lastAttempt?.message ?? FLOW_NO_ATTEMPTS_MESSAGE)}</td>
      </tr>`;
    })
    .join("");
}

/** Render flattened attempt rows across all actions for traceability. */
export function renderFlowAttemptRows(actions: readonly FlowRunAction[]): string {
  const rows = actions.flatMap((action) => {
    if (action.attempts.length === 0) {
      return `<tr>
        <td>${action.commandIndex + 1}</td>
        <td>${action.commandIndex + 1}.0</td>
        <td><code>${esc(action.commandType)}</code></td>
        <td><span class="badge badge-ghost badge-sm">${esc(action.target)}</span></td>
        <td class="text-base-content/60">not-run</td>
        <td class="text-xs">-</td>
        <td class="text-xs">-</td>
        <td class="text-xs">-</td>
        <td class="text-xs">${FLOW_NO_ATTEMPTS_MESSAGE}</td>
      </tr>`;
    }

    return action.attempts.map((attempt) => {
      const stateClass = attempt.state === "success" ? "text-success" : "text-error";
      const details = attempt.error
        ? `<span class="text-xs block">${esc(`${attempt.error.reason}${attempt.error.retryable ? " (retryable)" : ""}`)}</span>`
        : "";
      return `<tr>
        <td>${action.commandIndex + 1}</td>
        <td>${action.commandIndex + 1}.${attempt.attempt}</td>
        <td><code>${esc(action.commandType)}</code></td>
        <td><span class="badge badge-ghost badge-sm">${esc(action.target)}</span></td>
        <td class="${stateClass}">${esc(attempt.state)}</td>
        <td>${attempt.durationMs}ms</td>
        <td class="text-xs">${esc(attempt.startedAt)}</td>
        <td class="text-xs">${esc(attempt.endedAt)}</td>
        <td>${esc(attempt.message)}${details}</td>
      </tr>`;
    });
  });

  if (rows.length === 0) {
    return `<tr><td colspan="9" class="text-base-content/60">${tStr("api.no_attempt_telemetry")}</td></tr>`;
  }

  return rows.join("");
}

export function buildValidationCommandRows(data: FlowValidationResult): readonly FlowCommandResult[] {
  return data.commandTypes.map((commandType, index) => ({
    commandIndex: index,
    commandType,
    state: "success",
    message: "Validated",
  }));
}

/** Render action summary and attempt timeline tables (shared by flow run success/failure). */
export function renderFlowRunActionAndAttemptTables(actionSummaryRows: string, attemptRows: string): string {
  return `
      <div class="mt-3" role="region" aria-labelledby="flow-action-summary-heading">
        <h4 id="flow-action-summary-heading" class="font-semibold text-sm mb-1">${tStr("api.table_flow_action_summary")}</h4>
        ${renderCommandTable(actionSummaryRows, [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_target"), tStr("api.table_attempts"), tStr("api.table_state"), tStr("api.table_message")], tStr("api.table_flow_action_summary"))}
      </div>
      <div class="mt-3" role="region" aria-labelledby="flow-attempt-timeline-heading">
        <h4 id="flow-attempt-timeline-heading" class="font-semibold text-sm mb-1">${tStr("api.table_flow_attempt_timeline")}</h4>
        ${renderCommandTable(attemptRows, [tStr("api.table_index"), tStr("api.table_attempt"), tStr("api.table_command"), tStr("api.table_target"), tStr("api.table_state"), tStr("api.table_duration"), tStr("api.table_started"), tStr("api.table_ended"), tStr("api.table_message")], tStr("api.table_flow_attempt_timeline"))}
      </div>`;
}

/** Render flow execution envelope with deterministic command rows and mismatches. */
export function renderFlowRunState(route: string, envelope: FlowRunEnvelope): string {
  const data = envelope.data;
  const rows = data ? renderFlowCommandResultRows(data.results, true) : "";
  const actionSummaryRows = data ? renderFlowActionSummaryRows(data.actions ?? []) : "";
  const attemptRows = data ? renderFlowAttemptRows(data.actions ?? []) : "";
  const mismatches = envelope.mismatches ?? [];
  const errorReason = envelope.error && isFlowRuntimeError(envelope.error) ? envelope.error.reason : undefined;
  const commandHeaders: readonly [string, string, string, string, string] = [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_state"), tStr("api.table_details"), tStr("api.table_artifact")];
  const actionAndAttemptBlock = data ? renderFlowRunActionAndAttemptTables(actionSummaryRows, attemptRows) : "";

  if (envelope.state === "success" && data) {
    return renderEnvelopeSection(
      route,
      envelope,
      `      ${renderStatusEnvelope(route, envelope, tStr("api.flow_run_ready"), tInterp("api.flow_run_summary", {
        appId: data.appId,
        commands: String(data.commandCount),
        duration: String(data.durationMs),
      }))}
      ${renderFlowRunPolicySummary(data)}
      ${renderCommandTable(rows, commandHeaders)}
${actionAndAttemptBlock}`,
    );
  }

  const details = [...mismatches];
  if (errorReason) {
    details.push(errorReason);
  }

  const heading = tStr("api.flow_run_failed");
  const summary = tStr("api.flows_parse_failed");

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, heading, summary, details)}
    ${data ? renderFlowRunPolicySummary(data) : ""}
    ${data ? renderCommandTable(rows, commandHeaders) : ""}
${actionAndAttemptBlock}`,
  );
}

/** Render async flow-run job envelope for operator controls. */
export function renderFlowRunJobState(route: string, envelope: FlowRunJobEnvelope): string {
  const data = envelope.data;
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const summary = data ? `${data.status} · correlation=${data.correlationId}` : tStr("api.flow_run_no_data");
  const runId = envelope.runId;
  const isTerminal = data?.status === "succeeded" || data?.status === "failed" || data?.status === "cancelled";
  const isPaused = data?.status === "paused";
  const statusOrder: ReadonlyArray<{
    id: "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";
    label: string;
  }> = [
    { id: "queued", label: tStr("api.status_queued") },
    { id: "running", label: tStr("api.status_running") },
    { id: "paused", label: tStr("api.status_paused") },
    { id: "succeeded", label: tStr("api.status_succeeded") },
    { id: "failed", label: tStr("api.status_failed") },
    { id: "cancelled", label: tStr("api.status_cancelled") },
  ];
  const statusIndex = data ? statusOrder.findIndex((entry) => entry.id === data.status) : -1;
  const statusSteps = `<ul class="steps steps-vertical sm:steps-horizontal w-full">
    ${statusOrder.map((entry, index) => {
      const active = statusIndex >= 0 && index <= statusIndex;
      const stateClass = active
        ? (entry.id === "failed" || entry.id === "cancelled" ? "step-error" : "step-primary")
        : "";
      return `<li class="step ${stateClass}">${entry.label}</li>`;
    }).join("")}
  </ul>`;

  const controls = runId
    ? `<div class="join join-vertical sm:join-horizontal w-full sm:w-auto" role="group" aria-label="${tStr("flow_engine.controls_aria")}">
      <button class="btn btn-outline btn-sm join-item" hx-get="/api/flows/runs/${runId}" hx-target="#flow-result" hx-swap="innerHTML">${tStr("flow_engine.refresh_status")}</button>
      <button class="btn btn-outline btn-warning btn-sm join-item" hx-post="/api/flows/runs/${runId}/cancel" hx-target="#flow-result" hx-swap="innerHTML" ${isTerminal ? "disabled" : ""}>${tStr("layout.confirm_modal_cancel")}</button>
      <button class="btn btn-outline btn-sm join-item" hx-post="/api/flows/runs/${runId}/pause" hx-target="#flow-result" hx-swap="innerHTML" ${(isTerminal || isPaused) ? "disabled" : ""}>${tStr("api.pause")}</button>
      <button class="btn btn-outline btn-sm join-item" hx-post="/api/flows/runs/${runId}/resume" hx-target="#flow-result" hx-swap="innerHTML" ${(isTerminal || !isPaused) ? "disabled" : ""}>${tStr("api.resume")}</button>
      <a class="btn btn-outline btn-sm join-item" href="/api/flows/runs/${runId}/logs" target="_blank" rel="noopener">${tStr("api.logs_sse")}</a>
    </div>`
    : "";

  const failedResults = data?.result?.results.filter((result) => result.state !== "success") ?? [];
  const replayControls = runId && failedResults.length > 0
    ? `<div class="mt-3">
      <h4 class="font-semibold text-sm mb-2">${tStr("api.replay_failed_step")}</h4>
      <div class="flex flex-wrap gap-2">
        ${failedResults.map((result) => `<form hx-post="/api/flows/runs/${runId}/replay-step" hx-target="#flow-result" hx-swap="innerHTML">
          <input type="hidden" name="commandIndex" value="${result.commandIndex}" />
          <button class="btn btn-outline btn-xs" type="submit">${tInterp("api.replay_step_btn", { index: String(result.commandIndex + 1), commandType: result.commandType })}</button>
        </form>`).join("")}
      </div>
    </div>`
    : "";

  const output = data?.result
    ? `<div class="overflow-x-auto">
      <table class="table table-pin-rows table-sm">
        <thead>
          <tr><th>${tStr("api.table_index")}</th><th>${tStr("api.table_command")}</th><th>${tStr("api.table_state")}</th><th>${tStr("api.table_details")}</th><th>${tStr("api.table_artifact")}</th></tr>
        </thead>
        <tbody>${renderFlowCommandResultRows(data.result.results, true)}</tbody>
      </table>
    </div>`
    : `<div class="alert alert-soft mt-3" role="alert">
      <span>${tStr("api.no_step_output")}</span>
    </div>`;

  const timeline = data?.result?.actions && data.result.actions.length > 0
    ? `<ul class="timeline timeline-vertical mt-4">
      ${data.result.actions.map((action) => {
        const lastAttempt = action.attempts.at(-1);
        const isSuccess = lastAttempt?.state === "success";
        return `<li>
          <div class="timeline-start">${action.commandIndex + 1}</div>
          <div class="timeline-middle">
            <span class="status ${isSuccess ? "status-success" : "status-error"}"></span>
          </div>
          <div class="timeline-end timeline-box">
            <div class="font-mono text-xs">${esc(action.commandType)}</div>
            <div class="text-xs opacity-70">${esc(lastAttempt?.message ?? FLOW_PENDING_STATE_LABEL)}</div>
          </div>
          <hr />
        </li>`;
      }).join("")}
    </ul>`
    : "";

  const loadingBadge = data && (data.status === "queued" || data.status === "running" || data.status === "paused")
    ? `<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>`
    : "";
  const inlineLogs = runId
    ? renderLiveLogTable(
      `flow-log-stream-${toSafeDomIdSegment(runId)}`,
      `/api/flows/runs/${runId}/logs?format=html&tail=1`,
    )
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.flow_run_job_title"), summary, details)}
    ${data ? `<div class="alert alert-outline mt-2" role="alert">
      <span class="font-semibold">${tStr("api.run_lifecycle")} ${loadingBadge}</span>
    </div>
    <div class="mt-2">${statusSteps}</div>
    <ul class="text-xs list-disc list-inside space-y-1 mt-3">
      <li>${tStr("api.flow_run_id")}: ${esc(data.runId)}</li>
      <li>${tStr("api.flow_run_status")}: ${esc(data.status)}</li>
      <li>${tStr("api.flow_run_elapsed")}: ${data.elapsedMs}ms</li>
    </ul>` : ""}
    <div class="mt-3">${controls}</div>
    ${inlineLogs}
    ${replayControls}
    ${output}
    ${timeline}`,
  );
}

/** Render parse-only flow validation envelope with deterministic command rows. */
export function renderFlowValidateState(route: string, envelope: FlowValidateEnvelope): string {
  const data = envelope.data;
  const validationRows = data ? renderFlowCommandResultRows(buildValidationCommandRows(data), false) : "";
  const mismatches = envelope.mismatches ?? [];
  const errorReason = envelope.error && isFlowRuntimeError(envelope.error) ? envelope.error.reason : undefined;

  if (envelope.state === "success" && data) {
    return renderEnvelopeSection(
      route,
      envelope,
      `      ${renderStatusEnvelope(route, envelope, tStr("api.flow_validate_ready"), tInterp("api.flow_validate_summary", {
        appId: data.appId,
        commands: String(data.commandCount),
      }))}
      ${renderCommandTable(validationRows, [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_state"), tStr("api.table_details")], tStr("api.table_flow_validation"))}`,
    );
  }

  const details = [...mismatches];
  if (errorReason) {
    details.push(errorReason);
  }

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.flows_parse_failed"), details)}`,
  );
}

/** Render flow automation validation envelope with command-level capability flags. */
export function renderFlowAutomationValidateState(route: string, envelope: FlowAutomationValidateEnvelope): string {
  const data = envelope.data;
  const rows = data
    ? data.steps
      .map((step) => {
        const chipClass = step.supported ? "badge-success" : "badge-error";
        return `<tr>
          <td>${step.index + 1}</td>
          <td><code>${esc(step.commandType)}</code></td>
          <td><span class="badge badge-xs ${chipClass}">${esc(String(step.supported))}</span></td>
          <td>${esc(step.reason ?? "")}</td>
        </tr>`;
      })
      .join("")
    : "";

  const summary = data
    ? `${data.supportedCommandCount}/${data.commandCount} supported`
    : "no steps";
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const automationHeaders: readonly [string, string, string, string] = [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_supported"), tStr("api.table_reason")];
  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.automation_validation_title"), summary, details)}
    ${data ? `${renderCommandTable(rows, automationHeaders, tStr("api.table_flow_automation"))}
    <p class="text-xs text-base-content/70">
      ${esc(`appId: ${data.appId}`)}
    </p>` : ""}`,
  );
}

/** Render flow capability matrix for preflight run admission checks. */
export function renderFlowCapabilityMatrixState(route: string, envelope: FlowCapabilityMatrixEnvelope): string {
  const data = envelope.data;
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const heading = tStr("api.flow_capability_matrix");
  const message = data
    ? `${data.target} readiness: ${data.ready ? tStr("api.flow_capability_ready") : tStr("api.flow_capability_not_ready")}`
    : tStr("api.flow_capability_none");

  const commandRows = data
    ? data.commands.map((command) => `<tr>
      <td><code>${esc(command.commandType)}</code></td>
      <td>${command.supported ? `<span class="badge badge-success badge-sm" aria-label="${tStr("api.yes")}">${tStr("api.yes")}</span>` : `<span class="badge badge-error badge-sm" aria-label="${tStr("api.no")}">${tStr("api.no")}</span>`}</td>
      <td>${esc(command.reason ?? "")}</td>
    </tr>`).join("")
    : "";

  const requirementRows = data
    ? data.requirements.map((requirement) => `<tr>
      <td><code>${esc(requirement.id)}</code></td>
      <td>${esc(requirement.description)}</td>
      <td>${requirement.required ? `<span class="badge badge-ghost badge-sm" aria-label="${tStr("api.required")}">${tStr("api.required")}</span>` : `<span class="badge badge-ghost badge-sm" aria-label="${tStr("api.optional")}">${tStr("api.optional")}</span>`}</td>
      <td>${requirement.installed ? `<span class="badge badge-success badge-sm" aria-label="${tStr("api.yes")}">${tStr("api.yes")}</span>` : `<span class="badge badge-error badge-sm" aria-label="${tStr("api.no")}">${tStr("api.no")}</span>`}</td>
    </tr>`).join("")
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, heading, message, details)}
    ${data ? `${renderCommandTable(commandRows, [tStr("api.table_command"), tStr("api.table_supported"), tStr("api.table_reason")], tStr("api.flow_command_capabilities"))}
    <div class="mt-3">${renderCommandTable(requirementRows, [tStr("api.table_requirement"), tStr("api.table_description"), tStr("api.table_type"), tStr("api.table_installed")], tStr("api.flow_target_requirements"))}</div>` : ""}`,
  );
}

/** Render provider validation matrix and summary states. */
export function renderProviderValidationState(route: string, envelope: ProviderValidationEnvelope): string {
  const data = envelope.data;
  const heading = tStr("ai_providers.validation_summary");
  const message = data
    ? tInterp("api.provider_validation_summary_template", {
      reachable: String(data.reachableCount),
      total: String(data.total),
      configured: String(data.configuredCount),
    })
    : tStr("api.request_failed");
  const details = envelope.mismatches ?? [];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const retryConfig: RetryConfig | undefined = envelope.state === "error-retryable"
    ? { method: "post", url: "/api/ai/providers/validate", include: "#providers-validation-form", targetId: "providers-validation-result", spinnerId: "providers-validate-spinner" }
    : undefined;
  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, heading, message, details, retryConfig)}
    ${data ? `<div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200">
      <div class="stat">
        <div class="stat-title">${tStr("ai_providers.validation_providers_stat")}</div>
        <div class="stat-value text-lg">${data.total}</div>
      </div>
      <div class="stat">
        <div class="stat-title">${tStr("ai_providers.validation_configured")}</div>
        <div class="stat-value text-lg">${data.configuredCount}</div>
      </div>
      <div class="stat">
        <div class="stat-title">${tStr("ai_providers.validation_reachable")}</div>
        <div class="stat-value text-lg">${data.reachableCount}</div>
      </div>
    </div>` : ""}`,
  );
}

export function renderPreferenceStateEnvelope(route: string, envelope: PreferenceRunEnvelope): string {
  const payload = envelope.data;
  const lines = [
    tInterp("api.prefs_saved_detail", {
      theme: payload?.effectiveTheme ?? DEFAULT_THEME,
      model: payload?.effectiveModel ?? DEFAULT_CHAT_MODEL,
    }),
    ...(envelope.mismatches ?? []),
  ];

  const heading = envelope.state === "success" ? tStr("api.prefs_saved") : tStr("api.request_failed");
  const message = envelope.state === "success"
    ? tInterp("api.prefs_saved_detail", {
      theme: payload?.effectiveTheme ?? DEFAULT_THEME,
      model: payload?.effectiveModel ?? DEFAULT_CHAT_MODEL,
    })
    : tStr("api.prefs_saved_with_warnings");

  return renderStatusEnvelope(route, envelope, heading, message, lines);
}

export function renderChatRunState(route: string, envelope: ChatRunEnvelope, userMessage?: string): string {
  const content = envelope.data?.reply ?? "";
  const details = envelope.mismatches ?? [];
  const speechTranscript = envelope.data?.speech?.transcript ?? "";
  const tts = envelope.data?.tts;
  const speechBubble = speechTranscript.length > 0
    ? `<div class="chat chat-end" aria-label="${esc(tStr("ai_providers.speech_transcript_aria"))}">
      <div class="chat-bubble chat-bubble-primary text-xs whitespace-pre-wrap opacity-70">${esc(speechTranscript)}</div>
    </div>`
    : "";
  const ttsBubble = tts
    ? `<div class="chat chat-start" aria-label="${esc(tStr("ai_providers.tts_response_aria"))}">
        <div class="chat-bubble chat-bubble-primary text-sm">
          <audio controls preload="none" src="data:${esc(tts.mimeType)};base64,${esc(tts.data)}"></audio>
        </div>
      </div>`
    : "";

  if (envelope.state === "success") {
    const mismatchBlock = details.length > 0
      ? `<div class="text-xs mt-2 alert alert-warning" role="alert" aria-live="polite">${details.map((line) => `<p>${esc(line)}</p>`).join("")}</div>`
      : "";
    const userBubble = userMessage
      ? `<div class="chat chat-end"><div class="chat-bubble chat-bubble-neutral text-sm whitespace-pre-wrap">${esc(userMessage)}</div></div>`
      : "";
    return `<section class="space-y-2" data-state="${envelope.state}" data-envelope="${serializeEnvelope(route, envelope)}" aria-live="polite">
      ${userBubble}
      ${speechBubble}
      ${ttsBubble}
      <div class="chat chat-start">
        <div class="chat-bubble chat-bubble-primary text-sm whitespace-pre-wrap">${esc(content)}</div>
      </div>
      ${mismatchBlock}
    </section>`;
  }

  return renderStatusEnvelope(
    route,
    envelope,
    tStr("api.request_failed"),
    envelope.error?.reason ?? tStr("api.request_failed"),
    details,
  );
}

type ModelSelectionState = "success" | "empty" | "unauthorized" | "error-retryable" | "error-non-retryable";

/** Sanitize raw API errors for user-facing display: truncate, extract JSON messages, strip status prefixes. */
function sanitizeApiErrorForDisplay(error: string): string {
  const trimmed = error.trim();
  if (!trimmed) return "Unknown error";
  const jsonMatch = trimmed.match(/\{"error"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) {
    const msg = jsonMatch[1].trim();
    return msg.length > 120 ? msg.slice(0, 117) + "…" : msg;
  }
  const withoutStatus = trimmed.replace(/^\d{3}:\s*/, "");
  return withoutStatus.length > 120 ? withoutStatus.slice(0, 117) + "…" : withoutStatus;
}

export function modelSelectionBadgeClass(state: ModelSelectionState): string {
  if (state === "success") return "badge-success";
  if (state === "unauthorized") return "badge-warning";
  if (state === "empty") return "badge-ghost";
  return "badge-error";
}

export function renderModelSelectionState(
  providerId: ProviderId,
  state: ModelSelectionState,
  message: string,
  stateId?: string,
): string {
  const targetId = stateId ?? `model-state-${providerId}`;
  const isError = state === "error-retryable" || state === "error-non-retryable";
  const alertClass = state === "error-retryable" ? "alert-warning" : "alert-error";
  const retryHint = state === "error-retryable" ? ` ${tStr("api.models_load_retry_hint")}` : "";
  if (isError) {
    return `<div id="${targetId}" class="text-xs min-h-[1.25rem]" role="alert" aria-live="polite" data-state="${state}" hx-swap-oob="outerHTML"><div class="alert ${alertClass} shadow-sm text-sm py-2">${esc(message)}${esc(retryHint)}</div></div>`;
  }
  return `<div id="${targetId}" class="text-xs min-h-[1.25rem]" role="status" aria-live="polite" data-state="${state}" hx-swap-oob="outerHTML"><span class="badge badge-sm ${modelSelectionBadgeClass(state)}">${esc(message)}</span></div>`;
}

export function renderModelSelectionOptions(
  providerId: ProviderId,
  optionsHtml: string,
  state: ModelSelectionState,
  message: string,
  stateId?: string,
): string {
  return `${optionsHtml}${renderModelSelectionState(providerId, state, message, stateId)}`;
}

export function buildModelSelectOptions(
  models: readonly string[],
  selectedModel: string | undefined,
): string {
  const hasSelected = Boolean(selectedModel && selectedModel.trim().length > 0);
  const placeholder = `<option value="" disabled ${hasSelected ? "" : "selected"}>${esc(tStr("api.model_selection_placeholder"))}</option>`;
  const optionRows = models
    .map((name) => `<option value="${esc(name)}"${name === selectedModel ? " selected" : ""}>${esc(name)}</option>`)
    .join("");
  return `${placeholder}${optionRows}`;
}

/** Render model-pull capability envelope. */
export function renderModelPullState(route: string, envelope: ModelPullEnvelope): string {
  const pollPath = envelope.jobId ? `${MODEL_PULL_ROUTE}/${envelope.jobId}` : route;
  const data = envelope.data;
  const summary = data
    ? `requested=${data.requestedModelRef}, normalized=${data.normalizedModelRef}, status=${data.status}`
    : tStr("api.no_data");
  const dataRows = data
    ? `<ul class="text-xs list-disc list-inside space-y-1">
      <li>${tStr("api.envelope_job_id")}: ${esc(envelope.jobId)}</li>
      <li>${tStr("api.envelope_requested_model")}: ${esc(data.requestedModelRef)}</li>
      <li>${tStr("api.envelope_normalized_model")}: ${esc(data.normalizedModelRef)}</li>
      <li>${tStr("api.envelope_exit_code")}: ${data.exitCode === null ? "-" : String(data.exitCode)}</li>
    </ul>`
    : "";

  return renderPollingEnvelope(route, envelope, {
    title: tStr("api.model_pull_title"),
    summary,
    dataRows,
    pollPath,
    targetId: "#model-pull-result",
    spinnerId: "model-pull-refresh-spinner",
    artifactPath: data?.artifactPath ?? undefined,
    refreshLabel: tStr("model_mgmt.refresh"),
    artifactLabel: tStr("api.open_artifact"),
  });
}

/** Format a number with compact notation (e.g. 1.2k, 3.4M). */
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Render model search results envelope. */
export function renderModelSearchState(route: string, envelope: ModelSearchEnvelope): string {
  if (envelope.state === "loading") {
    return renderStatusEnvelope(route, envelope, tStr("model_search.title"), tStr("model_search.searching"));
  }
  if (envelope.state === "empty") {
    return renderStatusEnvelope(route, envelope, tStr("model_search.title"), tStr("model_search.no_results"));
  }
  if (envelope.state === "error-retryable" || envelope.state === "error-non-retryable") {
    return renderStatusEnvelope(
      route,
      envelope,
      tStr("model_search.title"),
      envelope.error?.reason ?? tStr("model_search.error"),
      envelope.mismatches ?? [],
      envelope.state === "error-retryable"
        ? { method: "get", url: MODEL_SEARCH_ROUTE, targetId: "model-search-result" }
        : undefined,
    );
  }

  const data = envelope.data!;
  const countBadge = `<span class="badge badge-primary badge-sm">${data.totalResults}</span>`;
  const heading = `${countBadge} ${esc(tInterp("model_search.results_count", { count: String(data.totalResults) }))}`;

  const cards = data.models
    .map((m: HfModelSearchHit) => {
      const tag = m.pipelineTag ? `<span class="badge badge-ghost badge-xs">${esc(m.pipelineTag)}</span>` : "";
      return `<div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors">
        <div class="min-w-0 flex-1">
          <p class="font-mono text-xs truncate font-medium">${esc(m.id)}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[10px] text-base-content/50" aria-label="${esc(tStr("model_search.downloads"))}">\u2B07 ${formatCompact(m.downloads)}</span>
            <span class="text-[10px] text-base-content/50" aria-label="${esc(tStr("model_search.likes"))}">\u2661 ${formatCompact(m.likes)}</span>
            ${tag}
          </div>
        </div>
        <button type="button" class="btn btn-outline btn-xs shrink-0"
          data-preset-target="model-ref-input" data-preset-value="${esc(m.id)}"
          aria-label="${esc(tInterp("model_search.use_aria", { model: m.id }))}">${tStr("model_search.use_model")}</button>
      </div>`;
    })
    .join("\n");

  return renderEnvelopeSection(
    route,
    envelope,
    `<div class="space-y-2">
      <p class="text-sm">${heading}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">${cards}</div>
    </div>`,
  );
}

/** Render app build capability envelope. */
export function renderAppBuildState(route: string, envelope: AppBuildEnvelope): string {
  const pollPath = envelope.jobId ? `${APP_BUILD_ROUTE}/${envelope.jobId}` : route;
  const data = envelope.data;
  const summary = data
    ? `${data.platform} buildType=${data.buildType}, artifact=${data.artifactPath ?? APP_BUILD_ARTIFACT_PENDING_LABEL}`
    : tStr("api.no_data");
  const dataRows = data
    ? `<ul class="text-xs list-disc list-inside space-y-1">
      <li>${tStr("api.envelope_platform")}: ${esc(data.platform)}</li>
      <li>${tStr("api.envelope_build_type")}: ${esc(data.buildType)}</li>
      <li>${tStr("api.envelope_exit_code")}: ${data.exitCode === null ? "-" : String(data.exitCode)}</li>
      <li>${tStr("api.envelope_elapsed_ms")}: ${data.elapsedMs}</li>
    </ul>`
    : "";
  const details = [
    `${tStr("api.envelope_state")}: ${envelope.state}`,
    ...(envelope.mismatches ?? []),
  ];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const refreshButton = envelope.state === "loading"
    ? `<button class="btn btn-outline btn-xs" hx-get="${pollPath}" hx-target="#app-build-result" hx-swap="innerHTML" hx-indicator="#app-build-refresh-spinner" hx-disabled-elt="this">${tStr("app_build.refresh")}${htmxSpinner("app-build-refresh-spinner", "ml-1")}</button>`
    : "";
  const cancelButton = envelope.jobId && envelope.state === "loading"
    ? `<button class="btn btn-outline btn-xs btn-warning" hx-post="${APP_BUILD_ROUTE}/${envelope.jobId}/cancel" hx-target="#app-build-result" hx-swap="innerHTML">${tStr("layout.confirm_modal_cancel")}</button>`
    : "";
  const resumeButton = envelope.jobId && envelope.state !== "loading"
    ? `<button class="btn btn-outline btn-xs" hx-post="${APP_BUILD_ROUTE}/${envelope.jobId}/resume" hx-target="#app-build-result" hx-swap="innerHTML">${tStr("api.resume")}</button>`
    : "";
  const logsLink = envelope.jobId
    ? `<a class="link link-primary text-xs" href="${APP_BUILD_ROUTE}/${envelope.jobId}/logs" target="_blank" rel="noopener">${tStr("api.logs_sse")}</a>`
    : "";
  const artifactLink = data?.artifactPath
    ? `<a class="link link-primary text-xs" href="${esc(data.artifactPath)}" target="_blank" rel="noopener">${tStr("api.open_artifact")}</a>`
    : "";
  const inlineLogs = envelope.jobId
    ? renderLiveLogTable(
      `app-build-log-stream-${toSafeDomIdSegment(envelope.jobId)}`,
      `${APP_BUILD_ROUTE}/${envelope.jobId}/logs?format=html&tail=1`,
    )
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.app_build_title"), summary, details)}
    ${dataRows}
    <div class="flex flex-wrap gap-2">
      ${refreshButton}
      ${cancelButton}
      ${resumeButton}
      ${logsLink}
      ${artifactLink}
    </div>
    ${inlineLogs}`,
  );
}

export function toFlowMismatches(result: FlowRunResult): string[] {
  return result.results
    .flatMap((step) => {
      if (step.state === "success") return [];
      const base = `${step.commandType} failed at command ${step.commandIndex + 1}.`;
      if (!step.error) {
        return [base];
      }
      return [
        `${base} ${step.error.reason}${step.error.retryable ? " (retryable)" : ""}`,
      ];
    });
}

export function normalizeFailureMessage(failure: CapabilityFailure): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  if (
    typeof failure === "object"
    && failure !== null
    && "message" in failure
    && typeof failure.message === "string"
  ) {
    return failure.message;
  }
  if (typeof failure === "string") {
    return failure;
  }
  if (typeof failure === "number" || typeof failure === "boolean") {
    return String(failure);
  }
  return tStr("api.request_failed");
}

export function toCapabilityError(
  failure: CapabilityFailure,
  command: string,
  surface?: FlowCapabilitySurface,
): FlowCapabilityError {
  if (isFlowCapabilityError(failure)) {
    return failure;
  }
  return createFlowCapabilityError({
    commandIndex: -1,
    command,
    reason: normalizeFailureMessage(failure),
    retryable: false,
    surface,
  });
}


/** Execute and render `/api/flows/run` and `/api/flows/trigger` with strict envelopes. */
async function runFlow(
  route: FlowRunRoute,
  rawBody: RequestBodyRecord | null | undefined,
  services: ControlPlaneServices,
): Promise<string> {
  if (!isFlowRunRoute(route)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "route",
      reason: "Unsupported flow run endpoint.",
      retryable: false,
      surface: "flow",
    });
  }
  const body = parseFlowRunRequestBody(rawBody);

  if (body.yaml && Buffer.byteLength(body.yaml, "utf8") > MAX_YAML_BYTES) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "yaml",
      reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
      retryable: false,
      surface: "flow",
    });
    const errorEnvelope: FlowRunEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowRunState(route, errorEnvelope);
  }

  if (!body.yaml || body.yaml.trim().length === 0) {
    const envelope: FlowRunEnvelope = {
      route,
      state: "empty",
      mismatches: [tInterp("api.flows_no_yaml_detail", {})],
    };
    return renderFlowRunState(route, envelope);
  }

  const runFlowRequest = services.runFlow;
  if (!runFlowRequest) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "runtime",
      reason: "Flow execution service is unavailable.",
      retryable: false,
      surface: "flow",
    });
    const errorEnvelope: FlowRunEnvelope = {
      route,
      state: flowError.retryable ? "error-retryable" : "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowRunState(route, errorEnvelope);
  }

  return Promise.resolve(runFlowRequest(body)).then((result) => {
    if (!result) {
      const flowError = createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow execution service returned no result.",
        retryable: false,
        surface: "flow",
      });
      const errorEnvelope: FlowRunEnvelope = {
        route,
        state: "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowRunState(route, errorEnvelope);
    }

    const mismatches = toFlowMismatches(result);
    const envelope: FlowRunEnvelope = {
      route,
      state: result.state,
      data: result,
      mismatches,
    };
    return renderFlowRunState(route, envelope);
  }, (failure: CapabilityFailure) => {
    const flowError = toCapabilityError(failure, "flow");
    const errorEnvelope: FlowRunEnvelope = {
      route,
      state: flowError.retryable ? "error-retryable" : "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowRunState(route, errorEnvelope);
  });
}

/** Parse-only flow validation endpoint without runtime command execution. */
async function validateFlowYaml(
  route: "/api/flows/validate",
  rawBody: RequestBodyRecord | null | undefined,
): Promise<string> {
  const body = parseFlowRunRequestBody(rawBody);

  if (body.yaml && Buffer.byteLength(body.yaml, "utf8") > MAX_YAML_BYTES) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "yaml",
      reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
      retryable: false,
      surface: "flow",
    });
    const envelope: FlowValidateEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowValidateState(route, envelope);
  }

  if (!body.yaml || body.yaml.trim().length === 0) {
    const envelope: FlowValidateEnvelope = {
      route,
      state: "empty",
      mismatches: [tInterp("api.flows_no_yaml_detail", {})],
    };
    return renderFlowValidateState(route, envelope);
  }

  return Promise.resolve()
    .then(() => parseMaestroYaml(body.yaml))
    .then((flow) => {
      const data: FlowValidationResult = {
        appId: flow.appId,
        commandCount: flow.steps.length,
        commandTypes: flow.steps.map((step) => step.type),
      };
      const envelope: FlowValidateEnvelope = {
        route,
        state: "success",
        data,
        mismatches: [],
      };
      return renderFlowValidateState(route, envelope);
    }, (failure) => {
      const flowError = toCapabilityError(failure, "flow_validate");
      const envelope: FlowValidateEnvelope = {
        route,
        state: flowError.retryable ? "error-retryable" : "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowValidateState(route, envelope);
    });
}

/** Parse flow YAML and return per-step automation support details. */
async function validateFlowAutomation(
  route: "/api/flows/validate/automation",
  rawBody: RequestBodyRecord | null | undefined,
): Promise<string> {
  const body = parseFlowRunRequestBody(rawBody);

  if (body.yaml && Buffer.byteLength(body.yaml, "utf8") > MAX_YAML_BYTES) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "yaml",
      reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
      retryable: false,
      surface: "flow_automation",
    });
    const envelope: FlowAutomationValidateEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowAutomationValidateState(route, envelope);
  }

  if (!body.yaml || body.yaml.trim().length === 0) {
    const envelope: FlowAutomationValidateEnvelope = {
      route,
      state: "empty",
      mismatches: [tInterp("api.flows_no_yaml_detail", {})],
    };
    return renderFlowAutomationValidateState(route, envelope);
  }

  return Promise.resolve()
    .then(() => analyzeFlowAutomationCompatibility(body.yaml, body.target ?? DEFAULT_FLOW_TARGET))
    .then(({ data, mismatches, targetReadinessFailure }) => {
      const isComplete = data.supportedCommandCount === data.commandCount;
      const state = targetReadinessFailure
        ? (targetReadinessFailure.retryable ? "error-retryable" : "error-non-retryable")
        : isComplete
          ? "success"
          : "error-non-retryable";
      const envelope: FlowAutomationValidateEnvelope = {
        route,
        state,
        error: targetReadinessFailure ?? undefined,
        data,
        mismatches,
      };
      return renderFlowAutomationValidateState(route, envelope);
    }, (failure) => {
      const flowError = toCapabilityError(failure, "flow_automation", "flow_automation");
      const envelope: FlowAutomationValidateEnvelope = {
        route,
        state: flowError.retryable ? "error-retryable" : "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowAutomationValidateState(route, envelope);
    });
}

/** Resolve and render target capability matrix. */
async function flowCapabilityMatrix(route: "/api/flows/capabilities", targetRaw: RequestFieldValue): Promise<string> {
  const target = parseFlowTarget(targetRaw);
  return Promise.resolve()
    .then(() => getFlowCapabilityMatrix(target))
    .then((data): string => {
      const envelope: FlowCapabilityMatrixEnvelope = {
        route,
        state: data.ready ? "success" : "error-non-retryable",
        data,
        mismatches: data.ready ? [] : data.requirements.filter((item) => item.required && !item.installed).map((item) => item.description),
      };
      return renderFlowCapabilityMatrixState(route, envelope);
    }, (failure): string => {
      const capabilityError = toCapabilityError(failure, "flow_capabilities", "flow_capabilities");
      const envelope: FlowCapabilityMatrixEnvelope = {
        route,
        state: capabilityError.retryable ? "error-retryable" : "error-non-retryable",
        error: capabilityError,
        mismatches: [capabilityError.reason],
      };
      return renderFlowCapabilityMatrixState(route, envelope);
    });
}

export function parseProviderValidationBody(body: RequestBodyRecord | null | undefined): { connectivity: boolean } {
  const connectivity = parseOptionalBoolean(body?.connectivity) === true;
  return { connectivity };
}

async function validateProviders(connectivity: boolean): Promise<ProviderValidationEnvelope> {
  const providerRows = await Promise.all(PROVIDERS.map(async (provider): Promise<ProviderValidationItem> => {
    const apiKey = (getApiKey(provider.id) ?? "").trim();
    const baseUrl = (getBaseUrl(provider.id) ?? provider.baseUrl).trim();
    const configured = provider.requiresKey ? apiKey.length > 0 : true;

    if (!configured) {
      return {
        provider: provider.id,
        configured,
        reachable: false,
        message: tStr("ai_providers.validation_config_missing"),
      };
    }

    if (!connectivity) {
      return {
        provider: provider.id,
        configured,
        reachable: true,
        message: tStr("ai_providers.validation_ok"),
      };
    }

    return testConnection(provider.id, apiKey, baseUrl).then((result) => ({
        provider: provider.id,
        configured,
        reachable: result.ok,
        message: result.ok ? tStr("ai_providers.validation_ok") : `${tStr("ai_providers.validation_connectivity_failed")}: ${result.error ?? tStr("api.connection_failed")}`,
      }));
  }));

  const configuredCount = providerRows.filter((row) => row.configured).length;
  const reachableCount = providerRows.filter((row) => row.reachable).length;
  const total = providerRows.length;
  const hasConfiguredUnreachable = providerRows.some((row) => row.configured && !row.reachable);
  const hasFailures = configuredCount > 0 && hasConfiguredUnreachable;

  const data: ProviderValidationResult = {
    total,
    configuredCount,
    reachableCount,
    providers: providerRows,
  };

  const state = hasFailures ? "error-retryable" : configuredCount === 0 ? "empty" : "success";
  return {
    route: "/api/ai/providers/validate",
    state,
    data,
    mismatches: hasFailures ? [tStr("api.provider_validation_has_failures")] : [],
  };
}

type ChatModelResolution = {
  requestedModel: string | null;
  effectiveModel: string;
  mismatches: string[];
  state: ControlPlaneState;
  unauthorized: boolean;
};

/** Resolve chat model from explicit user selection and provider auth requirements. */
export function resolveChatModel(providerId: ProviderId, bodyModel: string | undefined, apiKey: string): ChatModelResolution {
  const provider = getProvider(providerId);
  if (!provider) {
    return {
      requestedModel: null,
      effectiveModel: "",
      mismatches: [tStr("api.unknown_provider")],
      state: "error-non-retryable",
      unauthorized: false,
    };
  }

  const requested = bodyModel?.trim().length ? bodyModel.trim() : null;

  if (provider.requiresKey && apiKey.trim().length === 0) {
    return {
      requestedModel: requested,
      effectiveModel: "",
      mismatches: [tStr("api.chat_key_required")],
      state: "unauthorized",
      unauthorized: true,
    };
  }

  if (!requested) {
    return {
      requestedModel: null,
      effectiveModel: "",
      mismatches: [tStr("api.no_model_selected")],
      state: "error-non-retryable",
      unauthorized: false,
    };
  }

  if (!isValidModelIdentifier(requested)) {
    return {
      requestedModel: requested,
      effectiveModel: "",
      mismatches: [tStr("api.invalid_model_selected")],
      state: "error-non-retryable",
      unauthorized: false,
    };
  }

  return {
    requestedModel: requested,
    effectiveModel: requested,
    mismatches: [],
    state: "success",
    unauthorized: false,
  };
}

/** Create the control-plane HTTP app without binding to a socket. */
export function createControlPlaneApp(options: CreateControlPlaneAppOptions = {}) {
  const services: ControlPlaneServices = {
    ...createDefaultControlPlaneServices(),
    ...options.services,
  };
  const flowTargetBodySchema = t.Optional(
    t.Union([
      t.Literal("android"),
      t.Literal("ios"),
      t.Literal("osx"),
      t.Literal("windows"),
      t.Literal("linux"),
    ]),
  );
  const flowRequestBodySchema = t.Object({
    yaml: t.String(),
    target: flowTargetBodySchema,
    maxAttempts: t.Optional(t.Union([t.Number(), t.String()])),
    commandTimeoutMs: t.Optional(t.Union([t.Number(), t.String()])),
    retryDelayMs: t.Optional(t.Union([t.Number(), t.String()])),
    correlationId: t.Optional(t.String()),
  });

  const publicDir = join(import.meta.dir, "..", "public");
  const syncActiveLocaleFromPreference = (): Locale => {
    const storedLocale = getPreference("locale");
    const locale = isSupportedLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE;
    setActiveLocale(locale);
    return locale;
  };
  syncActiveLocaleFromPreference();

  return new Elysia()
    .error({
      CONFIG_PARSE: ConfigParseError,
      UCP_FETCH: UCPFetchError,
      APP_BUILD: AppBuildExecutionError,
    })
    .use(staticPlugin({ prefix: "/public", assets: publicDir }))
    .onError(({ code, error, request, set }) => {
      if (error instanceof ConfigParseError) {
        const route = inferRouteFromRequest(request) ?? "/";
        set.status = error.statusCode;
        set.headers["content-type"] = HTML_CONTENT_TYPE;
        return renderStatusEnvelope(
          route,
          { route, state: "error-non-retryable", mismatches: [error.message] },
          tStr("api.request_failed"),
          error.message,
          [error.message],
        );
      }
      if (error instanceof UCPFetchError) {
        const route = inferRouteFromRequest(request) ?? "/api/ucp/discover";
        set.status = error.statusCode;
        set.headers["content-type"] = HTML_CONTENT_TYPE;
        const message = error.message;
        return renderStatusEnvelope(
          route,
          { route, state: error.retryable ? "error-retryable" : "error-non-retryable", mismatches: [message] },
          tStr("api.request_failed"),
          message,
          [message],
        );
      }
      if (error instanceof AppBuildExecutionError) {
        const route = inferRouteFromRequest(request) ?? APP_BUILD_ROUTE;
        set.status = error.statusCode;
        set.headers["content-type"] = HTML_CONTENT_TYPE;
        const message = error.message;
        return renderStatusEnvelope(
          route,
          {
            route,
            state: error.retryable ? "error-retryable" : "error-non-retryable",
            mismatches: [message],
          },
          tStr("api.request_failed"),
          message,
          [message],
        );
      }

      if (isFlowCapabilityError(error)) {
        set.status = error.retryable ? 503 : 400;
        set.headers["content-type"] = HTML_CONTENT_TYPE;
        const route = inferRouteFromRequest(request) ?? (error.surface === "model_pull" ? MODEL_PULL_ROUTE : error.surface === "app_build" ? APP_BUILD_ROUTE : FLOW_AUTOMATION_VALIDATE_ROUTE);
        const envelope: ApiEnvelope = {
          route,
          state: error.retryable ? "error-retryable" : "error-non-retryable",
          error,
          mismatches: [error.reason],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), error.reason, [error.reason]);
      }
      if (code === "NOT_FOUND") {
        const route = new URL(request.url).pathname;
        const message = tStr("api.route_not_found");
        logger.warn("Request route not found", { code, path: route });
        set.status = 404;
        set.headers["content-type"] = HTML_CONTENT_TYPE;
        return renderStatusEnvelope(
          route,
          { route, state: "error-non-retryable", mismatches: [message] },
          message,
          message,
          [message],
        );
      }
      logger.error("Unhandled request error", { code, path: new URL(request.url).pathname, error: String(error) });
      set.status = 500;
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return renderStatusEnvelope(
        "/",
        { route: "/", state: "error-non-retryable", mismatches: [tStr("api.request_failed")] },
        tStr("api.request_failed"),
        tStr("api.request_failed"),
        [String(error)],
      );
    })
    .onRequest(() => {
      syncActiveLocaleFromPreference();
    })
  .get("/favicon.ico", ({ set }) => {
    set.headers["content-type"] = "image/svg+xml";
    set.headers["cache-control"] = "public, max-age=86400";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#181510"/><path d="M16 6l8 4v8l-8 4-8-4V10z" fill="none" stroke="#C9A84C" stroke-width="1.5"/><path d="M16 6v16M8 10l8 4 8-4" fill="none" stroke="#C9A84C" stroke-width="1.2"/></svg>`;
  })
  .get("/", ({ set }) => {
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    const theme = getPreference("theme") ?? DEFAULT_THEME;
    return Dashboard(theme);
  })
  .get(API_HEALTH_ROUTE, ({ set }) => {
    set.headers["content-type"] = JSON_CONTENT_TYPE;
    return {
      route: API_HEALTH_ROUTE,
      status: "ok" as const,
    };
  })
  .group("/api/prefs", (app) => app
    .get("/theme/:theme", ({ params, set }) => {
      const theme = params.theme?.toLowerCase();
      if (theme && isSupportedTheme(theme)) {
        setPreference("theme", theme);
      }
      set.redirect = "/";
    })
    .get("/locale/:locale", ({ params, set }) => {
      const locale = params.locale?.toLowerCase();
      if (isSupportedLocale(locale)) {
        setPreference("locale", locale);
        setActiveLocale(locale);
      }
      set.redirect = "/";
    })
  .post("/", ({ body, set }) => {
    set.headers["content-type"] = HTML_CONTENT_TYPE;

    const requestedTheme = typeof body?.theme === "string" ? body.theme.trim() : "";
    const requestedModel = typeof body?.defaultModel === "string" ? body.defaultModel.trim() : "";
    const requestedLocale = typeof body?.locale === "string" ? body.locale.trim().toLowerCase() : "";
    const mismatches: string[] = [];

    const currentTheme = getPreference("theme") ?? DEFAULT_THEME;
    const currentModel = getPreference("defaultModel") ?? DEFAULT_CHAT_MODEL;
    const currentLocalePreference = getPreference("locale");
    const currentLocale: Locale = isSupportedLocale(currentLocalePreference) ? currentLocalePreference : DEFAULT_LOCALE;
    const hasInput = requestedTheme.length > 0 || requestedModel.length > 0 || requestedLocale.length > 0;

    if (!hasInput) {
      const envelope: PreferenceRunEnvelope = {
        route: "/api/prefs",
        state: "empty",
        data: {
          requestedTheme: null,
          effectiveTheme: currentTheme,
          requestedModel: null,
          effectiveModel: currentModel,
          requestedLocale: null,
          effectiveLocale: currentLocale,
        },
        mismatches: [],
      };
      return renderPreferenceStateEnvelope("/api/prefs", envelope);
    }

    if (requestedTheme) {
      if (!isSupportedTheme(requestedTheme)) {
        mismatches.push(tInterp("api.prefs_theme_invalid", { theme: requestedTheme }));
      } else if (requestedTheme !== currentTheme) {
        setPreference("theme", requestedTheme);
      }
    }

    if (requestedModel) {
      if (!isValidModelIdentifier(requestedModel)) {
        mismatches.push(tInterp("api.prefs_model_invalid", { model: requestedModel }));
      } else if (requestedModel !== currentModel) {
        setPreference("defaultModel", requestedModel);
      }
    }

    if (requestedLocale) {
      if (!isSupportedLocale(requestedLocale)) {
        mismatches.push(tInterp("api.prefs_locale_invalid", { locale: requestedLocale }));
      } else if (requestedLocale !== currentLocale) {
        setPreference("locale", requestedLocale);
        setActiveLocale(requestedLocale);
      }
    }

    const effectiveTheme = getPreference("theme") ?? DEFAULT_THEME;
    const effectiveModel = getPreference("defaultModel") ?? DEFAULT_CHAT_MODEL;
    const effectiveLocalePreference = getPreference("locale");
    const effectiveLocale: Locale = isSupportedLocale(effectiveLocalePreference) ? effectiveLocalePreference : DEFAULT_LOCALE;

    // Note: after a successful preference save, effectiveTheme/effectiveModel will
    // always equal the requested values. The runtimeMismatch check was removed as
    // it produced no output and was dead code post-save.

    const envelope: PreferenceRunEnvelope = {
      route: "/api/prefs",
      state: mismatches.length > 0 ? "error-retryable" : "success",
      data: {
        requestedTheme: requestedTheme.length > 0 ? requestedTheme : null,
        effectiveTheme,
        requestedModel: requestedModel.length > 0 ? requestedModel : null,
        effectiveModel,
        requestedLocale: requestedLocale.length > 0 ? requestedLocale : null,
        effectiveLocale,
      },
      mismatches,
    };

    const mainHtml = envelope.state === "success"
      ? ""
      : renderPreferenceStateEnvelope("/api/prefs", envelope);
    const toastHtml = envelope.state === "success"
      ? `<div id="toast-container" hx-swap-oob="innerHTML"><div class="alert alert-success" role="status"><span>${esc(tStr("api.prefs_saved"))}</span></div></div>`
      : "";
      return mainHtml + toastHtml;
    }, {
      body: t.Object({
        theme: t.Optional(t.String()),
        defaultModel: t.Optional(t.String()),
        locale: t.Optional(t.String()),
      }),
    })
  )
  .group("/api/models", (app) => app
    .get("/sources", ({ set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const envelope: ModelSourceRegistryEnvelope = {
        route: MODEL_SOURCE_ROUTE,
        state: MODEL_SOURCE_REGISTRY.length > 0 ? "success" : "empty",
        data: {
          defaultSource: DEFAULT_MODEL_SOURCE,
          sources: MODEL_SOURCE_REGISTRY,
        },
        mismatches: [],
      };
      return envelope;
    })
    .get("/search", async ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const q = typeof query.q === "string" ? query.q.trim() : "";
      if (!q) {
        const envelope: ModelSearchEnvelope = {
          route: MODEL_SEARCH_ROUTE,
          state: "error-non-retryable",
          data: { query: "", totalResults: 0, models: [] },
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "search",
            reason: tStr("model_search.query_required"),
            retryable: false,
            surface: "model_pull",
          }),
          mismatches: [tStr("model_search.query_required")],
        };
        return renderModelSearchState(MODEL_SEARCH_ROUTE, envelope);
      }
      const limit = Math.min(Math.max(1, Number(query.limit) || 12), 50);
      const sort = parseHfSearchSort(typeof query.sort === "string" ? query.sort : undefined);
      const searchResult = await searchHfModels({ query: q, limit, sort });
      if (!searchResult.ok) {
        const reason = searchResult.reason ?? tStr("api.request_failed");
        const envelope: ModelSearchEnvelope = {
          route: MODEL_SEARCH_ROUTE,
          state: "error-retryable",
          data: { query: q, totalResults: 0, models: [] },
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "search",
            reason,
            retryable: true,
            surface: "model_pull",
          }),
          mismatches: [reason],
        };
        return renderModelSearchState(MODEL_SEARCH_ROUTE, envelope);
      }

      const envelope: ModelSearchEnvelope = {
        route: MODEL_SEARCH_ROUTE,
        state: searchResult.models.length > 0 ? "success" : "empty",
        data: {
          query: q,
          totalResults: searchResult.models.length,
          models: searchResult.models,
        },
        mismatches: [],
      };
      return renderModelSearchState(MODEL_SEARCH_ROUTE, envelope);
    })
    .get("/", async ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const fallback = `<span class="badge badge-warning gap-1">${tStr("api.models_ramalama_not_found")}</span>`;
      const ramalamaPath = Bun.which("ramalama");
      if (!ramalamaPath) {
        return fallback;
      }
      return Promise.resolve()
        .then(() => Bun.spawn([ramalamaPath, "list"], { stdout: "pipe", stderr: "pipe" }))
        .then(async (proc) => {
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            return fallback;
          }
          const text = proc.stdout ? await new Response(proc.stdout).text() : "";
          const lines = text.split("\n").filter((line) => line.trim().length > 0);
          const count = Math.max(0, lines.length - 1);
          return `<span class="badge badge-success gap-1">${count}</span> ${tStr("api.models_found_suffix")}`;
        }, () => fallback);
    })
    .post("/pull", async ({ body, set }) => {
    set.headers["content-type"] = HTML_CONTENT_TYPE;
      return Promise.resolve()
        .then(() => parseModelPullRequestBody(toRequestBody(body)))
        .then((request) => services.startModelPullJob(request, "ui").then(
          (envelope) => ({ envelope, request }),
        ))
        .then(({ envelope }) => renderModelPullState(MODEL_PULL_ROUTE, envelope), (failure) => {
          const fallbackBody = toRequestBody(body);
          const requestedModelRef = fallbackBody?.modelRef && typeof fallbackBody.modelRef === "string"
            ? fallbackBody.modelRef.trim()
            : DEFAULT_CHAT_PULL_MODEL;
          const normalizedFailure = toCapabilityError(failure, "payload", "model_pull");
          const envelope: ModelPullEnvelope = {
            route: MODEL_PULL_ROUTE,
            state: normalizedFailure.retryable ? "error-retryable" : "error-non-retryable",
            jobId: "",
            data: {
              requestedModelRef,
              normalizedModelRef: requestedModelRef,
              status: "failed",
              exitCode: 1,
              stdout: "",
              stderr: normalizedFailure.reason,
              artifactPath: null,
              elapsedMs: 0,
              platform: (typeof fallbackBody?.platform === "string" && fallbackBody.platform.trim().length > 0)
                ? fallbackBody.platform.trim()
                : undefined,
            },
            error: normalizedFailure,
            mismatches: [normalizedFailure.reason],
          };
          return renderModelPullState(MODEL_PULL_ROUTE, envelope);
        });
    }, {
      body: t.Object({
        modelRef: t.Optional(t.String()),
        source: t.Optional(t.String()),
        platform: t.Optional(t.String()),
        force: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
        timeoutMs: t.Optional(t.Union([t.Number(), t.String()])),
        correlationId: t.Optional(t.String()),
      }),
    })
    .get("/pull/:jobId", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const envelope = services.getModelPullJobEnvelope(String(params.jobId));
      return renderModelPullState(`${MODEL_PULL_ROUTE}/${String(params.jobId)}`, envelope);
    })
  )
  .group("/api/ucp", (app) => app
    .get("/discover", async ({ headers, query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const url = query.url;
      const wantsJson = shouldReturnJsonResponse(
        typeof query.format === "string" ? query.format : undefined,
        extractAcceptHeader(headers),
      );
      if (wantsJson) {
        set.headers["content-type"] = JSON_CONTENT_TYPE;
      }
      if (!url) {
        const payload: UCPDiscoverResponse = { ok: false, error: "not_found", message: tStr("api.ucp_missing_url") };
        return wantsJson ? serializeUCPResponse(set, payload) : `<span class="text-error">${tStr("api.ucp_missing_url")}</span>`;
      }
      const result = await discoverBusinessCapabilitiesWithResult(url);
      if (!result.ok) {
        const errorKey: Record<UCPDiscoverError, string> = {
          not_found: "api.ucp_error_not_found",
          invalid_manifest: "api.ucp_error_invalid_manifest",
          invalid_json: "api.ucp_error_invalid_json",
          timeout: "api.ucp_error_timeout",
          network: "api.ucp_error_network",
        };
        if (wantsJson) {
          return serializeUCPResponse(set, {
            ok: false,
            error: result.error,
          });
        }
        return `<span class="text-warning">${tStr(errorKey[result.error])}</span>`;
      }
      if (wantsJson) {
        return serializeUCPResponse(set, result);
      }
      const manifest = result.manifest;
      const capCount = manifest.ucp.capabilities.length;
      const svcCount = Object.keys(manifest.ucp.services ?? {}).length;
      const handlerCount = manifest.payment?.handlers?.length ?? 0;
      const signingKeyCount = manifest.signing_keys?.length ?? 0;
      const capNames = manifest.ucp.capabilities
        .map((c) => `<li class="text-xs"><code class="bg-base-300 px-1 rounded">${esc(c.name)}</code></li>`)
        .join("");
      const handlerNames = (manifest.payment?.handlers ?? [])
        .map((h) => `<li class="text-xs"><code class="bg-base-300 px-1 rounded">${esc(h.name)}</code></li>`)
        .join("");
      const stats = [
        `<div class="stat"><div class="stat-title">${tStr("ucp.stat_version")}</div><div class="stat-value text-sm font-mono">${esc(manifest.ucp.version)}</div></div>`,
        `<div class="stat"><div class="stat-title">${tStr("ucp.stat_services")}</div><div class="stat-value text-lg">${svcCount}</div></div>`,
        `<div class="stat"><div class="stat-title">${tStr("ucp.stat_capabilities")}</div><div class="stat-value text-lg">${capCount}</div></div>`,
        `<div class="stat"><div class="stat-title">${tStr("ucp.stat_payment_handlers")}</div><div class="stat-value text-lg">${handlerCount}</div></div>`,
        ...(signingKeyCount > 0
          ? [`<div class="stat"><div class="stat-title">${tStr("ucp.stat_signing_keys")}</div><div class="stat-value text-lg">${signingKeyCount}</div></div>`]
          : []),
      ];
      return `<div class="stats stats-vertical shadow bg-base-200 w-full text-sm">
        ${stats.join("\n        ")}
      </div>
      ${capNames ? `<ul class="mt-2 text-base-content/70 space-y-1">${capNames}</ul>` : ""}
      ${handlerNames ? `<ul class="mt-2 text-base-content/70 space-y-1" aria-label="${tStr("ucp.stat_payment_handlers")}">${handlerNames}</ul>` : ""}`;
    })
  )
  .group("/api/flows", (app) => app
    .post("/run", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return await runFlow("/api/flows/run", toRequestBody(body), services);
    }, { body: flowRequestBodySchema })
    .post("/runs", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const request = parseFlowRunRequestBody(toRequestBody(body));
      if (request.yaml && Buffer.byteLength(request.yaml, "utf8") > MAX_YAML_BYTES) {
        const flowError = createFlowCapabilityError({
          commandIndex: -1,
          command: "yaml",
          reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
          retryable: false,
          surface: "flow",
        });
        const errorEnvelope: FlowRunJobEnvelope = {
          route: "/api/flows/runs",
          runId: "",
          state: "error-non-retryable",
          error: flowError,
          mismatches: [flowError.reason],
        };
        return renderFlowRunJobState("/api/flows/runs", errorEnvelope);
      }
      const start = services.startFlowRunJob ?? startFlowRunJob;
      const envelope = start(request, "ui");
      return renderFlowRunJobState("/api/flows/runs", envelope);
    }, { body: flowRequestBodySchema })
    .get("/runs/:runId", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const poll = services.getFlowRunJobEnvelope ?? getFlowRunJobEnvelope;
      const envelope = poll(String(params.runId));
      return renderFlowRunJobState(`/api/flows/runs/${String(params.runId)}`, envelope);
    })
    .post("/runs/:runId/cancel", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.cancelFlowRunJob ?? cancelFlowRunJob;
      const envelope = action(String(params.runId));
      return renderFlowRunJobState(`/api/flows/runs/${String(params.runId)}`, envelope);
    })
    .post("/runs/:runId/pause", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.pauseFlowRunJob ?? pauseFlowRunJob;
      const envelope = action(String(params.runId));
      return renderFlowRunJobState(`/api/flows/runs/${String(params.runId)}`, envelope);
    })
    .post("/runs/:runId/resume", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.resumeFlowRunJob ?? resumeFlowRunJob;
      const envelope = action(String(params.runId));
      return renderFlowRunJobState(`/api/flows/runs/${String(params.runId)}`, envelope);
    })
    .post("/runs/:runId/replay-step", ({ params, body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const commandIndex = parseOptionalInt(toRequestBody(body)?.commandIndex) ?? -1;
      const action = services.replayFlowRunStep ?? replayFlowRunStep;
      const envelope = action(String(params.runId), commandIndex);
      return renderFlowRunJobState(`/api/flows/runs/${String(params.runId)}`, envelope);
    }, {
      body: t.Object({
        commandIndex: t.Union([t.Number(), t.String()]),
      }),
    })
    .get("/runs/:runId/logs", async function* ({ params, query, request }) {
      const listEvents = services.getFlowRunLogEvents ?? getFlowRunLogEvents;
      const readEnvelope = services.getFlowRunJobEnvelope ?? getFlowRunJobEnvelope;
      const queryRecord = toRequestQuery(query);
      const format = parseLogStreamFormat(queryRecord);
      const tail = parseLogTailFlag(queryRecord);
      const runId = String(params.runId);
      yield* streamJobLogs({
        format,
        tail,
        initialCursor: parseLogCursor(queryRecord),
        request,
        jobId: runId,
        listEvents,
        readStatus: (jobId) => readEnvelope(jobId).data?.status,
      });
    }, {
      query: commandLogQuerySchema,
    })
    .post("/validate", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return await validateFlowYaml("/api/flows/validate", toRequestBody(body));
    }, { body: flowRequestBodySchema })
    .get("/capabilities", async ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const queryRecord = toRequestQuery(query);
      return await flowCapabilityMatrix("/api/flows/capabilities", queryRecord?.target);
    })
    .post("/validate/automation", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return await validateFlowAutomation("/api/flows/validate/automation", toRequestBody(body));
    }, { body: flowRequestBodySchema })
    .post("/trigger", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return await runFlow("/api/flows/trigger", toRequestBody(body), services);
    }, { body: flowRequestBodySchema })
  )
  .group(APP_BUILD_ROUTE, (app) => app
    .post("/", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const request = parseAppBuildRequestBody(toRequestBody(body));
      return services.startAppBuildJob(request, "ui").then(
        (envelope) => renderAppBuildState(APP_BUILD_ROUTE, envelope),
        (failure) => {
          const normalizedFailure = toCapabilityError(failure, "payload", "app_build");
          const envelope: AppBuildEnvelope = {
            route: APP_BUILD_ROUTE,
            state: normalizedFailure.retryable ? "error-retryable" : "error-non-retryable",
            jobId: "",
            error: normalizedFailure,
            mismatches: [normalizedFailure.reason],
          };
          return renderAppBuildState(APP_BUILD_ROUTE, envelope);
        },
      );
    }, {
      body: t.Object({
        platform: t.Union([t.Literal("android"), t.Literal("ios")]),
        buildType: t.Optional(t.Union([t.Literal("debug"), t.Literal("release")])),
        variant: t.Optional(t.String()),
        skipTests: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
        outputDir: t.Optional(t.String()),
        clean: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
        correlationId: t.Optional(t.String()),
      }),
    })
    .get("/:jobId", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const envelope = services.getAppBuildJobEnvelope(String(params.jobId));
      return renderAppBuildState(`${APP_BUILD_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .post("/:jobId/cancel", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.cancelAppBuildJob ?? cancelAppBuildJob;
      const envelope = action(String(params.jobId));
      return renderAppBuildState(`${APP_BUILD_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .post("/:jobId/resume", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.resumeAppBuildJob ?? resumeAppBuildJob;
      const envelope = action(String(params.jobId));
      return renderAppBuildState(`${APP_BUILD_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .get("/:jobId/logs", async function* ({ params, query, request }) {
      const listEvents = services.getAppBuildJobLogEvents ?? getAppBuildJobLogEvents;
      const readEnvelope = services.getAppBuildJobEnvelope ?? getAppBuildJobEnvelope;
      const queryRecord = toRequestQuery(query);
      const format = parseLogStreamFormat(queryRecord);
      const tail = parseLogTailFlag(queryRecord);
      const jobId = String(params.jobId);
      yield* streamJobLogs({
        format,
        tail,
        initialCursor: parseLogCursor(queryRecord),
        request,
        jobId,
        listEvents,
        readStatus: (id) => readEnvelope(id).data?.status,
      });
    }, {
      query: commandLogQuerySchema,
    })
  )
  .group("/api/ai", (app) => app
    .get("/providers", ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const statuses = getAllProviderStatuses(PROVIDERS.map((provider) => ({
        provider: provider.id,
        requiresKey: provider.requiresKey,
      })));
      const items = statuses
        .map((status) => {
          const meta = getProvider(status.provider);
          const badge = status.configured
            ? `<span class="badge badge-success badge-xs">${tStr("ai_providers.configured")}</span>`
            : `<span class="badge badge-ghost badge-xs">${tStr("ai_providers.not_set")}</span>`;
          return `<li class="flex items-center gap-2"><strong>${meta?.displayName ?? status.provider}</strong> ${badge}</li>`;
        })
        .join("");
      return `<ul class="space-y-1 text-sm">${items}</ul>`;
    })
    .post("/providers/validate", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const { connectivity } = parseProviderValidationBody(toRequestBody(body));
      return validateProviders(connectivity).then(
        (envelope) => renderProviderValidationState("/api/ai/providers/validate", envelope),
        (failure) => {
          const flowError = toCapabilityError(failure, "provider_validate");
          const envelope: ProviderValidationEnvelope = {
            route: "/api/ai/providers/validate",
            state: flowError.retryable ? "error-retryable" : "error-non-retryable",
            error: flowError,
            mismatches: [flowError.reason],
          };
          return renderProviderValidationState("/api/ai/providers/validate", envelope);
        },
      );
    }, {
      body: t.Object({
        connectivity: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
      }),
    })
    .post("/keys", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const route = "/api/ai/keys";
      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"), envelope.mismatches);
      }
      const meta = getProvider(provider);
      if (!meta) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"), envelope.mismatches);
      }

      const apiKey = parseOptionalTrimmedString(body.apiKey);
      const baseUrl = parseOptionalTrimmedString(body.baseUrl);
      if (meta.requiresKey && !apiKey) {
        const reason = tInterp("api.key_required", { provider: meta.displayName });
        const envelope: ApiEnvelope = {
          route,
          state: "unauthorized",
          mismatches: [reason],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), reason, envelope.mismatches);
      }

      if (provider === "ollama" && !baseUrl) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.base_url_required")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.base_url_required"), envelope.mismatches);
      }

      if (baseUrl && !isSupportedHttpUrl(baseUrl)) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tInterp("api.base_url_invalid", { url: baseUrl })],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.base_url_invalid_short"), envelope.mismatches);
      }

      saveApiKey(provider, apiKey ?? "", baseUrl);
      set.headers["HX-Trigger"] = `provider-config-updated-${provider}`;
      const toastHtml = `<div id="toast-container" hx-swap-oob="innerHTML"><div class="alert alert-success" role="status"><span>${esc(tInterp("api.key_saved", { provider: meta.displayName }))}</span></div></div>`;
      const envelope: ApiEnvelope = {
        route,
        state: "success",
        mismatches: [],
      };
      const successMessage = tInterp("api.key_saved", { provider: meta.displayName });
      return `${renderStatusEnvelope(route, envelope, meta.displayName, successMessage, [])}${toastHtml}`;
    }, {
      body: t.Object({
        provider: t.String(),
        apiKey: t.Optional(t.String()),
        baseUrl: t.Optional(t.String()),
      }),
    })
      .post("/keys/delete", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const route = "/api/ai/keys/delete";
      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"), envelope.mismatches);
      }
      const meta = getProvider(provider);
      if (!meta) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"), envelope.mismatches);
      }
      deleteApiKey(provider);
      set.headers["HX-Trigger"] = `provider-config-updated-${provider}`;
      const envelope: ApiEnvelope = {
        route,
        state: "success",
        mismatches: [],
      };
      const message = tInterp("api.key_removed", { provider: meta.displayName });
      return renderStatusEnvelope(route, envelope, meta.displayName, message, []);
    }, {
      body: t.Object({
        provider: t.String(),
      }),
    })
    .post("/test", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const route = "/api/ai/test";
      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"), envelope.mismatches);
      }
      const meta = getProvider(provider);
      if (!meta) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"), envelope.mismatches);
      }

      const apiKey = parseOptionalTrimmedString(body.apiKey) ?? (getApiKey(provider) ?? "");
      const baseUrl = parseOptionalTrimmedString(body.baseUrl) ?? getBaseUrl(provider) ?? meta.baseUrl;

      if (meta.requiresKey && apiKey.trim().length === 0) {
        const envelope: ApiEnvelope = {
          route,
          state: "unauthorized",
          mismatches: [tStr("api.chat_key_required")],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.chat_key_required"), envelope.mismatches);
      }

      if (!isSupportedHttpUrl(baseUrl)) {
        const envelope: ApiEnvelope = {
          route,
          state: "error-non-retryable",
          mismatches: [tInterp("api.base_url_invalid", { url: baseUrl })],
        };
        return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.base_url_invalid_short"), envelope.mismatches);
      }

      const result = await testConnection(provider, apiKey, baseUrl);
      if (result.ok) {
        const envelope: ApiEnvelope = {
          route,
          state: "success",
          mismatches: [],
        };
        return renderStatusEnvelope(route, envelope, meta.displayName, tInterp("api.connected", { provider: meta.displayName }));
      }
      const reason = result.error ?? tStr("api.connection_failed");
      const envelope: ApiEnvelope = {
        route,
        state: "error-retryable",
        mismatches: [reason],
      };
      return renderStatusEnvelope(route, envelope, meta.displayName, tStr("api.connection_failed"), envelope.mismatches);
    }, {
      body: t.Object({
        provider: t.String(),
        apiKey: t.Optional(t.String()),
        baseUrl: t.Optional(t.String()),
      }),
    })
    .get("/providers/options", ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const statuses = getAllProviderStatuses(PROVIDERS.map((p) => ({ provider: p.id, requiresKey: p.requiresKey })));
      const configured = statuses.filter((s) => s.configured);
      if (configured.length === 0) {
        return `<option value="" disabled selected>${tStr("ai_providers.floating_chat_no_providers")}</option>`;
      }
      const options = configured
        .map((s) => {
          const meta = getProvider(s.provider);
          return meta ? `<option value="${esc(s.provider)}">${esc(meta.displayName)}</option>` : "";
        })
        .filter(Boolean)
        .join("");
      return `<option value="" disabled selected>${tStr("ai_providers.select_provider")}</option>${options}`;
    })
    .get("/models", async ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const raw = parseOptionalTrimmedString(query.provider);
      const stateId = parseOptionalTrimmedString(query.stateId);
      if (!raw) {
        return `<option value="" disabled selected>${tStr("api.models_provider_required")}</option>`;
      }
      const providerId = parseProviderId(raw);
      if (!providerId) {
        return `<option value="" disabled selected>${tStr("api.unknown_provider")}</option>`;
      }
      const resolvedProvider = getProvider(providerId);
      if (!resolvedProvider) {
        return `<option value="" disabled selected>${tStr("api.unknown_provider")}</option>`;
      }

      const baseUrl = parseOptionalTrimmedString(query.baseUrl)
        ?? getBaseUrl(resolvedProvider.id)
        ?? resolvedProvider.baseUrl;
      const apiKey = parseOptionalTrimmedString(query.apiKey)
        ?? (getApiKey(resolvedProvider.id) ?? "");
      const selectedModel = parseOptionalTrimmedString(query.selectedModel)
        ?? parseOptionalTrimmedString(query.model);

      if (resolvedProvider.requiresKey && apiKey.trim().length === 0) {
        const option = `<option value="" disabled selected>${tStr("api.model_selection_key_required")}</option>`;
        return renderModelSelectionOptions(
          resolvedProvider.id,
          option,
          "unauthorized",
          tStr("api.model_selection_key_required"),
          stateId ?? undefined,
        );
      }

      if (!isSupportedHttpUrl(baseUrl)) {
        const option = `<option value="" disabled selected>${tStr("api.base_url_invalid_short")}</option>`;
        return renderModelSelectionOptions(
          resolvedProvider.id,
          option,
          "error-non-retryable",
          tInterp("api.base_url_invalid", { url: baseUrl }),
          stateId ?? undefined,
        );
      }

      const result = await listProviderModelsOrDefaults(
        resolvedProvider.id,
        apiKey,
        baseUrl,
      );

      if (!result.ok || !result.data) {
        const rawError = result.error ?? tStr("api.request_failed");
        const displayError = sanitizeApiErrorForDisplay(rawError);
        const option = `<option value="" disabled selected>${tInterp("api.models_load_failed", {
          provider: esc(resolvedProvider.displayName),
          error: esc(displayError),
        })}</option>`;
        return renderModelSelectionOptions(
          resolvedProvider.id,
          option,
          "error-retryable",
          tInterp("api.models_load_failed", {
            provider: resolvedProvider.displayName,
            error: displayError,
          }),
          stateId ?? undefined,
        );
      }

      if (result.data.models.length === 0) {
        const option = `<option value="" disabled selected>${tStr("api.no_models_found")}</option>`;
        return renderModelSelectionOptions(
          resolvedProvider.id,
          option,
          "empty",
          tStr("api.no_models_found"),
          stateId ?? undefined,
        );
      }

      const options = buildModelSelectOptions(result.data.models, selectedModel);
      return renderModelSelectionOptions(
        resolvedProvider.id,
        options,
        "success",
        tInterp("api.model_selection_loaded", {
          provider: resolvedProvider.displayName,
          count: String(result.data.models.length),
          source: result.data.source,
        }),
        stateId ?? undefined,
      );
    })
    .post("/chat", async ({ body, set, request, server }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;

      // Rate limit: reject requests arriving within 1 second of the previous one
      // from the same client IP (or "unknown" as a fallback key).
      const clientIp = server?.requestIP(request)?.address ?? request.headers.get("x-forwarded-for") ?? "unknown";
      if (!checkChatRateLimit(clientIp)) {
        set.status = 429;
        return `<div class="alert alert-warning" role="alert"><span>${esc(tStr("api.chat_rate_limited"))}</span></div>`;
      }

      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "error-non-retryable",
          data: undefined,
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "provider",
            reason: tStr("api.unknown_provider"),
            retryable: false,
          }),
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }
      const providerMeta = getProvider(provider);
      if (!providerMeta) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "error-non-retryable",
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "provider",
            reason: tStr("api.unknown_provider"),
            retryable: false,
          }),
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }
      const messageText = typeof body.message === "string" ? body.message.trim() : "";
      const requestTts = parseOptionalBoolean(body.requestTts) ?? false;
      const ttsOutputMimeType = parseChatTtsOutputMimeType(body.ttsOutputMimeType, requestTts);
      const requestedTtsVoice = parseOptionalTrimmedString(body.ttsVoice);
      const speechInput = body.speechInput === undefined
        ? undefined
        : parseChatSpeechInput(body.speechInput);
      const hasSpeechInput = body.speechInput !== undefined;
      const resolvedTtsVoice = requestedTtsVoice ?? DEFAULT_CHAT_TTS_VOICE;

      const apiKey = parseOptionalTrimmedString(body.apiKey) ?? (getApiKey(provider) ?? "");
      const baseUrl = parseOptionalTrimmedString(body.baseUrl) ?? getBaseUrl(provider) ?? providerMeta.baseUrl;
      const requestedModel = typeof body.model === "string" ? body.model.trim() : undefined;
      const resolved = resolveChatModel(provider, requestedModel, apiKey);

      if (requestTts && !ttsOutputMimeType) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "error-non-retryable",
          error: {
            commandIndex: -1,
            command: "ttsOutputMimeType",
            reason: tStr("validation.chat_tts_output_format_required"),
            retryable: false,
          },
          mismatches: [tStr("validation.chat_tts_output_format_required")],
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }
      const effectiveTtsOutputMimeType = ttsOutputMimeType ?? CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE;
      const playbackTtsMimeType = resolveChatTtsPlaybackMimeType(body.ttsOutputMimeType, effectiveTtsOutputMimeType);

      if (!isSupportedHttpUrl(baseUrl)) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "error-non-retryable",
          error: {
            commandIndex: -1,
            command: "baseUrl",
            reason: tInterp("api.base_url_invalid", { url: baseUrl }),
            retryable: false,
          },
          mismatches: [tInterp("api.base_url_invalid", { url: baseUrl })],
          data: {
            provider: providerMeta.displayName,
            requestedModel: requestedModel ?? null,
            effectiveModel: "",
            reply: "",
          },
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }

      if (hasSpeechInput && speechInput === undefined) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "error-non-retryable",
          error: {
            commandIndex: -1,
            command: "speechInput",
            reason: tStr("api.chat_missing_required_fields"),
            retryable: false,
          },
          mismatches: [tStr("api.chat_missing_required_fields")],
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }

      let effectiveMessage = messageText;
      let speechResolution: { transcript: string; language?: string } | undefined;
      if (!effectiveMessage && speechInput) {
        const sttResult = await transcribeSpeech(
          provider,
          apiKey,
          resolved.effectiveModel,
          {
            mimeType: speechInput.mimeType,
            data: speechInput.data,
          },
          baseUrl,
        );
        if (!sttResult.ok || !sttResult.data) {
          const rawProviderError = sttResult.error ?? tStr("api.request_failed");
          logger.error(`[chat-stt] provider=${provider} model=${resolved.effectiveModel} error=${rawProviderError}`);
          const envelope: ChatRunEnvelope = {
            route: "/api/ai/chat",
            state: "error-non-retryable",
            error: {
              commandIndex: -1,
              command: requestedModel ?? CHAT_COMMAND_FALLBACK_LABEL,
              reason: tStr("api.request_failed"),
              retryable: false,
            },
            mismatches: [tStr("api.request_failed")],
            data: {
              provider: providerMeta.displayName,
              requestedModel: requestedModel ?? null,
              effectiveModel: resolved.effectiveModel,
              reply: "",
            },
          };
          return renderChatRunState("/api/ai/chat", envelope);
        }
        speechResolution = sttResult.data;
        effectiveMessage = sttResult.data.transcript;
      }

      if (!effectiveMessage) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "error-non-retryable",
          error: {
            commandIndex: -1,
            command: "message",
            reason: tStr("api.empty_message"),
            retryable: false,
          },
          mismatches: [tStr("api.empty_message")],
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }

      if (resolved.unauthorized) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "unauthorized",
          error: {
            commandIndex: -1,
            command: requestedModel ?? CHAT_COMMAND_FALLBACK_LABEL,
            reason: tStr("api.chat_unauthorized"),
            retryable: false,
          },
          mismatches: resolved.mismatches,
          data: {
            provider: providerMeta.displayName,
            requestedModel: requestedModel ?? null,
            effectiveModel: resolved.effectiveModel,
            reply: "",
          },
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }

      if (!resolved.effectiveModel) {
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: resolved.state,
          error: {
            commandIndex: -1,
            command: requestedModel ?? CHAT_COMMAND_FALLBACK_LABEL,
            reason: resolved.mismatches[0] ?? tStr("api.chat_no_model"),
            retryable: false,
          },
          mismatches: resolved.mismatches,
          data: {
            provider: providerMeta.displayName,
            requestedModel: requestedModel ?? null,
            effectiveModel: "",
            reply: "",
          },
        };
        return renderChatRunState("/api/ai/chat", envelope);
      }

      const result = await chatCompletion(
        provider,
        apiKey,
        resolved.effectiveModel,
        [{ role: "user", content: effectiveMessage }],
        baseUrl,
      );

      if (result.ok) {
        let ttsPayload: { mimeType: string; data: string } | undefined;
        if (requestTts) {
          const ttsResult = await synthesizeSpeech(
            provider,
            apiKey,
            resolved.effectiveModel,
            result.data ?? "",
            effectiveTtsOutputMimeType,
            resolvedTtsVoice,
            baseUrl,
          );
          if (ttsResult.ok && ttsResult.data) {
            ttsPayload = {
              mimeType: playbackTtsMimeType,
              data: ttsResult.data.data,
            };
          } else {
            const rawProviderError = ttsResult.error ?? tStr("api.request_failed");
            logger.error(`[chat-tts] provider=${provider} model=${resolved.effectiveModel} error=${rawProviderError}`);
          }
        }
        const envelope: ChatRunEnvelope = {
          route: "/api/ai/chat",
          state: "success",
          data: {
            provider: providerMeta.displayName,
            requestedModel: requestedModel ?? null,
            effectiveModel: resolved.effectiveModel,
            reply: result.data ?? "",
            ...(speechResolution ? { speech: speechResolution } : {}),
            ...(ttsPayload ? { tts: ttsPayload } : {}),
          },
          mismatches: resolved.mismatches,
          error: undefined,
        };
        return renderChatRunState("/api/ai/chat", envelope, effectiveMessage);
      }

      // Log the raw provider error server-side and surface a generic message to avoid
      // leaking internal details such as rate-limit info or API key validation errors.
      const rawProviderError = result.error ?? tStr("api.request_failed");
      logger.error(`[chat] provider=${provider} model=${resolved.effectiveModel} error=${rawProviderError}`);
      const userFacingError = tStr("api.chat_provider_error");
      const envelope: ChatRunEnvelope = {
        route: "/api/ai/chat",
        state: "error-non-retryable",
        error: {
          commandIndex: -1,
          command: requestedModel ?? CHAT_COMMAND_FALLBACK_LABEL,
          reason: userFacingError,
          retryable: false,
        },
        mismatches: resolved.mismatches,
        data: {
          provider: providerMeta.displayName,
          requestedModel: requestedModel ?? null,
          effectiveModel: resolved.effectiveModel,
          reply: "",
        },
      };
      return renderChatRunState("/api/ai/chat", envelope);
    }, {
      body: t.Object({
        provider: t.String(),
        model: t.Optional(t.String()),
        message: t.Optional(t.String()),
        speechInput: t.Optional(
          t.Object({
            mimeType: t.String(),
            data: t.String(),
          }),
        ),
        requestTts: t.Optional(t.Boolean()),
        ttsOutputMimeType: t.Optional(t.String()),
        ttsVoice: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        baseUrl: t.Optional(t.String()),
      }),
    })
    .get("/ollama/models", async ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const baseUrl = query.baseUrl ?? getBaseUrl("ollama") ?? OLLAMA_DEFAULT_BASE_URL;
      const result = await listProviderModels("ollama", "", baseUrl);
      if (!result.ok) {
        return `<option value="" disabled selected>${tInterp("api.ollama_offline", { error: esc(result.error ?? "") })}</option>`;
      }
      const models = result.data?.models;
      if (!models || models.length === 0) {
        return `<option value="" disabled selected>${tStr("api.no_models_found")}</option>`;
      }
      return models.map((name: string) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
    })
  );
}
