import { expect, test, describe } from "bun:test";
import {
  createCapabilityJob,
  updateCapabilityJob,
  appendCapabilityJobEvent,
  getCapabilityJob,
  listCapabilityJobEvents,
  listCapabilityJobs,
  pruneOldJobs,
  initDb,
} from "../src/db";
import { runPrunePass, runVacuum } from "../src/housekeeping";

initDb();

// ---------------------------------------------------------------------------
// listCapabilityJobs
// ---------------------------------------------------------------------------

describe("listCapabilityJobs", () => {
  test("returns paginated results with total", () => {
    // Create a few jobs
    for (let i = 0; i < 5; i++) {
      createCapabilityJob({
        kind: "model_pull",
        requestedPayload: JSON.stringify({ ref: `test/paginated-${i}` }),
        requestedBy: "test",
      });
    }

    const result = listCapabilityJobs({ kind: "model_pull", limit: 3, offset: 0 });
    expect(result.jobs.length).toBeLessThanOrEqual(3);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });

  test("filters by kind", () => {
    const jobId = createCapabilityJob({
      kind: "app_build",
      requestedPayload: JSON.stringify({ ref: "test/kind-filter" }),
      requestedBy: "test",
    });

    const pullResult = listCapabilityJobs({ kind: "model_pull", limit: 100, offset: 0 });
    const buildResult = listCapabilityJobs({ kind: "app_build", limit: 100, offset: 0 });

    // The app_build job should not appear in model_pull results
    expect(pullResult.jobs.some((j) => j.id === jobId)).toBe(false);
    // But should appear in app_build results
    expect(buildResult.jobs.some((j) => j.id === jobId)).toBe(true);
  });

  test("filters by status", () => {
    const jobId = createCapabilityJob({
      kind: "model_pull",
      requestedPayload: JSON.stringify({ ref: "test/status-filter" }),
      requestedBy: "test",
    });
    updateCapabilityJob(jobId, {
      status: "succeeded",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: 0,
    });

    const succeededResult = listCapabilityJobs({ kind: "model_pull", status: "succeeded", limit: 100, offset: 0 });
    expect(succeededResult.jobs.some((j) => j.id === jobId)).toBe(true);

    const failedResult = listCapabilityJobs({ kind: "model_pull", status: "failed", limit: 100, offset: 0 });
    expect(failedResult.jobs.some((j) => j.id === jobId)).toBe(false);
  });

  test("returns empty results for offset beyond total", () => {
    const result = listCapabilityJobs({ kind: "model_pull", limit: 10, offset: 99999 });
    expect(result.jobs.length).toBe(0);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("clamps limit to [1, 100]", () => {
    const result = listCapabilityJobs({ kind: "model_pull", limit: 200 });
    // Internal limit clamped to 100 — just verify it works without error
    expect(result.jobs.length).toBeLessThanOrEqual(100);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// pruneOldJobs
// ---------------------------------------------------------------------------

describe("pruneOldJobs", () => {
  test("deletes old terminal jobs and their events", () => {
    const jobId = createCapabilityJob({
      kind: "model_pull",
      requestedPayload: JSON.stringify({ ref: "test/prune-old" }),
      requestedBy: "test",
    });
    // Set endedAt far in the past (1 year ago)
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    updateCapabilityJob(jobId, {
      status: "succeeded",
      startedAt: oldDate,
      endedAt: oldDate,
      exitCode: 0,
    });
    appendCapabilityJobEvent({ jobId, level: "info", message: "prune-test-event" });

    const pruned = pruneOldJobs(30 * 24 * 60 * 60 * 1000); // 30 days
    expect(pruned).toBeGreaterThanOrEqual(1);

    // Job should be deleted
    const job = getCapabilityJob(jobId);
    expect(job).toBeNull();

    // Events should be deleted too
    const events = listCapabilityJobEvents(jobId);
    expect(events.length).toBe(0);
  });

  test("preserves running/queued jobs", () => {
    const jobId = createCapabilityJob({
      kind: "model_pull",
      requestedPayload: JSON.stringify({ ref: "test/prune-running" }),
      requestedBy: "test",
    });
    updateCapabilityJob(jobId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    pruneOldJobs(0); // Even with 0 max age, running jobs should not be pruned

    const job = getCapabilityJob(jobId);
    expect(job).toBeTruthy();
    expect(job!.status).toBe("running");
  });

  test("preserves recent terminal jobs", () => {
    const jobId = createCapabilityJob({
      kind: "model_pull",
      requestedPayload: JSON.stringify({ ref: "test/prune-recent" }),
      requestedBy: "test",
    });
    const recentDate = new Date().toISOString();
    updateCapabilityJob(jobId, {
      status: "succeeded",
      startedAt: recentDate,
      endedAt: recentDate,
      exitCode: 0,
    });

    pruneOldJobs(30 * 24 * 60 * 60 * 1000); // 30 days

    const job = getCapabilityJob(jobId);
    expect(job).toBeTruthy();
    expect(job!.status).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// Housekeeping module
// ---------------------------------------------------------------------------

describe("housekeeping functions", () => {
  test("runPrunePass executes without errors", () => {
    const count = runPrunePass();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("runVacuum executes without errors", () => {
    expect(() => runVacuum()).not.toThrow();
  });
});
