import Foundation

@MainActor
class ModelDownloadViewModel: ObservableObject {
    @Published var models: [ModelInfo] = []
    @Published var downloadState: DownloadState = .idle

    private let repository = HuggingFaceRepository()

    func searchModels(query: String) {
        Task {
            do {
                let results = try await repository.searchModels(query: query)
                models = results + (await repository.getLocalModels())
            } catch {
                models = await repository.getLocalModels()
            }
        }
    }

    func downloadModel(_ model: ModelInfo) {
        downloadState = .downloading(modelName: model.name, progress: 0)
        Task {
            do {
                let path = try await repository.downloadModel(model: model) { progress in
                    Task { @MainActor in
                        self.downloadState = .downloading(modelName: model.name, progress: progress)
                    }
                }
                downloadState = .completed(modelName: model.name, localPath: path)
            } catch {
                downloadState = .error(message: error.localizedDescription)
            }
        }
    }
}
