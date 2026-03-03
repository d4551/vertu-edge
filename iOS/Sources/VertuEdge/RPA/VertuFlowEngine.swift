import Foundation
import UIKit

actor VertuFlowEngine {
    private let parser = FlowParser()

    func execute(yaml: String) async -> FlowResult {
        do {
            let flow = try parser.parse(yaml)
            var logs: [String] = ["Starting flow: \(flow.name ?? flow.appId)"]
            for action in flow.actions {
                let log = await executeAction(action)
                logs.append(log)
            }
            return .success(logs: logs)
        } catch {
            return .error(message: "Parse error: \(error.localizedDescription)")
        }
    }

    private func executeAction(_ action: FlowAction) async -> String {
        switch action {
        case .launchApp(let appId):
            await MainActor.run {
                if let url = URL(string: appId) {
                    UIApplication.shared.open(url)
                }
            }
            return "Launch app: \(appId)"
        case .tapOn(let selector, _):
            return "Tap on: \(selector)"
        case .inputText(let text):
            return "Input text: \(text)"
        case .assertVisible(let selector):
            return "Assert visible: \(selector)"
        case .assertNotVisible(let selector):
            return "Assert not visible: \(selector)"
        case .scrollUntilVisible(let selector, _):
            return "Scroll until visible: \(selector)"
        case .openLink(let url):
            await MainActor.run {
                if let u = URL(string: url) {
                    UIApplication.shared.open(u)
                }
            }
            return "Open link: \(url)"
        case .wait(let ms):
            try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
            return "Wait: \(ms)ms"
        case .pressKey(let key):
            return "Press key: \(key)"
        case .runAiPrompt(let prompt, _):
            return "Run AI prompt: \(prompt)"
        case .webAction(let action, let selector, _):
            return "Web action: \(action) on \(selector ?? "page")"
        case .takeScreenshot(let label):
            return "Screenshot: \(label ?? "unnamed")"
        case .clearState(let appId):
            return "Clear state: \(appId)"
        }
    }
}

enum FlowResult {
    case success(logs: [String])
    case error(message: String)
}
