import Foundation

struct ModelInfo: Identifiable {
    let id: String
    let name: String
    let description: String
    let sizeStr: String?
    let downloadUrl: String
    let tags: [String]
}

enum DownloadState {
    case idle
    case downloading(modelName: String, progress: Float)
    case completed(modelName: String, localPath: String)
    case error(message: String)
}
