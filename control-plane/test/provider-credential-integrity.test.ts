import { describe, expect, test } from "bun:test";
import {
  auditProviderCredentialIntegrityRecords,
  type ProviderCredentialRecord,
} from "../src/provider-credential-integrity";
import { encryptSecret } from "../src/services/encryption";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function withEncryptionKey<T>(key: string | undefined, action: () => T | Promise<T>): Promise<T> {
  const previous = process.env.VERTU_ENCRYPTION_KEY;
  if (key === undefined) {
    delete process.env.VERTU_ENCRYPTION_KEY;
  } else {
    process.env.VERTU_ENCRYPTION_KEY = key;
  }
  return Promise.resolve(action()).finally(() => {
    if (previous === undefined) {
      delete process.env.VERTU_ENCRYPTION_KEY;
    } else {
      process.env.VERTU_ENCRYPTION_KEY = previous;
    }
  });
}

describe("provider credential integrity", () => {
  test("flags legacy plaintext credentials", async () => {
    const report = await withEncryptionKey(TEST_ENCRYPTION_KEY, () =>
      auditProviderCredentialIntegrityRecords([
        { provider: "openai", apiKey: "plaintext-secret", updatedAt: "2026-03-07T00:00:00.000Z" },
      ] satisfies readonly ProviderCredentialRecord[])
    );

    expect(report.status).toBe("fail");
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.code).toBe("legacy-plaintext");
  });

  test("flags encrypted credentials when secure storage is unavailable", async () => {
    const encryptedCredential = await withEncryptionKey(TEST_ENCRYPTION_KEY, async () => {
      const encrypted = encryptSecret("test-anthropic-key");
      expect(encrypted.ok).toBe(true);
      if (!encrypted.ok) return "";
      return encrypted.data;
    });

    const report = await withEncryptionKey(undefined, () =>
      auditProviderCredentialIntegrityRecords([
        { provider: "anthropic", apiKey: encryptedCredential, updatedAt: null },
      ] satisfies readonly ProviderCredentialRecord[])
    );

    expect(report.status).toBe("fail");
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.code).toBe("secure-storage-unavailable");
  });

  test("passes encrypted credentials when the configured key can decrypt them", async () => {
    const report = await withEncryptionKey(TEST_ENCRYPTION_KEY, async () => {
      const encrypted = encryptSecret("test-google-key");
      expect(encrypted.ok).toBe(true);
      if (!encrypted.ok) {
        return auditProviderCredentialIntegrityRecords([]);
      }
      return auditProviderCredentialIntegrityRecords([
        { provider: "google", apiKey: encrypted.data, updatedAt: null },
      ] satisfies readonly ProviderCredentialRecord[]);
    });

    expect(report.status).toBe("pass");
    expect(report.issues).toHaveLength(0);
  });
});
