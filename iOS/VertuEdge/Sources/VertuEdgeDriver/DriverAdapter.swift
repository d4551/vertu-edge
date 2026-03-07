import Foundation
import VertuEdgeCore

/// Protocol enabling dependency injection and mocking of flow driver implementations.
///
/// Conform a type to `DriverAdapter` to substitute any backend (XCTest, remote, mock)
/// while keeping call-sites decoupled from concrete driver types.
@MainActor
public protocol DriverAdapter {
    /// Executes a flow and returns a deterministic step report.
    ///
    /// - Parameters:
    ///   - flow: The flow to execute.
    ///   - correlationId: Unique identifier used to correlate telemetry across steps.
    /// - Returns: An `IosDriverReport` describing each step outcome.
    func execute(flow: FlowV1, correlationId: String) -> IosDriverReport
}

/// Default iOS driver adapter used by runtime UI and protocol surfaces.
///
/// This centralizes the concrete execution backend selection so callers bind to
/// a stable protocol instead of a platform-specific implementation.
@MainActor
public final class DefaultDriverAdapter: DriverAdapter {
    public init() {}

    public func execute(flow: FlowV1, correlationId: String) -> IosDriverReport {
        guard !flow.steps.isEmpty else {
            return IosDriverReport(
                completedSteps: 0,
                totalSteps: 0,
                state: .empty,
                message: "No flow steps were provided.",
                correlationId: correlationId,
                steps: []
            )
        }

        let reason = "iOS automation execution requires an external XCTest host and is unavailable inside the app bundle."
        return IosDriverReport(
            completedSteps: 0,
            totalSteps: flow.steps.count,
            state: .errorNonRetryable,
            message: reason,
            correlationId: correlationId,
            steps: [
                IosDriverStepReport(
                    commandIndex: 0,
                    commandType: "automationUnavailable",
                    state: .unsupported,
                    message: reason,
                    startedAt: ISO8601DateFormatter().string(from: Date()),
                    endedAt: ISO8601DateFormatter().string(from: Date()),
                    durationMs: 0,
                    error: IosDriverError(
                        code: "IOS_XCTEST_EXTERNAL_HOST_REQUIRED",
                        category: "dependency",
                        commandIndex: 0,
                        command: "automationUnavailable",
                        reason: reason,
                        retryable: false,
                        correlationId: correlationId
                    ),
                    artifact: nil
                )
            ]
        )
    }
}
