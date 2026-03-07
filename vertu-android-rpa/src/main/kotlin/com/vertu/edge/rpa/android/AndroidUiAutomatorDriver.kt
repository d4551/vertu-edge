package com.vertu.edge.rpa.android

import android.content.Context
import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import com.vertu.edge.core.driver.DriverAdapter
import com.vertu.edge.core.driver.DriverExecutionConfig
import com.vertu.edge.core.error.DriverArtifacts
import com.vertu.edge.core.error.DriverExecutionReport
import com.vertu.edge.core.error.ErrorCategory
import com.vertu.edge.core.error.ExecutionError
import com.vertu.edge.core.error.ExecutionResultEnvelope
import com.vertu.edge.core.error.StepReport
import com.vertu.edge.core.error.StepStatus
import com.vertu.edge.core.flow.CommandTarget
import com.vertu.edge.core.flow.Direction
import com.vertu.edge.core.flow.FlowCommand
import com.vertu.edge.core.flow.FlowExecutionState
import com.vertu.edge.core.flow.FlowV1
import java.io.File
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive

private typealias DeviceProvider = () -> UiDevice

private const val MIN_SCROLL_STEPS = 1
private const val MAX_SCROLL_STEPS = 50
private const val SCROLL_DEFAULT_DISTANCE_FRACTION = 0.65f
private const val MIN_SWIPE_DISTANCE_FRACTION = 0.2f
private const val MAX_SWIPE_DISTANCE_FRACTION = 0.95f
private const val SWIPE_ANIMATION_STEPS = 24

/** Android UIAutomator implementation of the shared [DriverAdapter]. */
class AndroidUiAutomatorDriver
private constructor(
  private val context: Context,
  private val deviceProvider: DeviceProvider,
  private val nowMs: () -> Long,
) : DriverAdapter {
  constructor(context: Context, nowMs: () -> Long = { System.currentTimeMillis() }) : this(
    context = context,
    deviceProvider = { UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()) },
    nowMs = nowMs,
  )

  override suspend fun execute(
    flow: FlowV1,
    config: DriverExecutionConfig,
  ): ExecutionResultEnvelope<DriverExecutionReport> {
    val correlationId = "vertu-rpa-${nowMs()}"
    val stepReports = mutableListOf<StepReport>()
    var artifacts = DriverArtifacts()

    val device =
      runCatching { deviceProvider() }
        .getOrElse {
          return envelopeError(
            state = FlowExecutionState.ERROR_NON_RETRYABLE,
            correlationId = correlationId,
            code = "DRIVER_INIT_FAILED",
            category = ErrorCategory.DRIVER,
            message = it.message ?: "Failed to initialize UIAutomator device",
            retryable = false,
          )
        }

    val flowStartMs = nowMs()

    for ((index, step) in flow.steps.withIndex()) {
      try {
        currentCoroutineContext().ensureActive()
      } catch (_: CancellationException) {
        return envelopeError(
          state = FlowExecutionState.ERROR_RETRYABLE,
          correlationId = correlationId,
          code = "FLOW_CANCELLED",
          category = ErrorCategory.INTERNAL,
          message = "Flow execution was cancelled",
          retryable = true,
          stepReports = stepReports,
          flow = flow,
          artifacts = artifacts,
        )
      }

      val stepStartMs = nowMs()
      val stepResult =
        executeWithRetry(
          step = step,
          flow = flow,
          device = device,
          config = config,
          correlationId = correlationId,
          stepIndex = index,
        )
      if (stepResult.isSuccess) {
        val stepArtifacts = stepResult.getOrNull()
        artifacts = mergeArtifacts(base = artifacts, update = stepArtifacts)
        stepReports +=
          StepReport(
            index = index,
            commandType = step.javaClass.simpleName.replaceFirstChar { it.lowercase() },
            status = StepStatus.SUCCESS,
            durationMs = nowMs() - stepStartMs,
          )
        continue
      }

      artifacts = captureArtifacts(device = device, correlationId = correlationId, stepIndex = index)
      val throwable = stepResult.exceptionOrNull()
      stepReports +=
        StepReport(
          index = index,
          commandType = step.javaClass.simpleName.replaceFirstChar { it.lowercase() },
          status = StepStatus.FAILED,
          durationMs = nowMs() - stepStartMs,
          message = throwable?.message ?: "Unknown step failure",
        )

      return envelopeError(
        state =
          if (throwable is NonRetryableCommandException) {
            FlowExecutionState.ERROR_NON_RETRYABLE
          } else {
            FlowExecutionState.ERROR_RETRYABLE
          },
        correlationId = correlationId,
        code = "STEP_EXECUTION_FAILED",
        category = ErrorCategory.DRIVER,
        message = throwable?.message ?: "Step execution failed",
        retryable = throwable !is NonRetryableCommandException,
        stepReports = stepReports,
        flow = flow,
        artifacts = artifacts,
      )
    }

    return ExecutionResultEnvelope(
      state = FlowExecutionState.SUCCESS,
      correlationId = correlationId,
      payload =
        DriverExecutionReport(
          appId = flow.appId,
          completedSteps = flow.steps.size,
          totalSteps = flow.steps.size,
          stepReports = stepReports,
          artifacts = artifacts,
        ),
      error = null,
    )
  }

  private suspend fun executeWithRetry(
    step: FlowCommand,
    flow: FlowV1,
    device: UiDevice,
    config: DriverExecutionConfig,
    correlationId: String,
    stepIndex: Int,
  ): Result<DriverArtifacts?> {
    var backoffMs = config.initialBackoffMs
    var lastError: Throwable? = null

    repeat(config.maxAttempts) { attemptIndex ->
      val attemptResult =
        runCatching {
          executeStep(
            step = step,
            flow = flow,
            device = device,
            config = config,
            correlationId = correlationId,
            stepIndex = stepIndex,
          )
        }
      if (attemptResult.isSuccess) {
        return Result.success(attemptResult.getOrNull())
      }

      lastError = attemptResult.exceptionOrNull()
      val nonRetryableError = lastError as? NonRetryableCommandException
      if (nonRetryableError != null) {
        return Result.failure(nonRetryableError)
      }
      if (attemptIndex < config.maxAttempts - 1) {
        delay(backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(config.maxBackoffMs)
      }
    }

    return Result.failure(lastError ?: IllegalStateException("Unknown step failure"))
  }

  private suspend fun executeStep(
    step: FlowCommand,
    flow: FlowV1,
    device: UiDevice,
    config: DriverExecutionConfig,
    correlationId: String,
    stepIndex: Int,
  ): DriverArtifacts? {
    when (step) {
      FlowCommand.LaunchApp -> {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(flow.appId)
          ?: error("Unable to resolve launch intent for ${flow.appId}")
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launchIntent)
        device.waitForIdle(config.defaultStepTimeoutMs)
        return null
      }

      is FlowCommand.TapOn -> {
        val x = step.target.x
        val y = step.target.y
        if (x != null && y != null) {
          device.click(x, y)
        } else {
          val targetObject = findTarget(device = device, target = step.target) ?: error("tapOn target not found")
          targetObject.click()
        }
        return null
      }

      is FlowCommand.InputText -> {
        val focusedField = device.findObject(By.focused(true))
        if (focusedField != null) {
          focusedField.text = step.value
        } else {
          device.executeShellCommand("input text ${step.value.shellEscape()}")
        }
        return null
      }

      is FlowCommand.AssertVisible -> {
        val x = step.target.x
        val y = step.target.y
        if (x != null && y != null) {
          check(x in 0..device.displayWidth && y in 0..device.displayHeight) {
            "assertVisible coordinate target out of screen bounds"
          }
        } else {
          val targetObject = findTarget(device = device, target = step.target)
          check(targetObject != null) { "assertVisible target not found" }
        }
        return null
      }

      is FlowCommand.AssertNotVisible -> {
        val x = step.target.x
        val y = step.target.y
        if (x != null && y != null) {
          check(x !in 0..device.displayWidth || y !in 0..device.displayHeight) {
            "assertNotVisible coordinate target is inside screen bounds"
          }
        } else {
          val targetObject = findTarget(device = device, target = step.target)
          check(targetObject == null) { "assertNotVisible target was found" }
        }
        return null
      }

      is FlowCommand.AssertText -> {
        val targetObject = findTarget(device = device, target = step.target) ?: error("assertText target not found")
        val actualText = targetObject.text.orEmpty()
        check(actualText == step.value) {
          "assertText failed: expected '${step.value}' but found '$actualText'"
        }
        return null
      }

      is FlowCommand.SelectOption -> {
        val targetObject = findTarget(device = device, target = step.target) ?: error("selectOption target not found")
        targetObject.click()
        val optionObject = device.findObject(By.text(step.option))
        check(optionObject != null) { "selectOption option '${step.option}' not found" }
        optionObject.click()
        return null
      }

      is FlowCommand.Scroll -> {
        val scrollSteps = step.steps?.coerceIn(MIN_SCROLL_STEPS, MAX_SCROLL_STEPS) ?: MIN_SCROLL_STEPS
        repeat(scrollSteps) {
          performSwipe(device = device, direction = step.direction, distanceFraction = SCROLL_DEFAULT_DISTANCE_FRACTION)
        }
        return null
      }

      is FlowCommand.Swipe -> {
        performSwipe(
          device = device,
          direction = step.direction,
          distanceFraction = step.distanceFraction.coerceIn(MIN_SWIPE_DISTANCE_FRACTION, MAX_SWIPE_DISTANCE_FRACTION),
        )
        return null
      }

      FlowCommand.Screenshot -> {
        return captureArtifacts(device = device, correlationId = correlationId, stepIndex = stepIndex)
      }

      FlowCommand.ClipboardRead -> {
        throw NonRetryableCommandException("clipboardRead is unsupported on android target")
      }

      is FlowCommand.ClipboardWrite -> {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
          ?: throw NonRetryableCommandException("clipboard service unavailable")
        val clip = android.content.ClipData.newPlainText("vertu-flow", step.value)
        clipboard.setPrimaryClip(clip)
        return null
      }

      is FlowCommand.WindowFocus -> {
        throw NonRetryableCommandException("windowFocus is unsupported on android target")
      }

      FlowCommand.HideKeyboard -> {
        device.pressBack()
        return null
      }

      is FlowCommand.WaitForAnimation -> {
        delay(step.timeoutMs)
        device.waitForIdle(step.timeoutMs)
        return null
      }
    }
  }

  private fun findTarget(device: UiDevice, target: CommandTarget) =
    SelectorPriorityResolver.orderedSelectors(target).asSequence().mapNotNull { device.findObject(it) }.firstOrNull()

  private fun performSwipe(device: UiDevice, direction: Direction, distanceFraction: Float) {
    val width = device.displayWidth
    val height = device.displayHeight
    val centerX = width / 2
    val centerY = height / 2
    val xDelta = (width * distanceFraction / 2f).toInt()
    val yDelta = (height * distanceFraction / 2f).toInt()

    val (startX, startY, endX, endY) =
      when (direction) {
        Direction.UP -> arrayOf(centerX, centerY + yDelta, centerX, centerY - yDelta)
        Direction.DOWN -> arrayOf(centerX, centerY - yDelta, centerX, centerY + yDelta)
        Direction.LEFT -> arrayOf(centerX + xDelta, centerY, centerX - xDelta, centerY)
        Direction.RIGHT -> arrayOf(centerX - xDelta, centerY, centerX + xDelta, centerY)
      }

    device.swipe(startX, startY, endX, endY, SWIPE_ANIMATION_STEPS)
  }

  private fun captureArtifacts(device: UiDevice, correlationId: String, stepIndex: Int): DriverArtifacts {
    val artifactDir = File(context.cacheDir, "vertu-rpa-artifacts").apply { mkdirs() }
    val screenshotFile = File(artifactDir, "$correlationId-step-$stepIndex.png")
    val hierarchyFile = File(artifactDir, "$correlationId-step-$stepIndex.xml")

    val screenshotPath = if (device.takeScreenshot(screenshotFile)) screenshotFile.absolutePath else null
    val hierarchyPath = runCatching {
      device.dumpWindowHierarchy(hierarchyFile)
      hierarchyFile.absolutePath
    }.getOrNull()

    return DriverArtifacts(
      lastScreenshotPath = screenshotPath,
      uiHierarchyPath = hierarchyPath,
    )
  }

  private fun envelopeError(
    state: FlowExecutionState,
    correlationId: String,
    code: String,
    category: ErrorCategory,
    message: String,
    retryable: Boolean,
    stepReports: List<StepReport> = emptyList(),
    flow: FlowV1? = null,
    artifacts: DriverArtifacts = DriverArtifacts(),
  ): ExecutionResultEnvelope<DriverExecutionReport> {
    val payload =
      if (flow == null) {
        null
      } else {
        DriverExecutionReport(
          appId = flow.appId,
          completedSteps = stepReports.count { it.status == StepStatus.SUCCESS },
          totalSteps = flow.steps.size,
          stepReports = stepReports,
          artifacts = artifacts,
        )
      }

    return ExecutionResultEnvelope(
      state = state,
      correlationId = correlationId,
      payload = payload,
      error =
        ExecutionError(
          code = code,
          category = category,
          message = message,
          retryable = retryable,
          correlationId = correlationId,
        ),
    )
  }
}

private class NonRetryableCommandException(message: String) : IllegalStateException(message)

private fun mergeArtifacts(base: DriverArtifacts, update: DriverArtifacts?): DriverArtifacts {
  if (update == null) {
    return base
  }
  return DriverArtifacts(
    lastScreenshotPath = update.lastScreenshotPath ?: base.lastScreenshotPath,
    uiHierarchyPath = update.uiHierarchyPath ?: base.uiHierarchyPath,
  )
}

/** Shared selector strategy: resourceId -> text -> contentDescription -> coordinates. */
object SelectorPriorityResolver {
  /** Returns selectors sorted by deterministic priority. */
  fun orderedSelectors(target: CommandTarget): List<BySelector> {
    val selectors = mutableListOf<BySelector>()
    val resourceId = target.resourceId
    if (!resourceId.isNullOrBlank()) {
      selectors += By.res(resourceId)
    }
    val text = target.text
    if (!text.isNullOrBlank()) {
      selectors += By.text(text)
    }
    val contentDescription = target.contentDescription
    if (!contentDescription.isNullOrBlank()) {
      selectors += By.desc(contentDescription)
    }
    return selectors
  }
}

private fun String.shellEscape(): String {
  return "'" + replace("'", "'\\''") + "'"
}
