import Foundation
import Testing
@testable import VertuEdgeCore

private struct CanonicalDeviceAiProfile: Decodable {
    let requiredModelRef: String
    let revision: String
    let requiredModelFile: String
    let requiredModelSha256: String
    let requiredCapabilities: [String]
}

@Suite("ControlPlaneRuntimeConfig")
struct ControlPlaneRuntimeConfigTests {
  @Test("generated device AI defaults match canonical control-plane config")
  func generatedDeviceAiDefaultsMatchCanonicalConfig() throws {
    let testDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let repoRoot = testDirectory
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let profileURL = repoRoot
      .appendingPathComponent("control-plane", isDirectory: true)
      .appendingPathComponent("config", isDirectory: true)
      .appendingPathComponent("device-ai-profile.json", isDirectory: false)

    let profileData = try Data(contentsOf: profileURL)
    let canonicalProfile = try JSONDecoder().decode(CanonicalDeviceAiProfile.self, from: profileData)

    #expect(GeneratedDeviceAiProfileDefaults.requiredModelRef == canonicalProfile.requiredModelRef)
    #expect(GeneratedDeviceAiProfileDefaults.revision == canonicalProfile.revision)
    #expect(GeneratedDeviceAiProfileDefaults.requiredModelFile == canonicalProfile.requiredModelFile)
    #expect(GeneratedDeviceAiProfileDefaults.requiredModelSha256 == canonicalProfile.requiredModelSha256)
    #expect(GeneratedDeviceAiProfileDefaults.requiredCapabilities.map(\.rawValue) == canonicalProfile.requiredCapabilities)
  }
}
