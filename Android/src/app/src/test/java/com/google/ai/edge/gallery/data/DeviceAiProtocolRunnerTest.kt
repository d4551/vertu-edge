package com.google.ai.edge.gallery.data

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceAiProtocolRunnerTest {
  @Test
  fun parseDeepLink_extractsAutomationOverrides() {
    val launchRequest =
      DeviceAiProtocolAutomationParser.parseDeepLink(
        dataString =
          "com.vertu.edge://device_ai_protocol/run" +
            "?modelRef=mradermacher%2FAutoGLM-Phone-9B-Multilingual-GGUF" +
            "&revision=rev-123&fileName=model.gguf&sha256=abc123",
        expectedScheme = "com.vertu.edge",
      )

    assertNotNull(launchRequest)
    assertEquals(
      "mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF",
      launchRequest?.modelRef,
    )
    assertEquals("rev-123", launchRequest?.revision)
    assertEquals("model.gguf", launchRequest?.fileName)
    assertEquals("abc123", launchRequest?.expectedSha256)
    assertEquals(DeviceAiProtocolTrigger.AUTOMATION, launchRequest?.trigger)
  }

  @Test
  fun run_persistsDeterministicReportAndArtifactMetadata() {
    val rootDirectory = Files.createTempDirectory("device-ai-runner-").toFile()
    val artifactBytes = "native-device-ai".encodeToByteArray()
    val expectedSha256 = sha256Hex(artifactBytes)
    val runner =
      DeviceAiProtocolRunner(
        appStorageRoot = rootDirectory,
        downloadModel = { _, destination, _ ->
          destination.parentFile?.mkdirs()
          destination.writeBytes(artifactBytes)
          ModelDownloadResult.Success(file = destination, correlationId = "hf-correlation")
        },
        nowMs = { 1_700_000_000_000L },
        logger = NoOpDeviceAiProtocolLogger,
      )

    val result =
      kotlinx.coroutines.runBlocking {
        runner.run(
          request =
            DeviceAiProtocolRunRequest(
              correlationId = "android-device-ai-test",
              modelRef = "huggingface.co/mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF",
              revision = "rev-123",
              fileName = "model.gguf",
              expectedSha256 = expectedSha256,
              trigger = DeviceAiProtocolTrigger.AUTOMATION,
            ),
          availableModels = listOf(createDeviceAiModel()),
        )
      }

    assertEquals(DeviceAiProtocolTerminalState.SUCCESS, result.terminalState)
    assertEquals("OK", result.code)
    assertTrue(File(result.reportPath).exists())
    assertTrue(File(result.latestReportPath).exists())
    assertTrue(File(result.artifactPath).exists())
    assertEquals(expectedSha256, result.artifactSha256)
    assertTrue(result.report.reportPath.endsWith("runs/android-device-ai-test.json"))
    assertTrue(result.report.latestReportPath.endsWith("protocol/latest.json"))
    assertEquals("android-device-ai-test", result.report.correlationId)
    assertEquals("android", result.report.platform)
    assertEquals("pass", result.report.status)
    assertEquals(4, result.report.stages.size)
    assertEquals(
      listOf(
        DeviceAiProtocolCapability.MOBILE_ACTIONS,
        DeviceAiProtocolCapability.RPA_CONTROLS,
        DeviceAiProtocolCapability.FLOW_COMMANDS,
      ),
      result.report.model.capabilities,
    )
    assertTrue(File(result.reportPath).readText().contains("\"correlationId\": \"android-device-ai-test\""))
  }

  @Test
  fun run_returnsNonRetryableFailureWhenModelIsNotAllowlisted() {
    val rootDirectory = Files.createTempDirectory("device-ai-runner-failure-").toFile()
    val runner =
      DeviceAiProtocolRunner(
        appStorageRoot = rootDirectory,
        downloadModel = { _, _, _ ->
          ModelDownloadResult.Failure(
            code = "SHOULD_NOT_RUN",
            message = "SHOULD_NOT_RUN",
            retryable = false,
            correlationId = "hf-correlation",
          )
        },
        nowMs = { 1_700_000_000_000L },
        logger = NoOpDeviceAiProtocolLogger,
      )

    val result =
      kotlinx.coroutines.runBlocking {
        runner.run(
          request =
            DeviceAiProtocolRunRequest(
              correlationId = "android-device-ai-missing-model",
              modelRef = "huggingface.co/missing/model",
              revision = "rev-404",
              fileName = "missing.gguf",
              expectedSha256 = "",
            ),
          availableModels = emptyList(),
        )
      }

    assertEquals(DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE, result.terminalState)
    assertEquals("MODEL_NOT_ALLOWLISTED", result.code)
    assertTrue(File(result.reportPath).exists())
    assertTrue(File(result.latestReportPath).exists())
    assertEquals("MODEL_NOT_ALLOWLISTED", result.report.code)
    assertEquals("fail", result.report.status)
  }

  private fun createDeviceAiModel(): Model {
    return Model(
      name = "AutoGLM-Phone-9B-Multilingual",
      modelRef = "mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF",
      url = "https://huggingface.co/mradermacher/AutoGLM-Phone-9B-Multilingual-GGUF/resolve/main/model.gguf",
      sizeInBytes = 1024L,
      downloadFileName = "model.gguf",
      version = "rev-123",
      isLlm = true,
      deviceAiSupportMobileActions = true,
      deviceAiSupportRpaControls = true,
      deviceAiSupportFlowCommands = true,
    )
  }

  private fun sha256Hex(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(bytes)
    return digest.digest().joinToString(separator = "") { "%02x".format(it) }
  }
}

private object NoOpDeviceAiProtocolLogger : DeviceAiProtocolLogger {
  override fun debug(event: String, fields: List<Pair<String, Any?>>) = Unit

  override fun error(event: String, throwable: Throwable?, fields: List<Pair<String, Any?>>) = Unit
}
