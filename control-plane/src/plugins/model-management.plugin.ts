import { Elysia, t } from "elysia";
import {
  type FlowCapabilityError,
  type FlowCapabilitySurface,
  type ModelPullEnvelope,
  type ModelPullRequest,
  type ModelSearchEnvelope,
  type ModelSourceRegistryEnvelope,
  createFlowCapabilityError,
} from "../../../contracts/flow-contracts";
import {
  DEFAULT_CHAT_PULL_MODEL,
  DEFAULT_MODEL_SOURCE,
  MODEL_SOURCE_REGISTRY,
  RAMALAMA_LIST_TIMEOUT_MS,
} from "../config";
import { isTerminalJobState } from "../job-log-stream";
import {
  type RequestBodyRecord,
  toRequestBody,
} from "../http-helpers";
import { logger } from "../logger";
import { MODEL_PULL_ROUTE, MODEL_SEARCH_ROUTE, MODEL_SOURCE_ROUTE, MODEL_INVENTORY_ROUTE } from "../runtime-constants";
import { searchHfModels, type HfSort } from "../hf-search";
import type { ControlPlaneServices } from "../app";

type CapabilityFailure = Error | string | number | boolean | null | undefined | { readonly message?: string };

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

type ModelManagementPluginDependencies = {
  /** Runtime services used by model routes. */
  readonly services: Pick<
    ControlPlaneServices,
    "startModelPullJob" | "getModelPullJobEnvelope" | "cancelModelPullJob" | "resumeModelPullJob" | "getModelPullJobLogEvents" | "getModelInventory" | "deleteModel" | "listModelPullJobs"
  >;
  /** Parse and validate incoming model-pull request bodies. */
  readonly parseModelPullRequestBody: (body: RequestBodyRecord | null | undefined) => ModelPullRequest;
  /** Convert arbitrary failures into typed capability errors. */
  readonly toCapabilityError: (
    failure: CapabilityFailure,
    command: string,
    surface?: FlowCapabilitySurface,
  ) => FlowCapabilityError;
  /** Render model-pull state envelopes as SSR HTML. */
  readonly renderModelPullState: (route: string, envelope: ModelPullEnvelope) => string;
  /** Render model-search state envelopes as SSR HTML. */
  readonly renderModelSearchState: (route: string, envelope: ModelSearchEnvelope) => string;
  /** Translate locale keys into active localized copy. */
  readonly translate: (key: string) => string;
};

function parseHfSearchSort(value: string | undefined): HfSort {
  const normalized = value?.trim();
  if (
    normalized === "downloads"
    || normalized === "likes"
    || normalized === "trending"
    || normalized === "lastModified"
    || normalized === "createdAt"
  ) {
    return normalized;
  }
  return "downloads";
}

/** Create the `/api/models` route plugin with injected rendering/parsing dependencies. */
export function createModelManagementPlugin({
  services,
  parseModelPullRequestBody,
  toCapabilityError,
  renderModelPullState,
  renderModelSearchState,
  translate,
}: ModelManagementPluginDependencies) {
  return new Elysia({ name: "model-management", prefix: "/api/models" })
    .get("/sources", ({ set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const envelope: ModelSourceRegistryEnvelope = {
        route: MODEL_SOURCE_ROUTE,
        state: MODEL_SOURCE_REGISTRY.length > 0 ? "success" : "empty",
        data: {
          defaultSource: DEFAULT_MODEL_SOURCE,
          sources: MODEL_SOURCE_REGISTRY,
        },
        mismatches: [],
      };
      return envelope;
    })
    .get("/search", async ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const q = typeof query.q === "string" ? query.q.trim() : "";
      if (!q) {
        const envelope: ModelSearchEnvelope = {
          route: MODEL_SEARCH_ROUTE,
          state: "error-non-retryable",
          data: { query: "", totalResults: 0, models: [] },
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "search",
            reason: translate("model_search.query_required"),
            retryable: false,
            surface: "model_pull",
          }),
          mismatches: [translate("model_search.query_required")],
        };
        return renderModelSearchState(MODEL_SEARCH_ROUTE, envelope);
      }

      const limit = Math.min(Math.max(1, Number(query.limit) || 12), 50);
      const sort = parseHfSearchSort(typeof query.sort === "string" ? query.sort : undefined);
      const searchResult = await searchHfModels({ query: q, limit, sort });
      if (!searchResult.ok) {
        const reason = searchResult.reason ?? translate("api.request_failed");
        const envelope: ModelSearchEnvelope = {
          route: MODEL_SEARCH_ROUTE,
          state: "error-retryable",
          data: { query: q, totalResults: 0, models: [] },
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "search",
            reason,
            retryable: true,
            surface: "model_pull",
          }),
          mismatches: [reason],
        };
        return renderModelSearchState(MODEL_SEARCH_ROUTE, envelope);
      }

      const envelope: ModelSearchEnvelope = {
        route: MODEL_SEARCH_ROUTE,
        state: searchResult.models.length > 0 ? "success" : "empty",
        data: {
          query: q,
          totalResults: searchResult.models.length,
          models: searchResult.models,
        },
        mismatches: [],
      };
      return renderModelSearchState(MODEL_SEARCH_ROUTE, envelope);
    })
    .get("/inventory", ({ set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const models = services.getModelInventory
        ? services.getModelInventory()
        : [];
      return { route: MODEL_INVENTORY_ROUTE, models, total: models.length };
    })
    .delete("/inventory/:modelId", async ({ params, set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const modelId = String(params.modelId);
      if (!services.deleteModel) {
        set.status = 501;
        return { ok: false, reason: "Model deletion not available." };
      }
      const result = await services.deleteModel(modelId);
      if (!result.ok) {
        set.status = 404;
      }
      return result;
    })
    .get("/", async ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const fallback = `<span class="badge badge-warning gap-1">${translate("api.models_ramalama_not_found")}</span>`;
      const ramalamaPath = Bun.which("ramalama");
      if (!ramalamaPath) {
        return fallback;
      }

      const proc = Bun.spawn([ramalamaPath, "list"], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: RAMALAMA_LIST_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      const exitCode = await proc.exited;
      if (proc.killed || exitCode !== 0) {
        logger.warn("ramalama list failed", {
          route: "/api/models",
          timeoutMs: RAMALAMA_LIST_TIMEOUT_MS,
          exitCode,
          killed: proc.killed,
        });
        return fallback;
      }

      const text = proc.stdout ? await new Response(proc.stdout).text() : "";
      const lines = text.split("\n").filter((line) => line.trim().length > 0);
      const count = Math.max(0, lines.length - 1);
      return `<span class="badge badge-success gap-1">${count}</span> ${translate("api.models_found_suffix")}`;
    })
    .post("/pull", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return Promise.resolve()
        .then(() => {
          const requestBody = toRequestBody(body);
          return {
            requestBody,
            parsedRequest: parseModelPullRequestBody(requestBody),
          };
        })
        .then(({ parsedRequest }) => services.startModelPullJob(parsedRequest, "ui"))
        .then((envelope) => renderModelPullState(MODEL_PULL_ROUTE, envelope),
        (failure) => {
          const requestBody = toRequestBody(body);
          const requestedModelRef = requestBody?.modelRef && typeof requestBody.modelRef === "string"
            ? requestBody.modelRef.trim()
            : DEFAULT_CHAT_PULL_MODEL;
          const normalizedFailure = toCapabilityError(failure, "payload", "model_pull");
          const envelope: ModelPullEnvelope = {
            route: MODEL_PULL_ROUTE,
            state: normalizedFailure.retryable ? "error-retryable" : "error-non-retryable",
            jobId: "",
            data: {
              requestedModelRef,
              normalizedModelRef: requestedModelRef,
              status: "failed",
              exitCode: 1,
              stdout: "",
              stderr: normalizedFailure.reason,
              artifactPath: null,
              elapsedMs: 0,
              platform: (typeof requestBody?.platform === "string" && requestBody.platform.trim().length > 0)
                ? requestBody.platform.trim()
                : undefined,
            },
            error: normalizedFailure,
            mismatches: [normalizedFailure.reason],
          };
          return renderModelPullState(MODEL_PULL_ROUTE, envelope);
        },
      );
    }, {
      body: t.Object({
        modelRef: t.Optional(t.String()),
        source: t.Optional(t.String()),
        platform: t.Optional(t.String()),
        force: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
        timeoutMs: t.Optional(t.Union([t.Number(), t.String()])),
        correlationId: t.Optional(t.String()),
      }),
    })
    .get("/pull", ({ query, set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const limit = Math.min(Math.max(1, Number(query.limit) || 20), 100);
      const offset = Math.max(0, Number(query.offset) || 0);
      const statusFilter = typeof query.status === "string" && query.status.trim().length > 0
        ? query.status.trim()
        : undefined;
      if (services.listModelPullJobs) {
        return services.listModelPullJobs({ limit, offset, status: statusFilter });
      }
      return { jobs: [], total: 0 };
    })
    .get("/pull/:jobId", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const envelope = services.getModelPullJobEnvelope(String(params.jobId));
      if (isTerminalJobState(envelope.data?.status)) {
        set.headers["HX-Trigger"] = "job-completed";
      }
      return renderModelPullState(`${MODEL_PULL_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .post("/pull/:jobId/cancel", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.cancelModelPullJob ?? ((jobId: string) => services.getModelPullJobEnvelope(jobId));
      const envelope = action(String(params.jobId));
      return renderModelPullState(`${MODEL_PULL_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .post("/pull/:jobId/resume", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.resumeModelPullJob ?? ((jobId: string) => services.getModelPullJobEnvelope(jobId));
      const envelope = action(String(params.jobId));
      return renderModelPullState(`${MODEL_PULL_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .get("/pull/:jobId/logs", ({ params, set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const afterCursor = null;
      const events = services.getModelPullJobLogEvents
        ? services.getModelPullJobLogEvents(String(params.jobId), afterCursor)
        : [];
      return { events };
    });
}
