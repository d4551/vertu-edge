package com.vertu.edge.rpa

import org.junit.Assert.*
import org.junit.Test

class FlowParserTest {
    private val parser = FlowParser()

    @Test
    fun `parse valid flow`() {
        val yaml = """
            appId: com.example.app
            name: Test Flow
            ---
            - launchApp: com.example.app
            - tapOn: "Create"
            - inputText: "Hello"
        """.trimIndent()
        val result = parser.parse(yaml)
        assertTrue(result.isSuccess)
        val flow = result.getOrThrow()
        assertEquals("com.example.app", flow.appId)
        assertEquals("Test Flow", flow.name)
        assertEquals(3, flow.actions.size)
    }

    @Test
    fun `parse missing appId returns failure`() {
        val yaml = "name: My Flow\n---\n- tapOn: Button"
        val result = parser.parse(yaml)
        assertTrue(result.isFailure)
    }

    @Test
    fun `parse all action types`() {
        val yaml = """
            appId: com.example
            ---
            - launchApp: com.example
            - tapOn: "Button"
            - inputText: "test"
            - assertVisible: "label"
            - assertNotVisible: "gone"
            - scrollUntilVisible: "item"
            - openLink: "https://vertu.com"
            - wait: 2000
            - pressKey: "Enter"
            - takeScreenshot: "step1"
            - clearState: com.example
        """.trimIndent()
        val result = parser.parse(yaml)
        assertTrue(result.isSuccess)
        assertEquals(11, result.getOrThrow().actions.size)
    }
}
