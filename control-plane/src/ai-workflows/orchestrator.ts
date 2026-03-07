import {
  AI_WORKFLOW_IMAGE_SIZES,
  type AiArtifactRecord,
  type AiWorkflowImageSize,
  type AiWorkflowCapabilityEnvelope,
  type AiWorkflowJobEnvelope,
  type AiWorkflowJobResult,
  type AiWorkflowMode,
  type AiWorkflowRequest,
  type AiWorkflowResult,
  createFlowCapabilityError,
} from "../../../contracts/flow-contracts";
import {
  appendCapabilityJobEvent,
  appendMessage,
  createCapabilityJob,
  createConversation,
  createSavedFlow,
  getCapabilityJob,
  getConversation,
  getModelAssignment,
  listCapabilityJobEvents,
  listMessages,
  updateCapabilityJob,
} from "../db";
import { AI_WORKFLOW_HF_IMAGE_MODEL, AI_IMAGE_GENERATED_MESSAGE, MAX_CACHED_JOB_RESULTS, MAX_CONVERSATION_HISTORY_MESSAGES, OLLAMA_DEFAULT_BASE_URL, type JsonRecord, type JsonValue } from "../config";
import { getApiKey, getBaseUrl } from "../ai-keys";
import { type ChatMessage, chatCompletion, getProviderDefaultModel, listProviderModelsOrDefaults } from "../ai-providers";
import { AI_WORKFLOW_CAPABILITIES_ROUTE, AI_WORKFLOW_JOBS_ROUTE, AI_WORKFLOW_RUN_ROUTE } from "../runtime-constants";
import { persistAiArtifact, persistAiTextArtifact, parseSerializedWorkflowResult } from "./artifact-store";
import { resolveAiWorkflowCapabilities } from "./capabilities";
import { runImageWorkflowLocalFirst } from "./image-workflows";
import { buildWorkflowPrompt, extractYamlFromResponse, isTextWorkflowMode } from "./text-workflows";
import { logger } from "../logger";
import { captureResult, normalizeFailureMessage } from "../../../shared/failure";

interface AiWorkflowJobPayload {
  mode: AiWorkflowMode;
  provider?: string;
  model?: string;
  message: string;
  correlationId: string;
  conversationId?: string;
  textOptions?: JsonRecord;
  imageOptions?: JsonRecord;
}

const workflowResults = new Map<string, AiWorkflowResult>();
const MAX_CACHED_WORKFLOW_RESULTS = MAX_CACHED_JOB_RESULTS;

/** Start a creative workflow job and return loading envelope for polling. */
export function startAiWorkflowJob(request: AiWorkflowRequest, requestedBy?: string): AiWorkflowJobEnvelope {
  const correlationId = request.correlationId?.trim() || crypto.randomUUID();
  const payload: AiWorkflowJobPayload = {
    mode: request.mode,
    provider: request.provider?.trim() || undefined,
    model: request.model?.trim() || undefined,
    message: request.message.trim(),
    correlationId,
    ...(request.conversationId?.trim() ? { conversationId: request.conversationId.trim() } : {}),
    ...(request.textOptions ? { textOptions: request.textOptions as JsonRecord } : {}),
    ...(request.imageOptions ? { imageOptions: request.imageOptions as JsonRecord } : {}),
  };

  const jobId = createCapabilityJob({
    kind: "ai_workflow",
    requestedPayload: serializeWorkflowPayload(payload),
    requestedBy,
    correlationId,
  });

  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Workflow queued (mode=${payload.mode})`,
  });

  void executeWorkflowJob(jobId, payload);

  return {
    route: AI_WORKFLOW_JOBS_ROUTE,
    jobId,
    state: "loading",
    data: {
      jobId,
      status: "queued",
      correlationId,
      stdout: "",
      stderr: "",
      elapsedMs: 0,
    },
    mismatches: [],
  };
}

/** Cancel a workflow job. Sets cancelRequestedAt; running jobs will transition to cancelled on completion. */
export function cancelAiWorkflowJob(jobId: string): AiWorkflowJobEnvelope {
  const job = getCapabilityJob(jobId);
  if (!job || job.kind !== "ai_workflow") {
    const error = createFlowCapabilityError({
      commandIndex: -1,
      command: "jobId",
      reason: `Workflow job '${jobId}' was not found`,
      retryable: false,
      surface: "chat",
      resource: jobId,
    });
    return {
      route: AI_WORKFLOW_JOBS_ROUTE,
      jobId,
      state: "error-non-retryable",
      error,
      mismatches: [error.reason],
    };
  }
  const isTerminal = job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
  if (isTerminal) {
    return getAiWorkflowJobEnvelope(jobId);
  }
  updateCapabilityJob(jobId, {
    status: "cancelled",
    cancelRequestedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    stderr: job.stderr || "Cancelled by operator",
  });
  appendCapabilityJobEvent({
    jobId,
    level: "warn",
    message: "Workflow job cancelled by operator",
  });
  return getAiWorkflowJobEnvelope(jobId);
}

/** Poll workflow-job status envelope. */
export function getAiWorkflowJobEnvelope(jobId: string): AiWorkflowJobEnvelope {
  const job = getCapabilityJob(jobId);
  if (!job || job.kind !== "ai_workflow") {
    const error = createFlowCapabilityError({
      commandIndex: -1,
      command: "jobId",
      reason: `Workflow job '${jobId}' was not found`,
      retryable: false,
      surface: "chat",
      resource: jobId,
    });
    return {
      route: AI_WORKFLOW_JOBS_ROUTE,
      jobId,
      state: "error-non-retryable",
      error,
      mismatches: [error.reason],
    };
  }

  const elapsedMs = Math.max(0, Date.parse(job.updatedAt) - Date.parse(job.createdAt));
  const result = workflowResults.get(jobId) ?? parsePersistedResult(job.stdout);

  const data: AiWorkflowJobResult = {
    jobId,
    status: job.status,
    correlationId: job.correlationId ?? "",
    result,
    stdout: job.stdout,
    stderr: job.stderr,
    elapsedMs,
    ...(job.status === "failed" ? { reason: stripFailureCategory(job.stderr) } : {}),
  };

  const state = mapWorkflowJobState(job.status, job.stderr);
  const mismatches = job.stderr.trim().length > 0
    ? [stripFailureCategory(job.stderr)]
    : [];

  return {
    route: AI_WORKFLOW_JOBS_ROUTE,
    jobId,
    state,
    data,
    mismatches,
    ...(job.status === "failed"
      ? {
        error: createFlowCapabilityError({
          commandIndex: -1,
          command: "workflow",
          reason: stripFailureCategory(job.stderr),
          retryable: job.stderr.startsWith("RETRYABLE:"),
          surface: "chat",
          resource: jobId,
        }),
      }
      : {}),
  };
}

/** List workflow log events for polling and SSE routes. */
export function getAiWorkflowJobLogEvents(jobId: string, afterCursor?: string | null): import("../db").CapabilityJobEventRecord[] {
  return listCapabilityJobEvents(jobId, afterCursor);
}

/** Resolve capability envelope for creative workflow modes. */
export async function getAiWorkflowCapabilityEnvelope(correlationId?: string): Promise<AiWorkflowCapabilityEnvelope> {
  const capabilityResult = await resolveAiWorkflowCapabilities(correlationId);
  const hasAny = capabilityResult.modes.some((item) => item.localAvailable || item.remoteAvailable);
  return {
    route: AI_WORKFLOW_CAPABILITIES_ROUTE,
    state: hasAny ? "success" : "empty",
    data: capabilityResult,
    mismatches: hasAny ? [] : ["No local or remote workflow runtimes are available."],
  };
}

/** Build an initial run envelope from job lookup (used by run route responses). */
export function toAiWorkflowRunEnvelope(jobEnvelope: AiWorkflowJobEnvelope) {
  const result = jobEnvelope.data?.result;
  return {
    route: AI_WORKFLOW_RUN_ROUTE,
    state: jobEnvelope.state,
    data: result,
    error: jobEnvelope.error,
    mismatches: jobEnvelope.mismatches,
  };
}

function mapWorkflowJobState(status: string, stderr: string) {
  if (status === "queued" || status === "running" || status === "paused") {
    return "loading" as const;
  }
  if (status === "succeeded") {
    return "success" as const;
  }
  if (stderr.startsWith("UNAUTHORIZED:")) {
    return "unauthorized" as const;
  }
  if (stderr.startsWith("RETRYABLE:")) {
    return "error-retryable" as const;
  }
  return "error-non-retryable" as const;
}

function stripFailureCategory(reason: string): string {
  return reason
    .replace(/^UNAUTHORIZED:\s*/i, "")
    .replace(/^RETRYABLE:\s*/i, "")
    .replace(/^NON_RETRYABLE:\s*/i, "")
    .trim();
}

function serializeWorkflowPayload(payload: AiWorkflowJobPayload): string {
  const params = new URLSearchParams();
  params.set("kind", "ai_workflow");
  params.set("mode", payload.mode);
  params.set("message", payload.message);
  params.set("correlationId", payload.correlationId);
  if (payload.provider) params.set("provider", payload.provider);
  if (payload.model) params.set("model", payload.model);
  if (payload.conversationId) params.set("conversationId", payload.conversationId);
  if (payload.textOptions) params.set("textOptions", JSON.stringify(payload.textOptions));
  if (payload.imageOptions) params.set("imageOptions", JSON.stringify(payload.imageOptions));
  return params.toString();
}

function parsePersistedResult(raw: string): AiWorkflowResult | undefined {
  const parsed = parseSerializedWorkflowResult(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as JsonRecord;
  if (typeof record.mode !== "string" || typeof record.providerPath !== "string" || typeof record.reply !== "string") {
    return undefined;
  }
  const mode = parseMode(record.mode);
  const artifact = parseArtifact(record.artifact);
  return {
    mode,
    requestedProvider: typeof record.requestedProvider === "string" ? record.requestedProvider : null,
    providerPath: record.providerPath,
    requestedModel: typeof record.requestedModel === "string" ? record.requestedModel : null,
    effectiveModel: typeof record.effectiveModel === "string" ? record.effectiveModel : "",
    reply: record.reply,
    ...(artifact ? { artifact } : {}),
    ...(Array.isArray(record.details)
      ? {
        details: record.details
          .map((value) => (typeof value === "string" ? value : ""))
          .filter((value) => value.length > 0),
      }
      : {}),
  };
}

function parseArtifact(value: JsonValue | undefined): AiArtifactRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as JsonRecord;
  if (
    typeof record.id !== "string"
    || typeof record.jobId !== "string"
    || typeof record.mode !== "string"
    || typeof record.providerPath !== "string"
    || typeof record.promptSummary !== "string"
    || typeof record.artifactPath !== "string"
    || typeof record.mimeType !== "string"
    || typeof record.sha256 !== "string"
    || typeof record.sizeBytes !== "number"
    || typeof record.correlationId !== "string"
    || typeof record.createdAt !== "string"
  ) {
    return undefined;
  }
  return {
    id: record.id,
    jobId: record.jobId,
    mode: parseMode(record.mode),
    providerPath: record.providerPath,
    promptSummary: record.promptSummary,
    artifactPath: record.artifactPath,
    mimeType: record.mimeType,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    correlationId: record.correlationId,
    createdAt: record.createdAt,
  };
}

function parseMode(raw: string): AiWorkflowMode {
  if (raw === "chat" || raw === "typography" || raw === "presentation" || raw === "social" || raw === "image" || raw === "flow_generation") {
    return raw;
  }
  return "chat";
}

function addWorkflowResultToCache(jobId: string, result: AiWorkflowResult): void {
  if (workflowResults.size >= MAX_CACHED_WORKFLOW_RESULTS) {
    const oldest = workflowResults.keys().next().value;
    if (oldest) {
      workflowResults.delete(oldest);
    }
  }
  workflowResults.set(jobId, result);
}

async function executeWorkflowJob(jobId: string, payload: AiWorkflowJobPayload): Promise<void> {
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Workflow started (mode=${payload.mode})`,
  });

  const runOutcome = await runWorkflow(payload, jobId);

  const currentJob = getCapabilityJob(jobId);
  if (currentJob?.cancelRequestedAt) {
    updateCapabilityJob(jobId, {
      status: "cancelled",
      stderr: currentJob.stderr || "Cancelled by operator",
      endedAt: new Date().toISOString(),
    });
    return;
  }

  if (!runOutcome.ok) {
    updateCapabilityJob(jobId, {
      status: "failed",
      stderr: runOutcome.error,
      stdout: "",
      exitCode: 1,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId,
      level: "error",
      message: stripFailureCategory(runOutcome.error),
    });
    return;
  }

  const jobAfterRun = getCapabilityJob(jobId);
  if (jobAfterRun?.cancelRequestedAt) {
    updateCapabilityJob(jobId, {
      status: "cancelled",
      stderr: "Cancelled by operator",
      endedAt: new Date().toISOString(),
    });
    return;
  }

  addWorkflowResultToCache(jobId, runOutcome.data);
  updateCapabilityJob(jobId, {
    status: "succeeded",
    stdout: JSON.stringify(runOutcome.data),
    stderr: "",
    exitCode: 0,
    artifactPath: runOutcome.data.artifact?.artifactPath ?? null,
    endedAt: new Date().toISOString(),
  });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Workflow completed via ${runOutcome.data.providerPath}`,
  });
}

async function runWorkflow(payload: AiWorkflowJobPayload, jobId: string): Promise<{ ok: true; data: AiWorkflowResult } | { ok: false; error: string }> {
  if (!payload.message.trim().length) {
    return { ok: false, error: "NON_RETRYABLE: Workflow message cannot be empty." };
  }

  if (payload.mode === "image") {
    return runImageMode(payload, jobId);
  }

  if (!isTextWorkflowMode(payload.mode)) {
    return { ok: false, error: `NON_RETRYABLE: Unsupported workflow mode '${payload.mode}'.` };
  }

  return runTextMode({ ...payload, mode: payload.mode }, jobId);
}

async function runTextMode(
  payload: AiWorkflowJobPayload & { mode: Exclude<AiWorkflowMode, "image"> },
  jobId: string,
): Promise<{ ok: true; data: AiWorkflowResult } | { ok: false; error: string }> {
  const prompt = buildWorkflowPrompt(payload.mode, payload.message, parseTextOptions(payload.textOptions));
  const localBaseUrl = getBaseUrl("ollama") ?? OLLAMA_DEFAULT_BASE_URL;

  // Resolve model: explicit request > persisted assignment > auto-resolve
  const assignedModel = !payload.model ? getModelAssignment(payload.mode) : null;
  const effectiveModelRequest = payload.model ?? assignedModel?.model ?? undefined;

  const localModel = await resolveLocalModel(effectiveModelRequest, localBaseUrl, payload.correlationId);
  const details: string[] = [];

  // Build conversation history for multi-turn chat
  const conversationMessages = buildConversationMessages(payload.conversationId, prompt);

  // Resolve or create conversation for message persistence
  const conversationId = resolveOrCreateConversation(payload.conversationId, payload.mode, payload.message);

  // Persist the user message
  appendMessage({
    conversationId,
    role: "user",
    content: payload.message,
    mode: payload.mode,
    jobId,
  });

  if (localModel) {
    const local = await chatCompletion(
      "ollama",
      "",
      localModel,
      conversationMessages,
      localBaseUrl,
      payload.correlationId,
    );
    if (local.ok && local.data) {
      // Persist assistant response
      appendMessage({
        conversationId,
        role: "assistant",
        content: local.data,
        mode: payload.mode,
        provider: "ollama",
        model: localModel,
        jobId,
      });

      const artifact = await persistAiTextArtifact({
        jobId,
        mode: payload.mode,
        providerPath: "local:ollama",
        prompt,
        text: local.data,
        correlationId: payload.correlationId,
      });
      if (!artifact.ok) {
        return { ok: false, error: `NON_RETRYABLE: ${artifact.error}` };
      }
      const localResult: AiWorkflowResult = {
        mode: payload.mode,
        requestedProvider: payload.provider ?? null,
        providerPath: "local:ollama",
        requestedModel: payload.model ?? null,
        effectiveModel: localModel,
        reply: local.data,
        artifact: artifact.data,
        details,
        conversationId,
      };
      return { ok: true, data: postProcessFlowGeneration(localResult) };
    }
    details.push(`Local Ollama completion failed: ${local.error ?? "unknown error"}`);
  }

  const remoteKey = getApiKey("huggingface") ?? "";
  if (!remoteKey.trim().length) {
    return { ok: false, error: "UNAUTHORIZED: Missing Hugging Face API key for remote fallback." };
  }
  const remoteBaseUrl = getBaseUrl("huggingface") ?? undefined;
  const remoteModel = await resolveRemoteModel(effectiveModelRequest, remoteKey, remoteBaseUrl, payload.correlationId);
  if (!remoteModel) {
    return { ok: false, error: "NON_RETRYABLE: No model available for Hugging Face fallback." };
  }
  const remote = await chatCompletion(
    "huggingface",
    remoteKey,
    remoteModel,
    conversationMessages,
    remoteBaseUrl,
    payload.correlationId,
  );
  if (!remote.ok || !remote.data) {
    return { ok: false, error: `RETRYABLE: ${remote.error ?? "Remote fallback failed."}` };
  }

  // Persist assistant response
  appendMessage({
    conversationId,
    role: "assistant",
    content: remote.data,
    mode: payload.mode,
    provider: "huggingface",
    model: remoteModel,
    jobId,
  });

  details.push("Used remote Hugging Face fallback text generation.");
  const artifact = await persistAiTextArtifact({
    jobId,
    mode: payload.mode,
    providerPath: "remote:huggingface",
    prompt,
    text: remote.data,
    correlationId: payload.correlationId,
  });
  if (!artifact.ok) {
    return { ok: false, error: `NON_RETRYABLE: ${artifact.error}` };
  }

  const remoteResult: AiWorkflowResult = {
    mode: payload.mode,
    requestedProvider: payload.provider ?? null,
    providerPath: "remote:huggingface",
    requestedModel: payload.model ?? null,
    effectiveModel: remoteModel,
    reply: remote.data,
    artifact: artifact.data,
    details,
    conversationId,
  };
  return { ok: true, data: postProcessFlowGeneration(remoteResult) };
}

async function runImageMode(payload: AiWorkflowJobPayload, jobId: string): Promise<{ ok: true; data: AiWorkflowResult } | { ok: false; error: string }> {
  const imageOutcome = await runImageWorkflowLocalFirst({
    message: payload.message,
    requestedModel: payload.model,
    options: parseImageOptions(payload.imageOptions),
    correlationId: payload.correlationId,
  });
  if (!imageOutcome.ok || !imageOutcome.data) {
    const error = imageOutcome.error ?? "Image generation failed.";
    if (error.toLowerCase().includes("missing hugging face api key")) {
      return { ok: false, error: `UNAUTHORIZED: ${error}` };
    }
    return { ok: false, error: `RETRYABLE: ${error}` };
  }

  const persist = await persistAiArtifact({
    jobId,
    mode: payload.mode,
    providerPath: imageOutcome.data.providerPath,
    prompt: payload.message,
    mimeType: imageOutcome.data.mimeType,
    base64Payload: imageOutcome.data.data,
    correlationId: payload.correlationId,
  });
  if (!persist.ok) {
    return { ok: false, error: `NON_RETRYABLE: ${persist.error}` };
  }

  return {
    ok: true,
    data: {
      mode: payload.mode,
      requestedProvider: payload.provider ?? null,
      providerPath: imageOutcome.data.providerPath,
      requestedModel: payload.model ?? null,
      effectiveModel: imageOutcome.data.model || AI_WORKFLOW_HF_IMAGE_MODEL,
      reply: AI_IMAGE_GENERATED_MESSAGE,
      artifact: persist.data,
      details: imageOutcome.data.details,
    },
  };
}

/** Build the messages array for chatCompletion, including conversation history. */
function buildConversationMessages(
  conversationId: string | undefined,
  currentPrompt: string,
): ChatMessage[] {
  if (!conversationId) {
    return [{ role: "user", content: currentPrompt }];
  }

  const existing = getConversation(conversationId);
  if (!existing) {
    return [{ role: "user", content: currentPrompt }];
  }

  const history = listMessages(conversationId);
  // Cap history to prevent context overflow
  const recent = history.slice(-MAX_CONVERSATION_HISTORY_MESSAGES);
  const messages: ChatMessage[] = recent.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
  messages.push({ role: "user", content: currentPrompt });
  return messages;
}

/** Resolve an existing conversation or create a new one. */
function resolveOrCreateConversation(
  conversationId: string | undefined,
  mode: string,
  message: string,
): string {
  if (conversationId) {
    const existing = getConversation(conversationId);
    if (existing) return existing.id;
  }
  // Auto-generate title from first message
  const title = message.length > 50 ? `${message.slice(0, 47)}...` : message;
  return createConversation(title, mode);
}

function parseTextOptions(input: JsonRecord | undefined) {
  if (!input) {
    return undefined;
  }
  return {
    ...(typeof input.audience === "string" ? { audience: input.audience } : {}),
    ...(typeof input.tone === "string" ? { tone: input.tone } : {}),
    ...(typeof input.format === "string" ? { format: input.format } : {}),
    ...(typeof input.constraints === "string" ? { constraints: input.constraints } : {}),
  };
}

function parseImageOptions(input: JsonRecord | undefined) {
  if (!input) {
    return undefined;
  }
  const seed = typeof input.seed === "number" ? input.seed : undefined;
  const steps = typeof input.steps === "number" ? input.steps : undefined;
  const parsedSize = parseImageSize(typeof input.size === "string" ? input.size : undefined);
  return {
    ...(parsedSize ? { size: parsedSize } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(typeof input.stylePreset === "string" ? { stylePreset: input.stylePreset } : {}),
  };
}

async function resolveLocalModel(
  requestedModel: string | undefined,
  baseUrl: string,
  correlationId: string,
): Promise<string | null> {
  if (requestedModel && requestedModel.trim().length > 0) {
    return requestedModel.trim();
  }
  const listed = await listProviderModelsOrDefaults("ollama", "", baseUrl, correlationId);
  if (listed.ok && listed.data && listed.data.models.length > 0) {
    return listed.data.models[0] ?? null;
  }
  return getProviderDefaultModel("ollama") ?? null;
}

async function resolveRemoteModel(
  requestedModel: string | undefined,
  apiKey: string,
  baseUrl: string | undefined,
  correlationId: string,
): Promise<string | null> {
  if (requestedModel && requestedModel.trim().length > 0) {
    return requestedModel.trim();
  }
  const listed = await listProviderModelsOrDefaults("huggingface", apiKey, baseUrl, correlationId);
  if (listed.ok && listed.data && listed.data.models.length > 0) {
    return listed.data.models[0] ?? null;
  }
  return getProviderDefaultModel("huggingface") ?? null;
}

/** Parse workflow HTTP body into canonical request payload with validation errors as strings. */
export function parseAiWorkflowRequestBody(body: JsonRecord): { request?: AiWorkflowRequest; error?: string } {
  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "";
  const mode = parseMode(modeRaw);
  if (!modeRaw) {
    return { error: "mode is required." };
  }
  if (modeRaw !== mode) {
    return { error: `Unsupported workflow mode '${modeRaw}'.` };
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message.length) {
    return { error: "message is required." };
  }

  const request: AiWorkflowRequest = {
    mode,
    message,
    ...(typeof body.provider === "string" ? { provider: body.provider.trim() } : {}),
    ...(typeof body.model === "string" ? { model: body.model.trim() } : {}),
    ...(typeof body.apiKey === "string" ? { apiKey: body.apiKey } : {}),
    ...(typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl.trim() } : {}),
    ...(typeof body.correlationId === "string" ? { correlationId: body.correlationId.trim() } : {}),
    ...(typeof body.conversationId === "string" && body.conversationId.trim() ? { conversationId: body.conversationId.trim() } : {}),
  };

  if (body.textOptions && typeof body.textOptions === "object" && !Array.isArray(body.textOptions)) {
    const textOptions = body.textOptions as JsonRecord;
    request.textOptions = {
      ...(typeof textOptions.audience === "string" ? { audience: textOptions.audience } : {}),
      ...(typeof textOptions.tone === "string" ? { tone: textOptions.tone } : {}),
      ...(typeof textOptions.format === "string" ? { format: textOptions.format } : {}),
      ...(typeof textOptions.constraints === "string" ? { constraints: textOptions.constraints } : {}),
    };
  }

  if (body.imageOptions && typeof body.imageOptions === "object" && !Array.isArray(body.imageOptions)) {
    const imageOptions = body.imageOptions as JsonRecord;
    const steps = parseNumericOption(imageOptions.steps);
    const seed = parseNumericOption(imageOptions.seed);
    const sizeRaw = typeof imageOptions.size === "string" ? imageOptions.size : undefined;
    const size = parseImageSize(sizeRaw);
    if (sizeRaw && !size) {
      return { error: `imageOptions.size must be one of ${AI_WORKFLOW_IMAGE_SIZES.join(", ")}.` };
    }
    if (steps !== undefined && (steps < 1 || steps > 100)) {
      return { error: "imageOptions.steps must be between 1 and 100." };
    }
    if (seed !== undefined && !Number.isInteger(seed)) {
      return { error: "imageOptions.seed must be an integer." };
    }
    request.imageOptions = {
      ...(size ? { size } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(typeof imageOptions.stylePreset === "string" ? { stylePreset: imageOptions.stylePreset } : {}),
    };
  }

  return { request };
}

function parseNumericOption(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseImageSize(value: string | undefined): AiWorkflowImageSize | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (AI_WORKFLOW_IMAGE_SIZES.includes(normalized as AiWorkflowImageSize)) {
    return normalized as AiWorkflowImageSize;
  }
  return undefined;
}

/** Post-process flow_generation results to extract YAML and auto-save. */
function postProcessFlowGeneration(result: AiWorkflowResult): AiWorkflowResult {
  if (result.mode !== "flow_generation") return result;

  const yaml = extractYamlFromResponse(result.reply);
  if (!yaml) return result;

  // Auto-save the extracted YAML as a saved flow
  const saveName = result.reply.length > 60
    ? `${result.reply.slice(0, 57).replace(/```[\s\S]*$/m, "").trim()}...`
    : "Generated flow";
  const saveResult = captureResult(
    () => createSavedFlow({ name: saveName, yaml, description: "Auto-saved from AI flow generation" }),
    (failure) => normalizeFailureMessage(failure, "Auto-saving generated flow failed."),
  );
  if (!saveResult.ok) {
    logger.warn("Auto-save of generated flow failed", { error: saveResult.error, mode: result.mode });
  }

  return { ...result, extractedYaml: yaml };
}
