import Testing
@testable import VertuEdgeCore
import Foundation

@Suite("FlowSafetyPolicy")
struct FlowSafetyPolicyTests {

    // MARK: - Risk classification

    @Test func lowRiskCommandsClassifiedCorrectly() {
        let lowRiskCommands: [FlowCommand] = [
            .launchApp,
            .screenshot,
            .clipboardRead,
            .hideKeyboard,
            .waitForAnimation(timeoutMs: 600)
        ]
        for command in lowRiskCommands {
            #expect(FlowSafetyPolicy.classifyRisk(command) == .low, "Expected .low for \(command)")
        }
    }

    @Test func mediumRiskCommandsClassifiedCorrectly() {
        let target = CommandTarget(text: "Button")
        let mediumRiskCommands: [FlowCommand] = [
            .tapOn(target: target),
            .scroll(direction: .down, steps: 32),
            .swipe(direction: .left, distanceFraction: 0.5),
            .assertVisible(target: target),
            .assertNotVisible(target: target),
            .assertText(target: target, value: "Hello"),
            .selectOption(target: target, option: "Item"),
            .windowFocus(target: WindowTarget(appId: "com.example"))
        ]
        for command in mediumRiskCommands {
            #expect(FlowSafetyPolicy.classifyRisk(command) == .medium, "Expected .medium for \(command)")
        }
    }

    @Test func highRiskCommandsClassifiedCorrectly() {
        let highRiskCommands: [FlowCommand] = [
            .inputText(value: "secret"),
            .clipboardWrite(value: "payload")
        ]
        for command in highRiskCommands {
            #expect(FlowSafetyPolicy.classifyRisk(command) == .high, "Expected .high for \(command)")
        }
    }

    // MARK: - Flow evaluation

    @Test func allLowRiskFlowReturnsAllowed() {
        let flow = FlowV1(appId: "com.test", steps: [.launchApp, .screenshot, .hideKeyboard])
        let verdict = FlowSafetyPolicy.evaluate(flow)
        if case .allowed = verdict {
            // pass
        } else {
            Issue.record("Expected .allowed for all-low-risk flow, got \(verdict)")
        }
    }

    @Test func mediumRiskFlowRequiresConfirmation() {
        let flow = FlowV1(
            appId: "com.test",
            steps: [.launchApp, .tapOn(target: CommandTarget(text: "OK"))]
        )
        let verdict = FlowSafetyPolicy.evaluate(flow)
        if case .requiresConfirmation(let reason) = verdict {
            #expect(!reason.isEmpty)
            #expect(reason.contains("tap") || reason.contains("scroll") || reason.contains("select") || reason.contains("UI interaction"))
        } else {
            Issue.record("Expected .requiresConfirmation for medium-risk flow, got \(verdict)")
        }
    }

    @Test func highRiskFlowRequiresConfirmation() {
        let flow = FlowV1(
            appId: "com.test",
            steps: [.launchApp, .inputText(value: "password123")]
        )
        let verdict = FlowSafetyPolicy.evaluate(flow)
        if case .requiresConfirmation(let reason) = verdict {
            #expect(!reason.isEmpty)
            #expect(reason.contains("high-risk") || reason.contains("text input") || reason.contains("clipboard"))
        } else {
            Issue.record("Expected .requiresConfirmation for high-risk flow, got \(verdict)")
        }
    }

    @Test func highRiskDominatesOverMediumInMixedFlow() {
        // A flow containing both medium and high risk steps should produce the high-risk verdict.
        let flow = FlowV1(
            appId: "com.test",
            steps: [
                .launchApp,
                .tapOn(target: CommandTarget(text: "Email")),
                .inputText(value: "user@test.com"),
                .screenshot
            ]
        )
        let verdict = FlowSafetyPolicy.evaluate(flow)
        if case .requiresConfirmation(let reason) = verdict {
            // high-risk reason must mention data entry, not just UI interaction
            #expect(reason.contains("high-risk") || reason.contains("text input") || reason.contains("clipboard"))
        } else {
            Issue.record("Expected .requiresConfirmation(high reason) for mixed-risk flow, got \(verdict)")
        }
    }

    @Test func emptyFlowReturnsAllowed() {
        let flow = FlowV1(appId: "com.test", steps: [])
        let verdict = FlowSafetyPolicy.evaluate(flow)
        if case .allowed = verdict {
            // pass
        } else {
            Issue.record("Expected .allowed for empty flow, got \(verdict)")
        }
    }

    @Test func clipboardWriteIsHighRisk() {
        let flow = FlowV1(appId: "com.test", steps: [.clipboardWrite(value: "data")])
        let verdict = FlowSafetyPolicy.evaluate(flow)
        if case .requiresConfirmation = verdict {
            // pass — clipboard write is high-risk
        } else {
            Issue.record("Expected .requiresConfirmation for clipboardWrite flow, got \(verdict)")
        }
    }
}
