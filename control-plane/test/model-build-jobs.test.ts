import { expect, test } from "bun:test";
import { initDb } from "../src/db";
import { getAppBuildJobEnvelope, startAppBuildJob } from "../src/app-builds";
import { getModelPullJobEnvelope, startModelPullJob, toRamalamaModelRef } from "../src/model-manager";
import { parseModelPullPayload } from "../src/model-jobs";
import { isFlowCapabilityError } from "../../contracts/flow-contracts";
import { MAX_MODEL_PULL_TIMEOUT_MS, MODEL_SOURCE_REGISTRY } from "../src/config";
import { serializeModelPullPayload } from "../src/model-jobs";

initDb();

test("toRamalamaModelRef translates refs according to configured source transport", () => {
  const sourceConfig = MODEL_SOURCE_REGISTRY.at(0);
  if (!sourceConfig) {
    throw new Error("No model source registry entries are configured.");
  }
  const prefix = sourceConfig.ramalamaTransportPrefix?.trim();
  const transportPrefix = prefix ? (prefix.endsWith("://") ? prefix : `${prefix}://`) : "";
  const sourceId = sourceConfig.id;

  if (!transportPrefix) {
    expect(toRamalamaModelRef("huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual", sourceId))
      .toBe("huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual");
    expect(toRamalamaModelRef("llama3.2", sourceId)).toBe("llama3.2");
    return;
  }

  if (sourceConfig.canonicalHost) {
    const hostRef = `${sourceConfig.canonicalHost}/zai-org/AutoGLM-Phone-9B-Multilingual`;
    expect(toRamalamaModelRef(hostRef, sourceId)).toBe(`${transportPrefix}zai-org/AutoGLM-Phone-9B-Multilingual`);
    expect(toRamalamaModelRef(`${transportPrefix}google/gemma-2`, sourceId)).toBe(`${transportPrefix}google/gemma-2`);
  } else {
    expect(toRamalamaModelRef("llama3.2", sourceId)).toBe(`${transportPrefix}llama3.2`);
    expect(toRamalamaModelRef(`${transportPrefix}custom/repo`, sourceId)).toBe(`${transportPrefix}custom/repo`);
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForModelJobToSettle(jobId: string): Promise<ReturnType<typeof getModelPullJobEnvelope>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const envelope = getModelPullJobEnvelope(jobId);
    if (envelope.state !== "loading") {
      return envelope;
    }
    await sleep(50);
  }
  return getModelPullJobEnvelope(jobId);
}

async function waitForBuildJobToSettle(jobId: string): Promise<ReturnType<typeof getAppBuildJobEnvelope>> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const envelope = getAppBuildJobEnvelope(jobId);
    if (envelope.state !== "loading") {
      return envelope;
    }
    await sleep(100);
  }
  return getAppBuildJobEnvelope(jobId);
}

test("startModelPullJob accepts AutoGLM model refs and returns loading envelope", async () => {
  const envelope = await startModelPullJob({
    modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
    source: "huggingface",
  }, "test");

  expect(envelope.route).toBe("/api/models/pull");
  expect(envelope.state).toBe("loading");
  expect(envelope.jobId.length).toBeGreaterThan(0);
  expect(envelope.data?.normalizedModelRef).toBe("huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual");

  const settled = await waitForModelJobToSettle(envelope.jobId);
  expect(["success", "error-non-retryable", "loading"]).toContain(settled.state);
  if (settled.state === "loading") {
    expect(settled.data?.status === "queued" || settled.data?.status === "running").toBe(true);
    return;
  }
  expect(settled.data?.status === "succeeded" || settled.data?.status === "failed").toBe(true);
  if (settled.error) {
    expect(typeof settled.error.retryable).toBe("boolean");
  }
}, 120000);

test("startModelPullJob rejects unknown source", async () => {
  const failure = await Promise.resolve()
    .then(() => startModelPullJob({
      modelRef: "meta-llama/Llama-3.1-70B",
      source: "openrouter",
    }, "test"))
    .then(
      () => new Error("Expected unknown source to be rejected"),
      (error) => error,
    );

  expect(isFlowCapabilityError(failure)).toBe(true);
  if (isFlowCapabilityError(failure)) {
    expect(failure.surface).toBe("model_pull");
    expect(failure.command).toBe("openrouter");
    expect(failure.reason).toContain("Unknown model source");
    expect(failure.retryable).toBe(false);
  }
});

test("startModelPullJob rejects malformed force", async () => {
  const failure = await Promise.resolve()
    .then(() => startModelPullJob({ modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual", force: 2 as never }, "test"))
    .then(
      () => new Error("Expected malformed force to be rejected"),
      (error) => error,
    );

  expect(isFlowCapabilityError(failure)).toBe(true);
  if (isFlowCapabilityError(failure)) {
    expect(failure.surface).toBe("model_pull");
    expect(failure.command).toBe("force");
    expect(failure.retryable).toBe(false);
  }
});

test("startModelPullJob rejects timeout outside allowed bounds", async () => {
  const failure = await Promise.resolve()
    .then(() => startModelPullJob({ modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual", timeoutMs: MAX_MODEL_PULL_TIMEOUT_MS + 1 }, "test"))
    .then(
      () => new Error("Expected timeoutMs validation to reject oversized values"),
      (error) => error,
    );

  expect(isFlowCapabilityError(failure)).toBe(true);
  if (isFlowCapabilityError(failure)) {
    expect(failure.surface).toBe("model_pull");
    expect(failure.command).toBe("timeoutMs");
    expect(failure.retryable).toBe(false);
  }
});

test("parseModelPullPayload enforces timeout bound", () => {
  const payload = serializeModelPullPayload({
    modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
    normalizedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
    source: "huggingface",
    force: false,
    timeoutMs: MAX_MODEL_PULL_TIMEOUT_MS + 1,
  });

  expect(parseModelPullPayload(payload)).toBeNull();
});

test("parseModelPullPayload rejects unknown source", () => {
  const payload = serializeModelPullPayload({
    modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
    normalizedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
    source: "openrouter",
    force: false,
    timeoutMs: 30_000,
  });

  expect(parseModelPullPayload(payload)).toBeNull();
});

test("startModelPullJob rejects malformed refs as non-retryable", async () => {
  const failure = await Promise.resolve()
    .then(() => startModelPullJob({ modelRef: "../bad/ref" }, "test"))
    .then(
      () => new Error("Expected malformed modelRef to be rejected"),
      (rejection) => rejection,
    );

  expect(isFlowCapabilityError(failure)).toBe(true);
  if (isFlowCapabilityError(failure)) {
    expect(failure.surface).toBe("model_pull");
    expect(failure.retryable).toBe(false);
  }
});

test("startAppBuildJob returns explicit unsupported envelope for iOS on non-mac hosts", async () => {
  if (process.platform === "darwin") {
    return;
  }

  const failure = await Promise.resolve()
    .then(() => startAppBuildJob({ platform: "ios", buildType: "debug" }, "test"))
    .then(
      () => new Error("Expected iOS build to be rejected on non-mac host"),
      (rejection) => rejection,
    );

  expect(isFlowCapabilityError(failure)).toBe(true);
  if (isFlowCapabilityError(failure)) {
    expect(failure.surface).toBe("app_build");
    expect(failure.retryable).toBe(false);
    expect(failure.reason).toContain("macOS");
  }
});

test("startAppBuildJob android path returns loading envelope when Java is available", async () => {
  if (!Bun.which("java")) {
    return;
  }

  const envelope = await startAppBuildJob({ platform: "android", buildType: "debug", skipTests: true }, "test");
  expect(envelope.route).toBe("/api/apps/build");
  expect(envelope.state).toBe("loading");
  expect(envelope.jobId.length).toBeGreaterThan(0);

  const settled = await waitForBuildJobToSettle(envelope.jobId);
  expect(["success", "error-non-retryable", "loading"]).toContain(settled.state);
  if (settled.state === "loading") {
    return;
  }
  if (settled.error) {
    expect(typeof settled.error.retryable).toBe("boolean");
  }
}, 120000);
