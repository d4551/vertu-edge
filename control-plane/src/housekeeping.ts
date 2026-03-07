/**
 * Housekeeping module — periodic job/event pruning and SQLite VACUUM.
 *
 * Call `startHousekeeping()` after startup to schedule recurring maintenance.
 * Call `stopHousekeeping()` during shutdown to clear timers.
 */

import { pruneOldJobs, sqlite } from "./db";
import {
  JOB_PRUNE_MAX_AGE_MS,
  JOB_PRUNE_INTERVAL_MS,
  SQLITE_VACUUM_INTERVAL_MS,
} from "./config";
import { captureResult, normalizeFailureMessage } from "../../shared/failure";
import { logger } from "./logger";

let pruneTimer: ReturnType<typeof setInterval> | null = null;
let vacuumTimer: ReturnType<typeof setInterval> | null = null;

/** Run a single job/event prune pass. Returns the count of pruned jobs. */
export function runPrunePass(): number {
  const pruneResult = captureResult(
    () => pruneOldJobs(JOB_PRUNE_MAX_AGE_MS),
    (failure) => normalizeFailureMessage(failure, "Housekeeping prune pass failed."),
  );
  if (!pruneResult.ok) {
    logger.error("Housekeeping: prune pass failed", {
      error: pruneResult.error,
    });
    return 0;
  }
  if (pruneResult.data > 0) {
    logger.info("Housekeeping: pruned old jobs", { count: pruneResult.data, maxAgeMs: JOB_PRUNE_MAX_AGE_MS });
  }
  return pruneResult.data;
}

/** Run SQLite VACUUM to reclaim disk space. */
export function runVacuum(): void {
  const vacuumResult = captureResult(
    () => sqlite.run("VACUUM"),
    (failure) => normalizeFailureMessage(failure, "Housekeeping VACUUM failed."),
  );
  if (vacuumResult.ok) {
    logger.debug("Housekeeping: VACUUM completed");
    return;
  }
  logger.error("Housekeeping: VACUUM failed", {
    error: vacuumResult.error,
  });
}

/** Start periodic housekeeping (prune + VACUUM timers). */
export function startHousekeeping(): void {
  // Run an initial prune pass immediately
  runPrunePass();

  // Schedule recurring prune
  pruneTimer = setInterval(() => {
    runPrunePass();
  }, JOB_PRUNE_INTERVAL_MS);

  // Schedule recurring VACUUM
  vacuumTimer = setInterval(() => {
    runVacuum();
  }, SQLITE_VACUUM_INTERVAL_MS);

  logger.info("Housekeeping started", {
    pruneIntervalMs: JOB_PRUNE_INTERVAL_MS,
    vacuumIntervalMs: SQLITE_VACUUM_INTERVAL_MS,
    pruneMaxAgeMs: JOB_PRUNE_MAX_AGE_MS,
  });
}

/** Stop periodic housekeeping (clear all timers). */
export function stopHousekeeping(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  if (vacuumTimer) {
    clearInterval(vacuumTimer);
    vacuumTimer = null;
  }
  logger.debug("Housekeeping stopped");
}
