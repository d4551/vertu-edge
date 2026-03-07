import CryptoKit
import Foundation
import Testing
@testable import VertuEdgeDriver

private actor RequestRecorder {
  private var recordedRequest: URLRequest?

  func record(_ request: URLRequest) {
    recordedRequest = request
  }

  func value() -> URLRequest? {
    recordedRequest
  }
}

private struct MockHuggingFaceNetworking: HuggingFaceNetworking {
  let recorder: RequestRecorder
  let responseData: Data

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    await recorder.record(request)
    let response = HTTPURLResponse(
      url: request.url ?? URL(string: "https://huggingface.co")!,
      statusCode: 200,
      httpVersion: nil,
      headerFields: nil
    )!
    return (responseData, response)
  }
}

@Suite("HuggingFaceModelManager")
struct HuggingFaceModelManagerTests {
  @Test("downloadAndVerify writes the artifact and preserves revision + auth headers")
  func downloadAndVerifySucceeds() async throws {
    let data = Data("device-ai-model".utf8)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let recorder = RequestRecorder()
    let manager = HuggingFaceModelManager(
      config: HuggingFaceModelManagerConfig(maxAttempts: 1),
      networking: MockHuggingFaceNetworking(recorder: recorder, responseData: data)
    )

    let destinationDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)
    let destinationURL = destinationDirectory.appendingPathComponent("AutoGLM.gguf")

    let outcome = try await manager.downloadAndVerify(
      request: HuggingFaceModelDownloadRequest(
        modelRef: "huggingface.co/example/AutoGLM-Phone-9B-Multilingual",
        fileName: "AutoGLM.gguf",
        revision: "rev-123",
        expectedSha256: digest,
        token: "hf_test_token",
        correlationId: "corr-1"
      ),
      destinationURL: destinationURL
    )

    #expect(outcome.artifactURL.path == destinationURL.path)
    #expect(outcome.sha256 == digest)
    #expect(outcome.sizeBytes == Int64(data.count))

    let request = await recorder.value()
    #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer hf_test_token")
    #expect(request?.url?.absoluteString.contains("/example/AutoGLM-Phone-9B-Multilingual/resolve/rev-123/AutoGLM.gguf?download=true") == true)
  }

  @Test("downloadAndVerify returns checksum mismatch as non-retryable")
  func downloadAndVerifyChecksumMismatch() async throws {
    let manager = HuggingFaceModelManager(
      config: HuggingFaceModelManagerConfig(maxAttempts: 1),
      networking: MockHuggingFaceNetworking(
        recorder: RequestRecorder(),
        responseData: Data("wrong-bytes".utf8)
      )
    )
    let destinationDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)
    let destinationURL = destinationDirectory.appendingPathComponent("AutoGLM.gguf")

    let task = Task {
      try await manager.downloadAndVerify(
        request: HuggingFaceModelDownloadRequest(
          modelRef: "example/model",
          fileName: "AutoGLM.gguf",
          expectedSha256: "deadbeef",
          correlationId: "corr-2"
        ),
        destinationURL: destinationURL
      )
    }
    let result = await task.result

    switch result {
    case .success:
      Issue.record("Expected checksum mismatch failure")
    case .failure(let error):
      guard let typedError = error as? HuggingFaceModelManagerError else {
        Issue.record("Expected HuggingFaceModelManagerError, got \(error)")
        return
      }
      #expect(typedError.code == .checksumMismatch)
      #expect(typedError.retryable == false)
    }
  }
}
