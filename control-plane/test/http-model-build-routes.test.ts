import { describe, expect, test } from "bun:test";
import {
  type FlowRunResult,
  type FlowRunJobEnvelope,
  type AppBuildEnvelope,
  type AppBuildRequest,
  type AiWorkflowCapabilityEnvelope,
  type AiWorkflowJobEnvelope,
  type AiWorkflowRequest,
  type DeviceAiReadinessEnvelope,
  type ModelPullEnvelope,
  type ModelPullRequest,
  type FlowRunLogEvent,
  type ModelSourceRegistryEnvelope,
  createFlowCapabilityError,
} from "../../contracts/flow-contracts";
import { type UCPDiscoverResponse } from "../../contracts/ucp-contracts";
import { createControlPlaneApp, type ControlPlaneServices } from "../src/app";
import { startAppBuildJob } from "../src/app-builds";
import { initDb } from "../src/db";
import { deleteApiKey, getApiKey } from "../src/ai-keys";
import { MAX_MODEL_PULL_TIMEOUT_MS } from "../src/config";
import { API_HEALTH_ROUTE } from "../src/runtime-constants";

initDb();

async function withEncryptionKey<T>(key: string | undefined, action: () => Promise<T>): Promise<T> {
  const previous = process.env.VERTU_ENCRYPTION_KEY;
  if (key === undefined) {
    delete process.env.VERTU_ENCRYPTION_KEY;
  } else {
    process.env.VERTU_ENCRYPTION_KEY = key;
  }
  return action().finally(() => {
    if (previous === undefined) {
      delete process.env.VERTU_ENCRYPTION_KEY;
    } else {
      process.env.VERTU_ENCRYPTION_KEY = previous;
    }
  });
}

function buildModelLoadingEnvelope(request: ModelPullRequest): ModelPullEnvelope {
  const requestedModelRef = request.modelRef ?? "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual";
  const normalizedModelRef = request.modelRef ?? requestedModelRef;
  return {
    route: "/api/models/pull",
    state: "loading",
    jobId: "model-job-queued",
    data: {
      requestedModelRef,
      normalizedModelRef,
      status: "queued",
      exitCode: null,
      stdout: "",
      stderr: "",
      artifactPath: null,
      elapsedMs: 0,
    },
    mismatches: [],
  };
}

function buildModelSuccessEnvelope(jobId: string): ModelPullEnvelope {
  return {
    route: "/api/models/pull",
    state: "success",
    jobId,
    data: {
      requestedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
      normalizedModelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
      status: "succeeded",
      exitCode: 0,
      stdout: "pull complete",
      stderr: "",
      artifactPath: null,
      elapsedMs: 321,
    },
    mismatches: [],
  };
}

function buildAppLoadingEnvelope(request: AppBuildRequest): AppBuildEnvelope {
  return {
    route: "/api/apps/build",
    state: "loading",
    jobId: "app-build-queued",
    data: {
      platform: request.platform,
      buildType: request.buildType ?? "debug",
      status: "queued",
      exitCode: null,
      stdout: "",
      stderr: "",
      artifactPath: null,
      elapsedMs: 0,
      variant: request.variant,
    },
    mismatches: [],
  };
}

function buildAppSuccessEnvelope(jobId: string): AppBuildEnvelope {
  return {
    route: "/api/apps/build",
    state: "success",
    jobId,
    data: {
      platform: "android",
      buildType: "debug",
      status: "succeeded",
      exitCode: 0,
      stdout: "build complete\nARTIFACT_PATH=/tmp/app-debug.apk",
      stderr: "",
      artifactPath: "/tmp/app-debug.apk",
      elapsedMs: 1234,
    },
    mismatches: [],
  };
}

function buildAppFailureEnvelope(jobId: string): AppBuildEnvelope {
  return {
    route: "/api/apps/build",
    state: "error-non-retryable",
    jobId,
    data: {
      platform: "ios",
      buildType: "debug",
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "APP_BUILD_FAILURE_CODE=ios_platform_support_missing\nAPP_BUILD_FAILURE_MESSAGE=Missing iOS simulator platform support for scheme VertuEdgeHost.",
      artifactPath: null,
      elapsedMs: 456,
      failureCode: "ios_platform_support_missing",
      failureMessage: "Missing iOS simulator platform support for scheme VertuEdgeHost.",
    },
    mismatches: ["app build failed for ios"],
    error: createFlowCapabilityError({
      commandIndex: -1,
      command: "ios",
      code: "ios_platform_support_missing",
      reason: "app build failed for ios",
      retryable: false,
      surface: "app_build",
      resource: "ios",
    }),
  };
}

function buildFlowRunResult(): FlowRunResult {
  return {
    state: "error-retryable",
    appId: "com.vertu.edge",
    commandCount: 1,
    target: "android",
    policy: {
      maxAttempts: 2,
      commandTimeoutMs: 15000,
      retryDelayMs: 500,
    },
    actions: [
      {
        commandIndex: 0,
        commandType: "launchApp",
        target: "android",
        attempts: [
          {
            commandIndex: 0,
            attempt: 1,
            state: "error",
            message: "intermittent network failure",
            startedAt: "2026-03-01T00:00:00.000Z",
            endedAt: "2026-03-01T00:00:00.120Z",
            durationMs: 120,
            error: createFlowCapabilityError({
              commandIndex: 0,
              command: "launchApp",
              commandType: "launchApp",
              reason: "intermittent network failure",
              retryable: true,
              surface: "flow",
            }),
          },
          {
            commandIndex: 0,
            attempt: 2,
            state: "error",
            message: "intermittent network failure",
            startedAt: "2026-03-01T00:00:00.120Z",
            endedAt: "2026-03-01T00:00:00.220Z",
            durationMs: 100,
            error: createFlowCapabilityError({
              commandIndex: 0,
              command: "launchApp",
              commandType: "launchApp",
              reason: "intermittent network failure",
              retryable: true,
              surface: "flow",
            }),
          },
        ],
      },
    ],
    results: [
      {
        commandIndex: 0,
        commandType: "launchApp",
        attempts: 2,
        state: "error",
        message: "intermittent network failure",
        error: createFlowCapabilityError({
          commandIndex: 0,
          command: "launchApp",
          commandType: "launchApp",
          reason: "intermittent network failure",
          retryable: true,
          surface: "flow",
        }),
      },
    ],
    durationMs: 220,
  };
}

function buildFlowRunJobEnvelope(status: "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled"): FlowRunJobEnvelope {
  return {
    route: "/api/flows/runs",
    runId: "flow-run-123",
    state: status === "succeeded" ? "success" : (status === "queued" || status === "running" || status === "paused" ? "loading" : "error-non-retryable"),
    data: {
      runId: "flow-run-123",
      status,
      correlationId: "corr-flow-123",
      stdout: "",
      stderr: status === "failed" ? "run failed" : "",
      elapsedMs: 500,
      result: status === "succeeded" ? {
        appId: "com.vertu.edge",
        commandCount: 1,
        target: "android",
        state: "success",
        durationMs: 500,
        actions: [{
          commandIndex: 0,
          commandType: "launchApp",
          target: "android",
          attempts: [{
            commandIndex: 0,
            attempt: 1,
            state: "success",
            message: "launchApp executed",
            startedAt: "2026-03-01T00:00:00.000Z",
            endedAt: "2026-03-01T00:00:00.100Z",
            durationMs: 100,
          }],
        }],
        results: [{
          commandIndex: 0,
          commandType: "launchApp",
          state: "success",
          message: "launchApp executed",
          attempts: 1,
        }],
      } : undefined,
    },
    mismatches: [],
  };
}

function buildFlowRunEvents(): readonly FlowRunLogEvent[] {
  return [
    {
      id: "evt-1",
      level: "info",
      timestamp: "2026-03-01T00:00:00.000Z",
      message: "Flow execution started",
      commandIndex: 0,
    },
    {
      id: "evt-2",
      level: "info",
      timestamp: "2026-03-01T00:00:00.100Z",
      message: "Flow run succeeded",
    },
  ];
}

function buildAiWorkflowJobEnvelope(status: "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled"): AiWorkflowJobEnvelope {
  return {
    route: "/api/ai/workflows/jobs",
    jobId: "wf-job-123",
    state: status === "succeeded" ? "success" : (status === "queued" || status === "running" || status === "paused" ? "loading" : "error-non-retryable"),
    data: {
      jobId: "wf-job-123",
      status,
      correlationId: "corr-wf-123",
      stdout: status === "succeeded" ? "ok" : "",
      stderr: status === "failed" ? "workflow failed" : "",
      elapsedMs: 420,
      result: status === "succeeded"
        ? {
          mode: "typography",
          requestedProvider: "ollama",
          providerPath: "local:ollama",
          requestedModel: "llama3.2",
          effectiveModel: "llama3.2",
          reply: "Typography direction output",
        }
        : undefined,
    },
    mismatches: [],
  };
}

function buildAiWorkflowCapabilitiesEnvelope(): AiWorkflowCapabilityEnvelope {
  return {
    route: "/api/ai/workflows/capabilities",
    state: "success",
    data: {
      modes: [
        { mode: "chat", localAvailable: true, remoteAvailable: false },
        { mode: "typography", localAvailable: true, remoteAvailable: true },
        { mode: "presentation", localAvailable: true, remoteAvailable: true },
        { mode: "social", localAvailable: true, remoteAvailable: true },
        { mode: "image", localAvailable: false, remoteAvailable: true, reason: "local unavailable" },
      ],
    },
    mismatches: [],
  };
}

function buildDeviceAiReadinessEnvelope(status: "ready" | "blocked" | "skipped" | "delegated"): DeviceAiReadinessEnvelope {
  return {
    route: "/api/device-ai/readiness",
    state: status === "ready" ? "success" : (status === "blocked" ? "error-non-retryable" : "empty"),
    data: {
      status,
      hostOs: "Darwin",
      shouldRun: status === "ready" || status === "blocked",
      delegated: status === "delegated",
      requirements: [
        { code: "hf_token", required: true, satisfied: status !== "blocked" },
        { code: "android_adb", required: true, satisfied: true },
        { code: "ios_macos_host", required: true, satisfied: true },
        { code: "ios_xcrun", required: true, satisfied: true },
        { code: "ios_simctl", required: true, satisfied: true },
      ],
      failures: status === "blocked"
        ? ["HF_TOKEN or HUGGINGFACE_HUB_TOKEN is required for the mandatory Hugging Face runtime probe."]
        : [],
      buildArtifacts: {
        android: { platform: "android", status: "pass", artifactPath: "/tmp/app-debug.apk" },
        ios: status === "blocked"
          ? {
            platform: "ios",
            status: "fail",
            failureCode: "ios_platform_support_missing",
            failureMessage: "Missing iOS simulator platform support for scheme VertuEdgeHost.",
          }
          : { platform: "ios", status: "pass", artifactPath: "/tmp/VertuEdgeHost.zip" },
      },
    },
    ...(status === "blocked"
      ? { mismatches: ["HF_TOKEN or HUGGINGFACE_HUB_TOKEN is required for the mandatory Hugging Face runtime probe."] }
      : {}),
  };
}

function createDeterministicServices(overrides: Partial<ControlPlaneServices> = {}): ControlPlaneServices {
  return {
    startModelPullJob: async (request: ModelPullRequest): Promise<ModelPullEnvelope> => buildModelLoadingEnvelope(request),
    getModelPullJobEnvelope: (jobId: string): ModelPullEnvelope => buildModelSuccessEnvelope(jobId),
    startAppBuildJob: async (request: AppBuildRequest): Promise<AppBuildEnvelope> => {
      if (request.platform === "ios" && process.platform !== "darwin") {
        throw createFlowCapabilityError({
          commandIndex: -1,
          command: "platform",
          code: "app_build_ios_mac_only",
          reason: "iOS build is only supported on macOS hosts.",
          retryable: false,
          surface: "app_build",
          resource: "ios",
        });
      }
      return buildAppLoadingEnvelope(request);
    },
    getAppBuildJobEnvelope: (jobId: string): AppBuildEnvelope => buildAppSuccessEnvelope(jobId),
    startAiWorkflowJob: (_request: AiWorkflowRequest): AiWorkflowJobEnvelope => buildAiWorkflowJobEnvelope("queued"),
    getAiWorkflowJobEnvelope: (_jobId: string): AiWorkflowJobEnvelope => buildAiWorkflowJobEnvelope("succeeded"),
    getAiWorkflowJobLogEvents: () => [],
    getAiWorkflowCapabilityEnvelope: async () => buildAiWorkflowCapabilitiesEnvelope(),
    resolveDeviceAiReadinessEnvelope: () => buildDeviceAiReadinessEnvelope("ready"),
    ...overrides,
  };
}

async function readHtml(path: string, init?: RequestInit, services?: Partial<ControlPlaneServices>): Promise<string> {
  const app = createControlPlaneApp({ services: createDeterministicServices(services) });
  const request = new Request(`http://localhost${path}`, init);
  const response = await app.handle(request);
  expect(response.status).toBe(200);
  return response.text();
}

async function readDiscoverJson(
  path: string,
  init?: RequestInit,
  services?: Partial<ControlPlaneServices>,
): Promise<UCPDiscoverResponse> {
  const app = createControlPlaneApp({ services: createDeterministicServices(services) });
  const request = new Request(`http://localhost${path}`, init);
  const response = await app.handle(request);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
  return (await response.json()) as UCPDiscoverResponse;
}

import { withMockedFetch, type FetchLike } from "./_helpers";

const validUcpManifestResponse = {
  ucp: {
    version: "2026-01-11",
    services: {
      "dev.ucp.shopping": {
        version: "2026-01-11",
        spec: "https://ucp.dev/specification/overview",
        rest: {
          schema: "https://ucp.dev/services/shopping/rest.openapi.json",
          endpoint: "https://business.example.com/ucp/v1",
        },
      },
    },
    capabilities: [
      {
        name: "dev.ucp.shopping.checkout",
        version: "2026-01-11",
        spec: "https://ucp.dev/specification/checkout",
        schema: "https://ucp.dev/schemas/shopping/checkout.json",
      },
    ],
  },
};

const validUcpPaymentsManifestResponse = {
  ...validUcpManifestResponse,
  payment: {
    handlers: [
      {
        id: "com.google.pay",
        name: "gpay",
        version: "2024-12-03",
        spec: "https://developers.google.com/merchant/ucp/guides/gpay-payment-handler",
        config_schema: "https://pay.google.com/gp/p/ucp/2026-01-11/schemas/gpay_config.json",
        instrument_schemas: [
          "https://pay.google.com/gp/p/ucp/2026-01-11/schemas/gpay_card_payment_instrument.json",
        ],
      },
    ],
  },
};

describe("Dashboard section fragment routes", () => {
  test("GET /dashboard/runtime with HX-Request returns fragment (no <html>)", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/runtime", {
      headers: { "hx-request": "true" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('id="section-runtime"');
    expect(html).not.toContain("<!DOCTYPE html>");
    expect(html).not.toContain("<html");
  });

  test("GET /dashboard/runtime without HX-Request returns full page", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/runtime"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="section-runtime"');
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("GET /dashboard/build returns build section fragment", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/build", {
      headers: { "hx-request": "true" },
    }));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="section-build"');
    expect(html).not.toContain("<!DOCTYPE html>");
  });

  test("GET /dashboard/automation returns automation section fragment", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/automation", {
      headers: { "hx-request": "true" },
    }));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="section-automation"');
  });

  test("GET /dashboard/system returns system section fragment", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/system", {
      headers: { "hx-request": "true" },
    }));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="section-system"');
  });

  test("GET /dashboard/overview returns overview section fragment", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/overview", {
      headers: { "hx-request": "true" },
    }));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="section-overview"');
  });

  test("GET /dashboard/invalid returns 404", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/dashboard/invalid", {
      headers: { "hx-request": "true" },
    }));
    expect(response.status).toBe(404);
  });
});

describe("HTTP model/build capability routes", () => {
  test("GET /api/health returns JSON readiness payload", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request(`http://localhost${API_HEALTH_ROUTE}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const payload = await response.json() as { route: string; status: string };
    expect(payload.route).toBe(API_HEALTH_ROUTE);
    expect(payload.status).toBe("ok");
  });

  test("unknown route returns 404 envelope instead of 500", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/api/not-a-route"));
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("not-a-route");
  });

  test("POST /api/models/pull returns loading envelope for AutoGLM request", async () => {
    const html = await readHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual", source: "huggingface" }),
    });

    expect(html).toContain('data-state="loading"');
    expect(html).toContain("Job ID: model-job-queued");
    expect(html).toContain("Normalized model: huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual");
  });

  test("GET /api/models/sources returns registry envelope", async () => {
    const app = createControlPlaneApp({ services: createDeterministicServices() });
    const response = await app.handle(new Request("http://localhost/api/models/sources"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const envelope = (await response.json()) as ModelSourceRegistryEnvelope;
    expect(envelope.route).toBe("/api/models/sources");
    expect(["success", "empty"]).toContain(envelope.state);
    expect(envelope.data?.defaultSource?.length).toBeGreaterThan(0);
    expect((envelope.data?.sources?.length ?? 0) > 0).toBe(true);
    expect(envelope.data?.sources.some((source) => source.id === "huggingface")).toBe(true);
  });

  test("POST /api/models/pull rejects unknown source", async () => {
    let startModelPullCalled = false;
    const html = await readHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "meta-llama/Llama-3.1-70B", source: "openrouter" }),
    }, {
      startModelPullJob: async (request: ModelPullRequest): Promise<ModelPullEnvelope> => {
        startModelPullCalled = true;
        return {
          route: "/api/models/pull",
          state: "loading",
          jobId: "model-job-queued",
          data: {
            requestedModelRef: request.modelRef ?? "",
            normalizedModelRef: request.modelRef ?? "",
            status: "queued",
            exitCode: null,
            stdout: "",
            stderr: "",
            artifactPath: null,
            elapsedMs: 0,
          },
          mismatches: [],
        };
      },
    });

    expect(startModelPullCalled).toBe(false);
    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("Unknown model source");
    expect(html).toContain("retryable&quot;:false");
  });

  test("POST /api/models/pull validates source aliases when known", async () => {
    let capturedSource: string | undefined;
    const html = await readHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual", source: "hf" }),
    }, {
      startModelPullJob: async (request: ModelPullRequest): Promise<ModelPullEnvelope> => {
        capturedSource = request.source;
        return {
          route: "/api/models/pull",
          state: "loading",
          jobId: "model-job-queued",
          data: {
            requestedModelRef: request.modelRef ?? "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
            normalizedModelRef: request.modelRef ?? "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
            status: "queued",
            exitCode: null,
            stdout: "",
            stderr: "",
            artifactPath: null,
            elapsedMs: 0,
          },
          mismatches: [],
        };
      },
    });

    expect(capturedSource).toBe("huggingface");
    expect(html).toContain("data-state=\"loading\"");
  });

  test("POST /api/models/pull malformed ref renders non-retryable envelope", async () => {
    const html = await readHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "../bad/ref", source: "huggingface" }),
    }, {
      startModelPullJob: async (): Promise<ModelPullEnvelope> => {
        throw createFlowCapabilityError({
          commandIndex: -1,
          command: "../bad/ref",
          reason: "Invalid model reference.",
          retryable: false,
          surface: "model_pull",
        });
      },
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("Invalid model reference.");
    expect(html).toContain("retryable&quot;:false");
  });

  test("POST /api/models/pull rejects non-boolean force and does not start model pull", async () => {
    let startCalled = false;
    const html = await readHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual", force: 2 }),
    }, {
      startModelPullJob: async () => {
        startCalled = true;
        return buildModelLoadingEnvelope({
          modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        });
      },
    });

    expect(startCalled).toBe(false);
    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("force");
    expect(html).toContain("must be a boolean, number, or string alias (true/false/1/0/on/off/yes/no) when provided.");
  });

  test("POST /api/models/pull rejects oversized timeoutMs and does not start model pull", async () => {
    let startCalled = false;
    const html = await readHtml("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        timeoutMs: MAX_MODEL_PULL_TIMEOUT_MS + 1,
      }),
    }, {
      startModelPullJob: async () => {
        startCalled = true;
        return buildModelLoadingEnvelope({
          modelRef: "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
        });
      },
    });

    expect(startCalled).toBe(false);
    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("timeoutMs");
    expect(html).toContain("must be between 1 and");
  });

  test("GET /api/models/pull/:jobId returns terminal envelope fields", async () => {
    const html = await readHtml("/api/models/pull/model-job-done", {
      method: "GET",
    });

    expect(html).toContain('data-state="success"');
    expect(html).toContain("status=succeeded");
    expect(html).toContain("Exit code: 0");
  });

  test("POST /api/apps/build android request returns loading envelope", async () => {
    const html = await readHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "android", buildType: "debug", skipTests: true }),
    });

    expect(html).toContain('data-state="loading"');
    expect(html).toContain('hx-get="/api/apps/build/app-build-queued"');
  });

  test("POST /api/apps/build iOS on non-mac renders explicit unsupported state", async () => {
    if (process.platform === "darwin") {
      return;
    }

    const html = await readHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "ios", buildType: "debug" }),
    }, {
      startAppBuildJob,
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("iOS builds can only run on macOS hosts.");
  });

  test("POST /api/apps/build invalid outputDir renders localized typed failure", async () => {
    const html = await readHtml("/api/apps/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "android", buildType: "debug", outputDir: "../outside-build-root" }),
    }, {
      startAppBuildJob,
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("outputDir must not traverse parent directories.");
    expect(html).toContain("The requested build output directory is invalid or unavailable.");
  });

  test("GET /api/apps/build/:jobId returns terminal envelope with artifact and elapsed", async () => {
    const html = await readHtml("/api/apps/build/app-build-done", {
      method: "GET",
    });

    expect(html).toContain('data-state="success"');
    expect(html).toContain("artifact=/tmp/app-debug.apk");
    expect(html).toContain("Elapsed ms: 1234");
    expect(html).toContain("Open artifact");
  });

  test("GET /api/apps/build/:jobId renders localized typed build failure detail", async () => {
    const html = await readHtml("/api/apps/build/app-build-failed", {
      method: "GET",
    }, {
      getAppBuildJobEnvelope: () => buildAppFailureEnvelope("app-build-failed"),
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("The required iOS simulator or device platform assets are not installed.");
  });

  test("GET /api/device-ai/readiness renders deterministic readiness fragment", async () => {
    const html = await readHtml("/api/device-ai/readiness", undefined, {
      resolveDeviceAiReadinessEnvelope: () => buildDeviceAiReadinessEnvelope("blocked"),
    });

    expect(html).toContain("Native device readiness");
    expect(html).toContain("HF_TOKEN or HUGGINGFACE_HUB_TOKEN is required");
    expect(html).toContain("/tmp/app-debug.apk");
    expect(html).toContain("Provision the required iOS simulator or device assets before building.");
    expect(html).toContain('data-state="error-non-retryable"');
  });

  test("POST /api/flows/validate validates YAML without execution", async () => {
    const html = await readHtml("/api/flows/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yaml: [
          "version: \"1.0\"",
          "appId: com.vertu.edge",
          "steps:",
          "  - launchApp",
          "  - inputText: hello",
        ].join("\n"),
      }),
    });

    expect(html).toContain('data-state="success"');
    expect(html).toContain("Flow validated");
    expect(html).toContain("<code>launchApp</code>");
  });

  test("POST /api/flows/validate accepts flow execution policy overrides", async () => {
    const html = await readHtml("/api/flows/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yaml: [
          "version: \"1.0\"",
          "appId: com.vertu.edge",
          "steps:",
          "  - launchApp",
          "  - inputText: hello",
        ].join("\n"),
        maxAttempts: 4,
        commandTimeoutMs: 15000,
        retryDelayMs: 500,
      }),
    });

    expect(html).toContain('data-state="success"');
    expect(html).toContain("Flow validated");
  });

  test("POST /api/flows/validate surfaces parse failures deterministically", async () => {
    const html = await readHtml("/api/flows/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yaml: [
          "version: \"1.0\"",
          "appId: com.vertu.edge",
          "steps:",
          "  - totallyUnsupported: value",
        ].join("\n"),
      }),
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("Flow parsing failed");
  });

  test("POST /api/flows/validate/automation reports unsupported commands", async () => {
    const html = await readHtml("/api/flows/validate/automation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yaml: [
          "version: \"1.0\"",
          "appId: com.vertu.edge",
          "steps:",
          "  - launchApp",
          "  - totallyUnsupported: value",
          "  - inputText: hello",
        ].join("\n"),
        target: "android",
      }),
    });

    expect(
      html.includes('data-state="error-retryable"') || html.includes('data-state="error-non-retryable"'),
    ).toBe(true);
    expect(html).toContain("<code>totallyUnsupported</code>");
    expect(html).toContain("Unsupported command key");
  });

  test("POST /api/flows/validate/automation with ios target reports explicit readiness", async () => {
    const html = await readHtml("/api/flows/validate/automation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "ios",
        yaml: [
          "version: \"1.0\"",
          "appId: com.vertu.edge",
          "steps:",
          "  - launchApp",
          "  - tapOn: \"Get Started\"",
        ].join("\n"),
      }),
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toMatch(/iOS target is not ready/);
  });

  test("POST /api/flows/run renders action and attempt telemetry", async () => {
    const body: {
      yaml: string;
      target?: string;
      maxAttempts: number;
      commandTimeoutMs: number;
      retryDelayMs: number;
    } = {
      yaml: [
        "version: \"1.0\"",
        "appId: com.vertu.edge",
        "steps:",
        "  - launchApp",
      ].join("\n"),
      target: "android",
      maxAttempts: 2,
      commandTimeoutMs: 15000,
      retryDelayMs: 500,
    };

    const html = await readHtml("/api/flows/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, {
      runFlow: async () => buildFlowRunResult(),
    });

    expect(html).toContain("data-state=\"error-retryable\"");
    expect(html).toContain("Flow action summary");
    expect(html).toContain("Flow attempt timeline");
    expect(html).toContain("launchApp");
    expect(html).toContain("Max attempts");
    expect(html).toContain("Timeout");
    expect(html).toContain("intermittent network failure");
  });

  test("POST /api/flows/trigger forwards request overrides to runFlow", async () => {
    let capturedRunRequestYaml = "";
    const html = await readHtml("/api/flows/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yaml: [
          "version: \"1.0\"",
          "appId: com.vertu.edge",
          "steps:",
          "  - launchApp",
        ].join("\n"),
        target: "osx",
        maxAttempts: 3,
      }),
    }, {
      runFlow: async (request) => {
        capturedRunRequestYaml = request.yaml;
        return {
          appId: "com.vertu.edge",
          commandCount: 1,
          state: "success",
          target: request.target,
          policy: {
            maxAttempts: request.maxAttempts ?? 2,
            commandTimeoutMs: request.commandTimeoutMs ?? 20000,
            retryDelayMs: request.retryDelayMs ?? 250,
          },
          actions: [],
          results: [
            {
              commandIndex: 0,
              commandType: "launchApp",
              attempts: 1,
              state: "success",
              message: "launchApp executed",
            },
          ],
          durationMs: 100,
        };
      },
    });

    expect(html).toContain('data-state="success"');
    expect(capturedRunRequestYaml).toContain("appId: com.vertu.edge");
  });

  test("GET /api/flows/capabilities renders capability matrix", async () => {
    const html = await readHtml("/api/flows/capabilities?target=android", { method: "GET" });
    expect(html).toContain("Flow target capability matrix");
    expect(html).toContain("Command");
    expect(html).toContain("Requirement");
  });

  test("POST /api/flows/runs returns loading flow run job with controls", async () => {
    const html = await readHtml("/api/flows/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yaml: "version: \"1.0\"\nappId: com.vertu.edge\nsteps:\n  - launchApp",
        target: "android",
      }),
    }, {
      startFlowRunJob: () => buildFlowRunJobEnvelope("queued"),
    });

    expect(html).toContain('data-state="loading"');
    expect(html).toContain("Run lifecycle");
    expect(html).toContain("/api/flows/runs/flow-run-123/cancel");
    expect(html).toContain('id="flow-result-wrapper"');
    expect(html).toContain('hx-ext="job-poll"');
    expect(html).toContain('job-poll-url="/api/flows/runs/flow-run-123"');
  });

  test("GET /api/flows/runs/:runId returns terminal run envelope", async () => {
    const html = await readHtml("/api/flows/runs/flow-run-123", { method: "GET" }, {
      getFlowRunJobEnvelope: () => buildFlowRunJobEnvelope("succeeded"),
    });

    expect(html).toContain('data-state="success"');
    expect(html).toContain('data-job-terminal="true"');
    expect(html).toContain("Run ID: flow-run-123");
    expect(html).toContain("launchApp");
  });

  test("POST /api/flows/runs/:runId/cancel and pause/resume routes render states", async () => {
    const cancelled = await readHtml("/api/flows/runs/flow-run-123/cancel", { method: "POST" }, {
      cancelFlowRunJob: () => buildFlowRunJobEnvelope("cancelled"),
    });
    expect(cancelled).toContain("Cancelled");

    const paused = await readHtml("/api/flows/runs/flow-run-123/pause", { method: "POST" }, {
      pauseFlowRunJob: () => buildFlowRunJobEnvelope("paused"),
    });
    expect(paused).toContain("Paused");

    const resumed = await readHtml("/api/flows/runs/flow-run-123/resume", { method: "POST" }, {
      resumeFlowRunJob: () => buildFlowRunJobEnvelope("running"),
    });
    expect(resumed).toContain("Running");
  });

  test("POST /api/flows/runs/:runId/replay-step renders response", async () => {
    const html = await readHtml("/api/flows/runs/flow-run-123/replay-step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandIndex: 0 }),
    }, {
      replayFlowRunStep: () => buildFlowRunJobEnvelope("running"),
    });

    expect(html).toContain("Run lifecycle");
    expect(html).toContain("Running");
  });

  test("GET /api/flows/runs/:runId/logs streams SSE events", async () => {
    const app = createControlPlaneApp({
      services: createDeterministicServices({
        getFlowRunLogEvents: () => buildFlowRunEvents().map((event) => ({
          ...event,
          commandIndex: event.commandIndex ?? null,
          createdAt: event.timestamp,
        })),
      }),
    });

    const response = await app.handle(new Request("http://localhost/api/flows/runs/flow-run-123/logs"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: info");
    expect(text).toContain("id: evt-1");
    expect(text).toContain("Flow execution started");
  });

  test("POST /api/apps/build/:jobId cancel/resume and logs are available", async () => {
    const cancelled = await readHtml("/api/apps/build/app-build-queued/cancel", { method: "POST" }, {
      cancelAppBuildJob: () => ({
        ...buildAppLoadingEnvelope({ platform: "android", buildType: "debug" }),
        state: "error-non-retryable",
        data: {
          ...buildAppLoadingEnvelope({ platform: "android", buildType: "debug" }).data!,
          status: "cancelled",
        },
      }),
    });
    expect(cancelled).toContain("cancelled");

    const resumed = await readHtml("/api/apps/build/app-build-queued/resume", { method: "POST" }, {
      resumeAppBuildJob: () => buildAppLoadingEnvelope({ platform: "android", buildType: "debug" }),
    });
    expect(resumed).toContain('data-state="loading"');

    const app = createControlPlaneApp({
      services: createDeterministicServices({
        getAppBuildJobLogEvents: () => [
          {
            id: "build-evt-1",
            level: "info",
            message: "Build started",
            commandIndex: null,
            createdAt: "2026-03-01T00:00:00.000Z",
          },
        ],
      }),
    });
    const logs = await app.handle(new Request("http://localhost/api/apps/build/app-build-queued/logs"));
    expect(logs.status).toBe(200);
    const text = await logs.text();
    expect(text).toContain("Build started");
    expect(text).toContain("id: build-evt-1");
  });

  test("POST /api/ai/providers/validate returns provider validation summary", async () => {
    const html = await readHtml("/api/ai/providers/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectivity: false }),
    });

    expect(html).toContain("Provider validation");
    expect(html).toContain("Providers");
    expect(html).toContain("Configured");
  });

  test("GET /api/ai/models without provider returns provider selection prompt", async () => {
    const html = await readHtml("/api/ai/models", {
      method: "GET",
    });

    expect(html).toContain("Select a provider before loading models.");
  });

  test("GET /api/ai/models requires API key for providers that require credentials", async () => {
    const html = await readHtml("/api/ai/models?provider=openai", {
      method: "GET",
    });

    expect(html).toContain("Save an API key to load models for this provider.");
    expect(html).toContain('id="model-state-openai"');
    expect(html).toContain('data-state="unauthorized"');
  });

  test("GET /api/ai/models retains selected model when provider listing succeeds", async () => {
    const mockFetch: FetchLike = async (): Promise<Response> => new Response(
      JSON.stringify({
        data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
    const html = await withMockedFetch(mockFetch, () =>
      readHtml("/api/ai/models?provider=openai&apiKey=test-openai-key&selectedModel=gpt-4o-mini", {
        method: "GET",
      })
    );

    expect(html).toContain('value="gpt-4o-mini" selected');
    expect(html).toContain('id="model-state-openai"');
    expect(html).toContain('data-state="success"');
  });

  test("POST /api/ai/keys requires key for providers that require credentials", async () => {
    const html = await readHtml("/api/ai/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai" }),
    });

    expect(html).toContain("Provider key is required");
  });

  test("POST /api/ai/keys validates provider base URL format", async () => {
    const html = await readHtml("/api/ai/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "ollama", baseUrl: "not-a-url" }),
    });

    expect(html).toContain("Invalid base URL.");
    expect(html).toContain('data-state="error-non-retryable"');
  });

  test("POST /api/ai/keys requires secure storage before persisting provider keys", async () => {
    const html = await withEncryptionKey(undefined, () =>
      readHtml("/api/ai/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey: "test-openai-key" }),
      })
    );

    expect(html).toContain("Set VERTU_ENCRYPTION_KEY before storing provider credentials.");
    expect(html).toContain('data-state="error-non-retryable"');
  });

  test("POST /api/ai/keys stores API key for reuse by provider actions", async () => {
    const provider = "openai";
    const key = "test-openai-key";
    const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    await withEncryptionKey(encryptionKey, () =>
      readHtml("/api/ai/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: key }),
      })
    );

    const storedKey = await withEncryptionKey(encryptionKey, async () => getApiKey(provider));
    expect(storedKey).toBe(key);

    deleteApiKey(provider);
  });

  test("GET /api/ucp/discover with format=json returns machine-readable success payload", async () => {
    const payload = await withMockedFetch(async () =>
      new Response(JSON.stringify(validUcpManifestResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      () => readDiscoverJson("/api/ucp/discover?url=https://shop.example.com&format=json"),
    );
    expect(payload).toMatchObject({ ok: true });
    if (!payload.ok) return;
    expect(payload.manifest.ucp.version).toBe("2026-01-11");
    expect(payload.manifest.ucp.capabilities).toHaveLength(1);
    expect(payload.manifest.ucp.capabilities[0]!.name).toBe("dev.ucp.shopping.checkout");
  });

  test("GET /api/ucp/discover with Accept: application/json returns structured error payload", async () => {
    const payload = await withMockedFetch(async () =>
      new Response("Not Found", { status: 404 }),
      () => readDiscoverJson("/api/ucp/discover?url=https://shop.example.com", {
        headers: {
          accept: "application/json",
        },
      }),
    );
    expect(payload).toMatchObject({ ok: false, error: "not_found" });
  });

  test("GET /api/ucp/discover defaults to dashboard HTML when JSON is not requested", async () => {
    const html = await withMockedFetch(async () =>
      new Response(JSON.stringify(validUcpPaymentsManifestResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      () => readHtml("/api/ucp/discover?url=https://shop.example.com"),
    );

    expect(html).toContain("2026-01-11");
    expect(html).toContain("dev.ucp.shopping.checkout");
    expect(html).toContain("1");
  });

  test("POST /api/ai/workflows/run returns loading workflow job envelope", async () => {
    const html = await readHtml("/api/ai/workflows/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "typography",
        provider: "ollama",
        model: "llama3.2",
        message: "Create typography guidance",
      }),
    }, {
      startAiWorkflowJob: (_request: AiWorkflowRequest): AiWorkflowJobEnvelope => buildAiWorkflowJobEnvelope("queued"),
    });

    expect(html).toContain('data-state="loading"');
    expect(html).toContain("Refresh status");
    expect(html).toContain("/api/ai/workflows/jobs/wf-job-123");
    expect(html).toContain('hx-ext="job-poll"');
    expect(html).toContain('job-poll-url="/api/ai/workflows/jobs/wf-job-123"');
  });

  test("POST /api/ai/workflows/run validates image option ranges", async () => {
    const html = await readHtml("/api/ai/workflows/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "image",
        message: "Generate hero image",
        imageOptions: {
          steps: 101,
        },
      }),
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("imageOptions.steps must be between 1 and 100.");
  });

  test("GET /api/ai/workflows/jobs/:jobId returns workflow output envelope", async () => {
    const html = await readHtml("/api/ai/workflows/jobs/wf-job-123", {
      method: "GET",
    }, {
      getAiWorkflowJobEnvelope: (_jobId: string): AiWorkflowJobEnvelope => buildAiWorkflowJobEnvelope("succeeded"),
    });

    expect(html).toContain('data-job-terminal="true"');
    expect(html).toContain("Typography direction output");
  });

  test("GET /api/ai/workflows/capabilities returns capability matrix", async () => {
    const html = await readHtml("/api/ai/workflows/capabilities", {
      method: "GET",
    }, {
      getAiWorkflowCapabilityEnvelope: async () => buildAiWorkflowCapabilitiesEnvelope(),
    });

    expect(html).toContain("AI workflow capabilities");
    expect(html).toContain("<code>image</code>");
    expect(html).toContain("local unavailable");
    expect(html).toContain("Selected mode");
  });

  test("GET /api/ai/workflows/form-fields returns image controls for image mode", async () => {
    const html = await readHtml("/api/ai/workflows/form-fields?mode=image", {
      method: "GET",
    });

    expect(html).toContain("Workflow options");
    expect(html).toContain("floating-chat-image-size");
    expect(html).toContain("floating-chat-image-steps-hint");
    expect(html).not.toContain("floating-chat-audience");
  });

  test("GET /api/ai/workflows/form-fields returns text controls for text modes", async () => {
    const html = await readHtml("/api/ai/workflows/form-fields?mode=typography", {
      method: "GET",
    });

    expect(html).toContain("Workflow options");
    expect(html).toContain("floating-chat-audience");
    expect(html).toContain("floating-chat-tone");
    expect(html).not.toContain("floating-chat-image-size");
  });

  test("POST /api/ai/chat returns retired-route envelope", async () => {
    const html = await readHtml("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini", message: "Hello" }),
    });

    expect(html).toContain('data-state="error-non-retryable"');
    expect(html).toContain("This route has been retired");
    expect(html).toContain("/api/ai/workflows/run");
  });
});
