import Testing
@testable import VertuEdgeCore
import Foundation

@Suite("FlowV1 Codable")
struct FlowV1CodableTests {

    // MARK: - FlowCommand round-trips

    @Test func encodesDecodesLaunchApp() throws {
        let cmd = FlowCommand.launchApp
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesTapOn() throws {
        let cmd = FlowCommand.tapOn(target: CommandTarget(text: "Login"))
        let data = try JSONEncoder().encode(cmd)
        let json = String(data: data, encoding: .utf8)!
        #expect(json.contains("\"type\":\"tapOn\""))
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesInputText() throws {
        let cmd = FlowCommand.inputText(value: "hello world")
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesAssertVisible() throws {
        let cmd = FlowCommand.assertVisible(target: CommandTarget(resourceId: "loginBtn"))
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesAssertNotVisible() throws {
        let cmd = FlowCommand.assertNotVisible(target: CommandTarget(text: "Error Banner"))
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesAssertText() throws {
        let cmd = FlowCommand.assertText(target: CommandTarget(text: "Title"), value: "Welcome")
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesSelectOption() throws {
        let cmd = FlowCommand.selectOption(target: CommandTarget(text: "Language"), option: "English")
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesScroll() throws {
        let cmd = FlowCommand.scroll(direction: .down, steps: 16)
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesSwipe() throws {
        let cmd = FlowCommand.swipe(direction: .left, distanceFraction: 0.5)
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesScreenshot() throws {
        let cmd = FlowCommand.screenshot
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesClipboardRead() throws {
        let cmd = FlowCommand.clipboardRead
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesClipboardWrite() throws {
        let cmd = FlowCommand.clipboardWrite(value: "copied text")
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesWindowFocus() throws {
        let cmd = FlowCommand.windowFocus(target: WindowTarget(appId: "com.example", title: "Main"))
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesHideKeyboard() throws {
        let cmd = FlowCommand.hideKeyboard
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    @Test func encodesDecodesWaitForAnimation() throws {
        let cmd = FlowCommand.waitForAnimation(timeoutMs: 1200)
        let data = try JSONEncoder().encode(cmd)
        let decoded = try JSONDecoder().decode(FlowCommand.self, from: data)
        #expect(decoded == cmd)
    }

    // MARK: - Default value decoding

    @Test func decodesDefaultScrollSteps() throws {
        // scroll without steps should default to 32
        let json = #"{"type":"scroll","direction":"UP"}"#
        let cmd = try JSONDecoder().decode(FlowCommand.self, from: json.data(using: .utf8)!)
        if case .scroll(let dir, let steps) = cmd {
            #expect(dir == .up)
            #expect(steps == 32)
        } else {
            Issue.record("Expected scroll command")
        }
    }

    @Test func decodesWaitForAnimationDefault() throws {
        // waitForAnimation without timeoutMs should default to 600
        let json = #"{"type":"waitForAnimation"}"#
        let cmd = try JSONDecoder().decode(FlowCommand.self, from: json.data(using: .utf8)!)
        if case .waitForAnimation(let ms) = cmd {
            #expect(ms == 600)
        } else {
            Issue.record("Expected waitForAnimation")
        }
    }

    @Test func decodesDefaultSwipeDistanceFraction() throws {
        // swipe without distanceFraction should default to 0.7
        let json = #"{"type":"swipe","direction":"LEFT"}"#
        let cmd = try JSONDecoder().decode(FlowCommand.self, from: json.data(using: .utf8)!)
        if case .swipe(let dir, let fraction) = cmd {
            #expect(dir == .left)
            #expect(fraction == 0.7)
        } else {
            Issue.record("Expected swipe command")
        }
    }

    // MARK: - FlowExecutionState wire format

    @Test func flowExecutionStateCodable() throws {
        let state = FlowExecutionState.errorRetryable
        let data = try JSONEncoder().encode(state)
        let str = String(data: data, encoding: .utf8)!
        // Must encode as kebab-case for control-plane wire compatibility
        #expect(str.contains("error-retryable"))
        let decoded = try JSONDecoder().decode(FlowExecutionState.self, from: data)
        #expect(decoded == state)
    }

    @Test func flowExecutionStateErrorNonRetryableWireFormat() throws {
        let state = FlowExecutionState.errorNonRetryable
        let data = try JSONEncoder().encode(state)
        let str = String(data: data, encoding: .utf8)!
        #expect(str.contains("error-non-retryable"))
        let decoded = try JSONDecoder().decode(FlowExecutionState.self, from: data)
        #expect(decoded == state)
    }

    @Test func allFlowExecutionStatesRoundTrip() throws {
        let states: [FlowExecutionState] = [
            .idle, .loading, .success, .empty,
            .errorRetryable, .errorNonRetryable, .unauthorized
        ]
        for state in states {
            let data = try JSONEncoder().encode(state)
            let decoded = try JSONDecoder().decode(FlowExecutionState.self, from: data)
            #expect(decoded == state, "Round-trip failed for state: \(state)")
        }
    }

    // MARK: - FlowV1 round-trip

    @Test func flowV1RoundTrip() throws {
        let flow = FlowV1(
            appId: "com.example.app",
            steps: [
                .launchApp,
                .tapOn(target: CommandTarget(text: "Login")),
                .inputText(value: "user@test.com"),
                .assertVisible(target: CommandTarget(text: "Welcome")),
                .scroll(direction: .down, steps: 32),
                .screenshot
            ]
        )
        let data = try JSONEncoder().encode(flow)
        let decoded = try JSONDecoder().decode(FlowV1.self, from: data)
        #expect(decoded == flow)
        #expect(decoded.appId == "com.example.app")
        #expect(decoded.steps.count == 6)
    }
}
