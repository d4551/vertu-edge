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

  public init(
    baseUrl: String? = nil,
    pollIntervalMs: Int? = nil,
    pollAttempts: Int? = nil,
    defaultPullTimeoutMs: Int? = nil,
    defaultModelSource: String? = nil,
    requestTimeoutSeconds: TimeInterval? = nil,
    modelStateIdPrefix: String? = nil
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
