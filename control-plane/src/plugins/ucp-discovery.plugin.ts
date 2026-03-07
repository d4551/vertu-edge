import { Elysia } from "elysia";
import { type UCPDiscoverResponse } from "../../../contracts/ucp-contracts";
import { type UCPDiscoverError, discoverBusinessCapabilities } from "../ucp-discovery";
import {
  extractAcceptHeader,
  serializeJsonResponse,
  shouldReturnJsonResponse,
} from "../http-helpers";
import { t as tStr } from "../i18n";
import { esc } from "../renderers";
import { ucpDiscoverQuerySchema } from "../contracts/http";
import { saveUcpDiscovery, listUcpDiscoveries, deleteUcpDiscovery } from "../db";
import { logger } from "../logger";
import { captureResult, normalizeFailureMessage } from "../../../shared/failure";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** Create the `/api/ucp` discovery plugin. */
export function createUcpDiscoveryPlugin() {
  return new Elysia({ name: "ucp-discovery", prefix: "/api/ucp" })
    .get("/discover", ({ headers, query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const url = query.url;
      const wantsJson = shouldReturnJsonResponse(
        typeof query.format === "string" ? query.format : undefined,
        extractAcceptHeader(headers),
      );
      if (wantsJson) {
        set.headers["content-type"] = JSON_CONTENT_TYPE;
      }
      if (!url) {
        const payload: UCPDiscoverResponse = { ok: false, error: "not_found", message: tStr("api.ucp_missing_url") };
        return wantsJson ? serializeJsonResponse(set, payload) : `<span class="text-error">${tStr("api.ucp_missing_url")}</span>`;
      }

      return discoverBusinessCapabilities(url).then((result) => {
        if (!result.ok) {
          const errorKey: Record<UCPDiscoverError, string> = {
            not_found: "api.ucp_error_not_found",
            invalid_manifest: "api.ucp_error_invalid_manifest",
            invalid_json: "api.ucp_error_invalid_json",
            timeout: "api.ucp_error_timeout",
            network: "api.ucp_error_network",
          };
          if (wantsJson) {
            return serializeJsonResponse(set, {
              ok: false,
              error: result.error,
            });
          }
          return `<span class="text-warning">${tStr(errorKey[result.error])}</span>`;
        }

        if (wantsJson) {
          return serializeJsonResponse(set, result);
        }

        const manifest = result.manifest;
        const capCount = manifest.ucp.capabilities.length;
        const svcCount = Object.keys(manifest.ucp.services ?? {}).length;
        const handlerCount = manifest.payment?.handlers?.length ?? 0;
        const signingKeyCount = manifest.signing_keys?.length ?? 0;

        // Persist discovery result to DB
        const persistenceResult = captureResult(() => {
          saveUcpDiscovery({
            serverUrl: url,
            manifestJson: JSON.stringify(manifest),
            ucpVersion: manifest.ucp.version,
            capabilityCount: capCount,
            serviceCount: svcCount,
          });
          return true;
        }, (failure) => normalizeFailureMessage(failure, "UCP discovery persistence failed."));
        if (!persistenceResult.ok) {
          logger.warn("UCP discovery persistence failed", {
            error: persistenceResult.error,
            serverUrl: url,
          });
        }

        const capNames = manifest.ucp.capabilities
          .map((capability) => `<li class="text-xs"><code class="bg-base-300 px-1 rounded">${esc(capability.name)}</code></li>`)
          .join("");
        const handlerNames = (manifest.payment?.handlers ?? [])
          .map((handler) => `<li class="text-xs"><code class="bg-base-300 px-1 rounded">${esc(handler.name)}</code></li>`)
          .join("");
        const stats = [
          `<div class="stat"><div class="stat-title">${tStr("ucp.stat_version")}</div><div class="stat-value text-sm font-mono">${esc(manifest.ucp.version)}</div></div>`,
          `<div class="stat"><div class="stat-title">${tStr("ucp.stat_services")}</div><div class="stat-value text-lg">${svcCount}</div></div>`,
          `<div class="stat"><div class="stat-title">${tStr("ucp.stat_capabilities")}</div><div class="stat-value text-lg">${capCount}</div></div>`,
          `<div class="stat"><div class="stat-title">${tStr("ucp.stat_payment_handlers")}</div><div class="stat-value text-lg">${handlerCount}</div></div>`,
          ...(signingKeyCount > 0
            ? [`<div class="stat"><div class="stat-title">${tStr("ucp.stat_signing_keys")}</div><div class="stat-value text-lg">${signingKeyCount}</div></div>`]
            : []),
        ];
        return `<div class="stats stats-vertical shadow bg-base-200 w-full text-sm">
        ${stats.join("\n        ")}
      </div>
      ${capNames ? `<ul class="mt-2 text-base-content/70 space-y-1">${capNames}</ul>` : ""}
      ${handlerNames ? `<ul class="mt-2 text-base-content/70 space-y-1" aria-label="${tStr("ucp.stat_payment_handlers")}">${handlerNames}</ul>` : ""}`;
      });
    }, {
      query: ucpDiscoverQuerySchema,
    })
    .get("/discoveries", ({ set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const result = listUcpDiscoveries(20, 0);
      return JSON.stringify(result);
    })
    .delete("/discoveries/:id", ({ params, set }) => {
      set.headers["content-type"] = JSON_CONTENT_TYPE;
      const id = String(params.id);
      const deleted = deleteUcpDiscovery(id);
      if (!deleted) {
        set.status = 404;
        return JSON.stringify({ error: "Discovery not found." });
      }
      return JSON.stringify({ ok: true });
    });
}
