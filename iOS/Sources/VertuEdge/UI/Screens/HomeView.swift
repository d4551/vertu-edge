import SwiftUI

struct HomeView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("AI-powered mobile automation.\nPrecision crafted.")
                    .font(VertuTheme.bodyStyle())
                    .foregroundColor(VertuTheme.lightGray)
                    .multilineTextAlignment(.center)
                    .padding(.top, 24)

                NavigationLink(destination: FlowRunnerView()) {
                    Label("Run Flow", systemImage: "play.circle.fill")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(VertuTheme.gold)
                        .foregroundColor(VertuTheme.black)
                        .cornerRadius(10)
                }

                NavigationLink(destination: ModelDownloadView()) {
                    Label("Download Models", systemImage: "arrow.down.circle")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(VertuTheme.gold, lineWidth: 1.5)
                        )
                        .foregroundColor(VertuTheme.gold)
                }
            }
            .padding()
        }
        .navigationTitle("Vertu Edge")
        .background(VertuTheme.black.ignoresSafeArea())
    }
}
