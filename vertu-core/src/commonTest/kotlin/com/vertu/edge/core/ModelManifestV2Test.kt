package com.vertu.edge.core

import com.vertu.edge.core.model.ModelManifestEntryV2
import com.vertu.edge.core.model.ModelSource
import kotlin.test.Test
import kotlin.test.assertEquals

class ModelManifestV2Test {
  @Test
  fun sourceDefaultsToHuggingFace() {
    val entry =
      ModelManifestEntryV2(
        name = "Gemma 3",
        modelId = "google/gemma-3",
        modelFile = "gemma3.task",
        description = "Test",
        sizeInBytes = 1,
        estimatedPeakMemoryInBytes = 2,
        taskTypes = listOf("llm_chat"),
      )

    assertEquals(ModelSource.HUGGINGFACE, entry.source)
  }
}
