import Foundation

/// Configuration for driver execution, mirroring KMP DriverExecutionConfig.
///
/// KMP equivalent: `com.vertu.edge.core.driver.DriverExecutionConfig`
/// Wire format: JSON object with camelCase keys.
public struct DriverExecutionConfig: Sendable {
    /// Default timeout per step in milliseconds.
    public let defaultStepTimeoutMs: Int
    /// Maximum retry attempts per step.
    public let maxAttempts: Int
    /// Initial delay between retries in milliseconds (doubles on each retry, capped by maxBackoffMs).
    public let retryDelayMs: Int
    /// Maximum backoff cap between retries in milliseconds.
    public let maxBackoffMs: Int

    public init(
        defaultStepTimeoutMs: Int = 5000,
        maxAttempts: Int = 3,
        retryDelayMs: Int = 250,
        maxBackoffMs: Int = 2000
    ) {
        self.defaultStepTimeoutMs = defaultStepTimeoutMs
        self.maxAttempts = maxAttempts
        self.retryDelayMs = retryDelayMs
        self.maxBackoffMs = maxBackoffMs
    }
}
