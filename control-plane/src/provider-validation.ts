import { getApiKey, getBaseUrl } from "./ai-keys";
import { PROVIDERS, testConnection } from "./ai-providers";
import { t as tStr } from "./i18n";
import { PROVIDER_VALIDATE_ROUTE } from "./runtime-constants";
import type {
  ProviderValidationEnvelope,
  ProviderValidationItem,
  ProviderValidationResult,
} from "../../contracts/flow-contracts";

/** Validate configured providers and build the deterministic capability envelope. */
export async function validateProviders(connectivity: boolean): Promise<ProviderValidationEnvelope> {
  const providerRows = await Promise.all(PROVIDERS.map(async (provider): Promise<ProviderValidationItem> => {
    const apiKey = (getApiKey(provider.id) ?? "").trim();
    const baseUrl = (getBaseUrl(provider.id) ?? provider.baseUrl).trim();
    const configured = provider.requiresKey ? apiKey.length > 0 : true;

    if (!configured) {
      return {
        provider: provider.id,
        configured,
        reachable: false,
        message: tStr("ai_providers.validation_config_missing"),
      };
    }

    if (!connectivity) {
      return {
        provider: provider.id,
        configured,
        reachable: true,
        message: tStr("ai_providers.validation_ok"),
      };
    }

    return testConnection(provider.id, apiKey, baseUrl).then((result) => ({
      provider: provider.id,
      configured,
      reachable: result.ok,
      message: result.ok ? tStr("ai_providers.validation_ok") : `${tStr("ai_providers.validation_connectivity_failed")}: ${result.error ?? tStr("api.connection_failed")}`,
    }));
  }));

  const configuredCount = providerRows.filter((row) => row.configured).length;
  const reachableCount = providerRows.filter((row) => row.reachable).length;
  const total = providerRows.length;
  const hasConfiguredUnreachable = providerRows.some((row) => row.configured && !row.reachable);
  const hasFailures = configuredCount > 0 && hasConfiguredUnreachable;

  const data: ProviderValidationResult = {
    total,
    configuredCount,
    reachableCount,
    providers: providerRows,
  };

  return {
    route: PROVIDER_VALIDATE_ROUTE,
    state: hasFailures ? "error-retryable" : configuredCount === 0 ? "empty" : "success",
    data,
    mismatches: hasFailures ? [tStr("api.provider_validation_has_failures")] : [],
  };
}
