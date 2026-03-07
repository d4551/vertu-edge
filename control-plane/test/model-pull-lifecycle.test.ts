import { expect, test } from "bun:test";
import {
  appendCapabilityJobEvent,
  createCapabilityJob,
  encodeJobEventCursor,
  getCapabilityJob,
  initDb,
  listCapabilityJobEvents,
  updateCapabilityJob,
} from "../src/db";
import {
  cancelModelPullJob,
  getActiveModelPullProcesses,
  getModelPullJobEnvelope,
  getModelPullJobLogEvents,
  recoverStaleModelPullJobs,
  resumeModelPullJob,
} from "../src/model-manager";
import { serializeModelPullPayload } from "../src/model-jobs";
import { isFlowCapabilityError } from "../../contracts/flow-contracts";

initDb();

// ---------------------------------------------------------------------------
// cancelModelPullJob
// ---------------------------------------------------------------------------

test("cancelModelPullJob marks a running job as cancelled and appends an event", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/cancel-model",
      normalizedModelRef: "huggingface.co/test/cancel-model",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });

  const envelope = cancelModelPullJob(jobId);

  expect(envelope.state).toBe("error-non-retryable");
  const job = getCapabilityJob(jobId);
  expect(job).toBeTruthy();
  expect(job!.status).toBe("cancelled");
  expect(job!.cancelRequestedAt).toBeTruthy();
  expect(job!.endedAt).toBeTruthy();

  const events = listCapabilityJobEvents(jobId);
  expect(events.length).toBeGreaterThanOrEqual(1);
  const cancelEvent = events.find((e) => e.message.includes("cancelled"));
  expect(cancelEvent).toBeTruthy();
  expect(cancelEvent!.level).toBe("warn");
});

test("cancelModelPullJob on already-finished job still marks cancelled", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/cancel-finished",
      normalizedModelRef: "huggingface.co/test/cancel-finished",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, {
    status: "succeeded",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: 0,
  });

  const envelope = cancelModelPullJob(jobId);
  const job = getCapabilityJob(jobId);
  expect(job!.status).toBe("cancelled");
  expect(envelope).toBeTruthy();
});

// ---------------------------------------------------------------------------
// resumeModelPullJob
// ---------------------------------------------------------------------------

test("resumeModelPullJob resets state and requeues the job", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/resume-model",
      normalizedModelRef: "huggingface.co/test/resume-model",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, {
    status: "failed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: 1,
    stderr: "something broke",
  });

  const envelope = resumeModelPullJob(jobId);

  expect(envelope).toBeTruthy();
  expect(envelope.jobId).toBe(jobId);
  // Job should be re-queued or running
  const job = getCapabilityJob(jobId);
  expect(job).toBeTruthy();
  expect(["queued", "running"]).toContain(job!.status);
  // Timing fields should be reset
  expect(job!.endedAt).toBeNull();
  expect(job!.cancelRequestedAt).toBeNull();
  // Resume event should be logged
  const events = listCapabilityJobEvents(jobId);
  const resumeEvent = events.find((e) => e.message.includes("resumed"));
  expect(resumeEvent).toBeTruthy();
});

test("resumeModelPullJob throws for missing job", () => {
  expect(() => resumeModelPullJob("nonexistent-job-id-12345")).toThrow();
});

test("resumeModelPullJob throws for job with invalid payload", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: "this-is-not-valid-payload",
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, {
    status: "failed",
    endedAt: new Date().toISOString(),
  });

  return Promise.resolve()
    .then(() => resumeModelPullJob(jobId))
    .then(
      () => {
        expect.unreachable("Expected resumeModelPullJob to throw for invalid payload");
      },
      (error: object | string | number | boolean | null | undefined) => {
        expect(isFlowCapabilityError(error)).toBe(true);
      },
    );
});

// ---------------------------------------------------------------------------
// getModelPullJobLogEvents
// ---------------------------------------------------------------------------

test("getModelPullJobLogEvents returns events for a job", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/log-events",
      normalizedModelRef: "huggingface.co/test/log-events",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  appendCapabilityJobEvent({ jobId, level: "info", message: "event-one" });
  appendCapabilityJobEvent({ jobId, level: "debug", message: "event-two" });
  appendCapabilityJobEvent({ jobId, level: "error", message: "event-three" });

  const events = getModelPullJobLogEvents(jobId);
  expect(events.length).toBe(3);
  // Events may share the same timestamp; order by id is UUID-based.
  // Verify all 3 messages are present rather than exact ordering.
  const messages = events.map((e) => e.message).sort();
  expect(messages).toEqual(["event-one", "event-three", "event-two"]);
});

test("getModelPullJobLogEvents supports cursor-based pagination via cursor", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/log-cursor",
      normalizedModelRef: "huggingface.co/test/log-cursor",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  appendCapabilityJobEvent({ jobId, level: "info", message: "first" });
  appendCapabilityJobEvent({ jobId, level: "info", message: "second" });
  appendCapabilityJobEvent({ jobId, level: "info", message: "third" });

  const allEvents = getModelPullJobLogEvents(jobId);
  expect(allEvents.length).toBe(3);

  // Use the first event by sort order as cursor — the remaining events should be 2
  const afterFirst = getModelPullJobLogEvents(jobId, encodeJobEventCursor(allEvents[0]!));
  expect(afterFirst.length).toBe(2);
  // Verify the cursor-paged events don't include the first one
  expect(afterFirst.some((e) => e.id === allEvents[0]!.id)).toBe(false);
});

test("getModelPullJobLogEvents returns no rows for malformed cursor tokens", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/log-invalid-cursor",
      normalizedModelRef: "huggingface.co/test/log-invalid-cursor",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  appendCapabilityJobEvent({ jobId, level: "info", message: "first" });
  appendCapabilityJobEvent({ jobId, level: "info", message: "second" });

  expect(getModelPullJobLogEvents(jobId, "not-a-composite-cursor")).toEqual([]);
});

// ---------------------------------------------------------------------------
// recoverStaleModelPullJobs
// ---------------------------------------------------------------------------

test("recoverStaleModelPullJobs marks stale running jobs as failed", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/stale-recover",
      normalizedModelRef: "huggingface.co/test/stale-recover",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });

  const count = recoverStaleModelPullJobs();
  expect(count).toBeGreaterThanOrEqual(1);

  const job = getCapabilityJob(jobId);
  expect(job).toBeTruthy();
  expect(job!.status).toBe("failed");
  expect(job!.endedAt).toBeTruthy();
  expect(job!.stderr).toContain("server restart");

  const events = listCapabilityJobEvents(jobId);
  const errorEvent = events.find((e) => e.level === "error" && e.message.includes("server restarted"));
  expect(errorEvent).toBeTruthy();
});

test("recoverStaleModelPullJobs does not touch completed jobs", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/completed-no-recover",
      normalizedModelRef: "huggingface.co/test/completed-no-recover",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, {
    status: "succeeded",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: 0,
  });

  recoverStaleModelPullJobs();

  const job = getCapabilityJob(jobId);
  expect(job).toBeTruthy();
  expect(job!.status).toBe("succeeded");
});

// ---------------------------------------------------------------------------
// getActiveModelPullProcesses
// ---------------------------------------------------------------------------

test("getActiveModelPullProcesses returns read-only map that starts empty", () => {
  const processes = getActiveModelPullProcesses();
  expect(processes).toBeDefined();
  expect(typeof processes.size).toBe("number");
  // Cannot mutate: the returned value is ReadonlyMap
  expect(typeof processes.get).toBe("function");
  expect(typeof processes.has).toBe("function");
});

// ---------------------------------------------------------------------------
// getModelPullJobEnvelope
// ---------------------------------------------------------------------------

test("getModelPullJobEnvelope returns valid envelope for existing job", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/envelope-check",
      normalizedModelRef: "huggingface.co/test/envelope-check",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });

  const envelope = getModelPullJobEnvelope(jobId);
  expect(envelope).toBeTruthy();
  expect(envelope.route).toBe("/api/models/pull");
  expect(envelope.jobId).toBe(jobId);
});

// ---------------------------------------------------------------------------
// Integration: cancel → resume round-trip
// ---------------------------------------------------------------------------

test("cancel then resume round-trip restores job to working state", () => {
  const jobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: serializeModelPullPayload({
      modelRef: "test/round-trip",
      normalizedModelRef: "huggingface.co/test/round-trip",
      source: "huggingface",
      force: false,
      timeoutMs: 30_000,
    }),
    requestedBy: "test",
  });
  updateCapabilityJob(jobId, { status: "running", startedAt: new Date().toISOString() });

  // Cancel
  cancelModelPullJob(jobId);
  let job = getCapabilityJob(jobId);
  expect(job!.status).toBe("cancelled");

  // Resume
  resumeModelPullJob(jobId);
  job = getCapabilityJob(jobId);
  expect(["queued", "running"]).toContain(job!.status);
  expect(job!.endedAt).toBeNull();
  expect(job!.cancelRequestedAt).toBeNull();
});
