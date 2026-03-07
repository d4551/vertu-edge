import { resolve } from "node:path";
import {
  DEFAULT_CHAT_PULL_MODEL,
  DEFAULT_THEME,
  FLOW_RUN_COMMAND_TIMEOUT_MS,
  FLOW_RUN_MAX_ATTEMPTS,
  FLOW_RUN_RETRY_DELAY_MS,
  DEFAULT_MODEL_SOURCE,
  MODEL_PULL_PRESETS,
  MODEL_PULL_SOURCES,
  MODEL_PULL_MODEL_REF_PLACEHOLDER,
  resolveModelSourceConfig,
} from "./config";
import { PROVIDER_ID_OLLAMA } from "./runtime-constants";
import { Layout } from "./layout";
import { getPreference } from "./db";
import { getProviderCatalog, getProviderModelOptions } from "./ai-providers";
import { getAllProviderStatuses } from "./ai-keys";
import { resolveDeviceAiReadinessEnvelope } from "./device-ai-readiness";
import { getActiveLocale, isSupportedLocale, SUPPORTED_LOCALES, t, type Locale } from "./i18n";
import {
  CARD_CLASS,
  ModelCard,
  AppBuildCard,
  DeviceReadinessCard,
  AiProvidersCard,
  FlowEngineCard,
  PreferencesCard,
} from "./cards";
import { esc } from "./renderers";
import { ICON_IDLE_CHAT, ICON_REFRESH, ICON_SEND } from "./icons";
import { htmxSpinner } from "./htmx-helpers";
import { readLatestAppBuildMatrixReport, type AppBuildPlatform, type AppBuildPlatformReport } from "../../shared/app-build-matrix-report";

/** Available dashboard section identifiers for tab-routed navigation. */
export type DashboardSection = "overview" | "runtime" | "build" | "automation" | "system";

/** All known dashboard sections in display order. */
export const DASHBOARD_SECTIONS: readonly DashboardSection[] = ["overview", "runtime", "build", "automation", "system"] as const;

function resolveThemeLabel(theme: string): string {
  // Check for a localized key (e.g. "user_prefs.theme_dracula")
  const localeKey = `user_prefs.theme_${theme}`;
  const localized = t(localeKey);
  // t() returns the key verbatim when not found — capitalize the theme name as fallback
  if (localized !== localeKey) return localized;
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function renderSectionHeading(indexLabel: string, titleKey: string, descriptionKey: string, sectionId: string): string {
  return `<div class="space-y-1">
    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${esc(indexLabel)}</p>
    <h2 id="${esc(sectionId)}" class="text-xl sm:text-2xl font-semibold text-base-content">${t(titleKey)}</h2>
    <p class="text-sm text-base-content/65 max-w-3xl">${t(descriptionKey)}</p>
  </div>`;
}

function renderInlineLocaleControl(controlId: string, storedLocale: Locale): string {
  return `<label class="build-locale-control" for="${esc(controlId)}">
    <span class="build-locale-control__label">${t("user_prefs.locale")}</span>
    <select
      id="${esc(controlId)}"
      class="select select-sm w-full"
      aria-label="${t("user_prefs.locale_aria")}"
      hx-post="/api/prefs"
      hx-trigger="change"
      hx-vals='js:{"locale": document.getElementById("${esc(controlId)}").value}'
      hx-swap="none"
      hx-disabled-elt="this"
      hx-on::after-request="if (event.detail.successful) { window.location.reload(); }"
    >
      ${SUPPORTED_LOCALES.map((locale) => `<option value="${locale}"${locale === storedLocale ? " selected" : ""}>${t(`user_prefs.locale_${locale}`)}</option>`).join("")}
    </select>
  </label>`;
}

function renderOperatorRuntimeStrip(storedTheme: string): string {
  const state = resolveDashboardState();
  const themeLabel = resolveThemeLabel(storedTheme);
  const localRuntimeBadgeClass = state.ollamaConfigured ? "badge-success" : "badge-warning";
  const localRuntimeBaseUrl = state.ollamaBaseUrl ?? t("ai_providers.not_set");

  return `<section id="operator-runtime-strip" class="${CARD_CLASS}" aria-labelledby="operator-runtime-strip-title">
    <div class="card-body gap-4 p-4 sm:p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-1">
          <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${t("dashboard.nav_runtime")}</p>
          <h2 id="operator-runtime-strip-title" class="text-lg font-semibold text-base-content">${t("dashboard.section_runtime_title")}</h2>
          <p class="text-sm text-base-content/65 max-w-3xl">${t("dashboard.section_runtime_desc")}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary btn-sm" data-operator-workspace-open aria-label="${t("ai_providers.floating_chat_aria")}">
            ${t("dashboard.quick_action_chat")}
          </button>
          <a href="/dashboard/runtime" class="btn btn-outline btn-sm" hx-get="/dashboard/runtime" hx-target="#main-content" hx-swap="innerHTML swap:300ms settle:200ms show:top" hx-push-url="true">${t("dashboard.quick_action_runtime")}</a>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <article class="rounded-box border border-primary/20 bg-base-200/35 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${t("dashboard.stat_model_source")}</p>
          <p class="mt-2 text-base font-semibold text-base-content">${esc(state.defaultModelSourceLabel)}</p>
          <p class="text-sm text-base-content/65">${esc(state.pullModelRef)}</p>
        </article>
        <article class="rounded-box border border-base-content/8 bg-base-200/25 px-4 py-3">
          <div class="flex items-center gap-2">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${esc(state.ollamaDisplayName)}</p>
            <span class="badge badge-sm ${localRuntimeBadgeClass}">${state.ollamaConfigured ? t("ai_providers.configured") : t("ai_providers.not_configured")}</span>
          </div>
          <p class="mt-2 text-sm font-medium text-base-content">${esc(localRuntimeBaseUrl)}</p>
          <p class="text-xs text-base-content/60">${t("dashboard.summary_alert")}</p>
        </article>
        <article class="rounded-box border border-base-content/8 bg-base-200/25 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${t("dashboard.stat_configured_providers")}</p>
          <p class="mt-2 text-base font-semibold text-base-content">${state.configuredCloudProviderCount}<span class="text-sm text-base-content/55"> / ${state.cloudProviderCount}</span></p>
          <p class="text-xs text-base-content/60">${esc(state.primaryCloudProviderLabel)}</p>
        </article>
        <article class="rounded-box border border-base-content/8 bg-base-200/25 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${t("dashboard.stat_preferences")}</p>
          <p class="mt-2 text-base font-semibold text-base-content">${esc(themeLabel)}</p>
          <p class="text-xs text-base-content/60">${t(`user_prefs.locale_${state.storedLocale}`)}</p>
        </article>
      </div>
    </div>
  </section>`;
}

function renderDashboardSectionLink(
  section: Exclude<DashboardSection, "overview">,
  label: string,
  styleClass: string = "btn btn-outline btn-sm",
): string {
  return `<a href="/dashboard/${section}" class="${styleClass}" hx-get="/dashboard/${section}" hx-target="#main-content" hx-swap="innerHTML swap:300ms settle:200ms show:top" hx-push-url="true">${esc(label)}</a>`;
}

function buildMatrixStatusBadgeClass(status: AppBuildPlatformReport["status"]): string {
  if (status === "pass") {
    return "badge-success";
  }
  if (status === "fail") {
    return "badge-error";
  }
  return "badge-warning";
}

function buildMatrixPlatformLabel(platform: AppBuildPlatform): string {
  if (platform === "android") {
    return t("app_build.android");
  }
  if (platform === "ios") {
    return t("app_build.ios");
  }
  return t("app_build.desktop");
}

function readLatestBuildMatrixSummary(): ReturnType<typeof readLatestAppBuildMatrixReport> {
  return readLatestAppBuildMatrixReport(resolve(import.meta.dir, "..", ".."));
}

function renderOverviewBuildSummary(): string {
  const reportResult = readLatestBuildMatrixSummary();
  const platformOrder: readonly AppBuildPlatform[] = ["android", "ios", "desktop"];
  const reportRows = reportResult.ok
    ? platformOrder.map((platform) => {
      const result = reportResult.data.platforms[platform];
      return `<li class="flex items-center justify-between gap-3 rounded-box border border-base-content/8 bg-base-200/25 px-3 py-2">
        <div class="space-y-0.5">
          <p class="text-sm font-medium text-base-content">${esc(buildMatrixPlatformLabel(platform))}</p>
          <p class="text-xs text-base-content/55">${esc(result.message)}</p>
        </div>
        <span class="badge badge-sm ${buildMatrixStatusBadgeClass(result.status)}">${t(`device_readiness.build_status_${result.status}`)}</span>
      </li>`;
    }).join("")
    : `<li class="rounded-box border border-base-content/8 bg-base-200/25 px-3 py-3 text-sm text-base-content/65">${t("device_readiness.summary_missing")}</li>`;

  return `<article id="overview-summary-build" class="${CARD_CLASS}">
    <div class="card-body gap-4 p-4 sm:p-5">
      <div class="space-y-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${t("dashboard.nav_build")}</p>
        <h3 class="text-base font-semibold text-base-content">${t("app_build.title")}</h3>
        <p class="text-sm text-base-content/65">${t("dashboard.section_build_desc")}</p>
      </div>
      <ul class="space-y-2" aria-label="${esc(t("app_build.title"))}">
        ${reportRows}
      </ul>
      <div class="card-actions justify-end">
        ${renderDashboardSectionLink("build", t("dashboard.quick_action_build"))}
      </div>
    </div>
  </article>`;
}

function renderOverviewReadinessSummary(): string {
  const readiness = resolveDeviceAiReadinessEnvelope().data;
  const status = readiness?.status ?? "skipped";
  const statusClass = status === "ready" ? "badge-success" : status === "blocked" ? "badge-error" : "badge-warning";
  const failures = readiness?.failures.slice(0, 2).map((failure) => `<li>${esc(failure)}</li>`).join("") ?? "";
  const hostOs = readiness?.hostOs ?? process.platform;
  const protocolLabel = readiness?.shouldRun ? t("device_readiness.protocol_active") : t("device_readiness.protocol_inactive");

  return `<article id="overview-summary-readiness" class="${CARD_CLASS}">
    <div class="card-body gap-4 p-4 sm:p-5">
      <div class="space-y-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${t("dashboard.nav_build")}</p>
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-base font-semibold text-base-content">${t("device_readiness.title")}</h3>
          <span class="badge badge-sm ${statusClass}">${t(`device_readiness.summary_${status}`)}</span>
        </div>
        <p class="text-sm text-base-content/65">${t("device_readiness.subtitle")}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <span class="badge badge-outline">${esc(t("device_readiness.host"))}: ${esc(hostOs)}</span>
        <span class="badge badge-outline">${esc(protocolLabel)}</span>
      </div>
      ${failures.length > 0
        ? `<ul class="list-disc space-y-1 pl-4 text-xs text-base-content/65">${failures}</ul>`
        : `<p class="text-sm text-base-content/65">${t(`device_readiness.summary_${status}`)}</p>`}
      <div class="card-actions justify-end">
        ${renderDashboardSectionLink("build", t("device_readiness.refresh"), "btn btn-outline btn-sm")}
      </div>
    </div>
  </article>`;
}

function renderOverviewAutomationSummary(): string {
  return `<article id="overview-summary-automation" class="${CARD_CLASS}">
    <div class="card-body gap-4 p-4 sm:p-5">
      <div class="space-y-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${t("dashboard.nav_automation")}</p>
        <h3 class="text-base font-semibold text-base-content">${t("dashboard.section_automation_title")}</h3>
        <p class="text-sm text-base-content/65">${t("dashboard.section_automation_desc")}</p>
      </div>
      <ul class="space-y-2 text-sm text-base-content/70">
        <li>${t("dashboard.stage_runtime")}</li>
        <li>${t("dashboard.stage_build")}</li>
        <li>${t("dashboard.stage_operate")}</li>
      </ul>
      <div class="card-actions justify-end gap-2">
        ${renderDashboardSectionLink("automation", t("dashboard.quick_action_flow"))}
        <button type="button" class="btn btn-ghost btn-sm" data-operator-workspace-open aria-label="${t("ai_providers.floating_chat_aria")}">${t("dashboard.quick_action_chat")}</button>
      </div>
    </div>
  </article>`;
}

function renderOverviewSystemSummary(storedTheme: string): string {
  const state = resolveDashboardState();
  const themeLabel = resolveThemeLabel(storedTheme);
  return `<article id="overview-summary-system" class="${CARD_CLASS}">
    <div class="card-body gap-4 p-4 sm:p-5">
      <div class="space-y-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${t("dashboard.nav_system")}</p>
        <h3 class="text-base font-semibold text-base-content">${t("dashboard.section_system_title")}</h3>
        <p class="text-sm text-base-content/65">${t("dashboard.section_system_desc")}</p>
      </div>
      <dl class="space-y-2 text-sm">
        <div class="flex items-center justify-between gap-3 rounded-box border border-base-content/8 bg-base-200/25 px-3 py-2">
          <dt class="text-base-content/60">${t("user_prefs.locale")}</dt>
          <dd class="font-medium text-base-content">${t(`user_prefs.locale_${state.storedLocale}`)}</dd>
        </div>
        <div class="flex items-center justify-between gap-3 rounded-box border border-base-content/8 bg-base-200/25 px-3 py-2">
          <dt class="text-base-content/60">${t("user_prefs.theme")}</dt>
          <dd class="font-medium text-base-content">${esc(themeLabel)}</dd>
        </div>
      </dl>
      <div class="card-actions justify-end">
        ${renderDashboardSectionLink("system", t("dashboard.nav_system"))}
      </div>
    </div>
  </article>`;
}

function renderOverviewSummaryGrid(storedTheme: string): string {
  return `<section id="overview-summary-grid" class="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="${esc(t("dashboard.quick_start"))}">
    ${renderOverviewBuildSummary()}
    ${renderOverviewReadinessSummary()}
    ${renderOverviewAutomationSummary()}
    ${renderOverviewSystemSummary(storedTheme)}
  </section>`;
}

function renderOperatorConversationWorkspace(): string {
  return `<section id="operator-workspace" class="${CARD_CLASS}" aria-labelledby="floating-chat-title" tabindex="-1">
    <div class="card-body p-0">
      <div class="flex flex-col gap-0 min-h-[32rem] lg:min-h-[34rem]">
        <div class="flex flex-col gap-3 px-4 py-4 sm:px-6 border-b border-base-content/8">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="space-y-1">
              <h2 id="floating-chat-title" class="text-lg font-semibold text-base-content">${t("ai_providers.floating_chat")}</h2>
              <p class="text-sm text-base-content/65">${t("dashboard.subtitle")}</p>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              aria-label="${t("chat.new_conversation")}"
              onclick="document.getElementById('floating-chat-conversation-id').value=''; document.getElementById('floating-chat-messages').innerHTML='<div id=\\'floating-chat-placeholder\\' class=\\'flex flex-col items-center gap-2 py-10 chat-placeholder\\'>${ICON_IDLE_CHAT}<p class=\\'text-base-content/60 text-xs\\'>${t("api.idle_chat_result")}</p></div>'"
            >
              ${t("chat.new_conversation")}
            </button>
          </div>
          <div class="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,13rem)_minmax(0,11rem)_minmax(0,1fr)]">
            <select
              id="floating-chat-conversation-selector"
              class="select select-sm w-full"
              aria-label="${t("chat.conversations")}"
              hx-get="/api/ai/workflows/conversations"
              hx-trigger="load"
              hx-target="this"
              hx-swap="innerHTML"
            >
              <option value="">${t("chat.new_conversation")}</option>
            </select>
            <div
              class="hidden"
              hx-get="/api/ai/workflows/conversations/messages"
              hx-trigger="change from:#floating-chat-conversation-selector"
              hx-vals='js:{"conversationId": document.getElementById("floating-chat-conversation-selector")?.value ?? ""}'
              hx-target="#floating-chat-messages"
              hx-swap="innerHTML"
              hx-on::after-request="document.getElementById('floating-chat-conversation-id').value=document.getElementById('floating-chat-conversation-selector')?.value ?? ''"
            ></div>
            <div id="floating-chat-capabilities" class="rounded-box border border-base-content/8 bg-base-200/40 px-3 py-2 text-xs text-base-content/70" role="status" aria-live="polite" aria-atomic="true"
              hx-get="/api/ai/workflows/capabilities"
              hx-trigger="load, refresh-ai-workflow-capabilities from:body, change from:#floating-chat-mode, change from:#floating-chat-provider, change from:#floating-chat-model"
              hx-include="#floating-chat-form"
              hx-target="this"
              hx-swap="innerHTML">${t("ai_workflow.capability_loading")}</div>
            <div id="floating-chat-model-state" class="rounded-box border border-base-content/8 bg-base-200/40 px-3 py-2 text-xs text-base-content/60" role="status" aria-live="polite" aria-atomic="true" data-state="idle">${t("api.idle_model_selection")}</div>
          </div>
        </div>

        <form
          id="floating-chat-form"
          hx-post="/api/ai/workflows/run"
          hx-target="#floating-chat-messages"
          hx-swap="beforeend"
          hx-indicator="#floating-chat-spinner"
          hx-disabled-elt="button, input, select, textarea"
          hx-on::before-request="document.getElementById('floating-chat-placeholder')?.classList.add('hidden')"
          hx-on::after-request="document.getElementById('floating-chat-msg').value=''; document.getElementById('floating-chat-messages').scrollTop = document.getElementById('floating-chat-messages').scrollHeight"
          class="flex flex-1 min-h-0 flex-col"
          aria-label="${t("ai_providers.floating_chat_form_aria")}"
        >
          <input type="hidden" id="floating-chat-conversation-id" name="conversationId" value="" />
          <div class="grid grid-cols-1 gap-3 border-b border-base-content/8 px-4 py-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,12rem)_minmax(0,1fr)] sm:px-6">
            <select id="floating-chat-mode" name="mode" class="select select-sm w-full" aria-label="${t("ai_workflow.mode")}" required>
              <option value="chat">${t("ai_workflow.mode_chat")}</option>
              <option value="typography">${t("ai_workflow.mode_typography")}</option>
              <option value="presentation">${t("ai_workflow.mode_presentation")}</option>
              <option value="social">${t("ai_workflow.mode_social")}</option>
              <option value="image">${t("ai_workflow.mode_image")}</option>
              <option value="flow_generation">${t("ai_workflow.mode_flow_generation")}</option>
            </select>
            <select
              id="floating-chat-provider"
              name="provider"
              class="select select-sm w-full"
              aria-label="${t("ai_providers.select_provider")}"
              hx-get="/api/ai/providers/options"
              hx-trigger="load"
              hx-target="this"
              hx-swap="innerHTML"
            >
              <option value="" disabled selected>${t("ai_providers.loading_providers")}</option>
            </select>
            <div class="join w-full">
              <select
                id="floating-chat-model"
                name="model"
                class="select select-sm join-item flex-1"
                aria-label="${t("ai_providers.model")}"
                hx-get="/api/ai/models"
                hx-trigger="change from:#floating-chat-provider, load"
                hx-include="#floating-chat-form"
                hx-vals='{"stateId":"floating-chat-model-state"}'
                hx-target="this"
                hx-swap="innerHTML"
              >
                <option value="" disabled selected>${t("api.models_provider_required")}</option>
              </select>
              <button
                type="button"
                class="btn btn-secondary btn-sm join-item"
                data-tip="${t("model_mgmt.refresh")}"
                hx-get="/api/ai/models"
                hx-trigger="click"
                hx-include="#floating-chat-form"
                hx-vals='{"stateId":"floating-chat-model-state"}'
                hx-target="#floating-chat-model"
                hx-swap="innerHTML"
                hx-indicator="#floating-chat-model-refresh-spinner"
                hx-disabled-elt="this"
                aria-label="${t("model_mgmt.refresh")}"
              >${ICON_REFRESH}${htmxSpinner("floating-chat-model-refresh-spinner", "ml-1")}</button>
            </div>
          </div>

          <div class="grid flex-1 min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,0.28fr)]">
            <div id="floating-chat-messages" class="min-h-[22rem] overflow-y-auto px-4 py-4 sm:px-6" role="log" aria-live="polite">
              <div id="floating-chat-placeholder" class="flex flex-col items-center gap-2 py-10 chat-placeholder">
                ${ICON_IDLE_CHAT}
                <p class="text-base-content/60 text-xs">${t("api.idle_chat_result")}</p>
              </div>
            </div>
            <aside class="border-t border-base-content/8 bg-base-200/25 px-4 py-4 xl:border-l xl:border-t-0 sm:px-6">
              <div
                id="floating-chat-workflow-fields"
                role="region"
                aria-live="polite"
                aria-atomic="true"
                aria-label="${t("ai_workflow.options_label")}"
                hx-get="/api/ai/workflows/form-fields"
                hx-trigger="load, change from:#floating-chat-mode"
                hx-include="#floating-chat-form"
                hx-target="this"
                hx-swap="innerHTML"
              >
                <div class="alert alert-soft alert-info text-xs" role="status">
                  <span>${t("ai_workflow.options_loading")}</span>
                </div>
              </div>
            </aside>
          </div>

          <div class="border-t border-base-content/8 px-4 py-4 sm:px-6">
            <div class="flex flex-col gap-3">
              <textarea
                id="floating-chat-msg"
                name="message"
                rows="4"
                class="textarea textarea-bordered w-full text-sm"
                placeholder="${t("ai_workflow.message_placeholder")}"
                aria-label="${t("ai_providers.chat_message_aria")}"
              ></textarea>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <p class="text-xs text-base-content/60">${t("dashboard.subtitle")}</p>
                <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("ai_providers.send_aria")}">
                  ${ICON_SEND}
                  ${t("ai_providers.send")}
                  ${htmxSpinner("floating-chat-spinner")}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  </section>`;
}

function renderBuildOperatorStrip(): string {
  const state = resolveDashboardState();
  const buildHostValue = state.isMacHost ? t("dashboard.build_host_macos") : t("dashboard.build_host_cross_platform");
  const buildHostDescription = state.isMacHost ? t("dashboard.build_host_macos_desc") : t("dashboard.build_host_cross_platform_desc");

  return `<section id="build-operator-strip" class="${CARD_CLASS} build-command-strip" aria-labelledby="heading-section-build">
    <div class="card-body gap-4 p-4 sm:p-5">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div class="space-y-1">
          <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-base-content/55">${t("dashboard.nav_build")}</p>
          <p class="text-sm text-base-content/70 max-w-3xl">${t("dashboard.section_build_desc")}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary btn-sm" data-operator-workspace-open aria-label="${t("ai_providers.floating_chat_aria")}">
            ${t("dashboard.quick_action_chat")}
          </button>
          <a href="/dashboard/runtime" class="btn btn-outline btn-sm" hx-get="/dashboard/runtime" hx-target="#main-content" hx-swap="innerHTML swap:300ms settle:200ms show:top" hx-push-url="true">${t("dashboard.quick_action_runtime")}</a>
          <a href="/dashboard/system" class="btn btn-outline btn-sm" hx-get="/dashboard/system" hx-target="#main-content" hx-swap="innerHTML swap:300ms settle:200ms show:top" hx-push-url="true">${t("dashboard.nav_system")}</a>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <article class="build-surface-stat rounded-box border border-primary/18 bg-base-200/35 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${t("dashboard.stat_build_host")}</p>
          <p class="mt-2 text-base font-semibold text-base-content">${buildHostValue}</p>
          <p class="text-xs text-base-content/60">${buildHostDescription}</p>
        </article>
        <article class="build-surface-stat rounded-box border border-base-content/8 bg-base-200/25 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${t("dashboard.stat_model_source")}</p>
          <p class="mt-2 text-base font-semibold text-base-content">${esc(state.defaultModelSourceLabel)}</p>
          <p class="text-xs text-base-content/60">${esc(state.pullModelRef)}</p>
        </article>
        <article class="build-surface-stat rounded-box border border-base-content/8 bg-base-200/25 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/55">${t("app_build.platform")}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <span class="badge badge-sm badge-primary">${t("app_build.android")}</span>
            <span class="badge badge-sm badge-secondary">${t("app_build.ios")}</span>
            <span class="badge badge-sm badge-outline">${t("app_build.desktop")}</span>
          </div>
          <p class="mt-2 text-xs text-base-content/60">${t("app_build.platform_hint")}</p>
        </article>
        <article class="build-surface-stat build-surface-stat--locale rounded-box border border-base-content/8 bg-base-200/25 px-4 py-3">
          ${renderInlineLocaleControl("build-strip-locale-select", state.storedLocale)}
        </article>
      </div>
      <div role="alert" class="alert alert-info alert-soft border border-info/20">
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge badge-sm badge-primary">${t("app_build.android")}</span>
          <span class="badge badge-sm badge-secondary">${t("app_build.ios")}</span>
          <span class="badge badge-sm badge-outline">${t("app_build.desktop")}</span>
        </div>
        <span class="text-sm text-base-content/80">${t("app_build.subtitle")}</span>
      </div>
    </div>
  </section>`;
}

/** Resolve shared dashboard state from DB preferences and provider catalog. */
function resolveDashboardState() {
  const preferredLocale = getPreference("locale");
  const storedLocale: Locale = isSupportedLocale(preferredLocale) ? preferredLocale : getActiveLocale();
  const providers = getProviderCatalog();
  const statuses = getAllProviderStatuses(providers.map((p) => ({ provider: p.id, requiresKey: p.requiresKey })));
  const cloudProviders = providers.filter((provider) => provider.id !== PROVIDER_ID_OLLAMA);
  const configuredCloudProviderCount = statuses.filter((status) => status.provider !== PROVIDER_ID_OLLAMA && status.configured).length;
  const firstConfiguredCloudStatus = statuses.find((status) => status.provider !== PROVIDER_ID_OLLAMA && status.configured);
  const firstConfiguredCloudProvider = firstConfiguredCloudStatus
    ? providers.find((provider) => provider.id === firstConfiguredCloudStatus.provider)
    : null;
  const ollamaProvider = providers.find((provider) => provider.id === PROVIDER_ID_OLLAMA);
  const ollamaStatus = statuses.find((status) => status.provider === PROVIDER_ID_OLLAMA);
  const ollamaBaseUrl = ollamaStatus?.baseUrl ?? ollamaProvider?.baseUrl ?? null;
  const preferredModel = getPreference("defaultModel") ?? "";
  const providerModels = getProviderModelOptions();
  const defaultModelOptions = preferredModel && !providerModels.includes(preferredModel)
    ? [preferredModel, ...providerModels]
    : providerModels;
  const pullModelRef = DEFAULT_CHAT_PULL_MODEL;
  const modelPullSources = MODEL_PULL_SOURCES
    .map((source) => resolveModelSourceConfig(source))
    .filter((source, index, list) => list.findIndex((candidate) => candidate.id === source.id) === index);
  const canonicalDefaultModelSource = resolveModelSourceConfig(DEFAULT_MODEL_SOURCE);
  const defaultModelSource: string = modelPullSources
    .find((source) => source.id === canonicalDefaultModelSource.id)
    ?.id
    ?? modelPullSources[0]?.id
    ?? canonicalDefaultModelSource.id;
  const defaultModelSourceLabel = modelPullSources.find((source) => source.id === defaultModelSource)?.displayName
    ?? canonicalDefaultModelSource.displayName;
  const configuredProviderCount = statuses.filter((status) => status.configured).length;
  const isMacHost = process.platform === "darwin";
  return {
    storedLocale,
    providers,
    statuses,
    preferredModel,
    providerModels,
    defaultModelOptions,
    pullModelRef,
    modelPullSources,
    defaultModelSource,
    defaultModelSourceLabel,
    configuredProviderCount,
    cloudProviderCount: cloudProviders.length,
    configuredCloudProviderCount,
    primaryCloudProviderLabel: firstConfiguredCloudProvider?.displayName ?? t("ai_providers.not_configured"),
    ollamaDisplayName: ollamaProvider?.displayName ?? "Ollama",
    ollamaConfigured: typeof ollamaBaseUrl === "string" && ollamaBaseUrl.trim().length > 0,
    ollamaBaseUrl,
    isMacHost,
  };
}

/** Render the overview section with summary stats and quick-start steps. */
export function renderOverviewSection(storedTheme: string): string {
  return `<section id="section-overview" class="mb-6 sm:mb-8 lg:mb-10" aria-labelledby="heading-main">
    <div class="space-y-4 sm:space-y-5 lg:space-y-6">
      <div class="space-y-2">
        <h1 id="heading-main" class="text-2xl sm:text-3xl font-bold brand-text brand-text-accent">${t("dashboard.title")}</h1>
        <p class="text-sm text-base-content/65 max-w-4xl">${t("dashboard.subtitle")}</p>
      </div>
      ${renderOperatorRuntimeStrip(storedTheme)}
      ${renderOperatorConversationWorkspace()}
      ${renderOverviewSummaryGrid(storedTheme)}
    </div>
  </section>`;
}

/** Render the runtime section with Model Management and AI Providers cards. */
export function renderRuntimeSection(): string {
  const state = resolveDashboardState();
  return `<section id="section-runtime" class="mb-6 sm:mb-8 lg:mb-10 space-y-4" aria-labelledby="heading-section-runtime">
  ${renderSectionHeading("01", "dashboard.section_runtime_title", "dashboard.section_runtime_desc", "heading-section-runtime")}
  <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-4 sm:gap-6 lg:gap-8 items-start">
    ${ModelCard({
      currentModel: state.pullModelRef,
      modelPullPresets: MODEL_PULL_PRESETS,
      modelRefPlaceholder: MODEL_PULL_MODEL_REF_PLACEHOLDER,
      modelPullSources: state.modelPullSources,
      defaultModelSource: state.defaultModelSource,
    })}
    ${AiProvidersCard({ providers: state.providers, statuses: state.statuses })}
  </div>
</section>`;
}

/** Render the build section with App Build and Device Readiness cards. */
export function renderBuildSection(): string {
  return `<section id="section-build" class="mb-6 sm:mb-8 lg:mb-10 space-y-4" aria-labelledby="heading-section-build">
  ${renderSectionHeading("02", "dashboard.section_build_title", "dashboard.section_build_desc", "heading-section-build")}
  ${renderBuildOperatorStrip()}
  <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-4 sm:gap-6 lg:gap-8 items-start">
    ${AppBuildCard()}
    ${DeviceReadinessCard()}
  </div>
</section>`;
}

/** Render the automation section with the Flow Engine card. */
export function renderAutomationSection(): string {
  return `<section id="section-automation" class="mb-6 sm:mb-8 lg:mb-10 space-y-4" aria-labelledby="heading-section-automation">
  ${renderSectionHeading("03", "dashboard.section_automation_title", "dashboard.section_automation_desc", "heading-section-automation")}
  ${FlowEngineCard({
    defaultFlowMaxAttempts: FLOW_RUN_MAX_ATTEMPTS.toString(),
    defaultFlowTimeoutMs: FLOW_RUN_COMMAND_TIMEOUT_MS.toString(),
    defaultFlowRetryDelayMs: FLOW_RUN_RETRY_DELAY_MS.toString(),
  })}
</section>`;
}

/** Render the system section with Preferences and UCP cards. */
export function renderSystemSection(storedTheme: string): string {
  const state = resolveDashboardState();
  return `<section id="section-system" class="space-y-4" aria-labelledby="heading-section-system">
  ${renderSectionHeading("04", "dashboard.section_system_title", "dashboard.section_system_desc", "heading-section-system")}
  ${PreferencesCard({ storedTheme, storedLocale: state.storedLocale, defaultModelOptions: state.defaultModelOptions })}
</section>`;
}

/** Render a single dashboard section by identifier. Returns HTML fragment (no Layout wrapper). */
export function renderDashboardSection(section: DashboardSection, theme: string): string {
  switch (section) {
    case "overview": return renderOverviewSection(theme);
    case "runtime": return renderRuntimeSection();
    case "build": return renderBuildSection();
    case "automation": return renderAutomationSection();
    case "system": return renderSystemSection(theme);
  }
}

/**
 * Renders the main Dashboard view for the Vertu Control Plane.
 * Composes all sections into a full page with Layout wrapper.
 * When activeSection is provided, only that section is rendered (for focused views).
 */
export function Dashboard(theme: string, activeSection?: DashboardSection): string {
  const storedTheme = theme || DEFAULT_THEME;
  const state = resolveDashboardState();

  const content = renderDashboardSection(activeSection ?? "overview", storedTheme);

  return Layout("Dashboard", content, storedTheme, state.storedLocale, activeSection ?? "overview");
}
