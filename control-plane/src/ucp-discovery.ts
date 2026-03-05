import { UCP_DISCOVERY_TIMEOUT_MS } from "./config";
import { safeParseJson, type JsonRecord, type JsonValue } from "./config";
import { UCPFetchError } from "./errors";
import type {
  UCPCapability,
  UCPDiscoverResult,
  UCPManifest,
  UCPDiscoverError,
  UCPSigningKey,
} from "../../contracts/ucp-contracts";

export type {
  UCPCapability,
  UCPCapabilityTransport,
  UCPDiscoverError,
  UCPDiscoverResult,
  UCPManifest,
  UCPService,
  UCPSigningKey,
} from "../../contracts/ucp-contracts";

function isRecord(value: object | JsonValue | undefined): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidCapability(cap: object | JsonValue | undefined): cap is UCPCapability {
  if (!isRecord(cap)) return false;
  const c = cap;
  return (
    typeof c.name === "string" &&
    typeof c.version === "string" &&
    (Array.isArray(c.transports) ||
      (typeof c.spec === "string" && typeof c.schema === "string"))
  );
}

function isValidSigningKey(key: object | JsonValue | undefined): key is UCPSigningKey {
  if (!isRecord(key)) return false;
  const k = key;
  return typeof k.kid === "string" && typeof k.kty === "string";
}

function isUcpManifest(value: object | JsonValue): value is UCPManifest {
  if (!isRecord(value)) {
    return false;
  }

  const rawUcp = value.ucp;
  if (!isRecord(rawUcp)) {
    return false;
  }
  if (typeof rawUcp.version !== "string" || !Array.isArray(rawUcp.capabilities)) {
    return false;
  }

  if (rawUcp.services !== undefined && !isRecord(rawUcp.services)) {
    return false;
  }

  if (!rawUcp.capabilities.every(isValidCapability)) {
    return false;
  }

  if (value.payment !== undefined) {
    const payment = value.payment;
    if (!isRecord(payment) || !(payment.handlers === undefined || Array.isArray(payment.handlers))) {
      return false;
    }
  }

  if (value.signing_keys !== undefined) {
    if (!Array.isArray(value.signing_keys) || !value.signing_keys.every(isValidSigningKey)) {
      return false;
    }
  }

  return true;
}

/**
 * UCP Discovery with detailed result.
 * Fetches the `.well-known/ucp` JSON manifest from external business servers.
 * Used by the Vertu AI Agent to dynamically discover purchase and checkout capabilities.
 */
export async function discoverBusinessCapabilitiesWithResult(
  serverUrl: string,
): Promise<UCPDiscoverResult> {
  if (!URL.canParse(serverUrl)) {
    return { ok: false, error: "not_found" };
  }

  try {
    const manifest = await fetchBusinessCapabilities(serverUrl);
    return { ok: true, manifest };
  } catch (error) {
    if (error instanceof UCPFetchError) {
      const reason = mapUcpErrorReason(error.details);
      return { ok: false, error: reason };
    }
    return { ok: false, error: "network" };
  }
}

/** Fetch and strictly validate UCP discovery manifest or throw UCPFetchError. */
async function fetchBusinessCapabilities(serverUrl: string): Promise<UCPManifest> {
  if (!URL.canParse(serverUrl)) {
    throw new UCPFetchError("Invalid UCP server URL", { details: "not_found", retryable: false });
  }
  const baseUrl = new URL(serverUrl);
  const url = new URL("/.well-known/ucp", baseUrl);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UCP_DISCOVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new UCPFetchError(`UCP manifest request returned status ${response.status}`, {
        details: "not_found",
        retryable: response.status >= 500,
      });
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new UCPFetchError("UCP manifest response was not JSON", { details: "invalid_manifest", retryable: false });
    }

    const body = await response.text();
    const parsedResult = safeParseJson<JsonValue>(body);
    if (!parsedResult.ok) {
      throw new UCPFetchError("Unable to parse UCP manifest JSON", { details: "invalid_json", retryable: false });
    }
    const parsed = parsedResult.data;
    if (!isRecord(parsed)) {
      throw new UCPFetchError("UCP manifest was not an object", { details: "invalid_json", retryable: false });
    }
    if (!isUcpManifest(parsed)) {
      throw new UCPFetchError("UCP manifest did not match expected schema", {
        details: "invalid_manifest",
        retryable: false,
      });
    }
    return parsed;
  } catch (err) {
    if (err instanceof UCPFetchError) {
      throw err;
    }
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new UCPFetchError(isTimeout ? "UCP discovery timed out" : "UCP discovery request failed", {
      details: isTimeout ? "timeout" : "network",
      retryable: isTimeout,
    });
  }
}

function mapUcpErrorReason(details: string | undefined): UCPDiscoverError {
  if (details === "invalid_json") return "invalid_json";
  if (details === "invalid_manifest") return "invalid_manifest";
  if (details === "timeout") return "timeout";
  if (details === "network") return "network";
  return "not_found";
}

/**
 * UCP Discovery (legacy).
 * Returns manifest or null. Use discoverBusinessCapabilitiesWithResult for error details.
 */
export async function discoverBusinessCapabilities(serverUrl: string): Promise<UCPManifest | null> {
  const result = await discoverBusinessCapabilitiesWithResult(serverUrl);
  return result.ok ? result.manifest : null;
}
