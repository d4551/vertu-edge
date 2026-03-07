/**
 * Environment variable parsing helpers.
 *
 * Extracted from the monolithic config.ts to enable reuse across modules
 * without pulling in the entire config dependency graph.
 */
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";

// ---------------------------------------------------------------------------
// JSON types and safe parse
// ---------------------------------------------------------------------------

/** Strict JSON scalar type used for config/runtime decoding. */
export type JsonScalar = string | number | boolean | null;
/** Strict JSON object type used for config/runtime decoding. */
export type JsonRecord = { [key: string]: JsonValue };
/** Strict JSON value used instead of opaque `unknown` types. */
export type JsonValue = JsonScalar | JsonRecord | JsonValue[];
/** External JSON-like input accepted at configuration boundaries before normalization. */
export type JsonInput = JsonScalar | { [key: string]: JsonInput | undefined } | JsonInput[];

/** Result of a safe JSON parse. Avoids try/catch in callers. */
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Parse JSON without throwing. Returns Result for explicit error handling. */
export function safeParseJson<T extends JsonValue>(raw: string): ParseResult<T> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Empty input" };
  }
  const errors: ParseError[] = [];
  const decoded = parseJsonc(trimmed, errors, { allowTrailingComma: false, disallowComments: true }) as JsonValue;
  if (errors.length > 0) {
    const firstError = errors[0];
    if (!firstError) {
      return { ok: false, error: "JSON parse error: invalid payload" };
    }
    const parseCode = printParseErrorCode(firstError.error);
    return { ok: false, error: `JSON parse error: ${parseCode} at offset ${firstError.offset}` };
  }
  if (decoded === null || typeof decoded === "string" || typeof decoded === "number" || typeof decoded === "boolean") {
    return { ok: true, data: decoded as T };
  }
  if (Array.isArray(decoded)) {
    return { ok: true, data: decoded as T };
  }
  if (typeof decoded === "object" && decoded !== null) {
    return { ok: true, data: decoded as T };
  }
  return { ok: false, error: "Invalid JSON structure" };
}

// ---------------------------------------------------------------------------
// Environment variable readers
// ---------------------------------------------------------------------------

/** Read a positive integer from an env var, falling back to default on missing or invalid input. */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/** Read an optional URL from an env var, returning null for missing or invalid inputs. */
export function readOptionalUrlEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  if (!URL.canParse(trimmed)) return null;
  return trimmed;
}

/** Read a trimmed string from an env var, falling back on missing or blank values. */
export function readStringEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Read a string array from an env var (supports JSON arrays or comma-separated). */
export function readStringArrayEnv(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return [...fallback];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [...fallback];
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed = safeParseJson<JsonValue>(trimmed);
    if (!parsed.ok) return [...fallback];
    const decoded = parsed.data;
    if (!Array.isArray(decoded)) return [...fallback];
    const values = decoded
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
    return values.length > 0 ? values : [...fallback];
  }

  const values = trimmed
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : [...fallback];
}

// ---------------------------------------------------------------------------
// JSON type guards
// ---------------------------------------------------------------------------

/** Check whether a value is a non-null JSON record. */
export function isJsonRecord(value: JsonInput | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Safely coerce a value to a trimmed string; returns empty string for non-string values. */
export function toTrimmedString(value: JsonInput | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
