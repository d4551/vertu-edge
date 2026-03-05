import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseArtifactMetadata, verifyArtifactMetadata } from "../src/artifact-metadata";

function createFixtureArtifact(): string {
  const folder = mkdtempSync(join(tmpdir(), "vertu-artifact-test-"));
  const artifactPath = join(folder, "artifact.bin");
  writeFileSync(artifactPath, "artifacts");
  return artifactPath;
}

function cleanupFixture(artifactPath: string): void {
  const artifactDir = join(artifactPath, "..");
  rmSync(artifactDir, { recursive: true, force: true });
}

describe("artifact metadata parsing", () => {
  test("parses complete JSON metadata and verifies integrity", async () => {
    const artifactPath = createFixtureArtifact();
    const content = "artifacts";
    const sha256 = createHash("sha256").update(content).digest("hex");
    const sizeBytes = Buffer.byteLength(content);
    const createdAt = "2026-03-04T12:00:00.000Z";

    const metadataPayload = JSON.stringify({
      artifactPath,
      sha256,
      sizeBytes,
      createdAt,
      contentType: "application/vnd.android.package-archive",
      signature: "sig",
      correlationId: "corr-123",
    });

    const metadata = parseArtifactMetadata(`ARTIFACT_METADATA_JSON=${metadataPayload}`, "", null, undefined);
    expect(metadata).not.toBeNull();
    expect(metadata?.artifactPath).toBe(artifactPath);
    const integrity = await verifyArtifactMetadata(metadata);
    expect(integrity).toEqual({ ok: true });
    cleanupFixture(artifactPath);
  });

  test("returns null when output fields are missing", () => {
    const artifactPath = createFixtureArtifact();
    const metadata = parseArtifactMetadata("ARTIFACT_PATH=/tmp/missing.apk\n", "", null, undefined);
    expect(metadata).toBeNull();
    cleanupFixture(artifactPath);
  });

  test("flags integrity mismatch when file cannot be found", async () => {
    const metadata = parseArtifactMetadata(
      "ARTIFACT_PATH=/tmp/does-not-exist.apk\nARTIFACT_SHA256=00\nARTIFACT_SIZE_BYTES=1\nARTIFACT_CREATED_AT=2026-03-04T12:00:00.000Z\nARTIFACT_CONTENT_TYPE=application/vnd.android.package-archive",
      "",
      null,
      "corr",
    );
    const integrity = await verifyArtifactMetadata(metadata);
    expect(integrity).toEqual({ ok: false, reason: "Build artifact metadata is missing." });
  });

  test("flags checksum mismatch when sha256 does not match", async () => {
    const artifactPath = createFixtureArtifact();
    const content = "artifacts";
    const sizeBytes = Buffer.byteLength(content);
    const createdAt = "2026-03-04T12:00:00.000Z";
    const metadata = parseArtifactMetadata(
      `ARTIFACT_PATH=${artifactPath}\nARTIFACT_SHA256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\nARTIFACT_SIZE_BYTES=${sizeBytes}\nARTIFACT_CREATED_AT=${createdAt}\nARTIFACT_CONTENT_TYPE=application/vnd.android.package-archive`,
      "",
      null,
      "corr",
    );
    const integrity = await verifyArtifactMetadata(metadata);
    expect(integrity.ok).toBe(false);
    if (!integrity.ok) {
      expect(integrity.reason).toContain("checksum mismatch");
    }
    cleanupFixture(artifactPath);
  });
});
