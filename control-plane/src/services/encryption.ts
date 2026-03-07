/**
 * AES-256-GCM encryption for sensitive data (API keys).
 *
 * Provider credentials must never persist in plaintext. The runtime therefore
 * fails closed whenever `VERTU_ENCRYPTION_KEY` is missing or invalid.
 *
 * Ciphertext format: `<iv-hex>:<ciphertext-hex>:<tag-hex>`
 */
import { createCipheriv, createDecipheriv } from "node:crypto";
import { captureResult, type Result } from "../../../shared/failure";

const ENCRYPTION_KEY_ENV = "VERTU_ENCRYPTION_KEY";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/** Encryption status codes exposed to credential storage callers. */
export type EncryptionStatusCode = "ready" | "missing-key" | "invalid-key";

/** Deterministic encryption runtime state resolved from process env. */
export interface EncryptionStatus {
  readonly code: EncryptionStatusCode;
  readonly enabled: boolean;
}

/** Typed failure emitted when secret encryption/decryption cannot proceed. */
export interface EncryptionFailure {
  readonly code: Exclude<EncryptionStatusCode, "ready"> | "invalid-payload";
  readonly message: string;
}

type EncryptionKeyResolution =
  | { readonly status: EncryptionStatus; readonly key: Buffer }
  | { readonly status: EncryptionStatus; readonly key: null };

/** Resolve the encryption key from environment. */
function resolveEncryptionKey(): EncryptionKeyResolution {
  const raw = process.env[ENCRYPTION_KEY_ENV];
  if (!raw) {
    return {
      status: { code: "missing-key", enabled: false },
      key: null,
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      status: { code: "missing-key", enabled: false },
      key: null,
    };
  }

  // Accept hex-encoded 32-byte key (64 hex chars)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return {
      status: { code: "ready", enabled: true },
      key: Buffer.from(trimmed, "hex"),
    };
  }

  // Accept base64-encoded 32-byte key
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) {
    return {
      status: { code: "ready", enabled: true },
      key: decoded,
    };
  }

  return {
    status: { code: "invalid-key", enabled: false },
    key: null,
  };
}

/** Resolve the current encryption runtime status. */
export function getEncryptionStatus(): EncryptionStatus {
  return resolveEncryptionKey().status;
}

/** Whether encryption is enabled (VERTU_ENCRYPTION_KEY is set and valid). */
export function isEncryptionEnabled(): boolean {
  return getEncryptionStatus().enabled;
}

function buildStatusFailure(status: Exclude<EncryptionStatusCode, "ready">): EncryptionFailure {
  if (status === "invalid-key") {
    return {
      code: "invalid-key",
      message: "VERTU_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    };
  }
  return {
    code: "missing-key",
    message: "Set VERTU_ENCRYPTION_KEY before storing provider credentials.",
  };
}

/** Check whether a value matches the canonical encrypted payload format. */
export function isEncryptedPayload(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  const [ivHex, dataHex, tagHex] = parts;
  if (!ivHex || !dataHex || !tagHex) return false;
  if (ivHex.length !== IV_LENGTH * 2 || tagHex.length !== TAG_LENGTH * 2) return false;
  if (dataHex.length === 0 || dataHex.length % 2 !== 0) return false;
  return /^[0-9a-fA-F]+$/.test(ivHex) && /^[0-9a-fA-F]+$/.test(dataHex) && /^[0-9a-fA-F]+$/.test(tagHex);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns the encrypted value in `<iv>:<ciphertext>:<tag>` hex format.
 */
export function encryptSecret(plaintext: string): Result<string, EncryptionFailure> {
  const resolved = resolveEncryptionKey();
  if (!resolved.key) {
    const failureCode = resolved.status.code === "ready" ? "missing-key" : resolved.status.code;
    return { ok: false, error: buildStatusFailure(failureCode) };
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const cipher = createCipheriv(ALGORITHM, resolved.key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ok: true,
    data: `${Buffer.from(iv).toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`,
  };
}

/**
 * Decrypt a value encrypted with `encryptSecret()`.
 * Returns the plaintext string.
 */
export function decryptSecret(ciphertext: string): Result<string, EncryptionFailure> {
  const resolved = resolveEncryptionKey();
  if (!resolved.key) {
    const failureCode = resolved.status.code === "ready" ? "missing-key" : resolved.status.code;
    return { ok: false, error: buildStatusFailure(failureCode) };
  }
  if (!isEncryptedPayload(ciphertext)) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "Stored provider credential is not in the encrypted format.",
      },
    };
  }

  const parts = ciphertext.split(":");
  const [ivHex, dataHex, tagHex] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  return captureResult(() => {
    const decipher = createDecipheriv(ALGORITHM, resolved.key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    return decrypted.toString("utf8");
  }, () => ({
    code: "invalid-payload",
    message: "Stored provider credential could not be decrypted with the configured encryption key.",
  }));
}

/**
 * Generate a new random 32-byte encryption key as a hex string.
 * Useful for initial setup: `bun -e "console.log(require('./services/encryption').generateKey())"`
 */
export function generateKey(): string {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(key).toString("hex");
}
