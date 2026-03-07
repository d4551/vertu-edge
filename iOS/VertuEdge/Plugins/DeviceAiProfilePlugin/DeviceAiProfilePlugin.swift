import Foundation
import PackagePlugin

@main
struct DeviceAiProfilePlugin: BuildToolPlugin {
  func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
    guard let sourceTarget = target.sourceModule else {
      return []
    }

    let targetDirectory = URL(fileURLWithPath: String(describing: sourceTarget.directory), isDirectory: true)
    let packageDirectory = context.package.directoryURL
    let generatorScriptPath = packageDirectory
      .appending(path: "Plugins", directoryHint: .isDirectory)
      .appending(path: "DeviceAiProfileCodegen", directoryHint: .isDirectory)
      .appending(path: "main.swift", directoryHint: .notDirectory)
    let inputPath = targetDirectory
      .appending(path: "Resources", directoryHint: .isDirectory)
      .appending(path: "device-ai-profile.json", directoryHint: .notDirectory)
    let outputPath = context.pluginWorkDirectoryURL
      .appending(path: "GeneratedDeviceAiProfileDefaults.swift", directoryHint: .notDirectory)
    let moduleCachePath = context.pluginWorkDirectoryURL
      .appending(path: "ModuleCache", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: moduleCachePath, withIntermediateDirectories: true)

    return [
      .buildCommand(
        displayName: "Generating device AI profile defaults",
        executable: URL(fileURLWithPath: "/usr/bin/xcrun", isDirectory: false),
        arguments: [
          "--sdk",
          "macosx",
          "swift",
          "-module-cache-path",
          moduleCachePath.path(),
          generatorScriptPath.path(),
          inputPath.path(),
          outputPath.path(),
        ],
        inputFiles: [generatorScriptPath, inputPath],
        outputFiles: [outputPath]
      ),
    ]
  }
}
