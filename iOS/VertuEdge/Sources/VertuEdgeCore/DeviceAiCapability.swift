import Foundation

/// Stable device-AI capability identifiers shared with the control-plane contract.
public enum DeviceAiCapability: String, Codable, Equatable, Sendable, CaseIterable {
  case mobileActions = "mobile_actions"
  case rpaControls = "rpa_controls"
  case flowCommands = "flow_commands"
}
