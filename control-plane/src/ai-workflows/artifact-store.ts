import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AiArtifactRecord, AiWorkflowMode } from "../../../contracts/flow-contracts";
import { AI_WORKFLOW_ARTIFACT_DIR, safeParseJson, type JsonValue } from "../config";
import { createAiArtifactRow, listAiArtifactRows } from "../db";

/** Result envelope for artifact persistence operations. */
export type ArtifactPersistResult =
  | { ok: true; data: AiArtifactRecord }
  | { ok: false; error: string };

/** Input payload for persisted workflow artifact creation. */
export interface PersistAiArtifactInput {
  /** Owning workflow job id. */
  jobId: string;
  /** Workflow mode that generated the artifact. */
  mode: AiWorkflowMode;
  /** Provider execution path used to generate the output. */
  providerPath: string;
  /** Source prompt used to generate this artifact. */
  prompt: string;
  /** MIME type of payload bytes. */
  mimeType: string;
  /** Base64-encoded payload bytes. */
  base64Payload: string;
  /** Correlation id for auditability. */
  correlationId: string;
}

/** Input payload for persisted workflow text-output artifacts. */
export interface PersistAiTextArtifactInput {
  /** Owning workflow job id. */
  jobId: string;
  /** Workflow mode that generated the artifact. */
  mode: AiWorkflowMode;
  /** Provider execution path used to generate the output. */
  providerPath: string;
  /** Source prompt used to generate this artifact. */
  prompt: string;
  /** Text content to persist as artifact. */
  text: string;
  /** Correlation id for auditability. */
  correlationId: string;
}

const MAX_PROMPT_SUMMARY_CHARS = 240;

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "text/markdown") return "md";
  if (normalized.startsWith("text/")) return "txt";
  return "bin";
}

function normalizePromptSummary(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  if (!compact.length) {
    return "No prompt summary";
  }
  if (compact.length <= MAX_PROMPT_SUMMARY_CHARS) {
    return compact;
  }
  return `${compact.slice(0, MAX_PROMPT_SUMMARY_CHARS - 3)}...`;
}

async function digestSha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function ensureArtifactDir(jobId: string): Promise<string> {
  const root = resolve(AI_WORKFLOW_ARTIFACT_DIR);
  const outputDir = join(root, jobId);
  return mkdir(outputDir, { recursive: true }).then(() => outputDir);
}

function decodeBase64(base64Payload: string): Uint8Array | null {
  const normalized = base64Payload.trim().replace(/\s+/g, "");
  if (!normalized.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return null;
  }
  const padded = normalized.length % 4 === 0
    ? normalized
    : `${normalized}${"=".repeat(4 - (normalized.length % 4))}`;
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

/** Persist base64 artifact payload to disk and store metadata row in SQLite. */
export async function persistAiArtifact(input: PersistAiArtifactInput): Promise<ArtifactPersistResult> {
  const bytes = decodeBase64(input.base64Payload);
  if (!bytes) {
    return { ok: false, error: "Artifact payload is not valid base64." };
  }
  const extension = extensionForMimeType(input.mimeType);
  const outputDir = await ensureArtifactDir(input.jobId);
  const artifactId = crypto.randomUUID();
  const artifactPath = join(outputDir, `${artifactId}.${extension}`);
  const createdAt = new Date().toISOString();
  const sha256 = await digestSha256Hex(bytes);
  const writeOutcome = await Bun.write(artifactPath, bytes).then(
    () => ({ ok: true as const }),
    (failure) => ({ ok: false as const, failure }),
  );
  if (!writeOutcome.ok) {
    const reason = writeOutcome.failure instanceof Error
      ? writeOutcome.failure.message
      : "Failed to write artifact file.";
    return { ok: false, error: reason };
  }

  const row: AiArtifactRecord = {
    id: artifactId,
    jobId: input.jobId,
    mode: input.mode,
    providerPath: input.providerPath,
    promptSummary: normalizePromptSummary(input.prompt),
    artifactPath,
    mimeType: input.mimeType,
    sha256,
    sizeBytes: bytes.byteLength,
    correlationId: input.correlationId,
    createdAt,
  };

  createAiArtifactRow({
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
    createdAt: row.createdAt,
  });

  return { ok: true, data: row };
}

/** Persist text workflow output and store metadata row in SQLite. */
export async function persistAiTextArtifact(input: PersistAiTextArtifactInput): Promise<ArtifactPersistResult> {
  const bytes = new TextEncoder().encode(input.text);
  const base64Payload = Buffer.from(bytes).toString("base64");
  return persistAiArtifact({
    jobId: input.jobId,
    mode: input.mode,
    providerPath: input.providerPath,
    prompt: input.prompt,
    mimeType: "text/markdown",
    base64Payload,
    correlationId: input.correlationId,
  });
}

/** List persisted AI artifacts for a workflow job id. */
export function getAiArtifactsForJob(jobId: string): AiArtifactRecord[] {
  return listAiArtifactRows(jobId).map((row) => ({
    id: row.id,
    jobId: row.jobId,
    mode: parseMode(row.mode),
    providerPath: row.providerPath,
    promptSummary: row.promptSummary,
    artifactPath: row.artifactPath,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  }));
}

function parseMode(raw: string): AiWorkflowMode {
  if (raw === "chat" || raw === "typography" || raw === "presentation" || raw === "social" || raw === "image") {
    return raw;
  }
  return "chat";
}

/** Parse a serialized workflow result from persisted JSON text. */
export function parseSerializedWorkflowResult(raw: string): JsonValue | null {
  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    return null;
  }
  return parsed.data;
}
