import {
  type FlowRunJobEnvelope,
  type FlowRunAction,
  type FlowRunJobRequest,
  type FlowRunJobResult,
  type FlowRunRequest,
  type FlowRunResult,
  createFlowCapabilityError,
} from "../../contracts/flow-contracts";
import {
  appendCapabilityJobEvent,
  createCapabilityJob,
  getCapabilityJob,
  listCapabilityJobEvents,
  updateCapabilityJob,
} from "./db";
import { safeParseJson, MAX_CACHED_JOB_RESULTS, type JsonRecord, type JsonValue } from "./config";
import { RPADriver } from "./flow-engine";
import { parseFlowTarget } from "./flow-target-parser";
import { parseMaestroYaml } from "./yaml-parser";

const FLOW_RUN_ROUTE = "/api/flows/runs" as const;

interface FlowRunJobPayload extends FlowRunRequest {
  correlationId: string;
  replayCommandIndex?: number;
}

const activeRunControl = new Map<string, { pause: boolean; cancel: boolean }>();
const flowRunResults = new Map<string, FlowRunResult>();
const MAX_CACHED_RUN_RESULTS = MAX_CACHED_JOB_RESULTS;

/** Start a flow run job and return a loading envelope. */
export function startFlowRunJob(request: FlowRunJobRequest, requestedBy?: string): FlowRunJobEnvelope {
  const correlationId = request.correlationId?.trim() || crypto.randomUUID();
  const payload: FlowRunJobPayload = {
    yaml: request.yaml,
    target: request.target,
    maxAttempts: request.maxAttempts,
    commandTimeoutMs: request.commandTimeoutMs,
    retryDelayMs: request.retryDelayMs,
    correlationId,
    replayCommandIndex: undefined,
  };

  const runId = createCapabilityJob({
    kind: "flow_run",
    requestedPayload: serializeFlowRunPayload(payload),
    requestedBy,
    correlationId,
  });

  appendCapabilityJobEvent({
    jobId: runId,
    level: "info",
    message: `Flow run queued (target=${payload.target ?? "default"})`,
  });
  void executeFlowRunJob(runId, payload);

  return {
    route: FLOW_RUN_ROUTE,
    runId,
    state: "loading",
    data: {
      runId,
      status: "queued",
      correlationId,
      stdout: "",
      stderr: "",
      elapsedMs: 0,
    },
    mismatches: [],
  };
}

/** Poll a flow run job envelope. */
export function getFlowRunJobEnvelope(runId: string): FlowRunJobEnvelope {
  const job = getCapabilityJob(runId);
  if (!job || job.kind !== "flow_run") {
    const error = createFlowCapabilityError({
      commandIndex: -1,
      command: "runId",
      code: "FLOW_RUN_NOT_FOUND",
      category: "validation",
      reason: `Flow run '${runId}' was not found`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
    return {
      route: FLOW_RUN_ROUTE,
      runId,
      state: "error-non-retryable",
      error,
      mismatches: [error.reason],
    };
  }

  const elapsedMs = Math.max(0, Date.parse(job.updatedAt) - Date.parse(job.createdAt));

  // Resolve FlowRunResult: prefer in-memory cache (active run), then parse from the
  // persisted stdout column so results survive a server restart.
  const cachedResult = flowRunResults.get(runId);
  let persistedResult: FlowRunResult | undefined;
  if (!cachedResult && job.stdout) {
    persistedResult = parseFlowRunResultPayload(job.stdout);
  }

  const result: FlowRunJobResult = {
    runId,
    status: job.status,
    correlationId: job.correlationId ?? "",
    result: cachedResult ?? persistedResult,
    stdout: job.stdout,
    stderr: job.stderr,
    elapsedMs,
    reason: job.status === "cancelled" ? "Cancelled by operator" : undefined,
  };

  const state = job.status === "queued" || job.status === "running" || job.status === "paused"
    ? "loading"
    : job.status === "succeeded"
      ? "success"
      : "error-non-retryable";

  return {
    route: FLOW_RUN_ROUTE,
    runId,
    state,
    data: result,
    mismatches: [],
  };
}

/** Cancel a running flow job. */
export function cancelFlowRunJob(runId: string): FlowRunJobEnvelope {
  // Fix 5: Verify the job exists and is actually a flow_run before cancelling.
  const existing = getCapabilityJob(runId);
  if (!existing || existing.kind !== "flow_run") {
    const error = createFlowCapabilityError({
      commandIndex: -1,
      command: "runId",
      code: "FLOW_RUN_NOT_FOUND",
      category: "validation",
      reason: `Flow run '${runId}' was not found or is not a flow run job`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
    return {
      route: FLOW_RUN_ROUTE,
      runId,
      state: "error-non-retryable",
      error,
      mismatches: [error.reason],
    };
  }

  const control = activeRunControl.get(runId);
  if (control) {
    control.cancel = true;
  }
  updateCapabilityJob(runId, {
    status: "cancelled",
    cancelRequestedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
  appendCapabilityJobEvent({
    jobId: runId,
    level: "warn",
    message: "Flow run cancelled by operator",
  });
  return getFlowRunJobEnvelope(runId);
}

/** Pause a running flow job. */
export function pauseFlowRunJob(runId: string): FlowRunJobEnvelope {
  const existing = getCapabilityJob(runId);
  if (!existing || existing.kind !== "flow_run") {
    const error = createFlowCapabilityError({
      commandIndex: -1,
      command: "runId",
      code: "FLOW_RUN_NOT_FOUND",
      category: "validation",
      reason: `Flow run '${runId}' was not found or is not a flow run job`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
    return {
      route: FLOW_RUN_ROUTE,
      runId,
      state: "error-non-retryable",
      error,
      mismatches: [error.reason],
    };
  }
  const control = activeRunControl.get(runId);
  if (control) {
    control.pause = true;
  }
  updateCapabilityJob(runId, {
    status: "paused",
  });
  appendCapabilityJobEvent({
    jobId: runId,
    level: "info",
    message: "Flow run paused by operator",
  });
  return getFlowRunJobEnvelope(runId);
}

/** Resume a paused flow job. */
export function resumeFlowRunJob(runId: string): FlowRunJobEnvelope {
  const control = activeRunControl.get(runId);
  if (control) {
    control.pause = false;
    updateCapabilityJob(runId, {
      status: "running",
    });
    appendCapabilityJobEvent({
      jobId: runId,
      level: "info",
      message: "Flow run resumed by operator",
    });
    return getFlowRunJobEnvelope(runId);
  }

  const existing = getCapabilityJob(runId);
  if (!existing) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "runId",
      code: "FLOW_RUN_NOT_FOUND",
      category: "validation",
      reason: `Flow run '${runId}' was not found`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
  }

  const payload = parseFlowRunPayload(existing.requestedPayload);
  if (!payload) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "requestedPayload",
      code: "FLOW_RUN_PAYLOAD_INVALID",
      category: "validation",
      reason: `Flow run payload for '${runId}' is invalid`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
  }

  updateCapabilityJob(runId, {
    status: "queued",
    stdout: "",
    stderr: "",
    exitCode: null,
    startedAt: null,
    endedAt: null,
    cancelRequestedAt: null,
  });
  appendCapabilityJobEvent({
    jobId: runId,
    level: "info",
    message: "Flow run resumed as deterministic requeue",
  });
  void executeFlowRunJob(runId, payload);
  return getFlowRunJobEnvelope(runId);
}

/** Replay a failed step from an existing flow run. */
export function replayFlowRunStep(runId: string, commandIndex: number): FlowRunJobEnvelope {
  const job = getCapabilityJob(runId);
  if (!job) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "runId",
      code: "FLOW_RUN_NOT_FOUND",
      category: "validation",
      reason: `Flow run '${runId}' was not found`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
  }

  // Fix 6: Guard against replaying steps while the run is still in progress.
  if (job.status === "running" || job.status === "queued" || job.status === "paused") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "runId",
      code: "FLOW_RUN_IN_PROGRESS",
      category: "validation",
      reason: "Cannot replay steps while run is in progress.",
      retryable: false,
      surface: "flow",
      resource: runId,
    });
  }

  const payload = parseFlowRunPayload(job.requestedPayload);
  if (!payload) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "requestedPayload",
      code: "FLOW_RUN_PAYLOAD_INVALID",
      category: "validation",
      reason: `Flow run payload for '${runId}' is invalid`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
  }

  const flow = parseMaestroYaml(payload.yaml);
  const replayStep = flow.steps[commandIndex];
  if (!replayStep) {
    throw createFlowCapabilityError({
      commandIndex,
      command: "commandIndex",
      code: "FLOW_REPLAY_STEP_OUT_OF_RANGE",
      category: "validation",
      reason: `Step index ${commandIndex} is out of range`,
      retryable: false,
      surface: "flow",
      resource: runId,
    });
  }

  const replayPayload: FlowRunJobPayload = {
    ...payload,
    replayCommandIndex: commandIndex,
  };

  updateCapabilityJob(runId, {
    status: "queued",
    stdout: "",
    stderr: "",
    exitCode: null,
    startedAt: null,
    endedAt: null,
    cancelRequestedAt: null,
  });
  appendCapabilityJobEvent({
    jobId: runId,
    level: "info",
    message: `Replaying step ${commandIndex + 1}`,
    commandIndex,
  });
  void executeFlowRunJob(runId, replayPayload);
  return getFlowRunJobEnvelope(runId);
}

/** List flow run log events for polling/SSE endpoints. */
export function getFlowRunLogEvents(runId: string, afterCursor?: string | null): import("./db").CapabilityJobEventRecord[] {
  return listCapabilityJobEvents(runId, afterCursor);
}

async function executeFlowRunJob(runId: string, payload: FlowRunJobPayload): Promise<void> {
  // Guard: prevent concurrent execution of the same runId.
  if (activeRunControl.has(runId)) {
    appendCapabilityJobEvent({
      jobId: runId,
      level: "warn",
      message: "Rejected duplicate execution: run is already active",
    });
    return;
  }

  updateCapabilityJob(runId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const control = { pause: false, cancel: false };
  activeRunControl.set(runId, control);

  appendCapabilityJobEvent({
    jobId: runId,
    level: "info",
    message: "Flow execution started",
  });

  const parsedFlow = parseMaestroYaml(payload.yaml);
  const replayStartIndex = payload.replayCommandIndex ?? 0;
  const flow = payload.replayCommandIndex === undefined
    ? parsedFlow
    : {
        ...parsedFlow,
        steps: [parsedFlow.steps[payload.replayCommandIndex]].filter((step): step is typeof parsedFlow.steps[number] => step !== undefined),
      };
  if (flow.steps.length === 0) {
    updateCapabilityJob(runId, {
      status: "failed",
      endedAt: new Date().toISOString(),
      stderr: `Replay step index ${payload.replayCommandIndex} is out of range`,
      exitCode: 1,
    });
    appendCapabilityJobEvent({
      jobId: runId,
      level: "error",
      message: `Replay step index ${payload.replayCommandIndex} is out of range`,
      commandIndex: payload.replayCommandIndex,
    });
    activeRunControl.delete(runId);
    return;
  }
  const driver = new RPADriver();
  driver.hooks = {
    onCommandStart: async (context) => {
      while (control.pause) {
        await wait(100);
      }
      if (control.cancel) {
        throw new Error("Flow run cancelled by operator");
      }
      appendCapabilityJobEvent({
        jobId: runId,
        level: "info",
        message: `Starting command ${context.commandType} (attempt ${context.attempt})`,
        commandIndex: context.commandIndex + replayStartIndex,
      });
    },
    onCommandComplete: (context) => {
      appendCapabilityJobEvent({
        jobId: runId,
        level: context.result.state === "success" ? "info" : "warn",
        message: context.result.message,
        commandIndex: context.commandIndex + replayStartIndex,
      });
    },
  };

  return driver.executeFlow(flow, {
    target: payload.target,
    maxAttempts: payload.maxAttempts,
    commandTimeoutMs: payload.commandTimeoutMs,
    retryDelayMs: payload.retryDelayMs,
    correlationId: payload.correlationId,
  }).then((result) => {
    const normalizedResult = replayStartIndex > 0 ? remapFlowResultIndices(result, replayStartIndex) : result;
    if (flowRunResults.size >= MAX_CACHED_RUN_RESULTS) {
      const oldest = flowRunResults.keys().next().value;
      if (oldest) flowRunResults.delete(oldest);
    }
    flowRunResults.set(runId, normalizedResult);

    // Fix 4: Check in-memory cancel flag AND re-read DB state to guard against
    // a cancel-then-complete race where cancelFlowRunJob already wrote "cancelled"
    // to the database before this completion callback ran.
    const currentJob = getCapabilityJob(runId);
    if (control.cancel || currentJob?.status === "cancelled") {
      // Only overwrite if the DB hasn't already been set to cancelled by the external cancel call.
      if (currentJob?.status !== "cancelled") {
        updateCapabilityJob(runId, {
          status: "cancelled",
          endedAt: new Date().toISOString(),
          stdout: JSON.stringify(normalizedResult),
          stderr: "Run cancelled by operator",
          exitCode: 130,
        });
      }
      appendCapabilityJobEvent({
        jobId: runId,
        level: "warn",
        message: "Flow run cancelled",
      });
      return;
    }

    const status = normalizedResult.state === "success" ? "succeeded" : "failed";
    updateCapabilityJob(runId, {
      status,
      endedAt: new Date().toISOString(),
      stdout: JSON.stringify(normalizedResult),
      stderr: normalizedResult.state === "success" ? "" : (normalizedResult.results.find((item) => item.state !== "success")?.message ?? "Flow execution failed"),
      exitCode: normalizedResult.state === "success" ? 0 : 1,
    });
    appendCapabilityJobEvent({
      jobId: runId,
      level: normalizedResult.state === "success" ? "info" : "error",
      message: normalizedResult.state === "success" ? "Flow run succeeded" : "Flow run failed",
    });
  }, (failure) => {
    updateCapabilityJob(runId, {
      status: "failed",
      endedAt: new Date().toISOString(),
      stderr: normalizeFailureMessage(failure),
      exitCode: 1,
    });
    appendCapabilityJobEvent({
      jobId: runId,
      level: "error",
      message: `Flow run failed: ${normalizeFailureMessage(failure)}`,
    });
  }).finally(() => {
    activeRunControl.delete(runId);
  });
}

function serializeFlowRunPayload(payload: FlowRunJobPayload): string {
  const params = new URLSearchParams();
  params.set("kind", "flow_run");
  params.set("yaml", payload.yaml);
  params.set("correlationId", payload.correlationId);
  if (payload.target) params.set("target", payload.target);
  if (payload.maxAttempts !== undefined) params.set("maxAttempts", String(payload.maxAttempts));
  if (payload.commandTimeoutMs !== undefined) params.set("commandTimeoutMs", String(payload.commandTimeoutMs));
  if (payload.retryDelayMs !== undefined) params.set("retryDelayMs", String(payload.retryDelayMs));
  if (payload.replayCommandIndex !== undefined) params.set("replayCommandIndex", String(payload.replayCommandIndex));
  return params.toString();
}

function parseFlowRunPayload(rawPayload: string): FlowRunJobPayload | null {
  const params = new URLSearchParams(rawPayload);
  if (params.get("kind") !== "flow_run") {
    return null;
  }

  const yaml = params.get("yaml");
  const correlationId = params.get("correlationId");
  if (!yaml || !correlationId) {
    return null;
  }

  const maxAttemptsRaw = params.get("maxAttempts");
  const commandTimeoutRaw = params.get("commandTimeoutMs");
  const retryDelayRaw = params.get("retryDelayMs");
  const replayCommandIndexRaw = params.get("replayCommandIndex");
  const rawTarget = params.get("target");
  const target = rawTarget ? parseFlowTarget(rawTarget) : undefined;

  return {
    yaml,
    target,
    maxAttempts: maxAttemptsRaw ? Number.parseInt(maxAttemptsRaw, 10) : undefined,
    commandTimeoutMs: commandTimeoutRaw ? Number.parseInt(commandTimeoutRaw, 10) : undefined,
    retryDelayMs: retryDelayRaw ? Number.parseInt(retryDelayRaw, 10) : undefined,
    correlationId,
    replayCommandIndex: replayCommandIndexRaw ? Number.parseInt(replayCommandIndexRaw, 10) : undefined,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

type FailureValue =
  | Error
  | string
  | number
  | boolean
  | { message?: string }
  | null
  | undefined;

function normalizeFailureMessage(value: FailureValue): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return "Flow run execution failed";
}

function parseFlowRunResultPayload(rawPayload: string): FlowRunResult | undefined {
  const parsed = safeParseJson<JsonValue>(rawPayload);
  if (!parsed.ok) {
    return undefined;
  }
  return isFlowRunResult(parsed.data) ? parsed.data : undefined;
}

function isFlowRunAction(value: FlowRunAction | JsonValue): value is FlowRunAction {
  if (!isJsonRecord(value)) {
    return false;
  }
  const commandIndex = readJsonField(value, "commandIndex");
  const commandType = readJsonField(value, "commandType");
  const target = readJsonField(value, "target");
  const attempts = readJsonField(value, "attempts");
  return (
    typeof commandIndex === "number"
    && typeof commandType === "string"
    && typeof target === "string"
    && (attempts === undefined || Array.isArray(attempts))
  );
}

function isFlowRunResult(value: FlowRunResult | JsonValue): value is FlowRunResult {
  if (!isJsonRecord(value)) {
    return false;
  }

  const appId = readJsonField(value, "appId");
  const commandCount = readJsonField(value, "commandCount");
  const state = readJsonField(value, "state");
  const durationMs = readJsonField(value, "durationMs");
  const target = readJsonField(value, "target");
  const results = readJsonField(value, "results");
  const actions = readJsonField(value, "actions");
  const policy = readJsonField(value, "policy");

  if (
    typeof appId !== "string"
    || typeof commandCount !== "number"
    || !Number.isInteger(commandCount)
    || commandCount < 0
    || (state !== "success" && state !== "error-retryable" && state !== "error-non-retryable")
    || typeof durationMs !== "number"
    || !Number.isFinite(durationMs)
    || (target !== undefined && typeof target !== "string")
    || !Array.isArray(results)
  ) {
    return false;
  }

  if (actions !== undefined && (!Array.isArray(actions) || !actions.every((item) => isFlowRunAction(item)))) {
    return false;
  }
  if (policy !== undefined && (policy === null || typeof policy !== "object" || Array.isArray(policy))) {
    return false;
  }

  return true;
}

function isJsonRecord(value: FlowRunAction | FlowRunResult | JsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonField(record: JsonRecord, key: string): JsonValue | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return record[key];
}

function remapFlowResultIndices(result: FlowRunResult, offset: number): FlowRunResult {
  return {
    ...result,
    actions: result.actions?.map((action) => ({
      ...action,
      commandIndex: action.commandIndex + offset,
      attempts: action.attempts.map((attempt) => ({
        ...attempt,
        commandIndex: attempt.commandIndex + offset,
      })),
    })),
    results: result.results.map((entry) => ({
      ...entry,
      commandIndex: entry.commandIndex + offset,
    })),
  };
}
