/**
 * Health check plugin.
 *
 * Provides: GET /api/health
 */
import { Elysia } from "elysia";
import { API_HEALTH_ROUTE } from "../runtime-constants";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export const healthPlugin = new Elysia({ name: "health" })
  .get(API_HEALTH_ROUTE, ({ set }) => {
    set.headers["content-type"] = JSON_CONTENT_TYPE;
    return {
      route: API_HEALTH_ROUTE,
      status: "ok" as const,
    };
  });
