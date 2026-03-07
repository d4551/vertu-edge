import { Elysia, sse, t } from "elysia";
import { t as tStr } from "../i18n";
import type {
  CapabilityJobState,
  FlowRunJobEnvelope,
  FlowRunRequest,
} from "../../../contracts/flow-contracts";
import { createFlowCapabilityError } from "../../../contracts/flow-contracts";
import { MAX_YAML_BYTES } from "../config";
import {
  FLOW_AUTOMATION_VALIDATE_ROUTE,
  FLOW_CAPABILITIES_ROUTE,
  FLOW_RUN_ROUTE,
  FLOW_TRIGGER_ROUTE,
  FLOW_VALIDATE_ROUTE,
} from "../runtime-constants";
import { commandLogQuerySchema, flowRequestBodySchema } from "../contracts/http";
import { isTerminalJobState } from "../job-log-stream";
import {
  type LogStreamFormat,
  type RequestBodyRecord,
  type RequestFieldValue,
  parseLogCursor,
  parseLogStreamFormat,
  parseLogTailFlag,
  parseOptionalInt,
  toRequestBody,
  toRequestQuery,
} from "../http-helpers";
import type { ControlPlaneServices } from "../app";

type LogEventLevel = "debug" | "info" | "warn" | "error";
type FlowRunRoute = typeof FLOW_RUN_ROUTE | typeof FLOW_TRIGGER_ROUTE;
type JobLogEventPayload = {
  id: string;
  level: LogEventLevel;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};

const FLOW_ROUTE_PREFIX = "/api/flows";
const FLOW_RUN_JOBS_ROUTE = `${FLOW_ROUTE_PREFIX}/runs`;
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

type FlowRoutesPluginDependencies = {
  /** Runtime services used by flow routes. */
  readonly services: Pick<
    ControlPlaneServices,
    | "runFlow"
    | "startFlowRunJob"
    | "getFlowRunJobEnvelope"
    | "cancelFlowRunJob"
    | "pauseFlowRunJob"
    | "resumeFlowRunJob"
    | "replayFlowRunStep"
    | "getFlowRunLogEvents"
    | "listSavedFlows"
    | "createSavedFlow"
    | "getSavedFlow"
    | "updateSavedFlow"
    | "deleteSavedFlow"
  >;
  /** Parse and validate incoming flow request bodies. */
  readonly parseFlowRunRequestBody: (body: RequestBodyRecord | null | undefined) => FlowRunRequest;
  /** Render async flow-run job state envelopes as SSR HTML. */
  readonly renderFlowRunJobState: (route: string, envelope: FlowRunJobEnvelope) => string;
  /** Execute and render `/api/flows/run` + `/api/flows/trigger`. */
  readonly runFlow: (
    route: FlowRunRoute,
    rawBody: RequestBodyRecord | null | undefined,
    services: ControlPlaneServices,
  ) => Promise<string>;
  /** Validate flow YAML without execution and render SSR HTML. */
  readonly validateFlowYaml: (
    route: typeof FLOW_VALIDATE_ROUTE,
    rawBody: RequestBodyRecord | null | undefined,
  ) => Promise<string>;
  /** Validate automation capability coverage and render SSR HTML. */
  readonly validateFlowAutomation: (
    route: typeof FLOW_AUTOMATION_VALIDATE_ROUTE,
    rawBody: RequestBodyRecord | null | undefined,
  ) => Promise<string>;
  /** Render target capability matrix as SSR HTML. */
  readonly flowCapabilityMatrix: (
    route: typeof FLOW_CAPABILITIES_ROUTE,
    targetRaw: RequestFieldValue,
  ) => Promise<string>;
  /** Stream normalized job logs as SSE. */
  readonly streamJobLogs: (input: {
    format: LogStreamFormat;
    tail: boolean;
    initialCursor: string | null;
    request: Request;
    listEvents: (jobId: string, afterCursor?: string | null) => ReadonlyArray<JobLogEventPayload>;
    readStatus: (jobId: string) => CapabilityJobState | undefined;
    jobId: string;
  }) => AsyncGenerator<ReturnType<typeof sse>, void, void>;
};

/** Create the `/api/flows` route plugin with injected parse/render/runtime helpers. */
export function createFlowRoutesPlugin({
  services,
  parseFlowRunRequestBody,
  renderFlowRunJobState,
  runFlow,
  validateFlowYaml,
  validateFlowAutomation,
  flowCapabilityMatrix,
  streamJobLogs,
}: FlowRoutesPluginDependencies) {
  const createUnavailableEnvelope = (runId = ""): FlowRunJobEnvelope => {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "runtime",
      reason: "Flow execution service is unavailable.",
      retryable: false,
      surface: "flow",
    });
    return {
      route: FLOW_RUN_JOBS_ROUTE,
      runId,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
  };

  return new Elysia({ name: "flow-routes", prefix: FLOW_ROUTE_PREFIX })
    .post("/run", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return runFlow(FLOW_RUN_ROUTE, toRequestBody(body), services as ControlPlaneServices);
    }, { body: flowRequestBodySchema })
    .post("/runs", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const request = parseFlowRunRequestBody(toRequestBody(body));
      if (request.yaml && Buffer.byteLength(request.yaml, "utf8") > MAX_YAML_BYTES) {
        const flowError = createFlowCapabilityError({
          commandIndex: -1,
          command: "yaml",
          reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
          retryable: false,
          surface: "flow",
        });
        const errorEnvelope: FlowRunJobEnvelope = {
          route: FLOW_RUN_JOBS_ROUTE,
          runId: "",
          state: "error-non-retryable",
          error: flowError,
          mismatches: [flowError.reason],
        };
        return renderFlowRunJobState(FLOW_RUN_JOBS_ROUTE, errorEnvelope);
      }
      const start = services.startFlowRunJob;
      const resolvedStart = start ?? ((_: FlowRunRequest) => createUnavailableEnvelope());
      const envelope = resolvedStart(request, "ui");
      return renderFlowRunJobState(FLOW_RUN_JOBS_ROUTE, envelope);
    }, { body: flowRequestBodySchema })
    .get("/runs/:runId", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const poll = services.getFlowRunJobEnvelope;
      const resolvedPoll = poll ?? ((runId: string) => createUnavailableEnvelope(runId));
      const runId = String(params.runId);
      const envelope = resolvedPoll(runId);
      if (isTerminalJobState(envelope.data?.status)) {
        set.headers["HX-Trigger"] = "job-completed";
      }
      return renderFlowRunJobState(`${FLOW_RUN_JOBS_ROUTE}/${runId}`, envelope);
    })
    .post("/runs/:runId/cancel", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const runId = String(params.runId);
      const action = services.cancelFlowRunJob ?? services.getFlowRunJobEnvelope ?? ((id: string) => createUnavailableEnvelope(id));
      const envelope = action(runId);
      return renderFlowRunJobState(`${FLOW_RUN_JOBS_ROUTE}/${runId}`, envelope);
    })
    .post("/runs/:runId/pause", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const runId = String(params.runId);
      const action = services.pauseFlowRunJob ?? services.getFlowRunJobEnvelope ?? ((id: string) => createUnavailableEnvelope(id));
      const envelope = action(runId);
      return renderFlowRunJobState(`${FLOW_RUN_JOBS_ROUTE}/${runId}`, envelope);
    })
    .post("/runs/:runId/resume", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const runId = String(params.runId);
      const action = services.resumeFlowRunJob ?? services.getFlowRunJobEnvelope ?? ((id: string) => createUnavailableEnvelope(id));
      const envelope = action(runId);
      return renderFlowRunJobState(`${FLOW_RUN_JOBS_ROUTE}/${runId}`, envelope);
    })
    .post("/runs/:runId/replay-step", ({ params, body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const runId = String(params.runId);
      const commandIndex = parseOptionalInt(toRequestBody(body)?.commandIndex) ?? -1;
      const action = services.replayFlowRunStep ?? services.getFlowRunJobEnvelope ?? ((id: string) => createUnavailableEnvelope(id));
      const envelope = action(runId, commandIndex);
      return renderFlowRunJobState(`${FLOW_RUN_JOBS_ROUTE}/${runId}`, envelope);
    }, {
      body: t.Object({
        commandIndex: t.Union([t.Number(), t.String()]),
      }),
    })
    .get("/runs/:runId/logs", async function* ({ params, query, request }) {
      const listEvents = services.getFlowRunLogEvents ?? (() => []);
      const readEnvelope = services.getFlowRunJobEnvelope ?? ((runId: string) => createUnavailableEnvelope(runId));
      const queryRecord = toRequestQuery(query);
      const format = parseLogStreamFormat(queryRecord);
      const tail = parseLogTailFlag(queryRecord);
      const runId = String(params.runId);
      yield* streamJobLogs({
        format,
        tail,
        initialCursor: parseLogCursor(queryRecord),
        request,
        jobId: runId,
        listEvents,
        readStatus: (jobId) => readEnvelope(jobId).data?.status,
      });
    }, {
      query: commandLogQuerySchema,
    })
    .post("/validate", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return validateFlowYaml(FLOW_VALIDATE_ROUTE, toRequestBody(body));
    }, { body: flowRequestBodySchema })
    .get("/capabilities", async ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const queryRecord = toRequestQuery(query);
      return flowCapabilityMatrix(FLOW_CAPABILITIES_ROUTE, queryRecord?.target);
    })
    .post("/validate/automation", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return validateFlowAutomation(FLOW_AUTOMATION_VALIDATE_ROUTE, toRequestBody(body));
    }, { body: flowRequestBodySchema })
    .post("/trigger", async ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return runFlow(FLOW_TRIGGER_ROUTE, toRequestBody(body), services as ControlPlaneServices);
    }, { body: flowRequestBodySchema })
    .get("/saved", ({ query, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      const queryRecord = toRequestQuery(query);
      const limit = parseOptionalInt(queryRecord?.limit) ?? 20;
      const offset = parseOptionalInt(queryRecord?.offset) ?? 0;
      const result = services.listSavedFlows?.(limit, offset) ?? { flows: [], total: 0 };
      return JSON.stringify(result);
    })
    .post("/saved", ({ body, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      const record = toRequestBody(body);
      const name = typeof record?.name === "string" ? record.name.trim() : "";
      const yaml = typeof record?.yaml === "string" ? record.yaml : "";
      const description = typeof record?.description === "string" ? record.description.trim() : undefined;
      const tags = typeof record?.tags === "string" ? record.tags.trim() : undefined;
      if (!name || !yaml) {
        set.status = 400;
        return JSON.stringify({ error: "name and yaml are required." });
      }
      const id = services.createSavedFlow?.({ name, yaml, description, tags });
      if (!id) {
        set.status = 500;
        return JSON.stringify({ error: "Failed to save flow." });
      }
      return JSON.stringify({ id, name });
    }, {
      body: t.Object({
        name: t.String(),
        yaml: t.String(),
        description: t.Optional(t.String()),
        tags: t.Optional(t.String()),
      }),
    })
    .get("/saved/:id", ({ params, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      const id = String(params.id);
      const flow = services.getSavedFlow?.(id) ?? null;
      if (!flow) {
        set.status = 404;
        return JSON.stringify({ error: "Flow not found." });
      }
      return JSON.stringify(flow);
    })
    .put("/saved/:id", ({ params, body, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      const id = String(params.id);
      const record = toRequestBody(body);
      const patch: Record<string, string | undefined> = {};
      if (typeof record?.name === "string") patch.name = record.name.trim();
      if (typeof record?.yaml === "string") patch.yaml = record.yaml;
      if (typeof record?.description === "string") patch.description = record.description.trim();
      if (typeof record?.tags === "string") patch.tags = record.tags.trim();
      services.updateSavedFlow?.(id, patch);
      return JSON.stringify({ ok: true });
    }, {
      body: t.Object({
        name: t.Optional(t.String()),
        yaml: t.Optional(t.String()),
        description: t.Optional(t.String()),
        tags: t.Optional(t.String()),
      }),
    })
    .delete("/saved/:id", ({ params, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      const id = String(params.id);
      const deleted = services.deleteSavedFlow?.(id) ?? false;
      if (!deleted) {
        set.status = 404;
        return JSON.stringify({ error: "Flow not found." });
      }
      return JSON.stringify({ ok: true });
    })
    .get("/target-hint/:target", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const target = String(params.target).toLowerCase();
      const DESKTOP_TARGETS = new Set(["osx", "windows", "linux"]);
      if (DESKTOP_TARGETS.has(target)) {
        return `<span class="text-warning text-xs">${tStr("flow.target_hint_desktop")}</span>`;
      }
      return `<span class="text-success text-xs">${tStr("flow.target_hint_mobile")}</span>`;
    })
    .get("/target-hint", ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const targetRaw = toRequestQuery(query)?.target;
      const target = (typeof targetRaw === "string" ? targetRaw : "osx").toLowerCase();
      const DESKTOP_TARGETS = new Set(["osx", "windows", "linux"]);
      if (DESKTOP_TARGETS.has(target)) {
        return `<span class="text-warning text-xs">${tStr("flow.target_hint_desktop")}</span>`;
      }
      return `<span class="text-success text-xs">${tStr("flow.target_hint_mobile")}</span>`;
    });
}
