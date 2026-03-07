import { Elysia, sse } from "elysia";
import type {
  AiWorkflowCapabilityEnvelope,
  AiWorkflowJobEnvelope,
  AiWorkflowMode,
  AiWorkflowRequest,
  AiWorkflowRunEnvelope,
  CapabilityJobState,
  FlowCapabilityError,
  FlowCapabilitySurface,
} from "../../../contracts/flow-contracts";
import { createFlowCapabilityError } from "../../../contracts/flow-contracts";
import type { JsonRecord } from "../config";
import {
  AI_WORKFLOW_CAPABILITIES_ROUTE,
  AI_WORKFLOW_JOBS_ROUTE,
  AI_WORKFLOW_RUN_ROUTE,
} from "../runtime-constants";
import {
  aiWorkflowCapabilitiesQuerySchema,
  aiWorkflowModeQuerySchema,
  aiWorkflowRequestBodySchema,
  commandLogQuerySchema,
} from "../contracts/http";
import { isTerminalJobState } from "../job-log-stream";
import {
  type LogStreamFormat,
  type RequestFieldValue,
  parseLogCursor,
  parseLogStreamFormat,
  parseLogTailFlag,
  parseOptionalTrimmedString,
  toRequestQuery,
} from "../http-helpers";
import type { ControlPlaneServices } from "../app";

type LogEventLevel = "debug" | "info" | "warn" | "error";
type CapabilityFailure = Error | string | number | boolean | null | undefined | { readonly message?: string };
type JobLogEventPayload = {
  id: string;
  level: LogEventLevel;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};
type AiWorkflowCapabilitySelection = {
  mode: AiWorkflowMode;
  provider?: string;
  model?: string;
};
type AiWorkflowFormBody = {
  mode: AiWorkflowMode;
  message: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  correlationId?: string;
  conversationId?: string;
  textOptions?: {
    audience?: string;
    tone?: string;
    format?: string;
    constraints?: string;
  };
  imageOptions?: {
    size?: string;
    seed?: number | string;
    steps?: number | string;
    stylePreset?: string;
  };
};

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const AI_WORKFLOW_ROUTE_PREFIX = "/api/ai/workflows";

function prefersJson(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

type AiWorkflowPluginDependencies = {
  /** Runtime services used by AI workflow routes. */
  readonly services: Pick<
    ControlPlaneServices,
    "startAiWorkflowJob" | "getAiWorkflowJobEnvelope" | "cancelAiWorkflowJob" | "getAiWorkflowJobLogEvents" | "getAiWorkflowCapabilityEnvelope"
    | "listConversations" | "deleteConversation" | "getConversationMessages"
    | "getModelAssignment" | "setModelAssignment" | "clearModelAssignment"
  >;
  /** Convert arbitrary failures into typed capability errors. */
  readonly toCapabilityError: (
    failure: CapabilityFailure,
    command: string,
    surface?: FlowCapabilitySurface,
  ) => FlowCapabilityError;
  /** Parse workflow mode query state into canonical enum values. */
  readonly parseAiWorkflowModeSelection: (value: RequestFieldValue) => AiWorkflowMode;
  /** Parse and validate incoming workflow request bodies. */
  readonly parseAiWorkflowRequestBody: (
    body: JsonRecord,
  ) => { request?: AiWorkflowRequest; error?: string };
  /** Render workflow mode-specific form fields as SSR HTML. */
  readonly renderAiWorkflowFormFields: (mode: AiWorkflowMode) => string;
  /** Render workflow request failure state as SSR HTML. */
  readonly renderAiWorkflowRunState: (route: string, envelope: AiWorkflowRunEnvelope) => string;
  /** Render workflow job state as SSR HTML. */
  readonly renderAiWorkflowJobState: (route: string, envelope: AiWorkflowJobEnvelope) => string;
  /** Render workflow capability matrix as SSR HTML. */
  readonly renderAiWorkflowCapabilitiesState: (
    route: string,
    envelope: AiWorkflowCapabilityEnvelope,
    selection?: AiWorkflowCapabilitySelection,
  ) => string;
  /** Render conversation selector options as SSR HTML. */
  readonly renderConversationOptions?: (conversations: ReadonlyArray<{ id: string; title: string; mode: string; updatedAt: string }>) => string;
  /** Render conversation message history as SSR HTML chat bubbles. */
  readonly renderConversationMessages?: (messages: ReadonlyArray<{ role: string; content: string; provider?: string | null; model?: string | null; createdAt: string }>) => string;
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

/** Create the `/api/ai/workflows` route plugin with injected parse/render/runtime helpers. */
export function createAiWorkflowPlugin({
  services,
  toCapabilityError,
  parseAiWorkflowModeSelection,
  parseAiWorkflowRequestBody,
  renderAiWorkflowFormFields,
  renderAiWorkflowRunState,
  renderAiWorkflowJobState,
  renderAiWorkflowCapabilitiesState,
  renderConversationOptions,
  renderConversationMessages,
  streamJobLogs,
}: AiWorkflowPluginDependencies) {
  const toAiWorkflowJsonRecord = (body: AiWorkflowFormBody): JsonRecord => {
    const record: JsonRecord = {
      mode: body.mode,
      message: body.message,
    };
    if (body.provider !== undefined) record.provider = body.provider;
    if (body.model !== undefined) record.model = body.model;
    if (body.apiKey !== undefined) record.apiKey = body.apiKey;
    if (body.baseUrl !== undefined) record.baseUrl = body.baseUrl;
    if (body.correlationId !== undefined) record.correlationId = body.correlationId;
    if (body.conversationId !== undefined) record.conversationId = body.conversationId;
    if (body.textOptions) {
      record.textOptions = {
        ...(body.textOptions.audience !== undefined ? { audience: body.textOptions.audience } : {}),
        ...(body.textOptions.tone !== undefined ? { tone: body.textOptions.tone } : {}),
        ...(body.textOptions.format !== undefined ? { format: body.textOptions.format } : {}),
        ...(body.textOptions.constraints !== undefined ? { constraints: body.textOptions.constraints } : {}),
      };
    }
    if (body.imageOptions) {
      record.imageOptions = {
        ...(body.imageOptions.size !== undefined ? { size: body.imageOptions.size } : {}),
        ...(body.imageOptions.seed !== undefined ? { seed: body.imageOptions.seed } : {}),
        ...(body.imageOptions.steps !== undefined ? { steps: body.imageOptions.steps } : {}),
        ...(body.imageOptions.stylePreset !== undefined ? { stylePreset: body.imageOptions.stylePreset } : {}),
      };
    }
    return record;
  };

  const createUnavailableJobEnvelope = (jobId = ""): AiWorkflowJobEnvelope => {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "workflow",
      reason: "AI workflow service is unavailable.",
      retryable: false,
      surface: "chat",
    });
    return {
      route: AI_WORKFLOW_JOBS_ROUTE,
      jobId,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
  };

  const createUnavailableCapabilitiesEnvelope = (): AiWorkflowCapabilityEnvelope => {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "capabilities",
      reason: "AI workflow capability service is unavailable.",
      retryable: false,
      surface: "chat",
    });
    return {
      route: AI_WORKFLOW_CAPABILITIES_ROUTE,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
  };

  return new Elysia({ name: "ai-workflows", prefix: AI_WORKFLOW_ROUTE_PREFIX })
    .get("/form-fields", ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const queryRecord = toRequestQuery(query);
      const mode = parseAiWorkflowModeSelection(queryRecord?.mode);
      return renderAiWorkflowFormFields(mode);
    }, {
      query: aiWorkflowModeQuerySchema,
    })
    .post("/run", ({ body, request, set }) => {
      const parsed = parseAiWorkflowRequestBody(toAiWorkflowJsonRecord(body));
      const workflowRequest = parsed.request;
      if (!workflowRequest) {
        const reason = parsed.error ?? "Workflow request failed.";
        const envelope: AiWorkflowRunEnvelope = {
          route: AI_WORKFLOW_RUN_ROUTE,
          state: "error-non-retryable",
          error: createFlowCapabilityError({
            commandIndex: -1,
            command: "workflow",
            reason,
            retryable: false,
            surface: "chat",
          }),
          mismatches: [reason],
        };
        if (prefersJson(request)) {
          set.headers["content-type"] = JSON_CONTENT_TYPE;
          return JSON.stringify(envelope);
        }
        set.headers["content-type"] = HTML_CONTENT_TYPE;
        return renderAiWorkflowRunState(AI_WORKFLOW_RUN_ROUTE, envelope);
      }
      const start = services.startAiWorkflowJob ?? ((_: AiWorkflowRequest) => createUnavailableJobEnvelope());
      return Promise.resolve()
        .then(() => start(workflowRequest, "ui"))
        .then(
          (jobEnvelope) => {
            if (prefersJson(request)) {
              set.headers["content-type"] = JSON_CONTENT_TYPE;
              return JSON.stringify(jobEnvelope);
            }
            set.headers["content-type"] = HTML_CONTENT_TYPE;
            return renderAiWorkflowJobState(AI_WORKFLOW_JOBS_ROUTE, jobEnvelope);
          },
          (failure) => {
            const flowError = toCapabilityError(failure, "workflow", "chat");
            const envelope: AiWorkflowJobEnvelope = {
              route: AI_WORKFLOW_JOBS_ROUTE,
              jobId: "",
              state: flowError.retryable ? "error-retryable" : "error-non-retryable",
              error: flowError,
              mismatches: [flowError.reason],
            };
            if (prefersJson(request)) {
              set.headers["content-type"] = JSON_CONTENT_TYPE;
              return JSON.stringify(envelope);
            }
            set.headers["content-type"] = HTML_CONTENT_TYPE;
            return renderAiWorkflowJobState(AI_WORKFLOW_JOBS_ROUTE, envelope);
          },
        );
    }, { body: aiWorkflowRequestBodySchema })
    .get("/jobs/:jobId", ({ params, request, set }) => {
      const poll = services.getAiWorkflowJobEnvelope ?? ((jobId: string) => createUnavailableJobEnvelope(jobId));
      const jobId = String(params.jobId);
      const envelope = poll(jobId);
      if (isTerminalJobState(envelope.data?.status)) {
        set.headers["HX-Trigger"] = "refresh-ai-workflow-capabilities";
      }
      if (prefersJson(request)) {
        set.headers["content-type"] = JSON_CONTENT_TYPE;
        return JSON.stringify(envelope);
      }
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return renderAiWorkflowJobState(`${AI_WORKFLOW_JOBS_ROUTE}/${jobId}`, envelope);
    })
    .post("/jobs/:jobId/cancel", ({ params, request, set }) => {
      const cancel = services.cancelAiWorkflowJob ?? ((jobId: string) => createUnavailableJobEnvelope(jobId));
      const jobId = String(params.jobId);
      const envelope = cancel(jobId);
      set.headers["HX-Trigger"] = "refresh-ai-workflow-capabilities";
      if (prefersJson(request)) {
        set.headers["content-type"] = JSON_CONTENT_TYPE;
        return JSON.stringify(envelope);
      }
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return renderAiWorkflowJobState(`${AI_WORKFLOW_JOBS_ROUTE}/${jobId}`, envelope);
    })
    .get("/jobs/:jobId/logs", async function* ({ params, query, request }) {
      const listEvents = services.getAiWorkflowJobLogEvents ?? (() => []);
      const readEnvelope = services.getAiWorkflowJobEnvelope ?? ((jobId: string) => createUnavailableJobEnvelope(jobId));
      const queryRecord = toRequestQuery(query);
      const format = parseLogStreamFormat(queryRecord);
      const tail = parseLogTailFlag(queryRecord);
      const jobId = String(params.jobId);
      yield* streamJobLogs({
        format,
        tail,
        initialCursor: parseLogCursor(queryRecord),
        request,
        jobId,
        listEvents,
        readStatus: (id) => readEnvelope(id).data?.status,
      });
    }, {
      query: commandLogQuerySchema,
    })
    .get("/capabilities", ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const resolveCapabilities = services.getAiWorkflowCapabilityEnvelope ?? (() => Promise.resolve(createUnavailableCapabilitiesEnvelope()));
      const queryRecord = toRequestQuery(query);
      const selection = {
        mode: parseAiWorkflowModeSelection(queryRecord?.mode),
        provider: parseOptionalTrimmedString(queryRecord?.provider),
        model: parseOptionalTrimmedString(queryRecord?.model),
      } satisfies AiWorkflowCapabilitySelection;
      return resolveCapabilities().then(
        (envelope) => renderAiWorkflowCapabilitiesState(AI_WORKFLOW_CAPABILITIES_ROUTE, envelope, selection),
        (failure) => {
          const flowError = toCapabilityError(failure, "capabilities", "chat");
          const envelope: AiWorkflowCapabilityEnvelope = {
            route: AI_WORKFLOW_CAPABILITIES_ROUTE,
            state: flowError.retryable ? "error-retryable" : "error-non-retryable",
            error: flowError,
            mismatches: [flowError.reason],
          };
          return renderAiWorkflowCapabilitiesState(AI_WORKFLOW_CAPABILITIES_ROUTE, envelope, selection);
        },
      );
    }, {
      query: aiWorkflowCapabilitiesQuerySchema,
    })
    .get("/conversations", ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const list = services.listConversations?.(20, 0);
      const conversations = list?.conversations ?? [];
      if (renderConversationOptions) {
        return renderConversationOptions(conversations);
      }
      // Fallback: render as <option> elements
      let html = `<option value="">New Chat</option>`;
      for (const c of conversations) {
        const truncTitle = c.title.length > 40 ? `${c.title.slice(0, 37)}...` : c.title;
        html += `<option value="${c.id}">${truncTitle}</option>`;
      }
      return html;
    })
    .get("/conversations/messages", ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const queryRecord = toRequestQuery(query);
      const id = String(queryRecord?.conversationId ?? "").trim();
      if (!id) {
        return "";
      }
      const messages = services.getConversationMessages?.(id) ?? [];
      if (renderConversationMessages) {
        return renderConversationMessages(messages);
      }
      let html = "";
      for (const msg of messages) {
        const isUser = msg.role === "user";
        const bubbleClass = isUser ? "chat chat-end" : "chat chat-start";
        const headerText = isUser ? "You" : "Assistant";
        html += `<div class="${bubbleClass}"><div class="chat-header text-xs opacity-60">${headerText}</div><div class="chat-bubble ${isUser ? "chat-bubble-primary" : "chat-bubble-secondary"} text-sm">${msg.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>`;
      }
      html += `<script>document.getElementById('floating-chat-conversation-id').value='${id}'</script>`;
      return html;
    })
    .get("/conversations/:id/messages", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const id = String(params.id);
      const messages = services.getConversationMessages?.(id) ?? [];
      if (renderConversationMessages) {
        return renderConversationMessages(messages);
      }
      // Fallback: render as simple chat divs
      let html = "";
      for (const msg of messages) {
        const isUser = msg.role === "user";
        const bubbleClass = isUser ? "chat chat-end" : "chat chat-start";
        const headerText = isUser ? "You" : "Assistant";
        html += `<div class="${bubbleClass}"><div class="chat-header text-xs opacity-60">${headerText}</div><div class="chat-bubble ${isUser ? "chat-bubble-primary" : "chat-bubble-secondary"} text-sm">${msg.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>`;
      }
      // Set conversationId on the hidden input via script
      html += `<script>document.getElementById('floating-chat-conversation-id').value='${id}'</script>`;
      return html;
    })
    .delete("/conversations/:id", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const id = String(params.id);
      const deleted = services.deleteConversation?.(id) ?? false;
      if (deleted) {
        return `<div class="alert alert-success text-xs"><span>Conversation deleted.</span></div>`;
      }
      return `<div class="alert alert-warning text-xs"><span>Conversation not found.</span></div>`;
    })
    .get("/model-assignment", ({ set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      const modes = ["chat", "typography", "presentation", "social", "image"] as const;
      const assignments: Record<string, { provider: string; model: string } | null> = {};
      for (const mode of modes) {
        assignments[mode] = services.getModelAssignment?.(mode) ?? null;
      }
      return JSON.stringify(assignments);
    })
    .post("/model-assignment", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const record = body as { mode?: string; provider?: string; model?: string };
      const mode = record.mode?.trim();
      const provider = record.provider?.trim();
      const model = record.model?.trim();
      if (!mode || !provider || !model) {
        return `<div class="alert alert-warning text-xs"><span>mode, provider, and model are required.</span></div>`;
      }
      services.setModelAssignment?.(mode, provider, model);
      return `<div class="alert alert-success text-xs"><span>Model pinned for ${mode}.</span></div>`;
    })
    .delete("/model-assignment/:mode", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const mode = String(params.mode);
      services.clearModelAssignment?.(mode);
      return `<div class="alert alert-success text-xs"><span>Model assignment cleared for ${mode}.</span></div>`;
    });
}
