/**
 * SQLite-backed API key storage for AI providers.
 * Uses the shared `bun:sqlite` database instance from `db.ts`.
 *
 * Security: full API keys are stored in SQLite for use by provider clients.
 * For display purposes, use `maskApiKey` which returns only the last 4 chars
 * of the key prefixed with asterisks (e.g. "****abcd").
 */
import { db } from "./db";
import type { ProviderId } from "./ai-providers";

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

/** Row shape for the `api_keys` table. */
interface ApiKeyRow {
  provider: string;
  api_key: string;
  base_url: string | null;
  updated_at: string;
}

function parseApiKeyRow(row: { api_key: string | null } | null): { api_key: string } | null {
  if (!row || typeof row.api_key !== "string") {
    return null;
  }
  return { api_key: row.api_key };
}

function parseApiKeyBaseUrlRow(row: { base_url: string | null } | null): { base_url: string | null } | null {
  if (!row) {
    return null;
  }
  const rawBaseUrl = row.base_url;
  if (rawBaseUrl === null) {
    return { base_url: null };
  }
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim().length === 0) {
    return null;
  }
  return { base_url: rawBaseUrl };
}

function parseApiKeyFullRow(row: Partial<ApiKeyRow>): ApiKeyRow | null {
  const provider = row.provider;
  const api_key = row.api_key;
  const base_url = row.base_url;
  const updated_at = row.updated_at;
  if (typeof provider !== "string" || typeof api_key !== "string" || typeof updated_at !== "string") {
    return null;
  }
  if (base_url !== null && typeof base_url !== "string") {
    return null;
  }
  return {
    provider,
    api_key,
    base_url: base_url ?? null,
    updated_at,
  };
}

function parseApiKeyRows(rows: readonly Partial<ApiKeyRow>[]): ApiKeyRow[] {
  return rows.map((row) => parseApiKeyFullRow(row)).filter((row): row is ApiKeyRow => row !== null);
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
}

/**
 * Upsert an API key (and optional base URL) for a provider.
 */
export function saveApiKey(
  provider: ProviderId,
  apiKey: string,
  baseUrl?: string,
): void {
  db.run(
    `INSERT INTO api_keys (provider, api_key, base_url, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(provider) DO UPDATE SET
       api_key = excluded.api_key,
       base_url = excluded.base_url,
       updated_at = datetime('now')`,
    [provider, apiKey, baseUrl ?? null],
  );
}

/**
 * Retrieve the stored API key for a provider.
 */
export function getApiKey(provider: ProviderId): string | null {
  const row = parseApiKeyRow(
    db.query<{ api_key: string | null }, [ProviderId]>("SELECT api_key FROM api_keys WHERE provider = ?").get(provider),
  );
  return row?.api_key ?? null;
}

/**
 * Retrieve the stored base URL for a provider (primarily for Ollama).
 */
export function getBaseUrl(provider: ProviderId): string | null {
  const row = parseApiKeyBaseUrlRow(
    db.query<{ base_url: string | null }, [ProviderId]>("SELECT base_url FROM api_keys WHERE provider = ?").get(provider),
  );
  return row?.base_url ?? null;
}

/**
 * Delete a stored API key for a provider.
 */
export function deleteApiKey(provider: ProviderId): void {
  db.run("DELETE FROM api_keys WHERE provider = ?", [provider]);
}

/**
 * Return configuration status for all providers.
 */
export function getAllProviderStatuses(
  providers: readonly ProviderStatusInput[],
): ProviderStatus[] {
  const rows = parseApiKeyRows(
    db.query<ApiKeyRow, []>("SELECT provider, api_key, base_url, updated_at FROM api_keys").all(),
  );

  const configured = new Map(rows.map((r) => [r.provider, r]));

  return providers.map((provider) => {
    const row = configured.get(provider.provider);
    const hasStoredRow = Boolean(row);
    const hasKey = (row?.api_key ?? "").trim().length > 0;
    const isConfigured = provider.requiresKey ? hasStoredRow && hasKey : true;
    return {
      provider: provider.provider,
      configured: isConfigured,
      baseUrl: row?.base_url ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}
