import Foundation
import OSLog
import VertuEdgeCore

/// Native device AI failure stages surfaced to UI and shell protocol consumers.
public enum DeviceAiProtocolFailureStage: String, Codable, Equatable, Sendable {
    case validation
    case download
    case smoke
    case persistence
}

/// Typed native device AI failure envelope.
public struct DeviceAiProtocolFailure: Codable, Equatable, Sendable {
    public let stage: DeviceAiProtocolFailureStage
    public let code: String
    public let message: String
    public let retryable: Bool
    public let correlationId: String

    public init(
        stage: DeviceAiProtocolFailureStage,
        code: String,
        message: String,
        retryable: Bool,
        correlationId: String
    ) {
        self.stage = stage
        self.code = code
        self.message = message
        self.retryable = retryable
        self.correlationId = correlationId
    }
}

/// App-managed artifact metadata persisted by the native protocol runner.
public struct DeviceAiProtocolArtifact: Codable, Equatable, Sendable {
    public let path: String
    public let sha256: String
    public let sizeBytes: Int64

    public init(path: String, sha256: String, sizeBytes: Int64) {
        self.path = path
        self.sha256 = sha256
        self.sizeBytes = sizeBytes
    }
}

/// Stable pass/fail status emitted by native device AI stages.
public enum DeviceAiProtocolStageStatus: String, Codable, Equatable, Sendable {
    case pass
    case fail
}

/// Per-stage telemetry for native device AI execution.
public struct DeviceAiProtocolStageReport: Codable, Equatable, Sendable {
    public let stage: String
    public let status: DeviceAiProtocolStageStatus
    public let correlationId: String
    public let startedAt: String
    public let endedAt: String
    public let message: String
    public let retryable: Bool

    public init(
        stage: String,
        status: DeviceAiProtocolStageStatus,
        correlationId: String,
        startedAt: String,
        endedAt: String,
        message: String,
        retryable: Bool
    ) {
        self.stage = stage
        self.status = status
        self.correlationId = correlationId
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.message = message
        self.retryable = retryable
    }
}

/// Input contract for native device AI protocol runs.
public struct DeviceAiProtocolRequest: Codable, Equatable, Sendable {
    public let appId: String
    public let modelRef: String
    public let revision: String
    public let fileName: String
    public let expectedSha256: String
    public let token: String
    public let correlationId: String

    public init(
        appId: String = "",
        modelRef: String,
        revision: String = "",
        fileName: String,
        expectedSha256: String = "",
        token: String = "",
        correlationId: String
    ) {
        self.appId = appId
        self.modelRef = modelRef
        self.revision = revision
        self.fileName = fileName
        self.expectedSha256 = expectedSha256
        self.token = token
        self.correlationId = correlationId
    }
}

/// Persisted native protocol report consumed by UI and shell orchestrators.
public struct DeviceAiProtocolRunReport: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let correlationId: String
    public let state: FlowExecutionState
    public let message: String
    public let request: DeviceAiProtocolRequest
    public let artifact: DeviceAiProtocolArtifact?
    public let model: DeviceAiProtocolResolvedModel?
    public let failure: DeviceAiProtocolFailure?
    public let stages: [DeviceAiProtocolStageReport]

    public init(
        generatedAt: String,
        correlationId: String,
        state: FlowExecutionState,
        message: String,
        request: DeviceAiProtocolRequest,
        artifact: DeviceAiProtocolArtifact?,
        model: DeviceAiProtocolResolvedModel?,
        failure: DeviceAiProtocolFailure?,
        stages: [DeviceAiProtocolStageReport]
    ) {
        self.generatedAt = generatedAt
        self.correlationId = correlationId
        self.state = state
        self.message = message
        self.request = request
        self.artifact = artifact
        self.model = model
        self.failure = failure
        self.stages = stages
    }
}

/// Resolved model evidence emitted by the iOS native protocol report.
public struct DeviceAiProtocolResolvedModel: Codable, Equatable, Sendable {
    public let modelRef: String
    public let revision: String
    public let fileName: String
    public let expectedSha256: String
    public let capabilities: [DeviceAiCapability]

    public init(
        modelRef: String,
        revision: String,
        fileName: String,
        expectedSha256: String,
        capabilities: [DeviceAiCapability]
    ) {
        self.modelRef = modelRef
        self.revision = revision
        self.fileName = fileName
        self.expectedSha256 = expectedSha256
        self.capabilities = capabilities
    }
}

/// Result bundle returned by the native protocol runner after persisting artifacts and reports.
public struct DeviceAiProtocolRunOutcome: Equatable, Sendable {
    public let report: DeviceAiProtocolRunReport
    public let reportURL: URL
    public let latestReportURL: URL

    public init(report: DeviceAiProtocolRunReport, reportURL: URL, latestReportURL: URL) {
        self.report = report
        self.reportURL = reportURL
        self.latestReportURL = latestReportURL
    }
}

/// Launch request resolved from process environment for headless host-app runs.
public struct DeviceAiProtocolLaunchRequest: Equatable, Sendable {
    public let isEnabled: Bool
    public let request: DeviceAiProtocolRequest

    public init(isEnabled: Bool, request: DeviceAiProtocolRequest) {
        self.isEnabled = isEnabled
        self.request = request
    }
}

/// App-owned native device AI runner for iOS smoke and staging verification.
@MainActor
public final class DeviceAiProtocolRunner {
    public typealias DownloadOperation = (HuggingFaceModelDownloadRequest, URL) -> Result<HuggingFaceModelDownloadOutcome, HuggingFaceModelManagerError>
    public typealias SmokeOperation = (String, String, URL) -> IosDriverReport
    public typealias ApplicationSupportRootProvider = () -> Result<URL, Error>
    public typealias Clock = () -> Date

    private static let autorunEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_AUTORUN"
    private static let modeEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_MODE"
    private static let appIdEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_APP_ID"
    private static let modelRefEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_MODEL_REF"
    private static let revisionEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_MODEL_REVISION"
    private static let fileNameEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_MODEL_FILE"
    private static let sha256EnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_MODEL_SHA256"
    private static let tokenEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_HF_TOKEN"
    private static let correlationIdEnvironmentKey = "VERTU_DEVICE_AI_PROTOCOL_CORRELATION_ID"
    private static let latestReportFileName = "latest.json"

    private let logger = Logger(subsystem: "com.vertu.edge.driver", category: "DeviceAiProtocolRunner")
    private let config: ControlPlaneRuntimeConfig
    private let driverAdapter: DriverAdapter
    private let fileManager: FileManager
    private let applicationSupportRootProvider: ApplicationSupportRootProvider
    private let downloadOperation: DownloadOperation?
    private let smokeOperation: SmokeOperation?
    private let now: Clock
    private let encoder: JSONEncoder

    public init(
        config: ControlPlaneRuntimeConfig = .shared,
        driverAdapter: DriverAdapter = DefaultDriverAdapter(),
        fileManager: FileManager = .default,
        applicationSupportRootProvider: ApplicationSupportRootProvider? = nil,
        downloadOperation: DownloadOperation? = nil,
        smokeOperation: SmokeOperation? = nil,
        now: @escaping Clock = Date.init
    ) {
        self.config = config
        self.driverAdapter = driverAdapter
        self.fileManager = fileManager
        self.applicationSupportRootProvider = applicationSupportRootProvider ?? {
            Result {
                try fileManager.url(
                    for: .applicationSupportDirectory,
                    in: .userDomainMask,
                    appropriateFor: nil,
                    create: true
                )
            }
        }
        self.downloadOperation = downloadOperation
        self.smokeOperation = smokeOperation
        self.now = now
        self.encoder = JSONEncoder()
        self.encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    /// Resolve a headless launch request from environment values when autorun is enabled.
    public static func launchRequest(
        environment: [String: String],
        config: ControlPlaneRuntimeConfig = .shared,
        defaultAppId: String
    ) -> DeviceAiProtocolLaunchRequest? {
        let isAutorunEnabled = environment[autorunEnvironmentKey]?.normalizedBoolean == true
            || environment[modeEnvironmentKey]?.trimmed == "run"
        guard isAutorunEnabled else {
            return nil
        }

        let request = DeviceAiProtocolRequest(
            appId: environment[appIdEnvironmentKey]?.trimmed.nonEmpty ?? defaultAppId,
            modelRef: environment[modelRefEnvironmentKey]?.trimmed.nonEmpty ?? config.deviceAiRequiredModelRef,
            revision: environment[revisionEnvironmentKey]?.trimmed.nonEmpty ?? config.deviceAiRequiredModelRevision,
            fileName: environment[fileNameEnvironmentKey]?.trimmed.nonEmpty ?? config.deviceAiRequiredModelFileName,
            expectedSha256: environment[sha256EnvironmentKey]?.trimmed.nonEmpty ?? config.deviceAiRequiredModelSha256,
            token: environment[tokenEnvironmentKey]?.trimmed.nonEmpty ?? config.deviceAiHfToken,
            correlationId: environment[correlationIdEnvironmentKey]?.trimmed.nonEmpty ?? UUID().uuidString
        )
        return DeviceAiProtocolLaunchRequest(isEnabled: true, request: request)
    }

    /// Execute the native protocol, persist the report, and return report locations.
    public func run(request: DeviceAiProtocolRequest) async -> DeviceAiProtocolRunOutcome {
        let normalizedRequest = normalizedRequest(request)
        let reportResult = await buildReport(for: normalizedRequest)
        return persist(reportResult.report, requestedReportFileName: "\(normalizedRequest.correlationId).json")
    }

    private func buildReport(for request: DeviceAiProtocolRequest) async -> (report: DeviceAiProtocolRunReport, artifactDirectory: URL) {
        let artifactDirectory = managedModelDirectoryURL()
        let generatedAt = iso8601(now())
        let resolvedModel = resolvedModel(for: request)

        guard let validationFailure = validationFailure(for: request) else {
            let downloadStartedAt = iso8601(now())
            let directoryCreationResult = Result {
                if !fileManager.fileExists(atPath: artifactDirectory.path) {
                    try fileManager.createDirectory(at: artifactDirectory, withIntermediateDirectories: true, attributes: nil)
                }
            }
            if case .failure(let error) = directoryCreationResult {
                let failure = DeviceAiProtocolFailure(
                    stage: .persistence,
                    code: "IOS_DEVICE_AI_ARTIFACT_DIRECTORY_UNAVAILABLE",
                    message: error.localizedDescription,
                    retryable: false,
                    correlationId: request.correlationId
                )
                return (
                    DeviceAiProtocolRunReport(
                        generatedAt: generatedAt,
                        correlationId: request.correlationId,
                        state: .errorNonRetryable,
                        message: error.localizedDescription,
                        request: request,
                        artifact: nil,
                        model: resolvedModel,
                        failure: failure,
                        stages: [
                            DeviceAiProtocolStageReport(
                                stage: "ios-stage",
                                status: .fail,
                                correlationId: request.correlationId,
                                startedAt: downloadStartedAt,
                                endedAt: iso8601(now()),
                                message: error.localizedDescription,
                                retryable: false
                            )
                        ]
                    ),
                    artifactDirectory
                )
            }
            let destinationURL = artifactDirectory.appendingPathComponent(request.fileName, isDirectory: false)
            let downloadResult = await executeDownload(request: request, destinationURL: destinationURL)
            switch downloadResult {
            case .success(let outcome):
                let downloadStage = DeviceAiProtocolStageReport(
                    stage: "ios-stage",
                    status: .pass,
                    correlationId: outcome.correlationId,
                    startedAt: downloadStartedAt,
                    endedAt: iso8601(now()),
                    message: "Model downloaded and verified in app-managed storage.",
                    retryable: false
                )
                let smokeStartedAt = iso8601(now())
                let smokeReport = executeSmoke(request: request, artifactDirectory: artifactDirectory)
                let smokeFailure = failure(from: smokeReport)
                let smokeStage = DeviceAiProtocolStageReport(
                    stage: "ios-smoke",
                    status: smokeReport.state == .success ? .pass : .fail,
                    correlationId: smokeReport.correlationId,
                    startedAt: smokeStartedAt,
                    endedAt: iso8601(now()),
                    message: smokeReport.message,
                    retryable: smokeReport.state == .errorRetryable
                )
                return (
                    DeviceAiProtocolRunReport(
                        generatedAt: generatedAt,
                        correlationId: request.correlationId,
                        state: smokeReport.state,
                        message: smokeReport.state == .success
                            ? "Device AI model verified and iOS smoke flow passed."
                            : smokeReport.message,
                        request: request,
                        artifact: DeviceAiProtocolArtifact(
                            path: outcome.artifactURL.path,
                            sha256: outcome.sha256,
                            sizeBytes: outcome.sizeBytes
                        ),
                        model: resolvedModel,
                        failure: smokeFailure,
                        stages: [downloadStage, smokeStage]
                    ),
                    artifactDirectory
                )
            case .failure(let error):
                let failure = DeviceAiProtocolFailure(
                    stage: .download,
                    code: error.code.rawValue,
                    message: error.message,
                    retryable: error.retryable,
                    correlationId: error.correlationId
                )
                return (
                    DeviceAiProtocolRunReport(
                        generatedAt: generatedAt,
                        correlationId: request.correlationId,
                        state: error.flowState,
                        message: error.message,
                        request: request,
                        artifact: nil,
                        model: resolvedModel,
                        failure: failure,
                        stages: [
                            DeviceAiProtocolStageReport(
                                stage: "ios-stage",
                                status: .fail,
                                correlationId: error.correlationId,
                                startedAt: downloadStartedAt,
                                endedAt: iso8601(now()),
                                message: error.message,
                                retryable: error.retryable
                            ),
                            DeviceAiProtocolStageReport(
                                stage: "ios-smoke",
                                status: .fail,
                                correlationId: error.correlationId,
                                startedAt: iso8601(now()),
                                endedAt: iso8601(now()),
                                message: "Smoke flow skipped because model staging failed.",
                                retryable: false
                            )
                        ]
                    ),
                    artifactDirectory
                )
            }
        }

        let validationStage = DeviceAiProtocolStageReport(
            stage: "ios-validation",
            status: .fail,
            correlationId: request.correlationId,
            startedAt: generatedAt,
            endedAt: generatedAt,
            message: validationFailure.message,
            retryable: false
        )
        return (
            DeviceAiProtocolRunReport(
                generatedAt: generatedAt,
                correlationId: request.correlationId,
                state: .errorNonRetryable,
                message: validationFailure.message,
                request: request,
                artifact: nil,
                model: resolvedModel,
                failure: validationFailure,
                stages: [validationStage]
            ),
            artifactDirectory
        )
    }

    private func persist(_ report: DeviceAiProtocolRunReport, requestedReportFileName: String) -> DeviceAiProtocolRunOutcome {
        let reportDirectory = managedReportDirectoryURL()
        let creationResult = Result {
            if !fileManager.fileExists(atPath: reportDirectory.path) {
                try fileManager.createDirectory(at: reportDirectory, withIntermediateDirectories: true, attributes: nil)
            }
            return reportDirectory
        }
        let resolvedDirectory = creationResult.successValue ?? reportDirectory
        let reportURL = resolvedDirectory.appendingPathComponent(requestedReportFileName, isDirectory: false)
        let latestReportURL = resolvedDirectory.appendingPathComponent(Self.latestReportFileName, isDirectory: false)
        let dataResult = Result { try encoder.encode(report) }
        if let data = dataResult.successValue {
            _ = Result { try data.write(to: reportURL, options: [.atomic]) }
            _ = Result { try data.write(to: latestReportURL, options: [.atomic]) }
        } else if let error = dataResult.failureValue {
            logger.error("device_ai_protocol_encode_failed correlationId=\(report.correlationId, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
        }
        return DeviceAiProtocolRunOutcome(report: report, reportURL: reportURL, latestReportURL: latestReportURL)
    }

    private func executeDownload(
        request: DeviceAiProtocolRequest,
        destinationURL: URL
    ) async -> Result<HuggingFaceModelDownloadOutcome, HuggingFaceModelManagerError> {
        let downloadRequest = HuggingFaceModelDownloadRequest(
            modelRef: request.modelRef,
            fileName: request.fileName,
            revision: request.revision.nonEmpty,
            expectedSha256: request.expectedSha256.nonEmpty,
            token: request.token.nonEmpty,
            correlationId: request.correlationId
        )
        if let injectedDownloadOperation = downloadOperation {
            return injectedDownloadOperation(downloadRequest, destinationURL)
        }

        let manager = HuggingFaceModelManager(
            config: HuggingFaceModelManagerConfig(
                requestTimeoutSeconds: config.requestTimeoutSeconds,
                maxAttempts: config.deviceAiDownloadMaxAttempts
            )
        )
        let task = Task {
            try await manager.downloadAndVerify(
                request: downloadRequest,
                destinationURL: destinationURL
            )
        }
        let result = await task.result
        switch result {
        case .success(let outcome):
            return .success(outcome)
        case .failure(let error as HuggingFaceModelManagerError):
            return .failure(error)
        case .failure:
            return .failure(
                HuggingFaceModelManagerError(
                    code: .transportFailure,
                    message: "Device AI model download failed.",
                    retryable: true,
                    correlationId: request.correlationId
                )
            )
        }
    }

    private func executeSmoke(request: DeviceAiProtocolRequest, artifactDirectory: URL) -> IosDriverReport {
        if let smokeOperation {
            return smokeOperation(request.appId, request.correlationId, artifactDirectory)
        }
        return driverAdapter.execute(
            flow: FlowV1(appId: request.appId, steps: [.launchApp]),
            correlationId: request.correlationId
        )
    }

    private func validationFailure(for request: DeviceAiProtocolRequest) -> DeviceAiProtocolFailure? {
        if request.appId.isEmpty {
            return DeviceAiProtocolFailure(
                stage: .validation,
                code: "IOS_DEVICE_AI_APP_ID_REQUIRED",
                message: "An application identifier is required for the iOS smoke flow.",
                retryable: false,
                correlationId: request.correlationId
            )
        }
        if request.modelRef.isEmpty {
            return DeviceAiProtocolFailure(
                stage: .validation,
                code: HuggingFaceModelManagerErrorCode.invalidModelReference.rawValue,
                message: "The required model reference is invalid.",
                retryable: false,
                correlationId: request.correlationId
            )
        }
        if request.fileName.isEmpty {
            return DeviceAiProtocolFailure(
                stage: .validation,
                code: HuggingFaceModelManagerErrorCode.invalidFileName.rawValue,
                message: "The required model file name is invalid.",
                retryable: false,
                correlationId: request.correlationId
            )
        }
        return nil
    }

    private func failure(from smokeReport: IosDriverReport) -> DeviceAiProtocolFailure? {
        guard smokeReport.state != .success else {
            return nil
        }
        let stepFailure = smokeReport.steps.first?.error
        return DeviceAiProtocolFailure(
            stage: .smoke,
            code: stepFailure?.code ?? "IOS_DEVICE_AI_SMOKE_FAILED",
            message: smokeReport.message,
            retryable: smokeReport.state == .errorRetryable,
            correlationId: smokeReport.correlationId
        )
    }

    private func managedModelDirectoryURL() -> URL {
        config.deviceAiManagedModelDirectory
            .split(separator: "/")
            .reduce(applicationSupportRootURL()) { partialURL, component in
                partialURL.appendingPathComponent(String(component), isDirectory: true)
            }
    }

    private func managedReportDirectoryURL() -> URL {
        config.deviceAiManagedReportDirectory
            .split(separator: "/")
            .reduce(applicationSupportRootURL()) { partialURL, component in
                partialURL.appendingPathComponent(String(component), isDirectory: true)
            }
    }

    private func applicationSupportRootURL() -> URL {
        applicationSupportRootProvider().successValue
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    }

    private func normalizedRequest(_ request: DeviceAiProtocolRequest) -> DeviceAiProtocolRequest {
        DeviceAiProtocolRequest(
            appId: request.appId.trimmed,
            modelRef: request.modelRef.trimmed,
            revision: request.revision.trimmed,
            fileName: request.fileName.trimmed,
            expectedSha256: request.expectedSha256.trimmed,
            token: request.token.trimmed,
            correlationId: request.correlationId.trimmed.nonEmpty ?? UUID().uuidString
        )
    }

    private func resolvedModel(for request: DeviceAiProtocolRequest) -> DeviceAiProtocolResolvedModel? {
        let normalizedRequest = normalizedRequest(request)
        let matchesRequiredModel =
            normalizedRequest.modelRef == config.deviceAiRequiredModelRef
            && normalizedRequest.revision == config.deviceAiRequiredModelRevision
            && normalizedRequest.fileName == config.deviceAiRequiredModelFileName
            && normalizedRequest.expectedSha256.lowercased() == config.deviceAiRequiredModelSha256.lowercased()
        guard matchesRequiredModel else {
            return nil
        }
        return DeviceAiProtocolResolvedModel(
            modelRef: config.deviceAiRequiredModelRef,
            revision: config.deviceAiRequiredModelRevision,
            fileName: config.deviceAiRequiredModelFileName,
            expectedSha256: config.deviceAiRequiredModelSha256,
            capabilities: config.deviceAiRequiredCapabilities
        )
    }

    private func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

private extension Result {
    var successValue: Success? {
        switch self {
        case .success(let success):
            return success
        case .failure:
            return nil
        }
    }

    var failureValue: Failure? {
        switch self {
        case .success:
            return nil
        case .failure(let failure):
            return failure
        }
    }
}

private extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var nonEmpty: String? {
        let value = trimmed
        return value.isEmpty ? nil : value
    }

    var normalizedBoolean: Bool {
        let value = trimmed.lowercased()
        return value == "1" || value == "true" || value == "yes"
    }
}
