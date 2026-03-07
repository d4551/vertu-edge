package com.google.ai.edge.gallery.data

import com.vertu.edge.core.flow.FlowExecutionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ControlPlaneResponseParserTest {
  @Test
  fun parseEnvelopeBody_extractsEncodedEnvelopeFromHtml() {
    val html =
      """
      <section data-state="success" data-envelope="{&quot;route&quot;:&quot;/api/models/sources&quot;,&quot;state&quot;:&quot;success&quot;}">
        ok
      </section>
      """.trimIndent()

    val envelope = ControlPlaneResponseParser.parseEnvelopeBody(html)

    assertEquals("""{"route":"/api/models/sources","state":"success"}""", envelope)
  }

  @Test
  fun parseStateMessage_returnsNormalizedStateAndStrippedMessage() {
    val response =
      """
      <div id="floating-chat-model-state" data-state="error-retryable">
        <span>Try again<br/>later</span>
      </div>
      """.trimIndent()

    val stateMessage =
      ControlPlaneResponseParser.parseStateMessage(
        response = response,
        stateId = "floating-chat-model-state",
      )

    assertEquals(FlowExecutionState.ERROR_RETRYABLE, stateMessage.first)
    assertEquals("Try again later", stateMessage.second)
  }

  @Test
  fun extractSelectedOption_returnsNullWhenSelectedValueIsMissing() {
    val response =
      """
      <select>
        <option value="glm-4">GLM 4</option>
        <option selected>Missing value</option>
      </select>
      """.trimIndent()

    val selected = ControlPlaneResponseParser.extractSelectedOption(response)

    assertNull(selected)
  }
}
