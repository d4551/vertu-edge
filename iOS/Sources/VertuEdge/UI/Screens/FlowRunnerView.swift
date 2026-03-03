import SwiftUI

struct FlowRunnerView: View {
    @StateObject private var viewModel = FlowRunnerViewModel()
    @State private var flowYaml: String = ""

    var body: some View {
        VStack(spacing: 16) {
            TextEditor(text: $flowYaml)
                .font(.system(.body, design: .monospaced))
                .frame(maxHeight: 300)
                .padding(8)
                .background(VertuTheme.darkGray)
                .cornerRadius(8)
                .foregroundColor(VertuTheme.white)

            switch viewModel.state {
            case .idle:
                EmptyView()
            case .running:
                ProgressView("Running flow…")
                    .tint(VertuTheme.gold)
            case .success(let logs):
                Text("Flow completed successfully")
                    .foregroundColor(VertuTheme.success)
                ScrollView {
                    ForEach(logs, id: \.self) { log in
                        Text(log)
                            .font(VertuTheme.labelStyle())
                            .foregroundColor(VertuTheme.lightGray)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(maxHeight: 200)
            case .error(let message):
                Text(message)
                    .foregroundColor(VertuTheme.error)
            }

            Spacer()
        }
        .padding()
        .navigationTitle("Flow Runner")
        .background(VertuTheme.black.ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { viewModel.runFlow(yaml: flowYaml) }) {
                    Image(systemName: "play.fill")
                        .foregroundColor(VertuTheme.gold)
                }
            }
        }
    }
}
