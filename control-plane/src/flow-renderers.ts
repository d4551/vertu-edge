import { HTMX_SWAP_INNER } from "./htmx-helpers";
import { DEFAULT_FLOW_TARGET, FLOW_NO_ATTEMPTS_MESSAGE, FLOW_PENDING_STATE_LABEL } from "./config";
import { isTerminalJobState } from "./job-log-stream";
import { t as tStr, tInterp } from "./i18n";
import { type FlowRunResult, type FlowRunAction, type FlowCommandResult, type FlowRunEnvelope, type FlowRunJobEnvelope, type FlowRuntimeError, type FlowValidateEnvelope, type FlowAutomationValidateEnvelope, type FlowValidationResult, type FlowCapabilityMatrixEnvelope } from "../../contracts/flow-contracts";
import { esc, renderCommandTable, renderEnvelopeSection, renderStatusEnvelope } from "./renderers";
import { renderLiveLogTable } from "./job-log-stream";
import { toSafeDomIdSegment } from "./http-helpers";

type RuntimeErrorRecord = {
  reason?: string;
  command?: string;
  commandIndex?: number;
};

type FlowRunRoute = "/api/flows/run" | "/api/flows/trigger";

function isFlowRuntimeError(error: RuntimeErrorRecord | FlowRuntimeError | null): error is FlowRuntimeError {
  if (error === null || typeof error !== "object") {
    return false;
  }

  return (
    typeof error.reason === "string"
    && typeof error.command === "string"
    && typeof error.commandIndex === "number"
  );
}

/** Render the artifact cell for a flow command result table. */
function renderFlowArtifactCell(artifactPath: string | null | undefined): string {
  if (!artifactPath) {
    return '<span class="text-base-content/55">-</span>';
  }

  return `<a class="link link-primary text-xs font-mono" href="${esc(artifactPath)}" target="_blank" rel="noopener">${esc(artifactPath)}</a>`;
}

/** Render the command result rows for flow execution and validation tables. */
function renderFlowCommandResultRows(
  results: readonly FlowCommandResult[],
  includeArtifacts: boolean,
): string {
  if (results.length === 0) {
    return `<tr><td colspan="${includeArtifacts ? 5 : 4}" class="text-base-content/60">${tStr("api.flows_no_yaml_detail")}</td></tr>`;
  }

  return results
    .map((item) => {
      const stateClass = item.state === "success" ? "text-success" : "text-error";
      const details = item.error
        ? `<span class="text-xs block">${esc(`${item.error.reason}${item.error.retryable ? " (retryable)" : ""}`)}</span>`
        : "";
      const artifact = includeArtifacts
        ? `<td>${renderFlowArtifactCell(item.artifactPath)}</td>`
        : "";
      return `<tr>
        <td>${item.commandIndex + 1}</td>
        <td><code>${esc(item.commandType)}</code></td>
        <td class="${stateClass}">${esc(item.state)}</td>
        <td>${esc(item.message)}${details}</td>
        ${artifact}
      </tr>`;
    })
    .join("");
}

/** Render policy settings applied to a flow run. */
function renderFlowRunPolicySummary(data: FlowRunResult): string {
  if (!data.policy) {
    return `<div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full text-sm">
      <div class="stat">
        <div class="stat-title">${tStr("flow_engine.stat_target")}</div>
        <div class="stat-value text-sm">${data.target ?? DEFAULT_FLOW_TARGET}</div>
      </div>
    </div>`;
  }

  return `<div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full text-sm">
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_target")}</div>
      <div class="stat-value text-sm">${data.target ?? DEFAULT_FLOW_TARGET}</div>
    </div>
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_max_attempts")}</div>
      <div class="stat-value text-lg">${data.policy.maxAttempts}</div>
    </div>
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_timeout")}</div>
      <div class="stat-value text-lg">${data.policy.commandTimeoutMs}ms</div>
    </div>
    <div class="stat">
      <div class="stat-title">${tStr("flow_engine.stat_retry_delay")}</div>
      <div class="stat-value text-lg">${data.policy.retryDelayMs}ms</div>
    </div>
  </div>`;
}

/** Render the high-level action summary rows for a flow run. */
function renderFlowActionSummaryRows(actions: readonly FlowRunAction[]): string {
  if (actions.length === 0) {
    return `<tr><td colspan="6" class="text-base-content/60">${tStr("api.no_action_telemetry")}</td></tr>`;
  }

  return actions
    .map((action) => {
      const lastAttempt = action.attempts.at(-1);
      const stateClass = lastAttempt?.state === "success" ? "text-success" : "text-error";
      return `<tr>
        <td>${action.commandIndex + 1}</td>
        <td><code>${esc(action.commandType)}</code></td>
        <td><span class="badge badge-ghost badge-sm">${esc(action.target)}</span></td>
        <td>${action.attempts.length}</td>
        <td class="${stateClass}">${esc(lastAttempt?.state ?? FLOW_PENDING_STATE_LABEL)}</td>
        <td>${esc(lastAttempt?.message ?? FLOW_NO_ATTEMPTS_MESSAGE)}</td>
      </tr>`;
    })
    .join("");
}

/** Render the attempt timeline rows for all flow actions. */
function renderFlowAttemptRows(actions: readonly FlowRunAction[]): string {
  const rows = actions.flatMap((action) => {
    if (action.attempts.length === 0) {
      return `<tr>
        <td>${action.commandIndex + 1}</td>
        <td>${action.commandIndex + 1}.0</td>
        <td><code>${esc(action.commandType)}</code></td>
        <td><span class="badge badge-ghost badge-sm">${esc(action.target)}</span></td>
        <td class="text-base-content/60">not-run</td>
        <td class="text-xs">-</td>
        <td class="text-xs">-</td>
        <td class="text-xs">-</td>
        <td class="text-xs">${FLOW_NO_ATTEMPTS_MESSAGE}</td>
      </tr>`;
    }

    return action.attempts.map((attempt) => {
      const stateClass = attempt.state === "success" ? "text-success" : "text-error";
      const details = attempt.error
        ? `<span class="text-xs block">${esc(`${attempt.error.reason}${attempt.error.retryable ? " (retryable)" : ""}`)}</span>`
        : "";
      return `<tr>
        <td>${action.commandIndex + 1}</td>
        <td>${action.commandIndex + 1}.${attempt.attempt}</td>
        <td><code>${esc(action.commandType)}</code></td>
        <td><span class="badge badge-ghost badge-sm">${esc(action.target)}</span></td>
        <td class="${stateClass}">${esc(attempt.state)}</td>
        <td>${attempt.durationMs}ms</td>
        <td class="text-xs">${esc(attempt.startedAt)}</td>
        <td class="text-xs">${esc(attempt.endedAt)}</td>
        <td>${esc(attempt.message)}${details}</td>
      </tr>`;
    });
  });

  if (rows.length === 0) {
    return `<tr><td colspan="9" class="text-base-content/60">${tStr("api.no_attempt_telemetry")}</td></tr>`;
  }

  return rows.join("");
}

/** Convert validation metadata into command result rows for the shared table renderer. */
function buildValidationCommandRows(data: FlowValidationResult): readonly FlowCommandResult[] {
  return data.commandTypes.map((commandType, index) => ({
    commandIndex: index,
    commandType,
    state: "success",
    message: tStr("api.flow_validated_label"),
  }));
}

/** Render the flow action summary and attempt timeline tables. */
function renderFlowRunActionAndAttemptTables(actionSummaryRows: string, attemptRows: string): string {
  return `
      <div class="mt-3" role="region" aria-labelledby="flow-action-summary-heading">
        <h4 id="flow-action-summary-heading" class="font-semibold text-sm mb-1">${tStr("api.table_flow_action_summary")}</h4>
        ${renderCommandTable(actionSummaryRows, [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_target"), tStr("api.table_attempts"), tStr("api.table_state"), tStr("api.table_message")], tStr("api.table_flow_action_summary"))}
      </div>
      <div class="mt-3" role="region" aria-labelledby="flow-attempt-timeline-heading">
        <h4 id="flow-attempt-timeline-heading" class="font-semibold text-sm mb-1">${tStr("api.table_flow_attempt_timeline")}</h4>
        ${renderCommandTable(attemptRows, [tStr("api.table_index"), tStr("api.table_attempt"), tStr("api.table_command"), tStr("api.table_target"), tStr("api.table_state"), tStr("api.table_duration"), tStr("api.table_started"), tStr("api.table_ended"), tStr("api.table_message")], tStr("api.table_flow_attempt_timeline"))}
      </div>`;
}

/** Render the synchronous flow run response state. */
export function renderFlowRunState(route: FlowRunRoute, envelope: FlowRunEnvelope): string {
  const data = envelope.data;
  const rows = data ? renderFlowCommandResultRows(data.results, true) : "";
  const actionSummaryRows = data ? renderFlowActionSummaryRows(data.actions ?? []) : "";
  const attemptRows = data ? renderFlowAttemptRows(data.actions ?? []) : "";
  const mismatches = envelope.mismatches ?? [];
  const errorReason = envelope.error && isFlowRuntimeError(envelope.error) ? envelope.error.reason : undefined;
  const commandHeaders: readonly [string, string, string, string, string] = [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_state"), tStr("api.table_details"), tStr("api.table_artifact")];
  const actionAndAttemptBlock = data ? renderFlowRunActionAndAttemptTables(actionSummaryRows, attemptRows) : "";

  if (envelope.state === "success" && data) {
    return renderEnvelopeSection(
      route,
      envelope,
      `      ${renderStatusEnvelope(route, envelope, tStr("api.flow_run_ready"), tInterp("api.flow_run_summary", {
        appId: data.appId,
        commands: String(data.commandCount),
        duration: String(data.durationMs),
      }))}
      ${renderFlowRunPolicySummary(data)}
      ${renderCommandTable(rows, commandHeaders)}
${actionAndAttemptBlock}`,
    );
  }

  const details = [...mismatches];
  if (errorReason) {
    details.push(errorReason);
  }

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.flow_run_failed"), tStr("api.flows_parse_failed"), details)}
    ${data ? renderFlowRunPolicySummary(data) : ""}
    ${data ? renderCommandTable(rows, commandHeaders) : ""}
${actionAndAttemptBlock}`,
  );
}

/** Render the async flow run job state, controls, logs, and timeline. */
export function renderFlowRunJobState(route: string, envelope: FlowRunJobEnvelope): string {
  const data = envelope.data;
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const summary = data ? tInterp("api.status_summary_correlation", { status: data.status, correlationId: data.correlationId }) : tStr("api.flow_run_no_data");
  const runId = envelope.runId;
  const isTerminal = isTerminalJobState(data?.status);
  const isPaused = data?.status === "paused";
  const statusOrder: ReadonlyArray<{
    id: "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";
    label: string;
  }> = [
    { id: "queued", label: tStr("api.status_queued") },
    { id: "running", label: tStr("api.status_running") },
    { id: "paused", label: tStr("api.status_paused") },
    { id: "succeeded", label: tStr("api.status_succeeded") },
    { id: "failed", label: tStr("api.status_failed") },
    { id: "cancelled", label: tStr("api.status_cancelled") },
  ];
  const statusIndex = data ? statusOrder.findIndex((entry) => entry.id === data.status) : -1;
  const statusSteps = `<ul class="steps steps-vertical sm:steps-horizontal w-full" aria-label="${tStr("api.status_steps_aria")}">
    ${statusOrder.map((entry, index) => {
      const active = statusIndex >= 0 && index <= statusIndex;
      const stateClass = active
        ? (entry.id === "failed" || entry.id === "cancelled" ? "step-error" : "step-primary")
        : "";
      return `<li class="step ${stateClass}">${entry.label}</li>`;
    }).join("")}
  </ul>`;

  const controls = runId
    ? `<div class="join join-vertical sm:join-horizontal w-full sm:w-auto" role="group" aria-label="${tStr("flow_engine.controls_aria")}">
      <button class="btn btn-outline btn-sm join-item" hx-get="/api/flows/runs/${runId}" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this">${tStr("flow_engine.refresh_status")}</button>
      <button class="btn btn-outline btn-warning btn-sm join-item" hx-post="/api/flows/runs/${runId}/cancel" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this" ${isTerminal ? "disabled" : ""}>${tStr("layout.confirm_modal_cancel")}</button>
      <button class="btn btn-outline btn-sm join-item" hx-post="/api/flows/runs/${runId}/pause" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this" ${(isTerminal || isPaused) ? "disabled" : ""}>${tStr("api.pause")}</button>
      <button class="btn btn-outline btn-sm join-item" hx-post="/api/flows/runs/${runId}/resume" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="this" ${(isTerminal || !isPaused) ? "disabled" : ""}>${tStr("api.resume")}</button>
      <a class="btn btn-outline btn-sm join-item" href="/api/flows/runs/${runId}/logs" target="_blank" rel="noopener">${tStr("api.logs_sse")}</a>
    </div>`
    : "";

  const failedResults = data?.result?.results.filter((result) => result.state !== "success") ?? [];
  const replayControls = runId && failedResults.length > 0
    ? `<div class="mt-3">
      <h4 class="font-semibold text-sm mb-2">${tStr("api.replay_failed_step")}</h4>
      <div class="flex flex-wrap gap-2">
        ${failedResults.map((result) => `<form hx-post="/api/flows/runs/${runId}/replay-step" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-disabled-elt="find button" aria-label="${tInterp("api.replay_form_aria", { index: String(result.commandIndex + 1) })}">
          <input type="hidden" name="commandIndex" value="${result.commandIndex}" />
          <button class="btn btn-outline btn-xs" type="submit">${tInterp("api.replay_step_btn", { index: String(result.commandIndex + 1), commandType: result.commandType })}</button>
        </form>`).join("")}
      </div>
    </div>`
    : "";

  const output = data?.result
    ? `<div class="overflow-x-auto">
      <table class="table table-pin-rows table-sm">
        <thead>
          <tr><th>${tStr("api.table_index")}</th><th>${tStr("api.table_command")}</th><th>${tStr("api.table_state")}</th><th>${tStr("api.table_details")}</th><th>${tStr("api.table_artifact")}</th></tr>
        </thead>
        <tbody>${renderFlowCommandResultRows(data.result.results, true)}</tbody>
      </table>
    </div>`
    : `<div class="alert alert-soft mt-3" role="alert">
      <span>${tStr("api.no_step_output")}</span>
    </div>`;

  const timeline = data?.result?.actions && data.result.actions.length > 0
    ? `<ul class="timeline timeline-vertical mt-4">
      ${data.result.actions.map((action) => {
        const lastAttempt = action.attempts.at(-1);
        const isSuccess = lastAttempt?.state === "success";
        return `<li>
          <div class="timeline-start">${action.commandIndex + 1}</div>
          <div class="timeline-middle">
            <span class="status ${isSuccess ? "status-success" : "status-error"}" role="img" aria-label="${isSuccess ? tStr("api.timeline_state_success") : tStr("api.timeline_state_error")}"></span>
          </div>
          <div class="timeline-end timeline-box">
            <div class="font-mono text-xs">${esc(action.commandType)}</div>
            <div class="text-xs opacity-70">${esc(lastAttempt?.message ?? FLOW_PENDING_STATE_LABEL)}</div>
          </div>
          <hr />
        </li>`;
      }).join("")}
    </ul>`
    : "";

  const loadingBadge = data && (data.status === "queued" || data.status === "running" || data.status === "paused")
    ? '<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>'
    : "";
  const inlineLogs = runId
    ? renderLiveLogTable(
      `flow-log-stream-${toSafeDomIdSegment(runId)}`,
      `/api/flows/runs/${runId}/logs?format=html&tail=1`,
    )
    : "";

  const sectionContent = renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.flow_run_job_title"), summary, details)}
    ${data ? `<div class="alert alert-outline mt-2" role="alert">
      <span class="font-semibold">${tStr("api.run_lifecycle")} ${loadingBadge}</span>
    </div>
    <div class="mt-2">${statusSteps}</div>
    <ul class="text-xs list-disc list-inside space-y-1 mt-3">
      <li>${tStr("api.flow_run_id")}: ${esc(data.runId)}</li>
      <li>${tStr("api.flow_run_status")}: ${esc(data.status)}</li>
      <li>${tStr("api.flow_run_elapsed")}: ${data.elapsedMs}ms</li>
    </ul>` : ""}
    <div class="mt-3">${controls}</div>
    ${inlineLogs}
    ${replayControls}
    ${output}
    ${timeline}`,
  );

  const content = isTerminal
    ? `<div data-job-terminal="true" data-job-status="${esc(data?.status ?? "")}">${sectionContent}</div>`
    : sectionContent;

  if (runId && !isTerminal) {
    const pollUrl = `/api/flows/runs/${runId}`;
    const oob = `<div id="flow-result-wrapper" hx-swap-oob="true" hx-ext="job-poll" job-poll-url="${esc(pollUrl)}" job-poll-target="#flow-result" job-poll-swap="innerHTML" job-poll-interval="2s">
    <div id="flow-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="running">${content}</div>
  </div>`;
    return `${content}\n${oob}`;
  }

  return content;
}

/** Render the flow YAML validation state. */
export function renderFlowValidateState(route: string, envelope: FlowValidateEnvelope): string {
  const data = envelope.data;
  const validationRows = data ? renderFlowCommandResultRows(buildValidationCommandRows(data), false) : "";
  const details = [...(envelope.mismatches ?? [])];
  const errorReason = envelope.error && isFlowRuntimeError(envelope.error) ? envelope.error.reason : undefined;

  if (envelope.state === "success" && data) {
    return renderEnvelopeSection(
      route,
      envelope,
      `      ${renderStatusEnvelope(route, envelope, tStr("api.flow_validate_ready"), tInterp("api.flow_validate_summary", {
        appId: data.appId,
        commands: String(data.commandCount),
      }))}
      ${renderCommandTable(validationRows, [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_state"), tStr("api.table_details")], tStr("api.table_flow_validation"))}`,
    );
  }

  if (errorReason) {
    details.push(errorReason);
  }

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.request_failed"), tStr("api.flows_parse_failed"), details)}`,
  );
}

/** Render the automation validation state for flow commands. */
export function renderFlowAutomationValidateState(route: string, envelope: FlowAutomationValidateEnvelope): string {
  const data = envelope.data;
  const rows = data
    ? data.steps
      .map((step) => {
        const chipClass = step.supported ? "badge-success" : "badge-error";
        return `<tr>
          <td>${step.index + 1}</td>
          <td><code>${esc(step.commandType)}</code></td>
          <td><span class="badge badge-xs ${chipClass}">${esc(String(step.supported))}</span></td>
          <td>${esc(step.reason ?? "")}</td>
        </tr>`;
      })
      .join("")
    : "";

  const summary = data
    ? tInterp("api.automation_supported_count", { supported: String(data.supportedCommandCount), total: String(data.commandCount) })
    : tStr("api.automation_no_steps");
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.automation_validation_title"), summary, details)}
    ${data ? `${renderCommandTable(rows, [tStr("api.table_index"), tStr("api.table_command"), tStr("api.table_supported"), tStr("api.table_reason")], tStr("api.table_flow_automation"))}
    <p class="text-xs text-base-content/70">
      ${esc(`appId: ${data.appId}`)}
    </p>` : ""}`,
  );
}

/** Render the target capability matrix used for flow preflight checks. */
export function renderFlowCapabilityMatrixState(route: string, envelope: FlowCapabilityMatrixEnvelope): string {
  const data = envelope.data;
  const details = [...(envelope.mismatches ?? [])];
  if (envelope.error?.reason) {
    details.push(envelope.error.reason);
  }

  const message = data
    ? `${data.target} readiness: ${data.ready ? tStr("api.flow_capability_ready") : tStr("api.flow_capability_not_ready")}`
    : tStr("api.flow_capability_none");

  const commandRows = data
    ? data.commands.map((command) => `<tr>
      <td><code>${esc(command.commandType)}</code></td>
      <td>${command.supported ? `<span class="badge badge-success badge-sm" aria-label="${tStr("api.yes")}">${tStr("api.yes")}</span>` : `<span class="badge badge-error badge-sm" aria-label="${tStr("api.no")}">${tStr("api.no")}</span>`}</td>
      <td>${esc(command.reason ?? "")}</td>
    </tr>`).join("")
    : "";

  const requirementRows = data
    ? data.requirements.map((requirement) => `<tr>
      <td><code>${esc(requirement.id)}</code></td>
      <td>${esc(requirement.description)}</td>
      <td>${requirement.required ? `<span class="badge badge-ghost badge-sm" aria-label="${tStr("api.required")}">${tStr("api.required")}</span>` : `<span class="badge badge-ghost badge-sm" aria-label="${tStr("api.optional")}">${tStr("api.optional")}</span>`}</td>
      <td>${requirement.installed ? `<span class="badge badge-success badge-sm" aria-label="${tStr("api.yes")}">${tStr("api.yes")}</span>` : `<span class="badge badge-error badge-sm" aria-label="${tStr("api.no")}">${tStr("api.no")}</span>`}</td>
    </tr>`).join("")
    : "";

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("api.flow_capability_matrix"), message, details)}
    ${data ? `${renderCommandTable(commandRows, [tStr("api.table_command"), tStr("api.table_supported"), tStr("api.table_reason")], tStr("api.flow_command_capabilities"))}
    <div class="mt-3">${renderCommandTable(requirementRows, [tStr("api.table_requirement"), tStr("api.table_description"), tStr("api.table_type"), tStr("api.table_installed")], tStr("api.flow_target_requirements"))}</div>` : ""}`,
  );
}
