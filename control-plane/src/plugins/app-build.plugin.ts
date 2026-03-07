import { Elysia, sse, t } from "elysia";
import type {
  AppBuildEnvelope,
  AppBuildRequest,
  CapabilityJobState,
  FlowCapabilityError,
  FlowCapabilitySurface,
} from "../../../contracts/flow-contracts";
import { APP_BUILD_ROUTE } from "../runtime-constants";
import { commandLogQuerySchema } from "../contracts/http";
import { isTerminalJobState } from "../job-log-stream";
import {
  type LogStreamFormat,
  type RequestBodyRecord,
  parseLogCursor,
  parseLogStreamFormat,
  parseLogTailFlag,
  toRequestBody,
  toRequestQuery,
} from "../http-helpers";
import type { ControlPlaneServices } from "../app";

type LogEventLevel = "debug" | "info" | "warn" | "error";
type JobLogEventPayload = {
  id: string;
  level: LogEventLevel;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};
type CapabilityFailure = Error | string | number | boolean | null | undefined | { readonly message?: string };

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

type AppBuildPluginDependencies = {
  /** Runtime services used by app-build routes. */
  readonly services: Pick<
    ControlPlaneServices,
    "startAppBuildJob" | "getAppBuildJobEnvelope" | "cancelAppBuildJob" | "resumeAppBuildJob" | "getAppBuildJobLogEvents"
  >;
  /** Parse and validate incoming app-build request bodies. */
  readonly parseAppBuildRequestBody: (body: RequestBodyRecord | null | undefined) => AppBuildRequest;
  /** Convert arbitrary failures into typed capability errors. */
  readonly toCapabilityError: (
    failure: CapabilityFailure,
    command: string,
    surface?: FlowCapabilitySurface,
  ) => FlowCapabilityError;
  /** Render app-build state envelopes as SSR HTML. */
  readonly renderAppBuildState: (route: string, envelope: AppBuildEnvelope) => string;
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

/** Create the `/api/apps/build` route plugin with injected parsing/render helpers. */
export function createAppBuildPlugin({
  services,
  parseAppBuildRequestBody,
  toCapabilityError,
  renderAppBuildState,
  streamJobLogs,
}: AppBuildPluginDependencies) {
  return new Elysia({ name: "app-build", prefix: APP_BUILD_ROUTE })
    .post("/", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const request = parseAppBuildRequestBody(toRequestBody(body));
      return services.startAppBuildJob(request, "ui").then(
        (envelope) => renderAppBuildState(APP_BUILD_ROUTE, envelope),
        (failure) => {
          const normalizedFailure = toCapabilityError(failure, "payload", "app_build");
          const envelope: AppBuildEnvelope = {
            route: APP_BUILD_ROUTE,
            state: normalizedFailure.retryable ? "error-retryable" : "error-non-retryable",
            jobId: "",
            error: normalizedFailure,
            mismatches: [normalizedFailure.reason],
          };
          return renderAppBuildState(APP_BUILD_ROUTE, envelope);
        },
      );
    }, {
      body: t.Object({
        platform: t.Union([t.Literal("android"), t.Literal("ios"), t.Literal("desktop")]),
        buildType: t.Optional(t.Union([t.Literal("debug"), t.Literal("release")])),
        variant: t.Optional(t.String()),
        skipTests: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
        outputDir: t.Optional(t.String()),
        clean: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
        correlationId: t.Optional(t.String()),
      }),
    })
    .get("/:jobId", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const envelope = services.getAppBuildJobEnvelope(String(params.jobId));
      if (isTerminalJobState(envelope.data?.status)) {
        set.headers["HX-Trigger"] = "job-completed";
      }
      return renderAppBuildState(`${APP_BUILD_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .post("/:jobId/cancel", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.cancelAppBuildJob ?? ((jobId: string) => services.getAppBuildJobEnvelope(jobId));
      const envelope = action(String(params.jobId));
      return renderAppBuildState(`${APP_BUILD_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .post("/:jobId/resume", ({ params, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const action = services.resumeAppBuildJob ?? ((jobId: string) => services.getAppBuildJobEnvelope(jobId));
      const envelope = action(String(params.jobId));
      return renderAppBuildState(`${APP_BUILD_ROUTE}/${String(params.jobId)}`, envelope);
    })
    .get("/:jobId/logs", async function* ({ params, query, request }) {
      const listEvents = services.getAppBuildJobLogEvents ?? (() => []);
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
        readStatus: (id) => services.getAppBuildJobEnvelope(id).data?.status,
      });
    }, {
      query: commandLogQuerySchema,
    });
}
