import { expect, test } from "bun:test";
import {
  createCapabilityJob,
  createLocalModel,
  deleteLocalModel,
  getLocalModel,
  getLocalModelByRef,
  initDb,
  listLocalModels,
  updateLocalModelLastUsed,
} from "../src/db";
import {
  checkDiskSpace,
  deleteModel,
  getModelInventory,
} from "../src/model-manager";

initDb();

// ---------------------------------------------------------------------------
// local_models CRUD
// ---------------------------------------------------------------------------

test("createLocalModel inserts a new model and returns an id", () => {
  const id = createLocalModel({
    modelRef: "owner/test-model-1",
    normalizedRef: "huggingface.co/owner/test-model-1",
    source: "huggingface",
  });
  expect(id).toBeTruthy();
  expect(typeof id).toBe("string");

  const model = getLocalModel(id);
  expect(model).not.toBeNull();
  expect(model!.modelRef).toBe("owner/test-model-1");
  expect(model!.normalizedRef).toBe("huggingface.co/owner/test-model-1");
  expect(model!.source).toBe("huggingface");
  expect(model!.pulledAt).toBeTruthy();
});

test("createLocalModel performs upsert on matching normalizedRef + source", () => {
  const ref = `huggingface.co/owner/upsert-model-${crypto.randomUUID().slice(0, 8)}`;
  const id1 = createLocalModel({
    modelRef: "owner/upsert-model",
    normalizedRef: ref,
    source: "huggingface",
    sha256: "aaaa",
  });

  // Second create with same normalizedRef should update, not create new
  const id2 = createLocalModel({
    modelRef: "owner/upsert-model",
    normalizedRef: ref,
    source: "huggingface",
    sha256: "bbbb",
    sizeBytes: 1024,
  });

  expect(id2).toBe(id1);
  const model = getLocalModel(id1);
  expect(model!.sha256).toBe("bbbb");
  expect(model!.sizeBytes).toBe(1024);
});

test("createLocalModel with different source creates a new record", () => {
  const ref = `huggingface.co/owner/multi-source-${crypto.randomUUID().slice(0, 8)}`;
  const id1 = createLocalModel({
    modelRef: "owner/multi-source",
    normalizedRef: ref,
    source: "huggingface",
  });
  const id2 = createLocalModel({
    modelRef: "owner/multi-source",
    normalizedRef: ref,
    source: "ollama",
  });
  expect(id1).not.toBe(id2);
});

test("getLocalModel returns null for missing id", () => {
  const result = getLocalModel("nonexistent-id-12345");
  expect(result).toBeNull();
});

test("getLocalModelByRef finds model by normalized reference", () => {
  const ref = `huggingface.co/owner/by-ref-${crypto.randomUUID().slice(0, 8)}`;
  createLocalModel({
    modelRef: "owner/by-ref",
    normalizedRef: ref,
    source: "huggingface",
    pipelineTag: "text-generation",
  });
  const found = getLocalModelByRef(ref);
  expect(found).not.toBeNull();
  expect(found!.normalizedRef).toBe(ref);
  expect(found!.pipelineTag).toBe("text-generation");
});

test("getLocalModelByRef returns null for unknown ref", () => {
  const result = getLocalModelByRef("unknown-ref-xyz");
  expect(result).toBeNull();
});

test("listLocalModels returns all registered models ordered by pulledAt desc", () => {
  const models = listLocalModels();
  expect(Array.isArray(models)).toBe(true);
  // All previously created test models should be listed
  expect(models.length).toBeGreaterThanOrEqual(1);

  // Verify ordering: newest first
  for (let i = 1; i < models.length; i++) {
    expect(models[i - 1]!.pulledAt >= models[i]!.pulledAt).toBe(true);
  }
});

test("deleteLocalModel removes model and returns true", () => {
  const ref = `huggingface.co/owner/delete-me-${crypto.randomUUID().slice(0, 8)}`;
  const id = createLocalModel({
    modelRef: "owner/delete-me",
    normalizedRef: ref,
    source: "huggingface",
  });
  expect(getLocalModel(id)).not.toBeNull();

  const deleted = deleteLocalModel(id);
  expect(deleted).toBe(true);
  expect(getLocalModel(id)).toBeNull();
});

test("deleteLocalModel returns false for missing id", () => {
  const deleted = deleteLocalModel("nonexistent-id-xyz");
  expect(deleted).toBe(false);
});

test("updateLocalModelLastUsed updates the timestamp", () => {
  const ref = `huggingface.co/owner/last-used-${crypto.randomUUID().slice(0, 8)}`;
  const id = createLocalModel({
    modelRef: "owner/last-used",
    normalizedRef: ref,
    source: "huggingface",
  });
  const before = getLocalModel(id);
  expect(before!.lastUsedAt).toBeNull();

  updateLocalModelLastUsed(id);
  const after = getLocalModel(id);
  expect(after!.lastUsedAt).not.toBeNull();
  expect(typeof after!.lastUsedAt).toBe("string");
});

test("createLocalModel stores optional metadata fields", () => {
  // Create a real job to satisfy FK constraint
  const pullJobId = createCapabilityJob({
    kind: "model_pull",
    requestedPayload: "test-payload",
  });
  const ref = `huggingface.co/owner/full-meta-${crypto.randomUUID().slice(0, 8)}`;
  const id = createLocalModel({
    modelRef: "owner/full-meta",
    normalizedRef: ref,
    source: "huggingface",
    artifactPath: "/tmp/model.gguf",
    sha256: "abc123",
    sizeBytes: 4096,
    pipelineTag: "text-generation",
    capabilities: JSON.stringify(["chat", "completion"]),
    tags: JSON.stringify(["llama", "gguf"]),
    pullJobId,
  });

  const model = getLocalModel(id);
  expect(model!.artifactPath).toBe("/tmp/model.gguf");
  expect(model!.sha256).toBe("abc123");
  expect(model!.sizeBytes).toBe(4096);
  expect(model!.pipelineTag).toBe("text-generation");
  expect(JSON.parse(model!.capabilities!)).toEqual(["chat", "completion"]);
  expect(JSON.parse(model!.tags!)).toEqual(["llama", "gguf"]);
  expect(model!.pullJobId).toBe(pullJobId);
});

// ---------------------------------------------------------------------------
// checkDiskSpace
// ---------------------------------------------------------------------------

test("checkDiskSpace returns ok=true on normal system", async () => {
  const result = await checkDiskSpace();
  // On a normal dev machine, disk space should be sufficient
  expect(result.ok).toBe(true);
  expect(typeof result.freeBytes).toBe("number");
});

// ---------------------------------------------------------------------------
// deleteModel (model-manager)
// ---------------------------------------------------------------------------

test("deleteModel returns ok=false for nonexistent model", async () => {
  const result = await deleteModel("nonexistent-model-id-abc");
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("not found");
});

test("deleteModel removes model from inventory", async () => {
  const ref = `huggingface.co/owner/to-delete-${crypto.randomUUID().slice(0, 8)}`;
  const id = createLocalModel({
    modelRef: "owner/to-delete",
    normalizedRef: ref,
    source: "huggingface",
  });
  expect(getLocalModel(id)).not.toBeNull();

  const result = await deleteModel(id);
  expect(result.ok).toBe(true);
  expect(getLocalModel(id)).toBeNull();
});

// ---------------------------------------------------------------------------
// getModelInventory
// ---------------------------------------------------------------------------

test("getModelInventory returns array of models", () => {
  const inventory = getModelInventory();
  expect(Array.isArray(inventory)).toBe(true);
});
