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

// MARK: - IosXcTestDriver conformance

extension IosXcTestDriver: DriverAdapter {
    // `IosXcTestDriver.execute(flow:correlationId:screenshotDirectory:)` satisfies the
    // protocol requirement because `screenshotDirectory` carries a default value of nil,
    // so callers using the protocol witness only supply the two required labels.
    //
    // Swift requires the protocol witness to match the label set exactly when there are
    // extra defaulted parameters, so we provide a thin forwarding overload here.
    public func execute(flow: FlowV1, correlationId: String) -> IosDriverReport {
        execute(flow: flow, correlationId: correlationId, screenshotDirectory: nil)
    }
}
