import Foundation

private struct DeviceAiProfileInput: Decodable {
  let requiredModelRef: String
  let revision: String
  let requiredModelFile: String
  let requiredModelSha256: String
  let requiredCapabilities: [String]
}

private enum DeviceAiProfileCodegenError: Error {
  case invalidArguments
  case invalidCapability(String)
  case missingCapabilities
}

private func swiftLiteral(_ value: String) -> String {
  var escaped = value
  escaped = escaped.replacingOccurrences(of: "\\", with: "\\\\")
  escaped = escaped.replacingOccurrences(of: "\"", with: "\\\"")
  escaped = escaped.replacingOccurrences(of: "\n", with: "\\n")
  escaped = escaped.replacingOccurrences(of: "\r", with: "\\r")
  escaped = escaped.replacingOccurrences(of: "\t", with: "\\t")
  return "\"\(escaped)\""
}

private func capabilityCaseLiteral(_ capability: String) throws -> String {
  switch capability {
  case "mobile_actions":
    return ".mobileActions"
  case "rpa_controls":
    return ".rpaControls"
  case "flow_commands":
    return ".flowCommands"
  default:
    throw DeviceAiProfileCodegenError.invalidCapability(capability)
  }
}

private func capabilityArrayLiteral(from capabilities: [String]) throws -> String {
  let deduped = capabilities.reduce(into: [String]()) { values, capability in
    if !values.contains(capability) {
      values.append(capability)
    }
  }
  guard !deduped.isEmpty else {
    throw DeviceAiProfileCodegenError.missingCapabilities
  }
  let literals = try deduped.map(capabilityCaseLiteral)
  return "[\(literals.joined(separator: ", "))]"
}

private func generateSwiftSource(from profile: DeviceAiProfileInput) throws -> String {
  let requiredCapabilitiesLiteral = try capabilityArrayLiteral(from: profile.requiredCapabilities)
  return """
  import Foundation

  enum GeneratedDeviceAiProfileDefaults {
    static let requiredModelRef = \(swiftLiteral(profile.requiredModelRef))
    static let revision = \(swiftLiteral(profile.revision))
    static let requiredModelFile = \(swiftLiteral(profile.requiredModelFile))
    static let requiredModelSha256 = \(swiftLiteral(profile.requiredModelSha256))
    static let requiredCapabilities: [DeviceAiCapability] = \(requiredCapabilitiesLiteral)
  }
  """
}

do {
  let arguments = Array(CommandLine.arguments.dropFirst())
  guard arguments.count == 2 else {
    throw DeviceAiProfileCodegenError.invalidArguments
  }

  let inputURL = URL(fileURLWithPath: arguments[0], isDirectory: false)
  let outputURL = URL(fileURLWithPath: arguments[1], isDirectory: false)
  let inputData = try Data(contentsOf: inputURL)
  let profile = try JSONDecoder().decode(DeviceAiProfileInput.self, from: inputData)
  let generatedSource = try generateSwiftSource(from: profile)
  try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try generatedSource.write(to: outputURL, atomically: true, encoding: .utf8)
} catch {
  FileHandle.standardError.write(Data("device-ai-profile-codegen failed: \(error)\n".utf8))
  exit(1)
}
