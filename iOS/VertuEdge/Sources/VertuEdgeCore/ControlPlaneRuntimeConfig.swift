import Foundation

/// Typed control-plane defaults and override support for iOS cloud/AI operations.
public struct ControlPlaneRuntimeConfig: Sendable {
  /// Base URL of the control-plane service.
  public let baseUrl: String

  /// Poll interval in milliseconds when watching pull jobs.
  public let pollIntervalMs: Int

  /// Poll attempt limit when watching pull jobs.
  public let pollAttempts: Int

  /// Default pull timeout in milliseconds when creating pull requests.
  public let defaultPullTimeoutMs: Int

  /// Default requested model source for provider/model operations.
  public let defaultModelSource: String

  /// Default request timeout for HTTP calls, in seconds.
  public let requestTimeoutSeconds: TimeInterval

  /// Prefix used when parsing control-plane model-selection state ids.
  /// Defaults to `model-state` so iOS, Android, and web share model-selection state by provider.
  /// Override with `VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX` when isolated state is required.
  public let modelStateIdPrefix: String

  /// Required model reference for device AI readiness checks.
  public let deviceAiRequiredModelRef: String

  /// Optional revision pin for required device AI model pulls.
  public let deviceAiRequiredModelRevision: String

  /// Required model file name used for device AI readiness checks.
  public let deviceAiRequiredModelFileName: String

  /// Optional expected SHA-256 for required device AI model artifact validation.
  public let deviceAiRequiredModelSha256: String

  /// Required capability flags for the pinned device AI model contract.
  public let deviceAiRequiredCapabilities: [DeviceAiCapability]

  /// Relative managed model directory used for local device AI staging.
  public let deviceAiManagedModelDirectory: String

  /// Relative managed report directory used for native device AI protocol reports.
  public let deviceAiManagedReportDirectory: String

  /// Protocol timeout budget in milliseconds.
  public let deviceAiProtocolTimeoutMs: Int

  /// Maximum age accepted for protocol report freshness checks.
  public let deviceAiReportMaxAgeMinutes: Int

  /// Maximum download attempts for Hugging Face model acquisition.
  public let deviceAiDownloadMaxAttempts: Int

  /// Optional Hugging Face token used for gated model downloads.
  public let deviceAiHfToken: String

  public init(
    baseUrl: String? = nil,
    pollIntervalMs: Int? = nil,
    pollAttempts: Int? = nil,
    defaultPullTimeoutMs: Int? = nil,
    defaultModelSource: String? = nil,
    requestTimeoutSeconds: TimeInterval? = nil,
    modelStateIdPrefix: String? = nil,
    deviceAiRequiredModelRef: String? = nil,
    deviceAiRequiredModelRevision: String? = nil,
    deviceAiRequiredModelFileName: String? = nil,
    deviceAiRequiredModelSha256: String? = nil,
    deviceAiRequiredCapabilities: [DeviceAiCapability]? = nil,
    deviceAiManagedModelDirectory: String? = nil,
    deviceAiManagedReportDirectory: String? = nil,
    deviceAiProtocolTimeoutMs: Int? = nil,
    deviceAiReportMaxAgeMinutes: Int? = nil,
    deviceAiDownloadMaxAttempts: Int? = nil,
    deviceAiHfToken: String? = nil
  ) {
    self.baseUrl =
      baseUrl
      ?? Self.resolveString(
        key: "VERTU_CONTROL_PLANE_BASE_URL",
        defaultValue: "http://127.0.0.1:3310"
      )
    self.pollIntervalMs =
      pollIntervalMs
      ?? Self.resolveInt(
        key: "VERTU_CONTROL_PLANE_POLL_INTERVAL_MS",
        defaultValue: 900,
        minValue: 50
      )
    self.pollAttempts =
      pollAttempts
      ?? Self.resolveInt(
        key: "VERTU_CONTROL_PLANE_POLL_ATTEMPTS",
        defaultValue: 180,
        minValue: 1
      )
    self.defaultPullTimeoutMs =
      defaultPullTimeoutMs
      ?? Self.resolveInt(
        key: "VERTU_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS",
        defaultValue: 120_000,
        minValue: 1
      )
    let defaultModelSourceValue =
      (defaultModelSource
      ?? Self.resolveString(
        key: "VERTU_CONTROL_PLANE_DEFAULT_MODEL_SOURCE"
      ))
      .trimmingCharacters(in: .whitespacesAndNewlines)
    self.defaultModelSource = defaultModelSourceValue
    self.requestTimeoutSeconds =
      requestTimeoutSeconds
      ?? TimeInterval(
        Self.resolveInt(
          key: "VERTU_CONTROL_PLANE_REQUEST_TIMEOUT_SECONDS",
          defaultValue: 20,
          minValue: 1
        )
      )
    self.modelStateIdPrefix =
      modelStateIdPrefix
      ?? Self.resolveString(
        key: "VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX",
        defaultValue: "model-state"
      )
    self.deviceAiRequiredModelRef =
      deviceAiRequiredModelRef
      ?? Self.resolveString(
        key: "VERTU_REQUIRED_MODEL_REF",
        defaultValue: GeneratedDeviceAiProfileDefaults.requiredModelRef
      )
    self.deviceAiRequiredModelRevision =
      (deviceAiRequiredModelRevision
      ?? Self.resolveString(
        key: "VERTU_REQUIRED_MODEL_REVISION",
        defaultValue: GeneratedDeviceAiProfileDefaults.revision
      ))
      .trimmingCharacters(in: .whitespacesAndNewlines)
    self.deviceAiRequiredModelFileName =
      deviceAiRequiredModelFileName
      ?? Self.resolveString(
        key: "VERTU_REQUIRED_MODEL_FILE",
        defaultValue: GeneratedDeviceAiProfileDefaults.requiredModelFile
      )
    self.deviceAiRequiredModelSha256 =
      (deviceAiRequiredModelSha256
      ?? Self.resolveString(
        key: "VERTU_REQUIRED_MODEL_SHA256",
        defaultValue: GeneratedDeviceAiProfileDefaults.requiredModelSha256
      ))
      .trimmingCharacters(in: .whitespacesAndNewlines)
    self.deviceAiRequiredCapabilities =
      deviceAiRequiredCapabilities
      ?? GeneratedDeviceAiProfileDefaults.requiredCapabilities
    self.deviceAiManagedModelDirectory =
      deviceAiManagedModelDirectory
      ?? Self.resolveString(
        key: "VERTU_DEVICE_AI_MODEL_DIRECTORY",
        defaultValue: "vertu-device-ai/models"
      )
    self.deviceAiManagedReportDirectory =
      deviceAiManagedReportDirectory
      ?? Self.resolveString(
        key: "VERTU_DEVICE_AI_REPORT_DIRECTORY",
        defaultValue: "vertu-device-ai/reports"
      )
    self.deviceAiProtocolTimeoutMs =
      deviceAiProtocolTimeoutMs
      ?? Self.resolveInt(
        key: "VERTU_DEVICE_AI_PROTOCOL_TIMEOUT_MS",
        defaultValue: 900_000,
        minValue: 1
      )
    self.deviceAiReportMaxAgeMinutes =
      deviceAiReportMaxAgeMinutes
      ?? Self.resolveInt(
        key: "VERTU_DEVICE_AI_REPORT_MAX_AGE_MINUTES",
        defaultValue: 240,
        minValue: 1
      )
    self.deviceAiDownloadMaxAttempts =
      deviceAiDownloadMaxAttempts
      ?? Self.resolveInt(
        key: "VERTU_DEVICE_AI_DOWNLOAD_MAX_ATTEMPTS",
        defaultValue: 3,
        minValue: 1
      )
    self.deviceAiHfToken =
      (deviceAiHfToken
      ?? Self.resolveString(
        key: "VERTU_DEVICE_AI_HF_TOKEN",
        defaultValue: Self.resolveString(
          key: "HF_TOKEN",
          defaultValue: Self.resolveString(key: "HUGGINGFACE_HUB_TOKEN")
        )
      ))
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// Canonical shared config resolved from environment and app defaults.
  public static let shared = ControlPlaneRuntimeConfig()

  private static func resolveString(key: String, defaultValue: String = "") -> String {
    let normalized = Self.readValue(forKey: key)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? defaultValue : normalized
  }

  private static func resolveInt(key: String, defaultValue: Int, minValue: Int, maxValue: Int? = nil) -> Int {
    let raw = Self.readValue(forKey: key).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let parsed = Int(raw), parsed >= minValue else {
      return defaultValue
    }
    if let max = maxValue, parsed > max {
      return max
    }
    return parsed
  }

  private static func readValue(forKey key: String) -> String {
    if let envValue = ProcessInfo.processInfo.environment[key], !envValue.isEmpty {
      return envValue
    }
    if let preference = UserDefaults.standard.string(forKey: key), !preference.isEmpty {
      return preference
    }
    return ""
  }
}
