import SwiftUI
import Foundation
import VertuEdgeCore
import VertuEdgeDriver

/// Observable view model that preserves structured report data for `FlowRunnerView`.
///
/// Annotated `@MainActor` so all mutations occur on the main thread and satisfy
/// Swift 6's `Sendable` requirements for `@State`-stored reference types.
@MainActor
@Observable
final class FlowRunnerViewModel {
    // MARK: - Existing local flow execution state

    var appId: String = "com.vertu.edge.ios"
    var isRunning: Bool = false
    var report: IosDriverReport?

    /// Safety confirmation state.
    var pendingFlow: FlowV1?
    var showSafetyAlert: Bool = false
    var safetyAlertReason: String = ""

    /// Human-readable summary derived from the last report, or "Idle" when none exists.
    var resultText: String {
        guard let report else { return L10n.t("flow_runner_idle") }
        return "\(report.completedSteps)/\(report.totalSteps): \(report.message)"
    }

    // MARK: - Cloud control-plane state

    var controlPlaneBaseURL: String = ControlPlaneRuntimeConfig.shared.baseUrl
    var isLoadingProviderRegistry: Bool = false
    var providerOptions: [String] = []
    var selectedProvider: String = ""
    var providerState: FlowExecutionState = .idle
    var providerMessage: String = L10n.t("flow_runner_provider_not_loaded")

    var modelListState: FlowExecutionState = .idle
    var modelListMessage: String = L10n.t("flow_runner_model_list_not_loaded")
    var modelOptions: [String] = []
    var modelSourceOptions: [ModelSourceDescriptor] = []
    var selectedModel: String = ""
    var modelSource: String = ControlPlaneRuntimeConfig.shared.defaultModelSource
    var providerApiKey: String = ""
    var providerBaseURL: String = ""

    var pullModelRef: String = ""
    var pullSource: String = ControlPlaneRuntimeConfig.shared.defaultModelSource
    var pullForce: Bool = false
    var pullTimeoutMsText: String =
        String(ControlPlaneRuntimeConfig.shared.defaultPullTimeoutMs)
    var pullJobId: String?
    var pullState: FlowExecutionState = .idle
    var pullMessage: String = L10n.t("flow_runner_pull_not_started")

    var chatMessage: String = ""
    var chatReply: String = ""
    var chatSpeechInputMimeType: String = ""
    var chatSpeechInputData: String = ""
    var chatRequestTts: Bool = false
    var chatTtsOutputMimeType: String = ""
    var chatTtsVoice: String = ""
    var chatSpeechTranscript: String = ""
    var chatTtsMimeType: String = ""
    var chatTtsBase64Audio: String = ""
    var chatState: FlowExecutionState = .idle
    var chatStateMessage: String = L10n.t("flow_runner_chat_ready")

    var isLoadingModels: Bool = false
    var isSubmittingPull: Bool = false
    var isPollingPull: Bool = false
    var isSendingChat: Bool = false
}

private enum L10n {
  static let bundle = Bundle.module

  static func t(_ key: String, _ arguments: CVarArg...) -> String {
    let template = NSLocalizedString(
      key,
      tableName: nil,
      bundle: bundle,
      value: key,
      comment: ""
    )
    guard !arguments.isEmpty else {
      return template
    }
    return String(format: template, locale: Locale.current, arguments: arguments)
  }
}

/// SwiftUI shell for running YAML flows on iOS.
public struct FlowRunnerView: View {
    @State private var viewModel = FlowRunnerViewModel()
    private let controlPlaneConfig: ControlPlaneRuntimeConfig = .shared
    private let controlPlaneClient: ControlPlaneAPIClient =
        URLSessionControlPlaneAPIClient(requestTimeoutSeconds: ControlPlaneRuntimeConfig.shared.requestTimeoutSeconds)

    public init() {}

    public var body: some View {
        NavigationStack {
            contentView
            .navigationTitle(L10n.t("flow_runner_title"))
            .alert(L10n.t("flow_runner_confirm_flow_execution"), isPresented: $viewModel.showSafetyAlert) {
                Button(L10n.t("flow_runner_run_flow"), role: .destructive) {
                    if let flow = viewModel.pendingFlow {
                        viewModel.pendingFlow = nil
                        executeFlow(flow)
                    }
                }
                Button(L10n.t("flow_runner_cancel"), role: .cancel) {
                    viewModel.pendingFlow = nil
                }
            } message: {
                Text(viewModel.safetyAlertReason)
            }
            .task {
                loadProviders()
            }
        }
    }

    private var contentView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.t("flow_runner_subtitle"))
                        .foregroundStyle(.secondary)

                    TextField(L10n.t("flow_runner_app_id"), text: $viewModel.appId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(L10n.t("flow_runner_app_id_accessibility_label"))
                        .accessibilityHint(L10n.t("flow_runner_app_id_accessibility_hint"))

                    Button(L10n.t("flow_runner_run_sample_flow")) {
                        guard !viewModel.isRunning else { return }
                        let flow = FlowV1(appId: viewModel.appId, steps: [.launchApp])
                        requestFlowExecution(flow)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isRunning)
                    .accessibilityLabel(
                        viewModel.isRunning
                            ? L10n.t("flow_runner_running_flow")
                            : L10n.t("flow_runner_run_sample_flow")
                    )
                    .accessibilityHint(L10n.t("flow_runner_run_sample_flow_hint"))

                    Text(viewModel.resultText)
                        .font(.footnote)
                        .foregroundStyle(flowStateColor)
                        .accessibilityLabel(L10n.t("flow_runner_result_accessibility", viewModel.resultText))
                }

                Divider()
                cloudToolsSection
                Spacer()
            }
            .padding()
        }
    }

    private var cloudToolsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.t("flow_runner_cloud_tools"))
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.t("flow_runner_control_plane_title"))
                    .font(.subheadline)
                    .bold()
                TextField(L10n.t("flow_runner_control_plane_base_url"), text: $viewModel.controlPlaneBaseURL)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button(L10n.t("flow_runner_load_configured_providers")) {
                        loadProviders()
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.isLoadingProviderRegistry)
                    Button(L10n.t("flow_runner_refresh_model_list")) {
                        loadModels(forProvider: viewModel.selectedProvider)
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.selectedProvider.isEmpty || viewModel.isLoadingModels)
                }
                Text(viewModel.providerMessage)
                    .font(.caption)
                    .foregroundStyle(stateColor(viewModel.providerState))
            if viewModel.providerState == .errorRetryable {
                    Button(L10n.t("flow_runner_retry")) {
                        loadProviders()
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.isLoadingProviderRegistry)
                }
            }

            if !viewModel.providerOptions.isEmpty {
                Picker(L10n.t("flow_runner_ai_provider"), selection: $viewModel.selectedProvider) {
                    ForEach(viewModel.providerOptions, id: \.self) { provider in
                        Text(provider).tag(provider)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: viewModel.selectedProvider) { _, _ in
                    viewModel.modelOptions = []
                    viewModel.selectedModel = ""
                    viewModel.modelListState = .idle
                    viewModel.modelListMessage = L10n.t("flow_runner_model_list_refresh_needed")
                }

                TextField(L10n.t("flow_runner_provider_api_key"), text: $viewModel.providerApiKey)
                    .textFieldStyle(.roundedBorder)

                TextField(L10n.t("flow_runner_provider_base_url_optional"), text: $viewModel.providerBaseURL)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.t("flow_runner_model_list"))
                    .font(.subheadline)
                    .bold()
                if !viewModel.modelSourceOptions.isEmpty {
                    Picker(L10n.t("flow_runner_preferred_source"), selection: $viewModel.modelSource) {
                        ForEach(viewModel.modelSourceOptions, id: \.id) { source in
                            Text(source.displayName).tag(source.id)
                        }
                    }
                    .pickerStyle(.menu)
                } else {
                    TextField(L10n.t("flow_runner_preferred_source"), text: $viewModel.modelSource)
                        .textFieldStyle(.roundedBorder)
                }
                if !viewModel.modelOptions.isEmpty {
                    Picker(L10n.t("flow_runner_model_label"), selection: $viewModel.selectedModel) {
                        ForEach(viewModel.modelOptions, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }
                    .pickerStyle(.menu)
                } else {
                    TextField(L10n.t("flow_runner_model_label"), text: $viewModel.selectedModel)
                        .textFieldStyle(.roundedBorder)
                }
                HStack {
                    Button(L10n.t("flow_runner_load_models")) {
                        loadModels(forProvider: viewModel.selectedProvider)
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.selectedProvider.isEmpty || viewModel.isLoadingModels)
                    if viewModel.isLoadingModels {
                        ProgressView().controlSize(.small)
                    }
                }
                Text(viewModel.modelListMessage)
                    .font(.caption)
                    .foregroundStyle(stateColor(viewModel.modelListState))
                if viewModel.modelListState == .errorRetryable {
                    Button(L10n.t("flow_runner_retry")) {
                        loadModels(forProvider: viewModel.selectedProvider)
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.selectedProvider.isEmpty || viewModel.isLoadingModels)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.t("flow_runner_model_pull_title"))
                    .font(.subheadline)
                    .bold()
                TextField(resolvedPullModelPlaceholder(), text: $viewModel.pullModelRef)
                    .textFieldStyle(.roundedBorder)
                if let hint = resolvedPullModelHint() {
                    Text(hint)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if !viewModel.modelSourceOptions.isEmpty {
                    Picker(L10n.t("flow_runner_pull_model_source"), selection: $viewModel.pullSource) {
                        ForEach(viewModel.modelSourceOptions, id: \.id) { source in
                            Text(source.displayName).tag(source.id)
                        }
                    }
                    .pickerStyle(.menu)
                } else {
                    TextField(L10n.t("flow_runner_pull_model_source"), text: $viewModel.pullSource)
                        .textFieldStyle(.roundedBorder)
                }
                TextField(L10n.t("flow_runner_pull_timeout_ms"), text: $viewModel.pullTimeoutMsText)
                    .textFieldStyle(.roundedBorder)
                Toggle(L10n.t("flow_runner_pull_force"), isOn: $viewModel.pullForce)
                HStack {
                    Button(L10n.t("flow_runner_start_model_pull")) {
                        startModelPull()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isSubmittingPull || normalizedPullModelRef.isEmpty)
                    if viewModel.isSubmittingPull || viewModel.isPollingPull {
                        ProgressView().controlSize(.small)
                    }
                }
                Text(viewModel.pullMessage)
                    .font(.caption)
                    .foregroundStyle(stateColor(viewModel.pullState))
                if viewModel.pullState == .errorRetryable {
                    Button(L10n.t("flow_runner_retry")) {
                        retryModelPull()
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.isSubmittingPull || viewModel.isPollingPull)
                }
                if let jobId = viewModel.pullJobId {
                    Text(L10n.t("flow_runner_pull_job_id", jobId))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.t("flow_runner_chat"))
                    .font(.subheadline)
                    .bold()
                TextEditor(text: $viewModel.chatMessage)
                    .frame(minHeight: 80)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
                    )
                Divider()
                Text(L10n.t("flow_runner_chat_speech_input"))
                    .font(.subheadline)
                    .bold()
                TextField(L10n.t("flow_runner_chat_speech_input_mime_type"), text: $viewModel.chatSpeechInputMimeType)
                    .textFieldStyle(.roundedBorder)
                TextEditor(text: $viewModel.chatSpeechInputData)
                    .frame(minHeight: 80)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
                    )
                Divider()
                Toggle(L10n.t("flow_runner_chat_request_tts"), isOn: $viewModel.chatRequestTts)
                TextField(L10n.t("flow_runner_chat_tts_output_mime_type"), text: $viewModel.chatTtsOutputMimeType)
                    .textFieldStyle(.roundedBorder)
                TextField(L10n.t("flow_runner_chat_tts_voice"), text: $viewModel.chatTtsVoice)
                    .textFieldStyle(.roundedBorder)
                if !viewModel.chatSpeechTranscript.isEmpty {
                    Text(L10n.t("flow_runner_chat_speech_transcript"))
                        .font(.subheadline)
                        .bold()
                    Text(viewModel.chatSpeechTranscript)
                        .font(.caption)
                        .textSelection(.enabled)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                if !viewModel.chatTtsBase64Audio.isEmpty {
                    Text(L10n.t("flow_runner_chat_tts_output"))
                        .font(.subheadline)
                        .bold()
                    Text(L10n.t("flow_runner_chat_tts_mime_type", viewModel.chatTtsMimeType))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(viewModel.chatTtsBase64Audio)
                        .font(.caption2)
                        .textSelection(.enabled)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                HStack {
                    Button(L10n.t("flow_runner_send")) {
                        sendChat()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        viewModel.isSendingChat
                        || !canSendCloudChat
                        || viewModel.selectedProvider.isEmpty
                        || viewModel.selectedModel.isEmpty
                    )
                    if viewModel.isSendingChat {
                        ProgressView().controlSize(.small)
                    }
                }
                if viewModel.selectedModel.isEmpty {
                    Text(L10n.t("flow_runner_chat_model_first"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(viewModel.chatStateMessage)
                    .font(.caption)
                    .foregroundStyle(stateColor(viewModel.chatState))
                if viewModel.chatState == .errorRetryable {
                    Button(L10n.t("flow_runner_retry")) {
                        sendChat()
                    }
                    .buttonStyle(.bordered)
                    .disabled(
                        viewModel.isSendingChat
                        || !canSendCloudChat
                        || viewModel.selectedProvider.isEmpty
                        || viewModel.selectedModel.isEmpty
                    )
                }
                if !viewModel.chatReply.isEmpty {
                    Text(L10n.t("flow_runner_chat_reply"))
                        .font(.subheadline)
                        .bold()
                    Text(viewModel.chatReply)
                        .font(.caption)
                        .textSelection(.enabled)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    private var normalizedPullModelRef: String {
        let typedRef = viewModel.pullModelRef.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typedRef.isEmpty {
            return typedRef
        }
        return viewModel.selectedModel.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSendCloudChat: Bool {
        let speechMime = viewModel.chatSpeechInputMimeType.trimmedOrNil
        let speechData = viewModel.chatSpeechInputData.trimmedOrNil
        return (viewModel.chatMessage.trimmedOrNil != nil) || (speechMime != nil && speechData != nil)
    }

    // MARK: - Safety policy

    /// Evaluate the flow against the safety policy and either run it directly
    /// (when `.allowed`) or surface a confirmation alert (when `.requiresConfirmation`).
    private func requestFlowExecution(_ flow: FlowV1) {
        let verdict = FlowSafetyPolicy.evaluate(flow)
        switch verdict {
        case .allowed:
            executeFlow(flow)
        case .requiresConfirmation(let reason):
            viewModel.pendingFlow = flow
            viewModel.safetyAlertReason = reason
            viewModel.showSafetyAlert = true
        case .blocked(let reason):
            // Surface block reason as a non-retryable result without executing.
            viewModel.report = IosDriverReport(
                completedSteps: 0,
                totalSteps: flow.steps.count,
                state: .errorNonRetryable,
                message: L10n.t("flow_runner_safety_blocked", reason),
                correlationId: UUID().uuidString,
                steps: []
            )
        }
    }

    // MARK: - Execution

    @MainActor
    private func executeFlow(_ flow: FlowV1) {
        viewModel.isRunning = true
        // Task inherits the @MainActor context, matching IosXcTestDriver.execute isolation.
        Task { @MainActor in
            let report = IosXcTestDriver().execute(flow: flow, correlationId: UUID().uuidString)
            self.viewModel.report = report
            self.viewModel.isRunning = false
        }
    }

    // MARK: - Cloud execution

    private func loadProviders() {
        guard let baseURL = currentControlPlaneBaseURL() else {
            viewModel.providerState = .errorNonRetryable
            viewModel.providerMessage = L10n.t("flow_runner_invalid_control_plane_base_url")
            return
        }
        guard !viewModel.isLoadingProviderRegistry else {
            return
        }

        viewModel.isLoadingProviderRegistry = true
        viewModel.providerState = .loading
        viewModel.providerMessage = L10n.t("flow_runner_provider_loading")

        Task { @MainActor in
            defer {
                viewModel.isLoadingProviderRegistry = false
            }
            do {
                let sourceEnvelope = try? await controlPlaneClient.fetchModelSources(baseURL: baseURL)
                let sourceOptions = sourceEnvelope?.data?.sources
                    .filter { !$0.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? []
                let canonicalDefault = resolveModelSourceSelection(
                    candidate: (sourceEnvelope?.data?.defaultSource ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                    options: sourceOptions,
                    fallback: controlPlaneConfig.defaultModelSource,
                    canonicalFallback: controlPlaneConfig.defaultModelSource
                )

                let providers = try await controlPlaneClient.fetchConfiguredProviders(baseURL: baseURL)
                viewModel.providerOptions = providers
                viewModel.modelSourceOptions = sourceOptions
                viewModel.modelSource = resolveModelSourceSelection(
                    candidate: viewModel.modelSource,
                    options: sourceOptions,
                    fallback: canonicalDefault,
                    canonicalFallback: controlPlaneConfig.defaultModelSource
                )
                viewModel.pullSource = resolveModelSourceSelection(
                    candidate: viewModel.pullSource,
                    options: sourceOptions,
                    fallback: viewModel.modelSource,
                    canonicalFallback: canonicalDefault
                )
                viewModel.providerState = providers.isEmpty ? .empty : .success
                viewModel.providerMessage = providers.isEmpty
                    ? L10n.t("flow_runner_provider_empty")
                    : L10n.t("flow_runner_provider_loaded", providers.count)
                if viewModel.selectedProvider.isEmpty, let first = providers.first {
                    viewModel.selectedProvider = first
                }
            } catch {
                viewModel.providerState = .errorRetryable
                viewModel.providerMessage = localizedCloudRequestErrorMessage(from: error)
            }
        }
    }

    private func loadModels(forProvider provider: String) {
        guard let baseURL = currentControlPlaneBaseURL() else {
            viewModel.modelListState = .errorNonRetryable
            viewModel.modelListMessage = L10n.t("flow_runner_invalid_control_plane_base_url")
            return
        }
        let providerValue = provider.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !providerValue.isEmpty else {
            viewModel.modelListState = .errorNonRetryable
            viewModel.modelListMessage = L10n.t("flow_runner_models_select_provider_before_loading")
            return
        }
        guard !viewModel.isLoadingModels else {
            return
        }

        viewModel.isLoadingModels = true
        viewModel.modelListState = .loading
        viewModel.modelListMessage = L10n.t("flow_runner_models_loading_for_provider", providerValue)

        Task { @MainActor in
            defer { viewModel.isLoadingModels = false }
            do {
                let options = try await controlPlaneClient.fetchModels(
                    provider: providerValue,
                    selectedModel: viewModel.selectedModel.trimmedOrNil,
                    apiKey: viewModel.providerApiKey.trimmedOrNil,
                    baseUrl: viewModel.providerBaseURL.trimmedOrNil,
                    stateId: "\(controlPlaneConfig.modelStateIdPrefix)-\(providerValue.lowercased())",
                    baseURL: baseURL
                )
                viewModel.modelOptions = options.models
                if let selected = options.selectedModel?.trimmingCharacters(in: .whitespacesAndNewlines), !selected.isEmpty {
                    viewModel.selectedModel = selected
                } else if viewModel.selectedModel.isEmpty {
                    viewModel.selectedModel = options.models.first ?? ""
                }
                viewModel.modelListState = options.state
                viewModel.modelListMessage = options.stateMessage.trimmedOrNil
                    ?? L10n.t("flow_runner_request_failed")
                if options.models.isEmpty {
                    viewModel.modelListMessage = L10n.t("flow_runner_models_none_for_provider")
                }
            } catch {
                viewModel.modelListState = .errorRetryable
                viewModel.modelListMessage = localizedCloudRequestErrorMessage(from: error)
            }
        }
    }

    private func startModelPull() {
        guard let baseURL = currentControlPlaneBaseURL() else {
            viewModel.pullState = .errorNonRetryable
            viewModel.pullMessage = L10n.t("flow_runner_invalid_control_plane_base_url")
            return
        }
        guard !normalizedPullModelRef.isEmpty else {
            viewModel.pullState = .errorNonRetryable
            viewModel.pullMessage = L10n.t("flow_runner_pull_model_ref_required")
            return
        }
        guard !viewModel.isSubmittingPull else {
            return
        }

        let sourceValue = resolvedPullSource()
        let timeoutMs = resolvedPullTimeout()
        let request = ModelPullRequest(
            modelRef: normalizedPullModelRef,
            source: sourceValue,
            platform: nil,
            force: viewModel.pullForce,
            timeoutMs: timeoutMs,
            correlationId: nil
        )

        viewModel.isSubmittingPull = true
        viewModel.pullState = .loading
        viewModel.pullMessage = L10n.t("flow_runner_pull_submit_request")
        viewModel.chatReply = ""

        Task { @MainActor in
            do {
                let envelope = try await controlPlaneClient.startModelPull(request, baseURL: baseURL)
                applyModelPullEnvelope(envelope)
                if let jobId = envelope.jobId, !jobId.isEmpty, envelope.state == .loading {
                    pollModelPull(jobId: jobId, baseURL: baseURL)
                } else {
                    viewModel.isSubmittingPull = false
                }
            } catch {
                viewModel.pullState = .errorRetryable
                viewModel.pullMessage = localizedCloudRequestErrorMessage(from: error)
                viewModel.isSubmittingPull = false
            }
        }
    }

    private func pollModelPull(jobId: String, baseURL: URL) {
        viewModel.isPollingPull = true
        Task { @MainActor in
            defer {
                viewModel.isPollingPull = false
                viewModel.isSubmittingPull = false
            }
            var attempts = 0
            while attempts < pullPollAttempts {
                attempts += 1
                if attempts > 1 {
                    do {
                        try await Task.sleep(for: pullPollInterval)
                    } catch {
                        break
                    }
                }
                do {
                    let envelope = try await controlPlaneClient.pollModelPull(jobId: jobId, baseURL: baseURL)
                    applyModelPullEnvelope(envelope)
                    if isTerminal(envelope.state) {
                        return
                    }
                } catch {
                    viewModel.pullState = .errorRetryable
                    viewModel.pullMessage = localizedCloudRequestErrorMessage(from: error)
                    return
                }
            }
            if !isTerminal(viewModel.pullState) {
                viewModel.pullState = .errorRetryable
                viewModel.pullMessage = L10n.t("flow_runner_pull_job_timeout")
            }
        }
    }

    private func currentControlPlaneBaseURL() -> URL? {
        let normalizedURL = viewModel.controlPlaneBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: normalizedURL)
    }

    private var pullPollInterval: Duration {
        Duration.milliseconds(Int64(controlPlaneConfig.pollIntervalMs))
    }

    private var pullPollAttempts: Int {
        controlPlaneConfig.pollAttempts
    }

    private func retryModelPull() {
        guard !viewModel.isSubmittingPull, !viewModel.isPollingPull else {
            return
        }
        guard let baseURL = currentControlPlaneBaseURL() else {
            viewModel.pullState = .errorNonRetryable
            viewModel.pullMessage = L10n.t("flow_runner_invalid_control_plane_base_url")
            return
        }
        if let jobId = viewModel.pullJobId?.trimmedOrNil {
            pollModelPull(jobId: jobId, baseURL: baseURL)
            return
        }
        startModelPull()
    }

    private func resolveModelSourceSelection(
        candidate: String,
        options: [ModelSourceDescriptor],
        fallback: String,
        canonicalFallback: String = ""
    ) -> String {
        let normalizedCandidate = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedFallback = fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedCanonicalFallback = canonicalFallback.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedCandidate.isEmpty {
            if let direct = options.first(where: { $0.id.caseInsensitiveCompare(normalizedCandidate) == .orderedSame }) {
                return direct.id
            }
            if let aliasMatch = options.first(where: { source in
                source.aliases.contains { alias in alias.caseInsensitiveCompare(normalizedCandidate) == .orderedSame }
            }) {
                return aliasMatch.id
            }
        }
        if !normalizedFallback.isEmpty,
           let fallbackMatch = options.first(where: { option in
            if option.id.caseInsensitiveCompare(normalizedFallback) == .orderedSame {
                return true
            }
            return option.aliases.contains { alias in alias.caseInsensitiveCompare(normalizedFallback) == .orderedSame }
        }) {
            return fallbackMatch.id
        }
        if !normalizedCanonicalFallback.isEmpty,
           let canonicalMatch = options.first(where: { option in
            if option.id.caseInsensitiveCompare(normalizedCanonicalFallback) == .orderedSame {
                return true
            }
            return option.aliases.contains { alias in alias.caseInsensitiveCompare(normalizedCanonicalFallback) == .orderedSame }
        }) {
            return canonicalMatch.id
        }

        if options.isEmpty {
            return normalizedCanonicalFallback.isEmpty ? normalizedFallback : normalizedCanonicalFallback
        }
        return options.first?.id ?? (normalizedCanonicalFallback.isEmpty ? normalizedFallback : normalizedCanonicalFallback)
    }

    private func resolvedModelSource() -> String {
        resolveModelSourceSelection(
            candidate: viewModel.modelSource,
            options: viewModel.modelSourceOptions,
            fallback: controlPlaneConfig.defaultModelSource,
            canonicalFallback: controlPlaneConfig.defaultModelSource
        )
    }

    private func resolvedPullSource() -> String {
        return resolveModelSourceSelection(
            candidate: viewModel.pullSource,
            options: viewModel.modelSourceOptions,
            fallback: resolvedModelSource(),
            canonicalFallback: controlPlaneConfig.defaultModelSource
        )
    }

    private func resolvedPullModelSourceDescriptor() -> ModelSourceDescriptor? {
        let sourceId = resolvedPullSource().lowercased()
        return viewModel.modelSourceOptions.first(where: { $0.id.lowercased() == sourceId })
    }

    private func resolvedPullModelPlaceholder() -> String {
        if let source = resolvedPullModelSourceDescriptor(),
           let placeholder = source.modelRefPlaceholder.trimmedOrNil {
            return placeholder
        }
        return L10n.t("flow_runner_model_reference_placeholder")
    }

    private func resolvedPullModelHint() -> String? {
        guard let source = resolvedPullModelSourceDescriptor() else {
            return nil
        }
        return source.modelRefHint?.trimmedOrNil
    }

    private func resolvedPullTimeout() -> Int {
        guard let trimmed = viewModel.pullTimeoutMsText.trimmedOrNil,
              let timeout = Int(trimmed),
              timeout > 0 else {
            return controlPlaneConfig.defaultPullTimeoutMs
        }
        return timeout
    }

    private func applyModelPullEnvelope(_ envelope: ModelPullEnvelope) {
        if let jobId = envelope.jobId, !jobId.isEmpty {
            viewModel.pullJobId = jobId
        }
        viewModel.pullState = envelope.state
        if let data = envelope.data {
            let requestedModel = data.requestedModelRef
            let normalizedModel = data.normalizedModelRef
            let status = data.status.rawValue
            let elapsed = data.elapsedMs > 0 ? L10n.t("flow_runner_pull_elapsed_ms", data.elapsedMs) : ""
            let trimmedArtifact = data.artifactPath?.trimmingCharacters(in: .whitespacesAndNewlines)
            let artifact = trimmedArtifact?.isEmpty == true ? "" : (trimmedArtifact).flatMap {
                L10n.t("flow_runner_pull_artifact", $0)
            } ?? ""
            viewModel.pullMessage = L10n.t(
                "flow_runner_pull_job_status",
                requestedModel,
                normalizedModel,
                status,
                elapsed,
                artifact
            )
        } else if !envelope.mismatches.isEmpty {
            viewModel.pullMessage = envelope.mismatches.joined(separator: " ")
        } else {
            viewModel.pullMessage = L10n.t("flow_runner_pull_no_payload")
        }
    }

    private func sendChat() {
        guard let baseURL = currentControlPlaneBaseURL() else {
            viewModel.chatState = .errorNonRetryable
            viewModel.chatStateMessage = L10n.t("flow_runner_invalid_control_plane_base_url")
            return
        }
        guard !viewModel.isSendingChat else {
            return
        }
        let message = viewModel.chatMessage.trimmedOrNil
        let speechInput = buildCloudSpeechInput()
        if message == nil && speechInput == nil {
            viewModel.chatState = .errorNonRetryable
            viewModel.chatStateMessage = L10n.t("flow_runner_chat_input_missing")
            return
        }
        let provider = viewModel.selectedProvider.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !provider.isEmpty else {
            viewModel.chatState = .errorNonRetryable
            viewModel.chatStateMessage = L10n.t("flow_runner_chat_provider_required")
            return
        }
        let model = viewModel.selectedModel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !model.isEmpty else {
            viewModel.chatState = .errorNonRetryable
            viewModel.chatStateMessage = L10n.t("flow_runner_chat_model_required")
            return
        }

        let request = AiChatRequest(
            provider: provider,
            model: model,
            message: message,
            speechInput: speechInput,
            requestTts: viewModel.chatRequestTts ? true : nil,
            ttsOutputMimeType: viewModel.chatTtsOutputMimeType.trimmedOrNil,
            ttsVoice: viewModel.chatTtsVoice.trimmedOrNil,
            apiKey: viewModel.providerApiKey.trimmedOrNil,
            baseUrl: viewModel.providerBaseURL.trimmedOrNil
        )
        viewModel.isSendingChat = true
        viewModel.chatState = .loading
        viewModel.chatStateMessage = L10n.t("flow_runner_chat_sending")

        Task { @MainActor in
            do {
                let envelope = try await controlPlaneClient.sendChat(request, baseURL: baseURL)
                applyChatEnvelope(envelope)
                viewModel.isSendingChat = false
            } catch {
                viewModel.chatState = .errorRetryable
                viewModel.chatStateMessage = localizedCloudRequestErrorMessage(from: error)
                viewModel.isSendingChat = false
            }
        }
    }

    private func localizedCloudRequestErrorMessage(from error: Error) -> String {
        guard let controlPlaneError = error as? ControlPlaneClientError else {
            return L10n.t("flow_runner_request_failed")
        }
        let defaultMessage = L10n.t("flow_runner_request_failed")
        switch controlPlaneError {
        case .invalidBaseURL:
            return L10n.t("flow_runner_invalid_control_plane_base_url")
        case .invalidEndpoint,
             .transport,
             .badStatus,
             .missingEnvelope,
             .envelopeDecodeFailure,
             .parseFailure:
            return defaultMessage
        }
    }

    private func buildCloudSpeechInput() -> AiChatAudioPayload? {
        let mimeType = viewModel.chatSpeechInputMimeType.trimmedOrNil
        let data = viewModel.chatSpeechInputData.trimmedOrNil
        if let mimeType, let data {
            return AiChatAudioPayload(mimeType: mimeType, data: data)
        }
        return nil
    }

    private func applyChatEnvelope(_ envelope: AiChatEnvelope) {
        viewModel.chatState = envelope.state
        viewModel.chatStateMessage = envelope.mismatches.joined(separator: " ")
        if let resolution = envelope.data {
            viewModel.chatReply = resolution.reply
            viewModel.chatSpeechTranscript = resolution.speech?.transcript ?? ""
            viewModel.chatTtsMimeType = resolution.tts?.mimeType ?? ""
            viewModel.chatTtsBase64Audio = resolution.tts?.data ?? ""
            if envelope.state == .success {
                viewModel.chatMessage = ""
                viewModel.chatSpeechInputMimeType = ""
                viewModel.chatSpeechInputData = ""
            }
        }
    }

    private func isTerminal(_ state: FlowExecutionState) -> Bool {
        switch state {
        case .success, .errorRetryable, .errorNonRetryable, .unauthorized:
            return true
        case .idle, .loading, .empty:
            return false
        }
    }

    private var flowStateColor: Color {
        stateColor(viewModel.report == nil ? .idle : viewModel.report!.state)
    }

    private func stateColor(_ state: FlowExecutionState) -> Color {
        switch state {
        case .success: return .green
        case .loading: return .orange
        case .empty: return .blue
        case .errorRetryable, .errorNonRetryable, .unauthorized: return .red
        case .idle: return .secondary
        }
    }
}

private extension String {
    var trimmedOrNil: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
