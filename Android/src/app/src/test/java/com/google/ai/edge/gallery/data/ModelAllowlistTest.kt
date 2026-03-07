package com.google.ai.edge.gallery.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelAllowlistTest {
  @Test
  fun toModel_mapsDeviceAiCapabilitiesAndModelRef() {
    val allowedModel =
      AllowedModel(
        name = "AutoGLM-Phone-9B-Multilingual",
        modelId = "mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF",
        modelFile = "AutoGLM-Phone-9B-Multilingual.Q4_K_M.gguf",
        description = "device ai model",
        sizeInBytes = 1024L,
        commitHash = "abc123",
        defaultConfig =
          DefaultConfig(
            topK = 40,
            topP = 0.95f,
            temperature = 1.0f,
            accelerators = "cpu,gpu",
            maxTokens = 4096,
          ),
        taskTypes = listOf(BuiltInTaskId.LLM_CHAT, BuiltInTaskId.LLM_PROMPT_LAB),
        deviceAiSupportMobileActions = true,
        deviceAiSupportRpaControls = true,
        deviceAiSupportFlowCommands = true,
      )

    val model = allowedModel.toModel()

    assertEquals(
      "mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF",
      model.modelRef,
    )
    assertTrue(model.deviceAiSupportMobileActions)
    assertTrue(model.deviceAiSupportRpaControls)
    assertTrue(model.deviceAiSupportFlowCommands)
    assertTrue(model.supportsRequiredDeviceAiCapabilities())
  }
}
