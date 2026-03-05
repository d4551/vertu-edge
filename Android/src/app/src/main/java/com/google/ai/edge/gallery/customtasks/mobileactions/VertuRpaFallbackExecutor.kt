package com.google.ai.edge.gallery.customtasks.mobileactions

import android.content.Context
import com.google.ai.edge.gallery.R
import com.vertu.edge.core.flow.FlowCommand
import com.vertu.edge.core.flow.FlowExecutionState
import com.vertu.edge.core.flow.FlowV1
import com.vertu.edge.core.flow.FlowYamlParser
import com.vertu.edge.rpa.android.AndroidUiAutomatorDriver
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Safety outcome for fallback flow execution. */
enum class SafetyOutcome {
  ALLOW,
  REQUIRE_CONFIRMATION,
  BLOCK,
}

/** Risk level for command and flow policy classification. */
enum class SafetyRiskLevel {
  LOW,
  MEDIUM,
  HIGH,
}

/** Decision model returned by the safety policy. */
data class FlowSafetyDecision(
  val outcome: SafetyOutcome,
  val risk: SafetyRiskLevel,
  val reason: String,
)

/** In-memory consent grant for a risk-approved run. */
data class ConsentGrant(
  val token: String,
  val correlationId: String,
  val riskLevel: SafetyRiskLevel,
  val issuedAtMs: Long,
  val expiresAtMs: Long,
  val commandCount: Int,
)

/** Audit row for consent evaluation decisions. */
data class ConsentAuditRecord(
  val correlationId: String,
  val token: String?,
  val decision: String,
  val reason: String,
  val atMs: Long,
)

/** Evaluates flow risk according to Vertu tiered guard defaults. */
object VertuFlowSafetyPolicy {
  /** Returns guard decision for [flow]. */
  fun evaluate(flow: FlowV1): FlowSafetyDecision {
    if (flow.steps.isEmpty()) {
      return FlowSafetyDecision(
        outcome = SafetyOutcome.BLOCK,
        risk = SafetyRiskLevel.HIGH,
        reason = "Flow has no steps."
      )
    }

    val risk =
      flow.steps.fold(SafetyRiskLevel.LOW) { current, command ->
        maxRisk(current, classify(command))
      }

    return when (risk) {
      SafetyRiskLevel.LOW ->
        FlowSafetyDecision(
          outcome = SafetyOutcome.ALLOW,
          risk = risk,
          reason = "Flow contains low-risk read-only actions."
        )
      SafetyRiskLevel.MEDIUM ->
        FlowSafetyDecision(
          outcome = SafetyOutcome.REQUIRE_CONFIRMATION,
          risk = risk,
          reason = "Flow includes medium-risk interaction commands."
        )
      SafetyRiskLevel.HIGH ->
        FlowSafetyDecision(
          outcome = SafetyOutcome.REQUIRE_CONFIRMATION,
          risk = risk,
          reason = "Flow includes high-risk data mutation commands."
        )
    }
  }

  private fun classify(command: FlowCommand): SafetyRiskLevel {
    return when (command) {
      is FlowCommand.InputText,
      is FlowCommand.ClipboardWrite -> SafetyRiskLevel.HIGH
      is FlowCommand.TapOn,
      is FlowCommand.Scroll,
      is FlowCommand.Swipe,
      is FlowCommand.HideKeyboard,
      is FlowCommand.LaunchApp,
      is FlowCommand.SelectOption,
      is FlowCommand.WindowFocus -> SafetyRiskLevel.MEDIUM
      else -> SafetyRiskLevel.LOW
    }
  }

  private fun maxRisk(left: SafetyRiskLevel, right: SafetyRiskLevel): SafetyRiskLevel {
    return if (left.ordinal >= right.ordinal) left else right
  }
}

/** Stores and validates per-run safety consents with audit trail. */
@Singleton
class VertuFlowConsentRegistry @Inject constructor() {
  private val grants = ConcurrentHashMap<String, ConsentGrant>()
  private val auditByCorrelation = ConcurrentHashMap<String, MutableList<ConsentAuditRecord>>()
  private val consentTtlMs: Long = 5 * 60 * 1000

  /** Issues a consent token for one run correlation id. */
  fun issue(correlationId: String, riskLevel: SafetyRiskLevel, commandCount: Int): ConsentGrant {
    val now = System.currentTimeMillis()
    val grant =
      ConsentGrant(
        token = UUID.randomUUID().toString(),
        correlationId = correlationId,
        riskLevel = riskLevel,
        issuedAtMs = now,
        expiresAtMs = now + consentTtlMs,
        commandCount = commandCount,
      )
    grants[grant.token] = grant
    appendAudit(
      correlationId = correlationId,
      token = grant.token,
      decision = "issued",
      reason = "Consent token issued for ${riskLevel.name} risk flow.",
    )
    return grant
  }

  /** Validates and consumes consent token for one flow run. */
  fun consume(
    correlationId: String,
    token: String?,
    requiredRisk: SafetyRiskLevel,
  ): Boolean {
    if (token.isNullOrBlank()) {
      appendAudit(
        correlationId = correlationId,
        token = null,
        decision = "missing",
        reason = "Consent token was not provided.",
      )
      return false
    }

    val grant = grants[token]
    if (grant == null) {
      appendAudit(
        correlationId = correlationId,
        token = token,
        decision = "invalid",
        reason = "Consent token was not found.",
      )
      return false
    }

    val now = System.currentTimeMillis()
    if (grant.expiresAtMs <= now) {
      grants.remove(token)
      appendAudit(
        correlationId = correlationId,
        token = token,
        decision = "expired",
        reason = "Consent token has expired.",
      )
      return false
    }

    if (grant.correlationId != correlationId) {
      appendAudit(
        correlationId = correlationId,
        token = token,
        decision = "mismatch",
        reason = "Consent token correlation mismatch.",
      )
      return false
    }

    if (grant.riskLevel.ordinal < requiredRisk.ordinal) {
      appendAudit(
        correlationId = correlationId,
        token = token,
        decision = "insufficient",
        reason = "Consent token risk level is lower than required.",
      )
      return false
    }

    grants.remove(token)
    appendAudit(
      correlationId = correlationId,
      token = token,
      decision = "consumed",
      reason = "Consent token consumed for run execution.",
    )
    return true
  }

  /** Returns latest audit entry for a correlation id. */
  fun latestAudit(correlationId: String): ConsentAuditRecord? {
    return auditByCorrelation[correlationId]?.maxByOrNull { it.atMs }
  }

  private fun appendAudit(correlationId: String, token: String?, decision: String, reason: String) {
    val records = auditByCorrelation.getOrPut(correlationId) { mutableListOf() }
    records +=
      ConsentAuditRecord(
        correlationId = correlationId,
        token = token,
        decision = decision,
        reason = reason,
        atMs = System.currentTimeMillis(),
      )
  }
}

/** Executes RPA fallback flows generated by Mobile Actions tool calls. */
@Singleton
class VertuRpaFallbackExecutor
@Inject
constructor(
  @ApplicationContext private val context: Context,
  private val consentRegistry: VertuFlowConsentRegistry,
) {

  /** Parses, validates, applies consent policy, and executes YAML fallback flows. */
  suspend fun execute(
    flowYaml: String,
    consentToken: String? = null,
    correlationId: String? = null,
  ): String {
    val resolvedCorrelationId = correlationId?.trim().takeUnless { it.isNullOrEmpty() } ?: UUID.randomUUID().toString()
    val parsedFlow =
      runCatching { FlowYamlParser.parse(flowYaml) }
        .getOrElse {
          return errorEnvelope(
            state = "non-retryable-error",
            code = "FLOW_PARSE_FAILED",
            category = "validation",
            reason = context.getString(R.string.rpa_invalid_flow_yaml, it.message ?: "unknown parse error"),
            retryable = false,
            correlationId = resolvedCorrelationId,
            resource = "flowYaml",
          ).toString()
        }

    val safetyDecision = VertuFlowSafetyPolicy.evaluate(parsedFlow)
    return when (safetyDecision.outcome) {
      SafetyOutcome.BLOCK ->
        errorEnvelope(
          state = "non-retryable-error",
          code = "FLOW_BLOCKED_BY_SAFETY",
          category = "authorization",
          reason = context.getString(R.string.rpa_blocked_by_safety),
          retryable = false,
          correlationId = resolvedCorrelationId,
          resource = "flowSafetyPolicy",
        ).toString()

      SafetyOutcome.REQUIRE_CONFIRMATION -> {
        val granted =
          consentRegistry.consume(
            correlationId = resolvedCorrelationId,
            token = consentToken,
            requiredRisk = safetyDecision.risk,
          )

        if (!granted) {
          val grant = consentRegistry.issue(
            correlationId = resolvedCorrelationId,
            riskLevel = safetyDecision.risk,
            commandCount = parsedFlow.steps.size,
          )
          confirmationEnvelope(
            reason = context.getString(R.string.rpa_confirmation_required),
            correlationId = resolvedCorrelationId,
            grant = grant,
          ).toString()
        } else {
          runFlow(parsedFlow, resolvedCorrelationId).toString()
        }
      }

      SafetyOutcome.ALLOW -> runFlow(parsedFlow, resolvedCorrelationId).toString()
    }
  }

  private suspend fun runFlow(flow: FlowV1, correlationId: String): JSONObject {
    val result =
      runCatching { withContext(Dispatchers.IO) { AndroidUiAutomatorDriver(context = context).execute(flow) } }
        .getOrElse { error ->
          return errorEnvelope(
            state = "retryable-error",
            code = "FLOW_RUNTIME_UNAVAILABLE",
            category = "dependency",
            reason = context.getString(R.string.rpa_runtime_unavailable, error.message ?: "UIAutomator unavailable"),
            retryable = true,
            correlationId = correlationId,
            resource = "AndroidUiAutomatorDriver",
          )
        }

    return when (result.state) {
      FlowExecutionState.SUCCESS ->
        JSONObject()
          .put("state", "success")
          .put("message", context.getString(R.string.rpa_flow_executed_successfully))
          .put("correlationId", correlationId)
      FlowExecutionState.ERROR_RETRYABLE ->
        errorEnvelope(
          state = "retryable-error",
          code = "FLOW_EXECUTION_FAILED",
          category = "runtime",
          reason = context.getString(R.string.rpa_flow_execution_failed, result.error?.message ?: "unknown error"),
          retryable = true,
          correlationId = correlationId,
          resource = "flowExecution",
        )
      FlowExecutionState.ERROR_NON_RETRYABLE,
      FlowExecutionState.UNAUTHORIZED ->
        errorEnvelope(
          state = "non-retryable-error",
          code = "FLOW_EXECUTION_FAILED",
          category = "runtime",
          reason = context.getString(R.string.rpa_flow_execution_failed, result.error?.message ?: "unknown error"),
          retryable = false,
          correlationId = correlationId,
          resource = "flowExecution",
        )
      else ->
        JSONObject()
          .put("state", "loading")
          .put("message", context.getString(R.string.rpa_flow_finished_with_state, result.state.name))
          .put("correlationId", correlationId)
    }
  }

  private fun confirmationEnvelope(reason: String, correlationId: String, grant: ConsentGrant): JSONObject {
    return JSONObject()
      .put("state", "requires_confirmation")
      .put("message", reason)
      .put("correlationId", correlationId)
      .put("retryable", true)
      .put(
        "error",
        JSONObject()
          .put("code", "FLOW_CONFIRMATION_REQUIRED")
          .put("category", "authorization")
          .put("reason", reason)
          .put("retryable", true)
          .put("correlationId", correlationId)
          .put("surface", "flow")
          .put("resource", "consentToken"),
      )
      .put(
        "consent",
        JSONObject()
          .put("token", grant.token)
          .put("riskLevel", grant.riskLevel.name.lowercase())
          .put("issuedAt", grant.issuedAtMs)
          .put("expiresAt", grant.expiresAtMs)
          .put("commandCount", grant.commandCount),
      )
      .put(
        "audit",
        consentRegistry.latestAudit(correlationId)?.let { audit ->
          JSONObject()
            .put("decision", audit.decision)
            .put("reason", audit.reason)
            .put("at", audit.atMs)
        } ?: JSONObject()
      )
  }

  private fun errorEnvelope(
    state: String,
    code: String,
    category: String,
    reason: String,
    retryable: Boolean,
    correlationId: String,
    resource: String,
  ): JSONObject {
    return JSONObject()
      .put("state", state)
      .put("message", reason)
      .put("correlationId", correlationId)
      .put(
        "error",
        JSONObject()
          .put("code", code)
          .put("category", category)
          .put("reason", reason)
          .put("retryable", retryable)
          .put("correlationId", correlationId)
          .put("surface", "flow")
          .put("resource", resource),
      )
  }
}
