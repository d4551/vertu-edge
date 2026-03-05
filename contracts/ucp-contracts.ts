/**
 * UCP (Universal Commerce Protocol) discovery contracts.
 * Canonical types for /.well-known/ucp manifest and discovery results.
 * @see https://ucp.dev/latest/specification/reference/
 */

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** JWK signing key for UCP manifest verification (from spec). */
export interface UCPSigningKey {
  kid: string;
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  use?: string;
  alg?: string;
}

/** UCP capability transport (alternative to services-based discovery). */
export interface UCPCapabilityTransport {
  name: string;
  endpoint: string;
}

/** UCP capability in discovery manifest (supports spec + transports formats). */
export interface UCPCapability {
  name: string;
  version: string;
  spec?: string;
  schema?: string;
  extends?: string;
  config?: JsonObject;
  transports?: UCPCapabilityTransport[];
}

/** UCP service entry (supports rest, mcp, a2a, embedded transports). */
export interface UCPService {
  version: string;
  spec: string;
  rest?: { schema: string; endpoint: string };
  mcp?: { schema: string; endpoint: string };
  a2a?: { endpoint: string };
  embedded?: { schema: string };
}

/** UCP discovery manifest shape returned by external commerce servers. */
export interface UCPManifest {
  ucp: {
    version: string;
    services?: Record<string, UCPService>;
    capabilities: UCPCapability[];
  };
  payment?: {
    handlers: {
      id: string;
      name: string;
      version: string;
      spec: string;
      config_schema: string;
      instrument_schemas: string[];
      config?: JsonObject;
    }[];
  };
  signing_keys?: UCPSigningKey[];
}

/** Error kind for UCP discovery failures. */
export type UCPDiscoverError =
  | "not_found"
  | "invalid_manifest"
  | "invalid_json"
  | "timeout"
  | "network";

/** Result of UCP discovery (success or typed error). */
export type UCPDiscoverResult =
  | { ok: true; manifest: UCPManifest }
  | { ok: false; error: UCPDiscoverError };

/**
 * Contract for `/api/ucp/discover`.
 * `ok:false` responses carry the canonical error code and optional user-facing context.
 */
export type UCPDiscoverResponse =
  | { ok: true; manifest: UCPManifest }
  | { ok: false; error: UCPDiscoverError; message?: string };
