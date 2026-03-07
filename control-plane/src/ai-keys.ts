/**
 * SQLite-backed API key storage for AI providers.
 * Uses the Drizzle ORM instance from `db/index.ts`.
 *
 * Security: provider credentials are encrypted at rest using AES-256-GCM and
 * fail closed when `VERTU_ENCRYPTION_KEY` is missing or invalid. For display
 * purposes, use `maskApiKey` which returns only the last 4 chars of the key
 * prefixed with asterisks (e.g. "****abcd").
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { apiKeys } from "./db/schema";
import type { ProviderId } from "./ai-providers";
import type { Result } from "../../shared/failure";
import { logger } from "./logger";
import { decryptSecret, encryptSecret, type EncryptionFailure } from "./services/encryption";

/**
 * Mask an API key for safe display. Returns "****<last4>" if the key is long
 * enough to mask, or "****" for short/empty values.
 */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

/** Provider status input used to evaluate if credentials are complete. */
export interface ProviderStatusInput {
  provider: ProviderId;
  requiresKey: boolean;
}

/** Provider configuration status returned to the UI. */
export interface ProviderStatus {
  provider: ProviderId;
  configured: boolean;
  baseUrl: string | null;
  updatedAt: string | null;
  credentialState: ProviderCredentialState;
}

/** Deterministic credential-storage states surfaced to the UI. */
export type ProviderCredentialState =
  | "configured"
  | "not-configured"
  | "secure-storage-unavailable"
  | "stored-credential-invalid";

/** Typed failure emitted when provider credential persistence is unavailable. */
export interface ProviderCredentialFailure {
  readonly code: Exclude<ProviderCredentialState, "configured" | "not-configured">;
  readonly message: string;
}

type StoredCredentialRow = {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly baseUrl: string | null;
  readonly updatedAt: string;
};

type StoredCredentialResolution = {
  readonly apiKey: string | null;
  readonly credentialState: ProviderCredentialState;
};

function mapEncryptionFailure(error: EncryptionFailure): ProviderCredentialFailure {
  if (error.code === "invalid-payload") {
    return {
      code: "stored-credential-invalid",
      message: "Stored provider credential is unreadable. Re-enter the provider key.",
    };
  }
  return {
    code: "secure-storage-unavailable",
    message: "Set VERTU_ENCRYPTION_KEY before storing provider credentials.",
  };
}

function getStoredCredentialRow(provider: ProviderId): StoredCredentialRow | null {
  const row = db.select()
    .from(apiKeys)
    .where(eq(apiKeys.provider, provider))
    .get();
  if (!row) return null;
  if (
    typeof row.apiKey !== "string"
    || typeof row.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    provider,
    apiKey: row.apiKey,
    baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : null,
    updatedAt: row.updatedAt,
  };
}

function resolveStoredApiKey(storedValue: string | null | undefined): StoredCredentialResolution {
  const normalizedStoredValue = typeof storedValue === "string" ? storedValue.trim() : "";
  if (normalizedStoredValue.length === 0) {
    return {
      apiKey: null,
      credentialState: "not-configured",
    };
  }

  const decrypted = decryptSecret(normalizedStoredValue);
  if (!decrypted.ok) {
    if (decrypted.error.code === "invalid-payload") {
      return {
        apiKey: null,
        credentialState: "stored-credential-invalid",
      };
    }
    return {
      apiKey: null,
      credentialState: "secure-storage-unavailable",
    };
  }

  const apiKey = decrypted.data.trim();
  if (apiKey.length === 0) {
    return {
      apiKey: null,
      credentialState: "not-configured",
    };
  }

  return {
    apiKey,
    credentialState: "configured",
  };
}

/**
 * Upsert an API key (and optional base URL) for a provider.
 */
export function saveApiKey(
  provider: ProviderId,
  apiKey: string,
  baseUrl?: string,
): Result<void, ProviderCredentialFailure> {
  const now = new Date().toISOString();
  const normalizedApiKey = apiKey.trim();
  let encryptedKey = "";
  if (normalizedApiKey.length > 0) {
    const encryptionResult = encryptSecret(normalizedApiKey);
    if (!encryptionResult.ok) {
      return { ok: false, error: mapEncryptionFailure(encryptionResult.error) };
    }
    encryptedKey = encryptionResult.data;
  }

  db.insert(apiKeys)
    .values({
      provider,
      apiKey: encryptedKey,
      baseUrl: baseUrl ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: apiKeys.provider,
      set: { apiKey: encryptedKey, baseUrl: baseUrl ?? null, updatedAt: now },
    })
    .run();
  return { ok: true, data: undefined };
}

/**
 * Retrieve the stored API key for a provider.
 */
export function getApiKey(provider: ProviderId): string | null {
  const row = getStoredCredentialRow(provider);
  if (!row) return null;
  const resolved = resolveStoredApiKey(row.apiKey);
  if (resolved.credentialState === "stored-credential-invalid") {
    logger.warn("Stored provider credential is unreadable", { provider });
  }
  return resolved.apiKey;
}

/**
 * Retrieve the stored base URL for a provider (primarily for Ollama).
 */
export function getBaseUrl(provider: ProviderId): string | null {
  const row = getStoredCredentialRow(provider);
  if (!row) return null;
  if (row.baseUrl === null) return null;
  if (typeof row.baseUrl !== "string" || row.baseUrl.trim().length === 0) return null;
  return row.baseUrl;
}

/**
 * Delete a stored API key for a provider.
 */
export function deleteApiKey(provider: ProviderId): void {
  db.delete(apiKeys).where(eq(apiKeys.provider, provider)).run();
}

/**
 * Return configuration status for all providers.
 */
export function getAllProviderStatuses(
  providers: readonly ProviderStatusInput[],
): ProviderStatus[] {
  const rows = db.select().from(apiKeys).all().filter((row): row is StoredCredentialRow =>
    typeof row.provider === "string"
    && typeof row.apiKey === "string"
    && typeof row.updatedAt === "string");

  const configured = new Map(
    rows
      .map((r) => [r.provider, r]),
  );

  return providers.map((provider) => {
    const row = configured.get(provider.provider);
    const resolvedCredential = provider.requiresKey
      ? resolveStoredApiKey(row?.apiKey)
      : { apiKey: null, credentialState: "configured" as const };
    const isConfigured = provider.requiresKey
      ? resolvedCredential.credentialState === "configured"
      : true;
    return {
      provider: provider.provider,
      configured: isConfigured,
      baseUrl: row?.baseUrl ?? null,
      updatedAt: row?.updatedAt ?? null,
      credentialState: provider.requiresKey ? resolvedCredential.credentialState : "configured",
    };
  });
}
