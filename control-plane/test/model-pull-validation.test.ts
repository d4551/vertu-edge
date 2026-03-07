import { expect, test } from "bun:test";
import { initDb } from "../src/db";
import {
  cleanupPartialDownload,
  discoverModelArtifactPath,
} from "../src/model-manager";
import { computeSha256Hex } from "../src/artifact-metadata";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

initDb();

function withTempDir<T>(dirName: string, run: (dirPath: string) => Promise<T>): Promise<T> {
  const dirPath = join(import.meta.dir, dirName);
  mkdirSync(dirPath, { recursive: true });
  return Promise.resolve(run(dirPath)).finally(() => {
    rmSync(dirPath, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// discoverModelArtifactPath
// ---------------------------------------------------------------------------

test("discoverModelArtifactPath returns null when no hints and ramalama missing", async () => {
  const result = await discoverModelArtifactPath(
    "huggingface.co/test/nonexistent-model-xyzzy",
    "some random stdout",
    "some random stderr",
  );
  // Should return null because no path hints found and model doesn't exist
  expect(result).toBeNull();
});

test("discoverModelArtifactPath finds path from stdout hint when file exists", async () => {
  await withTempDir(".tmp-artifact-test", async (tmpDir) => {
    const tmpFile = join(tmpDir, "test-model.gguf");
    writeFileSync(tmpFile, "fake model content");
    const result = await discoverModelArtifactPath(
      "test/model",
      `Downloading model...\nStored: ${tmpFile}\nDone.`,
      "",
    );
    expect(result).toBe(tmpFile);
  });
});

test("discoverModelArtifactPath finds .gguf extension from output", async () => {
  await withTempDir(".tmp-artifact-ext-test", async (tmpDir) => {
    const tmpFile = join(tmpDir, "model-7b.gguf");
    writeFileSync(tmpFile, "fake gguf content");
    const result = await discoverModelArtifactPath(
      "test/ext-model",
      "",
      `progress... ${tmpFile} downloaded`,
    );
    expect(result).toBe(tmpFile);
  });
});

test("discoverModelArtifactPath returns null when stdout hints point to non-existent file", async () => {
  const result = await discoverModelArtifactPath(
    "test/missing-artifact",
    "Stored: /tmp/definitely-does-not-exist-model-xyzzy-12345.gguf",
    "",
  );
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// cleanupPartialDownload
// ---------------------------------------------------------------------------

test("cleanupPartialDownload handles missing ramalama gracefully", async () => {
  // This should not throw even if ramalama is not installed
  // (it's best-effort with event logging)
  await cleanupPartialDownload("fake-job-id-cleanup", "test/nonexistent-model");
  // If we reach here without throwing, the test passes
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// computeSha256Hex (now exported)
// ---------------------------------------------------------------------------

test("computeSha256Hex computes correct SHA256 for known content", async () => {
  await withTempDir(".tmp-sha256-test", async (tmpDir) => {
    const tmpFile = join(tmpDir, "sha-test.txt");
    writeFileSync(tmpFile, "hello world");
    const hash = await computeSha256Hex(tmpFile);
    // SHA256 of "hello world" = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});

test("computeSha256Hex returns different hashes for different content", async () => {
  await withTempDir(".tmp-sha256-diff-test", async (tmpDir) => {
    const file1 = join(tmpDir, "file1.txt");
    const file2 = join(tmpDir, "file2.txt");
    writeFileSync(file1, "content-alpha");
    writeFileSync(file2, "content-beta");
    const hash1 = await computeSha256Hex(file1);
    const hash2 = await computeSha256Hex(file2);
    expect(hash1).not.toBe(hash2);
    expect(hash1.length).toBe(64);
    expect(hash2.length).toBe(64);
  });
});
