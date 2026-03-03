import Foundation

actor HuggingFaceRepository {
    private let baseURL = "https://huggingface.co/api/"
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func searchModels(query: String) async throws -> [ModelInfo] {
        let searchTerm = query.isEmpty ? "litertlm" : query
        var components = URLComponents(string: "\(baseURL)models")!
        components.queryItems = [
            URLQueryItem(name: "search", value: searchTerm),
            URLQueryItem(name: "filter", value: "litertlm"),
            URLQueryItem(name: "sort", value: "downloads"),
            URLQueryItem(name: "limit", value: "20")
        ]
        guard let url = components.url else { throw URLError(.badURL) }

        let (data, _) = try await session.data(from: url)
        let decoded = try JSONDecoder().decode([HFModelResponse].self, from: data)
        return decoded.map { hf in
            ModelInfo(
                id: hf.id,
                name: hf.modelId ?? hf.id,
                description: hf.tags?.joined(separator: ", ") ?? "LiteRT model",
                sizeStr: nil,
                downloadUrl: "https://huggingface.co/\(hf.id)/resolve/main/model.litertlm",
                tags: hf.tags ?? []
            )
        }
    }

    func downloadModel(
        model: ModelInfo,
        progressHandler: @Sendable @escaping (Float) -> Void
    ) async throws -> String {
        guard let url = URL(string: model.downloadUrl) else { throw URLError(.badURL) }
        let destination = try localPath(for: model)

        if FileManager.default.fileExists(atPath: destination.path) {
            return destination.path
        }

        let (tempURL, response) = try await session.download(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        try FileManager.default.moveItem(at: tempURL, to: destination)
        return destination.path
    }

    private func localPath(for model: ModelInfo) throws -> URL {
        let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let modelsDir = cachesDir.appendingPathComponent("vertu_models")
        try FileManager.default.createDirectory(at: modelsDir, withIntermediateDirectories: true)
        let safeName = model.id.replacingOccurrences(of: "/", with: "_")
        return modelsDir.appendingPathComponent("\(safeName).litertlm")
    }

    func getLocalModels() -> [ModelInfo] {
        let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let modelsDir = cachesDir.appendingPathComponent("vertu_models")
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: modelsDir, includingPropertiesForKeys: [.fileSizeKey]
        ) else { return [] }

        return files.filter { $0.pathExtension == "litertlm" }.map { file in
            let attrs = try? file.resourceValues(forKeys: [.fileSizeKey])
            let size = attrs?.fileSize.map { formatSize($0) }
            let name = file.deletingPathExtension().lastPathComponent
                .replacingOccurrences(of: "_", with: "/")
            return ModelInfo(
                id: name, name: name,
                description: "Local model",
                sizeStr: size,
                downloadUrl: file.path,
                tags: []
            )
        }
    }

    private func formatSize(_ bytes: Int) -> String {
        switch bytes {
        case 1_073_741_824...: return String(format: "%.1f GB", Double(bytes) / 1_073_741_824)
        case 1_048_576...: return String(format: "%.1f MB", Double(bytes) / 1_048_576)
        case 1024...: return String(format: "%.1f KB", Double(bytes) / 1024)
        default: return "\(bytes) B"
        }
    }
}

private struct HFModelResponse: Decodable {
    let id: String
    let modelId: String?
    let tags: [String]?
}
