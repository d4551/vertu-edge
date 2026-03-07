import Foundation
import VertuEdgeCore

/// Public error surface for control-plane HTTP calls.
public enum ControlPlaneClientError: Error, LocalizedError {
    case invalidBaseURL(String)
    case invalidEndpoint(String)
    case transport(Error)
    case badStatus(code: Int, body: String)
    case missingEnvelope
    case envelopeDecodeFailure(String)
    case parseFailure(String)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let value):
            "Invalid control-plane base URL: \(value)"
        case .invalidEndpoint(let path):
            "Invalid control-plane endpoint: \(path)"
        case .transport(let error):
            error.localizedDescription
        case .badStatus(let code, let body):
            body.isEmpty ? "Control-plane returned HTTP \(code)" : "Control-plane returned HTTP \(code): \(body)"
        case .missingEnvelope:
            "Control-plane response did not include a serialized envelope."
        case .envelopeDecodeFailure(let reason):
            "Failed to decode control-plane envelope: \(reason)"
        case .parseFailure(let reason):
            "Failed to parse control-plane HTML payload: \(reason)"
        }
    }
}

/// Canonical job states surfaced by `/api/models/pull` in control-plane envelopes.
public enum CapabilityJobState: String, Codable, Sendable {
    case queued
    case running
    case paused
    case succeeded
    case failed
    case cancelled
}

/// Artifact metadata surfaced by capability jobs and flow artifacts.
public struct ControlPlaneArtifactMetadata: Codable, Sendable {
    public let artifactPath: String
    public let sha256: String?
    public let sizeBytes: Int?
    public let createdAt: String?
    public let contentType: String?
    public let signature: String?
    public let correlationId: String?

    public init(
        artifactPath: String,
        sha256: String? = nil,
        sizeBytes: Int? = nil,
        createdAt: String? = nil,
        contentType: String? = nil,
        signature: String? = nil,
        correlationId: String? = nil
    ) {
        self.artifactPath = artifactPath
        self.sha256 = sha256
        self.sizeBytes = sizeBytes
        self.createdAt = createdAt
        self.contentType = contentType
        self.signature = signature
        self.correlationId = correlationId
    }
}

/// Shared parser/job envelope shape used by `/api/models/pull` and `/api/ai/chat`.
public struct ControlPlaneEnvelope<T: Codable & Sendable>: Codable, Sendable {
    public let route: String
    public let state: FlowExecutionState
    public let jobId: String?
    public let artifactPath: String?
    public let artifact: ControlPlaneArtifactMetadata?
    public let attempts: Int?
    public let data: T?
    public let error: ControlPlaneErrorPayload?
    public let mismatches: [String]

    public init(
        route: String,
        state: FlowExecutionState,
        jobId: String?,
        artifactPath: String? = nil,
        artifact: ControlPlaneArtifactMetadata? = nil,
        attempts: Int? = nil,
        data: T?,
        error: ControlPlaneErrorPayload?,
        mismatches: [String] = []
    ) {
        self.route = route
        self.state = state
        self.jobId = jobId
        self.artifactPath = artifactPath
        self.artifact = artifact
        self.attempts = attempts
        self.data = data
        self.error = error
        self.mismatches = mismatches
    }

    private enum CodingKeys: String, CodingKey {
        case route
        case state
        case jobId
        case artifactPath
        case artifact
        case attempts
        case data
        case error
        case mismatches
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let route = try container.decode(String.self, forKey: .route)
        let state = try container.decode(FlowExecutionState.self, forKey: .state)
        let jobId = try container.decodeIfPresent(String.self, forKey: .jobId)
        let artifactPath = try container.decodeIfPresent(String.self, forKey: .artifactPath)
        let artifact = try container.decodeIfPresent(ControlPlaneArtifactMetadata.self, forKey: .artifact)
        let attempts = try container.decodeIfPresent(Int.self, forKey: .attempts)
        let data = try container.decodeIfPresent(T.self, forKey: .data)
        let error = try container.decodeIfPresent(ControlPlaneErrorPayload.self, forKey: .error)
        let mismatches = try container.decodeIfPresent([String].self, forKey: .mismatches) ?? []

        self.init(
            route: route,
            state: state,
            jobId: jobId,
            artifactPath: artifactPath,
            artifact: artifact,
            attempts: attempts,
            data: data,
            error: error,
            mismatches: mismatches
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(route, forKey: .route)
        try container.encode(state, forKey: .state)
        try container.encodeIfPresent(jobId, forKey: .jobId)
        try container.encodeIfPresent(artifactPath, forKey: .artifactPath)
        try container.encodeIfPresent(artifact, forKey: .artifact)
        try container.encodeIfPresent(attempts, forKey: .attempts)
        try container.encodeIfPresent(data, forKey: .data)
        try container.encodeIfPresent(error, forKey: .error)
        try container.encode(mismatches, forKey: .mismatches)
    }
}

/// Control-plane flow-style error payload surfaced for non-success responses.
public struct ControlPlaneErrorPayload: Codable, Equatable, Sendable {
    public let commandIndex: Int?
    public let code: String?
    public let category: String?
    public let command: String?
    public let commandType: String?
    public let reason: String
    public let retryable: Bool
    public let correlationId: String?
    public let surface: String?
    public let resource: String?

    public init(
        commandIndex: Int? = nil,
        code: String? = nil,
        category: String? = nil,
        command: String? = nil,
        commandType: String? = nil,
        reason: String,
        retryable: Bool,
        correlationId: String? = nil,
        surface: String? = nil,
        resource: String? = nil
    ) {
        self.commandIndex = commandIndex
        self.code = code
        self.category = category
        self.command = command
        self.commandType = commandType
        self.reason = reason
        self.retryable = retryable
        self.correlationId = correlationId
        self.surface = surface
        self.resource = resource
    }
}

/// Request payload for `/api/models/pull`.
public struct ModelPullRequest: Codable, Sendable {
    public let modelRef: String?
    public let source: String?
    public let platform: String?
    public let force: Bool?
    public let timeoutMs: Int?
    public let correlationId: String?

    public init(
        modelRef: String?,
        source: String? = nil,
        platform: String? = nil,
        force: Bool? = nil,
        timeoutMs: Int? = nil,
        correlationId: String? = nil
    ) {
        self.modelRef = modelRef
        self.source = source
        self.platform = platform
        self.force = force
        self.timeoutMs = timeoutMs
        self.correlationId = correlationId
    }
}

/// Result row for `/api/models/pull` while loading or terminal.
public struct ModelPullResult: Codable, Sendable {
    public let requestedModelRef: String
    public let normalizedModelRef: String
    public let status: CapabilityJobState
    public let exitCode: Int?
    public let stdout: String
    public let stderr: String
    public let artifactPath: String?
    public let artifact: ControlPlaneArtifactMetadata?
    public let elapsedMs: Int
    public let platform: String?

    public init(
        requestedModelRef: String,
        normalizedModelRef: String,
        status: String,
        exitCode: Int?,
        stdout: String,
        stderr: String,
        artifactPath: String?,
        elapsedMs: Int,
        platform: String? = nil
    ) {
        self.requestedModelRef = requestedModelRef
        self.normalizedModelRef = normalizedModelRef
        self.status = CapabilityJobState(rawValue: status) ?? .failed
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
        self.artifactPath = artifactPath
        self.artifact = nil
        self.elapsedMs = elapsedMs
        self.platform = platform
    }

    public init(
        requestedModelRef: String,
        normalizedModelRef: String,
        status: CapabilityJobState,
        exitCode: Int?,
        stdout: String,
        stderr: String,
        artifactPath: String?,
        artifact: ControlPlaneArtifactMetadata?,
        elapsedMs: Int,
        platform: String? = nil
    ) {
        self.requestedModelRef = requestedModelRef
        self.normalizedModelRef = normalizedModelRef
        self.status = status
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
        self.artifactPath = artifactPath
        self.artifact = artifact
        self.elapsedMs = elapsedMs
        self.platform = platform
    }
}

public typealias ModelPullEnvelope = ControlPlaneEnvelope<ModelPullResult>

/// Request payload for `/api/ai/chat`.
public struct AiChatRequest: Codable, Sendable {
    public let provider: String
    public let model: String?
    public let message: String?
    public let speechInput: AiChatAudioPayload?
    public let requestTts: Bool?
    public let ttsOutputMimeType: String?
    public let ttsVoice: String?
    public let apiKey: String?
    public let baseUrl: String?

    public init(
        provider: String,
        model: String? = nil,
        message: String? = nil,
        speechInput: AiChatAudioPayload? = nil,
        requestTts: Bool? = nil,
        ttsOutputMimeType: String? = nil,
        ttsVoice: String? = nil,
        apiKey: String? = nil,
        baseUrl: String? = nil
    ) {
        self.provider = provider
        self.model = model
        self.message = message
        self.speechInput = speechInput
        self.requestTts = requestTts
        self.ttsOutputMimeType = ttsOutputMimeType
        self.ttsVoice = ttsVoice
        self.apiKey = apiKey
        self.baseUrl = baseUrl
    }
}

/// Speech payload for both STT and TTS API interactions.
public struct AiChatAudioPayload: Codable, Sendable {
    public let mimeType: String
    public let data: String

    public init(mimeType: String, data: String) {
        self.mimeType = mimeType
        self.data = data
    }
}

/// Optional STT transcript metadata from chat responses.
public struct AiChatSpeechResolution: Codable, Sendable {
    public let transcript: String
    public let language: String?

    public init(transcript: String, language: String? = nil) {
        self.transcript = transcript
        self.language = language
    }
}

/// Optional TTS response metadata from chat responses.
public struct AiChatSpeechReply: Codable, Sendable {
    public let mimeType: String
    public let data: String

    public init(mimeType: String, data: String) {
        self.mimeType = mimeType
        self.data = data
    }
}

/// Data row for `/api/ai/chat`.
public struct AiChatResolution: Codable, Sendable {
    public let provider: String
    public let requestedModel: String?
    public let effectiveModel: String
    public let reply: String
    public let speech: AiChatSpeechResolution?
    public let tts: AiChatSpeechReply?

    public init(
        provider: String,
        requestedModel: String?,
        effectiveModel: String,
        reply: String,
        speech: AiChatSpeechResolution? = nil,
        tts: AiChatSpeechReply? = nil
    ) {
        self.provider = provider
        self.requestedModel = requestedModel
        self.effectiveModel = effectiveModel
        self.reply = reply
        self.speech = speech
        self.tts = tts
    }
}

public typealias AiChatEnvelope = ControlPlaneEnvelope<AiChatResolution>

/// Parsed model list projection from `/api/ai/models` HTML response.
public struct AiModelOptions: Sendable {
    public let models: [String]
    public let selectedModel: String?
    public let state: FlowExecutionState
    public let stateMessage: String

    public init(
        models: [String],
        selectedModel: String?,
        state: FlowExecutionState,
        stateMessage: String
    ) {
        self.models = models
        self.selectedModel = selectedModel
        self.state = state
        self.stateMessage = stateMessage
    }
}

/// Parsed provider option from `/api/ai/providers/options` HTML response.
public struct AiProviderOption: Sendable {
    public let value: String

    public init(value: String) {
        self.value = value
    }
}

/// Source descriptor returned by `/api/models/sources`.
public struct ModelSourceDescriptor: Codable, Sendable {
    public let id: String
    public let displayName: String
    public let description: String?
    public let modelRefPlaceholder: String
    public let modelRefHint: String?
    public let modelRefValidation: String
    public let canonicalHost: String?
    public let ramalamaTransportPrefix: String?
    public let aliases: [String]
    public let enforceAllowlist: Bool

    public init(
        id: String,
        displayName: String,
        description: String? = nil,
        modelRefPlaceholder: String,
        modelRefHint: String? = nil,
        modelRefValidation: String,
        canonicalHost: String? = nil,
        ramalamaTransportPrefix: String? = nil,
        aliases: [String] = [],
        enforceAllowlist: Bool
    ) {
        self.id = id
        self.displayName = displayName
        self.description = description
        self.modelRefPlaceholder = modelRefPlaceholder
        self.modelRefHint = modelRefHint
        self.modelRefValidation = modelRefValidation
        self.canonicalHost = canonicalHost
        self.ramalamaTransportPrefix = ramalamaTransportPrefix
        self.aliases = aliases
        self.enforceAllowlist = enforceAllowlist
    }
}

/// Registry payload returned by `/api/models/sources`.
public struct ModelSourceRegistryPayload: Codable, Sendable {
    public let defaultSource: String
    public let sources: [ModelSourceDescriptor]

    public init(defaultSource: String, sources: [ModelSourceDescriptor]) {
        self.defaultSource = defaultSource
        self.sources = sources
    }
}

public typealias ModelSourceRegistryEnvelope = ControlPlaneEnvelope<ModelSourceRegistryPayload>

public extension Array where Element == ModelSourceDescriptor {
    /// Resolve a canonical model source identifier from candidate, fallback, and canonical fallback values.
    func resolveModelSourceId(
        candidate: String,
        fallback: String,
        canonicalFallback: String
    ) -> String {
        let normalizedCandidate = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedCandidate.isEmpty,
           let directMatch = resolveKnownModelSourceId(normalizedCandidate) {
            return directMatch
        }

        let normalizedFallback = fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedFallback.isEmpty,
           let fallbackMatch = resolveKnownModelSourceId(normalizedFallback) {
            return fallbackMatch
        }

        let normalizedCanonicalFallback = canonicalFallback.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedCanonicalFallback.isEmpty,
           let canonicalMatch = resolveKnownModelSourceId(normalizedCanonicalFallback) {
            return canonicalMatch
        }

        if isEmpty {
            return normalizedCanonicalFallback.isEmpty ? normalizedFallback : normalizedCanonicalFallback
        }

        return first(where: { !$0.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })?.id
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty ?? (normalizedCanonicalFallback.isEmpty ? normalizedFallback : normalizedCanonicalFallback)
    }

    /// Resolve a canonical model source identifier from a raw id or alias value.
    func resolveKnownModelSourceId(_ rawSource: String) -> String? {
        let normalizedSource = rawSource.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSource.isEmpty else {
            return nil
        }

        if let directMatch = first(where: { $0.id.caseInsensitiveCompare(normalizedSource) == .orderedSame }) {
            return directMatch.id
        }

        if let aliasMatch = first(where: { source in
            source.aliases.contains { alias in
                alias.caseInsensitiveCompare(normalizedSource) == .orderedSame
            }
        }) {
            return aliasMatch.id
        }

        return nil
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

/// Protocol boundary to keep control-plane transport testable.
public protocol ControlPlaneAPIClient: Sendable {
    func fetchModelSources(baseURL: URL) async throws -> ModelSourceRegistryEnvelope
    func startModelPull(_ request: ModelPullRequest, baseURL: URL) async throws -> ModelPullEnvelope
    func pollModelPull(jobId: String, baseURL: URL) async throws -> ModelPullEnvelope
    func fetchConfiguredProviders(baseURL: URL) async throws -> [String]
    func fetchModels(
        provider: String,
        selectedModel: String?,
        apiKey: String?,
        baseUrl: String?,
        stateId: String?,
        baseURL: URL
    ) async throws -> AiModelOptions
    func sendChat(_ request: AiChatRequest, baseURL: URL) async throws -> AiChatEnvelope
}

/// URLSession-backed control-plane client for iOS parity UI.
public final class URLSessionControlPlaneAPIClient: ControlPlaneAPIClient {
    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()
    private let urlSession: URLSession
    private let requestTimeoutSeconds: TimeInterval

    public init(
        urlSession: URLSession = .shared,
        requestTimeoutSeconds: TimeInterval = ControlPlaneRuntimeConfig.shared.requestTimeoutSeconds
    ) {
        self.urlSession = urlSession
        self.requestTimeoutSeconds = requestTimeoutSeconds
    }

    public func fetchModelSources(baseURL: URL) async throws -> ModelSourceRegistryEnvelope {
        let endpoint = try buildEndpoint(baseURL: baseURL, path: "/api/models/sources")
        let request = URLRequest(url: endpoint)
        let rawBody = try await execute(request)
        return try parseEnvelope(from: rawBody, as: ModelSourceRegistryEnvelope.self)
    }

    public func startModelPull(_ request: ModelPullRequest, baseURL: URL) async throws -> ModelPullEnvelope {
        let endpoint = try buildEndpoint(baseURL: baseURL, path: "/api/models/pull")
        let request = try await makePostRequest(url: endpoint, body: request)
        let rawBody = try await execute(request)
        return try parseEnvelope(from: rawBody, as: ModelPullEnvelope.self)
    }

    public func pollModelPull(jobId: String, baseURL: URL) async throws -> ModelPullEnvelope {
        let endpoint = try buildEndpoint(baseURL: baseURL, path: "/api/models/pull/\(jobId)")
        let request = URLRequest(url: endpoint)
        let rawBody = try await execute(request)
        return try parseEnvelope(from: rawBody, as: ModelPullEnvelope.self)
    }

    public func fetchConfiguredProviders(baseURL: URL) async throws -> [String] {
        let endpoint = try buildEndpoint(baseURL: baseURL, path: "/api/ai/providers/options")
        let request = URLRequest(url: endpoint)
        let rawBody = try await execute(request)
        let values = parseOptionValues(from: rawBody)
        return values.filter { !$0.isEmpty }
    }

    public func fetchModels(
        provider: String,
        selectedModel: String?,
        apiKey: String?,
        baseUrl: String?,
        stateId: String?,
        baseURL: URL
    ) async throws -> AiModelOptions {
        var items: [URLQueryItem] = [URLQueryItem(name: "provider", value: provider)]
        if let selectedModel {
            items.append(URLQueryItem(name: "selectedModel", value: selectedModel))
        }
        if let apiKey, !apiKey.isEmpty {
            items.append(URLQueryItem(name: "apiKey", value: apiKey))
        }
        if let baseUrl, !baseUrl.isEmpty {
            items.append(URLQueryItem(name: "baseUrl", value: baseUrl))
        }
        if let stateId, !stateId.isEmpty {
            items.append(URLQueryItem(name: "stateId", value: stateId))
        } else {
            items.append(
                URLQueryItem(
                    name: "stateId",
                    value: "\(ControlPlaneRuntimeConfig.shared.modelStateIdPrefix)-\(provider.lowercased())"
                )
            )
        }

        let endpoint = try buildEndpoint(baseURL: baseURL, path: "/api/ai/models", query: items)
        let request = URLRequest(url: endpoint)
        let rawBody = try await execute(request)
        return parseModelSelection(
            from: rawBody,
            stateId: stateId ?? "\(ControlPlaneRuntimeConfig.shared.modelStateIdPrefix)-\(provider.lowercased())",
            selectedModel: selectedModel
        )
    }

    public func sendChat(_ requestBody: AiChatRequest, baseURL: URL) async throws -> AiChatEnvelope {
        let endpoint = try buildEndpoint(baseURL: baseURL, path: "/api/ai/chat")
        let request = try await makePostRequest(url: endpoint, body: requestBody)
        let rawBody = try await execute(request)
        return try parseEnvelope(from: rawBody, as: AiChatEnvelope.self)
    }

    private func buildEndpoint(baseURL: URL, path: String, query: [URLQueryItem]? = nil) throws -> URL {
        guard baseURL.scheme != nil, baseURL.host != nil else {
            throw ControlPlaneClientError.invalidBaseURL(baseURL.absoluteString)
        }
        let normalizedBase = baseURL.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = normalizedBase.hasSuffix("/") ? String(normalizedBase.dropLast()) : normalizedBase
        let route = path.hasPrefix("/") ? path : "/\(path)"
        guard let url = URL(string: "\(base)\(route)") else {
            throw ControlPlaneClientError.invalidEndpoint(path)
        }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw ControlPlaneClientError.invalidEndpoint(path)
        }
        components.queryItems = query
        guard let resolved = components.url else {
            throw ControlPlaneClientError.invalidEndpoint(path)
        }
        return resolved
    }

    private func makePostRequest<T: Encodable>(url: URL, body: T) async throws -> URLRequest {
        let encoded: Data
        do {
            encoded = try Self.encoder.encode(body)
        } catch {
            throw ControlPlaneClientError.transport(error)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = encoded
        request.timeoutInterval = requestTimeoutSeconds
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func execute(_ request: URLRequest) async throws -> String {
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw ControlPlaneClientError.parseFailure("Non-HTTP response from control-plane.")
            }
            let body = String(decoding: data, as: UTF8.self)
            guard (200 ... 299).contains(http.statusCode) else {
                throw ControlPlaneClientError.badStatus(code: http.statusCode, body: body)
            }
            return body
        } catch let error as ControlPlaneClientError {
            throw error
        } catch {
            throw ControlPlaneClientError.transport(error)
        }
    }

    private func parseEnvelope<T: Decodable>(from html: String, as type: T.Type) throws -> T {
        let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
        if let json = trimmed.data(using: .utf8), (json as Data).starts(with: Data("{".utf8)) {
            do {
                return try Self.decoder.decode(T.self, from: json)
            } catch {
                throw ControlPlaneClientError.envelopeDecodeFailure(error.localizedDescription)
            }
        }
        let regex = try NSRegularExpression(pattern: #"<section\b[^>]*\bdata-envelope=\"([^\"]+)\""#)
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        guard let match = regex.firstMatch(in: html, range: range),
              let valueRange = Range(match.range(at: 1), in: html) else {
            throw ControlPlaneClientError.missingEnvelope
        }
        let raw = String(html[valueRange])
        let json = unescapeHtmlEntities(raw)
        guard let jsonData = json.data(using: .utf8) else {
            throw ControlPlaneClientError.envelopeDecodeFailure("Body is not valid UTF8.")
        }
        do {
            return try Self.decoder.decode(T.self, from: jsonData)
        } catch {
            throw ControlPlaneClientError.envelopeDecodeFailure(error.localizedDescription)
        }
    }

    private func parseModelSelection(
        from html: String,
        stateId: String,
        selectedModel: String?
    ) -> AiModelOptions {
        let parsedOptions = parseModelOptions(from: html)
        let stateAndMessage = parseStateMessage(html: html, stateId: stateId)
        let normalizedFallback = selectedModel?.trimmingCharacters(in: .whitespacesAndNewlines)

        let resolvedModel: String?
        if let selectedModelFromMarkup = parsedOptions.first(where: { $0.isSelected })?.value {
            resolvedModel = selectedModelFromMarkup
        } else if
            let fallback = normalizedFallback,
            parsedOptions.contains(where: { $0.value == fallback }) {
            resolvedModel = fallback
        } else {
            resolvedModel = parsedOptions.first?.value
        }

        return AiModelOptions(
            models: parsedOptions.map(\.value),
            selectedModel: resolvedModel,
            state: stateAndMessage.state,
            stateMessage: stateAndMessage.message
        )
    }

    private func parseStateMessage(html: String, stateId: String) -> (state: FlowExecutionState, message: String) {
        let escapedStateId = NSRegularExpression.escapedPattern(for: stateId)
        let statePattern = "<div[^>]*id=\"\(escapedStateId)\"[^>]*data-state=\"([^\"]+)\"[^>]*>(.*?)</div>"
        guard let regex = try? NSRegularExpression(pattern: statePattern, options: [.dotMatchesLineSeparators]) else {
            return (.errorNonRetryable, "Failed to parse control-plane state block.")
        }
        let fullRange = NSRange(html.startIndex..<html.endIndex, in: html)
        guard let match = regex.firstMatch(in: html, range: fullRange),
              let stateRange = Range(match.range(at: 1), in: html),
              let messageRange = Range(match.range(at: 2), in: html) else {
            return (.errorNonRetryable, "No model-selection state found for provider response.")
        }
        let stateValue = String(html[stateRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        let parsedState = FlowExecutionState(rawValue: stateValue) ?? .errorNonRetryable
        let rawMessage = String(html[messageRange])
        let message = stripHtml(String(rawMessage)).trimmingCharacters(in: .whitespacesAndNewlines)
        return (parsedState, message.isEmpty ? "No status message" : message)
    }

    private struct ParsedOption {
        let value: String
        let isSelected: Bool
    }

    private func parseOptionValues(from html: String) -> [String] {
        parseSelectOptions(from: html).map(\.value)
    }

    private func parseModelOptions(from html: String) -> [ParsedOption] {
        parseSelectOptions(from: html)
    }

    private func parseSelectOptions(from html: String) -> [ParsedOption] {
        guard let optionTagRegex = try? NSRegularExpression(
            pattern: #"<option\b[^>]*>.*?</option>"#,
            options: [.caseInsensitive, .dotMatchesLineSeparators]
        ) else {
            return []
        }
        guard let valueRegex = try? NSRegularExpression(
            pattern: #"\bvalue="([^"]*)""#,
            options: [.caseInsensitive]
        ) else {
            return []
        }
        guard let selectedRegex = try? NSRegularExpression(
            pattern: #"\bselected\b"#,
            options: [.caseInsensitive]
        ) else {
            return []
        }

        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        let matches = optionTagRegex.matches(in: html, range: range)
        var parsed: [ParsedOption] = []
        for match in matches {
            guard let htmlRange = Range(match.range(at: 0), in: html) else {
                continue
            }
            let optionHtml = String(html[htmlRange])
            let optionRange = NSRange(optionHtml.startIndex..<optionHtml.endIndex, in: optionHtml)
            guard let valueMatch = valueRegex.firstMatch(in: optionHtml, range: optionRange),
                  let valueRange = Range(valueMatch.range(at: 1), in: optionHtml) else {
                continue
            }
            let rawValue = String(optionHtml[valueRange]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = unescapeHtmlEntities(rawValue)
            guard !value.isEmpty else {
                continue
            }
            let isSelected = selectedRegex.firstMatch(in: optionHtml, range: optionRange) != nil
            parsed.append(ParsedOption(value: value, isSelected: isSelected))
        }

        var deduped: [ParsedOption] = []
        var seen: Set<String> = []
        for option in parsed where seen.insert(option.value.lowercased()).inserted {
            deduped.append(option)
        }
        return deduped
    }
}

private extension URLSessionControlPlaneAPIClient {
    func unescapeHtmlEntities(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    func stripHtml(_ text: String) -> String {
        let result = text.replacingOccurrences(of: "<br/>", with: " ")
        guard let regex = try? NSRegularExpression(pattern: #"<[^>]+>"#, options: []) else {
            return result
        }
        let range = NSRange(result.startIndex..<result.endIndex, in: result)
        return regex.stringByReplacingMatches(in: result, options: [], range: range, withTemplate: "")
    }
}
