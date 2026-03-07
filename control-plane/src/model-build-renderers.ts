import { htmxSpinner, HTMX_SWAP_INNER } from "./htmx-helpers";
import { APP_BUILD_ARTIFACT_PENDING_LABEL } from "./config";
import { t as tStr, tInterp } from "./i18n";
import { esc, renderEnvelopeSection, renderStatusEnvelope } from "./renderers";
import { renderLiveLogTable } from "./job-log-stream";
import { toSafeDomIdSegment } from "./http-helpers";
import {
  APP_BUILD_ROUTE,
  MODEL_PULL_ROUTE,
  MODEL_SEARCH_ROUTE,
} from "./runtime-constants";
import type {
  AppBuildFailureCode,
  AppBuildEnvelope,
  HfModelSearchHit,
  ModelPullEnvelope,
  ModelSearchEnvelope,
} from "../../contracts/flow-contracts";
import { isAppBuildFailureCode } from "../../contracts/flow-contracts";

/** Render the model-pull status envelope used by the model management UI. */
export function renderModelPullState(route: string, envelope: ModelPullEnvelope): string {
  const pollPath = envelope.jobId ? `${MODEL_PULL_ROUTE}/${envelope.jobId}` : route;
  const data = envelope.data;
  const summary = data
    ? `requested=${data.requestedModelRef}, normalized=${data.normalizedModelRef}, status=${data.status}`
    : tStr("api.no_data");
  const dataRows = data
    ? `<ul class="text-xs list-disc list-inside space-y-1">
      <li>${tStr("api.envelope_job_id")}: ${esc(envelope.jobId)}</li>
      <li>${tStr("api.envelope_requested_model")}: ${esc(data.requestedModelRef)}</li>
      <li>${tStr("api.envelope_normalized_model")}: ${esc(data.normalizedModelRef)}</li>
      <li>${tStr("api.envelope_exit_code")}: ${data.exitCode === null ? "-" : String(data.exitCode)}</li>
    </ul>`
    : "";
  const details = [`${tStr("api.envelope_state")}: ${envelope.state}`, ...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const refreshButton = envelope.state === "loading"
    ? `<button class="btn btn-outline btn-xs" hx-get="${pollPath}" hx-target="#model-pull-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#model-pull-refresh-spinner" hx-disabled-elt="this">${tStr("model_mgmt.refresh")}${htmxSpinner("model-pull-refresh-spinner", "ml-1")}</button>`
    : "";
  const cancelButton = envelope.jobId && envelope.state === "loading"
    ? `<button class="btn btn-outline btn-xs btn-warning" hx-post="${MODEL_PULL_ROUTE}/${envelope.jobId}/cancel" hx-target="#model-pull-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("model_pull.cancel")}</button>`
    : "";
  const resumeButton = envelope.jobId && envelope.state !== "loading"
    ? `<button class="btn btn-outline btn-xs" hx-post="${MODEL_PULL_ROUTE}/${envelope.jobId}/resume" hx-target="#model-pull-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("model_pull.resume")}</button>`
    : "";
  const logsLink = envelope.jobId
    ? `<a class="link link-primary text-xs" href="${MODEL_PULL_ROUTE}/${envelope.jobId}/logs" target="_blank" rel="noopener">${tStr("api.logs_sse")}</a>`
    : "";
  const artifactLink = data?.artifactPath
    ? `<a class="link link-primary text-xs" href="${esc(data.artifactPath)}" target="_blank" rel="noopener">${tStr("api.open_artifact")}</a>`
    : "";
  const inlineLogs = envelope.jobId
    ? renderLiveLogTable(`model-pull-log-stream-${toSafeDomIdSegment(envelope.jobId)}`, `${MODEL_PULL_ROUTE}/${envelope.jobId}/logs?format=html&tail=1`)
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.model_pull_title"), summary, details)}
    ${dataRows}
    <div class="flex flex-wrap gap-2">
      ${refreshButton}
      ${cancelButton}
      ${resumeButton}
      ${logsLink}
      ${artifactLink}
    </div>
    ${inlineLogs}`,
  );
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function buildFailureLabel(code: AppBuildFailureCode): string {
  return tStr(`app_build.failure_${code}`);
}

function resolveBuildFailureCode(envelope: AppBuildEnvelope): AppBuildFailureCode | null {
  if (envelope.data?.failureCode) {
    return envelope.data.failureCode;
  }
  const code = envelope.error?.code;
  return code && isAppBuildFailureCode(code) ? code : null;
}

/** Render the Hugging Face model search fragment used by server-driven search results. */
export function renderModelSearchState(route: string, envelope: ModelSearchEnvelope): string {
  if (envelope.state === "loading") {
    return renderStatusEnvelope(route, envelope, tStr("model_search.title"), tStr("model_search.searching"));
  }
  if (envelope.state === "empty") {
    return renderStatusEnvelope(route, envelope, tStr("model_search.title"), tStr("model_search.no_results"));
  }
  if (envelope.state === "error-retryable" || envelope.state === "error-non-retryable") {
    return renderStatusEnvelope(
      route,
      envelope,
      tStr("model_search.title"),
      envelope.error?.reason ?? tStr("model_search.error"),
      envelope.mismatches ?? [],
      envelope.state === "error-retryable"
        ? { method: "get", url: MODEL_SEARCH_ROUTE, targetId: "model-search-result" }
        : undefined,
    );
  }

  const data = envelope.data;
  if (!data) {
    return renderStatusEnvelope(route, envelope, tStr("model_search.title"), tStr("model_search.no_results"));
  }
  const countBadge = `<span class="badge badge-primary badge-sm">${data.totalResults}</span>`;
  const heading = `${countBadge} ${esc(tInterp("model_search.results_count", { count: String(data.totalResults) }))}`;
  const cards = data.models
    .map((model: HfModelSearchHit) => {
      const tag = model.pipelineTag ? `<span class="badge badge-ghost badge-xs">${esc(model.pipelineTag)}</span>` : "";
      return `<div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors">
        <div class="min-w-0 flex-1">
          <p class="font-mono text-xs truncate font-medium">${esc(model.id)}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[10px] text-base-content/55" aria-label="${esc(tStr("model_search.downloads"))}">⬇ ${formatCompact(model.downloads)}</span>
            <span class="text-[10px] text-base-content/55" aria-label="${esc(tStr("model_search.likes"))}">♡ ${formatCompact(model.likes)}</span>
            ${tag}
          </div>
        </div>
        <button type="button" class="btn btn-outline btn-xs shrink-0"
          data-preset-target="model-ref-input" data-preset-value="${esc(model.id)}"
          aria-label="${esc(tInterp("model_search.use_aria", { model: model.id }))}">${tStr("model_search.use_model")}</button>
      </div>`;
    })
    .join("\n");

  return renderEnvelopeSection(
    route,
    envelope,
    `<div class="space-y-2">
      <p class="text-sm">${heading}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">${cards}</div>
    </div>`,
  );
}

/** Render the app-build job state with HTMX controls and inline log tailing. */
export function renderAppBuildState(route: string, envelope: AppBuildEnvelope): string {
  const pollPath = envelope.jobId ? `${APP_BUILD_ROUTE}/${envelope.jobId}` : route;
  const data = envelope.data;
  const summary = data
    ? `${data.platform} buildType=${data.buildType}, artifact=${data.artifactPath ?? APP_BUILD_ARTIFACT_PENDING_LABEL}`
    : tStr("api.no_data");
  const dataRows = data
    ? `<ul class="text-xs list-disc list-inside space-y-1">
      <li>${tStr("api.envelope_platform")}: ${esc(data.platform)}</li>
      <li>${tStr("api.envelope_build_type")}: ${esc(data.buildType)}</li>
      <li>${tStr("api.envelope_exit_code")}: ${data.exitCode === null ? "-" : String(data.exitCode)}</li>
      <li>${tStr("api.envelope_elapsed_ms")}: ${data.elapsedMs}</li>
    </ul>`
    : "";
  const details = [`${tStr("api.envelope_state")}: ${envelope.state}`, ...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }
  const failureCode = resolveBuildFailureCode(envelope);
  if (failureCode) {
    details.push(buildFailureLabel(failureCode));
  }

  const refreshButton = envelope.state === "loading"
    ? `<button class="btn btn-outline btn-xs" hx-get="${pollPath}" hx-target="#app-build-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#app-build-refresh-spinner" hx-disabled-elt="this">${tStr("app_build.refresh")}${htmxSpinner("app-build-refresh-spinner", "ml-1")}</button>`
    : "";
  const cancelButton = envelope.jobId && envelope.state === "loading"
    ? `<button class="btn btn-outline btn-xs btn-warning" hx-post="${APP_BUILD_ROUTE}/${envelope.jobId}/cancel" hx-target="#app-build-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("layout.confirm_modal_cancel")}</button>`
    : "";
  const resumeButton = envelope.jobId && envelope.state !== "loading"
    ? `<button class="btn btn-outline btn-xs" hx-post="${APP_BUILD_ROUTE}/${envelope.jobId}/resume" hx-target="#app-build-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("api.resume")}</button>`
    : "";
  const logsLink = envelope.jobId
    ? `<a class="link link-primary text-xs" href="${APP_BUILD_ROUTE}/${envelope.jobId}/logs" target="_blank" rel="noopener">${tStr("api.logs_sse")}</a>`
    : "";
  const artifactLink = data?.artifactPath
    ? `<a class="link link-primary text-xs" href="${esc(data.artifactPath)}" target="_blank" rel="noopener">${tStr("api.open_artifact")}</a>`
    : "";
  const inlineLogs = envelope.jobId
    ? renderLiveLogTable(`app-build-log-stream-${toSafeDomIdSegment(envelope.jobId)}`, `${APP_BUILD_ROUTE}/${envelope.jobId}/logs?format=html&tail=1`)
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.app_build_title"), summary, details)}
    ${dataRows}
    <div class="flex flex-wrap gap-2">
      ${refreshButton}
      ${cancelButton}
      ${resumeButton}
      ${logsLink}
      ${artifactLink}
    </div>
    ${inlineLogs}`,
  );
}
