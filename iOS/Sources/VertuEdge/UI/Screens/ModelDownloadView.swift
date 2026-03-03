import SwiftUI

struct ModelDownloadView: View {
    @StateObject private var viewModel = ModelDownloadViewModel()
    @State private var searchQuery: String = ""

    var body: some View {
        VStack(spacing: 12) {
            TextField("Search HuggingFace models", text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .onChange(of: searchQuery) { _, newValue in
                    viewModel.searchModels(query: newValue)
                }

            switch viewModel.downloadState {
            case .downloading(let modelName, let progress):
                VStack(alignment: .leading) {
                    ProgressView(value: progress)
                        .tint(VertuTheme.gold)
                    Text("Downloading \(modelName)…")
                        .font(VertuTheme.labelStyle())
                        .foregroundColor(VertuTheme.lightGray)
                }
            case .error(let message):
                Text(message).foregroundColor(VertuTheme.error)
            default:
                EmptyView()
            }

            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(viewModel.models) { model in
                        ModelRow(model: model) {
                            viewModel.downloadModel(model)
                        }
                    }
                }
            }
        }
        .padding()
        .navigationTitle("AI Models")
        .background(VertuTheme.black.ignoresSafeArea())
        .onAppear { viewModel.searchModels(query: "") }
    }
}

private struct ModelRow: View {
    let model: ModelInfo
    let onDownload: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.name)
                    .font(VertuTheme.bodyStyle())
                    .foregroundColor(VertuTheme.white)
                Text(model.description)
                    .font(VertuTheme.labelStyle())
                    .foregroundColor(VertuTheme.lightGray)
                if let size = model.sizeStr {
                    Text(size)
                        .font(VertuTheme.labelStyle())
                        .foregroundColor(VertuTheme.goldLight)
                }
            }
            Spacer()
            Button(action: onDownload) {
                Image(systemName: "arrow.down.circle")
                    .foregroundColor(VertuTheme.gold)
                    .font(.title2)
            }
        }
        .padding(12)
        .background(VertuTheme.darkGray)
        .cornerRadius(10)
    }
}
