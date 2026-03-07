/**
 * Shared control-plane auth boundary.
 *
 * Protects every non-public route when `VERTU_AUTH_TOKEN` is configured and
 * returns deterministic unauthorized envelopes for JSON, HTMX, and full-page
 * SSR requests.
 */
import type { Context } from "elysia";
import type { ApiEnvelope } from "../../../contracts/flow-contracts";
import { readStringEnv } from "../config/env";
import { extractAcceptHeader, inferRouteFromRequest, shouldReturnJsonResponse } from "../http-helpers";
import { t as tStr, tInterp } from "../i18n";
import { renderStatusEnvelope } from "../renderers";
import {
  API_HEALTH_ROUTE,
  BRAND_OVERRIDES_CSS_PATH,
  DAISYUI_CSS_PATH,
  FAVICON_ROUTE,
  HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH,
  HTMX_SCRIPT_PATH,
  HTMX_SSE_EXTENSION_SCRIPT_PATH,
  HTML_CONTENT_TYPE,
  PUBLIC_ASSET_ROUTE_PREFIX,
  TAILWIND_BROWSER_SCRIPT_PATH,
} from "../runtime-constants";

const AUTH_TOKEN_ENV = "VERTU_AUTH_TOKEN";
const AUTH_COOKIE_NAME_ENV = "VERTU_AUTH_COOKIE_NAME";
const AUTH_COOKIE_NAME_DEFAULT = "vertu_edge_auth";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

type AuthFailurePayload = {
  message: string;
  hint: string;
};

type AuthEnvelope = ApiEnvelope<{ authenticated: false }, AuthFailurePayload>;

type AuthGuardContext = Pick<Context, "request">;

/** Read the configured auth token for the current request. */
function resolveExpectedToken(): string | null {
  const raw = process.env[AUTH_TOKEN_ENV];
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Read the configured auth cookie name for browser and HTMX requests. */
function resolveAuthCookieName(): string {
  return readStringEnv(AUTH_COOKIE_NAME_ENV, AUTH_COOKIE_NAME_DEFAULT);
}

/** Parse a named cookie value from the raw Cookie header. */
function readCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    if (name !== cookieName) {
      continue;
    }

    const value = pair.slice(separatorIndex + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  return null;
}

/** Extract the presented auth token from headers, cookies, or query params. */
function extractToken(request: Request): string | null {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader) {
    const bearerToken = authorizationHeader.startsWith("Bearer ")
      ? authorizationHeader.slice(7).trim()
      : authorizationHeader.trim();
    if (bearerToken.length > 0) {
      return bearerToken;
    }
  }

  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) {
    const apiKey = apiKeyHeader.trim();
    if (apiKey.length > 0) {
      return apiKey;
    }
  }

  const cookieToken = readCookieValue(request, resolveAuthCookieName());
  if (cookieToken) {
    return cookieToken;
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (!queryToken) {
    return null;
  }

  const trimmed = queryToken.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Determine whether the current request path is intentionally public. */
function isPublicPath(pathname: string): boolean {
  return pathname === API_HEALTH_ROUTE
    || pathname === FAVICON_ROUTE
    || pathname === PUBLIC_ASSET_ROUTE_PREFIX
    || pathname.startsWith(`${PUBLIC_ASSET_ROUTE_PREFIX}/`);
}

/** Build the deterministic unauthorized envelope for the current request. */
function buildUnauthorizedEnvelope(request: Request): AuthEnvelope {
  const route = inferRouteFromRequest(request) ?? new URL(request.url).pathname;
  const hint = tInterp("auth.token_hint", { cookieName: resolveAuthCookieName() });
  return {
    route,
    state: "unauthorized",
    data: { authenticated: false },
    error: {
      message: tStr("auth.required_message"),
      hint,
    },
    mismatches: [hint],
  };
}

/** Render a full unauthorized HTML document for direct browser navigation. */
function renderUnauthorizedDocument(envelope: AuthEnvelope): string {
  return `<!DOCTYPE html>
<html lang="${tStr("layout.locale")}" data-theme="luxury">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tStr("auth.page_title")}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_ROUTE}" />
  <script src="${HTMX_SCRIPT_PATH}"></script>
  <script src="${HTMX_SSE_EXTENSION_SCRIPT_PATH}"></script>
  <script src="${HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH}"></script>
  <link href="${DAISYUI_CSS_PATH}" rel="stylesheet" type="text/css" />
  <link href="${BRAND_OVERRIDES_CSS_PATH}" rel="stylesheet" type="text/css" />
  <script src="${TAILWIND_BROWSER_SCRIPT_PATH}"></script>
</head>
<body class="min-h-screen bg-base-200 text-base-content">
  <main class="min-h-screen flex items-center justify-center px-4 py-12" tabindex="-1">
    <section class="w-full max-w-xl space-y-6">
      <div class="text-center space-y-2">
        <p class="text-xs uppercase tracking-[0.3em] text-primary">${tStr("auth.required_title")}</p>
        <h1 class="text-3xl font-semibold">${tStr("auth.page_title")}</h1>
      </div>
      ${renderStatusEnvelope(
        envelope.route,
        envelope,
        tStr("auth.required_title"),
        tStr("auth.required_message"),
        envelope.mismatches ?? [],
      )}
    </section>
  </main>
</body>
</html>`;
}

/** Build the correct unauthorized response shape for the current request. */
function createUnauthorizedResponse(request: Request): Response {
  const envelope = buildUnauthorizedEnvelope(request);
  const pathname = new URL(request.url).pathname;
  const accept = request.headers.get("accept") ?? undefined;
  const wantsJson = pathname.startsWith("/api/")
    || shouldReturnJsonResponse(undefined, extractAcceptHeader({ accept }));

  if (wantsJson) {
    return new Response(JSON.stringify(envelope), {
      status: 401,
      headers: { "content-type": JSON_CONTENT_TYPE },
    });
  }

  const isHtmxRequest = request.headers.get("hx-request") === "true";
  if (isHtmxRequest) {
    return new Response(
      renderStatusEnvelope(
        envelope.route,
        envelope,
        tStr("auth.required_title"),
        tStr("auth.required_message"),
        envelope.mismatches ?? [],
      ),
      {
        status: 401,
        headers: { "content-type": HTML_CONTENT_TYPE },
      },
    );
  }

  return new Response(renderUnauthorizedDocument(envelope), {
    status: 401,
    headers: { "content-type": HTML_CONTENT_TYPE },
  });
}

/** Enforce the control-plane auth boundary for protected routes. */
export function enforceControlPlaneAuth({ request }: AuthGuardContext): Response | undefined {
  const expectedToken = resolveExpectedToken();
  const pathname = new URL(request.url).pathname;

  if (!expectedToken || isPublicPath(pathname)) {
    return undefined;
  }

  const requestToken = extractToken(request);
  if (requestToken === expectedToken) {
    return undefined;
  }

  return createUnauthorizedResponse(request);
}

/** Canonical guard object for the protected control-plane route tree. */
export const controlPlaneAuthGuard = {
  beforeHandle: enforceControlPlaneAuth,
};
