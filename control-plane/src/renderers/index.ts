/**
 * Shared HTML renderers for control-plane envelope and status UI.
 */

import { t as tStr } from "../i18n";
import { htmxSpinner, HTMX_SWAP_INNER } from "../htmx-helpers";
import type { ControlPlaneState } from "../config";
import type { ApiEnvelope, ModelPullEnvelope, AppBuildEnvelope } from "../../../contracts/flow-contracts";

/** Escape user-controlled content before injecting into HTML. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Map response states to alert styles in UI. */
export function alertClassForState(state: ControlPlaneState): string {
  if (state === "success") return "alert-success";
  if (state === "empty") return "alert-info";
  if (state === "error-retryable" || state === "error-non-retryable") return "alert-error";
  if (state === "loading") return "alert-info";
  if (state === "unauthorized") return "alert-warning";
  return "";
}

const SVG_SUCCESS =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
const SVG_ERROR =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
const SVG_WARNING =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
const SVG_INFO =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';

function alertIconForState(state: ControlPlaneState): string {
  if (state === "success") return SVG_SUCCESS;
  if (state === "error-retryable" || state === "error-non-retryable") return SVG_ERROR;
  if (state === "unauthorized") return SVG_WARNING;
  return SVG_INFO;
}

/** Return a consistent JSON envelope string for client-side inspection. */
export function serializeEnvelope(route: string, envelope: ApiEnvelope): string {
  return esc(JSON.stringify({ ...envelope, route }));
}

/** Wrap envelope content in a section with data-state and data-envelope. */
export function renderEnvelopeSection(route: string, envelope: ApiEnvelope, innerHtml: string): string {
  return `<section class="space-y-3" data-state="${envelope.state}" data-envelope="${serializeEnvelope(route, envelope)}">
${innerHtml}
  </section>`;
}

export interface RetryConfig {
  method: "get" | "post";
  url: string;
  include?: string;
  targetId: string;
  spinnerId?: string;
}

/** Render a generic stateful alert envelope. */
export function renderStatusEnvelope(
  route: string,
  envelope: ApiEnvelope,
  heading: string,
  message: string,
  details: readonly string[] = [],
  retryConfig?: RetryConfig,
): string {
  if (envelope.state === "loading") {
    return `<section class="space-y-3" role="status" aria-live="polite" data-state="${envelope.state}" data-envelope="${serializeEnvelope(route, envelope)}">
      <div class="flex items-center gap-3">
        <span class="loading loading-spinner loading-sm"></span>
        <div class="space-y-2 flex-1">
          <div class="skeleton h-4 w-3/4"></div>
          <div class="skeleton h-3 w-1/2"></div>
        </div>
      </div>
    </section>`;
  }

  const detailsMarkup = details.length > 0
    ? `<ul class="list-disc list-inside text-xs mt-2 space-y-1">${details.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
    : "";

  const icon = alertIconForState(envelope.state);
  const alertClass = alertClassForState(envelope.state);

  const retryBtn =
    envelope.state === "error-retryable" && retryConfig
      ? `<div class="mt-2"><button class="btn btn-outline btn-xs" hx-${retryConfig.method}="${esc(retryConfig.url)}" hx-target="#${esc(retryConfig.targetId)}" hx-swap="${HTMX_SWAP_INNER}" ${retryConfig.include ? `hx-include="${esc(retryConfig.include)}"` : ""} ${retryConfig.spinnerId ? `hx-indicator="#${esc(retryConfig.spinnerId)}"` : ""} hx-disabled-elt="this" aria-label="${esc(tStr("api.retry"))}">${tStr("api.retry")}</button></div>`
      : "";

  return `<section class="space-y-3" role="status" aria-live="polite" data-state="${envelope.state}" data-envelope="${serializeEnvelope(route, envelope)}">
    <div role="alert" class="alert ${alertClass}">
      ${icon}
      <div>
        <span>${esc(heading)}: ${esc(message)}</span>
        ${detailsMarkup}
        ${retryBtn}
      </div>
    </div>
  </section>`;
}

/** Render a command/result table with configurable headers. */
export function renderCommandTable(
  rows: string,
  headers: readonly string[] = [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_state"), tStr("api.table_details")],
  ariaLabel?: string,
): string {
  const wrapperAttrs = ariaLabel ? ` class="overflow-x-auto" role="region" aria-label="${esc(ariaLabel)}"` : ' class="overflow-x-auto"';
  return `<div${wrapperAttrs}>
    <table class="table table-zebra table-sm table-pin-cols">
      <thead>
        <tr>
          <th>${headers.map((h) => esc(h)).join("</th>\n          <th>")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** Render a polling envelope (model pull, app build) with data list, refresh button, and artifact link. */
export function renderPollingEnvelope(
  route: string,
  envelope: ModelPullEnvelope | AppBuildEnvelope,
  config: {
    title: string;
    summary: string;
    dataRows: string;
    pollPath: string;
    targetId: string;
    spinnerId: string;
    artifactPath?: string;
    refreshLabel?: string;
    artifactLabel?: string;
  },
): string {
  const details = [
    `${tStr("api.envelope_state")}: ${envelope.state}`,
    ...(envelope.mismatches ?? []),
  ];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const refreshLabel = config.refreshLabel ?? tStr("model_mgmt.refresh");
  const artifactLabel = config.artifactLabel ?? tStr("api.open_artifact");
  const showRefreshBtn = envelope.state === "loading" || envelope.state === "error-retryable";
  const refreshBtn =
    showRefreshBtn
      ? `<button class="btn btn-outline btn-xs" hx-get="${config.pollPath}" hx-target="${config.targetId}" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#${config.spinnerId}" hx-disabled-elt="this" aria-label="${esc(tStr("api.retry"))}">${envelope.state === "error-retryable" ? tStr("api.retry") : refreshLabel}${htmxSpinner(config.spinnerId, "ml-1")}</button>`
      : "";
  const artifactLink = config.artifactPath
    ? `<a class="link link-primary text-xs" href="${esc(config.artifactPath)}" target="_blank" rel="noopener">${artifactLabel}</a>`
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, config.title, config.summary, details)}
    ${config.dataRows}
    <div class="flex flex-wrap gap-2">
      ${refreshBtn}
      ${artifactLink}
    </div>`,
  );
}
