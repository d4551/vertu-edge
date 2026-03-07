import { describe, expect, test } from "bun:test";
import { db, initDb } from "../src/db";
import { apiKeys } from "../src/db/schema";
import {
  deleteApiKey,
  getAllProviderStatuses,
  getApiKey,
  saveApiKey,
} from "../src/ai-keys";

initDb();

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

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("ai-keys secure storage", () => {
  test("saveApiKey fails closed when encryption is unavailable", async () => {
    deleteApiKey("openai");

    const result = await withEncryptionKey(undefined, () => saveApiKey("openai", "test-openai-key"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("secure-storage-unavailable");
    expect(getApiKey("openai")).toBeNull();
  });

  test("getAllProviderStatuses marks encrypted credentials unavailable without the runtime key", async () => {
    deleteApiKey("anthropic");

    const saveResult = await withEncryptionKey(TEST_ENCRYPTION_KEY, () =>
      saveApiKey("anthropic", "test-anthropic-key")
    );
    expect(saveResult.ok).toBe(true);

    const statuses = await withEncryptionKey(undefined, () =>
      getAllProviderStatuses([{ provider: "anthropic", requiresKey: true }])
    );

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.configured).toBe(false);
    expect(statuses[0]?.credentialState).toBe("secure-storage-unavailable");

    deleteApiKey("anthropic");
  });

  test("getAllProviderStatuses marks legacy plaintext credentials invalid", async () => {
    deleteApiKey("google");
    db.insert(apiKeys)
      .values({
        provider: "google",
        apiKey: "plaintext-legacy-key",
        baseUrl: null,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const statuses = await withEncryptionKey(TEST_ENCRYPTION_KEY, () =>
      getAllProviderStatuses([{ provider: "google", requiresKey: true }])
    );

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.configured).toBe(false);
    expect(statuses[0]?.credentialState).toBe("stored-credential-invalid");

    deleteApiKey("google");
  });
});
