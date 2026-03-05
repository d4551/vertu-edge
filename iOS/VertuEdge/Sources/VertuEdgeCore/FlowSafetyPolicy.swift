import Foundation

/// Risk level for flow commands, aligned with Android VertuFlowSafetyPolicy.
public enum FlowCommandRisk: String, Sendable {
    case low = "low"
    case medium = "medium"
    case high = "high"
}

/// Evaluation result from the safety policy.
public enum SafetyVerdict: Sendable {
    /// Flow is safe to execute without confirmation.
    case allowed
    /// Flow requires user confirmation before execution.
    case requiresConfirmation(reason: String)
    /// Flow is blocked and cannot execute.
    case blocked(reason: String)
}

/// Safety policy for evaluating flow commands before execution.
/// Mirrors the Android VertuFlowSafetyPolicy risk classification.
public struct FlowSafetyPolicy: Sendable {

    /// Classify the risk level of a single command.
    public static func classifyRisk(_ command: FlowCommand) -> FlowCommandRisk {
        switch command {
        case .launchApp, .screenshot, .clipboardRead, .hideKeyboard, .waitForAnimation:
            return .low
        case .tapOn, .scroll, .swipe, .assertVisible, .assertNotVisible, .assertText, .selectOption, .windowFocus:
            return .medium
        case .inputText, .clipboardWrite:
            return .high
        }
    }

    /// Evaluate an entire flow and return the safety verdict.
    public static func evaluate(_ flow: FlowV1) -> SafetyVerdict {
        let maxRisk = flow.steps
            .map { classifyRisk($0) }
            .max(by: { riskOrdinal($0) < riskOrdinal($1) }) ?? .low

        switch maxRisk {
        case .low:
            return .allowed
        case .medium:
            return .requiresConfirmation(
                reason: "This flow includes UI interaction commands (tap, scroll, select) that modify app state."
            )
        case .high:
            return .requiresConfirmation(
                reason: "This flow includes high-risk commands (text input, clipboard write) that can enter data on your behalf."
            )
        }
    }

    private static func riskOrdinal(_ risk: FlowCommandRisk) -> Int {
        switch risk {
        case .low: return 0
        case .medium: return 1
        case .high: return 2
        }
    }
}
