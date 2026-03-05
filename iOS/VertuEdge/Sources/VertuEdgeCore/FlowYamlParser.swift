import Foundation

/// YAML parser for Maestro-style flow syntax.
public enum FlowYamlParser {
    /// Parses flow YAML into [FlowV1].
    public static func parse(_ yaml: String) throws -> FlowV1 {
        let lines = yaml.components(separatedBy: .newlines)
        var appId: String?
        var inSteps = false
        var commands: [FlowCommand] = []

        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.hasPrefix("#") {
                continue
            }

            if !inSteps {
                if line == "---" {
                    inSteps = true
                    continue
                }
                if line.hasPrefix("appId:") {
                    appId = String(line.dropFirst("appId:".count)).trimmingCharacters(in: .whitespacesAndNewlines)
                }
                continue
            }

            guard line.hasPrefix("-") else { continue }
            let payload = String(line.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
            commands.append(try parseStep(payload))
        }

        guard let resolvedAppId = appId, !resolvedAppId.isEmpty else {
            throw NSError(domain: "VertuEdge", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing appId"])
        }

        return FlowV1(appId: resolvedAppId, steps: commands)
    }

    /// Serializes a `FlowV1` back into the canonical Maestro-style YAML format.
    ///
    /// The output is round-trip compatible with `parse(_:)`: parsing the returned
    /// string produces a structurally equivalent `FlowV1`.
    public static func toYaml(_ flow: FlowV1) -> String {
        var lines: [String] = []
        lines.append("appId: \(flow.appId)")
        lines.append("---")
        for command in flow.steps {
            lines.append(serializeCommand(command))
        }
        return lines.joined(separator: "\n")
    }

    private static func serializeCommand(_ command: FlowCommand) -> String {
        switch command {
        case .launchApp:
            return "- launchApp"
        case .tapOn(let target):
            return "- tapOn: \(targetToYamlScalar(target))"
        case .inputText(let value):
            return "- inputText: \"\(escape(value))\""
        case .assertVisible(let target):
            return "- assertVisible: \(targetToYamlScalar(target))"
        case .assertNotVisible(let target):
            return "- assertNotVisible: \(targetToYamlScalar(target))"
        case .assertText(let target, let value):
            return "- assertText: \"\(targetToYamlScalarInline(target))::\(escape(value))\""
        case .selectOption(let target, let option):
            return "- selectOption: \"\(targetToYamlScalarInline(target))::\(escape(option))\""
        case .scroll(let direction, _):
            return "- scroll: \(direction.rawValue.lowercased())"
        case .swipe(let direction, _):
            return "- swipe: \(direction.rawValue.lowercased())"
        case .screenshot:
            return "- screenshot"
        case .clipboardRead:
            return "- clipboardRead"
        case .clipboardWrite(let value):
            return "- clipboardWrite: \"\(escape(value))\""
        case .windowFocus(let target):
            return "- windowFocus: \"\(windowTargetToYamlScalar(target))\""
        case .hideKeyboard:
            return "- hideKeyboard"
        case .waitForAnimation(let timeoutMs):
            return "- waitForAnimation: \(timeoutMs)"
        }
    }

    /// Produces a quoted YAML scalar for a `CommandTarget` (for standalone commands).
    private static func targetToYamlScalar(_ target: CommandTarget) -> String {
        if let text = target.text, !text.isEmpty {
            return "\"\(escape(text))\""
        }
        if let resourceId = target.resourceId, !resourceId.isEmpty {
            return "\"id=\(escape(resourceId))\""
        }
        if let desc = target.contentDescription, !desc.isEmpty {
            return "\"contentDescription=\(escape(desc))\""
        }
        if let x = target.x, let y = target.y {
            return "\"\(x),\(y)\""
        }
        return "\"\""
    }

    /// Produces an unquoted inline scalar for `CommandTarget` (used inside `::` compound values).
    private static func targetToYamlScalarInline(_ target: CommandTarget) -> String {
        if let text = target.text, !text.isEmpty { return text }
        if let resourceId = target.resourceId, !resourceId.isEmpty { return "id=\(resourceId)" }
        if let desc = target.contentDescription, !desc.isEmpty { return "contentDescription=\(desc)" }
        if let x = target.x, let y = target.y { return "\(x),\(y)" }
        return ""
    }

    private static func windowTargetToYamlScalar(_ target: WindowTarget) -> String {
        switch (target.appId, target.title) {
        case let (appId?, title?): return "appId=\(escape(appId))|title=\(escape(title))"
        case let (appId?, nil):    return "appId=\(escape(appId))"
        case let (nil, title?):    return "title=\(escape(title))"
        case (nil, nil):           return ""
        }
    }

    /// Escapes backslashes and double-quotes for YAML double-quoted strings.
    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }

    private static func parseStep(_ payload: String) throws -> FlowCommand {
        if !payload.contains(":") {
            if payload == "launchApp" { return .launchApp }
            if payload == "hideKeyboard" { return .hideKeyboard }
            if payload == "screenshot" { return .screenshot }
            if payload == "clipboardRead" { return .clipboardRead }
            throw NSError(domain: "VertuEdge", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsupported step: \(payload)"])
        }

        let parts = payload.split(separator: ":", maxSplits: 1).map(String.init)
        let key = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let value = unescape(unquote(parts[1].trimmingCharacters(in: .whitespacesAndNewlines)))

        if key == "tapOn" { return .tapOn(target: parseTarget(value)) }
        if key == "inputText" { return .inputText(value: value) }
        if key == "assertVisible" { return .assertVisible(target: parseTarget(value)) }
        if key == "assertNotVisible" { return .assertNotVisible(target: parseTarget(value)) }
        if key == "assertText" {
            let chunks = value.components(separatedBy: "::")
            guard let targetStr = chunks.first, !targetStr.isEmpty, chunks.count > 1 else {
                throw NSError(domain: "VertuEdge", code: 5, userInfo: [NSLocalizedDescriptionKey: "assertText requires target::value"])
            }
            return .assertText(target: parseTarget(targetStr), value: chunks[1...].joined(separator: "::"))
        }
        if key == "selectOption" {
            let chunks = value.components(separatedBy: "::")
            guard let targetStr = chunks.first, !targetStr.isEmpty, chunks.count > 1 else {
                throw NSError(domain: "VertuEdge", code: 6, userInfo: [NSLocalizedDescriptionKey: "selectOption requires target::option"])
            }
            return .selectOption(target: parseTarget(targetStr), option: chunks[1...].joined(separator: "::"))
        }
        if key == "scroll" { return .scroll(direction: try parseDirection(value), steps: 32) }
        if key == "swipe" { return .swipe(direction: try parseDirection(value), distanceFraction: 0.7) }
        if key == "clipboardWrite" { return .clipboardWrite(value: value) }
        if key == "windowFocus" {
            return .windowFocus(target: parseWindowTarget(value))
        }
        if key == "waitForAnimation" { return .waitForAnimation(timeoutMs: Int(value) ?? 600) }

        throw NSError(domain: "VertuEdge", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unsupported command: \(key)"])
    }

    /// Removes a single wrapping pair of double- or single-quotes from a string.
    /// Unlike `replacingOccurrences`, this only strips the outermost quote characters,
    /// preserving any internal quotes in the value.
    private static func unquote(_ s: String) -> String {
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return trimmed }
        if (trimmed.hasPrefix("\"") && trimmed.hasSuffix("\"")) ||
           (trimmed.hasPrefix("'") && trimmed.hasSuffix("'")) {
            return String(trimmed.dropFirst().dropLast())
        }
        return trimmed
    }

    /// Unescapes YAML double-quoted string escape sequences: `\"` → `"` and `\\` → `\`.
    /// Must be called after `unquote` once the outer quotes have been stripped.
    private static func unescape(_ s: String) -> String {
        // Process character-by-character to handle sequences correctly.
        var result = ""
        result.reserveCapacity(s.count)
        var index = s.startIndex
        while index < s.endIndex {
            let ch = s[index]
            if ch == "\\" {
                let next = s.index(after: index)
                if next < s.endIndex {
                    switch s[next] {
                    case "\"": result.append("\""); index = s.index(after: next)
                    case "\\": result.append("\\"); index = s.index(after: next)
                    case "n":  result.append("\n"); index = s.index(after: next)
                    case "t":  result.append("\t"); index = s.index(after: next)
                    default:
                        // Unknown escape: preserve the backslash and continue
                        result.append(ch)
                        index = s.index(after: index)
                    }
                } else {
                    result.append(ch)
                    index = s.index(after: index)
                }
            } else {
                result.append(ch)
                index = s.index(after: index)
            }
        }
        return result
    }

    /// Parses a YAML scalar value into a typed `CommandTarget`, mirroring KMP's `toTarget()`.
    ///
    /// Recognised prefixes (produced by `targetToYamlScalar`):
    /// - `id=<value>`                → `resourceId`
    /// - `contentDescription=<value>` → `contentDescription`
    /// - `<x>,<y>` (two integers)   → `x` / `y`
    /// - anything else              → `text`
    private static func parseTarget(_ value: String) -> CommandTarget {
        if value.hasPrefix("id=") {
            return CommandTarget(resourceId: String(value.dropFirst("id=".count)))
        }
        if value.hasPrefix("contentDescription=") {
            return CommandTarget(contentDescription: String(value.dropFirst("contentDescription=".count)))
        }
        let parts = value.split(separator: ",", maxSplits: 1).map(String.init)
        if parts.count == 2,
           let x = Int(parts[0].trimmingCharacters(in: .whitespaces)),
           let y = Int(parts[1].trimmingCharacters(in: .whitespaces)) {
            return CommandTarget(x: x, y: y)
        }
        return CommandTarget(text: value)
    }

    private static func parseDirection(_ value: String) throws -> Direction {
        let upper = value.uppercased()
        if let direction = Direction(rawValue: upper) {
            return direction
        }
        throw NSError(domain: "VertuEdge", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unsupported direction: \(value)"])
    }

    private static func parseWindowTarget(_ value: String) -> WindowTarget {
        let tokens = value.split(separator: "|").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        var appId: String?
        var title: String?
        for token in tokens {
            if token.hasPrefix("appId=") {
                appId = String(token.dropFirst("appId=".count))
                continue
            }
            if token.hasPrefix("title=") {
                title = String(token.dropFirst("title=".count))
            }
        }

        if appId == nil && title == nil {
            title = value
        }

        return WindowTarget(appId: appId, title: title)
    }
}
