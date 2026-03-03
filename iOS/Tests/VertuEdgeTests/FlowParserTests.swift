import XCTest
@testable import VertuEdge

final class FlowParserTests: XCTestCase {
    let parser = FlowParser()

    func testParsesBasicFlow() throws {
        let yaml = """
        appId: com.example.app
        name: Test Flow
        ---
        - launchApp: com.example.app
        - tapOn: "Create"
        - inputText: "Hello"
        - assertVisible: "Hello"
        """
        let flow = try parser.parse(yaml)
        XCTAssertEqual(flow.appId, "com.example.app")
        XCTAssertEqual(flow.name, "Test Flow")
        XCTAssertEqual(flow.actions.count, 4)
    }

    func testMissingAppIdThrows() {
        let yaml = "name: My Flow\n---\n- tapOn: Button"
        XCTAssertThrowsError(try parser.parse(yaml))
    }

    func testParsesAllActionTypes() throws {
        let yaml = """
        appId: com.example
        ---
        - launchApp: com.example
        - tapOn: "Button"
        - inputText: "test"
        - assertVisible: "label"
        - assertNotVisible: "gone"
        - scrollUntilVisible: "item"
        - openLink: "https://vertu.com"
        - wait: 2000
        - pressKey: "Enter"
        - takeScreenshot: "step1"
        - clearState: com.example
        """
        let flow = try parser.parse(yaml)
        XCTAssertEqual(flow.actions.count, 11)
    }
}
