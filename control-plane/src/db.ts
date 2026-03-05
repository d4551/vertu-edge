import { Database } from "bun:sqlite";
import { join } from "path";
import { DEFAULT_CHAT_MODEL, DEFAULT_THEME } from "./config";
import { DEFAULT_LOCALE } from "./i18n";
import { type CapabilityJobState } from "../../contracts/flow-contracts";

const DB_PATH = join(import.meta.dir, "..", "vertu.sqlite");

/** Shared SQLite database handle for control-plane state. */
export const db = new Database(DB_PATH, { create: true });

interface JobColumnRow {
  name: string;
}

interface CapabilityJobDbRow {
  id: string;
  kind: string;
  status: string;
  requestedPayload: string;
  requestedBy: string | null;
  correlationId: string | null;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  artifactPath: string | null;
  startedAt: string | null;
  endedAt: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CapabilityJobEventDbRow {
  id: string;
  jobId: string;
  level: string;
  message: string;
  commandIndex: number | null;
  createdAt: string;
}

/** Initialize persistent tables and required defaults. */
export function initDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      provider TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      base_url TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_payload TEXT NOT NULL,
      requested_by TEXT,
      correlation_id TEXT,
      stdout TEXT DEFAULT '',
      stderr TEXT DEFAULT '',
      exit_code INTEGER,
      artifact_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      cancel_requested_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureJobsColumn("correlation_id", "TEXT");
  ensureJobsColumn("started_at", "TEXT");
  ensureJobsColumn("ended_at", "TEXT");
  ensureJobsColumn("cancel_requested_at", "TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      command_index INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Default preferences
  const hasTheme = db.query<{ key: string; value: string }, []>("SELECT * FROM preferences WHERE key = 'theme'").get();
  if (!hasTheme) {
    db.run("INSERT INTO preferences (key, value) VALUES ('theme', ?)", [DEFAULT_THEME]);
  }

  const hasDefaultModel = db.query<{ key: string; value: string }, []>("SELECT * FROM preferences WHERE key = 'defaultModel'").get();
  if (!hasDefaultModel) {
    db.run("INSERT INTO preferences (key, value) VALUES ('defaultModel', ?)", [DEFAULT_CHAT_MODEL]);
  }

  const hasLocale = db.query<{ key: string; value: string }, []>("SELECT * FROM preferences WHERE key = 'locale'").get();
  if (!hasLocale) {
    db.run("INSERT INTO preferences (key, value) VALUES ('locale', ?)", [DEFAULT_LOCALE]);
  }
}

const ALLOWED_COLUMN_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_DEFINITION_PATTERN = /^(TEXT|INTEGER|REAL|BLOB|NUMERIC)( NOT NULL)?( DEFAULT \S+)?$/i;

function ensureJobsColumn(column: string, definition: string): void {
  if (!ALLOWED_COLUMN_PATTERN.test(column) || !ALLOWED_DEFINITION_PATTERN.test(definition)) {
    throw new Error(`ensureJobsColumn: unsafe column name or definition: ${column} ${definition}`);
  }
  const columns = db.query<JobColumnRow, []>("PRAGMA table_info(jobs)").all();
  if (columns.some((item) => item.name === column)) {
    return;
  }
  db.run(`ALTER TABLE jobs ADD COLUMN ${column} ${definition}`);
}

/** Capability job state supported by async model/build jobs. */
export type CapabilityJobKind = "model_pull" | "app_build" | "flow_run";

/** Persistent capability job row persisted by control-plane workers. */
export interface CapabilityJobRecord {
  /** Stable queue identifier. */
  id: string;
  /** Job function area. */
  kind: CapabilityJobKind;
  /** Current lifecycle state. */
  status: CapabilityJobState;
  /** Serialized request payload. */
  requestedPayload: string;
  /** Optional actor / correlation id. */
  requestedBy: string | null;
  /** Cross-service correlation id for job logs and events. */
  correlationId: string | null;
  /** Stdout capture summary. */
  stdout: string;
  /** Stderr capture summary. */
  stderr: string;
  /** Shell exit code on completion, if any. */
  exitCode: number | null;
  /** Artifact path discovered by command. */
  artifactPath: string | null;
  /** Timestamp when job started running. */
  startedAt: string | null;
  /** Timestamp when job reached terminal state. */
  endedAt: string | null;
  /** Timestamp when cancellation was requested. */
  cancelRequestedAt: string | null;
  /** UTC creation time. */
  createdAt: string;
  /** UTC last update time. */
  updatedAt: string;
}

/** Structured event row for streaming run/build logs. */
export interface CapabilityJobEventRecord {
  id: string;
  jobId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  commandIndex: number | null;
  createdAt: string;
}

/** Create a new async job and return the queue id. */
export function createCapabilityJob(params: {
  kind: CapabilityJobKind;
  requestedPayload: string;
  requestedBy?: string | null;
  correlationId?: string | null;
}): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `
    INSERT INTO jobs (
      id, kind, status, requested_payload, requested_by, correlation_id, created_at, updated_at
    ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)
    `,
    [id, params.kind, params.requestedPayload, params.requestedBy ?? null, params.correlationId ?? null, now, now],
  );
  return id;
}

/** Persist job state and output updates for a running capability job. */
export function updateCapabilityJob(
  id: string,
  patch: Partial<{
    status: CapabilityJobState;
    requestedPayload: string;
    requestedBy: string | null;
    correlationId: string | null;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    artifactPath: string | null;
    startedAt: string | null;
    endedAt: string | null;
    cancelRequestedAt: string | null;
  }>,
): void {
  const columns: string[] = [];
  const values: Array<string | number | null> = [];

  if (patch.status !== undefined) {
    columns.push("status = ?");
    values.push(patch.status);
  }
  if (patch.requestedPayload !== undefined) {
    columns.push("requested_payload = ?");
    values.push(patch.requestedPayload);
  }
  if (patch.requestedBy !== undefined) {
    columns.push("requested_by = ?");
    values.push(patch.requestedBy);
  }
  if (patch.correlationId !== undefined) {
    columns.push("correlation_id = ?");
    values.push(patch.correlationId);
  }
  if (patch.stdout !== undefined) {
    columns.push("stdout = ?");
    values.push(patch.stdout);
  }
  if (patch.stderr !== undefined) {
    columns.push("stderr = ?");
    values.push(patch.stderr);
  }
  if (patch.exitCode !== undefined) {
    columns.push("exit_code = ?");
    values.push(patch.exitCode);
  }
  if (patch.artifactPath !== undefined) {
    columns.push("artifact_path = ?");
    values.push(patch.artifactPath);
  }
  if (patch.startedAt !== undefined) {
    columns.push("started_at = ?");
    values.push(patch.startedAt);
  }
  if (patch.endedAt !== undefined) {
    columns.push("ended_at = ?");
    values.push(patch.endedAt);
  }
  if (patch.cancelRequestedAt !== undefined) {
    columns.push("cancel_requested_at = ?");
    values.push(patch.cancelRequestedAt);
  }

  columns.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  const query = `UPDATE jobs SET ${columns.join(", ")} WHERE id = ?`;
  db.run(query, values);
}

/** Lookup a persisted capability job by id. */
export function getCapabilityJob(id: string): CapabilityJobRecord | null {
  const row = parseCapabilityJobRecord(
    db.query<CapabilityJobDbRow, [string]>(
    `
      SELECT
        id,
        kind,
      status,
      requested_payload AS requestedPayload,
      requested_by AS requestedBy,
      correlation_id AS correlationId,
      stdout,
      stderr,
      exit_code AS exitCode,
      artifact_path AS artifactPath,
      started_at AS startedAt,
      ended_at AS endedAt,
      cancel_requested_at AS cancelRequestedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
    FROM jobs
    WHERE id = ?
    `,
  ).get(id),
  );

  if (row == null) {
    return null;
  }

  return row;
}

function parseCapabilityJobStatus(value: string): CapabilityJobState {
  if (value === "completed") {
    return "succeeded";
  }
  if (value === "queued" || value === "running" || value === "paused" || value === "succeeded" || value === "failed" || value === "cancelled") {
    return value;
  }
  return "failed";
}

/** Append a structured job event used by polling and log streaming endpoints. */
export function appendCapabilityJobEvent(params: {
  jobId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  commandIndex?: number | null;
}): string {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.run(
    `
      INSERT INTO job_events (id, job_id, level, message, command_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [id, params.jobId, params.level, params.message, params.commandIndex ?? null, createdAt],
  );
  return id;
}

/**
 * Decode a composite cursor token produced by encodeJobEventCursor.
 * Returns `{ createdAt, id }` when the token is valid, otherwise `null`.
 *
 * Composite format: `<createdAt>:<id>` – using the ISO timestamp plus the UUID
 * eliminates timestamp-collision ambiguity when two events are inserted within
 * the same millisecond (issue #3).
 */
function decodeJobEventCursor(cursor: string): { createdAt: string; id: string } | null {
  const separatorIndex = cursor.indexOf(":");
  if (separatorIndex < 1) {
    return null;
  }
  const createdAt = cursor.slice(0, separatorIndex);
  const id = cursor.slice(separatorIndex + 1);
  if (!createdAt || !id) {
    return null;
  }
  return { createdAt, id };
}

/** Encode an event record into a composite pagination cursor. */
export function encodeJobEventCursor(event: { id: string; createdAt: string }): string {
  return `${event.createdAt}:${event.id}`;
}

/** List structured job events after an optional cursor id. */
export function listCapabilityJobEvents(jobId: string, afterEventId?: string | null): CapabilityJobEventRecord[] {
  // Attempt to decode a composite cursor token first (new format: `createdAt:id`).
  // Fall back to treating the value as a plain event UUID for backward compatibility,
  // resolving its timestamp via a single subquery so we avoid an extra round-trip (issue #2).
  const parsed = afterEventId ? decodeJobEventCursor(afterEventId) : null;

  if (afterEventId && !parsed) {
    // Legacy cursor: a bare event UUID. Resolve using an inline subquery so only
    // one DB round-trip is needed (eliminates the N+1 pattern from the old two-query approach).
      const rows = db.query<CapabilityJobEventDbRow, [string, string, string, string]>(
        `
          SELECT id, job_id AS jobId, level, message, command_index AS commandIndex, created_at AS createdAt
          FROM job_events
          WHERE job_id = ?
          AND (
            created_at > (SELECT created_at FROM job_events WHERE id = ?)
            OR (
              created_at = (SELECT created_at FROM job_events WHERE id = ?)
              AND id > ?
            )
          )
        ORDER BY created_at ASC, id ASC
      `,
      ).all(jobId, afterEventId, afterEventId, afterEventId);
    return parseCapabilityJobEventRows(rows);
  }

  if (parsed) {
    // Composite cursor: use deterministic timestamp+id ordering to handle same-millisecond collisions.
    const rows = db.query<CapabilityJobEventDbRow, [string, string, string, string]>(
      `
        SELECT id, job_id AS jobId, level, message, command_index AS commandIndex, created_at AS createdAt
        FROM job_events
        WHERE job_id = ?
          AND (
            created_at > ?
            OR (created_at = ? AND id > ?)
          )
        ORDER BY created_at ASC, id ASC
      `,
      ).all(jobId, parsed.createdAt, parsed.createdAt, parsed.id);
    return parseCapabilityJobEventRows(rows);
  }

  // No cursor: return all events for the job.
  return parseCapabilityJobEventRows(db.query<CapabilityJobEventDbRow, [string]>(
    `
      SELECT id, job_id AS jobId, level, message, command_index AS commandIndex, created_at AS createdAt
      FROM job_events
      WHERE job_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    ).all(jobId));
}

/** Fetch a user preference by key. */
export function getPreference(key: string): string | null {
  const row = db.query<{ value: string | null }, [string]>("SELECT value FROM preferences WHERE key = ?").get(key);
  return typeof row?.value === "string" ? row.value : null;
}

function parseCapabilityJobRecord(
  row: CapabilityJobDbRow | null,
): CapabilityJobRecord | null {
  if (!row) {
    return null;
  }

  const kind = row.kind;
  const status = parseCapabilityJobStatus(row.status);
  const normalizedStdout = typeof row.stdout === "string" ? row.stdout : "";
  const normalizedStderr = typeof row.stderr === "string" ? row.stderr : "";
  const normalizedArtifactPath = typeof row.artifactPath === "string" ? row.artifactPath : null;

  return {
    id: row.id,
    kind: kind === "model_pull" || kind === "app_build" || kind === "flow_run" ? kind : "app_build",
    status,
    requestedPayload: row.requestedPayload,
    requestedBy: row.requestedBy,
    correlationId: row.correlationId,
    stdout: normalizedStdout,
    stderr: normalizedStderr,
    exitCode: isSafeInteger(row.exitCode) ? row.exitCode : null,
    artifactPath: normalizedArtifactPath,
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    cancelRequestedAt: row.cancelRequestedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseCapabilityJobEventRows(rows: readonly CapabilityJobEventDbRow[]): CapabilityJobEventRecord[] {
  const parsed: CapabilityJobEventRecord[] = [];
  for (const row of rows) {
    const candidate = parseCapabilityJobEventRow(row);
    if (candidate != null) {
      parsed.push(candidate);
    }
  }
  return parsed;
}

function parseCapabilityJobEventRow(row: CapabilityJobEventDbRow): CapabilityJobEventRecord | null {
  const level = row.level;
  if (
    level !== "debug"
    && level !== "info"
    && level !== "warn"
    && level !== "error"
  ) {
    return null;
  }

  const commandIndex = isSafeInteger(row.commandIndex) ? row.commandIndex : null;
  return {
    id: row.id,
    jobId: row.jobId,
    level,
    message: row.message,
    commandIndex,
    createdAt: row.createdAt,
  };
}

function isSafeInteger(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Upsert a user preference value. */
export function setPreference(key: string, value: string) {
  db.run("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", [key, value]);
}
