// Vertu branded UI components — cross-platform parity with Android VertuOperatorComponents.kt
// and web control-plane brand-overrides.css.
//
// Component names follow the unified naming convention:
//   Android: VertuPanel, VertuChip, VertuPrimaryButton, etc.
//   iOS:     VertuPanel, VertuChip, VertuPrimaryButton, etc.  (this file)
//   Web:     .card.vertu-panel, .badge, .btn.btn-primary, etc.
//
// Copyright 2025 Google LLC
// Licensed under the Apache License, Version 2.0.

import SwiftUI
import VertuEdgeCore

// MARK: - VertuPanel (28pt radius — matches Android VertuPanelShape / web .vertu-panel)

/// Elevated branded panel used across operator surfaces.
public struct VertuPanel<Content: View>: View {
    let title: String
    let subtitle: String?
    let content: Content

    @Environment(\.colorScheme) private var colorScheme

    public init(title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    public var body: some View {
        let colors = VertuTheme.resolved(for: colorScheme)
        VStack(alignment: .leading, spacing: VertuTheme.Spacing.panelGap) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(.title3, design: .rounded, weight: .semibold))
                    .foregroundStyle(colors.onSurface)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(.subheadline, design: .rounded, weight: .medium))
                        .foregroundStyle(colors.onSurfaceVariant)
                }
            }
            content
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: VertuTheme.Shape.panel, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [colors.surface.opacity(0.97), colors.background.opacity(0.96)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: VertuTheme.Shape.panel, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [VertuTheme.gold.opacity(0.62), Color.white.opacity(0.06)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: Color.black.opacity(0.28), radius: 22, x: 0, y: 12)
    }
}

// MARK: - VertuChip (capsule — matches Android VertuChipShape / web .vertu-chip)

/// Branded runtime/status chip.
public struct VertuChip: View {
    let label: String
    let accent: Color

    public init(label: String, accent: Color) {
        self.label = label
        self.accent = accent
    }

    public var body: some View {
        Text(label)
            .font(.system(.caption, design: .rounded, weight: .semibold))
            .foregroundStyle(accent)
            .padding(.horizontal, VertuTheme.Spacing.chipPaddingH)
            .padding(.vertical, VertuTheme.Spacing.chipPaddingV)
            .background(accent.opacity(0.14), in: Capsule())
            .overlay(Capsule().stroke(accent.opacity(0.35), lineWidth: 1))
    }
}

// MARK: - VertuField (label + content — matches Android VertuInput label pattern)

/// Label wrapper for a form field.
public struct VertuField<Content: View>: View {
    let title: String
    let content: Content

    public init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: VertuTheme.Spacing.iconGap) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(VertuTheme.gold.opacity(0.92))
            content
        }
    }
}

// MARK: - VertuInputStyle (18pt radius — matches Android VertuInputShape / web .vertu-input)

/// Branded text field style with gold focus indicator.
public struct VertuInputStyle: TextFieldStyle {
    @Environment(\.colorScheme) private var colorScheme

    public init() {}

    public func _body(configuration: TextField<Self._Label>) -> some View {
        let colors = VertuTheme.resolved(for: colorScheme)
        configuration
            .font(.system(.body, design: .rounded, weight: .medium))
            .foregroundStyle(colors.onSurface)
            .padding(.horizontal, 14)
            .padding(.vertical, VertuTheme.Spacing.buttonPaddingV)
            .background(
                RoundedRectangle(cornerRadius: VertuTheme.Shape.button, style: .continuous)
                    .fill(colors.surface.opacity(0.72))
            )
            .overlay(
                RoundedRectangle(cornerRadius: VertuTheme.Shape.button, style: .continuous)
                    .stroke(VertuTheme.gold.opacity(0.24), lineWidth: 1)
            )
    }
}

// MARK: - VertuPrimaryButton (18pt radius — matches Android/web primary button)

/// Gold background action button.
public struct VertuPrimaryButton: View {
    let title: String
    let isDisabled: Bool
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    public init(title: String, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isDisabled = isDisabled
        self.action = action
    }

    public var body: some View {
        let colors = VertuTheme.resolved(for: colorScheme)
        Button(action: action) {
            Text(title)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, VertuTheme.Spacing.buttonPaddingV)
        }
        .buttonStyle(.plain)
        .foregroundStyle(colors.onPrimary)
        .background(
            RoundedRectangle(cornerRadius: VertuTheme.Shape.button, style: .continuous)
                .fill(isDisabled ? VertuTheme.gold.opacity(0.35) : VertuTheme.gold)
        )
        .opacity(isDisabled ? 0.62 : 1)
        .disabled(isDisabled)
    }
}

// MARK: - VertuSecondaryButton (18pt radius — outlined gold border)

/// Outlined action button with gold border.
public struct VertuSecondaryButton: View {
    let title: String
    let isDisabled: Bool
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    public init(title: String, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isDisabled = isDisabled
        self.action = action
    }

    public var body: some View {
        let colors = VertuTheme.resolved(for: colorScheme)
        Button(action: action) {
            Text(title)
                .font(.system(.subheadline, design: .rounded, weight: .medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, VertuTheme.Spacing.buttonPaddingV)
        }
        .buttonStyle(.plain)
        .foregroundStyle(isDisabled ? colors.onSurface.opacity(0.4) : colors.onSurface)
        .background(
            RoundedRectangle(cornerRadius: VertuTheme.Shape.button, style: .continuous)
                .stroke(VertuTheme.gold.opacity(isDisabled ? 0.18 : 0.38), lineWidth: 1)
                .background(
                    RoundedRectangle(cornerRadius: VertuTheme.Shape.button, style: .continuous)
                        .fill(colors.background.opacity(0.26))
                )
        )
        .disabled(isDisabled)
    }
}

// MARK: - VertuStatusCard (22pt radius — matches Android VertuStatusCard)

/// Status display card with title, detail, state indicator, and action button.
public struct VertuStatusCard: View {
    let title: String
    let detail: String
    let state: FlowExecutionState
    let actionTitle: String
    let actionDisabled: Bool
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    public init(
        title: String,
        detail: String,
        state: FlowExecutionState,
        actionTitle: String,
        actionDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.detail = detail
        self.state = state
        self.actionTitle = actionTitle
        self.actionDisabled = actionDisabled
        self.action = action
    }

    public var body: some View {
        let colors = VertuTheme.resolved(for: colorScheme)
        let stateAccent = state.resolvedAccentColor(for: colorScheme)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(colors.onSurface)
                    Text(state.localizedOperatorLabel)
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .foregroundStyle(stateAccent)
                }
                Spacer(minLength: 12)
                VertuChip(label: state.localizedOperatorLabel, accent: stateAccent)
            }
            Text(detail)
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(colors.onSurfaceVariant)
                .frame(maxWidth: .infinity, alignment: .leading)
            VertuPrimaryButton(title: actionTitle, isDisabled: actionDisabled, action: action)
        }
        .padding(VertuTheme.Spacing.buttonPaddingH)
        .background(
            RoundedRectangle(cornerRadius: VertuTheme.Shape.bubble, style: .continuous)
                .fill(stateAccent.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: VertuTheme.Shape.bubble, style: .continuous)
                .stroke(stateAccent.opacity(0.26), lineWidth: 1)
        )
    }
}

// MARK: - VertuTimelineBubble (22pt radius — matches Android VertuTimelineBubble / web .vertu-bubble)

/// Chat-style conversation bubble with role-based styling.
struct VertuTimelineBubble: View {
    let entry: OperatorConversationEntry

    @Environment(\.colorScheme) private var colorScheme

    public var body: some View {
        let stateAccent = entry.state.resolvedAccentColor(for: colorScheme)
        VStack(alignment: entry.horizontalAlignment, spacing: 6) {
            Text(entry.title)
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(entry.role.accent.opacity(0.92))
            Text(entry.body)
                .font(.system(.body, design: .rounded, weight: .medium))
                .foregroundStyle(VertuTheme.resolved(for: colorScheme).onSurface)
                .multilineTextAlignment(entry.textAlignment)
                .frame(maxWidth: .infinity, alignment: entry.frameAlignment)
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: VertuTheme.Shape.bubble, style: .continuous)
                        .fill(entry.role.background.opacity(0.96))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: VertuTheme.Shape.bubble, style: .continuous)
                        .stroke(entry.role.accent.opacity(0.26), lineWidth: 1)
                )
            Text(entry.state.localizedOperatorLabel)
                .font(.system(.caption2, design: .rounded, weight: .semibold))
                .foregroundStyle(stateAccent.opacity(0.88))
        }
        .frame(maxWidth: .infinity, alignment: entry.frameAlignment)
    }
}

// MARK: - VertuFloatingChatBubble (circle — matches Android/web FAB)

/// Floating action button for AI chat entry point.
public struct VertuFloatingChatBubble: View {
    let systemImageName: String
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    public init(systemImageName: String = "bubble.left.and.bubble.right.fill", action: @escaping () -> Void) {
        self.systemImageName = systemImageName
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImageName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(VertuTheme.resolved(for: colorScheme).onPrimary)
                .frame(width: 48, height: 48)
                .background(Circle().fill(VertuTheme.gold))
                .shadow(color: Color.black.opacity(0.28), radius: 12, x: 0, y: 6)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - FlowExecutionState Color Helpers

extension FlowExecutionState {
    /// Resolve state accent color using the shared semantic palette.
    func resolvedAccentColor(for scheme: ColorScheme) -> Color {
        let colors = VertuTheme.resolved(for: scheme)
        switch self {
        case .idle:
            return colors.onSurfaceVariant
        case .loading:
            return VertuTheme.gold
        case .success:
            return colors.success
        case .empty:
            return colors.info
        case .errorRetryable, .errorNonRetryable, .unauthorized:
            return colors.error
        }
    }

    /// Convenience accent color (dark-mode default) for non-View contexts.
    var accentColor: Color {
        resolvedAccentColor(for: .dark)
    }

    /// Localized operator-facing label for the current state.
    var localizedOperatorLabel: String {
        switch self {
        case .idle: return L10n.t("flow_runner_state_idle")
        case .loading: return L10n.t("flow_runner_state_loading")
        case .success: return L10n.t("flow_runner_state_success")
        case .empty: return L10n.t("flow_runner_state_empty")
        case .errorRetryable: return L10n.t("flow_runner_state_error_retryable")
        case .errorNonRetryable: return L10n.t("flow_runner_state_error_non_retryable")
        case .unauthorized: return L10n.t("flow_runner_state_unauthorized")
        }
    }
}

// MARK: - OperatorConversationEntry Layout Helpers

extension OperatorConversationEntry {
    var frameAlignment: Alignment {
        switch role {
        case .user: return .trailing
        case .assistant, .runtime, .system, .warning: return .leading
        }
    }

    var horizontalAlignment: HorizontalAlignment {
        switch role {
        case .user: return .trailing
        case .assistant, .runtime, .system, .warning: return .leading
        }
    }

    var textAlignment: TextAlignment {
        switch role {
        case .user: return .trailing
        case .assistant, .runtime, .system, .warning: return .leading
        }
    }
}

// MARK: - OperatorConversationRole Visual Properties

extension OperatorConversationRole {
    var accent: Color {
        switch self {
        case .system: return VertuTheme.goldLight
        case .user: return VertuTheme.gold
        case .assistant: return VertuTheme.cream
        case .runtime: return Color(red: 0.53, green: 0.82, blue: 0.72)
        case .warning: return Color(red: 0.95, green: 0.46, blue: 0.39)
        }
    }

    var background: Color {
        switch self {
        case .system: return VertuTheme.charcoal.opacity(0.88)
        case .user: return VertuTheme.goldDeep.opacity(0.24)
        case .assistant: return VertuTheme.black.opacity(0.86)
        case .runtime: return Color(red: 0.19, green: 0.31, blue: 0.27).opacity(0.9)
        case .warning: return Color(red: 0.33, green: 0.16, blue: 0.14).opacity(0.92)
        }
    }
}

// MARK: - Platform-Guarded View Modifiers

extension View {
    /// Disable autocapitalization on iOS; no-op on macOS.
    @ViewBuilder
    func vertuNoAutocapitalize() -> some View {
        #if canImport(UIKit)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }

    /// Set inline navigation title display on iOS; no-op on macOS.
    @ViewBuilder
    func vertuInlineNavTitle() -> some View {
        #if canImport(UIKit)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// Set number pad keyboard on iOS; no-op on macOS.
    @ViewBuilder
    func vertuNumberPadKeyboard() -> some View {
        #if canImport(UIKit)
        self.keyboardType(.numberPad)
        #else
        self
        #endif
    }
}
