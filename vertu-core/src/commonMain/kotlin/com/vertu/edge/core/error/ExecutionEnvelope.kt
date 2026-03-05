package com.vertu.edge.core.error

import com.vertu.edge.core.flow.FlowExecutionState
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Error categories mapped to deterministic UI states and retry policy. */
@Serializable
enum class ErrorCategory {
  NETWORK,
  AUTH,
  VALIDATION,
  DRIVER,
  TIMEOUT,
  INTERNAL,
}

/** Typed error details envelope used by all Vertu boundaries. */
@Serializable
data class ExecutionError(
  val code: String,
  val category: ErrorCategory,
  val message: String,
  val retryable: Boolean,
  val correlationId: String,
  val details: Map<String, String> = emptyMap(),
)

/** Unified envelope shared by app runtime, drivers, and tooling. */
@Serializable
data class ExecutionResultEnvelope<T>(
  val state: FlowExecutionState,
  val correlationId: String,
  val payload: T? = null,
  val error: ExecutionError? = null,
)

/** Result payload describing step-level execution status. */
@Serializable
data class DriverExecutionReport(
  val appId: String,
  val completedSteps: Int,
  val totalSteps: Int,
  val stepReports: List<StepReport>,
  val artifacts: DriverArtifacts,
)

/** Step-level status for deterministic logs and UI traces. */
@Serializable
data class StepReport(
  val index: Int,
  /** camelCase command type name (e.g., "tapOn", "inputText"). */
  val commandType: String,
  val status: StepStatus,
  val durationMs: Long,
  val message: String = "",
  /** ISO 8601 start timestamp. */
  val startedAt: String? = null,
  /** ISO 8601 end timestamp. */
  val endedAt: String? = null,
)

/** Canonical cross-platform step report aligned with TypeScript FlowStepReport contract. */
@Serializable
data class FlowStepReport(
  val index: Int,
  /** camelCase command type name (e.g., "tapOn", "inputText"). */
  val commandType: String,
  val status: StepStatus,
  val durationMs: Long,
  val message: String? = null,
  /** ISO 8601 start timestamp. */
  val startedAt: String? = null,
  /** ISO 8601 end timestamp. */
  val endedAt: String? = null,
)

/** Success/failure status for a single flow step. */
@Serializable
enum class StepStatus {
  @SerialName("success") SUCCESS,
  @SerialName("failed") FAILED,
  @SerialName("skipped") SKIPPED,
  @SerialName("unsupported") UNSUPPORTED,
}

/** Failure artifacts gathered by platform drivers. */
@Serializable
data class DriverArtifacts(
  @SerialName("lastScreenshotPath") val lastScreenshotPath: String? = null,
  @SerialName("uiHierarchyPath") val uiHierarchyPath: String? = null,
)
