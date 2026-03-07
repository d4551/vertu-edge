import { ERROR_DISPLAY_MAX_LENGTH, ERROR_DISPLAY_TRUNCATION_OFFSET } from "./config";
import { HTMX_SWAP_INNER } from "./htmx-helpers";
import { type ProviderId } from "./ai-providers";
import { t as tStr, tInterp } from "./i18n";
import { type RequestFieldValue } from "./http-helpers";
import { isTerminalJobState } from "./job-log-stream";
import {
  AI_WORKFLOW_JOBS_ROUTE,
} from "./runtime-constants";
import { esc, renderCommandTable, renderEnvelopeSection, renderStatusEnvelope, serializeEnvelope, type RetryConfig } from "./renderers";
import {
  AI_WORKFLOW_IMAGE_SIZES,
} from "../../contracts/flow-contracts";
import type {
  AiWorkflowCapabilityEnvelope,
  AiWorkflowJobEnvelope,
  AiWorkflowMode,
  AiWorkflowRunEnvelope,
  ProviderValidationEnvelope,
} from "../../contracts/flow-contracts";

/** Selection context used when rendering workflow capability summaries. */
export type AiWorkflowCapabilitySelection = {
  mode: AiWorkflowMode;
  provider?: string;
  model?: string;
};

/** UI state for model selection badges and feedback. */
export type ModelSelectionState = "success" | "empty" | "unauthorized" | "error-retryable" | "error-non-retryable";

function workflowModeHint(mode: AiWorkflowMode): string {
  if (mode === "image") return tStr("ai_workflow.mode_hint_image");
  if (mode === "typography") return tStr("ai_workflow.mode_hint_typography");
  if (mode === "presentation") return tStr("ai_workflow.mode_hint_presentation");
  if (mode === "social") return tStr("ai_workflow.mode_hint_social");
  if (mode === "flow_generation") return tStr("ai_workflow.mode_hint_flow_generation");
  return tStr("ai_workflow.mode_hint_chat");
}

function capabilityBadgeClass(available: boolean): string {
  return available ? "badge-success" : "badge-ghost";
}

function modelSelectionBadgeClass(state: ModelSelectionState): string {
  if (state === "success") return "badge-success";
  if (state === "unauthorized") return "badge-warning";
  if (state === "empty") return "badge-ghost";
  return "badge-error";
}

/** Normalize a raw workflow mode field into the canonical mode union. */
export function parseAiWorkflowModeSelection(value: RequestFieldValue): AiWorkflowMode {
  if (
    value === "chat"
    || value === "typography"
    || value === "presentation"
    || value === "social"
    || value === "image"
    || value === "flow_generation"
  ) {
    return value;
  }

  return "chat";
}

/** Render the text-oriented workflow options fieldset. */
function renderWorkflowTextFields(): string {
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-audience"><span class="label-text text-xs">${tStr("ai_workflow.text_audience")}</span></label>
      <input
        id="floating-chat-audience"
        name="textOptions[audience]"
        type="text"
        class="input input-sm w-full"
        placeholder="${tStr("ai_workflow.text_audience_placeholder")}"
        aria-label="${tStr("ai_workflow.text_audience")}"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-tone"><span class="label-text text-xs">${tStr("ai_workflow.text_tone")}</span></label>
      <input
        id="floating-chat-tone"
        name="textOptions[tone]"
        type="text"
        class="input input-sm w-full"
        placeholder="${tStr("ai_workflow.text_tone_placeholder")}"
        aria-label="${tStr("ai_workflow.text_tone")}"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-format"><span class="label-text text-xs">${tStr("ai_workflow.text_format")}</span></label>
      <input
        id="floating-chat-format"
        name="textOptions[format]"
        type="text"
        class="input input-sm w-full"
        placeholder="${tStr("ai_workflow.text_format_placeholder")}"
        aria-label="${tStr("ai_workflow.text_format")}"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-constraints"><span class="label-text text-xs">${tStr("ai_workflow.text_constraints")}</span></label>
      <input
        id="floating-chat-constraints"
        name="textOptions[constraints]"
        type="text"
        class="input input-sm w-full"
        placeholder="${tStr("ai_workflow.text_constraints_placeholder")}"
        aria-label="${tStr("ai_workflow.text_constraints")}"
      />
    </div>
  </div>`;
}

/** Render the image-oriented workflow options fieldset. */
function renderWorkflowImageFields(): string {
  const imageSizeOptions = AI_WORKFLOW_IMAGE_SIZES.map((size) => `<option value="${size}">${size}</option>`).join("");
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-image-size"><span class="label-text text-xs">${tStr("ai_workflow.image_size")}</span></label>
      <select id="floating-chat-image-size" name="imageOptions[size]" class="select select-sm w-full" aria-label="${tStr("ai_workflow.image_size")}">
        ${imageSizeOptions}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-image-steps"><span class="label-text text-xs">${tStr("ai_workflow.image_steps")}</span></label>
      <input
        id="floating-chat-image-steps"
        name="imageOptions[steps]"
        type="number"
        min="1"
        max="100"
        step="1"
        inputmode="numeric"
        class="input input-sm w-full"
        aria-label="${tStr("ai_workflow.image_steps")}"
        aria-describedby="floating-chat-image-steps-hint"
      />
      <span id="floating-chat-image-steps-hint" class="text-[11px] text-base-content/60">${tStr("ai_workflow.image_steps_hint")}</span>
    </div>
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-image-seed"><span class="label-text text-xs">${tStr("ai_workflow.image_seed")}</span></label>
      <input
        id="floating-chat-image-seed"
        name="imageOptions[seed]"
        type="number"
        step="1"
        inputmode="numeric"
        class="input input-sm w-full"
        aria-label="${tStr("ai_workflow.image_seed")}"
        aria-describedby="floating-chat-image-seed-hint"
      />
      <span id="floating-chat-image-seed-hint" class="text-[11px] text-base-content/60">${tStr("ai_workflow.image_seed_hint")}</span>
    </div>
    <div class="flex flex-col gap-1">
      <label class="label py-0.5" for="floating-chat-image-style"><span class="label-text text-xs">${tStr("ai_workflow.image_style_preset")}</span></label>
      <input
        id="floating-chat-image-style"
        name="imageOptions[stylePreset]"
        type="text"
        class="input input-sm w-full"
        placeholder="${tStr("ai_workflow.image_style_placeholder")}"
        aria-label="${tStr("ai_workflow.image_style_preset")}"
      />
    </div>
  </div>`;
}

/** Render the workflow mode-specific form fields fragment. */
export function renderAiWorkflowFormFields(mode: AiWorkflowMode): string {
  return `<fieldset class="space-y-3" aria-labelledby="floating-chat-workflow-options-legend">
    <legend id="floating-chat-workflow-options-legend" class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${tStr("ai_workflow.options_label")}</legend>
    <div class="alert alert-soft alert-info text-xs" role="status" aria-live="polite">
      <span>${esc(workflowModeHint(mode))}</span>
    </div>
    ${mode === "image" ? renderWorkflowImageFields() : renderWorkflowTextFields()}
  </fieldset>`;
}

/** Render the workflow run result bubble stack with optional artifact preview. */
export function renderAiWorkflowRunState(
  route: string,
  envelope: AiWorkflowRunEnvelope,
  userMessage?: string,
): string {
  const details = envelope.mismatches ?? [];
  const result = envelope.data;
  if (envelope.state === "success" && result) {
    const userBubble = userMessage
      ? `<div class="chat chat-end"><div class="chat-bubble chat-bubble-neutral text-sm whitespace-pre-wrap">${esc(userMessage)}</div></div>`
      : "";
    const assistantBubble = `<div class="chat chat-start"><div class="chat-bubble chat-bubble-primary text-sm whitespace-pre-wrap">${esc(result.reply)}</div></div>`;
    const imagePreview = result.artifact?.mimeType.startsWith("image/")
      ? `<figure class="rounded-box overflow-hidden border border-base-content/10 bg-base-100/60">
        <img
          src="${esc(result.artifact.artifactPath)}"
          alt="${esc(tStr("ai_workflow.image_preview_alt"))}"
          class="w-full h-auto object-cover"
          loading="lazy"
        />
      </figure>`
      : "";
    const artifactCard = result.artifact
      ? `<div class="card vertu-glass border-base-content/10 mt-2">
        <div class="card-body p-3 text-xs">
          ${imagePreview}
          <p><span class="font-semibold">${esc(tStr("ai_workflow.artifact"))}:</span> ${esc(result.artifact.mimeType)}</p>
          <p><span class="font-semibold">${esc(tStr("ai_workflow.provider_path"))}:</span> ${esc(result.providerPath)}</p>
          <a
            class="link link-primary"
            href="${esc(result.artifact.artifactPath)}"
            target="_blank"
            rel="noopener"
            aria-label="${esc(tStr("ai_workflow.open_artifact_aria"))}"
          >${esc(tStr("ai_workflow.open_artifact"))}</a>
        </div>
      </div>`
      : "";
    const mismatchBlock = details.length > 0
      ? `<div class="text-xs mt-2 alert alert-warning" role="alert" aria-live="polite">${details.map((line) => `<p>${esc(line)}</p>`).join("")}</div>`
      : "";
    return `<section class="space-y-2" data-state="${envelope.state}" data-envelope="${serializeEnvelope(route, envelope)}" aria-live="polite">
      ${userBubble}
      ${assistantBubble}
      ${artifactCard}
      ${mismatchBlock}
    </section>`;
  }

  return renderStatusEnvelope(
    route,
    envelope,
    tStr("api.request_failed"),
    envelope.error?.reason ?? tStr("api.request_failed"),
    details,
  );
}

/** Render the async workflow job state and auto-polling fragment. */
export function renderAiWorkflowJobState(route: string, envelope: AiWorkflowJobEnvelope): string {
  const data = envelope.data;
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const jobContainerId = envelope.jobId ? `chat-job-${envelope.jobId}` : "chat-job-unknown";
  const isPending = data ? !isTerminalJobState(data.status) : envelope.state === "loading";

  // When the job has completed with a result, render as a chat bubble
  if (data?.result && !isPending) {
    const conversationIdScript = data.result.conversationId
      ? `<script>document.getElementById('floating-chat-conversation-id').value='${data.result.conversationId}'</script>`
      : "";
    const assistantBubble = renderChatMessage("assistant", data.result.reply, {
      provider: data.result.requestedProvider,
      model: data.result.effectiveModel,
    });
    const imagePreview = data.result.artifact?.mimeType.startsWith("image/")
      ? `<figure class="rounded-box overflow-hidden border border-base-content/10 bg-base-100/60 max-w-sm">
        <img src="${esc(data.result.artifact.artifactPath)}" alt="${esc(tStr("ai_workflow.image_preview_alt"))}" class="w-full h-auto object-cover" loading="lazy" />
      </figure>`
      : "";
    const artifactLink = data.result.artifact
      ? `<div class="text-xs ml-12 mb-2"><a class="link link-primary" href="${esc(data.result.artifact.artifactPath)}" target="_blank" rel="noopener">${esc(tStr("ai_workflow.open_artifact"))}</a></div>`
      : "";
    const mismatchBlock = details.length > 0
      ? `<div class="text-xs mt-1 ml-12 alert alert-warning" role="alert" aria-live="polite">${details.map((line) => `<p>${esc(line)}</p>`).join("")}</div>`
      : "";
    return `<div id="${jobContainerId}" data-job-terminal="true" aria-live="polite">${assistantBubble}${imagePreview}${artifactLink}${mismatchBlock}${conversationIdScript}</div>`;
  }

  // Pending or error state: show a loading/status indicator that self-polls
  const summary = data
    ? tInterp("api.status_summary_correlation", { status: data.status, correlationId: data.correlationId })
    : tStr("ai_workflow.no_data");
  const refreshButton = envelope.jobId
    ? `<button class="btn btn-outline btn-xs" hx-get="${AI_WORKFLOW_JOBS_ROUTE}/${envelope.jobId}" hx-target="#${jobContainerId}" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("ai_workflow.refresh_status")}</button>`
    : "";
  const cancelButton = envelope.jobId && isPending
    ? `<button class="btn btn-outline btn-warning btn-xs" hx-post="${AI_WORKFLOW_JOBS_ROUTE}/${envelope.jobId}/cancel" hx-target="#${jobContainerId}" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("layout.confirm_modal_cancel")}</button>`
    : "";
  const logsLink = envelope.jobId
    ? `<a class="link link-primary text-xs" href="${AI_WORKFLOW_JOBS_ROUTE}/${envelope.jobId}/logs" target="_blank" rel="noopener">${tStr("api.logs_sse")}</a>`
    : "";
  const jobPollAttrs = envelope.jobId && isPending
    ? ` hx-ext="job-poll" job-poll-url="${AI_WORKFLOW_JOBS_ROUTE}/${envelope.jobId}" job-poll-target="#${jobContainerId}" job-poll-swap="${HTMX_SWAP_INNER}" job-poll-interval="2s"`
    : "";

  // Error terminal state
  if (!isPending) {
    const errorMessage = envelope.error?.reason ?? tStr("api.request_failed");
    return `<div id="${jobContainerId}" data-job-terminal="true" aria-live="polite">
      <div class="chat chat-start"><div class="chat-bubble chat-bubble-error text-sm">${esc(errorMessage)}</div></div>
      <div class="flex flex-wrap gap-2 ml-12">${refreshButton}${logsLink}</div>
    </div>`;
  }

  return `<div id="${jobContainerId}"${jobPollAttrs} aria-live="polite">
    ${renderStatusEnvelope(route, envelope, tStr("ai_workflow.job_title"), summary, details)}
    <div class="flex flex-wrap gap-2">${cancelButton}${refreshButton}${logsLink}</div>
    <div class="text-xs text-base-content/70">${tStr("ai_workflow.result_pending")}</div>
  </div>`;
}

/** Render the local/remote capability matrix for workflow modes. */
export function renderAiWorkflowCapabilitiesState(
  route: string,
  envelope: AiWorkflowCapabilityEnvelope,
  selection?: AiWorkflowCapabilitySelection,
): string {
  const rows = envelope.data?.modes.map((mode) => {
    const selected = selection?.mode === mode.mode;
    return `<tr${selected ? ' class="bg-base-200/60"' : ""}>
      <td><code>${esc(mode.mode)}</code></td>
      <td>${mode.localAvailable ? `<span class="badge badge-success badge-sm">${esc(tStr("api.yes"))}</span>` : `<span class="badge badge-ghost badge-sm">${esc(tStr("api.no"))}</span>`}</td>
      <td>${mode.remoteAvailable ? `<span class="badge badge-success badge-sm">${esc(tStr("api.yes"))}</span>` : `<span class="badge badge-ghost badge-sm">${esc(tStr("api.no"))}</span>`}</td>
      <td>${esc(mode.reason ?? "")}</td>
    </tr>`;
  }).join("") ?? "";
  const details = envelope.mismatches ?? [];
  const selectedMode = selection ? envelope.data?.modes.find((mode) => mode.mode === selection.mode) : undefined;
  const selectedSummary = selectedMode
    ? `<div class="card vertu-glass border-base-content/10">
      <div class="card-body p-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge badge-outline badge-sm">${esc(tStr("ai_workflow.selected_mode"))}: ${esc(selectedMode.mode)}</span>
          <span class="badge badge-sm ${capabilityBadgeClass(selectedMode.localAvailable)}">${esc(tStr("ai_workflow.local"))}: ${esc(selectedMode.localAvailable ? tStr("api.yes") : tStr("api.no"))}</span>
          <span class="badge badge-sm ${capabilityBadgeClass(selectedMode.remoteAvailable)}">${esc(tStr("ai_workflow.remote"))}: ${esc(selectedMode.remoteAvailable ? tStr("api.yes") : tStr("api.no"))}</span>
        </div>
        <ul class="text-xs text-base-content/70 space-y-1" aria-label="${esc(tStr("ai_workflow.capability_summary"))}">
          <li>${esc(tStr("ai_workflow.selected_provider"))}: ${esc(selection?.provider?.trim() || tStr("ai_workflow.auto"))}</li>
          <li>${esc(tStr("ai_workflow.selected_model"))}: ${esc(selection?.model?.trim() || tStr("ai_workflow.auto"))}</li>
          ${selectedMode.reason ? `<li>${esc(selectedMode.reason)}</li>` : ""}
        </ul>
      </div>
    </div>`
    : "";
  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("ai_workflow.capability_title"), tStr("ai_workflow.capability_summary"), details)}
    ${selectedSummary}
    ${rows.length > 0 ? renderCommandTable(rows, [tStr("ai_workflow.mode"), tStr("ai_workflow.local"), tStr("ai_workflow.remote"), tStr("api.table_reason")], tStr("ai_workflow.capability_title")) : ""}`,
  );
}

/** Render provider validation summary and stats. */
export function renderProviderValidationState(route: string, envelope: ProviderValidationEnvelope): string {
  const message = envelope.data
    ? tInterp("api.provider_validation_summary_template", {
      reachable: String(envelope.data.reachableCount),
      total: String(envelope.data.total),
      configured: String(envelope.data.configuredCount),
    })
    : tStr("api.request_failed");
  const details = envelope.mismatches ?? [];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const retryConfig: RetryConfig | undefined = envelope.state === "error-retryable"
    ? { method: "post", url: "/api/ai/providers/validate", include: "#providers-validation-form", targetId: "providers-validation-result", spinnerId: "providers-validate-spinner" }
    : undefined;
  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("ai_providers.validation_summary"), message, details, retryConfig)}
    ${envelope.data ? `<div class="stats stats-vertical lg:stats-horizontal shadow bg-base-200">
      <div class="stat">
        <div class="stat-title">${tStr("ai_providers.validation_providers_stat")}</div>
        <div class="stat-value text-lg">${envelope.data.total}</div>
      </div>
      <div class="stat">
        <div class="stat-title">${tStr("ai_providers.validation_configured")}</div>
        <div class="stat-value text-lg">${envelope.data.configuredCount}</div>
      </div>
      <div class="stat">
        <div class="stat-title">${tStr("ai_providers.validation_reachable")}</div>
        <div class="stat-value text-lg">${envelope.data.reachableCount}</div>
      </div>
    </div>` : ""}`,
  );
}

/** Sanitize provider transport errors for user-facing display. */
export function sanitizeApiErrorForDisplay(error: string): string {
  const trimmed = error.trim();
  if (!trimmed) return tStr("api.unknown_error");
  const jsonMatch = trimmed.match(/\{"error"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) {
    const message = jsonMatch[1].trim();
    return message.length > ERROR_DISPLAY_MAX_LENGTH ? message.slice(0, ERROR_DISPLAY_MAX_LENGTH - ERROR_DISPLAY_TRUNCATION_OFFSET) + "…" : message;
  }

  const withoutStatus = trimmed.replace(/^\d{3}:\s*/, "");
  return withoutStatus.length > ERROR_DISPLAY_MAX_LENGTH ? withoutStatus.slice(0, ERROR_DISPLAY_MAX_LENGTH - ERROR_DISPLAY_TRUNCATION_OFFSET) + "…" : withoutStatus;
}

/** Render the status fragment paired with provider model select options. */
function renderModelSelectionState(
  providerId: ProviderId,
  state: ModelSelectionState,
  message: string,
  stateId?: string,
): string {
  const targetId = stateId ?? `model-state-${providerId}`;
  const isError = state === "error-retryable" || state === "error-non-retryable";
  const alertClass = state === "error-retryable" ? "alert-warning" : "alert-error";
  const retryHint = state === "error-retryable" ? ` ${tStr("api.models_load_retry_hint")}` : "";
  if (isError) {
    return `<div id="${targetId}" class="text-xs min-h-[1.25rem]" role="alert" aria-live="polite" data-state="${state}" hx-swap-oob="outerHTML"><div class="alert ${alertClass} shadow-sm text-sm py-2">${esc(message)}${esc(retryHint)}</div></div>`;
  }

  return `<div id="${targetId}" class="text-xs min-h-[1.25rem]" role="status" aria-live="polite" data-state="${state}" hx-swap-oob="outerHTML"><span class="badge badge-sm ${modelSelectionBadgeClass(state)}">${esc(message)}</span></div>`;
}

/** Render provider model options plus the companion status fragment. */
export function renderModelSelectionOptions(
  providerId: ProviderId,
  optionsHtml: string,
  state: ModelSelectionState,
  message: string,
  stateId?: string,
): string {
  return `${optionsHtml}${renderModelSelectionState(providerId, state, message, stateId)}`;
}

/** Build the `<option>` rows for a provider model selector. */
export function buildModelSelectOptions(
  models: readonly string[],
  selectedModel: string | undefined,
): string {
  const hasSelected = Boolean(selectedModel && selectedModel.trim().length > 0);
  const placeholder = `<option value="" disabled ${hasSelected ? "" : "selected"}>${esc(tStr("api.model_selection_placeholder"))}</option>`;
  const optionRows = models
    .map((name) => `<option value="${esc(name)}"${name === selectedModel ? " selected" : ""}>${esc(name)}</option>`)
    .join("");
  return `${placeholder}${optionRows}`;
}

/** Render a single chat message as a DaisyUI chat bubble. */
export function renderChatMessage(
  role: string,
  content: string,
  metadata?: { provider?: string | null; model?: string | null; createdAt?: string },
): string {
  const isUser = role === "user";
  const bubbleClass = isUser ? "chat chat-end" : "chat chat-start";
  const headerText = isUser ? esc(tStr("chat.message_you")) : esc(tStr("chat.message_assistant"));
  const bubbleVariant = isUser ? "chat-bubble-primary" : "chat-bubble-secondary";
  const modelBadge = !isUser && metadata?.model
    ? ` <span class="badge badge-ghost badge-xs ml-1">${esc(metadata.model)}</span>`
    : "";
  const timeStamp = metadata?.createdAt
    ? `<time class="text-xs opacity-50 ml-1">${esc(metadata.createdAt)}</time>`
    : "";
  return `<div class="${bubbleClass}"><div class="chat-header text-xs opacity-60">${headerText}${modelBadge}${timeStamp}</div><div class="${bubbleVariant} chat-bubble text-sm whitespace-pre-wrap">${esc(content)}</div></div>`;
}
