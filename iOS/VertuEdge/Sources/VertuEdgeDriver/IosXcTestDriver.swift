import Foundation
import VertuEdgeCore

#if canImport(XCTest)
import XCTest
#endif

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

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

/// XCTest-based FlowV1 driver for iOS runtime parity.
@MainActor
public final class IosXcTestDriver {
    public init() {}

    /// Executes a flow and returns deterministic step telemetry.
    public func execute(
        flow: FlowV1,
        correlationId: String = UUID().uuidString,
        screenshotDirectory: URL? = nil,
        config: DriverExecutionConfig = DriverExecutionConfig()
    ) -> IosDriverReport {
        #if canImport(XCTest)
        if let readinessFailure = validateReadiness() {
            let step = buildErrorStep(
                commandIndex: 0,
                commandType: "launchApp",
                code: "IOS_TARGET_NOT_READY",
                category: "dependency",
                reason: readinessFailure,
                retryable: false,
                correlationId: correlationId
            )
            return IosDriverReport(
                completedSteps: 0,
                totalSteps: flow.steps.count,
                state: .errorNonRetryable,
                message: readinessFailure,
                correlationId: correlationId,
                steps: [step]
            )
        }

        let app = XCUIApplication(bundleIdentifier: flow.appId)
        app.launch()
        if app.state == .notRunning {
            let reason = "Failed to launch app '\(flow.appId)' via XCTest."
            let step = buildErrorStep(
                commandIndex: 0,
                commandType: "launchApp",
                code: "IOS_LAUNCH_FAILED",
                category: "runtime",
                reason: reason,
                retryable: true,
                correlationId: correlationId
            )
            return IosDriverReport(
                completedSteps: 0,
                totalSteps: flow.steps.count,
                state: .errorRetryable,
                message: reason,
                correlationId: correlationId,
                steps: [step]
            )
        }

        let rootDirectory = screenshotDirectory ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        var reports: [IosDriverStepReport] = []
        var completed = 0

        for (index, command) in flow.steps.enumerated() {
            let started = Date()
            let startedAt = iso8601(started)
            do {
                let artifact = try executeCommand(
                    command: command,
                    commandIndex: index,
                    app: app,
                    correlationId: correlationId,
                    screenshotDirectory: rootDirectory
                )
                let ended = Date()
                let elapsed = ended.timeIntervalSince(started) * 1000
                if elapsed > Double(config.defaultStepTimeoutMs) {
                    // Log a warning when a step exceeds the configured timeout threshold.
                    // The step still succeeds; this is observability-only.
                    print("[VertuDriver] WARNING: step \(index) (\(commandType(command))) took \(Int(elapsed))ms, exceeded threshold of \(config.defaultStepTimeoutMs)ms (correlationId=\(correlationId))")
                }
                reports.append(
                    IosDriverStepReport(
                        commandIndex: index,
                        commandType: commandType(command),
                        state: .success,
                        message: "\(commandType(command)) executed successfully",
                        startedAt: startedAt,
                        endedAt: iso8601(ended),
                        durationMs: millisecondsBetween(started, ended),
                        error: nil,
                        artifact: artifact
                    )
                )
                completed += 1
            } catch let failure as IosDriverError {
                let ended = Date()
                // Capture UI hierarchy for debugging on failure.
                let hierarchyPath = captureHierarchy(
                    app: app,
                    commandIndex: index,
                    correlationId: correlationId,
                    screenshotDirectory: screenshotDirectory ?? rootDirectory
                )
                let failureArtifact: IosDriverArtifact? = hierarchyPath.map {
                    IosDriverArtifact(
                        artifactPath: $0,
                        contentType: "text/plain",
                        createdAt: iso8601(ended),
                        correlationId: correlationId,
                        hierarchyPath: $0
                    )
                }
                reports.append(
                    IosDriverStepReport(
                        commandIndex: index,
                        commandType: commandType(command),
                        state: failure.code.hasSuffix("_UNSUPPORTED") ? .unsupported : .error,
                        message: failure.reason,
                        startedAt: startedAt,
                        endedAt: iso8601(ended),
                        durationMs: millisecondsBetween(started, ended),
                        error: failure,
                        artifact: failureArtifact
                    )
                )

                let terminalState: FlowExecutionState = failure.retryable ? .errorRetryable : .errorNonRetryable
                return IosDriverReport(
                    completedSteps: completed,
                    totalSteps: flow.steps.count,
                    state: terminalState,
                    message: failure.reason,
                    correlationId: correlationId,
                    steps: reports
                )
            } catch {
                let ended = Date()
                let typed = IosDriverError(
                    code: "IOS_COMMAND_FAILED",
                    category: "runtime",
                    commandIndex: index,
                    command: commandType(command),
                    reason: error.localizedDescription,
                    retryable: true,
                    correlationId: correlationId
                )
                // Capture UI hierarchy for debugging on generic failure.
                let hierarchyPath = captureHierarchy(
                    app: app,
                    commandIndex: index,
                    correlationId: correlationId,
                    screenshotDirectory: screenshotDirectory ?? rootDirectory
                )
                let failureArtifact: IosDriverArtifact? = hierarchyPath.map {
                    IosDriverArtifact(
                        artifactPath: $0,
                        contentType: "text/plain",
                        createdAt: iso8601(ended),
                        correlationId: correlationId,
                        hierarchyPath: $0
                    )
                }
                reports.append(
                    IosDriverStepReport(
                        commandIndex: index,
                        commandType: commandType(command),
                        state: .error,
                        message: typed.reason,
                        startedAt: startedAt,
                        endedAt: iso8601(ended),
                        durationMs: millisecondsBetween(started, ended),
                        error: typed,
                        artifact: failureArtifact
                    )
                )
                return IosDriverReport(
                    completedSteps: completed,
                    totalSteps: flow.steps.count,
                    state: .errorRetryable,
                    message: typed.reason,
                    correlationId: correlationId,
                    steps: reports
                )
            }
        }

        return IosDriverReport(
            completedSteps: completed,
            totalSteps: flow.steps.count,
            state: .success,
            message: "Flow executed successfully",
            correlationId: correlationId,
            steps: reports
        )
        #else
        let reason = "XCTest runtime unavailable on this host"
        let step = buildErrorStep(
            commandIndex: 0,
            commandType: "launchApp",
            code: "IOS_XCTEST_UNAVAILABLE",
            category: "dependency",
            reason: reason,
            retryable: false,
            correlationId: correlationId
        )
        return IosDriverReport(
            completedSteps: 0,
            totalSteps: flow.steps.count,
            state: .errorNonRetryable,
            message: reason,
            correlationId: correlationId,
            steps: [step]
        )
        #endif
    }
}

#if canImport(XCTest)
private extension IosXcTestDriver {
    func validateReadiness() -> String? {
        #if !os(macOS)
        return "iOS automation requires a macOS host."
        #else
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "list", "devices", "booted"]
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return "xcrun/simctl is unavailable: \(error.localizedDescription)"
        }

        guard process.terminationStatus == 0 else {
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let reason = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if reason.isEmpty {
                return "xcrun simctl readiness check failed with status \(process.terminationStatus)."
            }
            return "xcrun simctl readiness check failed: \(reason)"
        }

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: outputData, encoding: .utf8) ?? ""
        guard output.lowercased().contains("booted") else {
            return "No booted iOS simulator/device found."
        }

        return nil
        #endif
    }

    func executeCommand(
        command: FlowCommand,
        commandIndex: Int,
        app: XCUIApplication,
        correlationId: String,
        screenshotDirectory: URL
    ) throws -> IosDriverArtifact? {
        switch command {
        case .launchApp:
            if app.state == .runningForeground {
                return nil
            }
            app.activate()
            if app.state == .notRunning {
                throw IosDriverError(
                    code: "IOS_LAUNCH_FAILED",
                    category: "runtime",
                    commandIndex: commandIndex,
                    command: "launchApp",
                    reason: "Failed to bring app to foreground.",
                    retryable: true,
                    correlationId: correlationId
                )
            }
            return nil

        case .tapOn(let target):
            if let x = target.x, let y = target.y {
                let coordinate = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
                    .withOffset(CGVector(dx: CGFloat(x), dy: CGFloat(y)))
                coordinate.tap()
                return nil
            }
            guard let element = resolveElement(in: app, target: target) else {
                throw missingElementError(
                    commandIndex: commandIndex,
                    command: "tapOn",
                    correlationId: correlationId,
                    selector: target
                )
            }
            element.tap()
            return nil

        case .inputText(let value):
            app.typeText(value)
            return nil

        case .assertVisible(let target):
            guard let element = resolveElement(in: app, target: target), element.exists else {
                throw missingElementError(
                    commandIndex: commandIndex,
                    command: "assertVisible",
                    correlationId: correlationId,
                    selector: target
                )
            }
            return nil

        case .assertNotVisible(let target):
            if let element = resolveElement(in: app, target: target), element.exists {
                throw IosDriverError(
                    code: "IOS_ASSERT_NOT_VISIBLE_FAILED",
                    category: "validation",
                    commandIndex: commandIndex,
                    command: "assertNotVisible",
                    reason: "Element unexpectedly visible for selector \(stringifyTarget(target)).",
                    retryable: false,
                    correlationId: correlationId
                )
            }
            return nil

        case .assertText(let target, let value):
            guard let element = resolveElement(in: app, target: target), element.exists else {
                throw missingElementError(
                    commandIndex: commandIndex,
                    command: "assertText",
                    correlationId: correlationId,
                    selector: target
                )
            }
            let label = element.label
            let elementValue = element.value as? String ?? ""
            guard label == value || elementValue == value else {
                let actual = label.isEmpty ? elementValue : label
                throw IosDriverError(
                    code: "IOS_ASSERT_TEXT_FAILED",
                    category: "validation",
                    commandIndex: commandIndex,
                    command: "assertText",
                    reason: "Expected text '\(value)' for selector \(stringifyTarget(target)) but got '\(actual)'.",
                    retryable: false,
                    correlationId: correlationId
                )
            }
            return nil

        case .selectOption(let target, let option):
            guard let element = resolveElement(in: app, target: target), element.exists else {
                throw missingElementError(
                    commandIndex: commandIndex,
                    command: "selectOption",
                    correlationId: correlationId,
                    selector: target
                )
            }
            element.tap()
            let optionElement = app.buttons[option].firstMatch.exists
                ? app.buttons[option].firstMatch
                : app.staticTexts[option].firstMatch
            guard optionElement.exists else {
                throw IosDriverError(
                    code: "IOS_SELECT_OPTION_NOT_FOUND",
                    category: "validation",
                    commandIndex: commandIndex,
                    command: "selectOption",
                    reason: "Option '\(option)' was not found after opening selector \(stringifyTarget(target)).",
                    retryable: false,
                    correlationId: correlationId
                )
            }
            optionElement.tap()
            return nil

        case .scroll(let direction, let steps):
            // Map steps to velocity: higher steps = slower, more precise scroll.
            // Default 32 steps → moderate velocity (~62 pts/s); fewer steps → faster.
            // Clamp to [100, 2000] pts/s so the gesture always registers.
            let velocity = XCUIGestureVelocity(max(100, min(2000, 2000 / Double(max(1, steps)))))
            switch direction {
            case .up:    app.swipeUp(velocity: velocity)
            case .down:  app.swipeDown(velocity: velocity)
            case .left:  app.swipeLeft(velocity: velocity)
            case .right: app.swipeRight(velocity: velocity)
            }
            return nil

        case .swipe(let direction, let distanceFraction):
            try performSwipe(direction: direction, distanceFraction: distanceFraction, app: app)
            return nil

        case .screenshot:
            try FileManager.default.createDirectory(
                at: screenshotDirectory,
                withIntermediateDirectories: true,
                attributes: nil
            )
            let filename = "vertu-flow-ios-\(correlationId)-step-\(commandIndex).png"
            let path = screenshotDirectory.appendingPathComponent(filename)
            let image = XCUIScreen.main.screenshot().pngRepresentation
            try image.write(to: path)
            return IosDriverArtifact(
                artifactPath: path.path,
                contentType: "image/png",
                createdAt: iso8601(Date()),
                correlationId: correlationId
            )

        case .hideKeyboard:
            if app.keyboards.count > 0 {
                let keyboard = app.keyboards.firstMatch
                if keyboard.buttons["Return"].exists {
                    keyboard.buttons["Return"].tap()
                } else if keyboard.buttons["Done"].exists {
                    keyboard.buttons["Done"].tap()
                } else if keyboard.buttons["Hide keyboard"].exists {
                    keyboard.buttons["Hide keyboard"].tap()
                } else {
                    app.typeText("\n")
                }
            }
            return nil

        case .waitForAnimation(let timeoutMs):
            let bounded = max(0, timeoutMs)
            Thread.sleep(forTimeInterval: Double(bounded) / 1000.0)
            return nil

        case .clipboardRead:
            throw unsupportedError(
                commandIndex: commandIndex,
                command: "clipboardRead",
                reason: "clipboardRead is not supported on iOS XCUI runtime.",
                correlationId: correlationId
            )

        case .clipboardWrite(let value):
            #if os(iOS)
            UIPasteboard.general.string = value
            #elseif os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
            #endif
            return nil

        case .windowFocus:
            throw unsupportedError(
                commandIndex: commandIndex,
                command: "windowFocus",
                reason: "windowFocus is not supported on iOS XCUI runtime.",
                correlationId: correlationId
            )
        }
    }

    func resolveElement(in app: XCUIApplication, target: CommandTarget) -> XCUIElement? {
        if let text = target.text, !text.isEmpty {
            let candidates: [XCUIElement] = [
                app.staticTexts[text].firstMatch,
                app.buttons[text].firstMatch,
                app.cells[text].firstMatch,
                app.textFields[text].firstMatch,
                app.secureTextFields[text].firstMatch,
                app.otherElements[text].firstMatch,
            ]
            return candidates.first(where: { $0.exists })
        }

        if let description = target.contentDescription, !description.isEmpty {
            let candidates: [XCUIElement] = [
                app.otherElements[description].firstMatch,
                app.buttons[description].firstMatch,
                app.staticTexts[description].firstMatch,
            ]
            return candidates.first(where: { $0.exists })
        }

        if let resourceId = target.resourceId, !resourceId.isEmpty {
            let any = app.descendants(matching: .any)[resourceId].firstMatch
            return any.exists ? any : nil
        }

        return nil
    }

    func performSwipe(direction: Direction, distanceFraction: Double = 0.7, app: XCUIApplication) throws {
        // Map distanceFraction (0.0–1.0) to a gesture velocity in points per second.
        // A full-distance swipe (1.0) uses 2400 pts/s; minimum clamps at 200 pts/s.
        let velocity = XCUIGestureVelocity(max(200.0, distanceFraction * 2400.0))
        switch direction {
        case .up:
            app.swipeUp(velocity: velocity)
        case .down:
            app.swipeDown(velocity: velocity)
        case .left:
            app.swipeLeft(velocity: velocity)
        case .right:
            app.swipeRight(velocity: velocity)
        }
    }

    /// Captures the XCUIApplication UI hierarchy description to a text file for post-failure debugging.
    /// Returns the file path string on success, or `nil` if the write fails.
    func captureHierarchy(
        app: XCUIApplication,
        commandIndex: Int,
        correlationId: String,
        screenshotDirectory: URL
    ) -> String? {
        do {
            try FileManager.default.createDirectory(
                at: screenshotDirectory,
                withIntermediateDirectories: true,
                attributes: nil
            )
            let hierarchyPath = screenshotDirectory
                .appendingPathComponent("vertu-flow-ios-\(correlationId)-step-\(commandIndex)-hierarchy.txt")
            let hierarchy = app.debugDescription
            try hierarchy.write(to: hierarchyPath, atomically: true, encoding: .utf8)
            return hierarchyPath.path
        } catch {
            return nil
        }
    }

    func unsupportedError(
        commandIndex: Int,
        command: String,
        reason: String,
        correlationId: String
    ) -> IosDriverError {
        IosDriverError(
            code: "IOS_COMMAND_UNSUPPORTED",
            category: "unsupported",
            commandIndex: commandIndex,
            command: command,
            reason: reason,
            retryable: false,
            correlationId: correlationId
        )
    }

    func missingElementError(
        commandIndex: Int,
        command: String,
        correlationId: String,
        selector: CommandTarget
    ) -> IosDriverError {
        IosDriverError(
            code: "IOS_SELECTOR_NOT_FOUND",
            category: "validation",
            commandIndex: commandIndex,
            command: command,
            reason: "Element not found for selector \(stringifyTarget(selector)).",
            retryable: false,
            correlationId: correlationId
        )
    }
}
#endif

private extension IosXcTestDriver {
    func buildErrorStep(
        commandIndex: Int,
        commandType: String,
        code: String,
        category: String,
        reason: String,
        retryable: Bool,
        correlationId: String
    ) -> IosDriverStepReport {
        let started = Date()
        let ended = Date()
        return IosDriverStepReport(
            commandIndex: commandIndex,
            commandType: commandType,
            state: .error,
            message: reason,
            startedAt: iso8601(started),
            endedAt: iso8601(ended),
            durationMs: 0,
            error: IosDriverError(
                code: code,
                category: category,
                commandIndex: commandIndex,
                command: commandType,
                reason: reason,
                retryable: retryable,
                correlationId: correlationId
            ),
            artifact: nil
        )
    }

    func commandType(_ command: FlowCommand) -> String {
        switch command {
        case .launchApp: return "launchApp"
        case .tapOn: return "tapOn"
        case .inputText: return "inputText"
        case .assertVisible: return "assertVisible"
        case .assertNotVisible: return "assertNotVisible"
        case .assertText: return "assertText"
        case .selectOption: return "selectOption"
        case .scroll: return "scroll"
        case .swipe: return "swipe"
        case .screenshot: return "screenshot"
        case .clipboardRead: return "clipboardRead"
        case .clipboardWrite: return "clipboardWrite"
        case .windowFocus: return "windowFocus"
        case .hideKeyboard: return "hideKeyboard"
        case .waitForAnimation: return "waitForAnimation"
        }
    }
}

private func iso8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

private func millisecondsBetween(_ started: Date, _ ended: Date) -> Int {
    max(0, Int(ended.timeIntervalSince(started) * 1000))
}

private func stringifyTarget(_ target: CommandTarget) -> String {
    if let resourceId = target.resourceId, !resourceId.isEmpty {
        return "id=\(resourceId)"
    }
    if let text = target.text, !text.isEmpty {
        return "text=\(text)"
    }
    if let contentDescription = target.contentDescription, !contentDescription.isEmpty {
        return "contentDescription=\(contentDescription)"
    }
    if let x = target.x, let y = target.y {
        return "\(x),\(y)"
    }
    return "<empty-target>"
}
