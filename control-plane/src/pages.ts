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
import { Layout } from "./layout";
import { getPreference } from "./db";
import { getProviderCatalog, getProviderModelOptions } from "./ai-providers";
import { getAllProviderStatuses } from "./ai-keys";
import { getActiveLocale, isSupportedLocale, t, type Locale } from "./i18n";
import {
  ModelCard,
  AppBuildCard,
  AiProvidersCard,
  FlowEngineCard,
  PreferencesCard,
  UcpCard,
} from "./cards";

/**
 * Renders the main Dashboard view for the Vertu Control Plane.
 * Composes ModelCard, AppBuildCard, AiProvidersCard, FlowEngineCard, PreferencesCard, and UcpCard.
 */
export function Dashboard(theme: string): string {
  const storedTheme = theme || DEFAULT_THEME;
  const preferredLocale = getPreference("locale");
  const storedLocale: Locale = isSupportedLocale(preferredLocale) ? preferredLocale : getActiveLocale();
  const providers = getProviderCatalog();
  const statuses = getAllProviderStatuses(providers.map((p) => ({ provider: p.id, requiresKey: p.requiresKey })));
  const preferredModel = getPreference("defaultModel") ?? "";
  const providerModels = getProviderModelOptions();
  const defaultModelOptions = preferredModel && !providerModels.includes(preferredModel)
    ? [preferredModel, ...providerModels]
    : providerModels;
  const currentModel: string =
    preferredModel.trim().length > 0
      ? preferredModel
      : providerModels.length > 0
        ? (providerModels[0] ?? DEFAULT_CHAT_PULL_MODEL)
        : DEFAULT_CHAT_PULL_MODEL;
  const modelPullSources = MODEL_PULL_SOURCES
    .map((source) => resolveModelSourceConfig(source))
    .filter((source, index, list) => list.findIndex((candidate) => candidate.id === source.id) === index);
  const canonicalDefaultModelSource = resolveModelSourceConfig(DEFAULT_MODEL_SOURCE);
  const defaultModelSource: string = modelPullSources
    .find((source) => source.id === canonicalDefaultModelSource.id)
    ?.id
    ?? modelPullSources[0]?.id
    ?? canonicalDefaultModelSource.id;

  const content = `
<section class="mb-6 sm:mb-8" aria-labelledby="heading-main">
  <h1 id="heading-main" class="text-2xl sm:text-3xl font-bold brand-text brand-text-accent">${t("dashboard.title")}</h1>
  <p class="text-base-content/60 mt-1.5 text-sm">${t("dashboard.subtitle")}</p>
</section>

<div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 items-start">
  ${ModelCard({
    currentModel,
    modelPullPresets: MODEL_PULL_PRESETS,
    modelRefPlaceholder: MODEL_PULL_MODEL_REF_PLACEHOLDER,
    modelPullSources,
    defaultModelSource,
  })}
  ${AppBuildCard()}
</div>

${AiProvidersCard({ providers, statuses })}

${FlowEngineCard({
  defaultFlowMaxAttempts: FLOW_RUN_MAX_ATTEMPTS.toString(),
  defaultFlowTimeoutMs: FLOW_RUN_COMMAND_TIMEOUT_MS.toString(),
  defaultFlowRetryDelayMs: FLOW_RUN_RETRY_DELAY_MS.toString(),
})}

<div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 items-start">
  ${PreferencesCard({ storedTheme, storedLocale, defaultModelOptions })}
  ${UcpCard()}
</div>
`;

  return Layout("Dashboard", content, storedTheme);
}
