import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// preferences — key/value store for theme, locale, defaultModel, etc.
// ---------------------------------------------------------------------------
export const preferences = sqliteTable("preferences", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// ---------------------------------------------------------------------------
// api_keys — provider credential storage
// ---------------------------------------------------------------------------
export const apiKeys = sqliteTable("api_keys", {
  provider: text("provider").primaryKey(),
  apiKey: text("api_key").notNull(),
  baseUrl: text("base_url"),
  updatedAt: text("updated_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// jobs — async capability job queue (model_pull, app_build, flow_run)
// ---------------------------------------------------------------------------
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  requestedPayload: text("requested_payload").notNull(),
  requestedBy: text("requested_by"),
  correlationId: text("correlation_id"),
  stdout: text("stdout").default(""),
  stderr: text("stderr").default(""),
  exitCode: integer("exit_code"),
  artifactPath: text("artifact_path"),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  cancelRequestedAt: text("cancel_requested_at"),
  createdAt: text("created_at").default("datetime('now')"),
  updatedAt: text("updated_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// job_events — structured event log for streaming run/build logs
// ---------------------------------------------------------------------------
export const jobEvents = sqliteTable("job_events", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  level: text("level").notNull(),
  message: text("message").notNull(),
  commandIndex: integer("command_index"),
  createdAt: text("created_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// local_models — persistent registry of models pulled to this host
// ---------------------------------------------------------------------------
export const localModels = sqliteTable("local_models", {
  id: text("id").primaryKey(),
  modelRef: text("model_ref").notNull(),
  normalizedRef: text("normalized_ref").notNull(),
  source: text("source").notNull(),
  artifactPath: text("artifact_path"),
  sha256: text("sha256"),
  sizeBytes: integer("size_bytes"),
  pipelineTag: text("pipeline_tag"),
  capabilities: text("capabilities"),
  tags: text("tags"),
  pullJobId: text("pull_job_id").references(() => jobs.id),
  pulledAt: text("pulled_at").notNull(),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// conversations — multi-turn chat conversation sessions
// ---------------------------------------------------------------------------
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  mode: text("mode").notNull(),
  createdAt: text("created_at").default("datetime('now')"),
  updatedAt: text("updated_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// messages — individual messages within a conversation
// ---------------------------------------------------------------------------
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  mode: text("mode"),
  provider: text("provider"),
  model: text("model"),
  jobId: text("job_id").references(() => jobs.id),
  createdAt: text("created_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// saved_flows — persistent Maestro YAML flow library
// ---------------------------------------------------------------------------
export const savedFlows = sqliteTable("saved_flows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  yaml: text("yaml").notNull(),
  tags: text("tags"),
  lastRunJobId: text("last_run_job_id").references(() => jobs.id),
  createdAt: text("created_at").default("datetime('now')"),
  updatedAt: text("updated_at").default("datetime('now')"),
});

// ---------------------------------------------------------------------------
// ai_artifacts — persisted creative workflow output metadata
// ---------------------------------------------------------------------------
export const aiArtifacts = sqliteTable("ai_artifacts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  mode: text("mode").notNull(),
  providerPath: text("provider_path").notNull(),
  promptSummary: text("prompt_summary").notNull(),
  artifactPath: text("artifact_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: text("created_at").default("datetime('now')"),
});
