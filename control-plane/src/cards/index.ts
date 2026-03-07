/**
 * Dashboard card components. Each card is a function that returns HTML.
 */
import {
  APP_BUILD_VARIANT_PLACEHOLDER,
  OLLAMA_DEFAULT_BASE_URL,
  PROVIDER_API_KEY_PLACEHOLDER,
  AUTO_VALIDATION_DELAY_MS,
  SUPPORTED_THEMES,
  type ModelSourceConfig,
} from "../config";
import { htmxSpinner, HTMX_SWAP_INNER } from "../htmx-helpers";
import { SUPPORTED_LOCALES, t, tInterp, type Locale } from "../i18n";
import { getApiKey, getBaseUrl, maskApiKey } from "../ai-keys";
import { getPreference } from "../db";
import { providerStatusBadgeClass, providerStatusHint, providerStatusLabel } from "../provider-status-view";
import {
  ICON_MODEL,
  ICON_APP_BUILD,
  ICON_AI_PROVIDERS,
  ICON_FLOW,
  ICON_PREFERENCES,
  ICON_UCP,
  ICON_DEVICE_READY,
  ICON_IDLE_DOWNLOAD,
  ICON_IDLE_SETTINGS,
  ICON_IDLE_DOCUMENT,
  ICON_IDLE_GRID,
  ICON_IDLE_SHIELD,
  ICON_IDLE_SEARCH,
  ICON_IDLE_FLOW,
  ICON_SAVE,
  ICON_REFRESH,
} from "../icons";
import { DEVICE_AI_READINESS_ROUTE } from "../runtime-constants";
import { esc } from "../renderers/index";
import type { ProviderMeta } from "../ai-providers";
import type { ProviderStatus } from "../ai-keys";

/** Shared card styling: daisyUI card-border + vertu-glass, used across dashboard cards. */
export const CARD_CLASS = "card card-border vertu-glass vertu-panel shadow-md overflow-hidden";

/** Reusable idle empty-state block with centered icon and message. */
function idleState(icon: string, messageKey: string): string {
  return `<div class="flex flex-col items-center justify-center gap-2 py-4 text-center">
    ${icon}
    <p class="text-base-content/55 text-xs">${t(messageKey)}</p>
  </div>`;
}

/** DaisyUI 5 fieldset-based form field. Replaces repeated label+input wrappers across cards. */
interface FormFieldProps {
  label: string;
  inputHtml: string;
  hint?: string;
}

function FormField({ label, inputHtml, hint }: FormFieldProps): string {
  return `<fieldset class="fieldset">
    <legend class="fieldset-legend">${esc(label)}</legend>
    ${inputHtml}
    ${hint ? `<p class="fieldset-label text-xs">${hint}</p>` : ""}
  </fieldset>`;
}

interface ChoiceCardOption {
  id: string;
  value: string;
  title: string;
  description: string;
  ariaLabel: string;
  tone: "primary" | "secondary" | "accent";
  checked?: boolean;
}

interface ChoiceCardGroupProps {
  legend: string;
  legendId: string;
  hint: string;
  hintId: string;
  name: string;
  options: readonly ChoiceCardOption[];
  gridClassName?: string;
}

function renderChoiceCardGroup({
  legend,
  legendId,
  hint,
  hintId,
  name,
  options,
  gridClassName = "grid grid-cols-1 gap-3 sm:grid-cols-3",
}: ChoiceCardGroupProps): string {
  const renderedOptions = options.map((option) => {
    const descriptionId = `${option.id}-desc`;
    const describedBy = `${hintId} ${descriptionId}`;
    return `<label class="platform-choice" for="${esc(option.id)}" data-tone="${esc(option.tone)}">
      <input
        id="${esc(option.id)}"
        type="radio"
        name="${esc(name)}"
        value="${esc(option.value)}"
        class="sr-only platform-choice__input"
        aria-label="${esc(option.ariaLabel)}"
        aria-describedby="${esc(describedBy)}"
        ${option.checked ? 'checked="checked"' : ""}
      />
      <span class="platform-choice__indicator" aria-hidden="true"></span>
      <span class="platform-choice__copy">
        <span class="platform-choice__title">${esc(option.title)}</span>
        <span id="${esc(descriptionId)}" class="platform-choice__description">${esc(option.description)}</span>
      </span>
    </label>`;
  }).join("");

  return `<fieldset class="fieldset">
    <legend id="${esc(legendId)}" class="fieldset-legend">${esc(legend)}</legend>
    <p id="${esc(hintId)}" class="fieldset-label text-xs text-base-content/65">${esc(hint)}</p>
    <div class="${esc(gridClassName)}" role="radiogroup" aria-labelledby="${esc(legendId)}" aria-describedby="${esc(hintId)}">
      ${renderedOptions}
    </div>
  </fieldset>`;
}

export type ModelCardProps = {
  currentModel: string;
  modelPullPresets: readonly string[];
  modelRefPlaceholder: string;
  modelPullSources: readonly ModelSourceConfig[];
  defaultModelSource: string;
};

export function ModelCard(props: ModelCardProps): string {
  const {
    currentModel,
    modelPullPresets,
    modelRefPlaceholder,
    modelPullSources,
    defaultModelSource,
  } = props;
  const safePlaceholder = esc(
    modelRefPlaceholder.length > 0 ? modelRefPlaceholder : t("model_mgmt.model_ref_placeholder"),
  );
  return `
  <section class="${CARD_CLASS}" id="card-models" aria-labelledby="heading-models">
    <div class="card-body p-4 sm:p-6">
      <h2 id="heading-models" class="card-title text-base font-semibold">
        ${ICON_MODEL}
        ${t("model_mgmt.title")}
      </h2>
      <p class="text-xs text-base-content/60 mt-1">${t("model_mgmt.powered_by")} · ${t("model_mgmt.containerized")}</p>

      <div class="tabs tabs-border tabs-sm mt-3" role="tablist" aria-label="${t("model_mgmt.tabs_aria")}">
        <input type="radio" name="model-tabs" class="tab" aria-label="${t("model_mgmt.tab_pull")}" checked="checked" />
        <div class="tab-content border-base-content/8 pt-4">
          <form hx-post="/api/models/pull" hx-target="#model-pull-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#model-pull-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" class="space-y-3" aria-label="${t("model_mgmt.form_aria")}">
            ${FormField({
              label: t("model_mgmt.model_ref"),
              inputHtml: `<input id="model-ref-input" name="modelRef" value="${currentModel}" type="text"
                placeholder="${safePlaceholder}"
                class="input input-sm w-full validator" aria-label="${t("model_mgmt.model_ref")}" required />`,
              hint: `<span class="validator-hint hidden">${t("model_mgmt.model_ref_hint")}</span>`,
            })}
            ${FormField({
              label: t("model_mgmt.source"),
              inputHtml: `<select id="model-source-select" name="source" class="select select-sm w-full" aria-label="${t("model_mgmt.source")}">
              ${modelPullSources
                .map(
                  (source) =>
                    `<option value="${esc(source.id)}" data-placeholder="${esc(source.modelRefPlaceholder)}" data-hint="${esc(source.modelRefHint ?? "")}" ${source.id === defaultModelSource ? "selected" : ""}>${esc(source.displayName)}</option>`,
                )
                .join("")}
              </select>`,
            })}
            <div>
              <span class="text-xs text-base-content/60">${t("model_mgmt.quick_presets")}</span>
              <div class="flex flex-wrap gap-1.5 mt-1">
                ${modelPullPresets.map((preset) => {
                const safePreset = esc(preset);
                const shortLabel = preset.split("/").at(-1) ?? preset;
                return `<button type="button" class="btn btn-outline btn-xs" data-preset-target="model-ref-input" data-preset-value="${safePreset}">${esc(shortLabel)}</button>`;
              }).join("")}
              </div>
            </div>
            <div class="flex items-center justify-between">
              <label class="label cursor-pointer gap-2 py-0" for="model-force-pull">
                <input id="model-force-pull" type="checkbox" name="force" class="checkbox checkbox-xs checkbox-primary" />
                <span class="label-text text-xs">${t("model_mgmt.force_pull")}</span>
              </label>
              <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("model_mgmt.pull_model")}">${t("model_mgmt.pull_model")}${htmxSpinner("model-pull-spinner")}</button>
            </div>
          </form>
          <div id="model-pull-result" class="mt-3 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
            ${idleState(ICON_IDLE_DOWNLOAD, "api.idle_model_pull")}
          </div>
        </div>

        <input type="radio" name="model-tabs" class="tab" aria-label="${t("model_search.label")}" />
        <div class="tab-content border-base-content/8 pt-4">
          <div class="join w-full">
            <input id="model-search-input" name="q" type="search" placeholder="${t("model_search.placeholder")}"
              class="input input-sm flex-1 join-item" aria-label="${t("model_search.aria")}" />
            <button type="button" class="btn btn-secondary btn-sm join-item"
              hx-get="/api/models/search" hx-include="#model-search-input"
              hx-target="#model-search-result" hx-swap="${HTMX_SWAP_INNER}"
              hx-indicator="#model-search-spinner" hx-disabled-elt="this"
              aria-label="${t("model_search.button_aria")}">${t("model_search.button")}${htmxSpinner("model-search-spinner")}</button>
          </div>
          <div id="model-search-result" class="mt-2 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle"></div>
        </div>

        <input type="radio" name="model-tabs" class="tab" aria-label="${t("model_mgmt.local_models")}" />
        <div class="tab-content border-base-content/8 pt-4">
          <div class="flex items-center justify-between" id="model-list" role="status" aria-live="polite">
            <span class="text-xs text-base-content/60">${t("model_mgmt.click_refresh")}</span>
            <button type="button" class="btn btn-xs btn-outline" data-tip="${t("model_mgmt.refresh")}" hx-get="/api/models" hx-target="#model-list" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#model-list-spinner" hx-disabled-elt="this" aria-label="${t("model_mgmt.refresh_aria")}">${t("model_mgmt.refresh")}${htmxSpinner("model-list-spinner", "ml-1")}</button>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function AppBuildCard(): string {
  const platformChoices: readonly ChoiceCardOption[] = [
    {
      id: "app-build-platform-android",
      value: "android",
      title: t("app_build.android"),
      description: t("app_build.platform_android_desc"),
      ariaLabel: t("app_build.platform_android_aria"),
      tone: "primary",
      checked: true,
    },
    {
      id: "app-build-platform-ios",
      value: "ios",
      title: t("app_build.ios"),
      description: t("app_build.platform_ios_desc"),
      ariaLabel: t("app_build.platform_ios_aria"),
      tone: "secondary",
    },
    {
      id: "app-build-platform-desktop",
      value: "desktop",
      title: t("app_build.desktop"),
      description: t("app_build.platform_desktop_desc"),
      ariaLabel: t("app_build.platform_desktop_aria"),
      tone: "accent",
    },
  ];

  return `
  <section class="${CARD_CLASS}" id="card-app-build" aria-labelledby="heading-app-build">
    <div class="card-body p-4 sm:p-6">
      <h2 id="heading-app-build" class="card-title text-base font-semibold">
        ${ICON_APP_BUILD}
        ${t("app_build.title")}
      </h2>
      <p class="text-xs text-base-content/60 mt-1">${t("app_build.subtitle")}</p>
      <p class="text-xs text-base-content/50 mt-0.5">${t("app_build.desktop_hint")}</p>

      <form hx-post="/api/apps/build" hx-target="#app-build-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#app-build-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" class="mt-3 space-y-3" aria-label="${t("app_build.form_aria")}">
        ${renderChoiceCardGroup({
          legend: t("app_build.platform"),
          legendId: "app-build-platform-legend",
          hint: t("app_build.platform_hint"),
          hintId: "app-build-platform-hint",
          name: "platform",
          options: platformChoices,
        })}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${FormField({
            label: t("app_build.build_type"),
            inputHtml: `<select id="app-build-build-type" name="buildType" class="select select-sm w-full" aria-label="${t("app_build.build_type")}">
              <option value="debug">${t("app_build.debug")}</option>
              <option value="release">${t("app_build.release")}</option>
            </select>`,
          })}
          ${FormField({
            label: t("app_build.variant"),
            inputHtml: `<input id="app-build-variant" name="variant" type="text" class="input input-sm w-full" placeholder="${APP_BUILD_VARIANT_PLACEHOLDER}" aria-label="${t("app_build.variant")}" />`,
          })}
          ${FormField({
            label: t("app_build.output_dir"),
            inputHtml: `<input id="app-build-output-dir" name="outputDir" type="text" class="input input-sm w-full" placeholder="${t("app_build.output_dir_hint")}" aria-label="${t("app_build.output_dir")}" />`,
          })}
        </div>
        <div class="flex items-center justify-between">
          <div class="flex gap-3">
            <label class="label cursor-pointer gap-1.5 py-0" for="app-build-skip-tests">
              <input id="app-build-skip-tests" type="checkbox" name="skipTests" class="checkbox checkbox-xs checkbox-primary" />
              <span class="label-text text-xs">${t("app_build.skip_tests")}</span>
            </label>
            <label class="label cursor-pointer gap-1.5 py-0" for="app-build-clean">
              <input id="app-build-clean" type="checkbox" name="clean" class="checkbox checkbox-xs checkbox-primary" />
              <span class="label-text text-xs">${t("app_build.clean")}</span>
            </label>
          </div>
          <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("app_build.launch")}">${t("app_build.launch")}${htmxSpinner("app-build-spinner")}</button>
        </div>
      </form>

      <div id="app-build-result" class="mt-3 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
        ${idleState(ICON_IDLE_SETTINGS, "api.idle_app_build")}
      </div>
    </div>
  </section>`;
}

/** Render the native device-AI readiness card used by the build-phase dashboard surface. */
export function DeviceReadinessCard(): string {
  return `
  <section class="${CARD_CLASS}" id="card-device-readiness" aria-labelledby="heading-device-readiness">
    <div class="card-body p-4 sm:p-6">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <h2 id="heading-device-readiness" class="card-title text-base font-semibold">
            ${ICON_DEVICE_READY}
            ${t("device_readiness.title")}
          </h2>
          <p class="text-xs text-base-content/60">${t("device_readiness.subtitle")}</p>
        </div>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          hx-get="${DEVICE_AI_READINESS_ROUTE}"
          hx-target="#device-readiness-result"
          hx-swap="${HTMX_SWAP_INNER}"
          hx-indicator="#device-readiness-spinner"
          hx-disabled-elt="this"
          aria-label="${t("device_readiness.refresh_aria")}">
          ${ICON_REFRESH}
          ${t("device_readiness.refresh")}
          ${htmxSpinner("device-readiness-spinner", "ml-1")}
        </button>
      </div>

      <div
        id="device-readiness-result"
        class="mt-3 text-sm min-h-[2rem]"
        role="status"
        aria-live="polite"
        data-state="loading"
        aria-busy="true"
        hx-get="${DEVICE_AI_READINESS_ROUTE}"
        hx-trigger="load"
        hx-swap="${HTMX_SWAP_INNER}"
        hx-on::before-request="this.setAttribute('aria-busy','true')"
        hx-on::after-swap="this.removeAttribute('aria-busy')">
        <div class="flex flex-col items-start gap-2 py-2">
          <div class="skeleton h-10 w-10 shrink-0 rounded"></div>
          <div class="skeleton h-4 w-48"></div>
          <div class="skeleton h-3 w-full"></div>
          <p class="text-base-content/60 text-sm">${t("device_readiness.loading")}</p>
        </div>
      </div>
    </div>
  </section>`;
}

export type AiProvidersCardProps = {
  providers: readonly ProviderMeta[];
  statuses: readonly ProviderStatus[];
};

export function AiProvidersCard(props: AiProvidersCardProps): string {
  const { providers, statuses } = props;
  const firstConfiguredIdx = providers.findIndex((pr) => statuses.find((s) => s.provider === pr.id)?.configured);
  const defaultCheckedIdx = firstConfiguredIdx >= 0 ? firstConfiguredIdx : 0;

  const tabsHtml = providers
    .map((p, i) => {
      const status = statuses.find((s) => s.provider === p.id);
      const storedKey = getApiKey(p.id) ?? "";
      const storedBaseUrl = getBaseUrl(p.id) ?? p.baseUrl;
      const maskedKey = maskApiKey(storedKey);
      const isChecked = i === defaultCheckedIdx;
      const tabLabel = status?.configured ? `${p.displayName} ✓` : p.displayName;
      const statusHint = status ? providerStatusHint(status) : null;
      return `<input type="radio" name="provider-tabs" class="tab" aria-label="${esc(tabLabel)}" id="provider-tab-${p.id}" ${isChecked ? 'checked="checked"' : ''} />
      <div class="tab-content bg-base-100 border-base-content/8 p-4 sm:p-5">
        <div class="mb-3 flex items-center gap-3">
          <a href="${p.docsUrl}" target="_blank" rel="noopener" class="link link-primary text-xs" aria-label="${tInterp("ai_providers.docs_aria", { provider: p.displayName })}">${t("ai_providers.docs_link")}</a>
          ${status
            ? `<span class="badge ${providerStatusBadgeClass(status)} badge-xs">${esc(providerStatusLabel(status))}</span>`
            : `<span class="badge badge-ghost badge-xs">${t("ai_providers.not_configured")}</span>`}
        </div>
        ${statusHint
          ? `<div class="alert alert-warning alert-soft mb-3" role="status"><span>${esc(statusHint)}</span></div>`
          : ""}
        <form id="provider-config-form-${p.id}" hx-post="/api/ai/keys" hx-target="#key-result-${p.id}" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#key-spinner-${p.id}" hx-disabled-elt="button, input" hx-sync="this:replace" class="space-y-3" aria-label="${tInterp("ai_providers.save_config_aria", { provider: p.displayName })}">
          <input type="hidden" name="provider" value="${p.id}" />
          ${p.requiresKey ? FormField({
            label: t("ai_providers.api_key"),
            inputHtml: `<input id="key-${p.id}" name="apiKey" type="password" placeholder="${maskedKey || (p.keyHint ?? PROVIDER_API_KEY_PLACEHOLDER)}" required
              class="input input-sm w-full font-mono validator" aria-label="${tInterp("ai_providers.api_key_aria", { provider: p.displayName })}" />`,
            hint: `<span class="validator-hint hidden">${t("api.key_required")}</span>`,
          }) : ""}
          ${p.hasBaseUrlConfig ? FormField({
            label: t("ai_providers.base_url"),
            inputHtml: `<input id="url-${p.id}" name="baseUrl" type="url" value="${storedBaseUrl}" required
              class="input input-sm w-full font-mono validator" placeholder="${OLLAMA_DEFAULT_BASE_URL}" aria-label="${t("ai_providers.ollama_url_aria")}" />`,
            hint: `<span class="validator-hint hidden">${t("api.base_url_invalid_short")}</span>`,
          }) : ""}
          <div class="flex gap-2 flex-wrap">
            <button type="submit" class="btn btn-primary btn-sm" aria-label="${tInterp("ai_providers.save_config_aria", { provider: p.displayName })}">
              ${ICON_SAVE}
              ${t("ai_providers.save")}${htmxSpinner(`key-spinner-${p.id}`)}
            </button>
            ${p.requiresKey ? `
            <button type="button" class="btn btn-ghost btn-sm text-error tooltip tooltip-bottom" data-tip="${tInterp("ai_providers.remove_key", { provider: p.displayName })}"
              hx-post="/api/ai/keys/delete" hx-vals='{"provider":"${p.id}"}' hx-target="#key-result-${p.id}" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#key-delete-spinner-${p.id}" hx-disabled-elt="this"
              hx-confirm="${tInterp("ai_providers.remove_key", { provider: p.displayName })}"
              aria-label="${tInterp("ai_providers.delete_key_aria", { provider: p.displayName })}">${t("ai_providers.remove_key_btn")}${htmxSpinner(`key-delete-spinner-${p.id}`)}</button>
            ` : ""}
            <button type="button" class="btn btn-outline btn-sm"
              hx-post="/api/ai/test" hx-include="#provider-config-form-${p.id}" hx-target="#test-result-${p.id}" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#test-spinner-${p.id}" hx-disabled-elt="this"
              aria-label="${tInterp("ai_providers.test_connection_aria", { provider: p.displayName })}">${t("ai_providers.test_connection")}${htmxSpinner(`test-spinner-${p.id}`)}</button>
          </div>
        </form>
        <div id="key-result-${p.id}" class="mt-2 text-sm min-h-[1.5rem]" role="status" aria-live="polite" data-state="idle"></div>
        <div id="test-result-${p.id}" class="mt-1 text-sm min-h-[1.5rem]" role="status" aria-live="polite" data-state="idle"></div>
        <p class="text-xs text-base-content/60 mt-3">${t("ai_providers.floating_chat_hint")}</p>
      </div>`;
    })
    .join("\n    ");

  return `
<section class="${CARD_CLASS}" id="card-ai-providers" aria-labelledby="heading-ai-providers">
  <div class="card-body p-4 sm:p-6">
    <h2 id="heading-ai-providers" class="card-title text-base font-semibold">
      ${ICON_AI_PROVIDERS}
      ${t("ai_providers.title")}
    </h2>
    <p class="text-xs text-base-content/60 mt-1 mb-3">${t("ai_providers.optional_hint")}</p>

    <div id="providers-validation-auto" class="hidden" hx-post="/api/ai/providers/validate" hx-trigger="load delay:${AUTO_VALIDATION_DELAY_MS}ms" hx-vals='{"connectivity":true}' hx-target="#providers-validation-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#providers-validate-spinner" aria-hidden="true" hx-on::after-swap="document.getElementById('providers-validation-result')?.removeAttribute('aria-busy')"></div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <button type="button" class="btn btn-outline btn-sm" id="providers-refresh-btn"
        hx-post="/api/ai/providers/validate" hx-vals='{"connectivity":true}' hx-include="#providers-validation-form" hx-target="#providers-validation-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#providers-validate-spinner" hx-disabled-elt="this"
        hx-on::after-swap="document.getElementById('providers-validation-result')?.removeAttribute('aria-busy')"
        aria-label="${t("api.providers_validation_refresh")}">${t("api.providers_validation_refresh")}${htmxSpinner("providers-validate-spinner")}</button>
    </div>
    <form id="providers-validation-form" class="hidden" aria-hidden="true"><input type="hidden" name="connectivity" value="true" /></form>
    <div id="providers-validation-result" class="mb-4 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="loading" aria-busy="true">
      <div class="flex flex-col items-start gap-2 py-2">
        <div class="skeleton h-10 w-10 shrink-0 rounded"></div>
        <div class="skeleton h-4 w-48"></div>
        <p class="text-base-content/60 text-sm">${t("api.providers_validation_loading")}</p>
      </div>
    </div>

    <p class="text-xs text-base-content/55 mb-3">${t("ai_providers.configure_one")}</p>
    <input type="search" class="input input-sm w-full max-w-xs mb-2"
      placeholder="${t("ai_providers.filter_placeholder")}"
      aria-label="${t("ai_providers.filter_aria")}"
      oninput="filterProviderTabs(this.value)" />
    <div class="tabs tabs-lift tabs-sm" role="tablist" aria-label="${t("ai_providers.config_region_aria")}">
    ${tabsHtml}
    </div>

  </div>
</section>`;
}

export type FlowEngineCardProps = {
  defaultFlowMaxAttempts: string;
  defaultFlowTimeoutMs: string;
  defaultFlowRetryDelayMs: string;
};

export function FlowEngineCard(props: FlowEngineCardProps): string {
  const { defaultFlowMaxAttempts, defaultFlowTimeoutMs, defaultFlowRetryDelayMs } = props;
  const targetChoices: readonly ChoiceCardOption[] = [
    {
      id: "flow-target-osx",
      value: "osx",
      title: t("flow_engine.target_osx"),
      description: t("flow_engine.target_osx_desc"),
      ariaLabel: t("flow_engine.target_osx_aria"),
      tone: "accent",
      checked: true,
    },
    {
      id: "flow-target-android",
      value: "android",
      title: t("flow_engine.target_android"),
      description: t("flow_engine.target_android_desc"),
      ariaLabel: t("flow_engine.target_android_aria"),
      tone: "primary",
    },
    {
      id: "flow-target-ios",
      value: "ios",
      title: t("flow_engine.target_ios"),
      description: t("flow_engine.target_ios_desc"),
      ariaLabel: t("flow_engine.target_ios_aria"),
      tone: "secondary",
    },
    {
      id: "flow-target-windows",
      value: "windows",
      title: t("flow_engine.target_windows"),
      description: t("flow_engine.target_windows_desc"),
      ariaLabel: t("flow_engine.target_windows_aria"),
      tone: "accent",
    },
    {
      id: "flow-target-linux",
      value: "linux",
      title: t("flow_engine.target_linux"),
      description: t("flow_engine.target_linux_desc"),
      ariaLabel: t("flow_engine.target_linux_aria"),
      tone: "accent",
    },
  ];

  return `
<section class="${CARD_CLASS}" id="card-flows">
  <div class="card-body p-4 sm:p-6">
    <h2 class="card-title text-base font-semibold">
      ${ICON_FLOW}
      ${t("flow_engine.title")}
    </h2>
    <p class="text-xs text-base-content/60 mt-1">${t("flow_engine.subtitle")}</p>
    <p class="text-xs text-base-content/70 mt-1 mb-3">${t("flow_engine.shared_instruction")}</p>
    <form hx-post="/api/flows/runs" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" hx-confirm="${t("layout.trigger_flow_confirm")}" class="flex flex-col gap-1 w-full" aria-label="${t("flow_engine.form_aria")}">
      <label class="label py-0.5" for="flow-yaml"><span class="label-text text-xs">${t("flow_engine.paste_yaml")}</span></label>
      <textarea id="flow-yaml" name="yaml" rows="10" class="textarea w-full font-mono text-xs" placeholder="${t("flow_engine.paste_yaml_placeholder")}" aria-label="${t("flow_engine.yaml_aria")}" required></textarea>
      <div class="mt-2">
        ${renderChoiceCardGroup({
          legend: t("flow_engine.target"),
          legendId: "flow-target-legend",
          hint: t("flow_engine.target_hint"),
          hintId: "flow-target-hint-copy",
          name: "target",
          options: targetChoices,
          gridClassName: "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
        })}
        <div
          id="flow-target-runtime-hint"
          class="mt-1"
          hx-get="/api/flows/target-hint"
          hx-trigger="load, change from:input[name=target]"
          hx-vals='js:{"target": document.querySelector("input[name=target]:checked")?.value ?? "osx"}'
          hx-swap="${HTMX_SWAP_INNER}"
        ></div>
      </div>
      <details class="collapse collapse-arrow bg-base-200/30 mt-2" id="flow-execution-policy-collapse">
        <summary class="collapse-title px-4 py-2 text-xs font-semibold text-base-content/80" id="flow-execution-policy-trigger" aria-expanded="false" aria-controls="flow-execution-policy-content">
          ${t("flow_engine.execution_policy")}
        </summary>
        <div class="collapse-content px-4 pt-2 pb-3" id="flow-execution-policy-content" role="region" aria-labelledby="flow-execution-policy-trigger">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label class="flex flex-col gap-1">
              <span class="label-text text-xs">${t("flow_engine.max_attempts")}</span>
              <input name="maxAttempts" type="number" min="1" max="20" step="1" value="${defaultFlowMaxAttempts}" inputmode="numeric" class="input input-sm w-full" aria-label="${t("flow_engine.max_attempts")}" required />
              <p class="validator-hint text-xs hidden">${t("flow_engine.max_attempts_hint")}</p>
            </label>
            <label class="flex flex-col gap-1">
              <span class="label-text text-xs">${t("flow_engine.command_timeout_ms")}</span>
              <input name="commandTimeoutMs" type="number" min="1000" max="300000" step="100" value="${defaultFlowTimeoutMs}" inputmode="numeric" class="input input-sm w-full" aria-label="${t("flow_engine.command_timeout_ms")}" required />
              <p class="validator-hint text-xs hidden">${t("flow_engine.command_timeout_hint")}</p>
            </label>
            <label class="flex flex-col gap-1">
              <span class="label-text text-xs">${t("flow_engine.retry_delay_ms")}</span>
              <input name="retryDelayMs" type="number" min="50" max="30000" step="50" value="${defaultFlowRetryDelayMs}" inputmode="numeric" class="input input-sm w-full" aria-label="${t("flow_engine.retry_delay_ms")}" required />
              <p class="validator-hint text-xs hidden">${t("flow_engine.retry_delay_hint")}</p>
            </label>
          </div>
          <p class="text-xs text-base-content/60 mt-2">${t("flow_engine.execution_policy_hint")}</p>
        </div>
      </details>
      <div class="card-actions justify-start sm:justify-end pt-3 gap-2 flex-wrap">
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-outline btn-sm gap-1">
            ${t("flow_engine.preflight")}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
          <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-10 w-56 p-2 shadow-lg border border-base-content/8">
            <li><button type="button" hx-post="/api/flows/validate" hx-include="#flow-yaml, [name=target], [name=maxAttempts], [name=commandTimeoutMs], [name=retryDelayMs]" hx-target="#flow-validate-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-validate-spinner" hx-disabled-elt="this" aria-label="${t("flow_engine.validate_aria")}">${t("flow_engine.validate")}${htmxSpinner("flow-validate-spinner")}</button></li>
            <li><button type="button" hx-get="/api/flows/capabilities" hx-include="[name=target]" hx-target="#flow-capability-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-capability-spinner" hx-disabled-elt="this" aria-label="${t("flow_engine.capabilities_aria")}">${t("flow_engine.capabilities")}${htmxSpinner("flow-capability-spinner")}</button></li>
            <li><button type="button" hx-post="/api/flows/validate/automation" hx-include="#flow-yaml, [name=target], [name=maxAttempts], [name=commandTimeoutMs], [name=retryDelayMs]" hx-target="#flow-automation-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-automation-spinner" hx-disabled-elt="this" aria-label="${t("flow_engine.validate_automation_aria")}">${t("flow_engine.validate_automation")}${htmxSpinner("flow-automation-spinner")}</button></li>
          </ul>
        </div>
        <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("flow_engine.run_aria")}">${t("flow_engine.run")}${htmxSpinner("flow-spinner")}</button>
      </div>
    </form>
    <div class="tabs tabs-border tabs-sm mt-4" role="tablist" aria-label="${t("flow_engine.results_aria")}">
      <input type="radio" name="flow-result-tabs" class="tab" aria-label="${t("flow_engine.validate_result")}" id="flow-tab-validate" />
      <div class="tab-content border-base-content/8 pt-3">
        <div id="flow-validate-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
          ${idleState(ICON_IDLE_DOCUMENT, "api.idle_flow_validate")}
        </div>
      </div>
      <input type="radio" name="flow-result-tabs" class="tab" aria-label="${t("flow_engine.capabilities")}" id="flow-tab-capabilities" />
      <div class="tab-content border-base-content/8 pt-3">
        <div id="flow-capability-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
          ${idleState(ICON_IDLE_GRID, "api.idle_flow_capability")}
        </div>
      </div>
      <input type="radio" name="flow-result-tabs" class="tab" aria-label="${t("flow_engine.validate_automation")}" id="flow-tab-automation" />
      <div class="tab-content border-base-content/8 pt-3">
        <div id="flow-automation-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
          ${idleState(ICON_IDLE_SHIELD, "api.idle_flow_automation")}
        </div>
      </div>
      <input type="radio" name="flow-result-tabs" class="tab" aria-label="${t("flow_engine.run_output")}" id="flow-tab-run" checked="checked" />
      <div class="tab-content border-base-content/8 pt-3">
        <div id="flow-result-wrapper">
          <div id="flow-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
            ${idleState(ICON_IDLE_FLOW, "api.idle_flow_result")}
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

export type PreferencesCardProps = {
  storedTheme: string;
  storedLocale: Locale;
  defaultModelOptions: readonly string[];
};

export function PreferencesCard(props: PreferencesCardProps): string {
  const { storedTheme, storedLocale, defaultModelOptions } = props;
  const sel = (v: string) => (storedTheme === v ? "selected" : "");
  const selLocale = (v: Locale) => (storedLocale === v ? "selected" : "");
  return `
  <section class="${CARD_CLASS}" id="card-preferences" aria-labelledby="heading-preferences">
    <div class="card-body p-4 sm:p-6">
      <h2 id="heading-preferences" class="card-title text-base font-semibold">
        ${ICON_PREFERENCES}
        ${t("user_prefs.title")}
      </h2>
      <form hx-post="/api/prefs" hx-target="#prefs-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#prefs-spinner" hx-disabled-elt="button, input, select" hx-sync="this:replace" class="mt-3 space-y-3" aria-label="${t("user_prefs.form_aria")}">
        ${FormField({
          label: t("user_prefs.theme"),
          inputHtml: `<select id="theme-select" name="theme" class="select select-sm w-full" aria-label="${t("user_prefs.theme_aria")}">
            ${SUPPORTED_THEMES.map((th) => `<option value="${th}" ${sel(th)}>${th.charAt(0).toUpperCase() + th.slice(1)}</option>`).join("\n            ")}
          </select>`,
        })}
        ${FormField({
          label: t("user_prefs.locale"),
          inputHtml: `<select id="locale-select" name="locale" class="select select-sm w-full" aria-label="${t("user_prefs.locale_aria")}">
            ${SUPPORTED_LOCALES.map((locale) => `<option value="${locale}" ${selLocale(locale)}>${t(`user_prefs.locale_${locale}`)}</option>`).join("")}
          </select>`,
        })}
        ${FormField({
          label: t("user_prefs.default_model"),
          inputHtml: `<select id="default-model" name="defaultModel" class="select select-sm w-full" aria-label="${t("user_prefs.default_model_aria")}">
            ${defaultModelOptions.length > 0
    ? defaultModelOptions
        .map(
          (model) =>
            `<option value="${model}" ${getPreference("defaultModel") === model ? "selected" : ""}>${model}</option>`,
        )
        .join("")
    : `<option value="" selected>${t("api.no_models_found")}</option>`}
          </select>`,
        })}
        <div class="card-actions justify-end pt-2">
          <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("user_prefs.save_aria")}">${t("user_prefs.save")}${htmxSpinner("prefs-spinner")}</button>
        </div>
      </form>
      <div id="prefs-result" class="mt-2 text-sm min-h-[1.5rem]" role="status" aria-live="polite" data-state="idle"></div>

      <details class="collapse collapse-arrow bg-base-200/30 mt-4" id="ucp-discovery-collapse">
        <summary class="collapse-title px-4 py-2 text-xs font-semibold text-base-content/80" id="ucp-discovery-trigger" aria-expanded="false" aria-controls="ucp-discovery-content">
          ${ICON_UCP}
          ${t("system.ucp_advanced")}
        </summary>
        <div class="collapse-content px-4 pt-2 pb-3" id="ucp-discovery-content" role="region" aria-labelledby="ucp-discovery-trigger">
          <p class="text-xs text-base-content/60 mb-2">${t("ucp.subtitle")}</p>
          <form hx-get="/api/ucp/discover" hx-target="#ucp-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#ucp-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" class="space-y-3" aria-label="${t("ucp.form_aria")}">
            ${FormField({
              label: t("ucp.business_url"),
              inputHtml: `<input id="ucp-url" name="url" type="url" placeholder="${t("ucp.business_url_placeholder")}" class="input input-sm w-full validator" aria-label="${t("ucp.url_aria")}" required />`,
              hint: t("ucp.business_url_hint"),
            })}
            <div class="card-actions justify-end pt-1">
              <button type="submit" class="btn btn-primary btn-sm btn-outline" aria-label="${t("ucp.discover_aria")}">${t("ucp.discover")}${htmxSpinner("ucp-spinner")}</button>
            </div>
          </form>
          <div id="ucp-result" class="mt-3 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
            ${idleState(ICON_IDLE_SEARCH, "api.idle_ucp")}
          </div>
        </div>
      </details>
    </div>
  </section>`;
}
