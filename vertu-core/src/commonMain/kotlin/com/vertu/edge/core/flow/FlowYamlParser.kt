package com.vertu.edge.core.flow

/** Parser and serializer for Maestro-style FlowV1 YAML syntax. */
object FlowYamlParser {
  /** Parses YAML text into [FlowV1]. */
  fun parse(yaml: String): FlowV1 {
    val lines = yaml.lines()
    var appId: String? = null
    val steps = mutableListOf<FlowCommand>()
    var inSteps = false

    for (rawLine in lines) {
      val line = rawLine.trim()
      if (line.isEmpty() || line.startsWith("#")) {
        continue
      }

      if (!inSteps) {
        if (line == "---") {
          inSteps = true
          continue
        }
        if (line.startsWith("appId:")) {
          val value = line.substringAfter(':', "").trim().unquote()
          if (value.isNotEmpty()) {
            appId = value
          }
        }
        continue
      }

      if (!line.startsWith("-")) {
        continue
      }
      val payload = line.removePrefix("-").trim()
      steps += parseStep(payload)
    }

    val resolvedAppId = appId ?: error("Flow YAML is missing required field: appId")
    return FlowV1(appId = resolvedAppId, steps = steps)
  }

  /** Serializes [FlowV1] into canonical YAML syntax for file storage and sharing. */
  fun toYaml(flow: FlowV1): String {
    val body = flow.steps.joinToString(separator = "\n") { command ->
      when (command) {
        FlowCommand.LaunchApp -> "- launchApp"
        is FlowCommand.TapOn -> "- tapOn: ${command.target.toYamlScalar()}"
        is FlowCommand.InputText -> "- inputText: \"${command.value.escape()}\""
        is FlowCommand.AssertVisible -> "- assertVisible: ${command.target.toYamlScalar()}"
        is FlowCommand.AssertNotVisible -> "- assertNotVisible: ${command.target.toYamlScalar()}"
        is FlowCommand.AssertText -> "- assertText: \"${command.target.toYamlScalarForInline()}::${command.value.escape()}\""
        is FlowCommand.SelectOption -> "- selectOption: \"${command.target.toYamlScalarForInline()}::${command.option.escape()}\""
        is FlowCommand.Scroll -> "- scroll: ${command.direction.name.lowercase()}"
        is FlowCommand.Swipe -> "- swipe: ${command.direction.name.lowercase()}"
        FlowCommand.Screenshot -> "- screenshot"
        FlowCommand.ClipboardRead -> "- clipboardRead"
        is FlowCommand.ClipboardWrite -> "- clipboardWrite: \"${command.value.escape()}\""
        is FlowCommand.WindowFocus -> "- windowFocus: \"${command.target.toYamlScalar()}\""
        FlowCommand.HideKeyboard -> "- hideKeyboard"
        is FlowCommand.WaitForAnimation -> "- waitForAnimation: ${command.timeoutMs}"
      }
    }
    return buildString {
      append("appId: ")
      append(flow.appId)
      append('\n')
      append("---")
      if (body.isNotEmpty()) {
        append('\n')
        append(body)
      }
    }
  }

  private fun parseStep(payload: String): FlowCommand {
    if (!payload.contains(':')) {
      return when (payload) {
        "launchApp" -> FlowCommand.LaunchApp
        "hideKeyboard" -> FlowCommand.HideKeyboard
        "screenshot" -> FlowCommand.Screenshot
        "clipboardRead" -> FlowCommand.ClipboardRead
        else -> error("Unsupported command: $payload")
      }
    }

    val key = payload.substringBefore(':').trim()
    val rawValue = payload.substringAfter(':').trim().unquote()

    return when (key) {
      "tapOn" -> FlowCommand.TapOn(rawValue.toTarget())
      "inputText" -> FlowCommand.InputText(rawValue)
      "assertVisible" -> FlowCommand.AssertVisible(rawValue.toTarget())
      "assertNotVisible" -> FlowCommand.AssertNotVisible(rawValue.toTarget())
      "assertText" -> {
        val parts = rawValue.split("::", limit = 2)
        val target = parts.firstOrNull()?.toTarget() ?: error("assertText target is missing")
        val value = parts.getOrNull(1) ?: error("assertText value is missing")
        FlowCommand.AssertText(target = target, value = value)
      }
      "selectOption" -> {
        val parts = rawValue.split("::", limit = 2)
        val target = parts.firstOrNull()?.toTarget() ?: error("selectOption target is missing")
        val option = parts.getOrNull(1) ?: error("selectOption option is missing")
        FlowCommand.SelectOption(target = target, option = option)
      }
      "scroll" -> FlowCommand.Scroll(direction = rawValue.toDirection())
      "swipe" -> FlowCommand.Swipe(direction = rawValue.toDirection())
      "clipboardWrite" -> FlowCommand.ClipboardWrite(value = rawValue)
      "windowFocus" -> FlowCommand.WindowFocus(target = rawValue.toWindowTarget())
      "waitForAnimation" -> FlowCommand.WaitForAnimation(timeoutMs = rawValue.toLongOrNull() ?: 600L)
      else -> error("Unsupported command: $key")
    }
  }

  private fun CommandTarget.toYamlScalar(): String {
    return when {
      text != null -> "\"${text.escape()}\""
      resourceId != null -> "\"id=${resourceId.escape()}\""
      contentDescription != null -> "\"contentDescription=${contentDescription.escape()}\""
      x != null && y != null -> "\"$x,$y\""
      else -> "\"\""
    }
  }

  private fun CommandTarget.toYamlScalarForInline(): String {
    return when {
      text != null -> text
      resourceId != null -> "id=$resourceId"
      contentDescription != null -> "contentDescription=$contentDescription"
      x != null && y != null -> "$x,$y"
      else -> ""
    }
  }

  private fun WindowTarget.toYamlScalar(): String {
    return when {
      appId != null && title != null -> "appId=${appId.escape()}|title=${title.escape()}"
      appId != null -> "appId=${appId.escape()}"
      title != null -> "title=${title.escape()}"
      else -> ""
    }
  }

  private fun String.toTarget(): CommandTarget {
    return when {
      startsWith("id=") -> CommandTarget(resourceId = removePrefix("id="))
      startsWith("contentDescription=") ->
        CommandTarget(contentDescription = removePrefix("contentDescription="))
      contains(',') && split(',').size == 2 -> {
        val parts = split(',')
        CommandTarget(x = parts[0].trim().toIntOrNull(), y = parts[1].trim().toIntOrNull())
      }
      else -> CommandTarget(text = this)
    }
  }

  private fun String.toDirection(): Direction {
    return when (uppercase()) {
      "UP" -> Direction.UP
      "DOWN" -> Direction.DOWN
      "LEFT" -> Direction.LEFT
      "RIGHT" -> Direction.RIGHT
      else -> error("Unsupported direction: $this")
    }
  }

  private fun String.toWindowTarget(): WindowTarget {
    val chunks = split('|').map { it.trim() }.filter { it.isNotEmpty() }
    var appId: String? = null
    var title: String? = null
    for (chunk in chunks) {
      when {
        chunk.startsWith("appId=") -> appId = chunk.removePrefix("appId=")
        chunk.startsWith("title=") -> title = chunk.removePrefix("title=")
      }
    }
    if (appId == null && title == null) {
      title = this
    }
    return WindowTarget(appId = appId, title = title)
  }

  private fun String.unquote(): String {
    if (length < 2) {
      return this
    }
    val startsAndEndsWithDouble = startsWith('"') && endsWith('"')
    val startsAndEndsWithSingle = startsWith('\'') && endsWith('\'')
    if (startsAndEndsWithDouble || startsAndEndsWithSingle) {
      return substring(1, length - 1)
    }
    return this
  }

  private fun String.escape(): String = replace("\\", "\\\\").replace("\"", "\\\"")
}
