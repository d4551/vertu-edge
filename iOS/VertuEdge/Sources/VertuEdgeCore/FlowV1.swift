import Foundation

/// Shared execution states aligned with Android/KMP contracts.
/// Raw values use kebab-case to match the control-plane HTTP wire format.
/// KMP uses UPPER_SNAKE_CASE internally but serialises to the same kebab strings over the wire.
public enum FlowExecutionState: String, Codable, Sendable {
    case idle = "idle"
    case loading = "loading"
    case success = "success"
    case empty = "empty"
    case errorRetryable = "error-retryable"
    case errorNonRetryable = "error-non-retryable"
    case unauthorized = "unauthorized"
}

/// Selector target for iOS and Android parity.
public struct CommandTarget: Codable, Equatable {
    public let resourceId: String?
    public let text: String?
    public let contentDescription: String?
    public let x: Int?
    public let y: Int?

    public init(
        resourceId: String? = nil,
        text: String? = nil,
        contentDescription: String? = nil,
        x: Int? = nil,
        y: Int? = nil
    ) {
        self.resourceId = resourceId
        self.text = text
        self.contentDescription = contentDescription
        self.x = x
        self.y = y
    }
}

/// Window target used by desktop focus command.
public struct WindowTarget: Codable, Equatable {
    public let appId: String?
    public let title: String?

    public init(appId: String? = nil, title: String? = nil) {
        self.appId = appId
        self.title = title
    }
}

/// Direction for scroll and swipe commands.
public enum Direction: String, Codable {
    case up = "UP"
    case down = "DOWN"
    case left = "LEFT"
    case right = "RIGHT"
}

/// Flow command set for FlowV1.
///
/// Custom `Codable` implementation produces discriminated-union JSON
/// (`{"type":"tapOn","target":{...}}`) aligned with the JSON Schema,
/// KMP kotlinx.serialization output, and TypeScript contracts.
public enum FlowCommand: Equatable {
    case launchApp
    case tapOn(target: CommandTarget)
    case inputText(value: String)
    case assertVisible(target: CommandTarget)
    case assertNotVisible(target: CommandTarget)
    case assertText(target: CommandTarget, value: String)
    case selectOption(target: CommandTarget, option: String)
    case scroll(direction: Direction, steps: Int = 32)
    case swipe(direction: Direction, distanceFraction: Double = 0.7)
    case screenshot
    case clipboardRead
    case clipboardWrite(value: String)
    case windowFocus(target: WindowTarget)
    case hideKeyboard
    case waitForAnimation(timeoutMs: Int = 600)
}

// MARK: - Codable (discriminated-union wire format)

extension FlowCommand: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case target, value, option, direction, steps, distanceFraction, timeoutMs
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "launchApp":       self = .launchApp
        case "screenshot":      self = .screenshot
        case "clipboardRead":   self = .clipboardRead
        case "hideKeyboard":    self = .hideKeyboard
        case "tapOn":
            self = .tapOn(target: try container.decode(CommandTarget.self, forKey: .target))
        case "inputText":
            self = .inputText(value: try container.decode(String.self, forKey: .value))
        case "assertVisible":
            self = .assertVisible(target: try container.decode(CommandTarget.self, forKey: .target))
        case "assertNotVisible":
            self = .assertNotVisible(target: try container.decode(CommandTarget.self, forKey: .target))
        case "assertText":
            self = .assertText(
                target: try container.decode(CommandTarget.self, forKey: .target),
                value: try container.decode(String.self, forKey: .value)
            )
        case "selectOption":
            self = .selectOption(
                target: try container.decode(CommandTarget.self, forKey: .target),
                option: try container.decode(String.self, forKey: .option)
            )
        case "scroll":
            self = .scroll(
                direction: try container.decode(Direction.self, forKey: .direction),
                steps: try container.decodeIfPresent(Int.self, forKey: .steps) ?? 32
            )
        case "swipe":
            self = .swipe(
                direction: try container.decode(Direction.self, forKey: .direction),
                distanceFraction: try container.decodeIfPresent(Double.self, forKey: .distanceFraction) ?? 0.7
            )
        case "clipboardWrite":
            self = .clipboardWrite(value: try container.decode(String.self, forKey: .value))
        case "windowFocus":
            self = .windowFocus(target: try container.decode(WindowTarget.self, forKey: .target))
        case "waitForAnimation":
            self = .waitForAnimation(timeoutMs: try container.decodeIfPresent(Int.self, forKey: .timeoutMs) ?? 600)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container,
                debugDescription: "Unsupported FlowCommand type: \(type)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .launchApp:
            try container.encode("launchApp", forKey: .type)
        case .tapOn(let target):
            try container.encode("tapOn", forKey: .type)
            try container.encode(target, forKey: .target)
        case .inputText(let value):
            try container.encode("inputText", forKey: .type)
            try container.encode(value, forKey: .value)
        case .assertVisible(let target):
            try container.encode("assertVisible", forKey: .type)
            try container.encode(target, forKey: .target)
        case .assertNotVisible(let target):
            try container.encode("assertNotVisible", forKey: .type)
            try container.encode(target, forKey: .target)
        case .assertText(let target, let value):
            try container.encode("assertText", forKey: .type)
            try container.encode(target, forKey: .target)
            try container.encode(value, forKey: .value)
        case .selectOption(let target, let option):
            try container.encode("selectOption", forKey: .type)
            try container.encode(target, forKey: .target)
            try container.encode(option, forKey: .option)
        case .scroll(let direction, let steps):
            try container.encode("scroll", forKey: .type)
            try container.encode(direction, forKey: .direction)
            try container.encode(steps, forKey: .steps)
        case .swipe(let direction, let distanceFraction):
            try container.encode("swipe", forKey: .type)
            try container.encode(direction, forKey: .direction)
            try container.encode(distanceFraction, forKey: .distanceFraction)
        case .screenshot:
            try container.encode("screenshot", forKey: .type)
        case .clipboardRead:
            try container.encode("clipboardRead", forKey: .type)
        case .clipboardWrite(let value):
            try container.encode("clipboardWrite", forKey: .type)
            try container.encode(value, forKey: .value)
        case .windowFocus(let target):
            try container.encode("windowFocus", forKey: .type)
            try container.encode(target, forKey: .target)
        case .hideKeyboard:
            try container.encode("hideKeyboard", forKey: .type)
        case .waitForAnimation(let timeoutMs):
            try container.encode("waitForAnimation", forKey: .type)
            try container.encode(timeoutMs, forKey: .timeoutMs)
        }
    }
}

/// Canonical flow contract consumed by the iOS runtime.
public struct FlowV1: Codable, Equatable {
    public let version: String
    public let appId: String
    public let steps: [FlowCommand]

    public init(version: String = "1.0", appId: String, steps: [FlowCommand]) {
        self.version = version
        self.appId = appId
        self.steps = steps
    }
}
