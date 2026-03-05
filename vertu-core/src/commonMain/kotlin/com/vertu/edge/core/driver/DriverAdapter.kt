package com.vertu.edge.core.driver

import com.vertu.edge.core.error.ExecutionResultEnvelope
import com.vertu.edge.core.error.DriverExecutionReport
import com.vertu.edge.core.flow.FlowV1
import kotlinx.serialization.Serializable

/** Risk class used by tiered action guards. */
@Serializable
enum class RiskLevel {
  LOW,
  MEDIUM,
  HIGH,
}

/** Guard decision for each step before execution. */
@Serializable
enum class GuardDecision {
  AUTO_RUN,
  REQUIRE_CONFIRMATION,
  BLOCK,
}

/** Driver retry/backoff/cancellation configuration. */
@Serializable
data class DriverExecutionConfig(
  val maxAttempts: Int = 3,
  val initialBackoffMs: Long = 250,
  val maxBackoffMs: Long = 2_000,
  val defaultStepTimeoutMs: Long = 5_000,
)

/** Runtime driver contract implemented by platform adapters. */
interface DriverAdapter {
  /** Executes [flow] and returns typed result envelope with artifacts. */
  suspend fun execute(
    flow: FlowV1,
    config: DriverExecutionConfig = DriverExecutionConfig(),
  ): ExecutionResultEnvelope<DriverExecutionReport>
}
