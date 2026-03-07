import { resolve } from "node:path";
import type { ArtifactMetadata } from "../../contracts/flow-contracts";
import { safeParseJson, type JsonRecord, type JsonValue } from "./config";

interface ParsedArtifactLines {
  artifactPath?: string;
  sha256?: string;
  sizeBytes?: number;
  createdAt?: string;
  contentType?: string;
  signature?: string;
  correlationId?: string;
}

interface ArtifactFailure {
  ok: false;
  reason: string;
}

interface ArtifactSuccess {
  ok: true;
}

const METADATA_JSON_PREFIX = /ARTIFACT_METADATA_JSON=([^\n\r]+)/;
const ARTIFACT_PATH_PREFIX = /ARTIFACT_PATH=([^\n\r]+)/;
const ARTIFACT_SHA256_PREFIX = /ARTIFACT_SHA256=([a-f0-9]+)/i;
const ARTIFACT_SIZE_BYTES_PREFIX = /ARTIFACT_SIZE_BYTES=(\d+)/;
const ARTIFACT_CREATED_AT_PREFIX = /ARTIFACT_CREATED_AT=([^\n\r]+)/;
const ARTIFACT_CONTENT_TYPE_PREFIX = /ARTIFACT_CONTENT_TYPE=([^\n\r]+)/;
const ARTIFACT_SIGNATURE_PREFIX = /ARTIFACT_SIGNATURE=([^\n\r]+)/;

function firstMatch(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  return match?.[1]?.trim() ?? null;
}

function coerceCorrelationId(correlationId: string | undefined): string {
  const trimmed = correlationId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "unknown";
}

function isPositiveInteger(value: number | null | undefined): value is number {
  if (value === null || value === undefined) {
    return false;
  }
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isValidSha256(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function safeSize(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return isPositiveInteger(parsed) ? parsed : undefined;
}

function toAbsolutePath(pathValue: string): string {
  return resolve(pathValue);
}

export async function computeSha256Hex(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseArtifactMetadataJson(payload: string | null): ParsedArtifactLines | null {
  if (!payload) {
    return null;
  }

  const parsed = safeParseJson<JsonValue>(payload);
  if (!parsed.ok || !isRecord(parsed.data)) {
    return null;
  }

  const value = parsed.data;
  const artifactPath = typeof value.artifactPath === "string" ? value.artifactPath : undefined;
  const sha256 = typeof value.sha256 === "string" ? value.sha256.toLowerCase() : undefined;
  const sizeBytes = typeof value.sizeBytes === "number" ? value.sizeBytes : undefined;
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : undefined;
  const contentType = typeof value.contentType === "string" ? value.contentType : undefined;
  if (!artifactPath || !isValidSha256(sha256) || !isPositiveInteger(sizeBytes) || !createdAt || !contentType) {
    return null;
  }

  const signature = typeof value.signature === "string" ? value.signature : undefined;
  const correlationId = typeof value.correlationId === "string" ? value.correlationId : undefined;

  return {
    artifactPath,
    sha256,
    sizeBytes,
    createdAt,
    contentType,
    signature,
    correlationId,
  };
}

function parseArtifactMetadataLines(stdout: string, stderr: string): ParsedArtifactLines {
  const source = `${stdout}\n${stderr}`;
  const shaValue = firstMatch(source, ARTIFACT_SHA256_PREFIX);

  return {
    artifactPath: firstMatch(source, ARTIFACT_PATH_PREFIX) ?? undefined,
    sha256: shaValue === null ? undefined : shaValue.toLowerCase(),
    sizeBytes: safeSize(firstMatch(source, ARTIFACT_SIZE_BYTES_PREFIX)),
    createdAt: firstMatch(source, ARTIFACT_CREATED_AT_PREFIX) ?? undefined,
    contentType: firstMatch(source, ARTIFACT_CONTENT_TYPE_PREFIX) ?? undefined,
    signature: firstMatch(source, ARTIFACT_SIGNATURE_PREFIX) ?? undefined,
  };
}

function parseMetadataFromOutput(stdout: string, stderr: string): ParsedArtifactLines | null {
  const source = `${stdout}\n${stderr}`;
  const jsonPayload = firstMatch(source, METADATA_JSON_PREFIX);
  const fromJson = parseArtifactMetadataJson(jsonPayload);
  if (fromJson) {
    return fromJson;
  }

  const fromLines = parseArtifactMetadataLines(stdout, stderr);
  if (
    !fromLines.artifactPath
    && !fromLines.sha256
    && fromLines.sizeBytes === undefined
    && !fromLines.createdAt
    && !fromLines.contentType
  ) {
    return null;
  }

  return fromLines;
}

function makeMetadataFromParsed(
  parsed: ParsedArtifactLines,
  fallbackPath: string | null,
  correlationId: string | undefined,
): ArtifactMetadata | null {
  const artifactPathRaw = parsed.artifactPath ?? fallbackPath;
  if (!artifactPathRaw || artifactPathRaw.length === 0) {
    return null;
  }

  const artifactPath = toAbsolutePath(artifactPathRaw);

  const sha256 = parsed.sha256;
  const sizeBytes = parsed.sizeBytes;
  const createdAt = parsed.createdAt;
  const contentType = parsed.contentType;
  if (!isValidSha256(sha256) || !isPositiveInteger(sizeBytes) || !createdAt || !contentType) {
    return null;
  }

  return {
    artifactPath,
    sha256,
    sizeBytes,
    createdAt,
    contentType,
    signature: parsed.signature,
    correlationId: coerceCorrelationId(parsed.correlationId ?? correlationId),
  };
}

/**
 * Parse build artifact metadata from script output and optional fallback path.
 */
export function parseArtifactMetadata(
  stdout: string,
  stderr: string,
  fallbackPath: string | null,
  correlationId: string | undefined,
): ArtifactMetadata | null {
  const parsed = parseMetadataFromOutput(stdout, stderr);
  if (!parsed) {
    return null;
  }

  return makeMetadataFromParsed(parsed, fallbackPath, correlationId);
}

/**
 * Verify build artifact metadata against actual file system metadata.
 */
export async function verifyArtifactMetadata(metadata: ArtifactMetadata | null): Promise<ArtifactSuccess | ArtifactFailure> {
  if (!metadata) {
    return { ok: false, reason: "Build artifact metadata is missing." };
  }

  const artifactFile = Bun.file(metadata.artifactPath);
  const exists = await artifactFile.exists();
  if (!exists) {
    return { ok: false, reason: `Artifact not found at ${metadata.artifactPath}` };
  }

  const stats = await artifactFile.stat();
  if (!stats.isFile()) {
    return { ok: false, reason: `Artifact is not a file: ${metadata.artifactPath}` };
  }

  if (stats.size !== metadata.sizeBytes) {
    return {
      ok: false,
      reason: `Artifact size mismatch expected=${metadata.sizeBytes} actual=${stats.size}`,
    };
  }

  const actualSha = await computeSha256Hex(metadata.artifactPath);
  if (actualSha.toLowerCase() !== metadata.sha256.toLowerCase()) {
    return {
      ok: false,
      reason: `Artifact checksum mismatch expected=${metadata.sha256} actual=${actualSha}`,
    };
  }

  return { ok: true };
}

/**
 * Type guard for JSON payloads that match ArtifactMetadata.
 */
export function isArtifactMetadataLike(value: JsonValue): value is JsonRecord & ArtifactMetadata {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  return (
    typeof candidate.artifactPath === "string"
    && typeof candidate.sha256 === "string"
    && typeof candidate.sizeBytes === "number"
    && typeof candidate.createdAt === "string"
    && typeof candidate.contentType === "string"
    && (candidate.signature === undefined || typeof candidate.signature === "string")
    && (candidate.correlationId === undefined || typeof candidate.correlationId === "string")
  );
}

function isRecord(value: JsonValue | null | undefined): value is JsonRecord {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}
