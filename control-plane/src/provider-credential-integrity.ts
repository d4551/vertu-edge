import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolveDbPath } from "./db/connection";
import {
  decryptSecret,
  getEncryptionStatus,
  isEncryptedPayload,
  type EncryptionStatus,
} from "./services/encryption";

/** Raw provider-credential row loaded from the control-plane SQLite store. */
export interface ProviderCredentialRecord {
  readonly provider: string;
  readonly apiKey: string;
  readonly updatedAt: string | null;
}

/** Deterministic credential-integrity issue codes surfaced to tooling and UI. */
export type ProviderCredentialIntegrityIssueCode =
  | "legacy-plaintext"
  | "secure-storage-unavailable"
  | "encrypted-credential-invalid";

/** Single provider-credential integrity failure. */
export interface ProviderCredentialIntegrityIssue {
  readonly provider: string;
  readonly updatedAt: string | null;
  readonly code: ProviderCredentialIntegrityIssueCode;
  readonly message: string;
}

/** Repository-level credential-integrity report returned by audits and doctor. */
export interface ProviderCredentialIntegrityReport {
  readonly status: "pass" | "fail";
  readonly dbPath: string;
  readonly credentialCount: number;
  readonly issueCount: number;
  readonly issues: readonly ProviderCredentialIntegrityIssue[];
}

/**
 * Load stored provider credentials from the canonical control-plane database.
 * Missing databases or missing tables resolve to an empty row set.
 */
export function loadProviderCredentialRecords(dbPath = resolveDbPath()): ProviderCredentialRecord[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  const database = new Database(dbPath, { readonly: true, strict: true });
  const tableExists = database
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("api_keys");
  if (!tableExists) {
    database.close(false);
    return [];
  }

  const rows = database
    .query<{ provider: string; apiKey: string; updatedAt: string | null }, []>(
      "SELECT provider, api_key AS apiKey, updated_at AS updatedAt FROM api_keys",
    )
    .all();
  database.close(false);

  return rows.filter((row): row is ProviderCredentialRecord =>
    typeof row.provider === "string"
    && typeof row.apiKey === "string"
    && (typeof row.updatedAt === "string" || row.updatedAt === null));
}

/**
 * Evaluate provider credential rows against the active encryption policy.
 */
export function auditProviderCredentialIntegrityRecords(
  rows: readonly ProviderCredentialRecord[],
  encryptionStatus: EncryptionStatus = getEncryptionStatus(),
  dbPath = resolveDbPath(),
): ProviderCredentialIntegrityReport {
  const storedCredentials = rows
    .map((row) => ({
      provider: row.provider.trim(),
      apiKey: row.apiKey.trim(),
      updatedAt: row.updatedAt,
    }))
    .filter((row) => row.provider.length > 0 && row.apiKey.length > 0);

  const issues = storedCredentials.flatMap<ProviderCredentialIntegrityIssue>((row) => {
    if (!isEncryptedPayload(row.apiKey)) {
      return [{
        provider: row.provider,
        updatedAt: row.updatedAt,
        code: "legacy-plaintext",
        message: `Provider credential for ${row.provider} is stored in plaintext and must be re-saved.`,
      }];
    }

    if (encryptionStatus.code !== "ready") {
      const reason = encryptionStatus.code === "invalid-key"
        ? "VERTU_ENCRYPTION_KEY is invalid for decrypting stored provider credentials."
        : "VERTU_ENCRYPTION_KEY is required to decrypt stored provider credentials.";
      return [{
        provider: row.provider,
        updatedAt: row.updatedAt,
        code: "secure-storage-unavailable",
        message: `${reason} Reconfigure secure storage before using ${row.provider}.`,
      }];
    }

    const decrypted = decryptSecret(row.apiKey);
    if (decrypted.ok) {
      return [];
    }

    return [{
      provider: row.provider,
      updatedAt: row.updatedAt,
      code: "encrypted-credential-invalid",
      message: `Encrypted provider credential for ${row.provider} cannot be decrypted with the configured secure-storage key.`,
    }];
  });

  return {
    status: issues.length > 0 ? "fail" : "pass",
    dbPath,
    credentialCount: storedCredentials.length,
    issueCount: issues.length,
    issues,
  };
}

/**
 * Audit provider credentials from the canonical database file.
 */
export function auditProviderCredentialIntegrity(dbPath = resolveDbPath()): ProviderCredentialIntegrityReport {
  const rows = loadProviderCredentialRecords(dbPath);
  return auditProviderCredentialIntegrityRecords(rows, getEncryptionStatus(), dbPath);
}
