package com.vertu.edge.rpa

import com.vertu.edge.common.AppConstants

data class FlowDefinition(
    val appId: String,
    val name: String? = null,
    val actions: List<FlowAction> = emptyList()
)

class FlowParser {

    fun parse(yaml: String): Result<FlowDefinition> = runCatching {
        val lines = yaml.lines()
        val headerLines = mutableListOf<String>()
        val actionLines = mutableListOf<String>()
        var foundSeparator = false

        for (line in lines) {
            if (line.trim() == "---") {
                foundSeparator = true
                continue
            }
            if (foundSeparator) actionLines.add(line) else headerLines.add(line)
        }

        val header = headerLines.joinToString("\n")
        val appId = extractValue(header, "appId") ?: error("appId is required in flow header")
        val name = extractValue(header, "name")

        val actions = parseActions(actionLines)
        FlowDefinition(appId = appId, name = name, actions = actions)
    }

    private fun extractValue(text: String, key: String): String? {
        val regex = Regex("^$key:\\s*(.+)$", RegexOption.MULTILINE)
        return regex.find(text)?.groupValues?.getOrNull(1)?.trim()?.removeSurrounding("\"")
    }

    private fun parseActions(lines: List<String>): List<FlowAction> {
        val actions = mutableListOf<FlowAction>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            when {
                line.startsWith("- launchApp:") -> {
                    val appId = line.removePrefix("- launchApp:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.LaunchApp(appId))
                }
                line == "- launchApp" -> {
                    actions.add(FlowAction.LaunchApp(""))
                }
                line.startsWith("- tapOn:") -> {
                    val selector = line.removePrefix("- tapOn:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.TapOn(selector))
                }
                line.startsWith("- inputText:") -> {
                    val text = line.removePrefix("- inputText:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.InputText(text))
                }
                line.startsWith("- assertVisible:") -> {
                    val selector = line.removePrefix("- assertVisible:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.AssertVisible(selector))
                }
                line.startsWith("- assertNotVisible:") -> {
                    val selector = line.removePrefix("- assertNotVisible:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.AssertNotVisible(selector))
                }
                line.startsWith("- scrollUntilVisible:") -> {
                    val selector = line.removePrefix("- scrollUntilVisible:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.ScrollUntilVisible(selector))
                }
                line.startsWith("- openLink:") -> {
                    val url = line.removePrefix("- openLink:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.OpenLink(url))
                }
                line.startsWith("- wait:") -> {
                    val ms = line.removePrefix("- wait:").trim().toLongOrNull()
                        ?: AppConstants.DEFAULT_FLOW_TIMEOUT_MS
                    actions.add(FlowAction.Wait(ms))
                }
                line.startsWith("- pressKey:") -> {
                    val key = line.removePrefix("- pressKey:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.PressKey(key))
                }
                line.startsWith("- runAiPrompt:") -> {
                    val prompt = line.removePrefix("- runAiPrompt:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.RunAiPrompt(prompt))
                }
                line.startsWith("- takeScreenshot") -> {
                    val label = if (line.contains(":")) {
                        line.substringAfter(":").trim().removeSurrounding("\"").ifEmpty { null }
                    } else null
                    actions.add(FlowAction.TakeScreenshot(label))
                }
                line.startsWith("- clearState:") -> {
                    val appId = line.removePrefix("- clearState:").trim().removeSurrounding("\"")
                    actions.add(FlowAction.ClearState(appId))
                }
            }
            i++
        }
        return actions
    }
}
