package com.vertu.edge.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Source of model delivery and trust boundary. */
@Serializable
enum class ModelSource {
  @SerialName("huggingface")
  HUGGINGFACE,
  @SerialName("local")
  LOCAL,
}

/** Manifest root for model allowlist v2. */
@Serializable
data class ModelManifestV2(
  val models: List<ModelManifestEntryV2>,
)

/** Model entry contract aligned across Android, iOS, and Bun tooling. */
@Serializable
data class ModelManifestEntryV2(
  val name: String,
  val modelId: String,
  val modelFile: String,
  val description: String,
  val sizeInBytes: Long,
  val estimatedPeakMemoryInBytes: Long,
  val taskTypes: List<String>,
  val source: ModelSource = ModelSource.HUGGINGFACE,
  val sha256: String? = null,
  val commitHash: String? = null,
  val version: String? = null,
)
