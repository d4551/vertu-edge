import Foundation

struct FlowParser {
    func parse(_ yaml: String) throws -> FlowDefinition {
        let parts = yaml.components(separatedBy: "\n---\n")
        let header = parts.first ?? ""
        let body = parts.count > 1 ? parts[1] : ""

        guard let appId = extractValue(from: header, key: "appId") else {
            throw FlowParseError.missingAppId
        }
        let name = extractValue(from: header, key: "name")
        let actions = parseActions(from: body)
        return FlowDefinition(appId: appId, name: name, actions: actions)
    }

    private func extractValue(from text: String, key: String) -> String? {
        let pattern = "^\(key):\\s*(.+)$"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .anchorsMatchLines),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range]).trimmingCharacters(in: .whitespaces)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }

    private func parseActions(from body: String) -> [FlowAction] {
        var actions: [FlowAction] = []
        for line in body.components(separatedBy: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("- launchApp:") {
                actions.append(.launchApp(appId: value(t, prefix: "- launchApp:")))
            } else if t.hasPrefix("- tapOn:") {
                actions.append(.tapOn(selector: value(t, prefix: "- tapOn:")))
            } else if t.hasPrefix("- inputText:") {
                actions.append(.inputText(value(t, prefix: "- inputText:")))
            } else if t.hasPrefix("- assertVisible:") {
                actions.append(.assertVisible(value(t, prefix: "- assertVisible:")))
            } else if t.hasPrefix("- assertNotVisible:") {
                actions.append(.assertNotVisible(value(t, prefix: "- assertNotVisible:")))
            } else if t.hasPrefix("- scrollUntilVisible:") {
                actions.append(.scrollUntilVisible(selector: value(t, prefix: "- scrollUntilVisible:")))
            } else if t.hasPrefix("- openLink:") {
                actions.append(.openLink(url: value(t, prefix: "- openLink:")))
            } else if t.hasPrefix("- wait:") {
                let ms = Int(value(t, prefix: "- wait:")) ?? 1000
                actions.append(.wait(durationMs: ms))
            } else if t.hasPrefix("- pressKey:") {
                actions.append(.pressKey(value(t, prefix: "- pressKey:")))
            } else if t.hasPrefix("- runAiPrompt:") {
                actions.append(.runAiPrompt(prompt: value(t, prefix: "- runAiPrompt:")))
            } else if t.hasPrefix("- takeScreenshot") {
                let label = t.contains(":") ? value(t, prefix: "- takeScreenshot:") : nil
                actions.append(.takeScreenshot(label: label?.isEmpty == true ? nil : label))
            } else if t.hasPrefix("- clearState:") {
                actions.append(.clearState(appId: value(t, prefix: "- clearState:")))
            }
        }
        return actions
    }

    private func value(_ line: String, prefix: String) -> String {
        line.dropFirst(prefix.count)
            .trimmingCharacters(in: .whitespaces)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }
}

enum FlowParseError: Error {
    case missingAppId
    case invalidYaml(String)
}
