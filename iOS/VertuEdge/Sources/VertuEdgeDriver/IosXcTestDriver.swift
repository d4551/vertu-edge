import Foundation
import VertuEdgeCore

/// Step execution state for iOS flow telemetry.
public enum IosDriverStepState: String, Equatable, Sendable {
    case success
    case error
    case unsupported
}

/// Typed iOS driver error envelope aligned with shared flow semantics.
public struct IosDriverError: Error, Equatable, Sendable {
    public let code: String
    public let category: String
    public let commandIndex: Int
    public let command: String
    public let reason: String
    public let retryable: Bool
    public let correlationId: String

    public init(
        code: String,
        category: String,
        commandIndex: Int,
        command: String,
        reason: String,
        retryable: Bool,
        correlationId: String
    ) {
        self.code = code
        self.category = category
        self.commandIndex = commandIndex
        self.command = command
        self.reason = reason
        self.retryable = retryable
        self.correlationId = correlationId
    }
}

/// Artifact metadata produced by iOS flow commands.
public struct IosDriverArtifact: Equatable, Sendable {
    public let artifactPath: String
    public let contentType: String
    public let createdAt: String
    public let correlationId: String
    /// Path to the UI hierarchy dump captured on step failure, if available.
    public let hierarchyPath: String?

    public init(
        artifactPath: String,
        contentType: String,
        createdAt: String,
        correlationId: String,
        hierarchyPath: String? = nil
    ) {
        self.artifactPath = artifactPath
        self.contentType = contentType
        self.createdAt = createdAt
        self.correlationId = correlationId
        self.hierarchyPath = hierarchyPath
    }
}

/// Per-step execution report for the iOS driver.
public struct IosDriverStepReport: Equatable, Sendable {
    public let commandIndex: Int
    public let commandType: String
    public let state: IosDriverStepState
    public let message: String
    public let startedAt: String
    public let endedAt: String
    public let durationMs: Int
    public let error: IosDriverError?
    public let artifact: IosDriverArtifact?

    public init(
        commandIndex: Int,
        commandType: String,
        state: IosDriverStepState,
        message: String,
        startedAt: String,
        endedAt: String,
        durationMs: Int,
        error: IosDriverError?,
        artifact: IosDriverArtifact?
    ) {
        self.commandIndex = commandIndex
        self.commandType = commandType
        self.state = state
        self.message = message
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.durationMs = durationMs
        self.error = error
        self.artifact = artifact
    }
}

/// Top-level iOS flow execution report.
public struct IosDriverReport: Equatable, Sendable {
    public let completedSteps: Int
    public let totalSteps: Int
    public let state: FlowExecutionState
    public let message: String
    public let correlationId: String
    public let steps: [IosDriverStepReport]

    public init(
        completedSteps: Int,
        totalSteps: Int,
        state: FlowExecutionState,
        message: String,
        correlationId: String,
        steps: [IosDriverStepReport]
    ) {
        self.completedSteps = completedSteps
        self.totalSteps = totalSteps
        self.state = state
        self.message = message
        self.correlationId = correlationId
        self.steps = steps
    }
}
