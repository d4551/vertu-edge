import { join } from "node:path";
import { homedir } from "node:os";
import {
  MODEL_REFERENCE_INVALID_REASON,
  DEFAULT_JOB_TIMEOUT_MS,
  type ModelPullEnvelope,
  type ModelPullRequest,
  createFlowCapabilityError,
  normalizeModelRef,
  validateModelRefWithSource,
  type ModelSource,
} from "../../contracts/flow-contracts";
import { computeSha256Hex } from "./artifact-metadata";
import {
  DEFAULT_CHAT_PULL_MODEL,
  MAX_MODEL_PULL_TIMEOUT_MS,
  MIN_FREE_DISK_BYTES,
  HF_METADATA_TIMEOUT_MS,
  MODEL_PULL_CANCELLED_MESSAGE,
  MODEL_PULL_RESUMED_MESSAGE,
  MODEL_PULL_JOB_NOT_FOUND_REASON,
  MODEL_PULL_JOB_PAYLOAD_INVALID_REASON,
  getModelSourceValidationPolicy,
  parseKnownModelSourceId,
  DEFAULT_MODEL_SOURCE,
  resolveModelSourceConfig,
  safeParseJson,
  type JsonRecord,
} from "./config";
import { statfs } from "node:fs/promises";
import { captureResultAsync, normalizeFailureMessage } from "../../shared/failure";
import {
  appendCapabilityJobEvent,
  createCapabilityJob,
  createLocalModel,
  deleteLocalModel,
  getCapabilityJob,
  getLocalModel,
  listCapabilityJobEvents,
  listLocalModels,
  sqlite,
  updateCapabilityJob,
  type CapabilityJobEventRecord,
  type LocalModelRow,
} from "./db";
import { buildModelPullEnvelope, parseModelPullPayload, serializeModelPullPayload, type ModelPullJobPayload } from "./model-jobs";
import { MODEL_PULL_ROUTE } from "./runtime-constants";

/** Active model pull subprocesses keyed by job ID for cancel support. */
const activeModelPullProcesses = new Map<string, Bun.Subprocess>();

/** Read-only view of active model pull processes (for shutdown hooks and tests). */
export function getActiveModelPullProcesses(): ReadonlyMap<string, Bun.Subprocess> {
  return activeModelPullProcesses;
}

/** Default model used when no model reference is submitted by the model-pull endpoint. */
const DEFAULT_PULL_MODEL_REF = DEFAULT_CHAT_PULL_MODEL;

/** Start a model pull workflow job and immediately return a loading envelope. */
export async function startModelPullJob(
  request: ModelPullRequest,
  requestedBy?: string,
): Promise<ModelPullEnvelope> {
  // Pre-flight: disk space check
  const diskCheck = await checkDiskSpace();
  if (!diskCheck.ok) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "diskSpace",
      reason: diskCheck.reason ?? "Insufficient disk space for model pull.",
      retryable: true,
      surface: "model_pull",
    });
  }

  const payload = buildValidatedModelPayload(request);

  const jobPayload = {
    modelRef: request.modelRef?.trim() || DEFAULT_PULL_MODEL_REF,
    normalizedModelRef: payload.normalizedModelRef,
    source: payload.source,
    platform: payload.platform,
    force: payload.force,
    timeoutMs: payload.timeoutMs,
    correlationId: payload.correlationId,
  };

  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload(jobPayload),
    requestedBy,
    correlationId: jobPayload.correlationId,
  });

  void executeModelPullJob(jobId, jobPayload);

  return {
    route: MODEL_PULL_ROUTE,
    state: "loading",
    jobId,
    data: {
      requestedModelRef: payload.modelRef,
      normalizedModelRef: payload.normalizedModelRef,
      status: "queued",
      exitCode: null,
      stdout: "",
      stderr: "",
      artifactPath: null,
      elapsedMs: 0,
      platform: payload.platform,
    },
    mismatches: [],
  };
}

/** Return the latest pollable envelope for a model pull job id. */
export function getModelPullJobEnvelope(jobId: string): ModelPullEnvelope {
  return buildModelPullEnvelope(getCapabilityJob(jobId));
}

/** Cancel a running model pull job, killing the subprocess if active. */
export function cancelModelPullJob(jobId: string): ModelPullEnvelope {
  const proc = activeModelPullProcesses.get(jobId);
  if (proc) {
    proc.kill();
    activeModelPullProcesses.delete(jobId);
  }
  updateCapabilityJob(jobId, {
    status: "cancelled",
    cancelRequestedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
  appendCapabilityJobEvent({
    jobId,
    level: "warn",
    message: MODEL_PULL_CANCELLED_MESSAGE,
  });
  return getModelPullJobEnvelope(jobId);
}

/** Resume a cancelled/failed model pull job as deterministic requeue on same job id. */
export function resumeModelPullJob(jobId: string): ModelPullEnvelope {
  const job = getCapabilityJob(jobId);
  if (!job) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "jobId",
      code: "MODEL_PULL_JOB_NOT_FOUND",
      category: "validation",
      reason: MODEL_PULL_JOB_NOT_FOUND_REASON,
      retryable: false,
      surface: "model_pull",
      resource: jobId,
    });
  }
  const payload = parseModelPullPayload(job.requestedPayload);
  if (!payload) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "requestedPayload",
      code: "MODEL_PULL_PAYLOAD_INVALID",
      category: "validation",
      reason: MODEL_PULL_JOB_PAYLOAD_INVALID_REASON,
      retryable: false,
      surface: "model_pull",
      resource: jobId,
    });
  }

  updateCapabilityJob(jobId, {
    status: "queued",
    stdout: "",
    stderr: "",
    exitCode: null,
    artifactPath: null,
    startedAt: null,
    endedAt: null,
    cancelRequestedAt: null,
  });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: MODEL_PULL_RESUMED_MESSAGE,
  });
  void executeModelPullJob(jobId, payload);
  return getModelPullJobEnvelope(jobId);
}

/** Return structured model pull log events for polling/SSE routes. */
export function getModelPullJobLogEvents(
  jobId: string,
  afterCursor?: string | null,
): CapabilityJobEventRecord[] {
  return listCapabilityJobEvents(jobId, afterCursor);
}

/** Recover model pull jobs left in running/queued state after a server restart. */
export function recoverStaleModelPullJobs(): number {
  const staleRows = sqlite
    .query<{ id: string }, []>(
      "SELECT id FROM jobs WHERE kind = 'model_pull' AND status IN ('queued', 'running') AND ended_at IS NULL",
    )
    .all();

  for (const row of staleRows) {
    updateCapabilityJob(row.id, {
      status: "failed",
      stderr: "Job was interrupted by server restart.",
      exitCode: 1,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId: row.id,
      level: "error",
      message: "Model pull job marked failed: server restarted during execution",
    });
  }
  return staleRows.length;
}

/** Build and validate the incoming model pull request with explicit constraints. */
function buildValidatedModelPayload(request: ModelPullRequest): ModelPullJobPayload {
  const rawModel = request.modelRef?.trim() || DEFAULT_PULL_MODEL_REF;
  if (!rawModel) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "modelRef",
      reason: "Model reference is required.",
      retryable: false,
      surface: "model_pull",
    });
  }

  const source = request.source
    ? parseKnownModelSourceId(request.source)
    : DEFAULT_MODEL_SOURCE;
  if (!source) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: request.source ?? "model pull source",
      reason: `Unknown model source '${request.source ?? ""}'.`,
      retryable: false,
      surface: "model_pull",
      resource: request.source ?? undefined,
    });
  }
  const sourceConfig = resolveModelSourceConfig(source);
  const validation = validateModelRefWithSource(
    rawModel,
    source,
    getModelSourceValidationPolicy(source),
  );
  if (!validation.ok || !validation.normalized) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: rawModel,
      reason: validation.reason ?? MODEL_REFERENCE_INVALID_REASON,
      retryable: false,
      surface: "model_pull",
      resource: rawModel,
    });
  }

  const normalized = normalizeModelRef(rawModel, source, getModelSourceValidationPolicy(source));
  const allowlist = sourceConfig.enforceAllowlist ? parseModelAllowlist() : [];
  if (allowlist.length > 0 && !allowlist.includes(normalized)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: normalized,
      reason: "Requested model is not in allowed pull list.",
      retryable: false,
      surface: "model_pull",
      resource: normalized,
    });
  }

  if (request.force !== undefined && typeof request.force !== "boolean") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "force",
      reason: "force must be a boolean.",
      retryable: false,
      surface: "model_pull",
    });
  }

  return {
    modelRef: rawModel,
    normalizedModelRef: normalized,
    source,
    platform: request.platform?.trim(),
    force: request.force === true,
    timeoutMs: resolveTimeoutMs(request.timeoutMs),
    correlationId: request.correlationId?.trim(),
  };
}

/** Cached parse result for model allow-list. Null means not yet parsed. */
let _modelAllowlistCache: string[] | null = null;

/** Invalidate the allow-list cache (e.g., after env changes in tests). */
export function invalidateModelAllowlistCache(): void {
  _modelAllowlistCache = null;
}

/** Read model allow-list from environment when configured. Result is cached at module level. */
function parseModelAllowlist(): string[] {
  if (_modelAllowlistCache !== null) {
    return _modelAllowlistCache;
  }

  const allowlistOverride = process.env.RAMALAMA_MODEL_ALLOWLIST_OVERRIDE?.trim().toLowerCase();
  if (allowlistOverride === "1" || allowlistOverride === "true") {
    _modelAllowlistCache = [];
    return _modelAllowlistCache;
  }

  const allowlistEnv = process.env.RAMALAMA_MODEL_ALLOWLIST;
  if (!allowlistEnv) {
    _modelAllowlistCache = [];
    return _modelAllowlistCache;
  }

  _modelAllowlistCache = allowlistEnv
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return _modelAllowlistCache;
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return DEFAULT_JOB_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "timeoutMs",
      reason: "timeoutMs must be an integer.",
      retryable: false,
      surface: "model_pull",
    });
  }
  if (timeoutMs <= 0 || timeoutMs > MAX_MODEL_PULL_TIMEOUT_MS) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "timeoutMs",
      reason: `timeoutMs must be between 1 and ${MAX_MODEL_PULL_TIMEOUT_MS}.`,
      retryable: false,
      surface: "model_pull",
    });
  }

  return timeoutMs;
}

/** Convert normalized model ref to ramalama CLI format. Hugging Face: huggingface.co/owner/repo → huggingface://owner/repo. Exported for tests. */
export function toRamalamaModelRef(normalizedRef: string, source: ModelSource): string {
  const sourceConfig = resolveModelSourceConfig(source);
  const rawPrefix = sourceConfig.ramalamaTransportPrefix?.trim();
  if (!rawPrefix) {
    return normalizedRef;
  }

  const prefix = rawPrefix.endsWith("://") ? rawPrefix : `${rawPrefix}://`;
  if (normalizedRef.startsWith(prefix)) {
    return normalizedRef;
  }

  let transportRef = normalizedRef;
  const canonicalHost = sourceConfig.canonicalHost?.trim().toLowerCase();
  if (canonicalHost) {
    const lowerRef = normalizedRef.toLowerCase();
    const hostPrefix = `${canonicalHost}/`;
    const wwwHostPrefix = `www.${canonicalHost}/`;
    if (lowerRef.startsWith(hostPrefix)) {
      transportRef = normalizedRef.slice(hostPrefix.length);
    } else if (lowerRef.startsWith(wwwHostPrefix)) {
      transportRef = normalizedRef.slice(wwwHostPrefix.length);
    }
  }
  return `${prefix}${transportRef}`;
}

/**
 * Stream subprocess output line-by-line, emitting job events for real-time progress.
 * Returns the full buffered output as a string.
 */
async function streamProcessOutput(
  jobId: string,
  stream: ReadableStream<Uint8Array> | null,
  level: "info" | "debug",
): Promise<string> {
  if (!stream) return "";
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const value of stream.values()) {
    const text = decoder.decode(value, { stream: true });
    buffer += text;
    chunks.push(text);

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        appendCapabilityJobEvent({ jobId, level, message: trimmed });
      }
    }
  }

  if (buffer.trim().length > 0) {
    appendCapabilityJobEvent({ jobId, level, message: buffer.trim() });
  }
  return chunks.join("");
}

/** Max file size in bytes for which SHA256 computation is attempted (4 GB). */
const MAX_SHA256_FILE_SIZE = 4 * 1024 * 1024 * 1024;

/** Timeout for ramalama info / ramalama rm helper commands (10 seconds). */
const HELPER_CMD_TIMEOUT_MS = 10_000;

/**
 * Discover the local artifact path for a pulled model.
 * Strategy 1: Parse ramalama output for path hints.
 * Strategy 2: Run `ramalama info <ref>` and parse the path.
 * Strategy 3: Probe known cache directories.
 * Returns null if nothing found (non-fatal).
 */
export async function discoverModelArtifactPath(
  normalizedRef: string,
  stdout: string,
  stderr: string,
): Promise<string | null> {
  // Strategy 1: Parse ramalama stdout/stderr for path hints
  const combined = `${stdout}\n${stderr}`;
  const pathHintPatterns = [
    /(?:Stored|stored|saved|Saved|Downloaded|downloaded|Path|path)[:\s]+([/~][^\s\n]+)/i,
    /([/~]\S+\.(?:gguf|bin|safetensors|pt|pth|model))/i,
  ];
  for (const pattern of pathHintPatterns) {
    const match = pattern.exec(combined);
    if (match?.[1]) {
      const candidate = match[1].trim();
      const candidateResult = await captureResultAsync(async () => {
        const file = Bun.file(candidate);
        return await file.exists();
      }, (failure) => normalizeFailureMessage(failure, "Model artifact path lookup failed."));
      if (candidateResult.ok && candidateResult.data) {
        return candidate;
      }
    }
  }

  // Strategy 2: Run `ramalama info <ref>` with short timeout
  const ramalamaPath = Bun.which("ramalama");
  if (ramalamaPath) {
    const infoResult = await captureResultAsync(async () => {
      const infoProc = Bun.spawn([ramalamaPath, "info", normalizedRef], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: HELPER_CMD_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      const infoExit = await infoProc.exited;
      if (infoExit === 0 && infoProc.stdout) {
        const infoOutput = await new Response(infoProc.stdout).text();
        const pathMatch = /(?:path|location|file)[:\s]+([/~][^\s\n]+)/i.exec(infoOutput);
        if (pathMatch?.[1]) {
          const candidate = pathMatch[1].trim();
          const file = Bun.file(candidate);
          if (await file.exists()) {
            return candidate;
          }
        }
      }
      return null;
    }, (failure) => normalizeFailureMessage(failure, "ramalama info failed."));
    if (infoResult.ok && infoResult.data) {
      return infoResult.data;
    }
  }

  // Strategy 3: Probe known cache directories
  const home = homedir();
  const cacheDirs = [
    join(home, ".cache", "ramalama"),
    join(home, ".local", "share", "ramalama"),
    process.env.HF_HOME ? join(process.env.HF_HOME, "hub") : join(home, ".cache", "huggingface", "hub"),
  ];
  const refSegments = normalizedRef.replace(/[/\\]/g, "--").toLowerCase();
  for (const cacheDir of cacheDirs) {
    const cacheResult = await captureResultAsync(async () => {
      const probePaths = [
        join(cacheDir, refSegments),
        join(cacheDir, `${refSegments}.gguf`),
      ];
      for (const probe of probePaths) {
        const file = Bun.file(probe);
        if (await file.exists()) {
          return probe;
        }
      }
      return null;
    }, (failure) => normalizeFailureMessage(failure, "Model cache probe failed."));
    if (cacheResult.ok && cacheResult.data) {
      return cacheResult.data;
    }
  }

  return null;
}

/**
 * Clean up partial downloads after a failed model pull.
 * Best-effort: logs warning on failure but never propagates errors.
 */
export async function cleanupPartialDownload(
  jobId: string,
  normalizedRef: string,
): Promise<void> {
  const ramalamaPath = Bun.which("ramalama");
  if (!ramalamaPath) {
    appendCapabilityJobEvent({
      jobId,
      level: "debug",
      message: "Skipping partial download cleanup: ramalama not available",
    });
    return;
  }

  appendCapabilityJobEvent({
    jobId,
    level: "debug",
    message: `Attempting cleanup of partial download for ${normalizedRef}`,
  });
  const cleanupResult = await captureResultAsync(async () => {
    const rmProc = Bun.spawn([ramalamaPath, "rm", normalizedRef], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: HELPER_CMD_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return await rmProc.exited;
  }, (failure) => normalizeFailureMessage(failure, "Partial download cleanup failed."));
  if (!cleanupResult.ok) {
    appendCapabilityJobEvent({
      jobId,
      level: "warn",
      message: `Cleanup failed for ${normalizedRef}: ${cleanupResult.error} (non-fatal)`,
    });
    return;
  }
  if (cleanupResult.data === 0) {
    appendCapabilityJobEvent({
      jobId,
      level: "debug",
      message: `Cleanup succeeded for ${normalizedRef}`,
    });
    return;
  }
  appendCapabilityJobEvent({
    jobId,
    level: "warn",
    message: `Cleanup exited with code ${cleanupResult.data} for ${normalizedRef} (non-fatal)`,
  });
}

/**
 * Pre-flight disk space check. Returns ok=true when sufficient space is available.
 * Uses statfs on the user home directory to detect available disk.
 */
export async function checkDiskSpace(): Promise<{ ok: boolean; freeBytes: number; reason?: string }> {
  const diskResult = await captureResultAsync(async () => {
    const stats = await statfs(homedir());
    return stats.bavail * stats.bsize;
  }, (failure) => normalizeFailureMessage(failure, "Disk space check failed."));
  if (!diskResult.ok) {
    return { ok: true, freeBytes: -1 };
  }
  const freeBytes = diskResult.data;
  if (freeBytes < MIN_FREE_DISK_BYTES) {
    return {
      ok: false,
      freeBytes,
      reason: `Insufficient disk space: ${formatBytes(freeBytes)} free, ${formatBytes(MIN_FREE_DISK_BYTES)} required`,
    };
  }
  return { ok: true, freeBytes };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${bytes} bytes`;
}

/**
 * Resolve HuggingFace model metadata for a normalized model reference.
 * Returns pipeline tag and tags from the HF API. Gracefully returns empty on failure.
 */
export async function resolveHfModelMetadata(
  normalizedRef: string,
): Promise<{ pipelineTag?: string; tags?: string[] }> {
  let repoId = normalizedRef;
  const hfHost = "huggingface.co/";
  const hfIdx = repoId.toLowerCase().indexOf(hfHost);
  if (hfIdx >= 0) {
    repoId = repoId.slice(hfIdx + hfHost.length);
  }
  const segments = repoId.split("/");
  if (segments.length < 2) {
    return {};
  }
  repoId = `${segments[0]}/${segments[1]}`;

  const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hfToken) {
    headers.Authorization = `Bearer ${hfToken}`;
  }

  const metadataResult = await captureResultAsync(async () => {
    const response = await fetch(`https://huggingface.co/api/models/${repoId}`, {
      headers,
      signal: AbortSignal.timeout(HF_METADATA_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const body = await response.text();
    const parseResult = safeParseJson<JsonRecord>(body);
    return parseResult.ok ? parseResult.data : null;
  }, (failure) => normalizeFailureMessage(failure, "Unable to resolve Hugging Face metadata."));
  if (!metadataResult.ok || metadataResult.data === null) {
    return {};
  }
  const data = metadataResult.data;
  const pipelineTag = typeof data.pipeline_tag === "string" ? data.pipeline_tag : undefined;
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined;
  return { pipelineTag, tags };
}

/**
 * Register a model in the local inventory after a successful pull.
 * Performs upsert by normalizedRef + source.
 */
async function registerPulledModel(
  jobId: string,
  payload: ModelPullJobPayload,
  artifactPath: string | null,
  sha256: string | null,
  sizeBytes: number | null,
): Promise<void> {
  const registrationResult = await captureResultAsync(async () => {
    let pipelineTag: string | undefined;
    let tags: string[] | undefined;

    const sourceConfig = resolveModelSourceConfig(payload.source);
    const isHfSource = sourceConfig.canonicalHost?.toLowerCase().includes("huggingface") ?? false;
    if (isHfSource) {
      const hfMeta = await resolveHfModelMetadata(payload.normalizedModelRef);
      pipelineTag = hfMeta.pipelineTag;
      tags = hfMeta.tags;
    }

    const modelId = createLocalModel({
      modelRef: payload.modelRef,
      normalizedRef: payload.normalizedModelRef,
      source: payload.source,
      artifactPath,
      sha256,
      sizeBytes,
      pipelineTag: pipelineTag ?? null,
      capabilities: null,
      tags: tags ? JSON.stringify(tags) : null,
      pullJobId: jobId,
    });
    return { modelId, pipelineTag };
  }, (failure) => normalizeFailureMessage(failure, "Model inventory registration failed."));
  if (!registrationResult.ok) {
    appendCapabilityJobEvent({
      jobId,
      level: "warn",
      message: `Model inventory registration failed: ${registrationResult.error} (non-fatal)`,
    });
    return;
  }
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Model registered in inventory: id=${registrationResult.data.modelId}${registrationResult.data.pipelineTag ? ` pipelineTag=${registrationResult.data.pipelineTag}` : ""}`,
  });
}

/**
 * Delete a model from local inventory and optionally from the runtime cache.
 * Returns ok=true if successfully deleted, otherwise reason.
 */
export async function deleteModel(modelId: string): Promise<{ ok: boolean; reason?: string }> {
  const model = getLocalModel(modelId);
  if (!model) {
    return { ok: false, reason: "Model not found in inventory." };
  }

  // Best-effort: remove from ramalama cache
  const ramalamaPath = Bun.which("ramalama");
  if (ramalamaPath) {
    await captureResultAsync(async () => {
      const proc = Bun.spawn([ramalamaPath, "rm", model.normalizedRef], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: HELPER_CMD_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      await proc.exited;
      return true;
    }, (failure) => normalizeFailureMessage(failure, "Model cache eviction failed."));
  }

  const deleted = deleteLocalModel(modelId);
  if (!deleted) {
    return { ok: false, reason: "Failed to remove model from inventory." };
  }
  return { ok: true };
}

/** List all registered local models. */
export function getModelInventory(): LocalModelRow[] {
  return listLocalModels();
}

/** Execute a background Ramalama pull job with bounded subprocess lifecycle. */
async function executeModelPullJob(jobId: string, payload: ModelPullJobPayload): Promise<void> {
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });
  appendCapabilityJobEvent({
    jobId,
    level: "info",
    message: `Model pull started for ${payload.normalizedModelRef}`,
  });

  const ramalamaPath = Bun.which("ramalama");
  if (!ramalamaPath) {
    const reason = "ramalama is not installed or not on PATH. Install: pip install ramalama or curl -fsSL https://ramalama.ai/install.sh | bash";
    updateCapabilityJob(jobId, {
      status: "failed",
      stdout: "",
      stderr: reason,
      exitCode: 1,
      artifactPath: null,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({ jobId, level: "error", message: reason });
    return;
  }

  const repoRoot = join(import.meta.dir, "..");
  const ramalamaModelRef = toRamalamaModelRef(payload.normalizedModelRef, payload.source);
  const args = ["pull", ramalamaModelRef];
  if (payload.force) {
    args.push("--force");
  }

  const spawnResult = await captureResultAsync(async () => {
    const proc = Bun.spawn([ramalamaPath, ...args], {
      cwd: repoRoot,
      env: buildRamalamaEnv(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: payload.timeoutMs,
      killSignal: "SIGKILL",
    });
    return proc;
  }, (failure) => normalizeFailureMessage(failure, "Model pull process failed."));
  if (!spawnResult.ok) {
    updateCapabilityJob(jobId, {
      status: "failed",
      stdout: "",
      stderr: spawnResult.error,
      exitCode: 1,
      artifactPath: null,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId,
      level: "error",
      message: `Model pull failed: ${spawnResult.error}`,
    });
    await cleanupPartialDownload(jobId, payload.normalizedModelRef);
    return;
  }

  const proc = spawnResult.data;
  activeModelPullProcesses.set(jobId, proc);
  appendCapabilityJobEvent({ jobId, level: "debug", message: `Spawned ramalama pull ${ramalamaModelRef}` });

  const executionResult = await captureResultAsync(async () => {
    const [stdout, stderr] = await Promise.all([
      streamProcessOutput(jobId, proc.stdout, "info"),
      streamProcessOutput(jobId, proc.stderr, "debug"),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }, (failure) => normalizeFailureMessage(failure, "Model pull process failed."));
  activeModelPullProcesses.delete(jobId);
  if (!executionResult.ok) {
    updateCapabilityJob(jobId, {
      status: "failed",
      stdout: "",
      stderr: executionResult.error,
      exitCode: 1,
      artifactPath: null,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId,
      level: "error",
      message: `Model pull failed: ${executionResult.error}`,
    });
    await cleanupPartialDownload(jobId, payload.normalizedModelRef);
    return;
  }

  const { stdout, stderr, exitCode } = executionResult.data;
  appendCapabilityJobEvent({
    jobId,
    level: exitCode === 0 ? "info" : "error",
    message: exitCode === 0
      ? `Model pull completed for ${payload.normalizedModelRef}`
      : `Model pull failed with exit code ${exitCode}`,
  });

  if (exitCode === 0) {
    const artifactPath = await discoverModelArtifactPath(payload.normalizedModelRef, stdout, stderr);
    let sha256: string | null = null;
    let sizeBytes: number | null = null;

    if (artifactPath) {
      appendCapabilityJobEvent({
        jobId,
        level: "info",
        message: `Artifact discovered at ${artifactPath}`,
      });
      const verifyResult = await captureResultAsync(async () => {
        const file = Bun.file(artifactPath);
        const stats = await file.stat();
        const verifiedSizeBytes = stats.size;
        if (stats.size > MAX_SHA256_FILE_SIZE) {
          return { sizeBytes: verifiedSizeBytes, sha256: null };
        }
        return {
          sizeBytes: verifiedSizeBytes,
          sha256: await computeSha256Hex(artifactPath),
        };
      }, (failure) => normalizeFailureMessage(failure, "Artifact verification failed."));
      if (!verifyResult.ok) {
        appendCapabilityJobEvent({
          jobId,
          level: "warn",
          message: `Artifact verification failed: ${verifyResult.error} (non-fatal)`,
        });
      } else {
        sizeBytes = verifyResult.data.sizeBytes;
        sha256 = verifyResult.data.sha256;
        appendCapabilityJobEvent({
          jobId,
          level: "info",
          message: sha256
            ? `Artifact verified: size=${sizeBytes} sha256=${sha256}`
            : `Artifact size=${sizeBytes} exceeds SHA256 threshold (${MAX_SHA256_FILE_SIZE}), skipping checksum`,
        });
      }
    } else {
      appendCapabilityJobEvent({
        jobId,
        level: "debug",
        message: "No artifact path discovered (non-fatal; model may be stored in runtime-managed cache)",
      });
    }

    updateCapabilityJob(jobId, {
      status: "succeeded",
      stdout,
      stderr,
      exitCode,
      artifactPath,
      endedAt: new Date().toISOString(),
    });
    appendCapabilityJobEvent({
      jobId,
      level: "info",
      message: `Model pull succeeded for ${payload.normalizedModelRef}`,
    });
    await registerPulledModel(jobId, payload, artifactPath, sha256, sizeBytes);
    return;
  }

  updateCapabilityJob(jobId, {
    status: "failed",
    stdout,
    stderr,
    exitCode,
    artifactPath: null,
    endedAt: new Date().toISOString(),
  });
  await cleanupPartialDownload(jobId, payload.normalizedModelRef);
}

function buildRamalamaEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const copyIfPresent = (key: string): void => {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  };

  copyIfPresent("PATH");
  copyIfPresent("HOME");
  copyIfPresent("HF_HOME");
  copyIfPresent("HF_TOKEN");
  copyIfPresent("HUGGINGFACE_HUB_TOKEN");
  copyIfPresent("HUGGINGFACE_HUB_CACHE");
  copyIfPresent("XDG_CACHE_HOME");
  copyIfPresent("HTTPS_PROXY");
  copyIfPresent("HTTP_PROXY");
  copyIfPresent("NO_PROXY");
  env.PYTHONUNBUFFERED = "1";

  return env;
}
