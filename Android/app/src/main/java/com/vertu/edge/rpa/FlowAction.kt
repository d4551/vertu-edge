package com.vertu.edge.rpa

sealed class FlowAction {
    data class LaunchApp(val appId: String) : FlowAction()
    data class TapOn(val selector: String, val optional: Boolean = false) : FlowAction()
    data class InputText(val text: String) : FlowAction()
    data class AssertVisible(val selector: String) : FlowAction()
    data class AssertNotVisible(val selector: String) : FlowAction()
    data class ScrollUntilVisible(val selector: String, val direction: String = "down") : FlowAction()
    data class OpenLink(val url: String) : FlowAction()
    data class Wait(val durationMs: Long) : FlowAction()
    data class PressKey(val key: String) : FlowAction()
    data class RunAiPrompt(val prompt: String, val modelId: String? = null) : FlowAction()
    data class WebAction(val action: String, val selector: String? = null, val value: String? = null) : FlowAction()
    data class TakeScreenshot(val label: String? = null) : FlowAction()
    data class ClearState(val appId: String) : FlowAction()
}
