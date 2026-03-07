import { APP_BUILD_ROUTE, FLOW_AUTOMATION_VALIDATE_ROUTE, MODEL_PULL_ROUTE } from "./runtime-constants";

/** Scalar request field values supported by SSR route helpers. */
export type RequestFieldValue = string | number | boolean | null | undefined;

/** Normalized request-body record used by contract parsers. */
export type RequestBodyRecord = Record<string, RequestFieldValue>;

/** Incoming body shapes accepted before normalization. */
export type RequestBodyInput = RequestBodyRecord | RequestFieldValue[] | RequestFieldValue | null | undefined;

/** Normalized request-query record used by contract parsers. */
export type RequestQueryRecord = Record<string, RequestFieldValue>;

/** Loose record candidate accepted before request normalization. */
type RequestRecordCandidate = Record<string, RequestFieldValue | RequestFieldValue[] | object | null | undefined>;

/** Minimal header map used for content negotiation helpers. */
export type HeaderRecord = Record<string, string | number | string[] | undefined>;

/** Supported job-log stream formats. */
export type LogStreamFormat = "json" | "html";

/** Coerce arbitrary request body input into a flat scalar record. */
export function toRequestBody(body: RequestBodyInput): RequestBodyRecord | null | undefined {
  if (body === null || body === undefined) return body;
  if (!isRecord(body)) return null;
  const normalized: RequestBodyRecord = {};
  for (const [key, value] of Object.entries(body)) {
    if (isRequestFieldValue(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/** Coerce arbitrary query input into a flat scalar record. */
export function toRequestQuery(query: RequestRecordCandidate | RequestFieldValue | RequestFieldValue[] | object | null | undefined): RequestQueryRecord | null | undefined {
  if (query === null || query === undefined) {
    return undefined;
  }
  if (!isRecord(query)) {
    return null;
  }
  const normalized: RequestQueryRecord = {};
  for (const [key, value] of Object.entries(query)) {
    if (isRequestFieldValue(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/** Infer the canonical route key used by deterministic error envelopes. */
export function inferRouteFromRequest(request: Request): string | null {
  const path = new URL(request.url).pathname;
  if (path.startsWith(MODEL_PULL_ROUTE)) return MODEL_PULL_ROUTE;
  if (path.startsWith(APP_BUILD_ROUTE)) return APP_BUILD_ROUTE;
  if (path.startsWith("/api/flows/validate/automation")) return FLOW_AUTOMATION_VALIDATE_ROUTE;
  if (path.startsWith("/api/flows/")) return "/api/flows/run";
  if (path.startsWith("/api/ai/")) return path;
  return path || null;
}

/** Convert arbitrary text into a stable DOM id suffix. */
export function toSafeDomIdSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized.length > 0 ? normalized : "log-stream";
}

/** Decide whether a request should receive JSON instead of HTML. */
export function shouldReturnJsonResponse(
  format: string | undefined,
  acceptHeader: string | string[] | undefined,
): boolean {
  if (format?.trim().toLowerCase() === "json") {
    return true;
  }
  const acceptValues = Array.isArray(acceptHeader) ? acceptHeader.join(",") : (acceptHeader ?? "");
  return acceptValues.toLowerCase().includes("application/json");
}

/** Extract the request `Accept` header from an Elysia header map. */
export function extractAcceptHeader(headers: HeaderRecord | null | undefined): string | string[] | undefined {
  if (!headers || !("accept" in headers)) {
    return undefined;
  }
  const rawAccept = headers.accept;
  if (typeof rawAccept === "string" || Array.isArray(rawAccept)) {
    return rawAccept;
  }
  return undefined;
}

/** Serialize a JSON payload while setting the canonical JSON content type. */
export function serializeJsonResponse<T>(
  set: { headers: Record<string, string | number> },
  payload: T,
): string {
  set.headers["content-type"] = "application/json; charset=utf-8";
  return JSON.stringify(payload);
}

/** Parse cursor-based log pagination parameters. */
export function parseLogCursor(query: RequestQueryRecord | null | undefined): string | null {
  const cursor = typeof query?.cursor === "string" ? query.cursor.trim() : "";
  return cursor.length > 0 ? cursor : null;
}

/** Parse the requested log stream format from the query string. */
export function parseLogStreamFormat(query: RequestQueryRecord | null | undefined): LogStreamFormat {
  if (typeof query?.format === "string") {
    return query.format.trim().toLowerCase() === "html" ? "html" : "json";
  }
  return "json";
}

/** Parse the tail-follow flag from the query string. */
export function parseLogTailFlag(query: RequestQueryRecord | null | undefined): boolean {
  const value = typeof query?.tail === "string" ? query.tail.trim().toLowerCase() : undefined;
  return value === "1" || value === "true" || value === "yes";
}

/** Parse an optional trimmed string from form/query scalar input. */
export function parseOptionalTrimmedString(value: RequestFieldValue): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/** Parse an optional integer from form/query scalar input. */
export function parseOptionalInt(value: RequestFieldValue): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^-?\d+$/u.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function isRequestFieldValue(value: RequestFieldValue | RequestFieldValue[] | object | null | undefined): value is RequestFieldValue {
  return (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  );
}

function isRecord(value: RequestRecordCandidate | RequestFieldValue | RequestFieldValue[] | object | null | undefined): value is RequestRecordCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
