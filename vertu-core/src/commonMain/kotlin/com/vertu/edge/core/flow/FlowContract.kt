package com.vertu.edge.core.flow

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Canonical flow contract used by Android, iOS, and tooling. */
@Serializable
data class FlowV1(
  val version: String = FLOW_VERSION,
  val appId: String,
  val steps: List<FlowCommand>,
)

/** Supported flow version for Vertu runtime and toolchain. */
const val FLOW_VERSION = "1.0"

/** Selector target for UI interactions. */
@Serializable
data class CommandTarget(
  val resourceId: String? = null,
  val text: String? = null,
  val contentDescription: String? = null,
  val x: Int? = null,
  val y: Int? = null,
)

/** Window selector for desktop focus command. */
@Serializable
data class WindowTarget(
  val appId: String? = null,
  val title: String? = null,
)

/** Scroll/swipe direction. */
@Serializable
enum class Direction {
  UP,
  DOWN,
  LEFT,
  RIGHT,
}

/** Command set for FlowV1. */
@Serializable
sealed class FlowCommand {
  /** Launches the configured app. */
  @Serializable
  @SerialName("launchApp")
  data object LaunchApp : FlowCommand()

  /** Taps a UI element matched by selector priority. */
  @Serializable
  @SerialName("tapOn")
  data class TapOn(val target: CommandTarget) : FlowCommand()

  /** Enters text into the focused text field. */
  @Serializable
  @SerialName("inputText")
  data class InputText(val value: String) : FlowCommand()

  /** Asserts that a target is visible. */
  @Serializable
  @SerialName("assertVisible")
  data class AssertVisible(val target: CommandTarget) : FlowCommand()

  /** Asserts that a target is not visible. */
  @Serializable
  @SerialName("assertNotVisible")
  data class AssertNotVisible(val target: CommandTarget) : FlowCommand()

  /** Asserts target text equality. */
  @Serializable
  @SerialName("assertText")
  data class AssertText(val target: CommandTarget, val value: String) : FlowCommand()

  /** Selects an option value from the target element. */
  @Serializable
  @SerialName("selectOption")
  data class SelectOption(val target: CommandTarget, val option: String) : FlowCommand()

  /** Scrolls in a direction with optional step count. */
  @Serializable
  @SerialName("scroll")
  data class Scroll(val direction: Direction, val steps: Int = 32) : FlowCommand()

  /** Swipes in a direction with an optional normalized distance fraction. */
  @Serializable
  @SerialName("swipe")
  data class Swipe(val direction: Direction, val distanceFraction: Float = 0.7f) : FlowCommand()

  /** Captures a screenshot artifact. */
  @Serializable
  @SerialName("screenshot")
  data object Screenshot : FlowCommand()

  /** Reads current system clipboard. */
  @Serializable
  @SerialName("clipboardRead")
  data object ClipboardRead : FlowCommand()

  /** Writes value to system clipboard. */
  @Serializable
  @SerialName("clipboardWrite")
  data class ClipboardWrite(val value: String) : FlowCommand()

  /** Focuses desktop window by app id or title. */
  @Serializable
  @SerialName("windowFocus")
  data class WindowFocus(val target: WindowTarget) : FlowCommand()

  /** Dismisses software keyboard. */
  @Serializable
  @SerialName("hideKeyboard")
  data object HideKeyboard : FlowCommand()

  /** Waits for UI stabilization. */
  @Serializable
  @SerialName("waitForAnimation")
  data class WaitForAnimation(val timeoutMs: Long = 600L) : FlowCommand()
}

/** Runtime execution state to keep UI deterministic.
 * Wire format is kebab-case, matching the TypeScript control-plane and iOS raw values.
 */
@Serializable
enum class FlowExecutionState {
  @SerialName("idle") IDLE,
  @SerialName("loading") LOADING,
  @SerialName("success") SUCCESS,
  @SerialName("empty") EMPTY,
  @SerialName("error-retryable") ERROR_RETRYABLE,
  @SerialName("error-non-retryable") ERROR_NON_RETRYABLE,
  @SerialName("unauthorized") UNAUTHORIZED,
}
