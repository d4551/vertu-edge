import { describe, expect, test } from "bun:test";
import {
  type AppBuildEnvelope,
  type ModelPullEnvelope,
  type ModelPullRequest,
  createFlowCapabilityError,
} from "../../contracts/flow-contracts";
import { createControlPlaneApp, type ControlPlaneServices } from "../src/app";
import { initDb } from "../src/db";

initDb();

function createStateServices(overrides: Partial<ControlPlaneServices> = {}): ControlPlaneServices {
  return {
    startModelPullJob: async (): Promise<ModelPullEnvelope> => ({
      route: "/api/models/pull",
      state: "success",
      jobId: "model-success",
      data: {
        requestedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        normalizedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        status: "succeeded",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        artifactPath: null,
        elapsedMs: 101,
      },
      mismatches: [],
    }),
    getModelPullJobEnvelope: (): ModelPullEnvelope => ({
      route: "/api/models/pull",
      state: "success",
      jobId: "model-success",
      data: {
        requestedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        normalizedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        status: "succeeded",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        artifactPath: null,
        elapsedMs: 101,
      },
      mismatches: [],
    }),
    startAppBuildJob: async (): Promise<AppBuildEnvelope> => ({
      route: "/api/apps/build",
      state: "success",
      jobId: "build-success",
      data: {
        platform: "android",
        buildType: "debug",
        status: "succeeded",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        artifactPath: "/tmp/app-debug.apk",
        elapsedMs: 202,
      },
      mismatches: [],
    }),
    getAppBuildJobEnvelope: (): AppBuildEnvelope => ({
      route: "/api/apps/build",
      state: "success",
      jobId: "build-success",
      data: {
        platform: "android",
        buildType: "debug",
        status: "succeeded",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        artifactPath: "/tmp/app-debug.apk",
        elapsedMs: 202,
      },
      mismatches: [],
    }),
    ...overrides,
  };
}

async function requestHtml(path: string, init?: RequestInit, services?: Partial<ControlPlaneServices>): Promise<string> {
  const app = createControlPlaneApp({ services: createStateServices(services) });
  const response = await app.handle(new Request(`http://localhost${path}`, init));
  expect(response.status).toBe(200);
  return response.text();
}

describe("UI state machine: model pull + app build", () => {
  test("dashboard renders idle state containers for model/build cards", async () => {
    const html = await requestHtml("/");

    expect(html).toContain('id="model-pull-result"');
    expect(html).toContain('id="app-build-result"');
    expect(html).toContain('id="providers-validation-result"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="flow-validate-result"');
    expect(html).toContain("Quick model presets");
  });

  test("model pull route renders loading state", async () => {
    const html = await requestHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "zai-org/AutoGLM-Phone-9B-Multilingual" }),
    }, {
      startModelPullJob: async (request: ModelPullRequest): Promise<ModelPullEnvelope> => ({
        route: "/api/models/pull",
        state: "loading",
        jobId: "model-loading",
        data: {
          requestedModelRef: request.modelRef ?? "zai-org/AutoGLM-Phone-9B-Multilingual",
          normalizedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
          status: "running",
          exitCode: null,
          stdout: "",
          stderr: "",
          artifactPath: null,
          elapsedMs: 10,
        },
        mismatches: ["model pull is in progress"],
      }),
    });

    expect(html).toContain('data-state="loading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  test("model pull route renders retryable-error and non-retryable-error states", async () => {
    const retryableHtml = await requestHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "zai-org/AutoGLM-Phone-9B-Multilingual" }),
    }, {
      startModelPullJob: async (): Promise<ModelPullEnvelope> => {
        throw createFlowCapabilityError({
          commandIndex: -1,
          command: "ramalama",
          reason: "temporary network timeout",
          retryable: true,
          surface: "model_pull",
        });
      },
    });

    const nonRetryableHtml = await requestHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "../bad/ref" }),
    }, {
      startModelPullJob: async (): Promise<ModelPullEnvelope> => {
        throw createFlowCapabilityError({
          commandIndex: -1,
          command: "modelRef",
          reason: "invalid model reference",
          retryable: false,
          surface: "model_pull",
        });
      },
    });

    expect(retryableHtml).toContain('data-state="error-retryable"');
    expect(nonRetryableHtml).toContain('data-state="error-non-retryable"');
  });

  test("app build route renders loading/success/retryable/non-retryable states", async () => {
    const loadingHtml = await requestHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "android", buildType: "debug" }),
    }, {
      startAppBuildJob: async (): Promise<AppBuildEnvelope> => ({
        route: "/api/apps/build",
        state: "loading",
        jobId: "build-loading",
        data: {
          platform: "android",
          buildType: "debug",
          status: "running",
          exitCode: null,
          stdout: "",
          stderr: "",
          artifactPath: null,
          elapsedMs: 12,
        },
        mismatches: ["build in progress"],
      }),
    });

    const successHtml = await requestHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "android", buildType: "debug" }),
    });

    const retryableHtml = await requestHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "android", buildType: "debug" }),
    }, {
      startAppBuildJob: async (): Promise<AppBuildEnvelope> => {
        throw createFlowCapabilityError({
          commandIndex: -1,
          command: "build",
          reason: "temporary build queue saturation",
          retryable: true,
          surface: "app_build",
        });
      },
    });

    const nonRetryableHtml = await requestHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "android", buildType: "debug" }),
    }, {
      startAppBuildJob: async (): Promise<AppBuildEnvelope> => {
        throw createFlowCapabilityError({
          commandIndex: -1,
          command: "platform",
          reason: "missing toolchain",
          retryable: false,
          surface: "app_build",
        });
      },
    });

    expect(loadingHtml).toContain('data-state="loading"');
    expect(successHtml).toContain('data-state="success"');
    expect(retryableHtml).toContain('data-state="error-retryable"');
    expect(nonRetryableHtml).toContain('data-state="error-non-retryable"');
  });
});
