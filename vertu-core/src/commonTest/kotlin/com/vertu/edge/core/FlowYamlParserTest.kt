package com.vertu.edge.core

import com.vertu.edge.core.flow.CommandTarget
import com.vertu.edge.core.flow.FlowCommand
import com.vertu.edge.core.flow.FlowYamlParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class FlowYamlParserTest {
  @Test
  fun parseAndSerializeFlowV1() {
    val yaml =
      """
      appId: com.vertu.edge
      ---
      - launchApp
      - tapOn: "Create new contact"
      - inputText: "John"
      - assertVisible: "Contact saved"
      - assertNotVisible: "Error"
      - assertText: "Contact saved::Contact saved"
      - selectOption: "Language::English"
      - screenshot
      - waitForAnimation: 1000
      """
        .trimIndent()

    val flow = FlowYamlParser.parse(yaml)
    assertEquals("com.vertu.edge", flow.appId)
    assertEquals(9, flow.steps.size)
    assertIs<FlowCommand.TapOn>(flow.steps[1])
    assertEquals(CommandTarget(text = "Create new contact"), (flow.steps[1] as FlowCommand.TapOn).target)
    assertIs<FlowCommand.AssertText>(flow.steps[5])
    assertEquals("Contact saved", (flow.steps[5] as FlowCommand.AssertText).value)
    assertIs<FlowCommand.SelectOption>(flow.steps[6])
    assertEquals("English", (flow.steps[6] as FlowCommand.SelectOption).option)

    val serialized = FlowYamlParser.toYaml(flow)
    val reparsed = FlowYamlParser.parse(serialized)
    assertEquals(flow, reparsed)
  }
}
