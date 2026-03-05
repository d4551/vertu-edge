import Testing
@testable import VertuEdgeCore
import Foundation

struct FlowYamlParserTests {
    @Test
    func parsesBasicFlow() throws {
        let yaml = """
        appId: com.vertu.edge.ios
        ---
        - launchApp
        - tapOn: \"Settings\"
        """

        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.appId == "com.vertu.edge.ios")
        #expect(flow.steps.count == 2)
    }

    @Test
    func parsesCanonicalParityCommands() throws {
        let yaml = """
        appId: com.vertu.edge.ios
        ---
        - launchApp
        - tapOn: "Login"
        - inputText: "user@example.com"
        - assertVisible: "Welcome"
        - assertNotVisible: "Error"
        - assertText: "Welcome::Welcome"
        - selectOption: "Language::English"
        - scroll: "down"
        - swipe: "left"
        - screenshot
        - hideKeyboard
        - waitForAnimation: 500
        """

        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.steps.count == 12)
        if case .assertText(_, let value) = flow.steps[5] {
            #expect(value == "Welcome")
        } else {
            Issue.record("Expected assertText at step 6")
        }
        if case .selectOption(_, let option) = flow.steps[6] {
            #expect(option == "English")
        } else {
            Issue.record("Expected selectOption at step 7")
        }
        if case .screenshot = flow.steps[9] {
            #expect(Bool(true))
        } else {
            Issue.record("Expected screenshot at step 10")
        }
    }

    // MARK: - Edge cases

    @Test func parsesClipboardWrite() throws {
        let yaml = """
        appId: com.test.app
        ---
        - clipboardWrite: "hello world"
        """
        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.steps.count == 1)
        if case .clipboardWrite(let value) = flow.steps[0] {
            #expect(value == "hello world")
        } else {
            Issue.record("Expected clipboardWrite")
        }
    }

    @Test func parsesWindowFocus() throws {
        let yaml = """
        appId: com.test.app
        ---
        - windowFocus: "appId=com.example|title=Main"
        """
        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.steps.count == 1)
        if case .windowFocus(let target) = flow.steps[0] {
            #expect(target.appId == "com.example")
            #expect(target.title == "Main")
        } else {
            Issue.record("Expected windowFocus")
        }
    }

    @Test func parsesWaitForAnimation() throws {
        let yaml = """
        appId: com.test.app
        ---
        - waitForAnimation: 1200
        """
        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.steps.count == 1)
        if case .waitForAnimation(let ms) = flow.steps[0] {
            #expect(ms == 1200)
        } else {
            Issue.record("Expected waitForAnimation")
        }
    }

    @Test func parsesClipboardRead() throws {
        let yaml = """
        appId: com.test.app
        ---
        - clipboardRead
        """
        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.steps.count == 1)
        if case .clipboardRead = flow.steps[0] {
            #expect(Bool(true))
        } else {
            Issue.record("Expected clipboardRead")
        }
    }

    @Test func parsesEmptyInput() throws {
        // An empty string or a string with no appId must throw.
        // Document and verify the existing error behaviour.
        let empty = ""
        #expect(throws: (any Error).self) {
            try FlowYamlParser.parse(empty)
        }
    }

    @Test func parsesMissingAppIdThrows() throws {
        // Steps-only YAML with no appId: header must throw.
        let yaml = """
        ---
        - launchApp
        """
        #expect(throws: (any Error).self) {
            try FlowYamlParser.parse(yaml)
        }
    }

    @Test func skipsCommentLines() throws {
        let yaml = """
        # This is a comment
        appId: com.test.app
        ---
        # Another comment
        - launchApp
        """
        let flow = try FlowYamlParser.parse(yaml)
        #expect(flow.appId == "com.test.app")
        #expect(flow.steps.count == 1)
    }

    // MARK: - toYaml serializer

    @Test func toYamlRoundTripsSimpleFlow() throws {
        let original = FlowV1(
            appId: "com.example.app",
            steps: [
                .launchApp,
                .tapOn(target: CommandTarget(text: "Login")),
                .inputText(value: "hello"),
                .assertVisible(target: CommandTarget(text: "Welcome"))
            ]
        )
        let yamlString = FlowYamlParser.toYaml(original)
        let reparsed = try FlowYamlParser.parse(yamlString)
        #expect(reparsed.appId == original.appId)
        #expect(reparsed.steps.count == original.steps.count)
        #expect(reparsed == original)
    }

    @Test func toYamlProducesExpectedHeader() {
        let flow = FlowV1(appId: "com.vertu.edge.ios", steps: [])
        let yaml = FlowYamlParser.toYaml(flow)
        #expect(yaml.hasPrefix("appId: com.vertu.edge.ios"))
        #expect(yaml.contains("---"))
    }

    @Test func toYamlRoundTripsAllCommands() throws {
        let original = FlowV1(
            appId: "com.test.roundtrip",
            steps: [
                .launchApp,
                .tapOn(target: CommandTarget(text: "OK")),
                .inputText(value: "text"),
                .assertVisible(target: CommandTarget(text: "Label")),
                .assertNotVisible(target: CommandTarget(text: "Error")),
                .assertText(target: CommandTarget(text: "Heading"), value: "Title"),
                .selectOption(target: CommandTarget(text: "Picker"), option: "Item"),
                .scroll(direction: .up, steps: 32),
                .swipe(direction: .right, distanceFraction: 0.7),
                .screenshot,
                .clipboardRead,
                .clipboardWrite(value: "paste me"),
                .windowFocus(target: WindowTarget(title: "MainWindow")),
                .hideKeyboard,
                .waitForAnimation(timeoutMs: 600)
            ]
        )
        let yaml = FlowYamlParser.toYaml(original)
        let reparsed = try FlowYamlParser.parse(yaml)
        #expect(reparsed.appId == original.appId)
        #expect(reparsed.steps.count == original.steps.count)
    }

    @Test func toYamlEscapesSpecialCharacters() throws {
        let flow = FlowV1(
            appId: "com.test.app",
            steps: [.inputText(value: "say \"hello\"")]
        )
        let yaml = FlowYamlParser.toYaml(flow)
        // The escaped quote must appear in the serialized output
        #expect(yaml.contains("\\\""))
        // Round-trip restores the original unescaped value
        let reparsed = try FlowYamlParser.parse(yaml)
        if case .inputText(let value) = reparsed.steps[0] {
            #expect(value == "say \"hello\"")
        } else {
            Issue.record("Expected inputText after round-trip")
        }
    }

    @Test func toYamlResourceIdTarget() throws {
        let flow = FlowV1(
            appId: "com.test.app",
            steps: [.tapOn(target: CommandTarget(resourceId: "btn_login"))]
        )
        let yaml = FlowYamlParser.toYaml(flow)
        #expect(yaml.contains("id=btn_login"))
        let reparsed = try FlowYamlParser.parse(yaml)
        if case .tapOn(let target) = reparsed.steps[0] {
            #expect(target.resourceId == "btn_login")
        } else {
            Issue.record("Expected tapOn with resourceId after round-trip")
        }
    }
}
