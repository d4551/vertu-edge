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
  test("root route renders conversation-first operator workspace", async () => {
    const html = await requestHtml("/");

    expect(html).toContain('id="section-overview"');
    expect(html).toContain('id="floating-chat-form"');
    expect(html).toContain('id="floating-chat-messages"');
    expect(html).toContain('id="operator-runtime-strip"');
    expect(html).toContain('id="overview-summary-grid"');
    expect(html).toContain('id="overview-summary-build"');
    expect(html).toContain('id="overview-summary-readiness"');
    expect(html).toContain('id="overview-summary-automation"');
    expect(html).toContain('id="overview-summary-system"');
    expect(html).toContain("Operator Command Center");
    expect(html).toContain("Configured providers");
    expect(html).not.toContain('id="section-runtime"');
    expect(html).not.toContain('id="section-build"');
    expect(html).not.toContain('id="section-automation"');
    expect(html).not.toContain('id="section-system"');
    expect(html).not.toContain('id="card-app-build"');
    expect(html).not.toContain('id="card-device-readiness"');
    expect(html).not.toContain('id="flow-validate-result"');
    expect(html).toContain("Configure runtime");
    expect(html).toContain("Generate apps");
    expect(html).toContain("Run automation");
  });

  test("section routes render idle state containers for their cards", async () => {
    const runtimeHtml = await requestHtml("/dashboard/runtime");
    expect(runtimeHtml).toContain('id="model-pull-result"');
    expect(runtimeHtml).toContain('id="providers-validation-result"');
    expect(runtimeHtml).toContain('role="status"');
    expect(runtimeHtml).toContain('aria-live="polite"');
    expect(runtimeHtml).toContain("Quick model presets");

    const buildHtml = await requestHtml("/dashboard/build");
    expect(buildHtml).toContain('id="app-build-result"');
    expect(buildHtml).toContain('id="card-device-readiness"');
    expect(buildHtml).toContain('hx-get="/api/device-ai/readiness"');
    expect(buildHtml).toContain('id="device-readiness-result"');
    expect(buildHtml).toContain('id="app-build-platform-android"');
    expect(buildHtml).toContain('id="app-build-platform-ios"');
    expect(buildHtml).toContain('role="radiogroup"');
    expect(buildHtml).toContain('aria-describedby="app-build-platform-hint"');

    const automationHtml = await requestHtml("/dashboard/automation");
    expect(automationHtml).toContain('id="flow-validate-result"');
    expect(automationHtml).toContain('id="flow-target-android"');
    expect(automationHtml).toContain('id="flow-target-ios"');
    expect(automationHtml).toContain('id="flow-target-runtime-hint"');
  });

  test("dashboard renders sidebar tab navigation with ARIA attributes", async () => {
    const html = await requestHtml("/");

    // Sidebar nav links with HTMX attributes
    expect(html).toContain('hx-get="/dashboard/overview"');
    expect(html).toContain('hx-get="/dashboard/runtime"');
    expect(html).toContain('hx-get="/dashboard/build"');
    expect(html).toContain('hx-get="/dashboard/automation"');
    expect(html).toContain('hx-get="/dashboard/system"');
    expect(html).toContain('hx-target="#main-content"');
    expect(html).toContain('hx-push-url="true"');

    // Active section has aria-current
    expect(html).toContain('aria-current="page"');
  });

  test("dashboard renders mobile dock navigation", async () => {
    const html = await requestHtml("/");

    // Dock nav element
    expect(html).toContain('class="dock');
    expect(html).toContain('lg:hidden');
  });

  test("section routes render card sections as semantic <section> elements", async () => {
    const runtimeHtml = await requestHtml("/dashboard/runtime");
    expect(runtimeHtml).toContain('aria-labelledby="heading-models"');

    const buildHtml = await requestHtml("/dashboard/build");
    expect(buildHtml).toContain('aria-labelledby="heading-app-build"');
    expect(buildHtml).toContain('aria-labelledby="heading-device-readiness"');

    const systemHtml = await requestHtml("/dashboard/system");
    expect(systemHtml).toContain('aria-labelledby="heading-preferences"');
    expect(systemHtml).toContain('id="ucp-discovery-collapse"');
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
          code: "app_build_ios_tooling_missing",
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
    expect(nonRetryableHtml).toContain("Xcode build tooling is required to build the iOS app on this host.");
  });
});
