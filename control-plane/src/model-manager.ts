import { join } from "path";
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
import {
  DEFAULT_CHAT_PULL_MODEL,
  MAX_MODEL_PULL_TIMEOUT_MS,
  getModelSourceValidationPolicy,
  parseKnownModelSourceId,
  DEFAULT_MODEL_SOURCE,
  resolveModelSourceConfig,
} from "./config";
import { createCapabilityJob, getCapabilityJob, updateCapabilityJob } from "./db";
import { buildModelPullEnvelope, serializeModelPullPayload, type ModelPullJobPayload } from "./model-jobs";
import { MODEL_PULL_ROUTE } from "./runtime-constants";

type FailureInput = Error | string | number | boolean | null | undefined | { readonly message?: string };

/** Default model used when no model reference is submitted by the model-pull endpoint. */
const DEFAULT_PULL_MODEL_REF = DEFAULT_CHAT_PULL_MODEL;

/** Start a model pull workflow job and immediately return a loading envelope. */
export async function startModelPullJob(
  request: ModelPullRequest,
  requestedBy?: string,
): Promise<ModelPullEnvelope> {
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

/** Execute a background Ramalama pull job with bounded subprocess lifecycle. */
async function executeModelPullJob(jobId: string, payload: ModelPullJobPayload): Promise<void> {
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });

  const ramalamaPath = Bun.which("ramalama");
  if (!ramalamaPath) {
    updateCapabilityJob(jobId, {
      status: "failed",
      stdout: "",
      stderr: "ramalama is not installed or not on PATH. Install: pip install ramalama or curl -fsSL https://ramalama.ai/install.sh | bash",
      exitCode: 1,
      artifactPath: null,
      endedAt: new Date().toISOString(),
    });
    return;
  }

  const repoRoot = join(import.meta.dir, "..");
  const ramalamaModelRef = toRamalamaModelRef(payload.normalizedModelRef, payload.source);
  const args = ["pull", ramalamaModelRef];
  if (payload.force) {
    args.push("--force");
  }

  return Promise.resolve()
    .then(() => Bun.spawn([ramalamaPath, ...args], {
      cwd: repoRoot,
      env: buildRamalamaEnv(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: payload.timeoutMs,
      killSignal: "SIGKILL",
    }))
    .then(async (proc) => {
      const [stdout, stderr] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
        proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
      ]);
      const exitCode = await proc.exited;

      updateCapabilityJob(jobId, {
        status: exitCode === 0 ? "succeeded" : "failed",
        stdout,
        stderr,
        exitCode,
        artifactPath: null,
        endedAt: new Date().toISOString(),
      });
    }, (failure) => {
      updateCapabilityJob(jobId, {
        status: "failed",
        stdout: "",
        stderr: normalizeFailureMessage(failure),
        exitCode: 1,
        artifactPath: null,
        endedAt: new Date().toISOString(),
      });
    });
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

function normalizeFailureMessage(value: FailureInput): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object" && value !== null && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "Model pull process failed.";
}
