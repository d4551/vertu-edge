/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.google.ai.edge.gallery.customtasks.mobileactions

import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.data.Model
import com.google.ai.edge.gallery.ui.llmchat.LlmChatModelHelper
import com.google.ai.edge.gallery.ui.llmchat.LlmModelInstance
import com.google.ai.edge.gallery.ui.modelmanager.ModelInitializationStatus
import com.google.ai.edge.gallery.ui.modelmanager.ModelInitializationStatusType
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime
import java.time.ZoneId
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import org.json.JSONObject
import com.vertu.edge.core.flow.FlowExecutionState

private const val TAG = "AGMAViewModel"

/** The UI state of the MobileActionsViewModel. */
data class MobileActionsUiState(
  val showWelcomeMessage: Boolean = true,
  val processing: Boolean = false,
  val userPrompt: String = "",
  val modelResponse: String = "",
  val functionCallDetails: List<String> = listOf(),
  val noFunctionRecognized: Boolean = false,
)

/** Approval payload for a phone-automation run that requires user confirmation. */
data class OperatorApprovalRequest(
  val flowYaml: String,
  val consentToken: String,
  val correlationId: String,
  val riskLevel: String,
  val commandCount: Int,
)

/** One execution event emitted by conversational phone automation. */
data class OperatorAutomationExecution(
  val state: FlowExecutionState,
  val message: String,
  val approvalRequest: OperatorApprovalRequest? = null,
)

/** Aggregate result returned to the operator surface after a phone-automation prompt. */
data class OperatorAutomationResult(
  val assistantMessage: String,
  val actionDetails: List<String>,
  val executions: List<OperatorAutomationExecution>,
  val state: FlowExecutionState,
)

@HiltViewModel
class MobileActionsViewModel
@Inject
constructor(
  @ApplicationContext private val appContext: Context,
  private val fallbackExecutor: VertuRpaFallbackExecutor,
) : ViewModel() {
  protected val _uiState = MutableStateFlow(MobileActionsUiState())
  val uiState = _uiState.asStateFlow()

  private val _isResettingConversation = MutableStateFlow(false)
  private val isResettingConversation = _isResettingConversation.asStateFlow()

  fun reset() {
    val unused = setFlashlight(context = appContext, isEnabled = false)
    setShowWelcomeMessage(showWelcomeMessage = true)
    setUserPrompt(prompt = "'")
    setModelResponse(response = "")
    setNoFunctionRecognized(value = false)
    clearFunctionCallDetails()
  }

  fun cleanUp() {
    val unused = setFlashlight(context = appContext, isEnabled = false)
  }

  fun setShowWelcomeMessage(showWelcomeMessage: Boolean) {
    _uiState.update { _uiState.value.copy(showWelcomeMessage = showWelcomeMessage) }
  }

  fun setProcessing(processing: Boolean) {
    _uiState.update { _uiState.value.copy(processing = processing) }
  }

  fun setUserPrompt(prompt: String) {
    _uiState.update { _uiState.value.copy(userPrompt = prompt) }
  }

  fun setModelResponse(response: String) {
    _uiState.update { _uiState.value.copy(modelResponse = response) }
  }

  fun appendModelResponse(partialResponse: String) {
    _uiState.update {
      _uiState.value.copy(modelResponse = _uiState.value.modelResponse + partialResponse)
    }
  }

  fun addFunctionCallDetails(details: String) {
    val newDetails = _uiState.value.functionCallDetails.toMutableList()
    newDetails.add(details)
    _uiState.update { _uiState.value.copy(functionCallDetails = newDetails) }
  }

  fun clearFunctionCallDetails() {
    _uiState.update { _uiState.value.copy(functionCallDetails = listOf()) }
  }

  fun setNoFunctionRecognized(value: Boolean) {
    _uiState.update { _uiState.value.copy(noFunctionRecognized = value) }
  }

  /** Runs a conversational operator prompt and executes any resulting phone actions inline. */
  suspend fun executeOperatorPrompt(
    model: Model,
    userPrompt: String,
    modelManagerViewModel: ModelManagerViewModel,
  ): OperatorAutomationResult {
    val recognizedActions = mutableListOf<Action>()
    val tools = listOf(MobileActionsTools(onFunctionCalled = { recognizedActions.add(it) }))
    val initializationError =
      ensureOperatorModelReady(
        model = model,
        tools = tools,
        modelManagerViewModel = modelManagerViewModel,
      )
    if (initializationError.isNotEmpty()) {
      return OperatorAutomationResult(
        assistantMessage = "",
        actionDetails = listOf(),
        executions =
          listOf(
            OperatorAutomationExecution(
              state = FlowExecutionState.ERROR_NON_RETRYABLE,
              message = initializationError,
            )
          ),
        state = FlowExecutionState.ERROR_NON_RETRYABLE,
      )
    }

    val assistantMessage = runOperatorInference(model = model, userPrompt = userPrompt, tools = tools)
    if (recognizedActions.isEmpty()) {
      val response =
        assistantMessage.ifBlank {
          appContext.getString(R.string.operator_phone_no_action_recognized)
        }
      return OperatorAutomationResult(
        assistantMessage = response,
        actionDetails = listOf(),
        executions =
          listOf(
            OperatorAutomationExecution(
              state = FlowExecutionState.EMPTY,
              message = appContext.getString(R.string.operator_phone_no_action_recognized),
            )
          ),
        state = FlowExecutionState.EMPTY,
      )
    }

    val actionDetails = recognizedActions.map(::formatOperatorFunctionCall)
    val executions = recognizedActions.map { action -> executeOperatorAction(action = action) }
    return OperatorAutomationResult(
      assistantMessage = assistantMessage,
      actionDetails = actionDetails,
      executions = executions,
      state = summarizeExecutionState(executions),
    )
  }

  /** Approves and replays a previously gated phone-automation flow. */
  suspend fun approveOperatorPrompt(approval: OperatorApprovalRequest): OperatorAutomationResult {
    val approvalAction =
      ExecuteFlowAction(
        flowYaml = approval.flowYaml,
        consentToken = approval.consentToken,
        correlationId = approval.correlationId,
      )
    val execution = executeOperatorAction(action = approvalAction)
    return OperatorAutomationResult(
      assistantMessage = appContext.getString(R.string.operator_phone_approval_started),
      actionDetails = listOf(formatOperatorFunctionCall(approvalAction)),
      executions = listOf(execution),
      state = execution.state,
    )
  }

  fun processUserPrompt(
    model: Model,
    userPrompt: String,
    tools: List<MobileActionsTools>,
    onProcessDone: suspend () -> Unit,
    onError: (error: String) -> Unit,
  ) {
    if (model.instance == null) {
      setProcessing(processing = false)
      return
    }

    viewModelScope.launch(Dispatchers.Default) {
      Log.d(TAG, "Start processing user prompt: $userPrompt")
      setProcessing(processing = true)
      setShowWelcomeMessage(showWelcomeMessage = false)

      // Clean up.
      setModelResponse(response = "")
      setNoFunctionRecognized(value = false)
      clearFunctionCallDetails()

      // Set user prompt.
      setUserPrompt(prompt = userPrompt)

      // Wait until the conversation is NOT resetting.
      Log.d(TAG, "Waiting for any ongoing conversation reset to be done...")
      isResettingConversation.first { !it }
      Log.d(TAG, "Done waiting. Start inference.")

      // Run inference.
      val instance = model.instance as LlmModelInstance
      val conversation = instance.conversation
      val contents = mutableListOf<Content>()
      if (userPrompt.trim().isNotEmpty()) {
        contents.add(Content.Text(userPrompt))
      }

      conversation
        .sendMessageAsync(Contents.of(contents))
        .catch {
          Log.e(TAG, "Failed to run inference", it)
          onError(it.message ?: "Unknown error")
        }
        .onCompletion {
          setProcessing(processing = false)
          onProcessDone()
          resetConversation(model = model, tools = tools)
        }
        .collect {
          setProcessing(processing = false)
          appendModelResponse(partialResponse = it.toString())
      }
    }
  }

  private suspend fun ensureOperatorModelReady(
    model: Model,
    tools: List<MobileActionsTools>,
    modelManagerViewModel: ModelManagerViewModel,
  ): String {
    if (modelManagerViewModel.uiState.value.isModelInitialized(model = model) && model.instance != null) {
      resetConversation(model = model, tools = tools)
      return ""
    }

    return suspendCancellableCoroutine { continuation ->
      modelManagerViewModel.setInitializationStatus(
        model = model,
        status = ModelInitializationStatus(status = ModelInitializationStatusType.INITIALIZING),
      )
      LlmChatModelHelper.initialize(
        context = appContext,
        model = model,
        supportImage = false,
        supportAudio = false,
        onDone = { error ->
          modelManagerViewModel.setInitializationStatus(
            model = model,
            status =
              if (error.isBlank()) {
                ModelInitializationStatus(status = ModelInitializationStatusType.INITIALIZED)
              } else {
                ModelInitializationStatus(
                  status = ModelInitializationStatusType.ERROR,
                  error = error,
                )
              },
          )
          if (continuation.isActive) {
            continuation.resume(error)
          }
        },
        systemInstruction = getSystemPrompt(),
        tools = tools,
      )
    }
  }

  private suspend fun runOperatorInference(
    model: Model,
    userPrompt: String,
    tools: List<MobileActionsTools>,
  ): String {
    setModelResponse(response = "")
    setNoFunctionRecognized(value = false)
    clearFunctionCallDetails()
    return suspendCancellableCoroutine { continuation ->
      processUserPrompt(
        model = model,
        userPrompt = userPrompt,
        tools = tools,
        onProcessDone = {
          if (continuation.isActive) {
            continuation.resume(uiState.value.modelResponse)
          }
        },
        onError = { error ->
          if (continuation.isActive) {
            continuation.resume(error)
          }
        },
      )
    }
  }

  private suspend fun executeOperatorAction(action: Action): OperatorAutomationExecution {
    val rawResult = performAction(action = action, context = appContext)
    if (action is ExecuteFlowAction) {
      return parseFlowExecutionResult(action = action, rawResult = rawResult)
    }

    return if (rawResult.isBlank()) {
      OperatorAutomationExecution(
        state = FlowExecutionState.SUCCESS,
        message =
          appContext.getString(
            R.string.operator_phone_action_completed,
            action.functionCallDetails.functionName,
          ),
      )
    } else {
      OperatorAutomationExecution(
        state = FlowExecutionState.ERROR_NON_RETRYABLE,
        message = rawResult,
      )
    }
  }

  private fun parseFlowExecutionResult(
    action: ExecuteFlowAction,
    rawResult: String,
  ): OperatorAutomationExecution {
    return runCatching {
      val payload = JSONObject(rawResult)
      when (payload.optString("state")) {
        "success" ->
          OperatorAutomationExecution(
            state = FlowExecutionState.SUCCESS,
            message =
              payload.optString("message").ifBlank {
                appContext.getString(R.string.operator_phone_flow_completed)
              },
          )
        "requires_confirmation" -> {
          val consent = payload.optJSONObject("consent")
          OperatorAutomationExecution(
            state = FlowExecutionState.LOADING,
            message =
              payload.optString("message").ifBlank {
                appContext.getString(R.string.operator_phone_confirmation_required)
              },
            approvalRequest =
              OperatorApprovalRequest(
                flowYaml = action.flowYaml,
                consentToken = consent?.optString("token").orEmpty(),
                correlationId = payload.optString("correlationId"),
                riskLevel = consent?.optString("riskLevel").orEmpty(),
                commandCount = consent?.optInt("commandCount") ?: 0,
              ),
          )
        }
        "retryable-error" ->
          OperatorAutomationExecution(
            state = FlowExecutionState.ERROR_RETRYABLE,
            message = payload.optString("message"),
          )
        "non-retryable-error" ->
          OperatorAutomationExecution(
            state = FlowExecutionState.ERROR_NON_RETRYABLE,
            message = payload.optString("message"),
          )
        else ->
          OperatorAutomationExecution(
            state = FlowExecutionState.LOADING,
            message =
              payload.optString("message").ifBlank {
                appContext.getString(R.string.operator_phone_execution_in_progress)
              },
          )
      }
    }.getOrElse {
      OperatorAutomationExecution(
        state = FlowExecutionState.ERROR_RETRYABLE,
        message =
          rawResult.ifBlank {
            appContext.getString(R.string.operator_phone_execution_unavailable)
          },
      )
    }
  }

  private fun formatOperatorFunctionCall(action: Action): String {
    val parameters = action.functionCallDetails.parameters
    if (parameters.isEmpty()) {
      return appContext.getString(
        R.string.operator_phone_function_call_without_params,
        action.functionCallDetails.functionName,
      )
    }
    val renderedParameters = parameters.joinToString(separator = ", ") { "${it.first}=${it.second}" }
    return appContext.getString(
      R.string.operator_phone_function_call_with_params,
      action.functionCallDetails.functionName,
      renderedParameters,
    )
  }

  private fun summarizeExecutionState(executions: List<OperatorAutomationExecution>): FlowExecutionState {
    return when {
      executions.any { it.state == FlowExecutionState.ERROR_NON_RETRYABLE } ->
        FlowExecutionState.ERROR_NON_RETRYABLE
      executions.any { it.state == FlowExecutionState.ERROR_RETRYABLE } ->
        FlowExecutionState.ERROR_RETRYABLE
      executions.any { it.approvalRequest != null } -> FlowExecutionState.LOADING
      executions.any { it.state == FlowExecutionState.LOADING } -> FlowExecutionState.LOADING
      executions.any { it.state == FlowExecutionState.EMPTY } -> FlowExecutionState.EMPTY
      else -> FlowExecutionState.SUCCESS
    }
  }

  fun resetConversation(model: Model, tools: List<MobileActionsTools>) {
    _isResettingConversation.value = true
    LlmChatModelHelper.resetConversation(
      model = model,
      supportImage = false,
      supportAudio = false,
      systemInstruction = getSystemPrompt(),
      tools = tools,
    )
    _isResettingConversation.value = false
  }

  fun resetEngine(
    context: Context,
    model: Model,
    tools: List<MobileActionsTools>,
    modelManagerViewModel: ModelManagerViewModel,
    onError: (error: String) -> Unit,
  ) {
    reset()

    viewModelScope.launch(Dispatchers.Default) {
      modelManagerViewModel.setInitializationStatus(
        model = model,
        status = ModelInitializationStatus(status = ModelInitializationStatusType.NOT_INITIALIZED),
      )
      LlmChatModelHelper.cleanUp(
        model = model,
        onDone = {
          LlmChatModelHelper.initialize(
            context = context,
            model = model,
            supportImage = false,
            supportAudio = false,
            onDone = { error ->
              modelManagerViewModel.setInitializationStatus(
                model = model,
                status =
                  ModelInitializationStatus(status = ModelInitializationStatusType.INITIALIZED),
              )
              if (error.isNotEmpty()) {
                onError(error)
              }
            },
            systemInstruction = getSystemPrompt(),
            tools = tools,
          )
        },
      )
    }
  }

  suspend fun performAction(action: Action, context: Context): String {
    return when (action) {
      // Flashlight on.
      is FlashlightOnAction -> setFlashlight(context = context, isEnabled = true)

      // Flashlight off.
      is FlashlightOffAction -> setFlashlight(context = context, isEnabled = false)

      // Create contact.
      is CreateContactAction ->
        createContact(
          context = context,
          firstName = action.firstName,
          lastName = action.lastName,
          phoneNumber = action.phoneNumber,
          email = action.email,
        )

      // Send email.
      is SendEmailAction ->
        sendEmail(context = context, to = action.to, subject = action.subject, body = action.body)

      // Show location on map.
      is ShowLocationOnMap -> showLocationOnMap(context = context, location = action.location)

      // Open wifi settings.
      is OpenWifiSettingsAction -> openWifiSettings(context = context)

      // Create calendar events.
      is CreateCalendarEventAction ->
        createCalendarEvent(context = context, datetime = action.datetime, title = action.title)

      // Execute RPA fallback flow.
      is ExecuteFlowAction ->
        fallbackExecutor.execute(
          flowYaml = action.flowYaml,
          consentToken = action.consentToken,
          correlationId = action.correlationId,
        )

      else -> ""
    }
  }

  private fun setFlashlight(context: Context, isEnabled: Boolean): String {
    val cameraManager: CameraManager =
      context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

    // Assuming the device has a rear camera with a flash unit (usually camera ID '0')
    var cameraId: String? = null

    try {
      // Find the ID of the camera that supports the flash unit
      for (id in cameraManager.cameraIdList) {
        val characteristics = cameraManager.getCameraCharacteristics(id)
        val isFlashAvailable =
          characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
        if (isFlashAvailable) {
          cameraId = id
          break
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to set flashlight", e)
      return e.message ?: context.getString(R.string.unknown_error)
    }

    cameraId?.let { id ->
      try {
        cameraManager.setTorchMode(id, isEnabled)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to set flashlight", e)
        return e.message ?: context.getString(R.string.unknown_error)
      }
    }

    return ""
  }

  private fun createContact(
    context: Context,
    firstName: String,
    lastName: String,
    phoneNumber: String,
    email: String,
  ): String {
    val intent =
      Intent(ContactsContract.Intents.Insert.ACTION)
        .apply { type = ContactsContract.RawContacts.CONTENT_TYPE }
        .apply {
          // Name
          putExtra(ContactsContract.Intents.Insert.NAME, "$firstName $lastName")
          // Inserts an email address
          putExtra(ContactsContract.Intents.Insert.EMAIL, email)
          putExtra(
            ContactsContract.Intents.Insert.EMAIL_TYPE,
            ContactsContract.CommonDataKinds.Email.TYPE_WORK,
          )
          // Inserts a phone number
          putExtra(ContactsContract.Intents.Insert.PHONE, phoneNumber)
          putExtra(
            ContactsContract.Intents.Insert.PHONE_TYPE,
            ContactsContract.CommonDataKinds.Phone.TYPE_WORK,
          )
        }

    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to create contact", e)
      return e.message ?: context.getString(R.string.unknown_error)
    }

    return ""
  }

  private fun sendEmail(context: Context, to: String, subject: String, body: String): String {
    val intent =
      Intent(Intent.ACTION_SEND).apply {
        data = "mailto:".toUri()
        type = "text/plain"
        putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, body)
      }

    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to send email", e)
      return e.message ?: context.getString(R.string.unknown_error)
    }

    return ""
  }

  private fun showLocationOnMap(context: Context, location: String): String {
    val encodedLocation = URLEncoder.encode(location, StandardCharsets.UTF_8.toString())
    val intent = Intent(Intent.ACTION_VIEW).apply { data = "geo:0,0?q=$encodedLocation".toUri() }

    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to show location on map", e)
      return e.message ?: context.getString(R.string.unknown_error)
    }

    return ""
  }

  private fun openWifiSettings(context: Context): String {
    val intent = Intent(Settings.ACTION_WIFI_SETTINGS)
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to open wifi settings", e)
      return e.message ?: context.getString(R.string.unknown_error)
    }

    return ""
  }

  private fun createCalendarEvent(context: Context, datetime: String, title: String): String {
    // Convert datetime string to ms.
    var ms = System.currentTimeMillis()
    try {
      val localDateTime = LocalDateTime.parse(datetime)
      val systemDefaultZone = ZoneId.systemDefault()
      val zonedDateTime = localDateTime.atZone(systemDefaultZone)
      ms = zonedDateTime.toInstant().toEpochMilli()
    } catch (e: Exception) {
      // Ignore parsing error.
      Log.w(TAG, "Failed to parse date time: '$datetime'", e)
    }

    val intent =
      Intent(Intent.ACTION_INSERT).apply {
        data = CalendarContract.Events.CONTENT_URI
        putExtra(CalendarContract.Events.TITLE, title)
        putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, ms)
        putExtra(CalendarContract.EXTRA_EVENT_END_TIME, ms + 3600000)
      }
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to create calendar event", e)
      return e.message ?: context.getString(R.string.unknown_error)
    }

    return ""
  }
}
