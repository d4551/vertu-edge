/**
 * Dashboard card components. Each card is a function that returns HTML.
 */
import {
  APP_BUILD_VARIANT_PLACEHOLDER,
  OLLAMA_DEFAULT_BASE_URL,
  PROVIDER_API_KEY_PLACEHOLDER,
  type ModelSourceConfig,
} from "../config";
import { htmxSpinner, HTMX_SWAP_INNER } from "../htmx-helpers";
import { SUPPORTED_LOCALES, t, tInterp, type Locale } from "../i18n";
import { getApiKey, getBaseUrl, maskApiKey } from "../ai-keys";
import { getPreference } from "../db";
import {
  ICON_MODEL,
  ICON_APP_BUILD,
  ICON_AI_PROVIDERS,
  ICON_FLOW,
  ICON_PREFERENCES,
  ICON_UCP,
  ICON_IDLE_DOWNLOAD,
  ICON_IDLE_SETTINGS,
  ICON_IDLE_DOCUMENT,
  ICON_IDLE_GRID,
  ICON_IDLE_SHIELD,
  ICON_IDLE_SEARCH,
  ICON_IDLE_FLOW,
  ICON_SAVE,
} from "../icons";
import { esc } from "../renderers/index";
import type { ProviderMeta } from "../ai-providers";
import type { ProviderStatus } from "../ai-keys";

const CARD_CLASS = "card bg-base-100 border border-base-content/8 shadow-md overflow-hidden";

/** Reusable idle empty-state block with centered icon and message. */
function idleState(icon: string, messageKey: string): string {
  return `<div class="flex flex-col items-center justify-center gap-2 py-4 text-center">
    ${icon}
    <p class="text-base-content/50 text-xs">${t(messageKey)}</p>
  </div>`;
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
  <div class="${CARD_CLASS}" id="card-models">
    <div class="card-body p-4 sm:p-6">
      <h2 class="card-title text-base font-semibold">
        ${ICON_MODEL}
        ${t("model_mgmt.title")}
      </h2>
      <p class="text-xs text-base-content/60 mt-1">${t("model_mgmt.powered_by")} · ${t("model_mgmt.containerized")}</p>

      <form hx-post="/api/models/pull" hx-target="#model-pull-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#model-pull-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" class="mt-3 space-y-3" aria-label="${t("model_mgmt.form_aria")}">
        <div class="form-control">
          <label class="label py-0.5" for="model-ref-input"><span class="label-text text-xs">${t("model_mgmt.model_ref")}</span></label>
          <input id="model-ref-input" name="modelRef" value="${currentModel}" type="text"
            data-tooltip="${t("model_mgmt.model_ref_hint")}" placeholder="${safePlaceholder}"
            class="input input-bordered input-sm w-full validator" aria-label="${t("model_mgmt.model_ref")}" />
        </div>
        <div class="form-control">
          <label class="label py-0.5" for="model-source-select"><span class="label-text text-xs">${t("model_mgmt.source")}</span></label>
          <select id="model-source-select" name="source" class="select select-bordered select-sm w-full" aria-label="${t("model_mgmt.source")}">
          ${modelPullSources
            .map(
              (source) =>
                `<option value="${esc(source.id)}" data-placeholder="${esc(source.modelRefPlaceholder)}" data-hint="${esc(source.modelRefHint ?? "")}" ${source.id === defaultModelSource ? "selected" : ""}>${esc(source.displayName)}</option>`,
            )
            .join("")}
          </select>
        </div>
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
          <label class="label cursor-pointer gap-2 py-0">
            <input type="checkbox" name="force" class="checkbox checkbox-xs checkbox-primary" />
            <span class="label-text text-xs">${t("model_mgmt.force_pull")}</span>
          </label>
          <button type="submit" class="btn btn-accent btn-sm" aria-label="${t("model_mgmt.pull_model")}">${t("model_mgmt.pull_model")}${htmxSpinner("model-pull-spinner")}</button>
        </div>
      </form>

      <div id="model-pull-result" class="mt-3 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
        ${idleState(ICON_IDLE_DOWNLOAD, "api.idle_model_pull")}
      </div>

      <div class="divider my-2 text-xs text-base-content/40">${t("model_search.label")}</div>

      <div class="join w-full">
        <input id="model-search-input" name="q" type="search" placeholder="${t("model_search.placeholder")}"
          class="input input-bordered input-sm flex-1 join-item" aria-label="${t("model_search.aria")}" />
        <button type="button" class="btn btn-secondary btn-sm join-item"
          hx-get="/api/models/search" hx-include="#model-search-input"
          hx-target="#model-search-result" hx-swap="${HTMX_SWAP_INNER}"
          hx-indicator="#model-search-spinner" hx-disabled-elt="this"
          aria-label="${t("model_search.button_aria")}">${t("model_search.button")}${htmxSpinner("model-search-spinner")}</button>
      </div>
      <div id="model-search-result" class="mt-2 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle"></div>

      <div class="divider my-2 text-xs text-base-content/40">${t("model_mgmt.local_models")}</div>

      <div class="flex items-center justify-between" id="model-list" role="status" aria-live="polite">
        <span class="text-xs text-base-content/60">${t("model_mgmt.click_refresh")}</span>
        <button type="button" class="btn btn-xs btn-outline" data-tip="${t("model_mgmt.refresh")}" hx-get="/api/models" hx-target="#model-list" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#model-list-spinner" hx-disabled-elt="this" aria-label="${t("model_mgmt.refresh_aria")}">${t("model_mgmt.refresh")}${htmxSpinner("model-list-spinner", "ml-1")}</button>
      </div>
    </div>
  </div>`;
}

export function AppBuildCard(): string {
  return `
  <div class="${CARD_CLASS}" id="card-app-build">
    <div class="card-body p-4 sm:p-6">
      <h2 class="card-title text-base font-semibold">
        ${ICON_APP_BUILD}
        ${t("app_build.title")}
      </h2>
      <p class="text-xs text-base-content/60 mt-1">${t("app_build.subtitle")}</p>

      <form hx-post="/api/apps/build" hx-target="#app-build-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#app-build-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" class="mt-3 space-y-3" aria-label="${t("app_build.form_aria")}">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label py-0.5" for="app-build-platform"><span class="label-text text-xs">${t("app_build.platform")}</span></label>
            <select id="app-build-platform" name="platform" class="select select-bordered select-sm w-full" aria-label="${t("app_build.platform")}">
              <option value="android">${t("app_build.android")}</option>
              <option value="ios">${t("app_build.ios")}</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label py-0.5" for="app-build-build-type"><span class="label-text text-xs">${t("app_build.build_type")}</span></label>
            <select id="app-build-build-type" name="buildType" class="select select-bordered select-sm w-full" aria-label="${t("app_build.build_type")}">
              <option value="debug">${t("app_build.debug")}</option>
              <option value="release">${t("app_build.release")}</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label py-0.5" for="app-build-variant"><span class="label-text text-xs">${t("app_build.variant")}</span></label>
            <input id="app-build-variant" name="variant" type="text" class="input input-bordered input-sm w-full" placeholder="${APP_BUILD_VARIANT_PLACEHOLDER}" aria-label="${t("app_build.variant")}" />
          </div>
          <div class="form-control">
            <label class="label py-0.5" for="app-build-output-dir"><span class="label-text text-xs">${t("app_build.output_dir")}</span></label>
            <input id="app-build-output-dir" name="outputDir" type="text" class="input input-bordered input-sm w-full" placeholder="${t("app_build.output_dir_hint")}" aria-label="${t("app_build.output_dir")}" />
          </div>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex gap-3">
            <label class="label cursor-pointer gap-1.5 py-0">
              <input type="checkbox" name="skipTests" class="checkbox checkbox-xs checkbox-primary" />
              <span class="label-text text-xs">${t("app_build.skip_tests")}</span>
            </label>
            <label class="label cursor-pointer gap-1.5 py-0">
              <input type="checkbox" name="clean" class="checkbox checkbox-xs checkbox-primary" />
              <span class="label-text text-xs">${t("app_build.clean")}</span>
            </label>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">${t("app_build.launch")}${htmxSpinner("app-build-spinner")}</button>
        </div>
      </form>

      <div id="app-build-result" class="mt-3 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
        ${idleState(ICON_IDLE_SETTINGS, "api.idle_app_build")}
      </div>
    </div>
  </div>`;
}

export type AiProvidersCardProps = {
  providers: readonly ProviderMeta[];
  statuses: readonly ProviderStatus[];
};

export function AiProvidersCard(props: AiProvidersCardProps): string {
  const { providers, statuses } = props;
  const accordionHtml = providers
    .map((p, i) => {
      const status = statuses.find((s) => s.provider === p.id);
      const storedKey = getApiKey(p.id) ?? "";
      const storedBaseUrl = getBaseUrl(p.id) ?? p.baseUrl;
      const maskedKey = maskApiKey(storedKey);
      const firstConfiguredIdx = providers.findIndex((pr) => statuses.find((s) => s.provider === pr.id)?.configured);
      const defaultOpen = firstConfiguredIdx >= 0 ? i === firstConfiguredIdx : i === 0;
      return `<div class="collapse collapse-arrow bg-base-100 border border-base-300" id="accordion-${p.id}">
        <input type="radio" name="ai-provider-accordion" id="accordion-radio-${p.id}" ${defaultOpen ? "checked" : ""} aria-label="${tInterp("ai_providers.expand_accordion_aria", { provider: p.displayName })}" />
        <div class="flex items-center gap-2 flex-wrap">
          <label for="accordion-radio-${p.id}" class="collapse-title flex-1 font-semibold flex items-center gap-2 flex-wrap cursor-pointer min-h-0" id="accordion-title-${p.id}" tabindex="0" role="button" aria-expanded="${defaultOpen ? "true" : "false"}" aria-controls="accordion-content-${p.id}">
            <span>${p.displayName}</span>
            ${status?.configured
            ? `<span class="badge badge-success badge-sm">${t("ai_providers.configured")}</span>`
            : `<span class="badge badge-ghost badge-sm">${t("ai_providers.not_configured")}</span>`}
          </label>
          <a href="${p.docsUrl}" target="_blank" rel="noopener" class="link link-primary text-xs shrink-0 pr-4" aria-label="${tInterp("ai_providers.docs_aria", { provider: p.displayName })}" onclick="event.stopPropagation()">${t("ai_providers.docs_link")}</a>
        </div>
        <div class="collapse-content" id="accordion-content-${p.id}" role="region" aria-labelledby="accordion-title-${p.id}">
          <div class="pt-2">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="space-y-3">
                <form id="provider-config-form-${p.id}" hx-post="/api/ai/keys" hx-target="#key-result-${p.id}" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#key-spinner-${p.id}" hx-disabled-elt="button, input" hx-sync="this:replace" class="space-y-3" aria-label="${tInterp("ai_providers.save_config_aria", { provider: p.displayName })}">
                  <input type="hidden" name="provider" value="${p.id}" />
                  ${p.requiresKey ? `
                  <div class="form-control">
                    <label class="label py-0.5" for="key-${p.id}"><span class="label-text text-xs">${t("ai_providers.api_key")}</span></label>
                    <input id="key-${p.id}" name="apiKey" type="password" placeholder="${maskedKey || (p.keyHint ?? PROVIDER_API_KEY_PLACEHOLDER)}" required
                      class="input input-bordered input-sm w-full font-mono validator" aria-label="${tInterp("ai_providers.api_key_aria", { provider: p.displayName })}" />
                    <p class="validator-hint text-xs hidden">${t("api.key_required")}</p>
                  </div>
                  ` : ""}
                  ${p.hasBaseUrlConfig ? `
                  <div class="form-control">
                    <label class="label py-0.5" for="url-${p.id}"><span class="label-text text-xs">${t("ai_providers.base_url")}</span></label>
                    <input id="url-${p.id}" name="baseUrl" type="url" value="${storedBaseUrl}" required
                      class="input input-bordered input-sm w-full font-mono validator" placeholder="${OLLAMA_DEFAULT_BASE_URL}" aria-label="${t("ai_providers.ollama_url_aria")}" />
                    <p class="validator-hint text-xs hidden">${t("api.base_url_invalid_short")}</p>
                  </div>
                  ` : ""}
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
                <div id="key-result-${p.id}" class="text-sm min-h-[1.5rem]" role="status" aria-live="polite" data-state="idle"></div>
                <div id="test-result-${p.id}" class="text-sm min-h-[1.5rem]" role="status" aria-live="polite" data-state="idle"></div>
              </div>
              <p class="text-xs text-base-content/60">${t("ai_providers.floating_chat_hint")}</p>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("\n    ");

  return `
<section class="${CARD_CLASS} mb-4 sm:mb-6" id="card-ai-providers" aria-labelledby="heading-ai-providers">
  <div class="card-body p-4 sm:p-6">
    <h2 id="heading-ai-providers" class="card-title text-base font-semibold">
      ${ICON_AI_PROVIDERS}
      ${t("ai_providers.title")}
    </h2>
    <p class="text-xs text-base-content/60 mt-1 mb-3">${t("ai_providers.optional_hint")}</p>

    <div id="providers-validation-auto" class="hidden" hx-post="/api/ai/providers/validate" hx-trigger="load delay:100ms" hx-vals='{"connectivity":true}' hx-target="#providers-validation-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#providers-validate-spinner" aria-hidden="true" hx-on::after-swap="document.getElementById('providers-validation-result')?.removeAttribute('aria-busy')"></div>
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

    <p class="text-xs text-base-content/50 mb-3">${t("ai_providers.configure_one")}</p>
    <div class="space-y-1" role="region" aria-label="${t("ai_providers.config_region_aria")}">
    ${accordionHtml}
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
  return `
<section class="${CARD_CLASS} mb-4 sm:mb-6" id="card-flows">
  <div class="card-body p-4 sm:p-6">
    <h2 class="card-title text-base font-semibold">
      ${ICON_FLOW}
      ${t("flow_engine.title")}
    </h2>
    <p class="text-xs text-base-content/60 mt-1">${t("flow_engine.subtitle")}</p>
    <p class="text-xs text-base-content/70 mt-1 mb-3">${t("flow_engine.shared_instruction")}</p>
    <form hx-post="/api/flows/runs" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" hx-confirm="${t("layout.trigger_flow_confirm")}" class="form-control w-full" aria-label="${t("flow_engine.form_aria")}">
      <label class="label py-0.5" for="flow-yaml"><span class="label-text text-xs">${t("flow_engine.paste_yaml")}</span></label>
      <textarea id="flow-yaml" name="yaml" rows="6" class="textarea textarea-bordered w-full font-mono text-xs" placeholder="${t("flow_engine.paste_yaml_placeholder")}" aria-label="${t("flow_engine.yaml_aria")}"></textarea>
      <div class="form-control mt-2">
        <div class="label">
          <span class="label-text text-xs">${t("flow_engine.target")}</span>
        </div>
        <div class="join join-vertical sm:join-horizontal flex-wrap">
          <label class="label cursor-pointer justify-start gap-2 join-item">
            <input type="radio" name="target" value="osx" class="radio radio-primary radio-sm" checked />
            <span class="text-sm">${t("flow_engine.target_osx")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2 join-item">
            <input type="radio" name="target" value="android" class="radio radio-primary radio-sm" />
            <span class="text-sm">${t("flow_engine.target_android")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2 join-item">
            <input type="radio" name="target" value="ios" class="radio radio-primary radio-sm" />
            <span class="text-sm">${t("flow_engine.target_ios")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2 join-item">
            <input type="radio" name="target" value="windows" class="radio radio-primary radio-sm" />
            <span class="text-sm">${t("flow_engine.target_windows")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2 join-item">
            <input type="radio" name="target" value="linux" class="radio radio-primary radio-sm" />
            <span class="text-sm">${t("flow_engine.target_linux")}</span>
          </label>
        </div>
      </div>
      <div class="collapse collapse-arrow bg-base-200/30 mt-2" id="flow-execution-policy-collapse">
        <input type="checkbox" id="flow-execution-policy-checkbox" aria-hidden="true" tabindex="-1" />
        <label for="flow-execution-policy-checkbox" class="collapse-title px-4 py-2 text-xs font-semibold text-base-content/80 cursor-pointer" role="button" tabindex="0" aria-expanded="false" aria-controls="flow-execution-policy-content" id="flow-execution-policy-trigger">
          ${t("flow_engine.execution_policy")}
        </label>
        <div class="collapse-content px-4 pt-2 pb-3" id="flow-execution-policy-content" role="region" aria-labelledby="flow-execution-policy-trigger">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label class="form-control">
              <span class="label-text text-xs">${t("flow_engine.max_attempts")}</span>
              <input name="maxAttempts" type="number" min="1" step="1" value="${defaultFlowMaxAttempts}" class="input input-bordered input-sm w-full" aria-label="${t("flow_engine.max_attempts")}" data-tooltip="${t("flow_engine.max_attempts_hint")}" />
            </label>
            <label class="form-control">
              <span class="label-text text-xs">${t("flow_engine.command_timeout_ms")}</span>
              <input name="commandTimeoutMs" type="number" min="1000" step="100" value="${defaultFlowTimeoutMs}" class="input input-bordered input-sm w-full" aria-label="${t("flow_engine.command_timeout_ms")}" data-tooltip="${t("flow_engine.command_timeout_hint")}" />
            </label>
            <label class="form-control">
              <span class="label-text text-xs">${t("flow_engine.retry_delay_ms")}</span>
              <input name="retryDelayMs" type="number" min="50" step="50" value="${defaultFlowRetryDelayMs}" class="input input-bordered input-sm w-full" aria-label="${t("flow_engine.retry_delay_ms")}" data-tooltip="${t("flow_engine.retry_delay_hint")}" />
            </label>
          </div>
          <p class="text-xs text-base-content/60 mt-2">${t("flow_engine.execution_policy_hint")}</p>
        </div>
      </div>
      <div class="card-actions justify-start sm:justify-end pt-3 gap-2 flex-wrap">
        <button type="button" class="btn btn-outline btn-sm" hx-post="/api/flows/validate" hx-include="#flow-yaml, [name=target], [name=maxAttempts], [name=commandTimeoutMs], [name=retryDelayMs]" hx-target="#flow-validate-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-validate-spinner" hx-disabled-elt="this" aria-label="${t("flow_engine.validate_aria")}">${t("flow_engine.validate")}${htmxSpinner("flow-validate-spinner")}</button>
        <button type="button" class="btn btn-outline btn-sm" hx-get="/api/flows/capabilities" hx-include="[name=target]" hx-target="#flow-capability-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-capability-spinner" hx-disabled-elt="this" aria-label="${t("flow_engine.capabilities_aria")}">${t("flow_engine.capabilities")}${htmxSpinner("flow-capability-spinner")}</button>
        <button type="button" class="btn btn-outline btn-sm" hx-post="/api/flows/validate/automation" hx-include="#flow-yaml, [name=target], [name=maxAttempts], [name=commandTimeoutMs], [name=retryDelayMs]" hx-target="#flow-automation-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#flow-automation-spinner" hx-disabled-elt="this" aria-label="${t("flow_engine.validate_automation_aria")}">${t("flow_engine.validate_automation")}${htmxSpinner("flow-automation-spinner")}</button>
        <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("flow_engine.run_aria")}">${t("flow_engine.run")}${htmxSpinner("flow-spinner")}</button>
      </div>
    </form>
    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <div>
        <h3 class="font-semibold text-sm mb-1" id="flow-validate-heading">${t("flow_engine.validate_result")}</h3>
        <div id="flow-validate-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle" aria-labelledby="flow-validate-heading">
          ${idleState(ICON_IDLE_DOCUMENT, "api.idle_flow_validate")}
        </div>
      </div>
      <div>
        <h3 class="font-semibold text-sm mb-1" id="flow-capability-heading">${t("flow_engine.capabilities")}</h3>
        <div id="flow-capability-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle" aria-labelledby="flow-capability-heading">
          ${idleState(ICON_IDLE_GRID, "api.idle_flow_capability")}
        </div>
      </div>
      <div>
        <h3 class="font-semibold text-sm mb-1" id="flow-automation-heading">${t("flow_engine.validate_automation")}</h3>
        <div id="flow-automation-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle" aria-labelledby="flow-automation-heading">
          ${idleState(ICON_IDLE_SHIELD, "api.idle_flow_automation")}
        </div>
      </div>
    </div>
    <div class="mt-4">
      <h3 class="font-semibold text-sm mb-1" id="flow-result-heading">${t("flow_engine.run_output")}</h3>
      <div id="flow-result" class="text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle" aria-labelledby="flow-result-heading">
        ${idleState(ICON_IDLE_FLOW, "api.idle_flow_result")}
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
  <div class="${CARD_CLASS}" id="card-preferences">
    <div class="card-body p-4 sm:p-6">
      <h2 class="card-title text-base font-semibold">
        ${ICON_PREFERENCES}
        ${t("user_prefs.title")}
      </h2>
      <form hx-post="/api/prefs" hx-target="#prefs-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#prefs-spinner" hx-disabled-elt="button, input, select" hx-sync="this:replace" class="mt-3 space-y-3" aria-label="${t("user_prefs.form_aria")}">
        <div class="form-control">
          <label class="label py-0.5" for="theme-select"><span class="label-text text-xs">${t("user_prefs.theme")}</span></label>
          <select id="theme-select" name="theme" class="select select-bordered select-sm w-full" aria-label="${t("user_prefs.theme_aria")}">
            <option value="dark" ${sel("dark")}>${t("user_prefs.theme_dark")}</option>
            <option value="light" ${sel("light")}>${t("user_prefs.theme_light")}</option>
            <option value="luxury" ${sel("luxury")}>${t("user_prefs.theme_luxury")}</option>
          </select>
        </div>
        <div class="form-control">
          <label class="label py-0.5" for="locale-select"><span class="label-text text-xs">${t("user_prefs.locale")}</span></label>
          <select id="locale-select" name="locale" class="select select-bordered select-sm w-full" aria-label="${t("user_prefs.locale_aria")}">
            ${SUPPORTED_LOCALES.map((locale) => `<option value="${locale}" ${selLocale(locale)}>${t(`user_prefs.locale_${locale}`)}</option>`).join("")}
          </select>
        </div>
        <div class="form-control">
          <label class="label py-0.5" for="default-model"><span class="label-text text-xs">${t("user_prefs.default_model")}</span></label>
          <select id="default-model" name="defaultModel" class="select select-bordered select-sm w-full" aria-label="${t("user_prefs.default_model_aria")}">
            ${defaultModelOptions.length > 0
    ? defaultModelOptions
        .map(
          (model) =>
            `<option value="${model}" ${getPreference("defaultModel") === model ? "selected" : ""}>${model}</option>`,
        )
        .join("")
    : `<option value="" selected>${t("api.no_models_found")}</option>`}
          </select>
        </div>
        <div class="card-actions justify-end pt-2">
          <button type="submit" class="btn btn-primary btn-sm" aria-label="${t("user_prefs.save_aria")}">${t("user_prefs.save")}${htmxSpinner("prefs-spinner")}</button>
        </div>
      </form>
      <div id="prefs-result" class="mt-2 text-sm min-h-[1.5rem]" role="status" aria-live="polite" data-state="idle"></div>
    </div>
  </div>`;
}

export function UcpCard(): string {
  return `
  <div class="${CARD_CLASS}" id="card-ucp">
    <div class="card-body p-4 sm:p-6">
      <h2 class="card-title text-base font-semibold">
        ${ICON_UCP}
        ${t("ucp.title")}
      </h2>
      <p class="text-xs text-base-content/60 mt-1">${t("ucp.subtitle")}</p>
      <form hx-get="/api/ucp/discover" hx-target="#ucp-result" hx-swap="${HTMX_SWAP_INNER}" hx-indicator="#ucp-spinner" hx-disabled-elt="button, input" hx-sync="this:replace" class="mt-3 space-y-3" aria-label="${t("ucp.form_aria")}">
        <div class="form-control">
          <label class="label py-0.5" for="ucp-url"><span class="label-text text-xs">${t("ucp.business_url")}</span></label>
          <input id="ucp-url" name="url" type="url" placeholder="${t("ucp.business_url_placeholder")}" class="input input-bordered input-sm w-full validator" aria-label="${t("ucp.url_aria")}" required />
          <p class="validator-hint text-xs">${t("ucp.business_url_hint")}</p>
        </div>
        <div class="card-actions justify-end pt-1">
          <button type="submit" class="btn btn-primary btn-sm btn-outline" aria-label="${t("ucp.discover_aria")}">${t("ucp.discover")}${htmxSpinner("ucp-spinner")}</button>
        </div>
      </form>
      <div id="ucp-result" class="mt-3 text-sm min-h-[2rem]" role="status" aria-live="polite" data-state="idle">
        ${idleState(ICON_IDLE_SEARCH, "api.idle_ucp")}
      </div>
    </div>
  </div>`;
}
