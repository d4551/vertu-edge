import SwiftUI
import VertuEdgeCore
import VertuEdgeDriver
import VertuEdgeUI

@main
struct VertuEdgeHostApp: App {
    @State private var hasStartedDeviceAiBootstrap = false
    private let deviceAiProtocolRunner = DeviceAiProtocolRunner(config: .shared)
    private let runtimeConfig = ControlPlaneRuntimeConfig.shared

    var body: some Scene {
        WindowGroup {
            FlowRunnerView()
                .task {
                    await runDeviceAiBootstrapIfNeeded()
                }
        }
    }

    @MainActor
    private func runDeviceAiBootstrapIfNeeded() async {
        guard !hasStartedDeviceAiBootstrap else {
            return
        }
        hasStartedDeviceAiBootstrap = true
        guard let launchRequest = DeviceAiProtocolRunner.launchRequest(
            environment: ProcessInfo.processInfo.environment,
            config: runtimeConfig,
            defaultAppId: Bundle.main.bundleIdentifier ?? ""
        ) else {
            return
        }
        _ = await deviceAiProtocolRunner.run(request: launchRequest.request)
    }
}
