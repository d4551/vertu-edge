import CryptoKit
import Foundation
import VertuEdgeCore

/// Stable error codes returned by `HuggingFaceModelManager`.
public enum HuggingFaceModelManagerErrorCode: String, Codable, Sendable {
  case invalidModelReference = "INVALID_MODEL_REFERENCE"
  case invalidFileName = "INVALID_FILE_NAME"
  case unauthorized = "HF_UNAUTHORIZED"
  case invalidRevision = "HF_INVALID_REVISION"
  case notFound = "HF_MODEL_NOT_FOUND"
  case badStatus = "HF_BAD_STATUS"
  case checksumMismatch = "HF_CHECKSUM_MISMATCH"
  case ioFailure = "HF_IO_FAILURE"
  case transportFailure = "HF_TRANSPORT_FAILURE"
}

/// Typed error envelope for Hugging Face downloads with deterministic retryability.
public struct HuggingFaceModelManagerError: Error, LocalizedError, Sendable {
  /// Stable code used for logs and deterministic UI state mapping.
  public let code: HuggingFaceModelManagerErrorCode

  /// Human-readable summary.
  public let message: String

  /// Whether this failure should be retried.
  public let retryable: Bool

  /// Correlation id for traceability.
  public let correlationId: String

  /// Optional HTTP status code when the failure originated from an HTTP response.
  public let statusCode: Int?

  public init(
    code: HuggingFaceModelManagerErrorCode,
    message: String,
    retryable: Bool,
    correlationId: String,
    statusCode: Int? = nil
  ) {
    self.code = code
    self.message = message
    self.retryable = retryable
    self.correlationId = correlationId
    self.statusCode = statusCode
  }

  public var errorDescription: String? {
    message
  }

  /// Maps download failures to canonical flow UI state semantics.
  public var flowState: FlowExecutionState {
    if code == .unauthorized {
      return .unauthorized
    }
    return retryable ? .errorRetryable : .errorNonRetryable
  }
}

/// Download request payload for one model artifact.
public struct HuggingFaceModelDownloadRequest: Sendable {
  /// Model reference in `owner/repo`, `huggingface.co/owner/repo`, or full URL format.
  public let modelRef: String

  /// Model file to fetch from the model repository.
  public let fileName: String

  /// Optional revision pin (branch/tag/commit). Defaults to `main` when empty.
  public let revision: String?

  /// Optional expected SHA-256 digest for integrity verification.
  public let expectedSha256: String?

  /// Optional API token for gated/private models.
  public let token: String?

  /// Per-request correlation id used for logs and errors.
  public let correlationId: String

  public init(
    modelRef: String,
    fileName: String,
    revision: String? = nil,
    expectedSha256: String? = nil,
    token: String? = nil,
    correlationId: String
  ) {
    self.modelRef = modelRef
    self.fileName = fileName
    self.revision = revision
    self.expectedSha256 = expectedSha256
    self.token = token
    self.correlationId = correlationId
  }
}

/// Successful model download metadata.
public struct HuggingFaceModelDownloadOutcome: Sendable {
  /// Final artifact path in managed model storage.
  public let artifactURL: URL

  /// SHA-256 digest of the final artifact.
  public let sha256: String

  /// File size in bytes.
  public let sizeBytes: Int64

  /// Request correlation id.
  public let correlationId: String

  public init(artifactURL: URL, sha256: String, sizeBytes: Int64, correlationId: String) {
    self.artifactURL = artifactURL
    self.sha256 = sha256
    self.sizeBytes = sizeBytes
    self.correlationId = correlationId
  }
}

/// Runtime settings for Hugging Face model downloads.
public struct HuggingFaceModelManagerConfig: Sendable {
  /// Base endpoint for model downloads.
  public let baseURL: URL

  /// Per-request timeout in seconds.
  public let requestTimeoutSeconds: TimeInterval

  /// Maximum number of attempts, including the first attempt.
  public let maxAttempts: Int

  /// Initial retry backoff in milliseconds.
  public let initialBackoffMs: UInt64

  /// Maximum retry backoff in milliseconds.
  public let maxBackoffMs: UInt64

  public init(
    baseURL: URL = URL(string: "https://huggingface.co")!,
    requestTimeoutSeconds: TimeInterval = 30,
    maxAttempts: Int = 3,
    initialBackoffMs: UInt64 = 500,
    maxBackoffMs: UInt64 = 4_000
  ) {
    self.baseURL = baseURL
    self.requestTimeoutSeconds = max(1, requestTimeoutSeconds)
    self.maxAttempts = max(1, maxAttempts)
    self.initialBackoffMs = max(1, initialBackoffMs)
    self.maxBackoffMs = max(self.initialBackoffMs, maxBackoffMs)
  }
}

/// Network client abstraction to support deterministic tests.
public protocol HuggingFaceNetworking: Sendable {
  /// Execute one HTTP request and return raw bytes + HTTP metadata.
  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// URLSession-backed default implementation for `HuggingFaceNetworking`.
public struct URLSessionHuggingFaceNetworking: HuggingFaceNetworking, @unchecked Sendable {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw URLError(.badServerResponse)
    }
    return (data, httpResponse)
  }
}

/// Downloads and verifies Hugging Face model files with resumable range requests.
public final class HuggingFaceModelManager: @unchecked Sendable {
  private let config: HuggingFaceModelManagerConfig
  private let networking: HuggingFaceNetworking
  private let fileManager: FileManager

  public init(
    config: HuggingFaceModelManagerConfig = HuggingFaceModelManagerConfig(),
    networking: HuggingFaceNetworking = URLSessionHuggingFaceNetworking(),
    fileManager: FileManager = .default
  ) {
    self.config = config
    self.networking = networking
    self.fileManager = fileManager
  }

  /// Downloads one model artifact to `destinationURL`, verifies checksum, and returns metadata.
  public func downloadAndVerify(
    request: HuggingFaceModelDownloadRequest,
    destinationURL: URL
  ) async throws -> HuggingFaceModelDownloadOutcome {
    let resolvedFileName = request.fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !resolvedFileName.isEmpty else {
      throw HuggingFaceModelManagerError(
        code: .invalidFileName,
        message: "Model file name is required.",
        retryable: false,
        correlationId: request.correlationId
      )
    }

    let tempURL = destinationURL.appendingPathExtension("part")
    var backoffMs = config.initialBackoffMs
    var lastError: HuggingFaceModelManagerError?

    for attempt in 1...config.maxAttempts {
      do {
        return try await downloadAttempt(
          request: request,
          destinationURL: destinationURL,
          tempURL: tempURL
        )
      } catch is CancellationError {
        throw CancellationError()
      } catch let typedError as HuggingFaceModelManagerError {
        lastError = typedError
        if !typedError.retryable || attempt >= config.maxAttempts {
          throw typedError
        }
      } catch {
        let mapped = mapTransportError(error, correlationId: request.correlationId)
        lastError = mapped
        if !mapped.retryable || attempt >= config.maxAttempts {
          throw mapped
        }
      }

      try await Task.sleep(nanoseconds: backoffMs * 1_000_000)
      backoffMs = min(config.maxBackoffMs, backoffMs * 2)
    }

    throw lastError
      ?? HuggingFaceModelManagerError(
        code: .transportFailure,
        message: "Model download failed after retry budget was exhausted.",
        retryable: false,
        correlationId: request.correlationId
      )
  }

  private func downloadAttempt(
    request: HuggingFaceModelDownloadRequest,
    destinationURL: URL,
    tempURL: URL
  ) async throws -> HuggingFaceModelDownloadOutcome {
    let resolvedFileName = request.fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    let downloadURL = try resolveDownloadURL(
      modelRef: request.modelRef,
      fileName: resolvedFileName,
      revision: request.revision
    )

    let tempDir = tempURL.deletingLastPathComponent()
    try createDirectoryIfNeeded(tempDir)
    try createDirectoryIfNeeded(destinationURL.deletingLastPathComponent())

    let existingBytes = fileSize(for: tempURL)
    var urlRequest = URLRequest(url: downloadURL)
    urlRequest.httpMethod = "GET"
    urlRequest.timeoutInterval = config.requestTimeoutSeconds
    urlRequest.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
    if let token = request.token?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty {
      urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    if existingBytes > 0 {
      urlRequest.setValue("bytes=\(existingBytes)-", forHTTPHeaderField: "Range")
    }

    let (data, response) = try await networking.data(for: urlRequest)
    try validateStatus(
      response.statusCode,
      correlationId: request.correlationId,
      revision: request.revision
    )

    let shouldRestartFromScratch = existingBytes > 0 && response.statusCode == 200
    if shouldRestartFromScratch {
      try removeFileIfNeeded(tempURL)
      try writeData(data, to: tempURL, append: false)
    } else {
      try writeData(data, to: tempURL, append: existingBytes > 0)
    }

    let digest = try computeSha256(for: tempURL)
    if let expected = request.expectedSha256?.trimmingCharacters(in: .whitespacesAndNewlines),
       !expected.isEmpty,
       digest.caseInsensitiveCompare(expected) != .orderedSame {
      throw HuggingFaceModelManagerError(
        code: .checksumMismatch,
        message: "Checksum mismatch for \(resolvedFileName). Expected \(expected), got \(digest).",
        retryable: false,
        correlationId: request.correlationId
      )
    }

    try removeFileIfNeeded(destinationURL)
    do {
      try fileManager.moveItem(at: tempURL, to: destinationURL)
    } catch {
      throw HuggingFaceModelManagerError(
        code: .ioFailure,
        message: "Failed to move model artifact into managed storage: \(error.localizedDescription)",
        retryable: false,
        correlationId: request.correlationId
      )
    }

    return HuggingFaceModelDownloadOutcome(
      artifactURL: destinationURL,
      sha256: digest,
      sizeBytes: fileSize(for: destinationURL),
      correlationId: request.correlationId
    )
  }

  private func resolveDownloadURL(
    modelRef: String,
    fileName: String,
    revision: String?
  ) throws -> URL {
    guard let repoId = normalizeRepoId(modelRef) else {
      throw HuggingFaceModelManagerError(
        code: .invalidModelReference,
        message: "Model reference must be `owner/repo` or a Hugging Face URL.",
        retryable: false,
        correlationId: "n/a"
      )
    }
    let resolvedRevision = revision?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? revision!.trimmingCharacters(in: .whitespacesAndNewlines)
      : "main"
    let encodedRepo = repoId
      .split(separator: "/")
      .map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
      .joined(separator: "/")
    let encodedRevision = resolvedRevision.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? resolvedRevision
    let encodedFileName = fileName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileName

    let base = config.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let raw = "\(base)/\(encodedRepo)/resolve/\(encodedRevision)/\(encodedFileName)?download=true"
    guard let url = URL(string: raw) else {
      throw HuggingFaceModelManagerError(
        code: .invalidModelReference,
        message: "Unable to build a Hugging Face download URL from the provided model reference.",
        retryable: false,
        correlationId: "n/a"
      )
    }
    return url
  }

  private func normalizeRepoId(_ rawRef: String) -> String? {
    let trimmed = rawRef.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return nil
    }

    if let url = URL(string: trimmed), let host = url.host, host.contains("huggingface.co") {
      let segments = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
      guard segments.count >= 2 else {
        return nil
      }
      return "\(segments[0])/\(segments[1])"
    }

    let withoutHost = trimmed.replacingOccurrences(of: "huggingface.co/", with: "")
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let components = withoutHost.split(separator: "/").map(String.init)
    guard components.count >= 2 else {
      return nil
    }
    return "\(components[0])/\(components[1])"
  }

  private func validateStatus(
    _ statusCode: Int,
    correlationId: String,
    revision: String?
  ) throws {
    if statusCode == 200 || statusCode == 206 {
      return
    }
    if statusCode == 401 || statusCode == 403 {
      throw HuggingFaceModelManagerError(
        code: .unauthorized,
        message: "Hugging Face authorization failed (\(statusCode)).",
        retryable: false,
        correlationId: correlationId,
        statusCode: statusCode
      )
    }
    if statusCode == 404 {
      let invalidRevision = (revision?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
      throw HuggingFaceModelManagerError(
        code: invalidRevision ? .invalidRevision : .notFound,
        message: invalidRevision
          ? "Requested model revision was not found."
          : "Requested model artifact was not found.",
        retryable: false,
        correlationId: correlationId,
        statusCode: statusCode
      )
    }
    if statusCode == 408 || statusCode == 429 || statusCode >= 500 {
      throw HuggingFaceModelManagerError(
        code: .badStatus,
        message: "Retryable Hugging Face response status: \(statusCode).",
        retryable: true,
        correlationId: correlationId,
        statusCode: statusCode
      )
    }
    throw HuggingFaceModelManagerError(
      code: .badStatus,
      message: "Unexpected Hugging Face response status: \(statusCode).",
      retryable: false,
      correlationId: correlationId,
      statusCode: statusCode
    )
  }

  private func mapTransportError(_ error: Error, correlationId: String) -> HuggingFaceModelManagerError {
    if let urlError = error as? URLError {
      let retryableCodes: Set<URLError.Code> = [
        .networkConnectionLost,
        .notConnectedToInternet,
        .timedOut,
        .cannotConnectToHost,
        .cannotFindHost,
        .dnsLookupFailed,
        .resourceUnavailable,
      ]
      return HuggingFaceModelManagerError(
        code: .transportFailure,
        message: urlError.localizedDescription,
        retryable: retryableCodes.contains(urlError.code),
        correlationId: correlationId
      )
    }
    return HuggingFaceModelManagerError(
      code: .transportFailure,
      message: error.localizedDescription,
      retryable: true,
      correlationId: correlationId
    )
  }

  private func writeData(_ data: Data, to url: URL, append: Bool) throws {
    if append {
      if !fileManager.fileExists(atPath: url.path) {
        fileManager.createFile(atPath: url.path, contents: nil)
      }
      guard let handle = try? FileHandle(forWritingTo: url) else {
        throw HuggingFaceModelManagerError(
          code: .ioFailure,
          message: "Unable to open file for appending at \(url.path).",
          retryable: false,
          correlationId: "n/a"
        )
      }
      defer {
        try? handle.close()
      }
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
      return
    }

    do {
      try data.write(to: url, options: .atomic)
    } catch {
      throw HuggingFaceModelManagerError(
        code: .ioFailure,
        message: "Failed writing model download data to disk: \(error.localizedDescription)",
        retryable: false,
        correlationId: "n/a"
      )
    }
  }

  private func createDirectoryIfNeeded(_ directoryURL: URL) throws {
    guard !directoryURL.path.isEmpty else {
      return
    }
    if fileManager.fileExists(atPath: directoryURL.path) {
      return
    }
    do {
      try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    } catch {
      throw HuggingFaceModelManagerError(
        code: .ioFailure,
        message: "Failed creating managed model directory: \(error.localizedDescription)",
        retryable: false,
        correlationId: "n/a"
      )
    }
  }

  private func removeFileIfNeeded(_ url: URL) throws {
    if fileManager.fileExists(atPath: url.path) {
      do {
        try fileManager.removeItem(at: url)
      } catch {
        throw HuggingFaceModelManagerError(
          code: .ioFailure,
          message: "Failed removing stale file at \(url.path): \(error.localizedDescription)",
          retryable: false,
          correlationId: "n/a"
        )
      }
    }
  }

  private func fileSize(for url: URL) -> Int64 {
    guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
          let size = values.fileSize else {
      return 0
    }
    return Int64(size)
  }

  private func computeSha256(for fileURL: URL) throws -> String {
    guard let stream = InputStream(url: fileURL) else {
      throw HuggingFaceModelManagerError(
        code: .ioFailure,
        message: "Unable to read downloaded model file for checksum validation.",
        retryable: false,
        correlationId: "n/a"
      )
    }
    stream.open()
    defer {
      stream.close()
    }

    var hasher = SHA256()
    let bufferSize = 64 * 1024
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: bufferSize)
      if count < 0 {
        throw HuggingFaceModelManagerError(
          code: .ioFailure,
          message: "Failed while reading downloaded model bytes for checksum.",
          retryable: false,
          correlationId: "n/a"
        )
      }
      if count == 0 {
        break
      }
      hasher.update(data: Data(buffer[0..<count]))
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}
