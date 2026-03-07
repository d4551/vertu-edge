/**
 * Canonical FlowV1 contracts and command registry shared across tooling and control-plane.
 */

/** Supported FlowV1 schema version. */
export const FLOW_VERSION = "1.0" as const;

/** Selector target for Maestro-style UI automation commands. */
export interface CommandTarget {
  /** Android resource identifier selector. */
  resourceId?: string;
  /** Visible text selector. */
  text?: string;
  /** Accessibility description selector. */
  contentDescription?: string;
  /** Horizontal coordinate on screen. */
  x?: number;
  /** Vertical coordinate on screen. */
  y?: number;
}

/** Window focus target for desktop automation surfaces. */
export interface WindowTarget {
  /** Optional application identifier/bundle id. */
  appId?: string;
  /** Optional human-readable title. */
  title?: string;
}

/** Cardinal directions supported by movement commands. */
export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

/** Canonical flow commands supported by the platform. */
export type FlowCommand =
  | { type: "launchApp" }
  | { type: "tapOn"; target: CommandTarget }
  | { type: "inputText"; value: string }
  | { type: "assertVisible"; target: CommandTarget }
  | { type: "assertNotVisible"; target: CommandTarget }
  | { type: "assertText"; target: CommandTarget; value: string }
  | { type: "selectOption"; target: CommandTarget; option: string }
  | { type: "scroll"; direction: Direction; steps?: number }
  | { type: "swipe"; direction: Direction; distanceFraction?: number }
  | { type: "screenshot" }
  | { type: "clipboardRead" }
  | { type: "clipboardWrite"; value: string }
  | { type: "windowFocus"; target: WindowTarget }
  | { type: "hideKeyboard" }
  | { type: "waitForAnimation"; timeoutMs?: number };

/** Canonical FlowV1 payload after normalization. */
export interface FlowV1 {
  /** Contract version. */
  version: typeof FLOW_VERSION;
  /** Target app identifier used by Maestro automation runtime. */
  appId: string;
  /** Ordered list of normalized flow steps. */
  steps: FlowCommand[];
}

/** Supported flow execution targets. */
export type FlowRunTarget = "android" | "ios" | "osx" | "windows" | "linux";

/** Canonical FlowExecutionState for cross-platform alignment.
 * Wire format: kebab-case (e.g., "error-retryable")
 * KMP: UPPER_SNAKE_CASE enum names with @SerialName kebab-case
 * iOS: camelCase enum cases with explicit raw values in kebab-case
 * TypeScript: kebab-case string literals
 */

/** Canonical step-level execution report for cross-platform telemetry. */
export interface FlowStepReport {
  /** Zero-based step index. */
  index: number;
  /** camelCase command type name (e.g., "tapOn", "inputText"). */
  commandType: string;
  /** Step execution status. */
  status: "success" | "failed" | "skipped" | "unsupported";
  /** Duration in milliseconds. */
  durationMs: number;
  /** Human-readable message. */
  message?: string;
  /** ISO 8601 start timestamp. */
  startedAt?: string;
  /** ISO 8601 end timestamp. */
  endedAt?: string;
}

/** Canonical driver execution report for cross-platform telemetry. */
export interface FlowDriverReport {
  /** Total steps in the flow. */
  totalSteps: number;
  /** Number of successfully completed steps. */
  completedSteps: number;
  /** Overall execution state. */
  state: ControlPlaneState;
  /** Human-readable summary. */
  message: string;
  /** Per-step reports. */
  steps: FlowStepReport[];
  /** Correlation ID for tracing. */
  correlationId: string;
}

/** Runtime state for control-plane capabilities that drive UI envelope rendering.
 *
 * Values aligned with KMP `FlowExecutionState` and iOS `FlowExecutionState`:
 *   KMP SCREAMING_SNAKE → TS kebab-case mapping:
 *     ERROR_RETRYABLE     → "error-retryable"
 *     ERROR_NON_RETRYABLE → "error-non-retryable"
 */
export type ControlPlaneState =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error-retryable"
  | "error-non-retryable"
  | "unauthorized";

/** Runtime state for flow execution envelopes. */
export type FlowRunState = "success" | "error-retryable" | "error-non-retryable";

/** Per-run execution policy for flow commands. */
export interface FlowRunPolicy {
  /** Maximum attempts per command, including the first try. */
  maxAttempts: number;
  /** Timeout in milliseconds for each command execution call. */
  commandTimeoutMs: number;
  /** Initial delay in milliseconds before retrying retryable command failures. */
  retryDelayMs: number;
}

/** Command execution state for individual command results. */
export type FlowCommandExecutionState = "success" | "error" | "unsupported";

/** Attempt-level trace emitted during command execution. */
export interface FlowRunAttempt {
  /** Zero-based command index in the parsed flow. */
  commandIndex: number;
  /** One-based attempt number for the command. */
  attempt: number;
  /** Command execution state for this attempt. */
  state: FlowCommandExecutionState;
  /** Human-readable attempt summary. */
  message: string;
  /** Wall-clock start timestamp for this attempt (ISO 8601). */
  startedAt: string;
  /** Wall-clock end timestamp for this attempt (ISO 8601). */
  endedAt: string;
  /** Attempt duration in milliseconds. */
  durationMs: number;
  /** Optional structured error detail for failed attempts. */
  error?: FlowCapabilityError;
}

/** Command-level execution telemetry used by automation action auditing. */
export interface FlowRunAction {
  /** Zero-based command index in the parsed flow. */
  commandIndex: number;
  /** Command type executed by the flow step. */
  commandType: FlowCommand["type"];
  /** Execution surface used for this command. */
  target: FlowRunTarget;
  /** Ordered attempt traces for this command. */
  attempts: FlowRunAttempt[];
}

/** Supported model source for local model ingestion. */
export type ModelSource = string;

/** Validation mode used to normalize model references per source policy. */
export type ModelRefValidationMode = "huggingface" | "opaque";

/** Source-specific model reference validation policy. */
export interface ModelRefValidationPolicy {
  /** Validation mode used by model reference parsing. */
  mode: ModelRefValidationMode;
  /** Canonical host used by host-validated sources (for example huggingface.co). */
  canonicalHost?: string;
}

/** Supported surface names for runtime capability errors. */
export type FlowCapabilitySurface =
  | "flow"
  | "model_pull"
  | "app_build"
  | "chat"
  | "flow_validate"
  | "flow_automation"
  | "flow_capabilities";

/** Job lifecycle state for async model/build workflows. */
export type CapabilityJobState = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";

/** Supported app build platforms. */
export type BuildKind = "android" | "ios" | "desktop";

/** Supported app build variant types. */
export type BuildType = "debug" | "release";

/** Supported build type constants for deterministic validation across tooling and UI. */
export const SUPPORTED_BUILD_TYPES = ["debug", "release"] as const satisfies readonly BuildType[];

/** Stable app-build failure codes surfaced by orchestration, API envelopes, and SSR dashboards. */
export const APP_BUILD_FAILURE_CODES = [
  "app_build_unsupported_platform",
  "app_build_unsupported_build_type",
  "app_build_android_java_missing",
  "app_build_desktop_bun_missing",
  "app_build_desktop_variant_unsupported",
  "app_build_ios_mac_only",
  "app_build_ios_tooling_missing",
  "app_build_ios_scheme_missing",
  "app_build_ios_scheme_not_found",
  "app_build_output_dir_invalid",
  "app_build_script_missing",
  "app_build_execution_failed",
  "ios_platform_support_missing",
  "ios_required_destination_missing",
  "ios_showdestinations_failed",
] as const;

/** Machine-readable app-build failure codes carried across CLI, reports, and UI state. */
export type AppBuildFailureCode = (typeof APP_BUILD_FAILURE_CODES)[number];

/** Runtime guard for app-build failure codes emitted by typed build orchestration. */
export function isAppBuildFailureCode(value: string): value is AppBuildFailureCode {
  return (APP_BUILD_FAILURE_CODES as readonly string[]).includes(value);
}

/** Supported desktop build target variants. */
export type DesktopBuildVariant =
  | "linux-x64"
  | "linux-arm64"
  | "darwin-arm64"
  | "darwin-x64"
  | "windows-x64";

/** Canonical request shape for `/api/flows/run` and `/api/flows/trigger`. */
export interface FlowRunRequest {
  /** Flow YAML payload submitted by the user or UI. */
  yaml: string;
  /** Target execution surface for flow runtime. */
  target?: FlowRunTarget;
  /** Maximum attempts per command; defaults to configured policy. */
  maxAttempts?: number;
  /** Timeout in milliseconds per command execution; defaults to configured policy. */
  commandTimeoutMs?: number;
  /** Delay in milliseconds between retry attempts; defaults to configured policy. */
  retryDelayMs?: number;
  /** Optional external correlation id for observability. */
  correlationId?: string;
}

/** Request payload for creating flow run jobs. */
export interface FlowRunJobRequest extends FlowRunRequest {}

/** Per-run command replay request payload. */
export interface FlowReplayStepRequest {
  /** 0-based step index to replay. */
  commandIndex: number;
}

/** Flow run event/log row emitted by runtime and surfaced via SSE/poll. */
export interface FlowRunLogEvent {
  /** Stable event id for cursor replay. */
  id: string;
  /** Log level or event type. */
  level: "debug" | "info" | "warn" | "error";
  /** Event timestamp in ISO8601. */
  timestamp: string;
  /** Human-readable event content. */
  message: string;
  /** Optional command index attribution. */
  commandIndex?: number;
}

/** Result payload for flow run job polling endpoints. */
export interface FlowRunJobResult {
  /** Stable run id. */
  runId: string;
  /** Lifecycle status. */
  status: CapabilityJobState;
  /** Correlation id for cross-system logs. */
  correlationId: string;
  /** Optional resolved run result. */
  result?: FlowRunResult;
  /** Bounded stdout summary for job-level diagnostics. */
  stdout: string;
  /** Bounded stderr summary for job-level diagnostics. */
  stderr: string;
  /** Job elapsed time in milliseconds. */
  elapsedMs: number;
  /** Optional terminal reason for cancelled/failed jobs. */
  reason?: string;
}

/** Response envelope for flow run job APIs. */
export interface FlowRunJobEnvelope extends ApiEnvelope<FlowRunJobResult, FlowRuntimeError> {
  /** Runtime route handling flow run jobs. */
  route: "/api/flows/runs";
  /** Stable run identifier. */
  runId: string;
}

/** Normalized representation of a model reference. */
export interface ModelReference {
  /** Normalized model ref, for example `huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual`. */
  normalized: string;
  /** Supported model provider namespace. */
  source: ModelSource;
}

/** Model pull API request. */
export interface ModelPullRequest {
  /** Target model reference to fetch. */
  modelRef?: string;
  /** Source provider namespace. If omitted, resolves to the control-plane registry default. */
  source?: ModelSource;
  /** Optional platform hint for future behavior differentiation. */
  platform?: string;
  /** Force re-download on repeated pull requests. */
  force?: boolean;
  /** Per-job timeout override, in milliseconds. */
  timeoutMs?: number;
  /** Optional external correlation id for observability. */
  correlationId?: string;
}

/** Result row returned while a model pull job is running or complete. */
export interface ModelPullResult {
  /** User-requested model reference. */
  requestedModelRef: string;
  /** Normalized model reference used by ramalama. */
  normalizedModelRef: string;
  /** Final job status. */
  status: CapabilityJobState;
  /** Shell exit code on completion, if available. */
  exitCode: number | null;
  /** Bounded command stdout summary. */
  stdout: string;
  /** Bounded command stderr summary. */
  stderr: string;
  /** Output artifact or cache path, if any. */
  artifactPath: string | null;
  /** Artifact metadata when available. */
  artifact?: ArtifactMetadata;
  /** Time between job creation and latest status change. */
  elapsedMs: number;
  /** Source platform hint from request. */
  platform?: string;
}

/** Response envelope for model pull requests and polling. */
export interface ModelPullEnvelope extends ApiEnvelope<ModelPullResult, FlowCapabilityError> {
  /** Runtime path handling model-pull jobs. */
  route: "/api/models/pull";
  /** Stable job identifier used by polling. */
  jobId: string;
  /** Runtime command surface. */
  surface?: "model_pull";
}

/** Registry descriptor for one model source in the control-plane. */
export interface ModelSourceDescriptor {
  /** Canonical source identifier. */
  id: ModelSource;
  /** Human-readable source label. */
  displayName: string;
  /** Optional source description for clients. */
  description?: string;
  /** Placeholder for model reference entry fields. */
  modelRefPlaceholder: string;
  /** Optional model reference hint. */
  modelRefHint?: string;
  /** Validation mode applied to model refs for this source. */
  modelRefValidation: ModelRefValidationMode;
  /** Canonical host for host-validated source formats. */
  canonicalHost?: string;
  /** Optional ramalama transport prefix for source pulls. */
  ramalamaTransportPrefix?: string;
  /** Optional alias values accepted as this source. */
  aliases: readonly string[];
  /** Whether this source enforces RAMALAMA allow-list checks. */
  enforceAllowlist: boolean;
}

/** Model source registry payload returned by `/api/models/sources`. */
export interface ModelSourceRegistryResult {
  /** Default source id used when requests omit a source. */
  defaultSource: ModelSource;
  /** Source descriptors available for model pull operations. */
  sources: readonly ModelSourceDescriptor[];
}

/** Response envelope for `/api/models/sources`. */
export interface ModelSourceRegistryEnvelope extends ApiEnvelope<ModelSourceRegistryResult, FlowCapabilityError> {
  /** Runtime route serving source registry payload. */
  route: "/api/models/sources";
}

/** Single model result from a HuggingFace Hub search. */
export interface HfModelSearchHit {
  /** Repository ID, e.g. "meta-llama/Llama-3-8B". */
  id: string;
  /** Total download count. */
  downloads: number;
  /** Total like count. */
  likes: number;
  /** Primary pipeline tag, e.g. "text-generation". */
  pipelineTag?: string;
  /** ISO-8601 last-modified timestamp. */
  lastModified?: string;
  /** Associated tags. */
  tags?: readonly string[];
}

/** Search result payload for `/api/models/search`. */
export interface ModelSearchResult {
  /** Original search query. */
  query: string;
  /** Number of results returned. */
  totalResults: number;
  /** Matched model descriptors. */
  models: readonly HfModelSearchHit[];
}

/** Response envelope for `/api/models/search`. */
export interface ModelSearchEnvelope extends ApiEnvelope<ModelSearchResult, FlowCapabilityError> {
  /** Runtime route serving model search results. */
  route: "/api/models/search";
}

/** App build request for Android/iOS/Desktop generation. */
export interface AppBuildRequest {
  /** Target platform. */
  platform: BuildKind;
  /** Build variation (defaults to `debug`). */
  buildType?: BuildType;
  /** Build variant for tooling (future extension). */
  variant?: string;
  /** Disable tests to reduce build time. */
  skipTests?: boolean;
  /** Custom artifact output directory override. */
  outputDir?: string;
  /** Clean workspace before build. */
  clean?: boolean;
  /** Optional external correlation id for observability. */
  correlationId?: string;
}

/** Build job result returned by poll and initial submission responses. */
export interface AppBuildResult {
  /** Requested platform. */
  platform: BuildKind;
  /** Requested build type. */
  buildType: BuildType;
  /** Optional variant requested by caller. */
  variant?: string;
  /** Final job status. */
  status: CapabilityJobState;
  /** Shell exit code on completion, if available. */
  exitCode: number | null;
  /** Bounded command stdout summary. */
  stdout: string;
  /** Bounded command stderr summary. */
  stderr: string;
  /** Resolved artifact path. */
  artifactPath: string | null;
  /** Optional typed build failure code when the build terminated with a structured error. */
  failureCode?: AppBuildFailureCode;
  /** Optional typed build failure message emitted by the canonical build owner. */
  failureMessage?: string;
  /** Artifact metadata when available. */
  artifact?: ArtifactMetadata;
  /** Total elapsed duration in ms. */
  elapsedMs: number;
}

/** Response envelope for build requests and polling. */
export interface AppBuildEnvelope extends ApiEnvelope<AppBuildResult, FlowCapabilityError> {
  /** Runtime path handling app-build jobs. */
  route: "/api/apps/build";
  /** Stable job identifier used by polling. */
  jobId: string;
  /** Runtime command surface. */
  surface?: "app_build";
}

/** Request model for `/api/prefs`. */
export interface PreferenceUpdateRequest {
  /** Preferred app theme from dashboard selection. */
  theme: string | null;
  /** Preferred model from dashboard selection. */
  defaultModel: string | null;
}

/** Canonical preference persistence request body used by `/api/prefs`. */
export interface PreferenceRunRequest {
  theme: string | null;
  defaultModel: string | null;
}

/** Error detail returned for unsupported or failing execution paths. */
export interface FlowCapabilityError {
  /** Index of command in the sequence. */
  commandIndex: number;
  /** Stable machine-readable error code. */
  code: string;
  /** Error category for deterministic policy mapping. */
  category: FlowErrorCategory;
  /** Command that failed. */
  command: string;
  /** Optional canonical command type alias for command results. */
  commandType?: FlowCommand["type"];
  /** Human-readable reason string. */
  reason: string;
  /** Whether retry may succeed without user input change. */
  retryable: boolean;
  /** Correlation id used for logs and run/build event grouping. */
  correlationId: string;
  /** Optional capability surface where failure was raised. */
  surface?: FlowCapabilitySurface;
  /** Optional resource or command key for failure attribution. */
  resource?: string;
}

/** Error categories used by retry policy taxonomy. */
export type FlowErrorCategory =
  | "validation"
  | "dependency"
  | "connectivity"
  | "authorization"
  | "timeout"
  | "runtime"
  | "unsupported"
  | "internal";

/** Command-level execution result used by flow runtime. */
export interface FlowCommandResult {
  /** Index of command in the flow sequence. */
  commandIndex: number;
  /** Command type executed or rejected. */
  commandType: FlowCommand["type"];
  /** Command execution state. */
  state: FlowCommandExecutionState;
  /** Command execution summary message. */
  message: string;
  /** Error detail for failure cases. */
  error?: FlowCapabilityError;
  /** Optional artifact path produced by the command (for example screenshot output). */
  artifactPath?: string | null;
  /** Artifact metadata when produced by command execution. */
  artifact?: ArtifactMetadata;
  /** Number of attempts used to execute the command. */
  attempts?: number;
}

/** Flow command execution result envelope. */
export interface FlowRunResult {
  /** App package identifier. */
  appId: string;
  /** Flow command count. */
  commandCount: number;
  /** Execution surface selected for this flow run. */
  target?: FlowRunTarget;
  /** Effective execution policy used for this run. */
  policy?: FlowRunPolicy;
  /** Per-command action telemetry produced by execution hooks. */
  actions?: FlowRunAction[];
  /** Command-level artifacts. */
  results: FlowCommandResult[];
  /** Overall execution state. */
  state: FlowRunState;
  /** Optional elapsed time in milliseconds. */
  durationMs: number;
}

/** Artifact metadata for flow/build outputs with integrity fields. */
export interface ArtifactMetadata {
  /** Output artifact path. */
  artifactPath: string;
  /** SHA-256 checksum as lowercase hex. */
  sha256: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Artifact creation timestamp in ISO8601. */
  createdAt: string;
  /** MIME type when known. */
  contentType: string;
  /** Optional release signature or detached signature path. */
  signature?: string;
  /** Correlation id for traceability. */
  correlationId: string;
}

/** Canonical parser validation error for strict parser failures. */
export interface FlowParseFailure {
  /** Canonical command index where parsing failed. */
  commandIndex: number;
  /** Command name encountered while parsing. */
  command: string;
  /** Human-readable parse reason. */
  reason: string;
  /** Parsing failures are not retryable without user change. */
  retryable: false;
}

/** Canonical error payload for runtime-capability failures. */
export type FlowRuntimeError = FlowCapabilityError | FlowParseFailure;

/** Chat request result surfaced by `/api/ai/chat` for deterministic tests and UX state. */
export interface ChatAudioPayload {
  /** MIME type of the speech payload. */
  mimeType: string;
  /** Base64-encoded PCM/encoded audio bytes. */
  data: string;
}

/** Speech text extracted from STT input when chat requests include `speechInput`. */
export interface ChatSpeechResolution {
  /** Transcript of input speech provided by STT, if available. */
  transcript: string;
  /** Optional detected language from STT provider metadata. */
  language?: string;
}

/** Text or speech content returned by chat completion responses. */
export interface ChatSpeechReply {
  /** MIME type requested by server (defaults to MP3 in OpenAI-compatible responses). */
  mimeType: string;
  /** Base64 audio payload returned for speech output. */
  data: string;
}

/** Canonical list of supported OpenAI-style chat TTS output formats. */
export const CHAT_TTS_OUTPUT_MIME_TYPES = [
  "mp3",
  "opus",
  "aac",
  "flac",
  "wav",
  "pcm",
] as const;

/** Default chat TTS output format used when request is enabled but no override is provided. */
export const CHAT_TTS_DEFAULT_OUTPUT_MIME_TYPE: ChatTtsOutputMimeType = "mp3";

/** Supported output format type for `/api/ai/chat` text-to-speech requests. */
export type ChatTtsOutputMimeType = (typeof CHAT_TTS_OUTPUT_MIME_TYPES)[number];

/** Runtime guard for chat TTS output format values. */
export function isChatTtsOutputMimeType(value: string): value is ChatTtsOutputMimeType {
  return CHAT_TTS_OUTPUT_MIME_TYPES.includes(value as ChatTtsOutputMimeType);
}

/** Canonical request payload consumed by `/api/ai/chat` for text/audio input and optional TTS output. */
export interface ChatRequest {
  /** Provider identifier for the cloud completion endpoint. */
  provider: string;
  /** Model identifier selected for the chat request. */
  model?: string;
  /** Input text message for chat completion. */
  message?: string;
  /** Optional provider API key for direct provider calls. */
  apiKey?: string;
  /** Optional provider base URL override. */
  baseUrl?: string;
  /** Optional STT audio payload; set `message` to empty when using only speech input. */
  speechInput?: ChatAudioPayload;
  /** Request server-side text-to-speech output for the assistant reply. */
  requestTts?: boolean;
  /** Optional speech output MIME type override. */
  ttsOutputMimeType?: ChatTtsOutputMimeType;
  /** Optional TTS voice request for providers that support voice selection. */
  ttsVoice?: string;
}

export interface ChatResolution {
  /** Provider used for request completion. */
  provider: string;
  /** Model requested by the user. */
  requestedModel: string | null;
  /** Model resolved after policy and preferences. */
  effectiveModel: string;
  /** Final assistant response when available. */
  reply: string;
  /** STT transcript when `speechInput` was provided. */
  speech?: ChatSpeechResolution;
  /** Text-to-speech audio data for the assistant response. */
  tts?: ChatSpeechReply;
}

/** Supported workflow modes for local-first creative assistant tasks. */
export type AiWorkflowMode = "chat" | "typography" | "presentation" | "social" | "image" | "flow_generation";

/** Canonical image size presets supported by workflow image generation. */
export const AI_WORKFLOW_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;

/** Allowed aspect-ratio/size presets for image generation requests. */
export type AiWorkflowImageSize = (typeof AI_WORKFLOW_IMAGE_SIZES)[number];

/** Optional text generation tuning for workflow modes. */
export interface AiWorkflowTextOptions {
  /** Human/audience target (for example: "design team", "B2C founders"). */
  audience?: string;
  /** Style/tone instructions (for example: "minimal", "executive"). */
  tone?: string;
  /** Output format target (for example: "bullet list", "thread", "slide outline"). */
  format?: string;
  /** Additional constraints applied to generation. */
  constraints?: string;
}

/** Optional image-generation tuning values. */
export interface AiWorkflowImageOptions {
  /** Resolution preset for generated images. */
  size?: AiWorkflowImageSize;
  /** Optional random seed for reproducible output. */
  seed?: number;
  /** Optional generation step count when the backend supports it. */
  steps?: number;
  /** Optional stylistic preset or adapter-specific style label. */
  stylePreset?: string;
}

/** Canonical request payload for `/api/ai/workflows/run`. */
export interface AiWorkflowRequest {
  /** Workflow execution mode. */
  mode: AiWorkflowMode;
  /** Provider identifier override for workflow execution. */
  provider?: string;
  /** Model identifier selected by operator. */
  model?: string;
  /** Primary user prompt/instruction. */
  message: string;
  /** Optional provider credential override. */
  apiKey?: string;
  /** Optional provider base URL override. */
  baseUrl?: string;
  /** Optional external correlation id for observability. */
  correlationId?: string;
  /** Optional conversation id for multi-turn chat persistence. */
  conversationId?: string;
  /** Optional text-workflow tuning settings. */
  textOptions?: AiWorkflowTextOptions;
  /** Optional image workflow tuning settings. */
  imageOptions?: AiWorkflowImageOptions;
}

/** Persisted artifact metadata for AI workflow outputs. */
export interface AiArtifactRecord {
  /** Stable artifact id. */
  id: string;
  /** Owning job id. */
  jobId: string;
  /** Workflow mode that produced this artifact. */
  mode: AiWorkflowMode;
  /** Execution provider path (`local:ollama`, `remote:huggingface`, etc). */
  providerPath: string;
  /** Sanitized prompt summary persisted for auditability. */
  promptSummary: string;
  /** Absolute output path for the artifact file. */
  artifactPath: string;
  /** MIME type of the stored artifact. */
  mimeType: string;
  /** SHA-256 checksum in lowercase hex. */
  sha256: string;
  /** Artifact size in bytes. */
  sizeBytes: number;
  /** Artifact creation timestamp in ISO8601. */
  createdAt: string;
  /** Correlation id attached to this output. */
  correlationId: string;
}

/** Workflow execution result payload for creative assistant tasks. */
export interface AiWorkflowResult {
  /** Executed mode. */
  mode: AiWorkflowMode;
  /** User-requested provider identifier (if any). */
  requestedProvider: string | null;
  /** Provider path that produced the final result. */
  providerPath: string;
  /** User-requested model identifier (if any). */
  requestedModel: string | null;
  /** Model actually used for completion/generation. */
  effectiveModel: string;
  /** Final textual output (or caption/summary for image mode). */
  reply: string;
  /** Optional persisted artifact for generated outputs. */
  artifact?: AiArtifactRecord;
  /** Optional mode-specific notes and fallback details. */
  details?: string[];
  /** Conversation id for multi-turn chat persistence. */
  conversationId?: string;
  /** Extracted YAML from flow_generation mode responses. */
  extractedYaml?: string;
}

/** Capability row for a single creative workflow mode. */
export interface AiWorkflowCapability {
  /** Capability mode identifier. */
  mode: AiWorkflowMode;
  /** Whether local execution path is currently available. */
  localAvailable: boolean;
  /** Whether remote fallback path is currently available. */
  remoteAvailable: boolean;
  /** Optional reason when the mode is currently unavailable. */
  reason?: string;
}

/** Capability matrix payload for `/api/ai/workflows/capabilities`. */
export interface AiWorkflowCapabilityResult {
  /** Ordered per-mode capability rows. */
  modes: AiWorkflowCapability[];
}

/** Response envelope for creative workflow capability checks. */
export interface AiWorkflowCapabilityEnvelope extends ApiEnvelope<AiWorkflowCapabilityResult, FlowRuntimeError> {
  /** Runtime path handling workflow capability checks. */
  route: "/api/ai/workflows/capabilities";
}

/** Pollable workflow job payload returned by `/api/ai/workflows/jobs/:jobId`. */
export interface AiWorkflowJobResult {
  /** Stable workflow job id. */
  jobId: string;
  /** Lifecycle state for the workflow job. */
  status: CapabilityJobState;
  /** Correlation id used across logs and artifacts. */
  correlationId: string;
  /** Optional resolved workflow result after completion. */
  result?: AiWorkflowResult;
  /** Bounded stdout summary for diagnostics. */
  stdout: string;
  /** Bounded stderr summary for diagnostics. */
  stderr: string;
  /** Elapsed wall-clock time in milliseconds. */
  elapsedMs: number;
  /** Optional terminal reason for failed/cancelled states. */
  reason?: string;
}

/** Response envelope for workflow execution job APIs. */
export interface AiWorkflowJobEnvelope extends ApiEnvelope<AiWorkflowJobResult, FlowRuntimeError> {
  /** Runtime path handling workflow job APIs. */
  route: "/api/ai/workflows/jobs";
  /** Stable workflow job identifier. */
  jobId: string;
}

/** Conversation orchestration: metadata, runtime binding, messages, execution events. */
export interface ConversationOrchestration {
  /** Stable conversation id. */
  id: string;
  /** Human-readable title. */
  title?: string;
  /** Active runtime/model binding for this conversation. */
  activeRuntime?: RuntimeBinding;
  /** Ordered messages in the thread. */
  messages: ConversationMessage[];
  /** Execution events (runs) attached to this conversation. */
  executionEvents: ExecutionEvent[];
  /** Pending approval requests. */
  approvalRequests?: ApprovalRequest[];
  /** Voice input/output payload references. */
  voicePayloads?: VoicePayloadRef[];
  /** Artifacts and result summaries. */
  artifacts?: ArtifactSummary[];
}

/** Runtime binding for a conversation or task. */
export interface RuntimeBinding {
  /** Local vs cloud. */
  source: "local" | "cloud";
  /** Provider/source id (e.g. "ollama", "openai"). */
  provider: string;
  /** Model identifier. */
  model: string;
  /** Voice input supported. */
  voiceInput?: boolean;
  /** Voice output (TTS) supported. */
  voiceOutput?: boolean;
  /** RPA/automation supported. */
  automation?: boolean;
}

/** Single message in a conversation thread. */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Optional run id when message is tied to execution. */
  runId?: string;
  /** Timestamp ISO8601. */
  timestamp?: string;
}

/** Execution event in conversation thread (planning, running, completed, etc.). */
export interface ExecutionEvent {
  id: string;
  runId: string;
  state: RunSessionState;
  /** Human-readable summary. */
  summary?: string;
  /** Step stream for progress. */
  steps?: RunStep[];
  /** Timestamp ISO8601. */
  timestamp?: string;
}

/** Run session state for UI state machine. */
export type RunSessionState =
  | "planning"
  | "waiting_approval"
  | "running"
  | "needs_input"
  | "completed"
  | "failed";

/** Single step in a run's progress stream. */
export interface RunStep {
  index: number;
  commandType: string;
  status: "pending" | "running" | "success" | "failed";
  message?: string;
}

/** Approval request from assistant. */
export interface ApprovalRequest {
  id: string;
  runId: string;
  summary: string;
  /** Timestamp ISO8601. */
  requestedAt?: string;
}

/** Voice payload reference. */
export interface VoicePayloadRef {
  type: "input" | "output";
  mimeType: string;
  /** Reference to stored payload. */
  ref: string;
}

/** Artifact summary for conversation. */
export interface ArtifactSummary {
  id: string;
  runId?: string;
  mimeType: string;
  summary?: string;
}

/** Runtime inventory: local runtimes, cloud providers, model capabilities. */
export interface RuntimeInventory {
  /** Local runtimes including Ollama. */
  local: RuntimeDescriptor[];
  /** Cloud providers. */
  cloud: RuntimeDescriptor[];
}

/** Single runtime descriptor. */
export interface RuntimeDescriptor {
  id: string;
  displayName: string;
  /** Local vs cloud. */
  source: "local" | "cloud";
  /** Chat capability. */
  chat: boolean;
  /** RPA/automation capability. */
  automation?: boolean;
  /** Voice input. */
  voiceInput?: boolean;
  /** Voice output (TTS). */
  voiceOutput?: boolean;
  /** Availability: ready, unreachable, auth_required, etc. */
  availability: "ready" | "unreachable" | "auth_required" | "not_installed" | "downloading" | "verifying" | "failed";
  /** Model readiness when applicable. */
  modelReadiness?: ModelReadinessState;
}

/** Model readiness for local models. */
export type ModelReadinessState =
  | "not_installed"
  | "downloading"
  | "verifying"
  | "ready"
  | "in_use"
  | "failed";

/** Run session: automation task attached to conversation. */
export interface RunSession {
  runId: string;
  conversationId: string;
  target?: FlowRunTarget;
  state: RunSessionState;
  steps?: RunStep[];
  outputArtifacts?: ArtifactSummary[];
  retryable?: boolean;
  /** Cancellation and resume rules. */
  cancellationSupported?: boolean;
  resumeSupported?: boolean;
}

/** Parse-only flow validation summary surfaced by `/api/flows/validate`. */
export interface FlowValidationResult {
  /** App package identifier declared in the flow. */
  appId: string;
  /** Number of parsed commands. */
  commandCount: number;
  /** Ordered command types found in YAML. */
  commandTypes: FlowCommand["type"][];
}

/** Response envelope for parse-only flow validation requests. */
export interface FlowValidateEnvelope extends ApiEnvelope<FlowValidationResult, FlowRuntimeError> {
  /** Runtime path handling flow validation. */
  route: "/api/flows/validate";
}

/** Per-step validation details for flow automation readiness checks. */
export interface FlowAutomationValidationStep {
  /** Zero-based index of the step in the parsed flow. */
  index: number;
  /** Parsed command type for this step. */
  commandType: string;
  /** Whether the command is currently supported by this control-plane. */
  supported: boolean;
  /** Optional reason when the command is unsupported or malformed. */
  reason?: string;
}

/** Automation validation result surfaced by `/api/flows/validate/automation`. */
export interface FlowAutomationValidationResult {
  /** Parsed `appId`. */
  appId: string;
  /** Number of parsed commands. */
  commandCount: number;
  /** Count of commands currently supported. */
  supportedCommandCount: number;
  /** Per-step support breakdown for UI inspection. */
  steps: FlowAutomationValidationStep[];
}

/** Response envelope for `/api/flows/validate/automation`. */
export interface FlowAutomationValidateEnvelope extends ApiEnvelope<FlowAutomationValidationResult, FlowRuntimeError> {
  /** Runtime path handling automation validation. */
  route: "/api/flows/validate/automation";
}

/** Host/runtime dependency requirement for a target capability matrix. */
export interface FlowCapabilityRequirement {
  /** Stable requirement key. */
  id: string;
  /** Human-readable requirement description. */
  description: string;
  /** Whether this requirement is mandatory. */
  required: boolean;
  /** Whether requirement is currently satisfied. */
  installed: boolean;
}

/** Capability status for a single flow command on a target. */
export interface FlowCommandCapability {
  /** Command type being reported. */
  commandType: FlowCommand["type"];
  /** Whether the target currently supports this command. */
  supported: boolean;
  /** Optional unsupported reason. */
  reason?: string;
}

/** Capability matrix returned for preflight validation and UI gating. */
export interface FlowCapabilityMatrix {
  /** Target runtime reported by the control-plane. */
  target: FlowRunTarget;
  /** Whether target is ready for command execution. */
  ready: boolean;
  /** Command-level support breakdown. */
  commands: FlowCommandCapability[];
  /** Host dependencies used to compute readiness. */
  requirements: FlowCapabilityRequirement[];
}

/** Response envelope for flow target capability checks. */
export interface FlowCapabilityMatrixEnvelope extends ApiEnvelope<FlowCapabilityMatrix, FlowRuntimeError> {
  /** Runtime path handling capability checks. */
  route: "/api/flows/capabilities";
}

/** Provider validation row returned by `/api/ai/providers/validate`. */
export interface ProviderValidationItem {
  /** Provider identifier from the static registry. */
  provider: string;
  /** Whether required credentials/config are present. */
  configured: boolean;
  /** Reachability result when connectivity checks are requested. */
  reachable: boolean;
  /** Human-readable summary for UI reporting. */
  message: string;
}

/** Provider validation summary envelope payload. */
export interface ProviderValidationResult {
  /** Number of providers inspected. */
  total: number;
  /** Number of providers with complete required config. */
  configuredCount: number;
  /** Number of providers marked reachable. */
  reachableCount: number;
  /** Row-level details for each provider. */
  providers: ProviderValidationItem[];
}

/** Response envelope for provider validation checks. */
export interface ProviderValidationEnvelope extends ApiEnvelope<ProviderValidationResult, FlowRuntimeError> {
  /** Runtime path handling provider validation. */
  route: "/api/ai/providers/validate";
}

/** Response envelope for `/api/flows/run` and `/api/flows/trigger`. */
export interface FlowRunEnvelope extends ApiEnvelope<FlowRunResult, FlowRuntimeError> {
  /** Runtime path handling the flow request. */
  route: "/api/flows/run" | "/api/flows/trigger";
}

/** Stable readiness requirement identifiers surfaced by the device-AI dashboard. */
export type DeviceAiReadinessRequirementCode =
  | "hf_token"
  | "android_adb"
  | "ios_macos_host"
  | "ios_xcrun"
  | "ios_simctl";

/** Deterministic readiness modes used by the device-AI dashboard and verifier. */
export type DeviceAiReadinessStatus = "ready" | "blocked" | "skipped" | "delegated";

/** One readiness requirement row rendered by the device-AI dashboard surface. */
export interface DeviceAiReadinessRequirement {
  /** Stable requirement identifier. */
  code: DeviceAiReadinessRequirementCode;
  /** Whether the requirement is mandatory for the effective profile. */
  required: boolean;
  /** Whether the current host/runtime satisfies the requirement. */
  satisfied: boolean;
}

/** Latest canonical build artifact state referenced by the device-AI readiness surface. */
export interface DeviceAiBuildArtifactState {
  /** Platform identifier. */
  platform: BuildKind;
  /** Latest canonical build status. */
  status: "pass" | "fail" | "delegated" | "pending" | "missing";
  /** Optional artifact path from the latest build matrix report. */
  artifactPath?: string;
  /** Optional typed build failure code from the latest canonical build report. */
  failureCode?: AppBuildFailureCode;
  /** Optional typed build failure message from the latest canonical build report. */
  failureMessage?: string;
}

/** Result payload used by the device-AI readiness dashboard route. */
export interface DeviceAiReadinessResult {
  /** Current readiness mode for the host. */
  status: DeviceAiReadinessStatus;
  /** Normalized host operating system. */
  hostOs: "Darwin" | "Linux" | "Windows_NT";
  /** Whether the full native device protocol is currently active on this host. */
  shouldRun: boolean;
  /** Whether iOS execution has been explicitly delegated away from the local host. */
  delegated: boolean;
  /** Ordered readiness requirements evaluated for the current host/profile. */
  requirements: DeviceAiReadinessRequirement[];
  /** Fast-fail reasons that block the active native device gate. */
  failures: string[];
  /** Latest canonical build artifact summary by platform. */
  buildArtifacts: {
    /** Android build artifact availability. */
    android: DeviceAiBuildArtifactState;
    /** iOS build artifact availability. */
    ios: DeviceAiBuildArtifactState;
  };
}

/** Response envelope for the device-AI readiness dashboard route. */
export interface DeviceAiReadinessEnvelope extends ApiEnvelope<DeviceAiReadinessResult, FlowRuntimeError> {
  /** Runtime path handling device-AI readiness rendering. */
  route: "/api/device-ai/readiness";
}

/** Response envelope for preference persistence and preference-to-runtime drift reporting. */
export interface PreferenceRunEnvelope extends ApiEnvelope<PreferenceUpdateResult, FlowRuntimeError> {
  /** Runtime path handling preference mutations. */
  route: "/api/prefs";
}

/** Response envelope for chat completion and chat model resolution mismatches. */
export interface ChatRunEnvelope extends ApiEnvelope<ChatResolution, FlowRuntimeError> {
  /** Runtime path handling chat requests. */
  route: "/api/ai/chat";
}

/** Response envelope for local-first creative workflow execution routes. */
export interface AiWorkflowRunEnvelope extends ApiEnvelope<AiWorkflowResult, FlowRuntimeError> {
  /** Runtime path handling workflow run requests. */
  route: "/api/ai/workflows/run";
}

/** Preference update envelope used by `/api/prefs`. */
export interface PreferenceUpdateResult {
  /** Theme as requested by user. */
  requestedTheme: string | null;
  /** Theme that is currently applied at runtime. */
  effectiveTheme: string;
  /** Model requested by user. */
  requestedModel: string | null;
  /** Model currently selected by runtime and provider policy. */
  effectiveModel: string;
  /** Locale as requested by user. */
  requestedLocale: string | null;
  /** Locale currently applied to server-rendered UI. */
  effectiveLocale: string;
}

/** Generic API envelope for control-plane and tooling contracts. */
export interface ApiEnvelope<TData = object, TError = object> {
  /** Endpoint path that emitted this payload. */
  route: string;
  /** State driving deterministic UI transitions. */
  state: ControlPlaneState;
  /** Success payload when state is not an error state. */
  data?: TData;
  /** Error payload when state is an error state. */
  error?: TError;
  /** Matched/requested preference diff metadata. */
  mismatches?: string[];
}

/** Publicly documented flow command metadata used for parity checks. */
export interface FlowCommandSpec {
  /** Canonical command type. */
  type: FlowCommand["type"];
  /** Human-readable short description for docs and audits. */
  description: string;
}

/** Supported command registry used by parser validation and execution coverage. */
export const SUPPORTED_FLOW_COMMANDS: readonly FlowCommandSpec[] = [
  { type: "launchApp", description: "Launch the target app (no arguments)." },
  { type: "tapOn", description: "Tap by selector target." },
  { type: "inputText", description: "Type a text value into the focused element." },
  { type: "assertVisible", description: "Assert a target is visible on screen." },
  { type: "assertNotVisible", description: "Assert a target is not visible on screen." },
  { type: "assertText", description: "Assert a target's text equals a value." },
  { type: "selectOption", description: "Select an option value for a target." },
  { type: "scroll", description: "Scroll a direction with optional repeat count." },
  { type: "swipe", description: "Swipe gesture with direction and optional distance." },
  { type: "screenshot", description: "Capture a full-screen screenshot artifact." },
  { type: "clipboardRead", description: "Read current clipboard contents." },
  { type: "clipboardWrite", description: "Write value to system clipboard." },
  { type: "windowFocus", description: "Focus desktop window by identifier/title." },
  { type: "hideKeyboard", description: "Dismiss on-screen keyboard." },
  { type: "waitForAnimation", description: "Wait for a duration in milliseconds." },
] as const;

/** Set of supported flow command names used by runtime checks. */
export const SUPPORTED_FLOW_COMMAND_TYPES = SUPPORTED_FLOW_COMMANDS.map(({ type }) => type) as readonly FlowCommand["type"][];

/** Runtime command lookup optimized with constant-time membership checks. */
export const SUPPORTED_FLOW_COMMAND_SET: ReadonlySet<FlowCommand["type"]> = new Set(
  SUPPORTED_FLOW_COMMAND_TYPES,
);

/** Convert flow commands to a lookup for constant-time checks. */
export function isFlowCommandType(value: string): value is FlowCommand["type"] {
  return SUPPORTED_FLOW_COMMAND_SET.has(value as FlowCommand["type"]);
}

/** Command registry snapshot for tooling and docs parity checks. */
export function getSupportedFlowCommandTypes(): readonly FlowCommand["type"][] {
  return SUPPORTED_FLOW_COMMAND_TYPES;
}

/** Command registry snapshot including docs descriptions for registry audits. */
export function getSupportedFlowCommandSpecs(): readonly FlowCommandSpec[] {
  return SUPPORTED_FLOW_COMMANDS;
}

/** Canonical reason when a model reference fails normalization. */
export const MODEL_REFERENCE_INVALID_REASON = "Invalid model reference.";

/** Default model-ref policy when source metadata is intentionally omitted by caller context. */
const DEFAULT_OPAQUE_MODEL_REF_POLICY: ModelRefValidationPolicy = { mode: "opaque" };

/** Output size limit for persisted async command logs. */
export const MAX_JOB_LOG_CHARS = 12_000 as const;

/** Default timeout for async build/pull jobs. */
export const DEFAULT_JOB_TIMEOUT_MS = 20 * 60 * 1000;

/** Supported build platform constants for validation. */
export const SUPPORTED_BUILD_KINDS = ["android", "ios", "desktop"] as const satisfies readonly BuildKind[];

/** Supported desktop build variants for deterministic validation across tooling and UI. */
export const SUPPORTED_DESKTOP_BUILD_VARIANTS = [
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "darwin-x64",
  "windows-x64",
] as const satisfies readonly DesktopBuildVariant[];

const SUPPORTED_BUILD_KIND_SET = new Set<string>(SUPPORTED_BUILD_KINDS);
const SUPPORTED_BUILD_TYPE_SET = new Set<string>(SUPPORTED_BUILD_TYPES);
const SUPPORTED_DESKTOP_BUILD_VARIANT_SET = new Set<string>(SUPPORTED_DESKTOP_BUILD_VARIANTS);

/** Validate build platform names. */
export function isSupportedBuildKind(value: string): value is BuildKind {
  return SUPPORTED_BUILD_KIND_SET.has(value);
}

/** Validate build type names. */
export function isSupportedBuildType(value: string): value is BuildType {
  return SUPPORTED_BUILD_TYPE_SET.has(value);
}

/** Validate supported desktop build variant names. */
export function isSupportedDesktopBuildVariant(value: string): value is DesktopBuildVariant {
  return SUPPORTED_DESKTOP_BUILD_VARIANT_SET.has(value);
}

/** Build routing helper for app builds and polling pages. */
export function buildJobRouteFromKind(_kind: BuildKind, jobId?: string): string {
  const base = "/api/apps/build";
  return jobId ? `${base}/${jobId}` : base;
}

/** Normalize a raw model ref to a source-specific canonical format, typically `host/owner/repo`. */
export function normalizeModelRef(
  input: string,
  source: ModelSource,
  policy?: ModelRefValidationPolicy,
): string {
  const normalized = validateModelRefWithSource(input, source, policy);
  if (!normalized.ok || !normalized.normalized) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "modelRef",
      reason: normalized.reason ?? MODEL_REFERENCE_INVALID_REASON,
      retryable: false,
      surface: "model_pull",
      resource: input,
    });
  }
  return normalized.normalized;
}

/** Validate model refs in a non-throwing way for callers needing pre-validation. */
export function validateModelRef(input: string): { ok: boolean; normalized?: string; reason?: string } {
  return validateModelRefWithPolicy(input, DEFAULT_OPAQUE_MODEL_REF_POLICY);
}

/** Validate model refs with explicit source semantics for source-specific formats. */
export function validateModelRefWithSource(
  input: string,
  source: ModelSource,
  policy?: ModelRefValidationPolicy,
): { ok: boolean; normalized?: string; reason?: string } {
  const normalizedSource = source?.trim().toLowerCase();
  const resolvedPolicy = resolveModelRefValidationPolicy(normalizedSource, policy);
  return validateModelRefWithPolicy(input, resolvedPolicy);
}

/** Validate model refs using explicit policy configuration. */
export function validateModelRefWithPolicy(
  input: string,
  policy: ModelRefValidationPolicy,
): { ok: boolean; normalized?: string; reason?: string } {
  const trimmed = input?.trim() ?? "";
  if (trimmed.length === 0) {
    return { ok: false, reason: "Model reference is empty." };
  }

  if (policy.mode === "opaque") {
    if (trimmed.includes("..") || trimmed.includes("\\") || /\r|\n|\0/.test(trimmed)) {
      return { ok: false, reason: "Model reference contains invalid characters." };
    }
    if (trimmed.includes(" ")) {
      return { ok: false, reason: "Model reference must not contain spaces." };
    }
    return { ok: true, normalized: trimmed };
  }

  const canonicalHost = (policy.canonicalHost ?? "").trim().toLowerCase();
  if (canonicalHost.length === 0) {
    return {
      ok: false,
      reason: "Model reference validation requires a canonical host for this source mode.",
    };
  }
  const canonicalHosts = new Set<string>([
    canonicalHost,
    canonicalHost.startsWith("www.") ? canonicalHost.slice("www.".length) : `www.${canonicalHost}`,
  ]);
  if (trimmed.includes("..") || trimmed.includes("\\") || /\r|\n|\0/.test(trimmed)) {
    return { ok: false, reason: "Model reference contains invalid characters." };
  }
  let candidate = trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://")) {
    if (!URL.canParse(trimmed)) {
      return { ok: false, reason: "Could not parse model URL." };
    }
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (!canonicalHosts.has(hostname)) {
      return { ok: false, reason: `Only ${canonicalHost} is supported as model source.` };
    }
    if (parsed.search || parsed.hash) {
      return { ok: false, reason: "Model reference must not include query or fragment." };
    }
    candidate = parsed.pathname.replace(/^\/+/, "");
  }

  if (candidate.startsWith(`${canonicalHost}/`)) {
    candidate = candidate.slice(`${canonicalHost}/`.length);
  }
  if (candidate.startsWith(`www.${canonicalHost}/`)) {
    candidate = candidate.slice(`www.${canonicalHost}/`.length);
  }

  const pathParts = candidate.split("/").filter((part) => part.length > 0);
  if (pathParts.length !== 2) {
    return { ok: false, reason: "Model reference must include owner and repo (for example owner/repo)." };
  }

  const [owner, repo] = pathParts;
  if (!owner || !repo) {
    return { ok: false, reason: "Model reference must include owner and repo (for example owner/repo)." };
  }
  const isToken = (value: string): boolean =>
    value.length > 0 && /^[a-zA-Z0-9][\w.\-]{0,127}$/.test(value);

  if (!isToken(owner) || !isToken(repo)) {
    return { ok: false, reason: "Model reference must match owner/repo format." };
  }

  return { ok: true, normalized: `${canonicalHost}/${owner}/${repo}` };
}

function resolveModelRefValidationPolicy(
  source: ModelSource,
  policy?: ModelRefValidationPolicy,
): ModelRefValidationPolicy {
  if (policy) {
    return policy;
  }

  if (source) {
    const normalizedSource = source.trim().toLowerCase();
    if (normalizedSource === "") {
      return DEFAULT_OPAQUE_MODEL_REF_POLICY;
    }
  }
  return DEFAULT_OPAQUE_MODEL_REF_POLICY;
}

/** Build a canonical capability error from parser/runtime details. */
export function createFlowCapabilityError(params: {
  commandIndex: number;
  command: string;
  commandType?: FlowCommand["type"];
  code?: string;
  category?: FlowErrorCategory;
  reason: string;
  retryable: boolean;
  correlationId?: string;
  surface?: FlowCapabilityError["surface"];
  resource?: string;
}): FlowCapabilityError {
  const generatedCorrelationId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `flow-${Date.now()}`;
  const error: FlowCapabilityError = {
    commandIndex: params.commandIndex,
    code: params.code ?? "FLOW_CAPABILITY_ERROR",
    category: params.category ?? "runtime",
    command: params.command,
    reason: params.reason,
    retryable: params.retryable,
    correlationId: params.correlationId ?? generatedCorrelationId,
  };

  if (params.commandType !== undefined) {
    error.commandType = params.commandType;
  }
  if (params.surface !== undefined) {
    error.surface = params.surface;
  }
  if (params.resource !== undefined) {
    error.resource = params.resource;
  }

  return error;
}

/** Check if a capability error value includes the required structure. */
export function isFlowCapabilityError(
  value: object | string | number | boolean | null | undefined,
): value is FlowCapabilityError {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, string | number | boolean | null | undefined>;
  const commandIndex = candidate.commandIndex;
  const code = candidate.code;
  const category = candidate.category;
  const command = candidate.command;
  const reason = candidate.reason;
  const retryable = candidate.retryable;
  const correlationId = candidate.correlationId;

  return (
    typeof commandIndex === "number"
    && commandIndex >= -1
    && Number.isInteger(commandIndex)
    && typeof code === "string"
    && typeof category === "string"
    && typeof command === "string"
    && typeof reason === "string"
    && typeof retryable === "boolean"
    && typeof correlationId === "string"
  );
}
