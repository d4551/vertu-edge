import Foundation

@MainActor
class FlowRunnerViewModel: ObservableObject {
    enum State {
        case idle
        case running
        case success(logs: [String])
        case error(message: String)
    }

    @Published var state: State = .idle
    private let engine = VertuFlowEngine()

    func runFlow(yaml: String) {
        state = .running
        Task {
            let result = await engine.execute(yaml: yaml)
            switch result {
            case .success(let logs):
                state = .success(logs: logs)
            case .error(let message):
                state = .error(message: message)
            }
        }
    }
}
