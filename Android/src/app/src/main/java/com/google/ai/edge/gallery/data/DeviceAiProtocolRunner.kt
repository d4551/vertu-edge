package com.google.ai.edge.gallery.data

import com.google.ai.edge.gallery.common.StructuredLog
import com.google.ai.edge.gallery.common.VertuRuntimeConfig
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.annotations.SerializedName
import java.io.File
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import kotlinx.coroutines.withTimeout

private const val TAG = "AGDeviceAiProtocol"
private const val DEVICE_AI_PROTOCOL_HOST = "device_ai_protocol"
private const val DEVICE_AI_PROTOCOL_PATH = "/run"
private const val DEVICE_AI_PROTOCOL_REPORT_FILE = "latest.json"
private const val DEVICE_AI_PROTOCOL_RUNS_DIR = "runs"
private const val DEVICE_AI_PROTOCOL_VERSION = 1
private const val DEVICE_AI_PROTOCOL_STAGE_VALIDATE = "validate_request"
private const val DEVICE_AI_PROTOCOL_STAGE_RESOLVE = "resolve_model"
private const val DEVICE_AI_PROTOCOL_STAGE_DOWNLOAD = "download_model"
private const val DEVICE_AI_PROTOCOL_STAGE_SMOKE = "automation_smoke"

/** Source that triggered the native Android device-AI protocol. */
enum class DeviceAiProtocolTrigger {
  UI,
  AUTOMATION,
}

/** Nullable overrides passed into the Android device-AI protocol from UI or automation. */
data class DeviceAiProtocolLaunchRequest(
  val correlationId: String? = null,
  val modelRef: String? = null,
  val revision: String? = null,
  val fileName: String? = null,
  val expectedSha256: String? = null,
  val trigger: DeviceAiProtocolTrigger = DeviceAiProtocolTrigger.AUTOMATION,
)

/** Fully-resolved request consumed by the Android device-AI protocol runner. */
data class DeviceAiProtocolRunRequest(
  val correlationId: String,
  val modelRef: String,
  val revision: String,
  val fileName: String,
  val expectedSha256: String,
  val token: String? = null,
  val trigger: DeviceAiProtocolTrigger = DeviceAiProtocolTrigger.UI,
  val timeoutMs: Long = VertuRuntimeConfig.deviceAiProtocolTimeoutMs.toLong(),
)

/** Deterministic status for each protocol stage in the persisted report. */
enum class DeviceAiProtocolStageStatus {
  PASS,
  FAIL,
  SKIPPED,
}

/** Deterministic terminal state for the Android device-AI protocol. */
enum class DeviceAiProtocolTerminalState {
  SUCCESS,
  ERROR_RETRYABLE,
  ERROR_NON_RETRYABLE,
  UNAUTHORIZED,
}

/** Persisted stage result for the Android device-AI protocol report. */
data class DeviceAiProtocolStageReport(
  val name: String,
  val status: DeviceAiProtocolStageStatus,
  val code: String,
  val message: String,
)

/** Canonical device-AI capability identifiers persisted in native protocol reports. */
enum class DeviceAiProtocolCapability {
  @SerializedName("mobile_actions") MOBILE_ACTIONS,
  @SerializedName("rpa_controls") RPA_CONTROLS,
  @SerializedName("flow_commands") FLOW_COMMANDS,
}

/** Persisted evidence of the resolved model used by the protocol. */
data class DeviceAiProtocolModelEvidence(
  val modelRef: String,
  val revision: String,
  val fileName: String,
  val expectedSha256: String,
  val resolvedModelName: String,
  val capabilities: List<DeviceAiProtocolCapability>,
)

/** Persisted artifact metadata written by the Android device-AI protocol. */
data class DeviceAiProtocolArtifactReport(
  val path: String,
  val sha256: String,
  val sizeBytes: Long,
)

/** Persisted native Android device-AI protocol report. */
data class DeviceAiProtocolRunReport(
  val version: Int,
  val platform: String,
  val trigger: String,
  val correlationId: String,
  val status: String,
  val state: String,
  val code: String,
  val message: String,
  val startedAtEpochMs: Long,
  val completedAtEpochMs: Long,
  val reportPath: String,
  val latestReportPath: String,
  val model: DeviceAiProtocolModelEvidence,
  val artifact: DeviceAiProtocolArtifactReport?,
  val stages: List<DeviceAiProtocolStageReport>,
)

/** Result returned to UI and automation callers after the protocol report is persisted. */
data class DeviceAiProtocolRunResult(
  val terminalState: DeviceAiProtocolTerminalState,
  val code: String,
  val message: String,
  val correlationId: String,
  val artifactPath: String,
  val artifactSha256: String,
  val artifactSizeBytes: Long,
  val reportPath: String,
  val latestReportPath: String,
  val report: DeviceAiProtocolRunReport,
) {
  val retryable: Boolean
    get() = terminalState == DeviceAiProtocolTerminalState.ERROR_RETRYABLE
}

/** Parses adb/deep-link automation launches for the Android device-AI protocol. */
object DeviceAiProtocolAutomationParser {
  /** Parses a deep-link launch into a device-AI protocol request override. */
  fun parseDeepLink(dataString: String?, expectedScheme: String): DeviceAiProtocolLaunchRequest? {
    val rawData = dataString?.trim().orEmpty()
    if (rawData.isBlank()) {
      return null
    }
    val uri = runCatching { URI(rawData) }.getOrNull() ?: return null
    val scheme = uri.scheme?.trim().orEmpty()
    if (!scheme.equals(expectedScheme, ignoreCase = true)) {
      return null
    }
    val host = uri.host?.trim().orEmpty().ifBlank { uri.authority?.trim().orEmpty() }
    if (!host.equals(DEVICE_AI_PROTOCOL_HOST, ignoreCase = true)) {
      return null
    }
    val path = uri.path?.trim().orEmpty()
    if (!path.equals(DEVICE_AI_PROTOCOL_PATH, ignoreCase = true)) {
      return null
    }
    val query = parseQuery(uri.rawQuery)
    return DeviceAiProtocolLaunchRequest(
      correlationId = query["correlationId"],
      modelRef = query["modelRef"],
      revision = query["revision"],
      fileName = query["fileName"],
      expectedSha256 = query["sha256"],
      trigger = DeviceAiProtocolTrigger.AUTOMATION,
    )
  }

  private fun parseQuery(rawQuery: String?): Map<String, String> {
    return rawQuery
      ?.split('&')
      ?.mapNotNull { pair ->
        val index = pair.indexOf('=')
        if (index <= 0) {
          return@mapNotNull null
        }
        val key = decodeQueryComponent(pair.substring(0, index))
        val value = decodeQueryComponent(pair.substring(index + 1))
        if (key.isBlank()) {
          null
        } else {
          key to value
        }
      }
      ?.toMap()
      .orEmpty()
  }

  private fun decodeQueryComponent(raw: String): String {
    return URLDecoder.decode(raw, Charsets.UTF_8.name()).trim()
  }
}

/** Native Android owner for device-AI protocol execution, report persistence, and smoke checks. */
class DeviceAiProtocolRunner(
  private val appStorageRoot: File,
  private val downloadModel: suspend (model: Model, destination: File, token: String?) -> ModelDownloadResult,
  private val gson: Gson = GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create(),
  private val nowMs: () -> Long = { System.currentTimeMillis() },
  private val logger: DeviceAiProtocolLogger = AndroidDeviceAiProtocolLogger,
) {

  /** Executes the protocol and persists a deterministic report into app-managed storage. */
  suspend fun run(
    request: DeviceAiProtocolRunRequest,
    availableModels: List<Model>,
  ): DeviceAiProtocolRunResult {
    val startedAtEpochMs = nowMs()
    val reportDirectory = resolveReportDirectory()
    val reportFile = File(reportDirectory, DEVICE_AI_PROTOCOL_REPORT_FILE)
    val archivedReportFile = File(File(reportDirectory, DEVICE_AI_PROTOCOL_RUNS_DIR), "${request.correlationId}.json")
    val defaultModelEvidence =
      DeviceAiProtocolModelEvidence(
        modelRef = request.modelRef.trim(),
        revision = request.revision.trim(),
        fileName = request.fileName.trim(),
        expectedSha256 = request.expectedSha256.trim(),
        resolvedModelName = "",
        capabilities = emptyList(),
      )

    val execution =
      runCatching {
        withTimeout(request.timeoutMs) {
          executeProtocol(request = request, availableModels = availableModels, startedAtEpochMs = startedAtEpochMs, reportFile = archivedReportFile, latestReportFile = reportFile, defaultModelEvidence = defaultModelEvidence)
        }
      }.getOrElse { error ->
        val code = if (error is kotlinx.coroutines.TimeoutCancellationException) "PROTOCOL_TIMEOUT" else "PROTOCOL_EXECUTION_FAILED"
        val message = error.message?.trim().orEmpty().ifBlank { code }
        createExecution(
          terminalState = DeviceAiProtocolTerminalState.ERROR_RETRYABLE,
          code = code,
          message = message,
          modelEvidence = defaultModelEvidence,
          artifact = null,
          stages = listOf(
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_VALIDATE,
              status = DeviceAiProtocolStageStatus.FAIL,
              code = code,
              message = message,
            )
          ),
          reportFile = archivedReportFile,
          latestReportFile = reportFile,
          request = request,
          startedAtEpochMs = startedAtEpochMs,
          completedAtEpochMs = nowMs(),
        )
      }

    val persistedResult = persistReport(execution = execution)
    logger.debug(
      "device_ai_protocol_finished",
      listOf(
        "correlationId" to request.correlationId,
        "code" to persistedResult.code,
        "state" to persistedResult.terminalState.name,
        "reportPath" to persistedResult.reportPath,
      ),
    )
    return persistedResult
  }

  private suspend fun executeProtocol(
    request: DeviceAiProtocolRunRequest,
    availableModels: List<Model>,
    startedAtEpochMs: Long,
    reportFile: File,
    latestReportFile: File,
    defaultModelEvidence: DeviceAiProtocolModelEvidence,
  ): DeviceAiProtocolExecution {
    val trimmedModelRef = request.modelRef.trim()
    if (trimmedModelRef.isBlank()) {
      return createValidationFailure(
        request = request,
        startedAtEpochMs = startedAtEpochMs,
        reportFile = reportFile,
        latestReportFile = latestReportFile,
        modelEvidence = defaultModelEvidence,
        code = "MODEL_REF_REQUIRED",
        message = "MODEL_REF_REQUIRED",
      )
    }

    val trimmedFileName = request.fileName.trim()
    if (trimmedFileName.isBlank()) {
      return createValidationFailure(
        request = request,
        startedAtEpochMs = startedAtEpochMs,
        reportFile = reportFile,
        latestReportFile = latestReportFile,
        modelEvidence = defaultModelEvidence.copy(modelRef = trimmedModelRef),
        code = "MODEL_FILE_REQUIRED",
        message = "MODEL_FILE_REQUIRED",
      )
    }

    val candidate = resolveModel(modelRef = trimmedModelRef, fileName = trimmedFileName, availableModels = availableModels)
    if (candidate == null) {
      return createValidationFailure(
        request = request,
        startedAtEpochMs = startedAtEpochMs,
        reportFile = reportFile,
        latestReportFile = latestReportFile,
        modelEvidence = defaultModelEvidence.copy(modelRef = trimmedModelRef, fileName = trimmedFileName),
        code = "MODEL_NOT_ALLOWLISTED",
        message = "MODEL_NOT_ALLOWLISTED",
      )
    }

    val resolvedRevision = request.revision.trim().ifBlank { candidate.version.trim() }
    val resolvedSha256 = request.expectedSha256.trim().ifBlank { candidate.sha256.trim() }
    val resolvedModel =
      candidate.copy(
        modelRef = trimmedModelRef,
        version = resolvedRevision.ifBlank { candidate.version },
        sha256 = resolvedSha256,
      )
    val modelEvidence =
      DeviceAiProtocolModelEvidence(
        modelRef = trimmedModelRef,
        revision = resolvedRevision,
        fileName = trimmedFileName,
        expectedSha256 = resolvedSha256,
        resolvedModelName = resolvedModel.name,
        capabilities = resolvedModel.deviceAiProtocolCapabilities(),
      )

    if (!resolvedModel.supportsRequiredDeviceAiCapabilities()) {
      return createExecution(
        terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
        code = "CAPABILITIES_MISSING",
        message = "CAPABILITIES_MISSING",
        modelEvidence = modelEvidence,
        artifact = null,
        stages = listOf(
          DeviceAiProtocolStageReport(
            name = DEVICE_AI_PROTOCOL_STAGE_VALIDATE,
            status = DeviceAiProtocolStageStatus.PASS,
            code = "OK",
            message = "Validated protocol request.",
          ),
          DeviceAiProtocolStageReport(
            name = DEVICE_AI_PROTOCOL_STAGE_RESOLVE,
            status = DeviceAiProtocolStageStatus.FAIL,
            code = "CAPABILITIES_MISSING",
            message = "Required device AI capabilities are missing.",
          ),
          skippedStage(DEVICE_AI_PROTOCOL_STAGE_DOWNLOAD),
          skippedStage(DEVICE_AI_PROTOCOL_STAGE_SMOKE),
        ),
        reportFile = reportFile,
        latestReportFile = latestReportFile,
        request = request,
        startedAtEpochMs = startedAtEpochMs,
        completedAtEpochMs = nowMs(),
      )
    }

    val artifactFile = resolveArtifactFile(model = resolvedModel, fileName = trimmedFileName)
    val downloadResult =
      downloadModel(
        resolvedModel,
        artifactFile,
        request.token?.takeIf { it.isNotBlank() },
      )
    return when (downloadResult) {
      is ModelDownloadResult.Failure ->
        createExecution(
          terminalState = failureState(downloadResult),
          code = downloadResult.code,
          message = downloadResult.message.ifBlank { downloadResult.code },
          modelEvidence = modelEvidence,
          artifact = null,
          stages = listOf(
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_VALIDATE,
              status = DeviceAiProtocolStageStatus.PASS,
              code = "OK",
              message = "Validated protocol request.",
            ),
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_RESOLVE,
              status = DeviceAiProtocolStageStatus.PASS,
              code = "OK",
              message = "Resolved allowlisted model.",
            ),
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_DOWNLOAD,
              status = DeviceAiProtocolStageStatus.FAIL,
              code = downloadResult.code,
              message = downloadResult.message.ifBlank { downloadResult.code },
            ),
            skippedStage(DEVICE_AI_PROTOCOL_STAGE_SMOKE),
          ),
          reportFile = reportFile,
          latestReportFile = latestReportFile,
          request = request,
          startedAtEpochMs = startedAtEpochMs,
          completedAtEpochMs = nowMs(),
        )

      is ModelDownloadResult.Success -> {
        val actualSha256 = resolvedSha256.ifBlank { computeSha256(downloadResult.file) }
        val artifact =
          DeviceAiProtocolArtifactReport(
            path = downloadResult.file.absolutePath,
            sha256 = actualSha256,
            sizeBytes = downloadResult.file.length(),
          )
        val smokeResult =
          runAutomationSmoke(
            file = downloadResult.file,
            model = resolvedModel,
            artifactSha256 = actualSha256,
          )
        createExecution(
          terminalState = smokeResult.terminalState,
          code = smokeResult.code,
          message = smokeResult.message,
          modelEvidence = modelEvidence,
          artifact = artifact,
          stages = listOf(
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_VALIDATE,
              status = DeviceAiProtocolStageStatus.PASS,
              code = "OK",
              message = "Validated protocol request.",
            ),
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_RESOLVE,
              status = DeviceAiProtocolStageStatus.PASS,
              code = "OK",
              message = "Resolved allowlisted model.",
            ),
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_DOWNLOAD,
              status = DeviceAiProtocolStageStatus.PASS,
              code = "OK",
              message = "Downloaded model into app-managed storage.",
            ),
            DeviceAiProtocolStageReport(
              name = DEVICE_AI_PROTOCOL_STAGE_SMOKE,
              status =
                if (smokeResult.terminalState == DeviceAiProtocolTerminalState.SUCCESS) {
                  DeviceAiProtocolStageStatus.PASS
                } else {
                  DeviceAiProtocolStageStatus.FAIL
                },
              code = smokeResult.code,
              message = smokeResult.message,
            ),
          ),
          reportFile = reportFile,
          latestReportFile = latestReportFile,
          request = request,
          startedAtEpochMs = startedAtEpochMs,
          completedAtEpochMs = nowMs(),
        )
      }
    }
  }

  private fun createValidationFailure(
    request: DeviceAiProtocolRunRequest,
    startedAtEpochMs: Long,
    reportFile: File,
    latestReportFile: File,
    modelEvidence: DeviceAiProtocolModelEvidence,
    code: String,
    message: String,
  ): DeviceAiProtocolExecution {
    return createExecution(
      terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
      code = code,
      message = message,
      modelEvidence = modelEvidence,
      artifact = null,
      stages = listOf(
        DeviceAiProtocolStageReport(
          name = DEVICE_AI_PROTOCOL_STAGE_VALIDATE,
          status = DeviceAiProtocolStageStatus.FAIL,
          code = code,
          message = message,
        ),
        skippedStage(DEVICE_AI_PROTOCOL_STAGE_RESOLVE),
        skippedStage(DEVICE_AI_PROTOCOL_STAGE_DOWNLOAD),
        skippedStage(DEVICE_AI_PROTOCOL_STAGE_SMOKE),
      ),
      reportFile = reportFile,
      latestReportFile = latestReportFile,
      request = request,
      startedAtEpochMs = startedAtEpochMs,
      completedAtEpochMs = nowMs(),
    )
  }

  private fun createExecution(
    terminalState: DeviceAiProtocolTerminalState,
    code: String,
    message: String,
    modelEvidence: DeviceAiProtocolModelEvidence,
    artifact: DeviceAiProtocolArtifactReport?,
    stages: List<DeviceAiProtocolStageReport>,
    reportFile: File,
    latestReportFile: File,
    request: DeviceAiProtocolRunRequest,
    startedAtEpochMs: Long,
    completedAtEpochMs: Long,
  ): DeviceAiProtocolExecution {
    val report =
      DeviceAiProtocolRunReport(
        version = DEVICE_AI_PROTOCOL_VERSION,
        platform = "android",
        trigger = request.trigger.name.lowercase(),
        correlationId = request.correlationId,
        status = if (terminalState == DeviceAiProtocolTerminalState.SUCCESS) "pass" else "fail",
        state = terminalState.name.lowercase(),
        code = code,
        message = message,
        startedAtEpochMs = startedAtEpochMs,
        completedAtEpochMs = completedAtEpochMs,
        reportPath = reportFile.absolutePath,
        latestReportPath = latestReportFile.absolutePath,
        model = modelEvidence,
        artifact = artifact,
        stages = stages,
      )
    return DeviceAiProtocolExecution(
      terminalState = terminalState,
      code = code,
      message = message,
      artifact = artifact,
      report = report,
      reportFile = reportFile,
      latestReportFile = latestReportFile,
    )
  }

  private fun persistReport(execution: DeviceAiProtocolExecution): DeviceAiProtocolRunResult {
    val persisted =
      runCatching {
        ensureParentDirectory(execution.reportFile)
        ensureParentDirectory(execution.latestReportFile)
        val json = gson.toJson(execution.report)
        execution.reportFile.writeText(json)
        execution.latestReportFile.writeText(json)
      }

    val persistedExecution =
      if (persisted.isSuccess) {
        execution
      } else {
        val message = persisted.exceptionOrNull()?.message?.trim().orEmpty().ifBlank { "REPORT_WRITE_FAILED" }
        logger.error(
          "device_ai_report_write_failed",
          persisted.exceptionOrNull(),
          listOf("reportPath" to execution.reportFile.absolutePath),
        )
        execution.copy(
          terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
          code = "REPORT_WRITE_FAILED",
          message = message,
          report = execution.report.copy(
            status = "fail",
            state = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE.name.lowercase(),
            code = "REPORT_WRITE_FAILED",
            message = message,
          ),
        )
      }

    return DeviceAiProtocolRunResult(
      terminalState = persistedExecution.terminalState,
      code = persistedExecution.code,
      message = persistedExecution.message,
      correlationId = persistedExecution.report.correlationId,
      artifactPath = persistedExecution.artifact?.path.orEmpty(),
      artifactSha256 = persistedExecution.artifact?.sha256.orEmpty(),
      artifactSizeBytes = persistedExecution.artifact?.sizeBytes ?: 0L,
      reportPath = persistedExecution.reportFile.absolutePath,
      latestReportPath = persistedExecution.latestReportFile.absolutePath,
      report = persistedExecution.report,
    )
  }

  private fun resolveReportDirectory(): File {
    val baseDirectorySegments =
      VertuRuntimeConfig.deviceAiManagedModelDirectory
        .split('/')
        .filter { it.isNotBlank() }
        .dropLast(1)
        .ifEmpty { listOf("vertu-device-ai") }
    return baseDirectorySegments.fold(appStorageRoot) { currentDirectory, segment ->
      File(currentDirectory, segment)
    }.let { File(it, "protocol") }
  }

  private fun resolveModel(modelRef: String, fileName: String, availableModels: List<Model>): Model? {
    val normalizedModelRef = normalizeHuggingFaceModelRef(modelRef)
    val nameHint = normalizedModelRef.substringAfterLast('/').lowercase()
    return availableModels.firstOrNull { model ->
      model.downloadFileName.equals(fileName, ignoreCase = true) ||
        model.name.lowercase() == nameHint ||
        normalizeHuggingFaceModelRef(model.modelRef) == normalizedModelRef
    }
  }

  private fun resolveArtifactFile(model: Model, fileName: String): File {
    val baseDirectory =
      VertuRuntimeConfig.deviceAiManagedModelDirectory
        .split('/')
        .filter { it.isNotBlank() }
        .fold(appStorageRoot) { currentDirectory, segment ->
          File(currentDirectory, segment)
        }
    return File(File(File(baseDirectory, model.normalizedName), model.version), fileName)
  }

  private fun failureState(failure: ModelDownloadResult.Failure): DeviceAiProtocolTerminalState {
    if (failure.code == "HF_UNAUTHORIZED") {
      return DeviceAiProtocolTerminalState.UNAUTHORIZED
    }
    return if (failure.retryable) {
      DeviceAiProtocolTerminalState.ERROR_RETRYABLE
    } else {
      DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE
    }
  }

  private fun runAutomationSmoke(
    file: File,
    model: Model,
    artifactSha256: String,
  ): DeviceAiProtocolSmokeResult {
    if (!file.exists()) {
      return DeviceAiProtocolSmokeResult(
        terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
        code = "ARTIFACT_MISSING",
        message = "The staged model artifact is missing.",
      )
    }
    if (!file.absolutePath.startsWith(appStorageRoot.absolutePath)) {
      return DeviceAiProtocolSmokeResult(
        terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
        code = "ARTIFACT_OUTSIDE_APP_STORAGE",
        message = "The staged model artifact is outside app-managed storage.",
      )
    }
    if (artifactSha256.isBlank()) {
      return DeviceAiProtocolSmokeResult(
        terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
        code = "ARTIFACT_SHA256_MISSING",
        message = "The staged model artifact is missing checksum evidence.",
      )
    }
    if (!model.supportsRequiredDeviceAiCapabilities()) {
      return DeviceAiProtocolSmokeResult(
        terminalState = DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
        code = "CAPABILITIES_MISSING",
        message = "Required device AI capabilities are missing.",
      )
    }
    return DeviceAiProtocolSmokeResult(
      terminalState = DeviceAiProtocolTerminalState.SUCCESS,
      code = "OK",
      message = "Native Android automation readiness smoke passed.",
    )
  }

  private fun ensureParentDirectory(file: File) {
    val parent = requireNotNull(file.parentFile) { "Protocol file must have a parent directory." }
    if (!parent.exists()) {
      parent.mkdirs()
    }
  }

  private fun computeSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) {
          break
        }
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString(separator = "") { "%02x".format(it) }
  }

  private fun normalizeHuggingFaceModelRef(rawModelRef: String): String {
    return rawModelRef
      .trim()
      .removePrefix("https://")
      .removePrefix("http://")
      .removePrefix("huggingface.co/")
      .trim('/')
      .lowercase()
  }

  private fun skippedStage(name: String): DeviceAiProtocolStageReport {
    return DeviceAiProtocolStageReport(
      name = name,
      status = DeviceAiProtocolStageStatus.SKIPPED,
      code = "SKIPPED",
      message = "Skipped because a prior required stage failed.",
    )
  }
}

private data class DeviceAiProtocolExecution(
  val terminalState: DeviceAiProtocolTerminalState,
  val code: String,
  val message: String,
  val artifact: DeviceAiProtocolArtifactReport?,
  val report: DeviceAiProtocolRunReport,
  val reportFile: File,
  val latestReportFile: File,
)

private data class DeviceAiProtocolSmokeResult(
  val terminalState: DeviceAiProtocolTerminalState,
  val code: String,
  val message: String,
)

/** Logging contract used by the Android device-AI protocol runner. */
interface DeviceAiProtocolLogger {
  /** Emits a structured debug event for protocol execution. */
  fun debug(event: String, fields: List<Pair<String, Any?>>)

  /** Emits a structured error event for protocol execution. */
  fun error(event: String, throwable: Throwable?, fields: List<Pair<String, Any?>>)
}

private object AndroidDeviceAiProtocolLogger : DeviceAiProtocolLogger {
  override fun debug(event: String, fields: List<Pair<String, Any?>>) {
    StructuredLog.d(TAG, event, *fields.toTypedArray())
  }

  override fun error(event: String, throwable: Throwable?, fields: List<Pair<String, Any?>>) {
    StructuredLog.e(TAG, event, throwable, *fields.toTypedArray())
  }
}
