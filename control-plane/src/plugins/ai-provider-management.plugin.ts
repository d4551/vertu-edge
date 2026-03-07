import { Elysia } from "elysia";
import type {
  ApiEnvelope,
  FlowCapabilityError,
  FlowCapabilitySurface,
  ProviderValidationEnvelope,
} from "../../../contracts/flow-contracts";
import { OLLAMA_DEFAULT_BASE_URL } from "../config";
import { PROVIDER_VALIDATE_ROUTE } from "../runtime-constants";
import {
  deleteApiKey,
  getAllProviderStatuses,
  getApiKey,
  getBaseUrl,
  saveApiKey,
} from "../ai-keys";
import {
  type ProviderId,
  getProvider,
  listProviderModels,
  listProviderModelsOrDefaults,
  parseProviderId,
  PROVIDERS,
  testConnection,
} from "../ai-providers";
import { t as tStr, tInterp } from "../i18n";
import { esc, renderStatusEnvelope } from "../renderers";
import { providerStatusBadgeClass, providerStatusLabel } from "../provider-status-view";
import {
  providerCredentialBodySchema,
  providerDeleteBodySchema,
  providerValidationBodySchema,
} from "../contracts/http";
import {
  type RequestBodyRecord,
  parseOptionalTrimmedString,
  toRequestBody,
  toRequestQuery,
} from "../http-helpers";

type CapabilityFailure = Error | string | number | boolean | null | undefined | { readonly message?: string };

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const AI_ROUTE_PREFIX = "/api/ai";
const PROVIDER_KEYS_ROUTE = `${AI_ROUTE_PREFIX}/keys`;
const PROVIDER_KEYS_DELETE_ROUTE = `${PROVIDER_KEYS_ROUTE}/delete`;
const PROVIDER_TEST_ROUTE = `${AI_ROUTE_PREFIX}/test`;
const PROVIDER_CHAT_ROUTE = `${AI_ROUTE_PREFIX}/chat`;

type AiProviderManagementPluginDependencies = {
  /** Convert arbitrary failures into typed capability errors. */
  readonly toCapabilityError: (
    failure: CapabilityFailure,
    command: string,
    surface?: FlowCapabilitySurface,
  ) => FlowCapabilityError;
  /** Parse provider validation payloads. */
  readonly parseProviderValidationBody: (body: RequestBodyRecord | null | undefined) => { connectivity: boolean };
  /** Validate all configured providers. */
  readonly validateProviders: (connectivity: boolean) => Promise<ProviderValidationEnvelope>;
  /** Render provider validation state. */
  readonly renderProviderValidationState: (route: string, envelope: ProviderValidationEnvelope) => string;
  /** Validate supported http(s) base URLs. */
  readonly isSupportedHttpUrl: (value: string) => boolean;
  /** Render provider model select options plus state badge. */
  readonly renderModelSelectionOptions: (
    providerId: ProviderId,
    optionsHtml: string,
    state: "success" | "empty" | "unauthorized" | "error-retryable" | "error-non-retryable",
    message: string,
    stateId?: string,
  ) => string;
  /** Build provider model option rows with selected state. */
  readonly buildModelSelectOptions: (models: readonly string[], selectedModel: string | undefined) => string;
  /** Reduce provider transport errors to safe UI text. */
  readonly sanitizeApiErrorForDisplay: (error: string) => string;
};

function renderSimpleStatus(route: string, envelope: ApiEnvelope, heading: string, message: string): string {
  return renderStatusEnvelope(route, envelope, heading, message, envelope.mismatches ?? []);
}

/** Create the `/api/ai` provider/configuration route plugin. */
export function createAiProviderManagementPlugin({
  toCapabilityError,
  parseProviderValidationBody,
  validateProviders,
  renderProviderValidationState,
  isSupportedHttpUrl,
  renderModelSelectionOptions,
  buildModelSelectOptions,
  sanitizeApiErrorForDisplay,
}: AiProviderManagementPluginDependencies) {
  return new Elysia({ name: "ai-provider-management", prefix: AI_ROUTE_PREFIX })
    .get("/providers", ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const statuses = getAllProviderStatuses(PROVIDERS.map((provider) => ({
        provider: provider.id,
        requiresKey: provider.requiresKey,
      })));
      const items = statuses
        .map((status) => {
          const meta = getProvider(status.provider);
          const badge = `<span class="badge ${providerStatusBadgeClass(status)} badge-xs">${esc(providerStatusLabel(status))}</span>`;
          return `<li class="flex items-center gap-2"><strong>${meta?.displayName ?? status.provider}</strong> ${badge}</li>`;
        })
        .join("");
      return `<ul class="space-y-1 text-sm">${items}</ul>`;
    })
    .post("/providers/validate", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const { connectivity } = parseProviderValidationBody(toRequestBody(body));
      return validateProviders(connectivity).then(
        (envelope) => renderProviderValidationState(PROVIDER_VALIDATE_ROUTE, envelope),
        (failure) => {
          const flowError = toCapabilityError(failure, "provider_validate");
          const envelope: ProviderValidationEnvelope = {
            route: PROVIDER_VALIDATE_ROUTE,
            state: flowError.retryable ? "error-retryable" : "error-non-retryable",
            error: flowError,
            mismatches: [flowError.reason],
          };
          return renderProviderValidationState(PROVIDER_VALIDATE_ROUTE, envelope);
        },
      );
    }, {
      body: providerValidationBodySchema,
    })
    .post("/keys", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderSimpleStatus(PROVIDER_KEYS_ROUTE, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"));
      }

      const meta = getProvider(provider);
      if (!meta) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderSimpleStatus(PROVIDER_KEYS_ROUTE, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"));
      }

      const apiKey = parseOptionalTrimmedString(body.apiKey);
      const baseUrl = parseOptionalTrimmedString(body.baseUrl);
      if (meta.requiresKey && !apiKey) {
        const reason = tInterp("api.key_required", { provider: meta.displayName });
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_ROUTE,
          state: "unauthorized",
          mismatches: [reason],
        };
        return renderSimpleStatus(PROVIDER_KEYS_ROUTE, envelope, tStr("api.request_failed"), reason);
      }

      if (provider === "ollama" && !baseUrl) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.base_url_required")],
        };
        return renderSimpleStatus(PROVIDER_KEYS_ROUTE, envelope, tStr("api.request_failed"), tStr("api.base_url_required"));
      }

      if (baseUrl && !isSupportedHttpUrl(baseUrl)) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_ROUTE,
          state: "error-non-retryable",
          mismatches: [tInterp("api.base_url_invalid", { url: baseUrl })],
        };
        return renderSimpleStatus(PROVIDER_KEYS_ROUTE, envelope, tStr("api.request_failed"), tStr("api.base_url_invalid_short"));
      }

      const saveResult = saveApiKey(provider, apiKey ?? "", baseUrl);
      if (!saveResult.ok) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_ROUTE,
          state: "error-non-retryable",
          mismatches: [saveResult.error.message],
        };
        return renderSimpleStatus(PROVIDER_KEYS_ROUTE, envelope, tStr("api.request_failed"), saveResult.error.message);
      }
      set.headers["HX-Trigger"] = `provider-config-updated-${provider}`;
      const successMessage = tInterp("api.key_saved", { provider: meta.displayName });
      const toastHtml = `<div id="toast-container" hx-swap-oob="innerHTML"><div class="alert alert-success" role="status"><span>${esc(successMessage)}</span></div></div>`;
      const envelope: ApiEnvelope = {
        route: PROVIDER_KEYS_ROUTE,
        state: "success",
        mismatches: [],
      };
      return `${renderStatusEnvelope(PROVIDER_KEYS_ROUTE, envelope, meta.displayName, successMessage, [])}${toastHtml}`;
    }, {
      body: providerCredentialBodySchema,
    })
    .post("/keys/delete", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_DELETE_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderSimpleStatus(PROVIDER_KEYS_DELETE_ROUTE, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"));
      }

      const meta = getProvider(provider);
      if (!meta) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_KEYS_DELETE_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderSimpleStatus(PROVIDER_KEYS_DELETE_ROUTE, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"));
      }

      deleteApiKey(provider);
      set.headers["HX-Trigger"] = `provider-config-updated-${provider}`;
      const envelope: ApiEnvelope = {
        route: PROVIDER_KEYS_DELETE_ROUTE,
        state: "success",
        mismatches: [],
      };
      return renderStatusEnvelope(PROVIDER_KEYS_DELETE_ROUTE, envelope, meta.displayName, tInterp("api.key_removed", { provider: meta.displayName }), []);
    }, {
      body: providerDeleteBodySchema,
    })
    .post("/test", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const provider = parseProviderId(body.provider);
      if (!provider) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_TEST_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderSimpleStatus(PROVIDER_TEST_ROUTE, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"));
      }

      const meta = getProvider(provider);
      if (!meta) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_TEST_ROUTE,
          state: "error-non-retryable",
          mismatches: [tStr("api.unknown_provider")],
        };
        return renderSimpleStatus(PROVIDER_TEST_ROUTE, envelope, tStr("api.request_failed"), tStr("api.unknown_provider"));
      }

      const apiKey = parseOptionalTrimmedString(body.apiKey) ?? (getApiKey(provider) ?? "");
      const baseUrl = parseOptionalTrimmedString(body.baseUrl) ?? getBaseUrl(provider) ?? meta.baseUrl;
      if (meta.requiresKey && apiKey.trim().length === 0) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_TEST_ROUTE,
          state: "unauthorized",
          mismatches: [tStr("api.chat_key_required")],
        };
        return renderSimpleStatus(PROVIDER_TEST_ROUTE, envelope, tStr("api.request_failed"), tStr("api.chat_key_required"));
      }

      if (!isSupportedHttpUrl(baseUrl)) {
        const envelope: ApiEnvelope = {
          route: PROVIDER_TEST_ROUTE,
          state: "error-non-retryable",
          mismatches: [tInterp("api.base_url_invalid", { url: baseUrl })],
        };
        return renderSimpleStatus(PROVIDER_TEST_ROUTE, envelope, tStr("api.request_failed"), tStr("api.base_url_invalid_short"));
      }

      return testConnection(provider, apiKey, baseUrl).then((result) => {
        if (result.ok) {
          const envelope: ApiEnvelope = {
            route: PROVIDER_TEST_ROUTE,
            state: "success",
            mismatches: [],
          };
          return renderStatusEnvelope(PROVIDER_TEST_ROUTE, envelope, meta.displayName, tInterp("api.connected", { provider: meta.displayName }));
        }

        const reason = result.error ?? tStr("api.connection_failed");
        const envelope: ApiEnvelope = {
          route: PROVIDER_TEST_ROUTE,
          state: "error-retryable",
          mismatches: [reason],
        };
        return renderStatusEnvelope(PROVIDER_TEST_ROUTE, envelope, meta.displayName, tStr("api.connection_failed"), envelope.mismatches);
      });
    }, {
      body: providerCredentialBodySchema,
    })
    .get("/providers/options", ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const statuses = getAllProviderStatuses(PROVIDERS.map((provider) => ({ provider: provider.id, requiresKey: provider.requiresKey })));
      const configured = statuses.filter((status) => status.configured);
      if (configured.length === 0) {
        return `<option value="" disabled selected>${tStr("ai_providers.floating_chat_no_providers")}</option>`;
      }
      const options = configured
        .map((status) => {
          const meta = getProvider(status.provider);
          return meta ? `<option value="${esc(status.provider)}">${esc(meta.displayName)}</option>` : "";
        })
        .filter(Boolean)
        .join("");
      return `<option value="" disabled selected>${tStr("ai_providers.select_provider")}</option>${options}`;
    })
    .get("/models", ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const queryRecord = toRequestQuery(query);
      const raw = parseOptionalTrimmedString(queryRecord?.provider);
      const stateId = parseOptionalTrimmedString(queryRecord?.stateId);
      if (!raw) {
        return `<option value="" disabled selected>${tStr("api.models_provider_required")}</option>`;
      }

      const providerId = parseProviderId(raw);
      if (!providerId) {
        return `<option value="" disabled selected>${tStr("api.unknown_provider")}</option>`;
      }

      const resolvedProvider = getProvider(providerId);
      if (!resolvedProvider) {
        return `<option value="" disabled selected>${tStr("api.unknown_provider")}</option>`;
      }

      const baseUrl = parseOptionalTrimmedString(queryRecord?.baseUrl)
        ?? getBaseUrl(resolvedProvider.id)
        ?? resolvedProvider.baseUrl;
      const apiKey = parseOptionalTrimmedString(queryRecord?.apiKey)
        ?? (getApiKey(resolvedProvider.id) ?? "");
      const selectedModel = parseOptionalTrimmedString(queryRecord?.selectedModel)
        ?? parseOptionalTrimmedString(queryRecord?.model);

      if (resolvedProvider.requiresKey && apiKey.trim().length === 0) {
        const option = `<option value="" disabled selected>${tStr("api.model_selection_key_required")}</option>`;
        return renderModelSelectionOptions(
          resolvedProvider.id,
          option,
          "unauthorized",
          tStr("api.model_selection_key_required"),
          stateId ?? undefined,
        );
      }

      if (!isSupportedHttpUrl(baseUrl)) {
        const option = `<option value="" disabled selected>${tStr("api.base_url_invalid_short")}</option>`;
        return renderModelSelectionOptions(
          resolvedProvider.id,
          option,
          "error-non-retryable",
          tInterp("api.base_url_invalid", { url: baseUrl }),
          stateId ?? undefined,
        );
      }

      return listProviderModelsOrDefaults(resolvedProvider.id, apiKey, baseUrl).then((result) => {
        if (!result.ok || !result.data) {
          const rawError = result.error ?? tStr("api.request_failed");
          const displayError = sanitizeApiErrorForDisplay(rawError);
          const option = `<option value="" disabled selected>${tInterp("api.models_load_failed", {
            provider: esc(resolvedProvider.displayName),
            error: esc(displayError),
          })}</option>`;
          return renderModelSelectionOptions(
            resolvedProvider.id,
            option,
            "error-retryable",
            tInterp("api.models_load_failed", {
              provider: resolvedProvider.displayName,
              error: displayError,
            }),
            stateId ?? undefined,
          );
        }

        if (result.data.models.length === 0) {
          const option = `<option value="" disabled selected>${tStr("api.no_models_found")}</option>`;
          return renderModelSelectionOptions(
            resolvedProvider.id,
            option,
            "empty",
            tStr("api.no_models_found"),
            stateId ?? undefined,
          );
        }

        const options = buildModelSelectOptions(result.data.models, selectedModel);
        return renderModelSelectionOptions(
          resolvedProvider.id,
          options,
          "success",
          tInterp("api.model_selection_loaded", {
            provider: resolvedProvider.displayName,
            count: String(result.data.models.length),
            source: result.data.source,
          }),
          stateId ?? undefined,
        );
      });
    })
    .post("/chat", ({ set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const reason = tStr("api.chat_route_retired");
      const envelope: ApiEnvelope = {
        route: PROVIDER_CHAT_ROUTE,
        state: "error-non-retryable",
        mismatches: [reason],
      };
      return renderStatusEnvelope(PROVIDER_CHAT_ROUTE, envelope, tStr("api.request_failed"), reason, [reason]);
    }, {
      body: providerCredentialBodySchema,
    })
    .get("/ollama/models", ({ query, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;
      const queryRecord = toRequestQuery(query);
      const baseUrl = parseOptionalTrimmedString(queryRecord?.baseUrl) ?? getBaseUrl("ollama") ?? OLLAMA_DEFAULT_BASE_URL;
      return listProviderModels("ollama", "", baseUrl).then((result) => {
        if (!result.ok) {
          return `<option value="" disabled selected>${tInterp("api.ollama_offline", { error: esc(result.error ?? "") })}</option>`;
        }
        const models = result.data?.models;
        if (!models || models.length === 0) {
          return `<option value="" disabled selected>${tStr("api.no_models_found")}</option>`;
        }
        return models.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
      });
    });
}
