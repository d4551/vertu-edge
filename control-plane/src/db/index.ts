import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { sqlite } from "./connection";
import * as schema from "./schema";
import { type CapabilityJobState } from "../../../contracts/flow-contracts";
import { safeParseJson, type JsonRecord } from "../config";

// ---------------------------------------------------------------------------
// Drizzle database instance
// ---------------------------------------------------------------------------
export const db = drizzle(sqlite, { schema });

/** Raw SQLite handle — only for PRAGMA queries and migration tooling. */
export { sqlite } from "./connection";

// ---------------------------------------------------------------------------
// Type definitions (previously in db.ts)
// ---------------------------------------------------------------------------

/** Capability job state supported by async model/build jobs. */
export type CapabilityJobKind = "model_pull" | "app_build" | "flow_run" | "ai_workflow";

/** Persistent capability job row persisted by control-plane workers. */
export interface CapabilityJobRecord {
  id: string;
  kind: CapabilityJobKind;
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
  createdAt: string;
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

/** Persisted AI artifact metadata row used by creative workflow outputs. */
export interface AiArtifactRow {
  id: string;
  jobId: string;
  mode: string;
  providerPath: string;
  promptSummary: string;
  artifactPath: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  correlationId: string;
  createdAt: string;
}

/** Persistent local model registry row. */
export interface LocalModelRow {
  id: string;
  modelRef: string;
  normalizedRef: string;
  source: string;
  artifactPath: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  pipelineTag: string | null;
  capabilities: string | null;
  tags: string | null;
  pullJobId: string | null;
  pulledAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Conversation session row. */
export interface ConversationRow {
  id: string;
  title: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

/** Individual message within a conversation. */
export interface MessageRow {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  mode: string | null;
  provider: string | null;
  model: string | null;
  jobId: string | null;
  createdAt: string;
}

/** Saved Maestro YAML flow row. */
export interface SavedFlowRow {
  id: string;
  name: string;
  description: string | null;
  yaml: string;
  tags: string | null;
  lastRunJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Schema bootstrap — ensures tables exist for first run (before migrations)
// ---------------------------------------------------------------------------

export function initDb() {
  // Create tables if they don't exist (safe for existing databases).
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      provider TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      base_url TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
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

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      command_index INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS local_models (
      id TEXT PRIMARY KEY,
      model_ref TEXT NOT NULL,
      normalized_ref TEXT NOT NULL,
      source TEXT NOT NULL,
      artifact_path TEXT,
      sha256 TEXT,
      size_bytes INTEGER,
      pipeline_tag TEXT,
      capabilities TEXT,
      tags TEXT,
      pull_job_id TEXT,
      pulled_at TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pull_job_id) REFERENCES jobs(id)
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS ai_artifacts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      provider_path TEXT NOT NULL,
      prompt_summary TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      correlation_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      mode TEXT,
      provider TEXT,
      model TEXT,
      job_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS saved_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      yaml TEXT NOT NULL,
      tags TEXT,
      last_run_job_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (last_run_job_id) REFERENCES jobs(id)
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS ucp_discoveries (
      id TEXT PRIMARY KEY,
      server_url TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      ucp_version TEXT NOT NULL,
      capability_count INTEGER NOT NULL DEFAULT 0,
      service_count INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

const ALLOWED_COLUMN_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_DEFINITION_PATTERN = /^(TEXT|INTEGER|REAL|BLOB|NUMERIC)( NOT NULL)?( DEFAULT \S+)?$/i;

function ensureJobsColumn(column: string, definition: string): void {
  if (!ALLOWED_COLUMN_PATTERN.test(column) || !ALLOWED_DEFINITION_PATTERN.test(definition)) {
    throw new Error(`ensureJobsColumn: unsafe column name or definition: ${column} ${definition}`);
  }
  const columns = sqlite.query<{ name: string }, []>("PRAGMA table_info(jobs)").all();
  if (columns.some((item) => item.name === column)) {
    return;
  }
  sqlite.run(`ALTER TABLE jobs ADD COLUMN ${column} ${definition}`);
}

// ---------------------------------------------------------------------------
// Job CRUD — Drizzle-powered replacements for raw SQL functions
// ---------------------------------------------------------------------------

/** Create a new async job and return the queue id. */
export function createCapabilityJob(params: {
  kind: CapabilityJobKind;
  requestedPayload: string;
  requestedBy?: string | null;
  correlationId?: string | null;
}): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.jobs).values({
    id,
    kind: params.kind,
    status: "queued",
    requestedPayload: params.requestedPayload,
    requestedBy: params.requestedBy ?? null,
    correlationId: params.correlationId ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
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
  const setClause: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (patch.status !== undefined) setClause.status = patch.status;
  if (patch.requestedPayload !== undefined) setClause.requestedPayload = patch.requestedPayload;
  if (patch.requestedBy !== undefined) setClause.requestedBy = patch.requestedBy;
  if (patch.correlationId !== undefined) setClause.correlationId = patch.correlationId;
  if (patch.stdout !== undefined) setClause.stdout = patch.stdout;
  if (patch.stderr !== undefined) setClause.stderr = patch.stderr;
  if (patch.exitCode !== undefined) setClause.exitCode = patch.exitCode;
  if (patch.artifactPath !== undefined) setClause.artifactPath = patch.artifactPath;
  if (patch.startedAt !== undefined) setClause.startedAt = patch.startedAt;
  if (patch.endedAt !== undefined) setClause.endedAt = patch.endedAt;
  if (patch.cancelRequestedAt !== undefined) setClause.cancelRequestedAt = patch.cancelRequestedAt;

  db.update(schema.jobs).set(setClause).where(eq(schema.jobs.id, id)).run();
}

/** Lookup a persisted capability job by id. */
export function getCapabilityJob(id: string): CapabilityJobRecord | null {
  const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  if (!row) return null;
  return normalizeJobRow(row);
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
  db.insert(schema.jobEvents).values({
    id,
    jobId: params.jobId,
    level: params.level,
    message: params.message,
    commandIndex: params.commandIndex ?? null,
    createdAt,
  }).run();
  return id;
}

/** Insert a persisted AI workflow artifact metadata row. */
export function createAiArtifactRow(params: {
  id: string;
  jobId: string;
  mode: string;
  providerPath: string;
  promptSummary: string;
  artifactPath: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  correlationId: string;
  createdAt: string;
}): void {
  db.insert(schema.aiArtifacts).values({
    id: params.id,
    jobId: params.jobId,
    mode: params.mode,
    providerPath: params.providerPath,
    promptSummary: params.promptSummary,
    artifactPath: params.artifactPath,
    mimeType: params.mimeType,
    sha256: params.sha256,
    sizeBytes: params.sizeBytes,
    correlationId: params.correlationId,
    createdAt: params.createdAt,
  }).run();
}

/** List persisted AI workflow artifacts for a given job id. */
export function listAiArtifactRows(jobId: string): AiArtifactRow[] {
  const rows = db.select()
    .from(schema.aiArtifacts)
    .where(eq(schema.aiArtifacts.jobId, jobId))
    .all();
  return rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    mode: row.mode,
    providerPath: row.providerPath,
    promptSummary: row.promptSummary,
    artifactPath: row.artifactPath,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    correlationId: row.correlationId,
    createdAt: row.createdAt ?? new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Local model CRUD — persistent model inventory
// ---------------------------------------------------------------------------

/** Register a local model or update an existing one (upsert by normalizedRef + source). */
export function createLocalModel(params: {
  modelRef: string;
  normalizedRef: string;
  source: string;
  artifactPath?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
  pipelineTag?: string | null;
  capabilities?: string | null;
  tags?: string | null;
  pullJobId?: string | null;
}): string {
  const now = new Date().toISOString();
  // Check for existing model with same normalizedRef + source (upsert)
  const existing = db.select()
    .from(schema.localModels)
    .where(eq(schema.localModels.normalizedRef, params.normalizedRef))
    .get();

  if (existing && existing.source === params.source) {
    // Update existing model record
    db.update(schema.localModels).set({
      modelRef: params.modelRef,
      artifactPath: params.artifactPath ?? existing.artifactPath ?? null,
      sha256: params.sha256 ?? existing.sha256 ?? null,
      sizeBytes: params.sizeBytes ?? existing.sizeBytes ?? null,
      pipelineTag: params.pipelineTag ?? existing.pipelineTag ?? null,
      capabilities: params.capabilities ?? existing.capabilities ?? null,
      tags: params.tags ?? existing.tags ?? null,
      pullJobId: params.pullJobId ?? existing.pullJobId ?? null,
      pulledAt: now,
    }).where(eq(schema.localModels.id, existing.id)).run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  db.insert(schema.localModels).values({
    id,
    modelRef: params.modelRef,
    normalizedRef: params.normalizedRef,
    source: params.source,
    artifactPath: params.artifactPath ?? null,
    sha256: params.sha256 ?? null,
    sizeBytes: params.sizeBytes ?? null,
    pipelineTag: params.pipelineTag ?? null,
    capabilities: params.capabilities ?? null,
    tags: params.tags ?? null,
    pullJobId: params.pullJobId ?? null,
    pulledAt: now,
    createdAt: now,
  }).run();
  return id;
}

/** Lookup a local model by its primary key. */
export function getLocalModel(id: string): LocalModelRow | null {
  const row = db.select().from(schema.localModels).where(eq(schema.localModels.id, id)).get();
  return row ? normalizeLocalModelRow(row) : null;
}

/** Lookup a local model by its normalized reference. */
export function getLocalModelByRef(normalizedRef: string): LocalModelRow | null {
  const row = db.select()
    .from(schema.localModels)
    .where(eq(schema.localModels.normalizedRef, normalizedRef))
    .get();
  return row ? normalizeLocalModelRow(row) : null;
}

/** List all registered local models ordered by pull date (newest first). */
export function listLocalModels(): LocalModelRow[] {
  const rows = sqlite
    .query<RawLocalModelRow, []>(
      "SELECT id, model_ref AS modelRef, normalized_ref AS normalizedRef, source, artifact_path AS artifactPath, sha256, size_bytes AS sizeBytes, pipeline_tag AS pipelineTag, capabilities, tags, pull_job_id AS pullJobId, pulled_at AS pulledAt, last_used_at AS lastUsedAt, created_at AS createdAt FROM local_models ORDER BY pulled_at DESC",
    )
    .all();
  return rows.map(normalizeRawLocalModelRow);
}

/** Delete a local model by its primary key. Returns true if deleted. */
export function deleteLocalModel(id: string): boolean {
  const before = sqlite.query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM local_models WHERE id = ?").get(id);
  if (!before || before.cnt === 0) return false;
  db.delete(schema.localModels).where(eq(schema.localModels.id, id)).run();
  return true;
}

/** Update the lastUsedAt timestamp for a local model. */
export function updateLocalModelLastUsed(id: string): void {
  db.update(schema.localModels).set({ lastUsedAt: new Date().toISOString() }).where(eq(schema.localModels.id, id)).run();
}

// ---------------------------------------------------------------------------
// Conversation CRUD — multi-turn chat session persistence
// ---------------------------------------------------------------------------

/** Create a new conversation and return its id. */
export function createConversation(title: string, mode: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.conversations).values({
    id,
    title,
    mode,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/** Lookup a conversation by id. */
export function getConversation(id: string): ConversationRow | null {
  const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  };
}

/** List conversations ordered by most recently updated, paginated. */
export function listConversations(limit = 20, offset = 0): { conversations: ConversationRow[]; total: number } {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);
  const countRow = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM conversations").get();
  const total = countRow?.cnt ?? 0;
  const rows = sqlite.query<{
    id: string; title: string; mode: string; createdAt: string; updatedAt: string;
  }, []>(
    `SELECT id, title, mode, created_at AS createdAt, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
  ).all();
  return {
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      createdAt: r.createdAt ?? new Date().toISOString(),
      updatedAt: r.updatedAt ?? new Date().toISOString(),
    })),
    total,
  };
}

/** Delete a conversation and all its messages. Returns true if the conversation existed. */
export function deleteConversation(id: string): boolean {
  const existing = sqlite.query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM conversations WHERE id = ?").get(id);
  if (!existing || existing.cnt === 0) return false;
  sqlite.run(`DELETE FROM messages WHERE conversation_id = '${id}'`);
  db.delete(schema.conversations).where(eq(schema.conversations.id, id)).run();
  return true;
}

/** Update a conversation's updatedAt and optionally title. */
export function updateConversation(id: string, patch: { title?: string }): void {
  const setClause: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) setClause.title = patch.title;
  db.update(schema.conversations).set(setClause).where(eq(schema.conversations.id, id)).run();
}

// ---------------------------------------------------------------------------
// Message CRUD — individual messages within conversations
// ---------------------------------------------------------------------------

/** Append a message to a conversation and return its id. */
export function appendMessage(params: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  mode?: string | null;
  provider?: string | null;
  model?: string | null;
  jobId?: string | null;
}): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.messages).values({
    id,
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    mode: params.mode ?? null,
    provider: params.provider ?? null,
    model: params.model ?? null,
    jobId: params.jobId ?? null,
    createdAt: now,
  }).run();
  // Touch conversation updatedAt
  updateConversation(params.conversationId, {});
  return id;
}

/** List all messages in a conversation, ordered by createdAt ASC. */
export function listMessages(conversationId: string): MessageRow[] {
  const rows = sqlite.query<{
    id: string; conversationId: string; role: string; content: string;
    mode: string | null; provider: string | null; model: string | null;
    jobId: string | null; createdAt: string;
  }, [string]>(
    `SELECT id, conversation_id AS conversationId, role, content, mode, provider, model, job_id AS jobId, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
  ).all(conversationId);
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    role: parseMessageRole(r.role),
    content: r.content,
    mode: r.mode,
    provider: r.provider,
    model: r.model,
    jobId: r.jobId,
    createdAt: r.createdAt ?? new Date().toISOString(),
  }));
}

function parseMessageRole(role: string): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "user";
}

// ---------------------------------------------------------------------------
// Saved flows CRUD — persistent Maestro YAML flow library
// ---------------------------------------------------------------------------

/** Create a saved flow and return its id. */
export function createSavedFlow(params: {
  name: string;
  yaml: string;
  description?: string | null;
  tags?: string | null;
}): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.savedFlows).values({
    id,
    name: params.name,
    description: params.description ?? null,
    yaml: params.yaml,
    tags: params.tags ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/** Lookup a saved flow by id. */
export function getSavedFlow(id: string): SavedFlowRow | null {
  const row = db.select().from(schema.savedFlows).where(eq(schema.savedFlows.id, id)).get();
  if (!row) return null;
  return normalizeSavedFlowRow(row);
}

/** List saved flows, paginated, newest first. */
export function listSavedFlows(limit = 20, offset = 0): { flows: SavedFlowRow[]; total: number } {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);
  const countRow = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM saved_flows").get();
  const total = countRow?.cnt ?? 0;
  const rows = sqlite.query<RawSavedFlowRow, []>(
    `SELECT id, name, description, yaml, tags, last_run_job_id AS lastRunJobId, created_at AS createdAt, updated_at AS updatedAt FROM saved_flows ORDER BY updated_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
  ).all();
  return {
    flows: rows.map(normalizeRawSavedFlowRow),
    total,
  };
}

/** Update a saved flow. */
export function updateSavedFlow(id: string, patch: Partial<{ name: string; yaml: string; description: string | null; tags: string | null; lastRunJobId: string | null }>): void {
  const setClause: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) setClause.name = patch.name;
  if (patch.yaml !== undefined) setClause.yaml = patch.yaml;
  if (patch.description !== undefined) setClause.description = patch.description;
  if (patch.tags !== undefined) setClause.tags = patch.tags;
  if (patch.lastRunJobId !== undefined) setClause.lastRunJobId = patch.lastRunJobId;
  db.update(schema.savedFlows).set(setClause).where(eq(schema.savedFlows.id, id)).run();
}

/** Delete a saved flow. Returns true if the flow existed. */
export function deleteSavedFlow(id: string): boolean {
  const existing = sqlite.query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM saved_flows WHERE id = ?").get(id);
  if (!existing || existing.cnt === 0) return false;
  db.delete(schema.savedFlows).where(eq(schema.savedFlows.id, id)).run();
  return true;
}

// ---------------------------------------------------------------------------
// Model assignment — per-mode model preferences
// ---------------------------------------------------------------------------

/** Get the persisted model assignment for a workflow mode. */
export function getModelAssignment(mode: string): { provider: string; model: string } | null {
  const raw = getPreference(`model_assignment_${mode}`);
  if (!raw) return null;
  const parsed = safeParseJson<JsonRecord>(raw);
  if (
    parsed.ok
    && typeof parsed.data.provider === "string"
    && typeof parsed.data.model === "string"
  ) {
    return { provider: parsed.data.provider, model: parsed.data.model };
  }
  return null;
}

/** Persist a model assignment for a workflow mode. */
export function setModelAssignment(mode: string, provider: string, model: string): void {
  setPreference(`model_assignment_${mode}`, JSON.stringify({ provider, model }));
}

/** Clear the model assignment for a workflow mode. */
export function clearModelAssignment(mode: string): void {
  sqlite.run(`DELETE FROM preferences WHERE key = 'model_assignment_${mode}'`);
}

// ---------------------------------------------------------------------------
// UCP Discovery persistence
// ---------------------------------------------------------------------------

export interface UcpDiscoveryRow {
  id: string;
  serverUrl: string;
  manifestJson: string;
  ucpVersion: string;
  capabilityCount: number;
  serviceCount: number;
  discoveredAt: string;
}

/** Save a UCP discovery result to the database. Returns the generated id. */
export function saveUcpDiscovery(params: {
  serverUrl: string;
  manifestJson: string;
  ucpVersion: string;
  capabilityCount: number;
  serviceCount: number;
}): string {
  const id = crypto.randomUUID();
  sqlite.run(
    `INSERT INTO ucp_discoveries (id, server_url, manifest_json, ucp_version, capability_count, service_count) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, params.serverUrl, params.manifestJson, params.ucpVersion, params.capabilityCount, params.serviceCount],
  );
  return id;
}

/** Get the most recent UCP discovery. */
export function getLatestUcpDiscovery(): UcpDiscoveryRow | null {
  const row = sqlite
    .query<{ id: string; server_url: string; manifest_json: string; ucp_version: string; capability_count: number; service_count: number; discovered_at: string }, []>(
      "SELECT id, server_url, manifest_json, ucp_version, capability_count, service_count, discovered_at FROM ucp_discoveries ORDER BY discovered_at DESC LIMIT 1",
    )
    .get();
  if (!row) return null;
  return {
    id: row.id,
    serverUrl: row.server_url,
    manifestJson: row.manifest_json,
    ucpVersion: row.ucp_version,
    capabilityCount: row.capability_count,
    serviceCount: row.service_count,
    discoveredAt: row.discovered_at,
  };
}

/** List recent UCP discoveries, newest first. */
export function listUcpDiscoveries(limit = 10, offset = 0): { discoveries: UcpDiscoveryRow[]; total: number } {
  const total = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM ucp_discoveries").get()?.cnt ?? 0;
  const rows = sqlite
    .query<{ id: string; server_url: string; manifest_json: string; ucp_version: string; capability_count: number; service_count: number; discovered_at: string }, [number, number]>(
      "SELECT id, server_url, manifest_json, ucp_version, capability_count, service_count, discovered_at FROM ucp_discoveries ORDER BY discovered_at DESC LIMIT ? OFFSET ?",
    )
    .all(limit, offset);
  return {
    total,
    discoveries: rows.map((row) => ({
      id: row.id,
      serverUrl: row.server_url,
      manifestJson: row.manifest_json,
      ucpVersion: row.ucp_version,
      capabilityCount: row.capability_count,
      serviceCount: row.service_count,
      discoveredAt: row.discovered_at,
    })),
  };
}

/** Delete a UCP discovery record. Returns true if it existed. */
export function deleteUcpDiscovery(id: string): boolean {
  const existing = sqlite.query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM ucp_discoveries WHERE id = ?").get(id);
  if (!existing || existing.cnt === 0) return false;
  sqlite.run("DELETE FROM ucp_discoveries WHERE id = ?", [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Paginated job listing + pruning
// ---------------------------------------------------------------------------

/** Paginated job listing with optional kind and status filters. */
export function listCapabilityJobs(params: {
  kind?: CapabilityJobKind;
  status?: CapabilityJobState;
  limit?: number;
  offset?: number;
}): { jobs: CapabilityJobRecord[]; total: number } {
  const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
  const offset = Math.max(0, params.offset ?? 0);

  const whereClauses: string[] = [];
  const whereParams: string[] = [];

  if (params.kind) {
    whereClauses.push("kind = ?");
    whereParams.push(params.kind);
  }
  if (params.status) {
    whereClauses.push("status = ?");
    whereParams.push(params.status);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countRow = sqlite.query<{ cnt: number }, string[]>(
    `SELECT COUNT(*) as cnt FROM jobs ${whereSQL}`,
  ).get(...whereParams);
  const total = countRow?.cnt ?? 0;

  const rows = sqlite.query<RawJobRowSql, string[]>(
    `SELECT id, kind, status, requested_payload AS requestedPayload, requested_by AS requestedBy, correlation_id AS correlationId, stdout, stderr, exit_code AS exitCode, artifact_path AS artifactPath, started_at AS startedAt, ended_at AS endedAt, cancel_requested_at AS cancelRequestedAt, created_at AS createdAt, updated_at AS updatedAt FROM jobs ${whereSQL} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
  ).all(...whereParams);

  return {
    jobs: rows.map(normalizeRawJobRow),
    total,
  };
}

/**
 * Delete terminal jobs (succeeded/failed/cancelled) older than `maxAgeMs`
 * along with their events. Returns the count of pruned jobs.
 */
export function pruneOldJobs(maxAgeMs: number): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const qualifyingSubquery = `SELECT id FROM jobs WHERE status IN ('succeeded','failed','cancelled') AND ended_at IS NOT NULL AND ended_at < '${cutoff}'`;
  // Null out local_models FK references to qualifying jobs
  sqlite.run(
    `UPDATE local_models SET pull_job_id = NULL WHERE pull_job_id IN (${qualifyingSubquery})`,
  );
  // Delete events for qualifying jobs (FK-safe order)
  sqlite.run(
    `DELETE FROM job_events WHERE job_id IN (${qualifyingSubquery})`,
  );
  // Delete the jobs themselves
  const result = sqlite.run(
    `DELETE FROM jobs WHERE status IN ('succeeded','failed','cancelled') AND ended_at IS NOT NULL AND ended_at < '${cutoff}'`,
  );
  return result.changes;
}

// ---------------------------------------------------------------------------
// Job event listing with cursor pagination
// ---------------------------------------------------------------------------

/**
 * Decode a composite cursor token produced by encodeJobEventCursor.
 * Returns `{ createdAt, id }` when the token is valid, otherwise `null`.
 *
 * Composite format: `<createdAt>|<id>` — using the ISO timestamp plus the UUID
 * eliminates timestamp-collision ambiguity when two events are inserted within
 * the same millisecond.
 */
function decodeJobEventCursor(cursor: string): { createdAt: string; id: string } | null {
  const separatorIndex = cursor.indexOf("|");
  if (separatorIndex < 1) return null;
  const createdAt = cursor.slice(0, separatorIndex);
  const id = cursor.slice(separatorIndex + 1);
  if (!createdAt || !id) return null;
  return { createdAt, id };
}

/** Encode an event record into a composite pagination cursor. */
export function encodeJobEventCursor(event: { id: string; createdAt: string }): string {
  return `${event.createdAt}|${event.id}`;
}

/** List structured job events after an optional composite cursor token. */
export function listCapabilityJobEvents(jobId: string, afterCursor?: string | null): CapabilityJobEventRecord[] {
  const parsed = afterCursor ? decodeJobEventCursor(afterCursor) : null;
  if (afterCursor && !parsed) {
    return [];
  }

  if (parsed) {
    // Composite cursor: deterministic timestamp+id ordering.
    const rows = sqlite.query<RawJobEventRow, [string, string, string, string]>(
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
    return normalizeEventRows(rows);
  }

  // No cursor: return all events for the job.
  const rows = sqlite.query<RawJobEventRow, [string]>(
    `
      SELECT id, job_id AS jobId, level, message, command_index AS commandIndex, created_at AS createdAt
      FROM job_events
      WHERE job_id = ?
      ORDER BY created_at ASC, id ASC
    `,
  ).all(jobId);
  return normalizeEventRows(rows);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** Fetch a user preference by key. */
export function getPreference(key: string): string | null {
  const row = db.select().from(schema.preferences).where(eq(schema.preferences.key, key)).get();
  return typeof row?.value === "string" ? row.value : null;
}

/** Upsert a user preference value. */
export function setPreference(key: string, value: string) {
  db.insert(schema.preferences)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.preferences.key, set: { value } })
    .run();
}

// ---------------------------------------------------------------------------
// Seed defaults — called during initDb after tables are created.
// ---------------------------------------------------------------------------

export function seedDefaults(defaults: { theme: string; defaultModel: string; locale: string }) {
  const ensureDefault = (key: string, value: string) => {
    const existing = getPreference(key);
    if (existing === null) {
      setPreference(key, value);
    }
  };
  ensureDefault("theme", defaults.theme);
  ensureDefault("defaultModel", defaults.defaultModel);
  ensureDefault("locale", defaults.locale);
}

// ---------------------------------------------------------------------------
// Internal helpers (carried over from old db.ts)
// ---------------------------------------------------------------------------

interface RawJobRowSql {
  id: string;
  kind: string;
  status: string;
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
  createdAt: string;
  updatedAt: string;
}

function normalizeRawJobRow(row: RawJobRowSql): CapabilityJobRecord {
  const kind = row.kind;
  const status = parseCapabilityJobStatus(row.status);
  return {
    id: row.id,
    kind: kind === "model_pull" || kind === "app_build" || kind === "flow_run" || kind === "ai_workflow"
      ? kind
      : "app_build",
    status,
    requestedPayload: row.requestedPayload,
    requestedBy: row.requestedBy ?? null,
    correlationId: row.correlationId ?? null,
    stdout: typeof row.stdout === "string" ? row.stdout : "",
    stderr: typeof row.stderr === "string" ? row.stderr : "",
    exitCode: isSafeInteger(row.exitCode) ? row.exitCode : null,
    artifactPath: typeof row.artifactPath === "string" ? row.artifactPath : null,
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    cancelRequestedAt: row.cancelRequestedAt ?? null,
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  };
}

interface RawJobEventRow {
  id: string;
  jobId: string;
  level: string;
  message: string;
  commandIndex: number | null;
  createdAt: string;
}

function normalizeEventRows(rows: readonly RawJobEventRow[]): CapabilityJobEventRecord[] {
  const parsed: CapabilityJobEventRecord[] = [];
  for (const row of rows) {
    const candidate = normalizeEventRow(row);
    if (candidate != null) {
      parsed.push(candidate);
    }
  }
  return parsed;
}

function normalizeEventRow(row: RawJobEventRow): CapabilityJobEventRecord | null {
  const level = row.level;
  if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
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

function parseCapabilityJobStatus(value: string): CapabilityJobState {
  if (value === "completed") return "succeeded";
  if (value === "queued" || value === "running" || value === "paused" || value === "succeeded" || value === "failed" || value === "cancelled") {
    return value;
  }
  return "failed";
}

type RawJobRow = typeof schema.jobs.$inferSelect;

function normalizeJobRow(row: RawJobRow): CapabilityJobRecord {
  const kind = row.kind;
  const status = parseCapabilityJobStatus(row.status);
  return {
    id: row.id,
    kind: kind === "model_pull" || kind === "app_build" || kind === "flow_run" || kind === "ai_workflow"
      ? kind
      : "app_build",
    status,
    requestedPayload: row.requestedPayload,
    requestedBy: row.requestedBy ?? null,
    correlationId: row.correlationId ?? null,
    stdout: typeof row.stdout === "string" ? row.stdout : "",
    stderr: typeof row.stderr === "string" ? row.stderr : "",
    exitCode: isSafeInteger(row.exitCode) ? row.exitCode : null,
    artifactPath: typeof row.artifactPath === "string" ? row.artifactPath : null,
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    cancelRequestedAt: row.cancelRequestedAt ?? null,
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  };
}

function isSafeInteger(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

// ---------------------------------------------------------------------------
// Local model row normalization
// ---------------------------------------------------------------------------

type RawLocalModelDrizzle = typeof schema.localModels.$inferSelect;

function normalizeLocalModelRow(row: RawLocalModelDrizzle): LocalModelRow {
  return {
    id: row.id,
    modelRef: row.modelRef,
    normalizedRef: row.normalizedRef,
    source: row.source,
    artifactPath: row.artifactPath ?? null,
    sha256: row.sha256 ?? null,
    sizeBytes: isSafeInteger(row.sizeBytes) ? row.sizeBytes : null,
    pipelineTag: row.pipelineTag ?? null,
    capabilities: row.capabilities ?? null,
    tags: row.tags ?? null,
    pullJobId: row.pullJobId ?? null,
    pulledAt: row.pulledAt,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt ?? new Date().toISOString(),
  };
}

interface RawLocalModelRow {
  id: string;
  modelRef: string;
  normalizedRef: string;
  source: string;
  artifactPath: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  pipelineTag: string | null;
  capabilities: string | null;
  tags: string | null;
  pullJobId: string | null;
  pulledAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function normalizeRawLocalModelRow(row: RawLocalModelRow): LocalModelRow {
  return {
    id: row.id,
    modelRef: row.modelRef,
    normalizedRef: row.normalizedRef,
    source: row.source,
    artifactPath: row.artifactPath,
    sha256: row.sha256,
    sizeBytes: isSafeInteger(row.sizeBytes) ? row.sizeBytes : null,
    pipelineTag: row.pipelineTag,
    capabilities: row.capabilities,
    tags: row.tags,
    pullJobId: row.pullJobId,
    pulledAt: row.pulledAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Saved flow row normalization
// ---------------------------------------------------------------------------

type RawSavedFlowDrizzle = typeof schema.savedFlows.$inferSelect;

function normalizeSavedFlowRow(row: RawSavedFlowDrizzle): SavedFlowRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    yaml: row.yaml,
    tags: row.tags ?? null,
    lastRunJobId: row.lastRunJobId ?? null,
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  };
}

interface RawSavedFlowRow {
  id: string;
  name: string;
  description: string | null;
  yaml: string;
  tags: string | null;
  lastRunJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeRawSavedFlowRow(row: RawSavedFlowRow): SavedFlowRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    yaml: row.yaml,
    tags: row.tags,
    lastRunJobId: row.lastRunJobId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
