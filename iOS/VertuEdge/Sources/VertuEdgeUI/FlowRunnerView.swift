import Foundation
import SwiftUI
import VertuEdgeCore
import VertuEdgeDriver

private enum OperatorLanguage: String, CaseIterable, Identifiable {
    case system = "system"
    case english = "en"
    case spanish = "es"
    case french = "fr"
    case chineseSimplified = "zh-Hans"

    var id: String { rawValue }

    var locale: Locale {
        switch self {
        case .system:
            return .autoupdatingCurrent
        case .english, .spanish, .french, .chineseSimplified:
            return Locale(identifier: rawValue)
        }
    }

    var resourceCode: String? {
        switch self {
        case .system:
            return nil
        case .english, .spanish, .french, .chineseSimplified:
            return rawValue
        }
    }

    static func resolve(_ rawValue: String) -> OperatorLanguage {
        OperatorLanguage(rawValue: rawValue) ?? .system
    }
}

enum OperatorConversationRole {
    case system
    case user
    case assistant
    case runtime
    case warning
}

struct OperatorConversationEntry: Identifiable, Equatable {
    let id: UUID = UUID()
    let role: OperatorConversationRole
    let title: String
    let body: String
    let state: FlowExecutionState
    let timestamp: Date = .now
}

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
    var pullTimeoutMsText: String = String(ControlPlaneRuntimeConfig.shared.defaultPullTimeoutMs)
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

    var deviceAiModelRef: String = ControlPlaneRuntimeConfig.shared.deviceAiRequiredModelRef
    var deviceAiModelRevision: String = ControlPlaneRuntimeConfig.shared.deviceAiRequiredModelRevision
    var deviceAiModelFileName: String = ControlPlaneRuntimeConfig.shared.deviceAiRequiredModelFileName
    var deviceAiExpectedSha256: String = ControlPlaneRuntimeConfig.shared.deviceAiRequiredModelSha256
    var deviceAiState: FlowExecutionState = .idle
    var deviceAiStateMessage: String = L10n.t("flow_runner_device_ai_idle")
    var deviceAiCorrelationId: String = ""
    var deviceAiArtifactPath: String = ""
    var deviceAiArtifactSha256: String = ""
    var deviceAiArtifactSizeBytes: Int64 = 0

    var isLoadingModels: Bool = false
    var isSubmittingPull: Bool = false
    var isPollingPull: Bool = false
    var isSendingChat: Bool = false
    var isRunningDeviceAiProtocol: Bool = false

    // MARK: - Operator shell state

    var conversationEntries: [OperatorConversationEntry] = []

    func appendConversation(
        role: OperatorConversationRole,
        title: String,
        body: String,
        state: FlowExecutionState = .success
    ) {
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedBody.isEmpty else {
            return
        }
        conversationEntries.append(
            OperatorConversationEntry(
                role: role,
                title: title,
                body: trimmedBody,
                state: state
            )
        )
    }

    func ensureSeededConversation() {
        guard conversationEntries.isEmpty else { return }
        appendConversation(
            role: .system,
            title: L10n.t("flow_runner_command_center"),
            body: L10n.t("flow_runner_operator_seed_message"),
            state: .idle
        )
    }

    func resetConversation() {
        conversationEntries.removeAll()
        chatReply = ""
        chatSpeechTranscript = ""
        chatTtsMimeType = ""
        chatTtsBase64Audio = ""
        ensureSeededConversation()
    }

    func refreshLocalizedDefaults() {
        if providerOptions.isEmpty && providerState == .idle {
            providerMessage = L10n.t("flow_runner_provider_not_loaded")
        }
        if modelOptions.isEmpty && modelListState == .idle {
            modelListMessage = L10n.t("flow_runner_model_list_not_loaded")
        }
        if pullJobId == nil && pullState == .idle {
            pullMessage = L10n.t("flow_runner_pull_not_started")
        }
        if chatReply.isEmpty && chatState == .idle {
            chatStateMessage = L10n.t("flow_runner_chat_ready")
        }
        if deviceAiCorrelationId.isEmpty && deviceAiState == .idle {
            deviceAiStateMessage = L10n.t("flow_runner_device_ai_idle")
        }
        ensureSeededConversation()
    }
}

enum L10n {
    private final class OverrideLanguageCodeStore: @unchecked Sendable {
        private let lock = NSLock()
        private var value: String?

        func set(_ nextValue: String?) {
            lock.lock()
            defer { lock.unlock() }
            value = nextValue
        }

        func get() -> String? {
            lock.lock()
            defer { lock.unlock() }
            return value
        }
    }

    static let baseBundle = Bundle.module
    private static let overrideStore = OverrideLanguageCodeStore()

    static func setOverrideLanguageCode(_ languageCode: String?) {
        overrideStore.set(languageCode)
    }

    static func t(_ key: String, _ arguments: CVarArg...) -> String {
        let overrideLanguageCode = overrideStore.get()
        let fallback = NSLocalizedString(key, tableName: nil, bundle: baseBundle, value: key, comment: "")
        let localized = NSLocalizedString(
            key,
            tableName: nil,
            bundle: bundle(for: overrideLanguageCode),
            value: fallback,
            comment: ""
        )
        guard !arguments.isEmpty else {
            return localized
        }
        return String(format: localized, locale: locale(for: overrideLanguageCode), arguments: arguments)
    }

    private static func bundle(for languageCode: String?) -> Bundle {
        guard let languageCode, !languageCode.isEmpty else {
            return baseBundle
        }
        if let path = baseBundle.path(forResource: languageCode, ofType: "lproj"),
           let localizedBundle = Bundle(path: path) {
            return localizedBundle
        }
        if let baseLanguage = languageCode.split(separator: "-").first,
           let path = baseBundle.path(forResource: String(baseLanguage), ofType: "lproj"),
           let localizedBundle = Bundle(path: path) {
            return localizedBundle
        }
        return baseBundle
    }

    private static func locale(for languageCode: String?) -> Locale {
        guard let languageCode, !languageCode.isEmpty else {
            return .autoupdatingCurrent
        }
        return Locale(identifier: languageCode)
    }
}

// Branded component structs (VertuPanel, VertuChip, VertuField, VertuInputStyle,
// VertuPrimaryButton, VertuSecondaryButton, VertuStatusCard, VertuTimelineBubble,
// VertuFloatingChatBubble) are defined in VertuComponents.swift.

// FlowExecutionState.accentColor and .localizedOperatorLabel are now in VertuComponents.swift.
// OperatorConversationRole.accent/.background and OperatorConversationEntry layout helpers
// are also in VertuComponents.swift.

private extension OperatorLanguage {
    var localizedLabel: String {
        switch self {
        case .system:
            return L10n.t("flow_runner_language_system")
        case .english:
            return L10n.t("flow_runner_language_en")
        case .spanish:
            return L10n.t("flow_runner_language_es")
        case .french:
            return L10n.t("flow_runner_language_fr")
        case .chineseSimplified:
            return L10n.t("flow_runner_language_zh_hans")
        }
    }
}

/// SwiftUI shell for running YAML flows and operator chat on iOS.
public struct FlowRunnerView: View {
    @State private var viewModel = FlowRunnerViewModel()
    @AppStorage("vertu.operator.locale") private var operatorLanguageCode: String = OperatorLanguage.system.rawValue
    @State private var showRuntimeAdmin: Bool = false
    @State private var showFlowAdmin: Bool = false
    private let controlPlaneConfig: ControlPlaneRuntimeConfig = .shared
    private let controlPlaneClient: ControlPlaneAPIClient =
        URLSessionControlPlaneAPIClient(requestTimeoutSeconds: ControlPlaneRuntimeConfig.shared.requestTimeoutSeconds)
    private let driverAdapter: DefaultDriverAdapter
    private let deviceAiProtocolRunner: DeviceAiProtocolRunner

    public init() {
        let adapter = DefaultDriverAdapter()
        self.driverAdapter = adapter
        self.deviceAiProtocolRunner = DeviceAiProtocolRunner(config: .shared, driverAdapter: adapter)
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [VertuTheme.black, VertuTheme.charcoal, VertuTheme.black],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        commandCenterPanel
                        heroPanel
                        executionGrid
                        advancedPanels
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 28)
                }
            }
            .vertuInlineNavTitle()
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        VertuLogoView(size: 22, color: VertuTheme.gold)
                        Text(L10n.t("flow_runner_title"))
                            .font(.system(.headline, design: .rounded, weight: .semibold))
                            .foregroundStyle(VertuTheme.ivory)
                    }
                }
            }
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
                applyOperatorLanguage()
                viewModel.ensureSeededConversation()
                loadProviders()
            }
            .onChange(of: operatorLanguageCode) { _, _ in
                applyOperatorLanguage()
            }
        }
        .environment(\.locale, selectedLanguage.locale)
    }

    private var selectedLanguage: OperatorLanguage {
        OperatorLanguage.resolve(operatorLanguageCode)
    }

    private var heroPanel: some View {
        VertuPanel(title: L10n.t("flow_runner_title"), subtitle: L10n.t("flow_runner_subtitle")) {
            VStack(alignment: .leading, spacing: 14) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        VertuChip(
                            label: runtimeChipLabel(
                                title: L10n.t("flow_runner_ai_provider"),
                                value: viewModel.selectedProvider.trimmedOrNil ?? L10n.t("flow_runner_runtime_not_set")
                            ),
                            accent: viewModel.providerState.accentColor
                        )
                        VertuChip(
                            label: runtimeChipLabel(
                                title: L10n.t("flow_runner_model_label"),
                                value: viewModel.selectedModel.trimmedOrNil ?? L10n.t("flow_runner_runtime_not_set")
                            ),
                            accent: viewModel.modelListState.accentColor
                        )
                        VertuChip(
                            label: runtimeChipLabel(
                                title: L10n.t("flow_runner_device_ai_title"),
                                value: viewModel.deviceAiState.localizedOperatorLabel
                            ),
                            accent: viewModel.deviceAiState.accentColor
                        )
                        VertuChip(
                            label: runtimeChipLabel(
                                title: L10n.t("flow_runner_language"),
                                value: selectedLanguage.localizedLabel
                            ),
                            accent: VertuTheme.goldLight
                        )
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.t("flow_runner_language"))
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .foregroundStyle(VertuTheme.gold.opacity(0.92))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(OperatorLanguage.allCases) { language in
                                Button {
                                    operatorLanguageCode = language.rawValue
                                } label: {
                                    VertuChip(
                                        label: language.localizedLabel,
                                        accent: language == selectedLanguage ? VertuTheme.gold : VertuTheme.cream.opacity(0.75)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }

    private var commandCenterPanel: some View {
        VertuPanel(title: L10n.t("flow_runner_command_center"), subtitle: L10n.t("flow_runner_command_center_subtitle")) {
            VStack(alignment: .leading, spacing: 16) {
                composer
                conversationTimeline
                runtimeStrip
                runtimeSelectors
                statusGrid
            }
        }
    }

    private var runtimeStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L10n.t("flow_runner_runtime_strip_title"))
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(VertuTheme.gold.opacity(0.92))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    VertuChip(
                        label: runtimeChipLabel(title: L10n.t("flow_runner_control_plane_title"), value: controlPlaneHostLabel),
                        accent: VertuTheme.gold
                    )
                    VertuChip(
                        label: runtimeChipLabel(title: L10n.t("flow_runner_preferred_source"), value: resolvedModelSource()),
                        accent: viewModel.modelListState.accentColor
                    )
                    VertuChip(
                        label: runtimeChipLabel(title: L10n.t("flow_runner_chat"), value: viewModel.chatState.localizedOperatorLabel),
                        accent: viewModel.chatState.accentColor
                    )
                    VertuChip(
                        label: runtimeChipLabel(title: L10n.t("flow_runner_model_pull_title"), value: viewModel.pullState.localizedOperatorLabel),
                        accent: viewModel.pullState.accentColor
                    )
                    VertuChip(
                        label: runtimeChipLabel(
                            title: L10n.t("flow_runner_chat_request_tts"),
                            value: viewModel.chatRequestTts ? L10n.t("flow_runner_state_success") : L10n.t("flow_runner_state_idle")
                        ),
                        accent: viewModel.chatRequestTts ? VertuTheme.goldLight : VertuTheme.cream.opacity(0.7)
                    )
                }
            }
        }
    }

    private var runtimeSelectors: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VertuField(title: L10n.t("flow_runner_ai_provider")) {
                    Picker(L10n.t("flow_runner_ai_provider"), selection: $viewModel.selectedProvider) {
                        Text(L10n.t("flow_runner_runtime_not_set")).tag("")
                        ForEach(viewModel.providerOptions, id: \.self) { provider in
                            Text(provider).tag(provider)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(VertuTheme.gold)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(VertuTheme.black.opacity(0.72))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(VertuTheme.gold.opacity(0.24), lineWidth: 1)
                    )
                    .onChange(of: viewModel.selectedProvider) { _, _ in
                        viewModel.modelOptions = []
                        viewModel.selectedModel = ""
                        viewModel.modelListState = .idle
                        viewModel.modelListMessage = L10n.t("flow_runner_model_list_refresh_needed")
                    }
                }

                VertuField(title: L10n.t("flow_runner_model_label")) {
                    Picker(L10n.t("flow_runner_model_label"), selection: $viewModel.selectedModel) {
                        Text(L10n.t("flow_runner_runtime_not_set")).tag("")
                        ForEach(viewModel.modelOptions, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(VertuTheme.gold)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(VertuTheme.black.opacity(0.72))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(VertuTheme.gold.opacity(0.24), lineWidth: 1)
                    )
                }
            }

            HStack(spacing: 10) {
                VertuSecondaryButton(title: L10n.t("flow_runner_load_configured_providers"), isDisabled: viewModel.isLoadingProviderRegistry) {
                    loadProviders()
                }
                VertuSecondaryButton(
                    title: L10n.t("flow_runner_load_models"),
                    isDisabled: viewModel.selectedProvider.isEmpty || viewModel.isLoadingModels
                ) {
                    loadModels(forProvider: viewModel.selectedProvider)
                }
            }

            if viewModel.isLoadingProviderRegistry || viewModel.isLoadingModels {
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(VertuTheme.gold)
                    Text(L10n.t("flow_runner_runtime_loading_hint"))
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(VertuTheme.cream.opacity(0.72))
                }
            }
        }
    }

    private var statusGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            VertuStatusCard(
                title: L10n.t("flow_runner_model_pull_title"),
                detail: viewModel.pullMessage,
                state: viewModel.pullState,
                actionTitle: L10n.t("flow_runner_start_model_pull"),
                actionDisabled: viewModel.isSubmittingPull || normalizedPullModelRef.isEmpty,
                action: startModelPull
            )
            VertuField(title: L10n.t("flow_runner_model_reference_placeholder")) {
                TextField(resolvedPullModelPlaceholder(), text: $viewModel.pullModelRef)
                    .textFieldStyle(VertuInputStyle())
            }
            if let hint = resolvedPullModelHint() {
                Text(hint)
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(VertuTheme.cream.opacity(0.7))
            }
            VertuStatusCard(
                title: L10n.t("flow_runner_device_ai_title"),
                detail: viewModel.deviceAiStateMessage,
                state: viewModel.deviceAiState,
                actionTitle: L10n.t("flow_runner_device_ai_run_protocol"),
                actionDisabled: viewModel.isRunningDeviceAiProtocol,
                action: runDeviceAiProtocol
            )
        }
    }

    private var conversationTimeline: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L10n.t("flow_runner_chat"))
                        .font(.system(.headline, design: .rounded, weight: .semibold))
                        .foregroundStyle(VertuTheme.ivory)
                    Text(viewModel.chatStateMessage)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(viewModel.chatState.accentColor)
                }
                Spacer(minLength: 12)
                Button(L10n.t("flow_runner_clear_conversation")) {
                    viewModel.resetConversation()
                }
                .buttonStyle(.plain)
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(VertuTheme.gold)
            }

            VStack(alignment: .leading, spacing: 12) {
                ForEach(viewModel.conversationEntries) { entry in
                    VertuTimelineBubble(entry: entry)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.t("flow_runner_chat"))
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(VertuTheme.gold.opacity(0.92))

            ZStack(alignment: .topLeading) {
                TextEditor(text: $viewModel.chatMessage)
                    .scrollContentBackground(.hidden)
                    .font(.system(.body, design: .rounded, weight: .medium))
                    .foregroundStyle(VertuTheme.ivory)
                    .frame(minHeight: 130)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(VertuTheme.black.opacity(0.72))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(VertuTheme.gold.opacity(0.24), lineWidth: 1)
                    )
                if viewModel.chatMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(L10n.t("flow_runner_operator_seed_message"))
                        .font(.system(.body, design: .rounded, weight: .medium))
                        .foregroundStyle(VertuTheme.cream.opacity(0.38))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 18)
                        .allowsHitTesting(false)
                }
            }

            Toggle(isOn: $viewModel.chatRequestTts) {
                Text(L10n.t("flow_runner_chat_request_tts"))
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(VertuTheme.cream)
            }
            .toggleStyle(.switch)
            .tint(VertuTheme.gold)

            HStack(spacing: 10) {
                VertuPrimaryButton(
                    title: L10n.t("flow_runner_send"),
                    isDisabled: viewModel.isSendingChat || !canSendCloudChat || viewModel.selectedProvider.isEmpty || viewModel.selectedModel.isEmpty,
                    action: sendChat
                )
                if viewModel.isSendingChat {
                    ProgressView()
                        .tint(VertuTheme.gold)
                        .frame(width: 28)
                }
            }

            if viewModel.selectedModel.isEmpty {
                Text(L10n.t("flow_runner_chat_model_first"))
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(VertuTheme.cream.opacity(0.7))
            }
        }
    }

    private var executionGrid: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !viewModel.chatSpeechTranscript.isEmpty || !viewModel.chatTtsBase64Audio.isEmpty {
                VertuPanel(title: L10n.t("flow_runner_chat_reply"), subtitle: nil) {
                    VStack(alignment: .leading, spacing: 12) {
                        if !viewModel.chatSpeechTranscript.isEmpty {
                            VertuField(title: L10n.t("flow_runner_chat_speech_transcript")) {
                                Text(viewModel.chatSpeechTranscript)
                                    .font(.system(.caption, design: .rounded, weight: .medium))
                                    .foregroundStyle(VertuTheme.cream)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(14)
                                    .background(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .fill(VertuTheme.black.opacity(0.72))
                                    )
                            }
                        }
                        if !viewModel.chatTtsBase64Audio.isEmpty {
                            VertuField(title: L10n.t("flow_runner_chat_tts_output")) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(L10n.t("flow_runner_chat_tts_mime_type", viewModel.chatTtsMimeType))
                                        .font(.system(.caption, design: .rounded, weight: .medium))
                                        .foregroundStyle(VertuTheme.cream.opacity(0.72))
                                    Text(viewModel.chatTtsBase64Audio)
                                        .font(.system(.caption2, design: .monospaced, weight: .regular))
                                        .foregroundStyle(VertuTheme.cream)
                                        .textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(14)
                                        .background(
                                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                                .fill(VertuTheme.black.opacity(0.72))
                                        )
                                }
                            }
                        }
                    }
                }
            }

            if !viewModel.deviceAiCorrelationId.isEmpty || !viewModel.deviceAiArtifactPath.isEmpty {
                VertuPanel(title: L10n.t("flow_runner_device_ai_title"), subtitle: L10n.t("flow_runner_device_ai_subtitle")) {
                    VStack(alignment: .leading, spacing: 10) {
                        if !viewModel.deviceAiCorrelationId.isEmpty {
                            Text(L10n.t("flow_runner_device_ai_correlation_id", viewModel.deviceAiCorrelationId))
                                .font(.system(.caption, design: .monospaced, weight: .regular))
                                .foregroundStyle(VertuTheme.cream)
                                .textSelection(.enabled)
                        }
                        if !viewModel.deviceAiArtifactPath.isEmpty {
                            Text(L10n.t("flow_runner_device_ai_artifact_path", viewModel.deviceAiArtifactPath))
                                .font(.system(.caption, design: .monospaced, weight: .regular))
                                .foregroundStyle(VertuTheme.cream)
                                .textSelection(.enabled)
                        }
                        if !viewModel.deviceAiArtifactSha256.isEmpty {
                            Text(L10n.t("flow_runner_device_ai_artifact_sha256", viewModel.deviceAiArtifactSha256))
                                .font(.system(.caption, design: .monospaced, weight: .regular))
                                .foregroundStyle(VertuTheme.cream)
                                .textSelection(.enabled)
                        }
                        if viewModel.deviceAiArtifactSizeBytes > 0 {
                            Text(L10n.t("flow_runner_device_ai_artifact_size_bytes", viewModel.deviceAiArtifactSizeBytes))
                                .font(.system(.caption, design: .rounded, weight: .medium))
                                .foregroundStyle(VertuTheme.cream.opacity(0.72))
                        }
                    }
                }
            }
        }
    }

    private var advancedPanels: some View {
        VStack(alignment: .leading, spacing: 14) {
            runtimeAdminDisclosure
            flowAdminDisclosure
        }
    }

    private var runtimeAdminDisclosure: some View {
        DisclosureGroup(isExpanded: $showRuntimeAdmin) {
            runtimeAdminFields
                .padding(.top, 12)
        } label: {
            Text(L10n.t("flow_runner_runtime_admin"))
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .foregroundStyle(VertuTheme.ivory)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(VertuTheme.charcoal.opacity(0.9))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(VertuTheme.gold.opacity(0.22), lineWidth: 1)
        )
    }

    private var runtimeAdminFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            runtimeConnectionAdminFields
            runtimeSourceAdminFields
            runtimeAudioAdminFields
        }
    }

    private var runtimeConnectionAdminFields: some View {
        Group {
            VertuField(title: L10n.t("flow_runner_control_plane_base_url")) {
                TextField(L10n.t("flow_runner_control_plane_base_url"), text: $viewModel.controlPlaneBaseURL)
                    .textFieldStyle(VertuInputStyle())
                    .vertuNoAutocapitalize()
                    .autocorrectionDisabled()
            }
            VertuField(title: L10n.t("flow_runner_provider_api_key")) {
                SecureField(L10n.t("flow_runner_provider_api_key"), text: $viewModel.providerApiKey)
                    .textFieldStyle(VertuInputStyle())
            }
            VertuField(title: L10n.t("flow_runner_provider_base_url_optional")) {
                TextField(L10n.t("flow_runner_provider_base_url_optional"), text: $viewModel.providerBaseURL)
                    .textFieldStyle(VertuInputStyle())
                    .vertuNoAutocapitalize()
                    .autocorrectionDisabled()
            }
        }
    }

    private var runtimeSourceAdminFields: some View {
        Group {
            runtimeSourceField(
                title: L10n.t("flow_runner_preferred_source"),
                selection: $viewModel.modelSource
            )
            runtimeSourceField(
                title: L10n.t("flow_runner_pull_model_source"),
                selection: $viewModel.pullSource
            )
            VertuField(title: L10n.t("flow_runner_pull_timeout_ms")) {
                TextField(L10n.t("flow_runner_pull_timeout_ms"), text: $viewModel.pullTimeoutMsText)
                    .textFieldStyle(VertuInputStyle())
                    .vertuNumberPadKeyboard()
            }
            Toggle(isOn: $viewModel.pullForce) {
                Text(L10n.t("flow_runner_pull_force"))
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(VertuTheme.cream)
            }
            .toggleStyle(.switch)
            .tint(VertuTheme.gold)
        }
    }

    private var runtimeAudioAdminFields: some View {
        Group {
            VertuField(title: L10n.t("flow_runner_chat_speech_input_mime_type")) {
                TextField(L10n.t("flow_runner_chat_speech_input_mime_type"), text: $viewModel.chatSpeechInputMimeType)
                    .textFieldStyle(VertuInputStyle())
            }
            VertuField(title: L10n.t("flow_runner_chat_speech_input")) {
                TextEditor(text: $viewModel.chatSpeechInputData)
                    .scrollContentBackground(.hidden)
                    .font(.system(.body, design: .rounded, weight: .medium))
                    .foregroundStyle(VertuTheme.ivory)
                    .frame(minHeight: 96)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(VertuTheme.black.opacity(0.72))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(VertuTheme.gold.opacity(0.24), lineWidth: 1)
                    )
            }
            VertuField(title: L10n.t("flow_runner_chat_tts_output_mime_type")) {
                TextField(L10n.t("flow_runner_chat_tts_output_mime_type"), text: $viewModel.chatTtsOutputMimeType)
                    .textFieldStyle(VertuInputStyle())
            }
            VertuField(title: L10n.t("flow_runner_chat_tts_voice")) {
                TextField(L10n.t("flow_runner_chat_tts_voice"), text: $viewModel.chatTtsVoice)
                    .textFieldStyle(VertuInputStyle())
            }
        }
    }

    @ViewBuilder
    private func runtimeSourceField(title: String, selection: Binding<String>) -> some View {
        VertuField(title: title) {
            if !viewModel.modelSourceOptions.isEmpty {
                Picker(title, selection: selection) {
                    ForEach(viewModel.modelSourceOptions, id: \.id) { source in
                        Text(source.displayName).tag(source.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(VertuTheme.gold)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(VertuTheme.black.opacity(0.72))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(VertuTheme.gold.opacity(0.24), lineWidth: 1)
                )
            } else {
                TextField(title, text: selection)
                    .textFieldStyle(VertuInputStyle())
            }
        }
    }

    private var flowAdminDisclosure: some View {
        DisclosureGroup(isExpanded: $showFlowAdmin) {
            flowAdminContent
            .padding(.top, 12)
        } label: {
            Text(L10n.t("flow_runner_flow_admin"))
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .foregroundStyle(VertuTheme.ivory)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(VertuTheme.charcoal.opacity(0.9))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(VertuTheme.gold.opacity(0.22), lineWidth: 1)
        )
    }

    private var flowAdminContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            VertuField(title: L10n.t("flow_runner_app_id")) {
                TextField(L10n.t("flow_runner_app_id"), text: $viewModel.appId)
                    .textFieldStyle(VertuInputStyle())
                    .vertuNoAutocapitalize()
                    .autocorrectionDisabled()
            }
            HStack(spacing: 10) {
                VertuPrimaryButton(
                    title: L10n.t("flow_runner_run_sample_flow"),
                    isDisabled: viewModel.isRunning,
                    action: {
                        guard !viewModel.isRunning else { return }
                        let flow = FlowV1(appId: viewModel.appId, steps: [.launchApp])
                        requestFlowExecution(flow)
                    }
                )
                if viewModel.isRunning {
                    ProgressView()
                        .tint(VertuTheme.gold)
                        .frame(width: 28)
                }
            }
            Text(viewModel.resultText)
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(flowStateColor)
        }
    }

    private var controlPlaneHostLabel: String {
        guard let url = currentControlPlaneBaseURL() else {
            return L10n.t("flow_runner_runtime_not_set")
        }
        return url.host ?? url.absoluteString
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

    private func runtimeChipLabel(title: String, value: String) -> String {
        "\(title): \(value)"
    }

    private func applyOperatorLanguage() {
        L10n.setOverrideLanguageCode(selectedLanguage.resourceCode)
        viewModel.refreshLocalizedDefaults()
    }

    // MARK: - Safety policy

    /// Evaluate the flow against the safety policy and either run it directly
    /// (when `.allowed`) or surface a confirmation alert (when `.requiresConfirmation`).
    private func requestFlowExecution(_ flow: FlowV1) {
        let verdict = FlowSafetyPolicy.evaluate(flow)
        switch verdict {
        case .allowed:
            viewModel.appendConversation(
                role: .runtime,
                title: L10n.t("flow_runner_flow_admin"),
                body: L10n.t("flow_runner_run_sample_flow"),
                state: .loading
            )
            executeFlow(flow)
        case .requiresConfirmation(let reason):
            viewModel.pendingFlow = flow
            viewModel.safetyAlertReason = reason
            viewModel.showSafetyAlert = true
            viewModel.appendConversation(
                role: .warning,
                title: L10n.t("flow_runner_flow_admin"),
                body: reason,
                state: .errorRetryable
            )
        case .blocked(let reason):
            viewModel.report = IosDriverReport(
                completedSteps: 0,
                totalSteps: flow.steps.count,
                state: .errorNonRetryable,
                message: L10n.t("flow_runner_safety_blocked", reason),
                correlationId: UUID().uuidString,
                steps: []
            )
            viewModel.appendConversation(
                role: .warning,
                title: L10n.t("flow_runner_flow_admin"),
                body: L10n.t("flow_runner_safety_blocked", reason),
                state: .errorNonRetryable
            )
        }
    }

    // MARK: - Execution

    @MainActor
    private func executeFlow(_ flow: FlowV1) {
        viewModel.isRunning = true
        Task { @MainActor in
            let report = driverAdapter.execute(flow: flow, correlationId: UUID().uuidString)
            self.viewModel.report = report
            self.viewModel.isRunning = false
            self.viewModel.appendConversation(
                role: report.state == .success ? .runtime : .warning,
                title: L10n.t("flow_runner_flow_admin"),
                body: report.message,
                state: report.state
            )
        }
    }

    // MARK: - Cloud execution

    private func loadProviders() {
        guard let baseURL = currentControlPlaneBaseURL() else {
            viewModel.providerState = .errorNonRetryable
            viewModel.providerMessage = L10n.t("flow_runner_invalid_control_plane_base_url")
            viewModel.appendConversation(
                role: .warning,
                title: L10n.t("flow_runner_control_plane_title"),
                body: viewModel.providerMessage,
                state: viewModel.providerState
            )
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
                let canonicalDefault = sourceOptions.resolveModelSourceId(
                    candidate: (sourceEnvelope?.data?.defaultSource ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                    fallback: controlPlaneConfig.defaultModelSource,
                    canonicalFallback: controlPlaneConfig.defaultModelSource
                )

                let providers = try await controlPlaneClient.fetchConfiguredProviders(baseURL: baseURL)
                viewModel.providerOptions = providers
                viewModel.modelSourceOptions = sourceOptions
                viewModel.modelSource = sourceOptions.resolveModelSourceId(
                    candidate: viewModel.modelSource,
                    fallback: canonicalDefault,
                    canonicalFallback: controlPlaneConfig.defaultModelSource
                )
                viewModel.pullSource = sourceOptions.resolveModelSourceId(
                    candidate: viewModel.pullSource,
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
                viewModel.appendConversation(
                    role: providers.isEmpty ? .warning : .runtime,
                    title: L10n.t("flow_runner_control_plane_title"),
                    body: viewModel.providerMessage,
                    state: viewModel.providerState
                )
            } catch {
                viewModel.providerState = .errorRetryable
                viewModel.providerMessage = localizedCloudRequestErrorMessage(from: error)
                viewModel.appendConversation(
                    role: .warning,
                    title: L10n.t("flow_runner_control_plane_title"),
                    body: viewModel.providerMessage,
                    state: viewModel.providerState
                )
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
                viewModel.appendConversation(
                    role: options.state == .success ? .runtime : .warning,
                    title: L10n.t("flow_runner_model_list"),
                    body: viewModel.modelListMessage,
                    state: options.state
                )
            } catch {
                viewModel.modelListState = .errorRetryable
                viewModel.modelListMessage = localizedCloudRequestErrorMessage(from: error)
                viewModel.appendConversation(
                    role: .warning,
                    title: L10n.t("flow_runner_model_list"),
                    body: viewModel.modelListMessage,
                    state: viewModel.modelListState
                )
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
        viewModel.appendConversation(
            role: .runtime,
            title: L10n.t("flow_runner_model_pull_title"),
            body: viewModel.pullMessage,
            state: viewModel.pullState
        )
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
                viewModel.appendConversation(
                    role: .warning,
                    title: L10n.t("flow_runner_model_pull_title"),
                    body: viewModel.pullMessage,
                    state: viewModel.pullState
                )
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
                    viewModel.appendConversation(
                        role: .warning,
                        title: L10n.t("flow_runner_model_pull_title"),
                        body: viewModel.pullMessage,
                        state: viewModel.pullState
                    )
                    return
                }
            }
            if !isTerminal(viewModel.pullState) {
                viewModel.pullState = .errorRetryable
                viewModel.pullMessage = L10n.t("flow_runner_pull_job_timeout")
                viewModel.appendConversation(
                    role: .warning,
                    title: L10n.t("flow_runner_model_pull_title"),
                    body: viewModel.pullMessage,
                    state: viewModel.pullState
                )
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

    private func resolvedModelSource() -> String {
        viewModel.modelSourceOptions.resolveModelSourceId(
            candidate: viewModel.modelSource,
            fallback: controlPlaneConfig.defaultModelSource,
            canonicalFallback: controlPlaneConfig.defaultModelSource
        )
    }

    private func resolvedPullSource() -> String {
        viewModel.modelSourceOptions.resolveModelSourceId(
            candidate: viewModel.pullSource,
            fallback: resolvedModelSource(),
            canonicalFallback: controlPlaneConfig.defaultModelSource
        )
    }

    private func resolvedPullModelSourceDescriptor() -> ModelSourceDescriptor? {
        guard let sourceId = viewModel.modelSourceOptions.resolveKnownModelSourceId(resolvedPullSource()) else {
            return nil
        }
        return viewModel.modelSourceOptions.first(where: { $0.id == sourceId })
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

        if isTerminal(envelope.state) {
            viewModel.appendConversation(
                role: envelope.state == .success ? .runtime : .warning,
                title: L10n.t("flow_runner_model_pull_title"),
                body: viewModel.pullMessage,
                state: envelope.state
            )
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
        viewModel.appendConversation(
            role: .user,
            title: L10n.t("flow_runner_chat"),
            body: message ?? L10n.t("flow_runner_voice_request"),
            state: .success
        )

        Task { @MainActor in
            do {
                let envelope = try await controlPlaneClient.sendChat(request, baseURL: baseURL)
                applyChatEnvelope(envelope)
                viewModel.isSendingChat = false
            } catch {
                viewModel.chatState = .errorRetryable
                viewModel.chatStateMessage = localizedCloudRequestErrorMessage(from: error)
                viewModel.appendConversation(
                    role: .warning,
                    title: L10n.t("flow_runner_chat"),
                    body: viewModel.chatStateMessage,
                    state: viewModel.chatState
                )
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
            let replyBody = resolution.reply.trimmedOrNil ?? L10n.t("flow_runner_chat_reply_empty")
            viewModel.appendConversation(
                role: envelope.state == .success ? .assistant : .warning,
                title: L10n.t("flow_runner_chat_reply"),
                body: replyBody,
                state: envelope.state
            )
            if let transcript = resolution.speech?.transcript.trimmedOrNil {
                viewModel.appendConversation(
                    role: .runtime,
                    title: L10n.t("flow_runner_chat_speech_transcript"),
                    body: transcript,
                    state: envelope.state
                )
            }
            if resolution.tts?.data.trimmedOrNil != nil {
                viewModel.appendConversation(
                    role: .runtime,
                    title: L10n.t("flow_runner_chat_tts_output"),
                    body: L10n.t("flow_runner_tts_ready"),
                    state: envelope.state
                )
            }
        } else if !viewModel.chatStateMessage.isEmpty {
            viewModel.appendConversation(
                role: .warning,
                title: L10n.t("flow_runner_chat"),
                body: viewModel.chatStateMessage,
                state: envelope.state
            )
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
        state.accentColor
    }

    private func runDeviceAiProtocol() {
        let modelRef = viewModel.deviceAiModelRef.trimmingCharacters(in: .whitespacesAndNewlines)
        let fileName = viewModel.deviceAiModelFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !viewModel.isRunningDeviceAiProtocol else {
            return
        }
        guard !modelRef.isEmpty else {
            viewModel.deviceAiState = .errorNonRetryable
            viewModel.deviceAiStateMessage = L10n.t("flow_runner_device_ai_model_ref_required")
            return
        }
        guard !fileName.isEmpty else {
            viewModel.deviceAiState = .errorNonRetryable
            viewModel.deviceAiStateMessage = L10n.t("flow_runner_device_ai_model_file_name_required")
            return
        }

        let correlationId = UUID().uuidString
        let request = DeviceAiProtocolRequest(
            appId: viewModel.appId,
            modelRef: modelRef,
            revision: viewModel.deviceAiModelRevision.trimmedOrNil ?? "",
            fileName: fileName,
            expectedSha256: viewModel.deviceAiExpectedSha256.trimmedOrNil ?? "",
            token: controlPlaneConfig.deviceAiHfToken.trimmedOrNil ?? "",
            correlationId: correlationId
        )

        resetDeviceAiOutcome(correlationId: correlationId)
        viewModel.deviceAiState = .loading
        viewModel.deviceAiStateMessage = L10n.t("flow_runner_device_ai_running")
        viewModel.isRunningDeviceAiProtocol = true
        viewModel.appendConversation(
            role: .runtime,
            title: L10n.t("flow_runner_device_ai_title"),
            body: viewModel.deviceAiStateMessage,
            state: viewModel.deviceAiState
        )

        Task { @MainActor in
            let outcome = await deviceAiProtocolRunner.run(request: request)
            applyDeviceAiProtocolOutcome(outcome)
            viewModel.isRunningDeviceAiProtocol = false
        }
    }

    private func resetDeviceAiOutcome(correlationId: String) {
        viewModel.deviceAiCorrelationId = correlationId
        viewModel.deviceAiArtifactPath = ""
        viewModel.deviceAiArtifactSha256 = ""
        viewModel.deviceAiArtifactSizeBytes = 0
    }

    private func applyDeviceAiProtocolOutcome(_ outcome: DeviceAiProtocolRunOutcome) {
        let report = outcome.report
        viewModel.deviceAiCorrelationId = report.correlationId
        viewModel.deviceAiArtifactPath = report.artifact?.path ?? ""
        viewModel.deviceAiArtifactSha256 = report.artifact?.sha256 ?? ""
        viewModel.deviceAiArtifactSizeBytes = report.artifact?.sizeBytes ?? 0
        viewModel.deviceAiState = report.state
        viewModel.deviceAiStateMessage = localizedDeviceAiProtocolMessage(report)
        viewModel.appendConversation(
            role: report.state == .success ? .runtime : .warning,
            title: L10n.t("flow_runner_device_ai_title"),
            body: viewModel.deviceAiStateMessage,
            state: report.state
        )
    }

    private func localizedDeviceAiProtocolMessage(_ report: DeviceAiProtocolRunReport) -> String {
        guard let failure = report.failure else {
            return report.state == .success
                ? L10n.t("flow_runner_device_ai_success")
                : L10n.t("flow_runner_device_ai_smoke_failed")
        }

        switch failure.stage {
        case .validation:
            switch failure.code {
            case HuggingFaceModelManagerErrorCode.invalidModelReference.rawValue:
                return L10n.t("flow_runner_device_ai_model_ref_required")
            case HuggingFaceModelManagerErrorCode.invalidFileName.rawValue:
                return L10n.t("flow_runner_device_ai_model_file_name_required")
            case "IOS_DEVICE_AI_APP_ID_REQUIRED":
                return L10n.t("flow_runner_device_ai_app_id_required")
            default:
                return L10n.t("flow_runner_device_ai_download_failed")
            }
        case .download:
            return localizedDeviceAiDownloadFailure(code: failure.code, retryable: failure.retryable)
        case .smoke:
            switch failure.code {
            case "IOS_TARGET_NOT_READY":
                return L10n.t("flow_runner_device_ai_smoke_target_not_ready")
            case "IOS_LAUNCH_FAILED":
                return L10n.t("flow_runner_device_ai_smoke_launch_failed")
            default:
                return L10n.t("flow_runner_device_ai_smoke_failed")
            }
        case .persistence:
            return L10n.t("flow_runner_device_ai_report_write_failed")
        }
    }

    private func localizedDeviceAiDownloadFailure(code: String, retryable: Bool) -> String {
        switch code {
        case HuggingFaceModelManagerErrorCode.invalidModelReference.rawValue:
            return L10n.t("flow_runner_device_ai_invalid_model_ref")
        case HuggingFaceModelManagerErrorCode.invalidFileName.rawValue:
            return L10n.t("flow_runner_device_ai_model_file_name_required")
        case HuggingFaceModelManagerErrorCode.unauthorized.rawValue:
            return L10n.t("flow_runner_device_ai_unauthorized")
        case HuggingFaceModelManagerErrorCode.invalidRevision.rawValue:
            return L10n.t("flow_runner_device_ai_invalid_revision")
        case HuggingFaceModelManagerErrorCode.notFound.rawValue:
            return L10n.t("flow_runner_device_ai_not_found")
        case HuggingFaceModelManagerErrorCode.checksumMismatch.rawValue:
            return L10n.t("flow_runner_device_ai_checksum_mismatch")
        default:
            return retryable
                ? L10n.t("flow_runner_device_ai_download_failed_retryable")
                : L10n.t("flow_runner_device_ai_download_failed")
        }
    }
}

private extension String {
    var trimmedOrNil: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
