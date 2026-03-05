package com.google.ai.edge.gallery.common

import com.google.ai.edge.gallery.BuildConfig

/** Typed runtime configuration for Vertu branding and auth defaults. */
data class VertuOAuthConfig(
  val clientId: String,
  val redirectUri: String,
  val redirectScheme: String,
)

/** Runtime access point for non-hardcoded app configuration values. */
object VertuRuntimeConfig {
  private const val DEFAULT_MODEL_SOURCE_BASE_URL = "https://huggingface.co"
  private const val DEFAULT_MODEL_ALLOWLIST_BASE_URL =
    "https://raw.githubusercontent.com/google-ai-edge/gallery/refs/heads/main/model_allowlists"
  private const val DEFAULT_CONTROL_PLANE_BASE_URL = "http://127.0.0.1:3310"
  private const val DEFAULT_CONTROL_PLANE_CONNECT_TIMEOUT_MS = 15_000
  private const val DEFAULT_CONTROL_PLANE_READ_TIMEOUT_MS = 30_000
  private const val DEFAULT_CONTROL_PLANE_POLL_INTERVAL_MS = 900
  private const val DEFAULT_CONTROL_PLANE_POLL_ATTEMPTS = 180
  private const val DEFAULT_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS = 120_000
  private const val DEFAULT_CONTROL_PLANE_MODEL_STATE_ID_PREFIX = "model-state"

  private fun normalizeBaseUrl(raw: String, fallback: String): String {
    return raw.trim().ifBlank { fallback }.trimEnd('/')
  }

  /** Source base URL for OAuth and model-related web endpoints (overrideable). */
  val modelSourceBaseUrl: String = normalizeBaseUrl(
    BuildConfig.VERTU_HF_BASE_URL,
    DEFAULT_MODEL_SOURCE_BASE_URL,
  )

  val modelDownloadBaseUrl: String = modelSourceBaseUrl

  val modelAllowlistBaseUrl: String = normalizeBaseUrl(
    BuildConfig.VERTU_MODEL_ALLOWLIST_BASE_URL,
    DEFAULT_MODEL_ALLOWLIST_BASE_URL,
  )

  val controlPlaneBaseUrl: String = normalizeBaseUrl(
    BuildConfig.VERTU_CONTROL_PLANE_BASE_URL,
    DEFAULT_CONTROL_PLANE_BASE_URL,
  )

  val controlPlaneConnectTimeoutMs: Int =
    BuildConfig.VERTU_CONTROL_PLANE_CONNECT_TIMEOUT_MS.takeIf { it > 0 }
      ?: DEFAULT_CONTROL_PLANE_CONNECT_TIMEOUT_MS

  val controlPlaneReadTimeoutMs: Int =
    BuildConfig.VERTU_CONTROL_PLANE_READ_TIMEOUT_MS.takeIf { it > 0 }
      ?: DEFAULT_CONTROL_PLANE_READ_TIMEOUT_MS

  val controlPlanePollIntervalMs: Int =
    BuildConfig.VERTU_CONTROL_PLANE_POLL_INTERVAL_MS.takeIf { it > 0 }
      ?: DEFAULT_CONTROL_PLANE_POLL_INTERVAL_MS

  val controlPlanePollAttempts: Int =
    BuildConfig.VERTU_CONTROL_PLANE_POLL_ATTEMPTS.takeIf { it > 0 }
      ?: DEFAULT_CONTROL_PLANE_POLL_ATTEMPTS

  val controlPlaneDefaultPullTimeoutMs: Int =
    BuildConfig.VERTU_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS.takeIf { it > 0 }
      ?: DEFAULT_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS

  /** Optional registry override; blank means use the control-plane source registry default. */
  val controlPlaneDefaultModelSource: String =
    BuildConfig.VERTU_CONTROL_PLANE_DEFAULT_MODEL_SOURCE
      .trim()

  val controlPlaneModelStateIdPrefix: String =
    BuildConfig.VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX.trim()
      .trimEnd('-')
      .ifBlank { DEFAULT_CONTROL_PLANE_MODEL_STATE_ID_PREFIX }

  val appName: String = BuildConfig.VERTU_APP_NAME.ifBlank { "Vertu Edge" }

  val brandTagline: String =
    BuildConfig.VERTU_BRAND_TAGLINE.ifBlank { "Concierge-grade mobile automation" }

  val applicationId: String = BuildConfig.VERTU_APPLICATION_ID.ifBlank { "com.vertu.edge" }

  val deepLinkScheme: String =
    BuildConfig.VERTU_DEEP_LINK_SCHEME.ifBlank { "com.vertu.edge" }

  /** URL to the model community hub displayed in the app intro. */
  val modelCommunityUrl: String = "${modelSourceBaseUrl}/litert-community"

  val oauth: VertuOAuthConfig =
    VertuOAuthConfig(
      clientId = BuildConfig.VERTU_HF_CLIENT_ID,
      redirectUri = BuildConfig.VERTU_HF_REDIRECT_URI,
      redirectScheme = BuildConfig.VERTU_HF_REDIRECT_SCHEME,
    )
}
