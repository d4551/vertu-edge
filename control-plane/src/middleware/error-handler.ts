import {
  AppBuildExecutionError,
  ConfigParseError,
  UCPFetchError,
} from "../errors";
import { renderStatusEnvelope } from "../renderers";
import { t as tStr } from "../i18n";
import { isFlowCapabilityError, type ApiEnvelope } from "../../../contracts/flow-contracts";
import {
  APP_BUILD_ROUTE,
  FLOW_AUTOMATION_VALIDATE_ROUTE,
  MODEL_PULL_ROUTE,
} from "../runtime-constants";
import { inferRouteFromRequest } from "../http-helpers";
import { logger } from "../logger";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * Custom error registry bound to the root Elysia app.
 * Keeps runtime error identifiers in one canonical module.
 */
export const CONTROL_PLANE_ERROR_TYPES = {
  CONFIG_PARSE: ConfigParseError,
  UCP_FETCH: UCPFetchError,
  APP_BUILD: AppBuildExecutionError,
} as const;

type ErrorHandlerContext = {
  readonly code: string | number;
  readonly error: Error | string | number | boolean | object | null | undefined;
  readonly request: Request;
  readonly requestId?: string;
  readonly set: {
    status?: number | string;
    headers: Record<string, string | number>;
  };
};

function isFlowCapabilityCandidate(value: ErrorHandlerContext["error"]): value is string | number | boolean | object | null | undefined {
  return (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "object"
  );
}

/**
 * Map all control-plane runtime failures into deterministic HTML envelopes.
 * This handler must be registered on the root app so `NOT_FOUND` errors are included.
 */
export function handleControlPlaneError({ code, error, request, requestId, set }: ErrorHandlerContext): string {
  if (error instanceof ConfigParseError) {
    const route = inferRouteFromRequest(request) ?? "/";
    set.status = error.statusCode;
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    return renderStatusEnvelope(
      route,
      { route, state: "error-non-retryable", mismatches: [error.message] },
      tStr("api.request_failed"),
      error.message,
      [error.message],
    );
  }
  if (error instanceof UCPFetchError) {
    const route = inferRouteFromRequest(request) ?? "/api/ucp/discover";
    set.status = error.statusCode;
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    const message = error.message;
    return renderStatusEnvelope(
      route,
      { route, state: error.retryable ? "error-retryable" : "error-non-retryable", mismatches: [message] },
      tStr("api.request_failed"),
      message,
      [message],
    );
  }
  if (error instanceof AppBuildExecutionError) {
    const route = inferRouteFromRequest(request) ?? APP_BUILD_ROUTE;
    set.status = error.statusCode;
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    const message = error.message;
    return renderStatusEnvelope(
      route,
      {
        route,
        state: error.retryable ? "error-retryable" : "error-non-retryable",
        mismatches: [message],
      },
      tStr("api.request_failed"),
      message,
      [message],
    );
  }

  if (isFlowCapabilityCandidate(error) && isFlowCapabilityError(error)) {
    set.status = error.retryable ? 503 : 400;
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    const route = inferRouteFromRequest(request)
      ?? (error.surface === "model_pull"
        ? MODEL_PULL_ROUTE
        : error.surface === "app_build"
          ? APP_BUILD_ROUTE
          : FLOW_AUTOMATION_VALIDATE_ROUTE);
    const envelope: ApiEnvelope = {
      route,
      state: error.retryable ? "error-retryable" : "error-non-retryable",
      error,
      mismatches: [error.reason],
    };
    return renderStatusEnvelope(route, envelope, tStr("api.request_failed"), error.reason, [error.reason]);
  }
  if (code === "NOT_FOUND") {
    const route = new URL(request.url).pathname;
    const message = tStr("api.route_not_found");
    logger.warn("Request route not found", { code, path: route, requestId: requestId ?? null });
    set.status = 404;
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    return renderStatusEnvelope(
      route,
      { route, state: "error-non-retryable", mismatches: [message] },
      message,
      message,
      [message],
    );
  }
  logger.error("Unhandled request error", { code, path: new URL(request.url).pathname, error: String(error), requestId: requestId ?? null });
  set.status = 500;
  set.headers["content-type"] = HTML_CONTENT_TYPE;
  return renderStatusEnvelope(
    "/",
    { route: "/", state: "error-non-retryable", mismatches: [tStr("api.request_failed")] },
    tStr("api.request_failed"),
    tStr("api.request_failed"),
    [String(error)],
  );
}
