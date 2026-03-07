import { t as tStr, tInterp } from "./i18n";
import { esc, renderEnvelopeSection, renderStatusEnvelope } from "./renderers";
import type {
  AppBuildFailureCode,
  DeviceAiBuildArtifactState,
  DeviceAiReadinessEnvelope,
  DeviceAiReadinessRequirement,
  DeviceAiReadinessRequirementCode,
  DeviceAiReadinessStatus,
} from "../../contracts/flow-contracts";

function requirementLabel(code: DeviceAiReadinessRequirementCode): string {
  return tStr(`device_readiness.requirement_${code}`);
}

function readinessSummary(status: DeviceAiReadinessStatus): string {
  return tStr(`device_readiness.summary_${status}`);
}

function buildStatusBadgeClass(status: DeviceAiBuildArtifactState["status"]): string {
  if (status === "pass") {
    return "badge-success";
  }
  if (status === "delegated" || status === "pending") {
    return "badge-warning";
  }
  if (status === "fail") {
    return "badge-error";
  }
  return "badge-ghost";
}

function buildFailureLabel(code: AppBuildFailureCode): string {
  return tStr(`device_readiness.build_failure_${code}`);
}

function renderRequirementRow(requirement: DeviceAiReadinessRequirement): string {
  const stateClass = requirement.satisfied ? "badge-success" : "badge-error";
  const stateLabel = requirement.satisfied ? tStr("device_readiness.state_ready") : tStr("device_readiness.state_missing");
  const requirementScope = requirement.required ? tStr("api.required") : tStr("api.optional");
  return `<li class="flex items-center justify-between gap-3 rounded-box border border-base-content/8 bg-base-200/30 px-3 py-2">
    <div class="space-y-0.5">
      <p class="text-sm font-medium text-base-content">${esc(requirementLabel(requirement.code))}</p>
      <p class="text-[11px] uppercase tracking-[0.16em] text-base-content/55">${esc(requirementScope)}</p>
    </div>
    <span class="badge badge-sm ${stateClass}">${esc(stateLabel)}</span>
  </li>`;
}

function renderBuildArtifactRow(artifact: DeviceAiBuildArtifactState): string {
  const failureDetail = artifact.failureCode
    ? `<div role="alert" class="alert alert-soft alert-error mt-2 py-2 text-xs">${esc(buildFailureLabel(artifact.failureCode))}</div>`
    : "";
  const openLink = artifact.artifactPath
    ? `<a class="link link-primary text-xs" href="${esc(artifact.artifactPath)}" target="_blank" rel="noopener">${tStr("api.open_artifact")}</a>`
    : `<span class="text-xs text-base-content/55">${tStr("api.no_data")}</span>`;
  return `<li class="flex items-center justify-between gap-3 rounded-box border border-base-content/8 bg-base-200/30 px-3 py-2">
    <div class="space-y-0.5">
      <p class="text-sm font-medium text-base-content">${esc(tStr(`device_readiness.build_${artifact.platform}`))}</p>
      <p class="text-[11px] uppercase tracking-[0.16em] text-base-content/55">${esc(tStr(`device_readiness.build_status_${artifact.status}`))}</p>
      ${failureDetail}
    </div>
    <div class="flex items-center gap-2">
      <span class="badge badge-sm ${buildStatusBadgeClass(artifact.status)}">${esc(tStr(`device_readiness.build_status_${artifact.status}`))}</span>
      ${openLink}
    </div>
  </li>`;
}

/**
 * Render the current device-AI readiness fragment for the dashboard build surface.
 */
export function renderDeviceAiReadinessState(route: string, envelope: DeviceAiReadinessEnvelope): string {
  const data = envelope.data;
  if (!data) {
    return renderStatusEnvelope(route, envelope, tStr("device_readiness.title"), tStr("device_readiness.summary_missing"));
  }

  const requiredRequirements = data.requirements.filter((requirement) => requirement.required);
  const satisfiedRequiredCount = requiredRequirements.filter((requirement) => requirement.satisfied).length;
  const totalRequiredCount = requiredRequirements.length;
  const progressValue = totalRequiredCount > 0
    ? Math.round((satisfiedRequiredCount / totalRequiredCount) * 100)
    : 100;
  const detailLines = [
    `${tStr("device_readiness.host")}: ${data.hostOs}`,
    `${tStr("device_readiness.mode")}: ${tStr(`device_readiness.summary_${data.status}`)}`,
    ...data.failures,
  ];

  return renderEnvelopeSection(
    route,
    envelope,
    `    ${renderStatusEnvelope(route, envelope, tStr("device_readiness.title"), readinessSummary(data.status), detailLines)}
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-outline">${esc(tStr("device_readiness.host"))}: ${esc(data.hostOs)}</span>
        <span class="badge badge-primary">${esc(tInterp("device_readiness.required_checks", { count: String(totalRequiredCount) }))}</span>
        <span class="badge ${data.shouldRun ? "badge-success" : "badge-ghost"}">${esc(data.shouldRun ? tStr("device_readiness.protocol_active") : tStr("device_readiness.protocol_inactive"))}</span>
      </div>
      <div class="space-y-1">
        <div class="flex items-center justify-between text-xs text-base-content/60">
          <span>${esc(tStr("device_readiness.progress"))}</span>
          <span>${satisfiedRequiredCount}/${totalRequiredCount}</span>
        </div>
        <progress class="progress progress-primary w-full" value="${progressValue}" max="100" aria-label="${esc(tStr("device_readiness.progress"))}">${progressValue}</progress>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div class="space-y-2">
          <h3 class="text-sm font-semibold text-base-content">${tStr("device_readiness.requirements_title")}</h3>
          <ul class="space-y-2" aria-label="${esc(tStr("device_readiness.requirements_title"))}">
            ${data.requirements.map(renderRequirementRow).join("")}
          </ul>
        </div>
        <div class="space-y-2">
          <h3 class="text-sm font-semibold text-base-content">${tStr("device_readiness.build_artifacts_title")}</h3>
          <ul class="space-y-2" aria-label="${esc(tStr("device_readiness.build_artifacts_title"))}">
            ${renderBuildArtifactRow(data.buildArtifacts.android)}
            ${renderBuildArtifactRow(data.buildArtifacts.ios)}
          </ul>
        </div>
      </div>
    </div>`,
  );
}
