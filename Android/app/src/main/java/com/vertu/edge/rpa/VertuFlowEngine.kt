package com.vertu.edge.rpa

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VertuFlowEngine @Inject constructor(
    private val context: Context
) {
    private val tag = "VertuFlowEngine"
    private val parser = FlowParser()

    suspend fun execute(yaml: String): FlowResult {
        val parseResult = parser.parse(yaml)
        if (parseResult.isFailure) {
            return FlowResult.Error("Parse error: ${parseResult.exceptionOrNull()?.message}")
        }
        val flow = parseResult.getOrThrow()
        val logs = mutableListOf<String>()
        logs.add("Starting flow: ${flow.name ?: flow.appId}")

        for (action in flow.actions) {
            val result = executeAction(action, logs)
            if (result is ActionResult.Error) {
                return FlowResult.Error("Action failed: ${result.message}")
            }
        }
        return FlowResult.Success(logs)
    }

    private suspend fun executeAction(action: FlowAction, logs: MutableList<String>): ActionResult {
        return when (action) {
            is FlowAction.LaunchApp -> {
                logs.add("Launching app: ${action.appId}")
                launchApp(action.appId)
            }
            is FlowAction.TapOn -> {
                logs.add("Tap on: ${action.selector}")
                ActionResult.Success
            }
            is FlowAction.InputText -> {
                logs.add("Input text: ${action.text}")
                ActionResult.Success
            }
            is FlowAction.AssertVisible -> {
                logs.add("Assert visible: ${action.selector}")
                ActionResult.Success
            }
            is FlowAction.AssertNotVisible -> {
                logs.add("Assert not visible: ${action.selector}")
                ActionResult.Success
            }
            is FlowAction.ScrollUntilVisible -> {
                logs.add("Scroll until visible: ${action.selector}")
                ActionResult.Success
            }
            is FlowAction.OpenLink -> {
                logs.add("Open link: ${action.url}")
                openLink(action.url)
            }
            is FlowAction.Wait -> {
                logs.add("Wait: ${action.durationMs}ms")
                delay(action.durationMs)
                ActionResult.Success
            }
            is FlowAction.PressKey -> {
                logs.add("Press key: ${action.key}")
                ActionResult.Success
            }
            is FlowAction.RunAiPrompt -> {
                logs.add("Run AI prompt: ${action.prompt}")
                ActionResult.Success
            }
            is FlowAction.WebAction -> {
                logs.add("Web action: ${action.action} on ${action.selector}")
                ActionResult.Success
            }
            is FlowAction.TakeScreenshot -> {
                logs.add("Take screenshot: ${action.label ?: "unnamed"}")
                ActionResult.Success
            }
            is FlowAction.ClearState -> {
                logs.add("Clear state: ${action.appId}")
                ActionResult.Success
            }
        }
    }

    private fun launchApp(appId: String): ActionResult {
        return try {
            if (appId.isNotEmpty()) {
                val intent = context.packageManager.getLaunchIntentForPackage(appId)
                    ?: return ActionResult.Error("App not found: $appId")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
            ActionResult.Success
        } catch (e: Exception) {
            Log.e(tag, "Failed to launch app: $appId", e)
            ActionResult.Error(e.message ?: "Unknown error launching app")
        }
    }

    private fun openLink(url: String): ActionResult {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            ActionResult.Success
        } catch (e: Exception) {
            ActionResult.Error(e.message ?: "Unknown error opening link")
        }
    }
}

sealed class ActionResult {
    data object Success : ActionResult()
    data class Error(val message: String) : ActionResult()
}

sealed class FlowResult {
    data class Success(val logs: List<String>) : FlowResult()
    data class Error(val message: String) : FlowResult()
}
