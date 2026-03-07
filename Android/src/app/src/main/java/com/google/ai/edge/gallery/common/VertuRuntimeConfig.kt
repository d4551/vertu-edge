package com.google.ai.edge.gallery.common

import com.google.ai.edge.gallery.BuildConfig

/** Typed runtime configuration for Vertu branding and auth defaults. */
data class VertuOAuthConfig(
  val clientId: String,
  val redirectUri: String,
  val redirectScheme: String,
)

/** Maximum time (ms) to wait for an LLM model instance to initialize before timing out. */
const val MODEL_INIT_TIMEOUT_MS = 60_000L

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
  private const val DEFAULT_DEVICE_AI_REQUIRED_MODEL_REF =
    "huggingface.co/mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF"
  private const val DEFAULT_DEVICE_AI_REQUIRED_MODEL_REVISION =
    "5b34029a6b23a90aea2e377f1f9b273d1001638c"
  private const val DEFAULT_DEVICE_AI_REQUIRED_MODEL_FILE =
    "AutoGLM-Phone-9B-Multilingual.Q4_K_M.gguf"
  private const val DEFAULT_DEVICE_AI_REQUIRED_MODEL_SHA256 =
    "12b91074f0dfffee7e2732501ba8c5eecf3b1187dd08a91d71fb1e23437a073f"
  private const val DEFAULT_DEVICE_AI_MODEL_DIRECTORY = "vertu-device-ai/models"
  private const val DEFAULT_DEVICE_AI_PROTOCOL_TIMEOUT_MS = 900_000
  private const val DEFAULT_DEVICE_AI_REPORT_MAX_AGE_MINUTES = 240
  private const val DEFAULT_DEVICE_AI_DOWNLOAD_MAX_ATTEMPTS = 3
  private const val DEFAULT_TINY_GARDEN_ASSET_BASE_URL = "https://appassets.androidplatform.net"
  private const val DEFAULT_TINY_GARDEN_ASSET_PATH = "assets/tinygarden"

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

  val deviceAiRequiredModelRef: String =
    BuildConfig.VERTU_REQUIRED_MODEL_REF.trim()
      .ifBlank { DEFAULT_DEVICE_AI_REQUIRED_MODEL_REF }

  val deviceAiRequiredModelRevision: String =
    BuildConfig.VERTU_REQUIRED_MODEL_REVISION.trim()
      .ifBlank { DEFAULT_DEVICE_AI_REQUIRED_MODEL_REVISION }

  val deviceAiRequiredModelFileName: String =
    BuildConfig.VERTU_REQUIRED_MODEL_FILE.trim()
      .ifBlank { DEFAULT_DEVICE_AI_REQUIRED_MODEL_FILE }

  val deviceAiRequiredModelSha256: String =
    BuildConfig.VERTU_REQUIRED_MODEL_SHA256.trim()
      .ifBlank { DEFAULT_DEVICE_AI_REQUIRED_MODEL_SHA256 }

  val deviceAiManagedModelDirectory: String =
    BuildConfig.VERTU_DEVICE_AI_MODEL_DIRECTORY.trim()
      .trim('/')
      .ifBlank { DEFAULT_DEVICE_AI_MODEL_DIRECTORY }

  val deviceAiProtocolTimeoutMs: Int =
    BuildConfig.VERTU_DEVICE_AI_PROTOCOL_TIMEOUT_MS.takeIf { it > 0 }
      ?: DEFAULT_DEVICE_AI_PROTOCOL_TIMEOUT_MS

  val deviceAiReportMaxAgeMinutes: Int =
    BuildConfig.VERTU_DEVICE_AI_REPORT_MAX_AGE_MINUTES.takeIf { it > 0 }
      ?: DEFAULT_DEVICE_AI_REPORT_MAX_AGE_MINUTES

  val deviceAiDownloadMaxAttempts: Int =
    BuildConfig.VERTU_DEVICE_AI_DOWNLOAD_MAX_ATTEMPTS.takeIf { it > 0 }
      ?: DEFAULT_DEVICE_AI_DOWNLOAD_MAX_ATTEMPTS

  val tinyGardenAssetBaseUrl: String = normalizeBaseUrl(
    BuildConfig.VERTU_TINY_GARDEN_ASSET_BASE_URL,
    DEFAULT_TINY_GARDEN_ASSET_BASE_URL,
  )

  val tinyGardenAssetPath: String =
    BuildConfig.VERTU_TINY_GARDEN_ASSET_PATH.trim()
      .trim('/')
      .ifBlank { DEFAULT_TINY_GARDEN_ASSET_PATH }

  val deviceAiHfToken: String =
    BuildConfig.VERTU_DEVICE_AI_HF_TOKEN.trim()

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
