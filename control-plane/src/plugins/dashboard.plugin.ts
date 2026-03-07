/**
 * Dashboard plugin.
 *
 * Provides:
 *   GET /              — Full dashboard page (all sections)
 *   GET /dashboard/:section — Section fragment (HTMX) or full page (deep link)
 *   GET /favicon.ico
 */
import { Elysia } from "elysia";
import { faviconSvg } from "../brand";
import { getPreference } from "../db";
import { DEFAULT_THEME } from "../config";
import { FAVICON_ROUTE } from "../runtime-constants";
import {
  Dashboard,
  renderDashboardSection,
  DASHBOARD_SECTIONS,
  type DashboardSection,
} from "../pages";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

const DASHBOARD_SECTIONS_SET = new Set<string>(DASHBOARD_SECTIONS);

function isValidSection(value: string): value is DashboardSection {
  return DASHBOARD_SECTIONS_SET.has(value);
}

export const dashboardPlugin = new Elysia({ name: "dashboard" })
  .get(FAVICON_ROUTE, ({ set }) => {
    set.headers["content-type"] = "image/svg+xml";
    set.headers["cache-control"] = "public, max-age=86400";
    return faviconSvg();
  })
  .get("/", ({ set }) => {
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    const theme = getPreference("theme") ?? DEFAULT_THEME;
    return Dashboard(theme);
  })
  .get("/dashboard/:section", ({ params, set, request }) => {
    const { section } = params;
    if (!isValidSection(section)) {
      set.status = 404;
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return "";
    }
    const theme = getPreference("theme") ?? DEFAULT_THEME;
    const isHtmxRequest = request.headers.get("hx-request") === "true";

    if (isHtmxRequest) {
      // Return HTML fragment only — sidebar highlight is managed client-side
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      return renderDashboardSection(section, theme);
    }

    // Full-page render for direct navigation / deep links
    set.headers["content-type"] = HTML_CONTENT_TYPE;
    return Dashboard(theme, section);
  });
