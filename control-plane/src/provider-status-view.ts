import type { ProviderStatus } from "./ai-keys";
import { t } from "./i18n";

/**
 * Resolve the localized label for a provider credential status badge.
 */
export function providerStatusLabel(status: ProviderStatus): string {
  switch (status.credentialState) {
    case "configured":
      return t("ai_providers.configured");
    case "secure-storage-unavailable":
      return t("ai_providers.secure_storage_required");
    case "stored-credential-invalid":
      return t("ai_providers.credential_reentry_required");
    case "not-configured":
    default:
      return t("ai_providers.not_configured");
  }
}

/**
 * Resolve the DaisyUI badge class for a provider credential status badge.
 */
export function providerStatusBadgeClass(status: ProviderStatus): string {
  switch (status.credentialState) {
    case "configured":
      return "badge-success";
    case "secure-storage-unavailable":
      return "badge-warning";
    case "stored-credential-invalid":
      return "badge-error";
    case "not-configured":
    default:
      return "badge-ghost";
  }
}

/**
 * Resolve the optional helper hint shown alongside provider configuration.
 */
export function providerStatusHint(status: ProviderStatus): string | null {
  switch (status.credentialState) {
    case "secure-storage-unavailable":
      return t("ai_providers.secure_storage_hint");
    case "stored-credential-invalid":
      return t("ai_providers.credential_reentry_hint");
    default:
      return null;
  }
}
