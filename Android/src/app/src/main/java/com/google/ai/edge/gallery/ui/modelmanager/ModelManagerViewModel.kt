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

package com.google.ai.edge.gallery.ui.modelmanager

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.ai.edge.gallery.AppLifecycleProvider
import com.google.ai.edge.gallery.BuildConfig
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.common.ProjectConfig
import com.google.ai.edge.gallery.common.StructuredLog
import com.google.ai.edge.gallery.common.VertuRuntimeConfig
import com.google.ai.edge.gallery.common.normalizeAppLocaleTag
import com.google.ai.edge.gallery.common.getJsonResponseWithRetry
import com.google.ai.edge.gallery.customtasks.common.CustomTask
import com.google.ai.edge.gallery.data.Accelerator
import com.google.ai.edge.gallery.data.BuiltInTaskId
import com.google.ai.edge.gallery.data.Category
import com.google.ai.edge.gallery.data.CategoryInfo
import com.google.ai.edge.gallery.data.Config
import com.google.ai.edge.gallery.data.ConfigKeys
import com.google.ai.edge.gallery.data.DataStoreRepository
import com.google.ai.edge.gallery.data.DownloadRepository
import com.google.ai.edge.gallery.data.EMPTY_MODEL
import com.google.ai.edge.gallery.data.IMPORTS_DIR
import com.google.ai.edge.gallery.data.Model
import com.google.ai.edge.gallery.data.ModelAllowlist
import com.google.ai.edge.gallery.data.ModelDownloadStatus
import com.google.ai.edge.gallery.data.ModelDownloadStatusType
import com.google.ai.edge.gallery.data.NumberSliderConfig
import com.google.ai.edge.gallery.data.AiWorkflowJobEnvelope
import com.google.ai.edge.gallery.data.AiWorkflowRequest
import com.google.ai.edge.gallery.data.CloudChatAudioPayload
import com.google.ai.edge.gallery.data.CloudChatRequest
import com.google.ai.edge.gallery.data.CloudControlPlaneClient
import com.google.ai.edge.gallery.data.CloudModelOptionsResult
import com.google.ai.edge.gallery.data.CloudModelSourceDescriptor
import com.google.ai.edge.gallery.data.CloudModelPullEnvelope
import com.google.ai.edge.gallery.data.CloudModelPullRequest
import com.google.ai.edge.gallery.data.DeviceAiProtocolLaunchRequest
import com.google.ai.edge.gallery.data.DeviceAiProtocolRunRequest
import com.google.ai.edge.gallery.data.DeviceAiProtocolRunResult
import com.google.ai.edge.gallery.data.DeviceAiProtocolRunner
import com.google.ai.edge.gallery.data.DeviceAiProtocolTerminalState
import com.google.ai.edge.gallery.data.DeviceAiProtocolTrigger
import com.google.ai.edge.gallery.data.TMP_FILE_EXT
import com.google.ai.edge.gallery.data.Task
import com.google.ai.edge.gallery.data.ValueType
import com.google.ai.edge.gallery.data.createLlmChatConfigs
import com.google.ai.edge.gallery.proto.AccessTokenData
import com.google.ai.edge.gallery.proto.ImportedModel
import com.google.ai.edge.gallery.proto.Theme
import com.google.ai.edge.gallery.ui.theme.ThemeSettings
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import kotlin.collections.sortedWith
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.ResponseTypeValues
import com.vertu.edge.core.flow.FlowExecutionState

private const val TAG = "AGModelManagerViewModel"
private const val TEXT_INPUT_HISTORY_MAX_SIZE = 50
private const val MODEL_ALLOWLIST_FILENAME = "model_allowlist.json"
private const val MODEL_ALLOWLIST_TEST_FILENAME = "model_allowlist_test.json"

private const val TEST_MODEL_ALLOW_LIST = ""

data class ModelInitializationStatus(
  val status: ModelInitializationStatusType,
  var error: String = "",
)

enum class ModelInitializationStatusType {
  NOT_INITIALIZED,
  INITIALIZING,
  INITIALIZED,
  ERROR,
}

enum class TokenStatus {
  NOT_STORED,
  EXPIRED,
  NOT_EXPIRED,
}

enum class TokenRequestResultType {
  FAILED,
  SUCCEEDED,
  USER_CANCELLED,
}

data class TokenStatusAndData(val status: TokenStatus, val data: AccessTokenData?)

data class TokenRequestResult(val status: TokenRequestResultType, val errorMessage: String? = null)

/** External overlay state owned by the operator shell. */
enum class OperatorExternalOverlayState {
  NONE,
  MODEL_IMPORT_PICKER,
}

/** Role used by the conversation-first operator timeline. */
enum class OperatorTimelineRole {
  USER,
  ASSISTANT,
  SYSTEM,
  RUN,
}

/** Timeline entry for operator chat, runtime actions, and background execution updates. */
data class OperatorTimelineEntry(
  val id: String,
  val role: OperatorTimelineRole,
  val title: String,
  val body: String,
  val state: FlowExecutionState = FlowExecutionState.SUCCESS,
  val timestampMs: Long = System.currentTimeMillis(),
)

/** Canonical readiness state for the required device model. */
enum class RequiredModelReadinessState {
  NOT_INSTALLED,
  DOWNLOADING,
  VERIFYING,
  READY,
  IN_USE,
  FAILED,
}

/** Capability badge rendered by operator runtime surfaces. */
data class OperatorRuntimeCapability(
  val key: String,
  val label: String,
  val available: Boolean,
)

/** Required-model readiness summary rendered by operator runtime surfaces. */
data class RequiredModelReadiness(
  val state: RequiredModelReadinessState,
  val title: String,
  val detail: String,
  val actionLabel: String,
)

/** Shared runtime summary rendered by operator home, bubble, and admin surfaces. */
data class OperatorRuntimeSummary(
  val activeProvider: String,
  val activeCloudModel: String,
  val activeLocalModel: String,
  val runtimeReady: Boolean,
  val providerState: FlowExecutionState,
  val modelState: FlowExecutionState,
  val pullState: FlowExecutionState,
  val capabilities: List<OperatorRuntimeCapability>,
)

data class ModelManagerUiState(
  /** A list of tasks available in the application. */
  val tasks: List<Task>,

  /** Tasks grouped by category. */
  val tasksByCategory: Map<String, List<Task>>,

  /** A map that tracks the download status of each model, indexed by model name. */
  val modelDownloadStatus: Map<String, ModelDownloadStatus>,

  /** A map that tracks the initialization status of each model, indexed by model name. */
  val modelInitializationStatus: Map<String, ModelInitializationStatus>,

  /** Whether the app is loading and processing the model allowlist. */
  val loadingModelAllowlist: Boolean = true,

  /** The error message when loading the model allowlist. */
  val loadingModelAllowlistError: String = "",

  /** The currently selected model. */
  val selectedModel: Model = EMPTY_MODEL,

  /** Cloud control-plane base URL override. */
  val controlPlaneBaseUrl: String = VertuRuntimeConfig.controlPlaneBaseUrl,

  /** Provider registry state. */
  val isLoadingProviderRegistry: Boolean = false,
  val providerRegistryState: FlowExecutionState = FlowExecutionState.IDLE,
  val providerRegistryMessage: String = "",
  val providerOptions: List<String> = listOf(),
  val selectedProvider: String = "",

  /** Provider model registry state. */
  val isLoadingCloudModels: Boolean = false,
  val cloudModelListState: FlowExecutionState = FlowExecutionState.IDLE,
  val cloudModelListMessage: String = "",
  val cloudModelOptions: List<String> = listOf(),
  val selectedCloudModel: String = "",
  val modelSourceOptions: List<CloudModelSourceDescriptor> = listOf(),
  val cloudModelSource: String = "",
  val providerApiKey: String = "",
  val providerBaseUrl: String = "",

  /** Pull job state. */
  val cloudPullModelRef: String = "",
  val cloudPullSource: String = "",
  val cloudPullTimeoutMsText: String = "",
  val cloudPullForce: Boolean = false,
  val cloudPullJobId: String? = null,
  val cloudPullState: FlowExecutionState = FlowExecutionState.IDLE,
  val cloudPullMessage: String = "",
  val isSubmittingCloudPull: Boolean = false,
  val isPollingCloudPull: Boolean = false,

  /** Chat state. */
  val cloudChatMessage: String = "",
  val cloudConversationId: String = "",
  val cloudChatState: FlowExecutionState = FlowExecutionState.IDLE,
  val cloudChatStateMessage: String = "",
  val cloudChatReply: String = "",
  val cloudChatSpeechInputMimeType: String = "",
  val cloudChatSpeechInputData: String = "",
  val cloudChatRequestTts: Boolean = false,
  val cloudChatTtsOutputMimeType: String = "",
  val cloudChatTtsVoice: String = "",
  val cloudChatSpeechTranscript: String = "",
  val cloudChatTtsBase64Audio: String = "",
  val cloudChatTtsMimeType: String = "",
  val isSendingCloudChat: Boolean = false,

  /** Device AI protocol state. */
  val deviceAiModelRef: String = VertuRuntimeConfig.deviceAiRequiredModelRef,
  val deviceAiModelRevision: String = VertuRuntimeConfig.deviceAiRequiredModelRevision,
  val deviceAiModelFileName: String = VertuRuntimeConfig.deviceAiRequiredModelFileName,
  val deviceAiExpectedSha256: String = VertuRuntimeConfig.deviceAiRequiredModelSha256,
  val deviceAiState: FlowExecutionState = FlowExecutionState.IDLE,
  val deviceAiStateMessage: String = "",
  val deviceAiCorrelationId: String = "",
  val deviceAiArtifactPath: String = "",
  val deviceAiArtifactSha256: String = "",
  val deviceAiArtifactSizeBytes: Long = 0L,
  val isRunningDeviceAiProtocol: Boolean = false,

  /** Conversation-first operator timeline shared by cloud and device actions. */
  val operatorTimeline: List<OperatorTimelineEntry> = listOf(),

  /** Tracks whether an external overlay is actively owned by the operator shell. */
  val operatorExternalOverlayState: OperatorExternalOverlayState = OperatorExternalOverlayState.NONE,

  /** Persisted app language override shared with the settings surface. */
  val appLocaleTag: String = "",

  /** The history of text inputs entered by the user. */
  val textInputHistory: List<String> = listOf(),
  val configValuesUpdateTrigger: Long = 0L,
  // Updated when model is imported of an imported model is deleted.
  val modelImportingUpdateTrigger: Long = 0L,
) {
  fun isModelInitialized(model: Model): Boolean {
    return modelInitializationStatus[model.name]?.status ==
      ModelInitializationStatusType.INITIALIZED
  }

  fun isModelInitializing(model: Model): Boolean {
    return modelInitializationStatus[model.name]?.status ==
      ModelInitializationStatusType.INITIALIZING
  }
}

private val RESET_CONVERSATION_TURN_COUNT_CONFIG =
  NumberSliderConfig(
    key = ConfigKeys.RESET_CONVERSATION_TURN_COUNT,
    sliderMin = 1f,
    sliderMax = 30f,
    defaultValue = 3f,
    valueType = ValueType.INT,
  )

private val PREDEFINED_LLM_TASK_ORDER =
  listOf(
    BuiltInTaskId.LLM_ASK_IMAGE,
    BuiltInTaskId.LLM_ASK_AUDIO,
    BuiltInTaskId.LLM_CHAT,
    BuiltInTaskId.LLM_PROMPT_LAB,
    BuiltInTaskId.LLM_TINY_GARDEN,
    BuiltInTaskId.LLM_MOBILE_ACTIONS,
    // BuiltInTaskId.MP_SCRAPBOOK,
  )

/**
 * ViewModel responsible for managing models, their download status, and initialization.
 *
 * This ViewModel handles model-related operations such as downloading, deleting, initializing, and
 * cleaning up models. It also manages the UI state for model management, including the list of
 * tasks, models, download statuses, and initialization statuses.
 */
@HiltViewModel
open class ModelManagerViewModel
@Inject
constructor(
  private val downloadRepository: DownloadRepository,
  private val dataStoreRepository: DataStoreRepository,
  private val lifecycleProvider: AppLifecycleProvider,
  private val customTasks: Set<@JvmSuppressWildcards CustomTask>,
  private val cloudControlPlaneClient: CloudControlPlaneClient,
  private val deviceAiProtocolRunner: DeviceAiProtocolRunner,
  @ApplicationContext private val context: Context,
) : ViewModel() {
  private val externalFilesDir: File = context.getExternalFilesDir(null) ?: context.filesDir
  protected val _uiState = MutableStateFlow(createEmptyUiState())
  val uiState = _uiState.asStateFlow()
  private val _tokenStatusAndData =
    MutableStateFlow(TokenStatusAndData(status = TokenStatus.NOT_STORED, data = null))
  val tokenStatusAndData = _tokenStatusAndData.asStateFlow()

  private val modelLifecycleMutexes = mutableMapOf<String, Mutex>()
  private fun modelMutex(modelName: String): Mutex =
    synchronized(modelLifecycleMutexes) { modelLifecycleMutexes.getOrPut(modelName) { Mutex() } }

  val authService = AuthorizationService(context)
  var curAccessToken: String = ""

  init {
    refreshTokenStatus()
  }

  private fun stringResource(resourceId: Int): String = context.getString(resourceId)

  private fun stringResource(resourceId: Int, vararg args: Any): String {
    return context.getString(resourceId, *args)
  }

  override fun onCleared() {
    authService.dispose()
  }

  fun getTaskById(id: String): Task? {
    return uiState.value.tasks.find { it.id == id }
  }

  fun selectDefaultModelForTask(taskId: String) {
    val task = getTaskById(id = taskId) ?: return
    val downloadedModel =
      task.models.firstOrNull { model ->
        uiState.value.modelDownloadStatus[model.name]?.status == ModelDownloadStatusType.SUCCEEDED
      }
    val selected = downloadedModel ?: task.models.firstOrNull() ?: return
    _uiState.update { it.copy(selectedModel = selected) }
  }

  /** Returns the preferred model for a task, preferring fully downloaded models first. */
  fun getPreferredModelForTask(taskId: String): Model? {
    val task = getTaskById(id = taskId) ?: return null
    return task.models.firstOrNull { model ->
      uiState.value.modelDownloadStatus[model.name]?.status == ModelDownloadStatusType.SUCCEEDED
    } ?: task.models.firstOrNull()
  }

  fun getTasksByIds(ids: Set<String>): List<Task> {
    return uiState.value.tasks.filter { ids.contains(it.id) }
  }

  fun getCustomTaskByTaskId(id: String): CustomTask? {
    return customTasks.find { it.task.id == id }
  }

  fun getModelByName(name: String): Model? {
    for (task in uiState.value.tasks) {
      for (model in task.models) {
        if (model.name == name) {
          return model
        }
      }
    }
    return null
  }

  fun getAllModels(): List<Model> {
    val allModels = mutableSetOf<Model>()
    for (task in uiState.value.tasks) {
      for (model in task.models) {
        allModels.add(model)
      }
    }
    return allModels.toList().sortedBy { it.displayName.ifEmpty { it.name } }
  }

  fun getAllDownloadedModels(): List<Model> {
    return getAllModels().filter {
      uiState.value.modelDownloadStatus[it.name]?.status == ModelDownloadStatusType.SUCCEEDED &&
        it.isLlm
    }
  }

  fun processTasks() {
    val curTasks = customTasks.map { it.task }
    for (task in curTasks) {
      for (model in task.models) {
        model.preProcess()
      }
      // Move the model that is best for this task to the front.
      val bestModel = task.models.find { it.bestForTaskIds.contains(task.id) }
      if (bestModel != null) {
        task.models.remove(bestModel)
        task.models.add(0, bestModel)
      }
    }
  }

  fun setControlPlaneBaseUrl(baseUrl: String) {
    _uiState.update {
      it.copy(
        controlPlaneBaseUrl = baseUrl,
        providerRegistryState = FlowExecutionState.IDLE,
        providerRegistryMessage = "",
        providerOptions = listOf(),
        selectedProvider = "",
        cloudModelListState = FlowExecutionState.IDLE,
        cloudModelListMessage = "",
        cloudModelOptions = listOf(),
        selectedCloudModel = "",
        modelSourceOptions = listOf(),
        cloudPullState = FlowExecutionState.IDLE,
        cloudPullMessage = "",
        cloudPullJobId = null,
        cloudChatState = FlowExecutionState.IDLE,
        cloudChatStateMessage = "",
        cloudChatReply = "",
      )
    }
  }

  fun ensureCloudProvidersLoaded() {
    val state = uiState.value
    if (state.isLoadingProviderRegistry || state.providerOptions.isNotEmpty()) {
      return
    }
    loadCloudProviders()
  }

  fun clearOperatorTimeline() {
    _uiState.update { it.copy(operatorTimeline = listOf()) }
  }

  /** Updates the active external overlay owned by the operator shell. */
  fun setOperatorExternalOverlayState(state: OperatorExternalOverlayState) {
    _uiState.update { it.copy(operatorExternalOverlayState = state) }
  }

  /** Clears any external overlay tracked by the operator shell. */
  fun clearOperatorExternalOverlayState() {
    _uiState.update { it.copy(operatorExternalOverlayState = OperatorExternalOverlayState.NONE) }
  }

  /** Builds the shared runtime summary used across operator surfaces. */
  fun buildOperatorRuntimeSummary(): OperatorRuntimeSummary {
    val localAutomationModel = getPreferredModelForTask(BuiltInTaskId.LLM_MOBILE_ACTIONS)
    val hasProviders = uiState.value.providerOptions.isNotEmpty()
    return OperatorRuntimeSummary(
      activeProvider = uiState.value.selectedProvider,
      activeCloudModel = uiState.value.selectedCloudModel,
      activeLocalModel = localAutomationModel?.displayName?.ifBlank { localAutomationModel.name }.orEmpty(),
      runtimeReady = hasProviders || localAutomationModel != null,
      providerState = uiState.value.providerRegistryState,
      modelState = uiState.value.cloudModelListState,
      pullState = uiState.value.cloudPullState,
      capabilities =
        listOf(
          OperatorRuntimeCapability(
            key = "chat",
            label = stringResource(R.string.operator_capability_chat),
            available = true,
          ),
          OperatorRuntimeCapability(
            key = "automation",
            label = stringResource(R.string.operator_capability_automation),
            available = localAutomationModel?.llmSupportMobileActions == true,
          ),
          OperatorRuntimeCapability(
            key = "voice_in",
            label = stringResource(R.string.operator_capability_voice_input),
            available = true,
          ),
          OperatorRuntimeCapability(
            key = "voice_out",
            label = stringResource(R.string.operator_capability_voice_output),
            available = true,
          ),
        ),
    )
  }

  /** Builds the required-model readiness summary used across operator surfaces. */
  fun buildRequiredModelReadiness(): RequiredModelReadiness {
    val artifactFile = uiState.value.deviceAiArtifactPath.takeIf(String::isNotBlank)?.let(::File)
    val artifactExists = artifactFile?.exists() == true
    if (artifactExists && uiState.value.deviceAiState == FlowExecutionState.SUCCESS) {
      return RequiredModelReadiness(
        state = RequiredModelReadinessState.READY,
        title = stringResource(R.string.operator_required_model_ready_title),
        detail = uiState.value.deviceAiStateMessage.ifBlank {
          stringResource(R.string.operator_required_model_ready_detail)
        },
        actionLabel = stringResource(R.string.operator_required_model_verify_action),
      )
    }
    if (uiState.value.isRunningDeviceAiProtocol) {
      val state =
        if (artifactExists) {
          RequiredModelReadinessState.VERIFYING
        } else {
          RequiredModelReadinessState.DOWNLOADING
        }
      return RequiredModelReadiness(
        state = state,
        title = stringResource(R.string.operator_required_model_in_progress_title),
        detail = uiState.value.deviceAiStateMessage.ifBlank {
          stringResource(R.string.operator_required_model_in_progress_detail)
        },
        actionLabel = stringResource(R.string.operator_required_model_running_action),
      )
    }
    if (
      uiState.value.deviceAiState == FlowExecutionState.ERROR_RETRYABLE ||
        uiState.value.deviceAiState == FlowExecutionState.ERROR_NON_RETRYABLE ||
        uiState.value.deviceAiState == FlowExecutionState.UNAUTHORIZED
    ) {
      return RequiredModelReadiness(
        state = RequiredModelReadinessState.FAILED,
        title = stringResource(R.string.operator_required_model_failed_title),
        detail = uiState.value.deviceAiStateMessage.ifBlank {
          stringResource(R.string.operator_required_model_failed_detail)
        },
        actionLabel = stringResource(R.string.operator_required_model_retry_action),
      )
    }
    return RequiredModelReadiness(
      state = RequiredModelReadinessState.NOT_INSTALLED,
      title = stringResource(R.string.operator_required_model_missing_title),
      detail = stringResource(R.string.operator_required_model_missing_detail),
      actionLabel = stringResource(R.string.operator_required_model_download_action),
    )
  }

  fun setSelectedProvider(provider: String) {
    _uiState.update {
      it.copy(
        selectedProvider = provider,
        cloudModelListState = FlowExecutionState.IDLE,
        cloudModelListMessage = "",
        cloudModelOptions = listOf(),
        selectedCloudModel = "",
        cloudPullMessage = "",
        cloudPullState = FlowExecutionState.IDLE,
      )
    }
  }

  fun setCloudModelSource(source: String) {
    _uiState.update {
      it.copy(
        cloudModelSource = resolveModelSourceSelection(
          candidate = source,
          options = it.modelSourceOptions,
          fallback = it.cloudModelSource,
          canonicalFallback = VertuRuntimeConfig.controlPlaneDefaultModelSource,
        )
      )
    }
  }

  fun setProviderApiKey(apiKey: String) {
    _uiState.update { it.copy(providerApiKey = apiKey) }
  }

  fun setProviderBaseUrl(baseUrl: String) {
    _uiState.update { it.copy(providerBaseUrl = baseUrl) }
  }

  fun setSelectedCloudModel(model: String) {
    _uiState.update { it.copy(selectedCloudModel = model) }
  }

  fun setCloudPullModelRef(modelRef: String) {
    _uiState.update { it.copy(cloudPullModelRef = modelRef) }
  }

  fun setCloudPullSource(source: String) {
    _uiState.update {
      it.copy(
        cloudPullSource = resolveModelSourceSelection(
          candidate = source,
          options = it.modelSourceOptions,
          fallback = it.cloudModelSource,
          canonicalFallback = VertuRuntimeConfig.controlPlaneDefaultModelSource,
        )
      )
    }
  }

  fun setCloudPullTimeoutMs(timeoutMs: String) {
    _uiState.update { it.copy(cloudPullTimeoutMsText = timeoutMs) }
  }

  fun setCloudPullForce(force: Boolean) {
    _uiState.update { it.copy(cloudPullForce = force) }
  }

  fun setCloudChatMessage(message: String) {
    _uiState.update { it.copy(cloudChatMessage = message) }
  }

  fun clearCloudChatReply() {
    _uiState.update {
      it.copy(
        cloudChatReply = "",
        cloudChatSpeechTranscript = "",
        cloudChatTtsBase64Audio = "",
        cloudChatTtsMimeType = "",
        cloudChatStateMessage = "",
      )
    }
  }

  fun setCloudChatSpeechInputMimeType(mimeType: String) {
    _uiState.update { it.copy(cloudChatSpeechInputMimeType = mimeType) }
  }

  fun setCloudChatSpeechInputData(data: String) {
    _uiState.update { it.copy(cloudChatSpeechInputData = data) }
  }

  fun setCloudChatRequestTts(requestTts: Boolean) {
    _uiState.update { it.copy(cloudChatRequestTts = requestTts) }
  }

  fun setCloudChatTtsOutputMimeType(mimeType: String) {
    _uiState.update { it.copy(cloudChatTtsOutputMimeType = mimeType) }
  }

  fun setCloudChatTtsVoice(voice: String) {
    _uiState.update { it.copy(cloudChatTtsVoice = voice) }
  }

  fun runDeviceAiProtocol() {
    launchDeviceAiProtocol(
      launchRequest =
        DeviceAiProtocolLaunchRequest(
          modelRef = uiState.value.deviceAiModelRef,
          revision = uiState.value.deviceAiModelRevision,
          fileName = uiState.value.deviceAiModelFileName,
          expectedSha256 = uiState.value.deviceAiExpectedSha256,
          trigger = DeviceAiProtocolTrigger.UI,
        )
    )
  }

  fun runDeviceAiProtocolFromAutomationLaunch(launchRequest: DeviceAiProtocolLaunchRequest) {
    launchDeviceAiProtocol(launchRequest = launchRequest)
  }

  suspend fun awaitModelAllowlistLoaded() {
    if (!uiState.value.loadingModelAllowlist) {
      return
    }
    uiState.first { !it.loadingModelAllowlist }
  }

  private fun launchDeviceAiProtocol(launchRequest: DeviceAiProtocolLaunchRequest) {
    val currentState = uiState.value
    if (currentState.isRunningDeviceAiProtocol) {
      return
    }

    val request =
      buildDeviceAiProtocolRunRequest(
        launchRequest = launchRequest,
        currentState = currentState,
      )
    appendOperatorTimelineEntry(
      role = OperatorTimelineRole.RUN,
      title = stringResource(R.string.operator_timeline_device_title),
      body = stringResource(R.string.device_ai_protocol_running),
      state = FlowExecutionState.LOADING,
    )
    _uiState.update {
      it.copy(
        deviceAiModelRef = request.modelRef,
        deviceAiModelRevision = request.revision,
        deviceAiModelFileName = request.fileName,
        deviceAiExpectedSha256 = request.expectedSha256,
        deviceAiState = FlowExecutionState.LOADING,
        deviceAiStateMessage = stringResource(R.string.device_ai_protocol_running),
        deviceAiCorrelationId = request.correlationId,
        deviceAiArtifactPath = "",
        deviceAiArtifactSha256 = "",
        deviceAiArtifactSizeBytes = 0L,
        isRunningDeviceAiProtocol = true,
      )
    }

    viewModelScope.launch(Dispatchers.IO) {
      awaitModelAllowlistLoaded()
      StructuredLog.d(
        TAG,
        "device_ai_protocol_started",
        "correlationId" to request.correlationId,
        "modelRef" to request.modelRef,
        "fileName" to request.fileName,
        "trigger" to request.trigger.name.lowercase(),
      )
      val result = deviceAiProtocolRunner.run(request = request, availableModels = getAllModels())
      if (result.terminalState == DeviceAiProtocolTerminalState.SUCCESS) {
        StructuredLog.d(
          TAG,
          "device_ai_protocol_succeeded",
          "correlationId" to result.correlationId,
          "artifactPath" to result.artifactPath,
          "sizeBytes" to result.artifactSizeBytes,
          "reportPath" to result.reportPath,
        )
      } else {
        StructuredLog.w(
          TAG,
          "device_ai_protocol_failed",
          "correlationId" to result.correlationId,
          "code" to result.code,
          "state" to result.terminalState.name,
          "reportPath" to result.reportPath,
        )
      }
      _uiState.update {
        it.copy(
          deviceAiState = deviceAiState(result),
          deviceAiStateMessage = deviceAiStateMessage(result),
          deviceAiCorrelationId = result.correlationId,
          deviceAiArtifactPath = result.artifactPath,
          deviceAiArtifactSha256 = result.artifactSha256,
          deviceAiArtifactSizeBytes = result.artifactSizeBytes,
          isRunningDeviceAiProtocol = false,
        )
      }
      appendOperatorTimelineEntry(
        role =
          if (result.terminalState == DeviceAiProtocolTerminalState.SUCCESS) {
            OperatorTimelineRole.ASSISTANT
          } else {
            OperatorTimelineRole.RUN
          },
        title = stringResource(R.string.operator_timeline_device_title),
        body = deviceAiStateMessage(result),
        state = deviceAiState(result),
      )
    }
  }

  fun loadCloudProviders() {
    val baseUrl = resolveControlPlaneBaseUrl()
    val currentState = uiState.value.providerRegistryState
    if (currentState == FlowExecutionState.LOADING) return

    viewModelScope.launch(Dispatchers.IO) {
      _uiState.update {
        it.copy(
          isLoadingProviderRegistry = true,
          providerRegistryState = FlowExecutionState.LOADING,
          providerRegistryMessage = stringResource(R.string.cloud_provider_registry_loading),
        )
      }

      try {
        val sourceEnvelope = cloudControlPlaneClient.fetchModelSources(baseUrl = baseUrl)
        val sourceOptions =
          sourceEnvelope?.data?.sources
            ?.mapNotNull { source ->
              val sourceId = source.id.trim()
              if (sourceId.isBlank()) {
                return@mapNotNull null
              }
              source.copy(
                id = sourceId,
                displayName = source.displayName.trim(),
                aliases = source.aliases
                  .map(String::trim)
                  .filter(String::isNotBlank)
                  .distinct(),
              )
            }
            ?.filter { it.id.isNotBlank() }
            ?.distinctBy { it.id.lowercase() }
            ?.sortedBy { it.displayName.lowercase() }
            .orEmpty()
        val sourceFallbackId =
          sourceEnvelope?.data?.defaultSource?.trim().orEmpty()
        val canonicalSourceFallback = resolveModelSourceSelection(
          candidate = sourceFallbackId,
          options = sourceOptions,
          fallback = _uiState.value.cloudModelSource,
          canonicalFallback = VertuRuntimeConfig.controlPlaneDefaultModelSource,
        )

        val providers = cloudControlPlaneClient.fetchConfiguredProviderOptions(baseUrl = baseUrl)
          .distinct()
          .sorted()
        val selectedProvider = providers.firstOrNull().orEmpty()
        _uiState.update {
            val resolvedModelSource =
            resolveModelSourceSelection(
              candidate = it.cloudModelSource,
              options = sourceOptions,
              fallback = canonicalSourceFallback,
              canonicalFallback = VertuRuntimeConfig.controlPlaneDefaultModelSource,
            )
          val resolvedPullSource =
            resolveModelSourceSelection(
              candidate = it.cloudPullSource,
              options = sourceOptions,
              fallback = resolvedModelSource,
              canonicalFallback = canonicalSourceFallback,
            )
          it.copy(
            isLoadingProviderRegistry = false,
            providerOptions = providers,
            selectedProvider = selectedProvider.ifBlank { it.selectedProvider },
            modelSourceOptions = sourceOptions,
            cloudModelSource = resolvedModelSource,
            cloudPullSource = resolvedPullSource,
            providerRegistryState = if (providers.isEmpty()) FlowExecutionState.EMPTY else FlowExecutionState.SUCCESS,
            providerRegistryMessage =
              if (providers.isEmpty()) {
                stringResource(R.string.cloud_provider_registry_empty)
              } else {
                stringResource(R.string.cloud_provider_registry_loaded, providers.size)
              },
          )
        }
      } catch (error: Exception) {
        Log.w(TAG, "Failed to load cloud providers", error)
        _uiState.update {
          it.copy(
            isLoadingProviderRegistry = false,
            providerRegistryState = FlowExecutionState.ERROR_RETRYABLE,
            providerRegistryMessage = error.message.orEmpty().ifBlank {
              stringResource(R.string.cloud_provider_registry_load_failed)
            },
          )
        }
      }
    }
  }

  fun loadCloudModelsForSelectedProvider() {
    val provider = uiState.value.selectedProvider.trim()
    val baseUrl = resolveControlPlaneBaseUrl()
    if (provider.isEmpty()) {
      _uiState.update {
        it.copy(
          cloudModelListState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudModelListMessage = stringResource(R.string.cloud_models_select_provider_before_loading),
        )
      }
      return
    }

    val currentState = uiState.value.cloudModelListState
    if (currentState == FlowExecutionState.LOADING) return

    viewModelScope.launch(Dispatchers.IO) {
      _uiState.update {
        it.copy(
          isLoadingCloudModels = true,
          cloudModelListState = FlowExecutionState.LOADING,
          cloudModelListMessage = stringResource(R.string.cloud_models_loading_for_provider, provider),
        )
      }

      try {
        val result: CloudModelOptionsResult =
          cloudControlPlaneClient.fetchProviderModels(
            baseUrl = baseUrl,
            provider = provider,
            selectedModel = uiState.value.selectedCloudModel.ifBlank { null },
            apiKey = uiState.value.providerApiKey.ifBlank { null },
            providerBaseUrl = uiState.value.providerBaseUrl.ifBlank { null },
          )
        val selectedModel =
          result.selectedModel?.ifBlank { null }
            ?: uiState.value.selectedCloudModel.ifBlank { null }
            ?: result.models.firstOrNull()
            ?: ""
        _uiState.update {
          it.copy(
            isLoadingCloudModels = false,
            cloudModelOptions = result.models.distinct().sorted(),
            selectedCloudModel = selectedModel,
            cloudModelListState = result.state,
            cloudModelListMessage = if (result.message.isNotBlank()) {
              result.message
            } else if (result.models.isEmpty()) {
              stringResource(R.string.cloud_models_none_for_provider)
            } else {
              stringResource(R.string.cloud_models_loaded, result.models.size)
            },
          )
        }
      } catch (error: Exception) {
        Log.w(TAG, "Failed to load cloud models", error)
        _uiState.update {
          it.copy(
            isLoadingCloudModels = false,
            cloudModelListState = FlowExecutionState.ERROR_RETRYABLE,
            cloudModelOptions = listOf(),
            selectedCloudModel = "",
            cloudModelListMessage = error.message.orEmpty().ifBlank {
              stringResource(R.string.cloud_models_load_failed)
            },
          )
        }
      }
    }
  }

  fun pullCloudModel() {
    val state = uiState.value
    val requestModelRef = state.cloudPullModelRef.ifBlank { state.selectedCloudModel }.trim()
    if (requestModelRef.isEmpty()) {
      _uiState.update {
        it.copy(
          cloudPullState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudPullMessage = stringResource(R.string.cloud_pull_model_ref_required),
          isSubmittingCloudPull = false,
        )
      }
      return
    }

    val provider = state.selectedProvider.trim()
    if (provider.isEmpty()) {
      _uiState.update {
        it.copy(
          cloudPullState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudPullMessage = stringResource(R.string.cloud_pull_provider_required),
          isSubmittingCloudPull = false,
        )
      }
      return
    }

    val baseUrl = resolveControlPlaneBaseUrl()
    val modelSource =
      resolveModelSourceSelection(
        candidate = state.cloudPullSource,
        options = state.modelSourceOptions,
        fallback = state.cloudModelSource,
        canonicalFallback = VertuRuntimeConfig.controlPlaneDefaultModelSource,
      )
    val timeoutMs =
      parsePositiveInt(state.cloudPullTimeoutMsText)
        ?: VertuRuntimeConfig.controlPlaneDefaultPullTimeoutMs
    val request = CloudModelPullRequest(
      modelRef = requestModelRef,
      source = modelSource,
      platform = null,
      force = state.cloudPullForce,
      timeoutMs = timeoutMs,
      correlationId = null,
    )
    appendOperatorTimelineEntry(
      role = OperatorTimelineRole.RUN,
      title = stringResource(R.string.operator_timeline_runtime_title),
      body = stringResource(R.string.operator_timeline_pull_started, requestModelRef, provider),
      state = FlowExecutionState.LOADING,
    )

    viewModelScope.launch(Dispatchers.IO) {
      _uiState.update {
        it.copy(
          isSubmittingCloudPull = true,
          isPollingCloudPull = false,
          cloudPullState = FlowExecutionState.LOADING,
          cloudPullMessage = stringResource(R.string.cloud_pull_submit_request),
          cloudPullJobId = null,
        )
      }
      try {
        val envelope = cloudControlPlaneClient.startModelPull(baseUrl = baseUrl, request = request)
        applyCloudPullEnvelope(envelope)

        val terminalState = envelope.state
        val jobId = envelope.jobId
        if (!isTerminalCloudState(terminalState) && !jobId.isNullOrBlank()) {
          pollCloudModelPull(baseUrl = baseUrl, jobId = jobId)
        } else {
          _uiState.update {
            it.copy(isSubmittingCloudPull = false, isPollingCloudPull = false)
          }
        }
      } catch (error: Exception) {
        Log.w(TAG, "Model pull request failed", error)
        _uiState.update {
          it.copy(
            isSubmittingCloudPull = false,
            isPollingCloudPull = false,
            cloudPullState = FlowExecutionState.ERROR_RETRYABLE,
            cloudPullMessage = error.message.orEmpty().ifBlank {
              stringResource(R.string.cloud_pull_submit_failed)
            },
          )
        }
      }
    }
  }

  private fun pollCloudModelPull(baseUrl: String, jobId: String) {
    viewModelScope.launch(Dispatchers.IO) {
      var attempts = 0
      _uiState.update {
        it.copy(
          isPollingCloudPull = true,
          cloudPullState = FlowExecutionState.LOADING,
          cloudPullMessage = stringResource(R.string.cloud_pull_poll_job, jobId),
        )
      }

      var state = uiState.value.cloudPullState
      while (attempts < VertuRuntimeConfig.controlPlanePollAttempts && !isTerminalCloudState(state)) {
        if (attempts > 0) {
          delay(VertuRuntimeConfig.controlPlanePollIntervalMs.toLong())
        }
        attempts++
        try {
          val envelope = cloudControlPlaneClient.pollModelPull(baseUrl = baseUrl, jobId = jobId)
          applyCloudPullEnvelope(envelope)
          state = envelope.state
        } catch (error: Exception) {
          Log.w(TAG, "Cloud model pull polling failed", error)
          _uiState.update {
            it.copy(
              isPollingCloudPull = false,
              isSubmittingCloudPull = false,
              cloudPullState = FlowExecutionState.ERROR_RETRYABLE,
              cloudPullMessage =
                error.message.orEmpty().ifBlank {
                  stringResource(R.string.cloud_pull_polling_failed)
                },
            )
          }
          return@launch
        }
      }

      if (!isTerminalCloudState(state)) {
        _uiState.update {
          it.copy(
            isPollingCloudPull = false,
            isSubmittingCloudPull = false,
            cloudPullState = FlowExecutionState.ERROR_RETRYABLE,
            cloudPullMessage = stringResource(R.string.cloud_pull_timeout),
          )
        }
        return@launch
      }
      _uiState.update {
        it.copy(isPollingCloudPull = false, isSubmittingCloudPull = false)
      }
    }
  }

  fun sendCloudChat() {
    val state = uiState.value
    val message = state.cloudChatMessage.trim()
    val speechInputMimeType = state.cloudChatSpeechInputMimeType.trim()
    val speechInputData = state.cloudChatSpeechInputData.trim()
    val hasSpeechInput = speechInputMimeType.isNotBlank() && speechInputData.isNotBlank()

    if (message.isBlank() && !hasSpeechInput) {
      _uiState.update {
        it.copy(
          cloudChatState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudChatStateMessage = stringResource(R.string.cloud_chat_input_missing),
          isSendingCloudChat = false,
        )
      }
      return
    }

    if (hasSpeechInput) {
      _uiState.update {
        it.copy(
          cloudChatState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudChatStateMessage = stringResource(R.string.cloud_chat_speech_not_supported),
          isSendingCloudChat = false,
        )
      }
      return
    }

    val provider = state.selectedProvider.trim()
    if (provider.isBlank()) {
      _uiState.update {
        it.copy(
          cloudChatState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudChatStateMessage = stringResource(R.string.cloud_chat_provider_required),
          isSendingCloudChat = false,
        )
      }
      return
    }

    val model = state.selectedCloudModel.trim()
    if (model.isBlank()) {
      _uiState.update {
        it.copy(
          cloudChatState = FlowExecutionState.ERROR_NON_RETRYABLE,
          cloudChatStateMessage = stringResource(R.string.cloud_chat_model_required),
          isSendingCloudChat = false,
        )
      }
      return
    }

    if (message.isNotBlank()) {
      appendOperatorTimelineEntry(
        role = OperatorTimelineRole.USER,
        title = stringResource(R.string.operator_timeline_user_title),
        body = message,
        state = FlowExecutionState.SUCCESS,
      )
    }

    viewModelScope.launch(Dispatchers.IO) {
      _uiState.update {
        it.copy(
          isSendingCloudChat = true,
          cloudChatState = FlowExecutionState.LOADING,
          cloudChatStateMessage = stringResource(R.string.cloud_chat_sending),
        )
      }
      try {
        val workflowRequest = AiWorkflowRequest(
          mode = "chat",
          provider = provider,
          model = model,
          message = message,
          apiKey = state.providerApiKey.ifBlank { null },
          baseUrl = state.providerBaseUrl.ifBlank { null },
          correlationId = java.util.UUID.randomUUID().toString(),
          conversationId = state.cloudConversationId.ifBlank { null },
        )
        var envelope = cloudControlPlaneClient.startAiWorkflowJob(
          baseUrl = resolveControlPlaneBaseUrl(),
          request = workflowRequest,
        )
        val baseUrl = resolveControlPlaneBaseUrl()
        val pollIntervalMs = 2000L
        val maxPolls = 120
        var pollCount = 0
        while (!isAiWorkflowJobTerminal(envelope) && pollCount < maxPolls) {
          kotlinx.coroutines.delay(pollIntervalMs)
          envelope = cloudControlPlaneClient.getAiWorkflowJobEnvelope(baseUrl, envelope.jobId)
          pollCount++
        }
        applyAiWorkflowJobEnvelope(envelope)
      } catch (error: Exception) {
        Log.w(TAG, "Cloud chat request failed", error)
        _uiState.update {
          it.copy(
            isSendingCloudChat = false,
            cloudChatState = FlowExecutionState.ERROR_RETRYABLE,
            cloudChatStateMessage =
              error.message.orEmpty().ifBlank { stringResource(R.string.cloud_chat_send_failed) },
          )
        }
      }
    }
  }

  private fun isAiWorkflowJobTerminal(envelope: AiWorkflowJobEnvelope): Boolean {
    val status = envelope.data?.status ?: return true
    return status == "succeeded" || status == "failed" || status == "cancelled"
  }

  private fun applyAiWorkflowJobEnvelope(envelope: AiWorkflowJobEnvelope) {
    val result = envelope.data?.result
    val reply = result?.reply ?: envelope.error?.reason ?: envelope.mismatches.joinToString(" ")
    val state = when (envelope.state) {
      "success" -> FlowExecutionState.SUCCESS
      "error-retryable" -> FlowExecutionState.ERROR_RETRYABLE
      "error-non-retryable" -> FlowExecutionState.ERROR_NON_RETRYABLE
      "unauthorized" -> FlowExecutionState.UNAUTHORIZED
      else -> if (envelope.data?.status == "succeeded") FlowExecutionState.SUCCESS else FlowExecutionState.ERROR_NON_RETRYABLE
    }
    _uiState.update {
      it.copy(
        isSendingCloudChat = false,
        cloudChatState = state,
        cloudChatStateMessage = reply,
        cloudChatReply = result?.reply.orEmpty(),
        cloudConversationId = result?.conversationId?.trim()?.ifBlank { null } ?: it.cloudConversationId,
      )
    }
    appendOperatorTimelineEntry(
      role = if (state == FlowExecutionState.SUCCESS) OperatorTimelineRole.ASSISTANT else OperatorTimelineRole.RUN,
      title = stringResource(R.string.operator_timeline_assistant_title),
      body = reply,
      state = state,
    )
  }

  private fun applyCloudPullEnvelope(envelope: CloudModelPullEnvelope) {
    val data = envelope.data
    val message =
      when {
        data != null -> {
          val requested = data.requestedModelRef
          val normalized = data.normalizedModelRef
          val status = data.status.ifBlank { stringResource(R.string.cloud_model_status_unknown) }
          val elapsed = if (data.elapsedMs > 0) stringResource(R.string.cloud_pull_elapsed_ms, data.elapsedMs) else ""
          val artifact = data.artifactPath?.ifBlank { null }?.let { stringResource(R.string.cloud_pull_artifact, it) } ?: ""
          stringResource(R.string.cloud_pull_job_status, requested, normalized, status, elapsed, artifact)
        }
        envelope.mismatches.isNotEmpty() -> envelope.mismatches.joinToString(" ")
        envelope.error != null -> envelope.error.reason
        else -> stringResource(R.string.cloud_pull_status_updated)
      }
    _uiState.update {
      it.copy(
        cloudPullJobId = envelope.jobId ?: it.cloudPullJobId,
        cloudPullState = envelope.state,
        cloudPullMessage = message,
      )
    }
    if (isTerminalCloudState(envelope.state)) {
      appendOperatorTimelineEntry(
        role =
          if (envelope.state == FlowExecutionState.SUCCESS) {
            OperatorTimelineRole.ASSISTANT
          } else {
            OperatorTimelineRole.RUN
          },
        title = stringResource(R.string.operator_timeline_runtime_title),
        body = message,
        state = envelope.state,
      )
    }
  }

  private fun appendOperatorTimelineEntry(
    role: OperatorTimelineRole,
    title: String,
    body: String,
    state: FlowExecutionState,
  ) {
    if (body.isBlank()) {
      return
    }
    val entry =
      OperatorTimelineEntry(
        id = "operator-${System.currentTimeMillis()}-${uiState.value.operatorTimeline.size}",
        role = role,
        title = title,
        body = body,
        state = state,
      )
    _uiState.update {
      it.copy(operatorTimeline = (it.operatorTimeline + entry).takeLast(60))
    }
  }

  /** Adds a conversation event to the shared operator timeline. */
  fun addOperatorTimelineEntry(
    role: OperatorTimelineRole,
    title: String,
    body: String,
    state: FlowExecutionState,
  ) {
    appendOperatorTimelineEntry(role = role, title = title, body = body, state = state)
  }

  private fun isTerminalCloudState(state: FlowExecutionState): Boolean {
    return when (state) {
      FlowExecutionState.SUCCESS,
      FlowExecutionState.ERROR_RETRYABLE,
      FlowExecutionState.ERROR_NON_RETRYABLE,
      FlowExecutionState.UNAUTHORIZED -> true

      FlowExecutionState.IDLE,
      FlowExecutionState.LOADING,
      FlowExecutionState.EMPTY -> false
    }
  }

  private fun parsePositiveInt(rawTimeout: String): Int? {
    val timeout = rawTimeout.trim().toLongOrNull()
    return timeout
      ?.takeIf { it in 1..Int.MAX_VALUE.toLong() }
      ?.toInt()
  }

  private fun deviceAiState(result: DeviceAiProtocolRunResult): FlowExecutionState {
    return when (result.terminalState) {
      DeviceAiProtocolTerminalState.SUCCESS -> FlowExecutionState.SUCCESS
      DeviceAiProtocolTerminalState.ERROR_RETRYABLE -> FlowExecutionState.ERROR_RETRYABLE
      DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE -> FlowExecutionState.ERROR_NON_RETRYABLE
      DeviceAiProtocolTerminalState.UNAUTHORIZED -> FlowExecutionState.UNAUTHORIZED
    }
  }

  private fun deviceAiStateMessage(result: DeviceAiProtocolRunResult): String {
    return when (result.code) {
      "MODEL_REF_REQUIRED" -> stringResource(R.string.device_ai_model_ref_required)
      "MODEL_FILE_REQUIRED" -> stringResource(R.string.device_ai_model_file_required)
      "MODEL_NOT_ALLOWLISTED" -> stringResource(R.string.device_ai_model_not_allowlisted)
      "CAPABILITIES_MISSING" -> stringResource(R.string.device_ai_capabilities_missing)
      else ->
        when (result.terminalState) {
          DeviceAiProtocolTerminalState.SUCCESS -> stringResource(R.string.device_ai_protocol_success)
          DeviceAiProtocolTerminalState.ERROR_RETRYABLE -> stringResource(R.string.device_ai_protocol_failed_retryable)
          DeviceAiProtocolTerminalState.ERROR_NON_RETRYABLE,
          DeviceAiProtocolTerminalState.UNAUTHORIZED -> stringResource(R.string.device_ai_protocol_failed)
        }
    }
  }

  private fun buildDeviceAiProtocolRunRequest(
    launchRequest: DeviceAiProtocolLaunchRequest,
    currentState: ModelManagerUiState,
  ): DeviceAiProtocolRunRequest {
    return DeviceAiProtocolRunRequest(
      correlationId =
        launchRequest.correlationId?.trim().orEmpty().ifBlank {
          "android-device-ai-${System.currentTimeMillis()}"
        },
      modelRef =
        launchRequest.modelRef?.trim().orEmpty().ifBlank {
          currentState.deviceAiModelRef.trim().ifBlank { VertuRuntimeConfig.deviceAiRequiredModelRef }
        },
      revision =
        launchRequest.revision?.trim().orEmpty().ifBlank {
          currentState.deviceAiModelRevision.trim().ifBlank {
            VertuRuntimeConfig.deviceAiRequiredModelRevision
          }
        },
      fileName =
        launchRequest.fileName?.trim().orEmpty().ifBlank {
          currentState.deviceAiModelFileName.trim().ifBlank {
            VertuRuntimeConfig.deviceAiRequiredModelFileName
          }
        },
      expectedSha256 =
        launchRequest.expectedSha256?.trim().orEmpty().ifBlank {
          currentState.deviceAiExpectedSha256.trim().ifBlank {
            VertuRuntimeConfig.deviceAiRequiredModelSha256
          }
        },
      token = VertuRuntimeConfig.deviceAiHfToken.ifBlank { null },
      trigger = launchRequest.trigger,
      timeoutMs = VertuRuntimeConfig.deviceAiProtocolTimeoutMs.toLong(),
    )
  }

  private fun resolveModelSourceSelection(
    candidate: String,
    options: List<CloudModelSourceDescriptor>,
    fallback: String,
    canonicalFallback: String,
  ): String {
    val trimmedCandidate = candidate.trim()
    if (!trimmedCandidate.isBlank()) {
      val direct = resolveKnownModelSourceId(trimmedCandidate, options)
      if (!direct.isNullOrBlank()) {
        return direct
      }
    }

    val trimmedFallback = fallback.trim()
    if (!trimmedFallback.isBlank()) {
      val fallbackMatch = resolveKnownModelSourceId(trimmedFallback, options)
      if (!fallbackMatch.isNullOrBlank()) {
        return fallbackMatch
      }
    }

    val trimmedCanonicalFallback = canonicalFallback.trim()
    if (!trimmedCanonicalFallback.isBlank()) {
      val canonicalMatch = resolveKnownModelSourceId(trimmedCanonicalFallback, options)
      if (!canonicalMatch.isNullOrBlank()) {
        return canonicalMatch
      }
    }

    if (options.isEmpty()) {
      return trimmedCanonicalFallback.ifBlank { trimmedFallback }
    }

    return options.firstOrNull { it.id.isNotBlank() }?.id?.trim().orEmpty()
      .ifBlank { trimmedCanonicalFallback.ifBlank { trimmedFallback } }
  }

  private fun resolveKnownModelSourceId(
    rawSource: String,
    options: List<CloudModelSourceDescriptor>,
  ): String? {
    val trimmedSource = rawSource.trim()
    if (trimmedSource.isBlank()) {
      return null
    }
    val direct = options.firstOrNull { option ->
      option.id.equals(trimmedSource, ignoreCase = true)
    }?.id
    if (!direct.isNullOrBlank()) {
      return direct
    }
    val alias = options.firstOrNull { option ->
      option.aliases.any { alias -> alias.equals(trimmedSource, ignoreCase = true) }
    }?.id
    if (!alias.isNullOrBlank()) {
      return alias
    }
    return null
  }

  private fun resolveControlPlaneBaseUrl(): String {
    return uiState.value.controlPlaneBaseUrl.ifBlank { VertuRuntimeConfig.controlPlaneBaseUrl }
  }

  fun updateConfigValuesUpdateTrigger() {
    _uiState.update { _uiState.value.copy(configValuesUpdateTrigger = System.currentTimeMillis()) }
  }

  fun selectModel(model: Model) {
    _uiState.update { _uiState.value.copy(selectedModel = model) }
  }

  fun downloadModel(task: Task?, model: Model) {
    // Update status.
    setDownloadStatus(
      curModel = model,
      status = ModelDownloadStatus(status = ModelDownloadStatusType.IN_PROGRESS),
    )

    // Delete the model files first.
    deleteModel(model = model)

    // Start to send download request.
    downloadRepository.downloadModel(
      task = task,
      model = model,
      onStatusUpdated = this::setDownloadStatus,
    )
  }

  fun cancelDownloadModel(model: Model) {
    downloadRepository.cancelDownloadModel(model)
    deleteModel(model = model)
  }

  fun deleteModel(model: Model) {
    if (model.imported) {
      deleteFilesFromImportDir(model.downloadFileName)
    } else {
      deleteDirFromExternalFilesDir(model.normalizedName)
    }

    // Update model download status to NotDownloaded.
    val curModelDownloadStatus = uiState.value.modelDownloadStatus.toMutableMap()
    curModelDownloadStatus[model.name] =
      ModelDownloadStatus(status = ModelDownloadStatusType.NOT_DOWNLOADED)

    // Delete model from the list if model is imported as a local model.
    if (model.imported) {
      for (curTask in uiState.value.tasks) {
        val index = curTask.models.indexOf(model)
        if (index >= 0) {
          curTask.models.removeAt(index)
        }
        curTask.updateTrigger.value = System.currentTimeMillis()
      }
      curModelDownloadStatus.remove(model.name)

      // Update data store asynchronously.
      viewModelScope.launch(Dispatchers.IO) {
        val importedModels = dataStoreRepository.readImportedModels().toMutableList()
        val importedModelIndex = importedModels.indexOfFirst { it.fileName == model.name }
        if (importedModelIndex >= 0) {
          importedModels.removeAt(importedModelIndex)
        }
        dataStoreRepository.saveImportedModels(importedModels = importedModels)
      }
    }
    val newUiState =
      uiState.value.copy(
        modelDownloadStatus = curModelDownloadStatus,
        tasks = uiState.value.tasks.toList(),
        modelImportingUpdateTrigger = System.currentTimeMillis(),
      )
    _uiState.update { newUiState }
  }

  fun initializeModel(context: Context, task: Task, model: Model, force: Boolean = false) {
    viewModelScope.launch(Dispatchers.Default) {
      modelMutex(model.name).withLock {
        if (
          !force &&
            uiState.value.modelInitializationStatus[model.name]?.status ==
              ModelInitializationStatusType.INITIALIZED
        ) {
          Log.d(TAG, "Model '${model.name}' has been initialized. Skipping.")
          return@withLock
        }

        if (model.initializing) {
          model.cleanUpAfterInit = false
          Log.d(TAG, "Model '${model.name}' is being initialized. Skipping.")
          return@withLock
        }

        cleanupModelLocked(context = context, task = task, model = model)

        Log.d(TAG, "Initializing model '${model.name}'...")
        model.initializing = true
        updateModelInitializationStatus(
          model = model,
          status = ModelInitializationStatusType.INITIALIZING,
        )

        val onDone: (error: String) -> Unit = { error ->
          model.initializing = false
          if (model.instance != null) {
            Log.d(TAG, "Model '${model.name}' initialized successfully")
            updateModelInitializationStatus(
              model = model,
              status = ModelInitializationStatusType.INITIALIZED,
            )
            if (model.cleanUpAfterInit) {
              Log.d(TAG, "Model '${model.name}' needs cleaning up after init.")
              cleanupModel(context = context, task = task, model = model)
            }
          } else if (error.isNotEmpty()) {
            Log.d(TAG, "Model '${model.name}' failed to initialize")
            updateModelInitializationStatus(
              model = model,
              status = ModelInitializationStatusType.ERROR,
              error = error,
            )
          }
        }

        getCustomTaskByTaskId(id = task.id)
          ?.initializeModelFn(
            context = context,
            coroutineScope = viewModelScope,
            model = model,
            onDone = onDone,
          )
      }
    }
  }

  fun cleanupModel(context: Context, task: Task, model: Model, onDone: () -> Unit = {}) {
    viewModelScope.launch(Dispatchers.Default) {
      modelMutex(model.name).withLock {
        cleanupModelLocked(context, task, model, onDone)
      }
    }
  }

  private fun cleanupModelLocked(
    context: Context,
    task: Task,
    model: Model,
    onDone: () -> Unit = {},
  ) {
    if (model.instance != null) {
      model.cleanUpAfterInit = false
      Log.d(TAG, "Cleaning up model '${model.name}'...")
      val onDone: () -> Unit = {
        model.instance = null
        model.initializing = false
        updateModelInitializationStatus(
          model = model,
          status = ModelInitializationStatusType.NOT_INITIALIZED,
        )
        Log.d(TAG, "Clean up model '${model.name}' done")
        onDone()
      }
      getCustomTaskByTaskId(id = task.id)
        ?.cleanUpModelFn(
          context = context,
          coroutineScope = viewModelScope,
          model = model,
          onDone = onDone,
        )
    } else {
      if (model.initializing) {
        Log.d(
          TAG,
          "Model '${model.name}' is still initializing.. Will clean up after it is done initializing",
        )
        model.cleanUpAfterInit = true
      }
    }
  }

  fun setDownloadStatus(curModel: Model, status: ModelDownloadStatus) {
    // Update model download progress.
    val curModelDownloadStatus = uiState.value.modelDownloadStatus.toMutableMap()
    curModelDownloadStatus[curModel.name] = status
    val newUiState = uiState.value.copy(modelDownloadStatus = curModelDownloadStatus)

    // Delete downloaded file if status is failed or not_downloaded.
    if (
      status.status == ModelDownloadStatusType.FAILED ||
        status.status == ModelDownloadStatusType.NOT_DOWNLOADED
    ) {
      deleteFileFromExternalFilesDir(curModel.downloadFileName)
    }

    _uiState.update { newUiState }
  }

  fun setInitializationStatus(model: Model, status: ModelInitializationStatus) {
    val curStatus = uiState.value.modelInitializationStatus.toMutableMap()
    if (curStatus.containsKey(model.name)) {
      curStatus[model.name] = status
      _uiState.update { _uiState.value.copy(modelInitializationStatus = curStatus) }
    }
  }

  fun addTextInputHistory(text: String) {
    if (uiState.value.textInputHistory.indexOf(text) < 0) {
      val newHistory = uiState.value.textInputHistory.toMutableList()
      newHistory.add(0, text)
      if (newHistory.size > TEXT_INPUT_HISTORY_MAX_SIZE) {
        newHistory.removeAt(newHistory.size - 1)
      }
      _uiState.update { _uiState.value.copy(textInputHistory = newHistory) }
      val history = _uiState.value.textInputHistory
      viewModelScope.launch { dataStoreRepository.saveTextInputHistory(history) }
    } else {
      promoteTextInputHistoryItem(text)
    }
  }

  fun promoteTextInputHistoryItem(text: String) {
    val index = uiState.value.textInputHistory.indexOf(text)
    if (index >= 0) {
      val newHistory = uiState.value.textInputHistory.toMutableList()
      newHistory.removeAt(index)
      newHistory.add(0, text)
      _uiState.update { _uiState.value.copy(textInputHistory = newHistory) }
      val history = _uiState.value.textInputHistory
      viewModelScope.launch { dataStoreRepository.saveTextInputHistory(history) }
    }
  }

  fun deleteTextInputHistory(text: String) {
    val index = uiState.value.textInputHistory.indexOf(text)
    if (index >= 0) {
      val newHistory = uiState.value.textInputHistory.toMutableList()
      newHistory.removeAt(index)
      _uiState.update { _uiState.value.copy(textInputHistory = newHistory) }
      val history = _uiState.value.textInputHistory
      viewModelScope.launch { dataStoreRepository.saveTextInputHistory(history) }
    }
  }

  fun clearTextInputHistory() {
    _uiState.update { _uiState.value.copy(textInputHistory = mutableListOf()) }
    viewModelScope.launch { dataStoreRepository.saveTextInputHistory(emptyList()) }
  }

  fun readThemeOverride(): Theme {
    return ThemeSettings.themeOverride.value
  }

  fun saveThemeOverride(theme: Theme) {
    viewModelScope.launch { dataStoreRepository.saveTheme(theme = theme) }
  }

  fun saveAppLocale(appLocaleTag: String) {
    val normalized = normalizeAppLocaleTag(appLocaleTag)
    _uiState.update { it.copy(appLocaleTag = normalized) }
    viewModelScope.launch { dataStoreRepository.saveAppLocale(localeTag = normalized) }
  }

  fun getModelUrlResponse(model: Model, accessToken: String? = null): Int {
    try {
      val url = URL(model.url)
      val connection = url.openConnection() as HttpURLConnection
      if (accessToken != null) {
        connection.setRequestProperty("Authorization", "Bearer $accessToken")
      }
      connection.connect()

      // Report the result.
      return connection.responseCode
    } catch (e: Exception) {
      Log.e(TAG, "Failed to get model URL response", e)
      return -1
    }
  }

  fun addImportedLlmModel(info: ImportedModel) {
    Log.d(TAG, "adding imported llm model: $info")

    // Create model.
    val model = createModelFromImportedModelInfo(info = info)

    for (task in
      getTasksByIds(
        ids =
          setOf(
            BuiltInTaskId.LLM_CHAT,
            BuiltInTaskId.LLM_ASK_IMAGE,
            BuiltInTaskId.LLM_ASK_AUDIO,
            BuiltInTaskId.LLM_PROMPT_LAB,
            BuiltInTaskId.LLM_TINY_GARDEN,
            BuiltInTaskId.LLM_MOBILE_ACTIONS,
          )
      )) {
      // Remove duplicated imported model if existed.
      val modelIndex = task.models.indexOfFirst { info.fileName == it.name && it.imported }
      if (modelIndex >= 0) {
        Log.d(TAG, "duplicated imported model found in task. Removing it first")
        task.models.removeAt(modelIndex)
      }
      if (
        (task.id == BuiltInTaskId.LLM_ASK_IMAGE && model.llmSupportImage) ||
          (task.id == BuiltInTaskId.LLM_ASK_AUDIO && model.llmSupportAudio) ||
          (task.id == BuiltInTaskId.LLM_TINY_GARDEN && model.llmSupportTinyGarden) ||
          (task.id == BuiltInTaskId.LLM_MOBILE_ACTIONS && model.llmSupportMobileActions) ||
          (task.id != BuiltInTaskId.LLM_ASK_IMAGE &&
            task.id != BuiltInTaskId.LLM_ASK_AUDIO &&
            task.id != BuiltInTaskId.LLM_TINY_GARDEN &&
            task.id != BuiltInTaskId.LLM_MOBILE_ACTIONS)
      ) {
        task.models.add(model)
        if (task.id == BuiltInTaskId.LLM_TINY_GARDEN) {
          val newConfigs = model.configs.toMutableList()
          newConfigs.add(RESET_CONVERSATION_TURN_COUNT_CONFIG)
          model.configs = newConfigs
          model.preProcess()
        }
      }
      task.updateTrigger.value = System.currentTimeMillis()
    }

    // Add initial status and states.
    val modelDownloadStatus = uiState.value.modelDownloadStatus.toMutableMap()
    val modelInstances = uiState.value.modelInitializationStatus.toMutableMap()
    modelDownloadStatus[model.name] =
      ModelDownloadStatus(
        status = ModelDownloadStatusType.SUCCEEDED,
        receivedBytes = info.fileSize,
        totalBytes = info.fileSize,
      )
    modelInstances[model.name] =
      ModelInitializationStatus(status = ModelInitializationStatusType.NOT_INITIALIZED)

    // Update ui state.
    _uiState.update {
      uiState.value.copy(
        tasks = uiState.value.tasks.toList(),
        modelDownloadStatus = modelDownloadStatus,
        modelInitializationStatus = modelInstances,
        modelImportingUpdateTrigger = System.currentTimeMillis(),
      )
    }

    // Add to data store.
    viewModelScope.launch(Dispatchers.IO) {
      val importedModels = dataStoreRepository.readImportedModels().toMutableList()
      val importedModelIndex = importedModels.indexOfFirst { info.fileName == it.fileName }
      if (importedModelIndex >= 0) {
        Log.d(TAG, "duplicated imported model found in data store. Removing it first")
        importedModels.removeAt(importedModelIndex)
      }
      importedModels.add(info)
      dataStoreRepository.saveImportedModels(importedModels = importedModels)
    }
  }

  fun getTokenStatusAndData(): TokenStatusAndData {
    return _tokenStatusAndData.value
  }

  suspend fun getLatestTokenStatusAndData(): TokenStatusAndData {
    return loadTokenStatusAndData()
  }

  fun refreshTokenStatus() {
    viewModelScope.launch(Dispatchers.IO) { loadTokenStatusAndData() }
  }

  private suspend fun loadTokenStatusAndData(): TokenStatusAndData {
    return withContext(Dispatchers.IO) {
      var tokenStatus = TokenStatus.NOT_STORED
      StructuredLog.d(TAG, "token_status_read_started")
      val tokenData = dataStoreRepository.readAccessTokenData()

      // Token exists.
      if (tokenData != null && tokenData.accessToken.isNotEmpty()) {
        StructuredLog.d(TAG, "token_loaded")

        // Check expiration (with 5-minute buffer).
        val curTs = System.currentTimeMillis()
        val expirationTs = tokenData.expiresAtMs - 5 * 60
        StructuredLog.d(
          TAG,
          "token_expiration_check",
          "currentTs" to curTs,
          "expirationTs" to expirationTs,
        )
        if (curTs >= expirationTs) {
          StructuredLog.w(TAG, "token_expired")
          tokenStatus = TokenStatus.EXPIRED
        } else {
          StructuredLog.d(TAG, "token_valid")
          tokenStatus = TokenStatus.NOT_EXPIRED
          curAccessToken = tokenData.accessToken
        }
      } else {
        StructuredLog.d(TAG, "token_missing")
      }

      val resolved = TokenStatusAndData(status = tokenStatus, data = tokenData)
      _tokenStatusAndData.value = resolved
      resolved
    }
  }

  fun getAuthorizationRequest(): AuthorizationRequest {
    return AuthorizationRequest.Builder(
        ProjectConfig.authServiceConfig,
        ProjectConfig.clientId,
        ResponseTypeValues.CODE,
        ProjectConfig.redirectUri.toUri(),
      )
      .setScope("read-repos")
      .build()
  }

  fun handleAuthResult(result: ActivityResult, onTokenRequested: (TokenRequestResult) -> Unit) {
    val dataIntent = result.data
    if (dataIntent == null) {
      onTokenRequested(
        TokenRequestResult(
          status = TokenRequestResultType.FAILED,
          errorMessage = "Empty auth result",
        )
      )
      return
    }

    val response = AuthorizationResponse.fromIntent(dataIntent)
    val exception = AuthorizationException.fromIntent(dataIntent)

    when {
      response?.authorizationCode != null -> {
        // Authorization successful, exchange the code for tokens
        var errorMessage: String? = null
        authService.performTokenRequest(response.createTokenExchangeRequest()) {
          tokenResponse,
          tokenEx ->
          if (tokenResponse != null) {
            if (tokenResponse.accessToken == null) {
              errorMessage = "Empty access token"
            } else if (tokenResponse.refreshToken == null) {
              errorMessage = "Empty refresh token"
            } else if (tokenResponse.accessTokenExpirationTime == null) {
              errorMessage = "Empty expiration time"
            } else {
              // Token exchange successful. Store the tokens securely
              Log.d(TAG, "Token exchange successful. Storing tokens...")
              saveAccessToken(
                accessToken = tokenResponse.accessToken!!,
                refreshToken = tokenResponse.refreshToken!!,
                expiresAt = tokenResponse.accessTokenExpirationTime!!,
              )
              curAccessToken = tokenResponse.accessToken!!
              Log.d(TAG, "Token successfully saved.")
            }
          } else if (tokenEx != null) {
            errorMessage = "Token exchange failed: ${tokenEx.message}"
          } else {
            errorMessage = "Token exchange failed"
          }
          if (errorMessage == null) {
            onTokenRequested(TokenRequestResult(status = TokenRequestResultType.SUCCEEDED))
          } else {
            onTokenRequested(
              TokenRequestResult(
                status = TokenRequestResultType.FAILED,
                errorMessage = errorMessage,
              )
            )
          }
        }
      }

      exception != null -> {
        onTokenRequested(
          TokenRequestResult(
            status =
              if (exception.message == "User cancelled flow") TokenRequestResultType.USER_CANCELLED
              else TokenRequestResultType.FAILED,
            errorMessage = exception.message,
          )
        )
      }

      else -> {
        onTokenRequested(TokenRequestResult(status = TokenRequestResultType.USER_CANCELLED))
      }
    }
  }

  fun saveAccessToken(accessToken: String, refreshToken: String, expiresAt: Long) {
    viewModelScope.launch(Dispatchers.IO) {
      dataStoreRepository.saveAccessTokenData(
        accessToken = accessToken,
        refreshToken = refreshToken,
        expiresAt = expiresAt,
      )
      loadTokenStatusAndData()
    }
  }

  fun clearAccessToken() {
    viewModelScope.launch(Dispatchers.IO) {
      dataStoreRepository.clearAccessTokenData()
      loadTokenStatusAndData()
    }
  }

  private fun processPendingDownloads() {
    // Cancel all pending downloads for the retrieved models.
    downloadRepository.cancelAll {
      Log.d(TAG, "All workers are cancelled.")
      StructuredLog.d(TAG, "pending_downloads_cancelled")

      viewModelScope.launch(Dispatchers.Main) {
        val checkedModelNames = mutableSetOf<String>()
        val tokenStatusAndData = getLatestTokenStatusAndData()
        for (task in uiState.value.tasks) {
          for (model in task.models) {
            if (checkedModelNames.contains(model.name)) {
              continue
            }

            // Start download for partially downloaded models.
            val downloadStatus = uiState.value.modelDownloadStatus[model.name]?.status
            if (downloadStatus == ModelDownloadStatusType.PARTIALLY_DOWNLOADED) {
              if (
                tokenStatusAndData.status == TokenStatus.NOT_EXPIRED &&
                  tokenStatusAndData.data != null
              ) {
                model.accessToken = tokenStatusAndData.data.accessToken
              }
              StructuredLog.d(TAG, "pending_download_resumed", "model" to model.name)
              downloadRepository.downloadModel(
                task = task,
                model = model,
                onStatusUpdated = this@ModelManagerViewModel::setDownloadStatus,
              )
            }

            checkedModelNames.add(model.name)
          }
        }
      }
    }
  }

  fun loadModelAllowlist() {
    _uiState.update {
      uiState.value.copy(loadingModelAllowlist = true, loadingModelAllowlistError = "")
    }

    viewModelScope.launch(Dispatchers.IO) {
      try {
        // Load model allowlist json.
        var modelAllowlist: ModelAllowlist? = null

        // Try to read the test allowlist first.
        Log.d(TAG, "Loading test model allowlist.")
        modelAllowlist = readModelAllowlistFromDisk(fileName = MODEL_ALLOWLIST_TEST_FILENAME)

        // Local test only.
        if (TEST_MODEL_ALLOW_LIST.isNotEmpty()) {
          Log.d(TAG, "Loading local model allowlist for testing.")
          val gson = Gson()
          modelAllowlist = gson.fromJson(TEST_MODEL_ALLOW_LIST, ModelAllowlist::class.java)
        }

        if (modelAllowlist == null) {
          if (!isNetworkAvailable(context)) {
            Log.w(TAG, "No network available. Trying to load model allowlist from disk.")
            modelAllowlist = readModelAllowlistFromDisk()
            if (modelAllowlist == null) {
              _uiState.update {
                uiState.value.copy(
                  loadingModelAllowlistError = "You are offline. Connect to the internet to load the model list."
                )
              }
              return@launch
            }
          }
        } else {
          // Load from github.
          val url = getAllowlistUrl()
          Log.d(TAG, "Loading model allowlist from internet. Url: $url")
          val data = getJsonResponseWithRetry<ModelAllowlist>(
            url = url,
            maxAttempts = 3,
            initialDelayMs = 1000,
          )
          modelAllowlist = data?.jsonObj

          if (modelAllowlist == null) {
            Log.w(TAG, "Failed to load model allowlist from internet. Trying to load it from disk")
            modelAllowlist = readModelAllowlistFromDisk()
          } else {
            Log.d(TAG, "Done: loading model allowlist from internet")
            saveModelAllowlistToDisk(modelAllowlistContent = data?.textContent ?: "{}")
          }
        }

        if (modelAllowlist == null) {
          _uiState.update {
            uiState.value.copy(loadingModelAllowlistError = stringResource(R.string.model_allowlist_load_failed))
          }
          return@launch
        }

        Log.d(TAG, "Allowlist: $modelAllowlist")

        // Convert models in the allowlist.
        val curTasks = customTasks.map { it.task }
        val nameToModel = mutableMapOf<String, Model>()
        for (allowedModel in modelAllowlist.models) {
          if (allowedModel.disabled == true) {
            continue
          }

          val model = allowedModel.toModel()
          nameToModel.put(model.name, model)
          for (taskType in allowedModel.taskTypes) {
            val task = curTasks.find { it.id == taskType }
            task?.models?.add(model)

            if (task?.id == BuiltInTaskId.LLM_TINY_GARDEN) {
              val newConfigs = model.configs.toMutableList()
              newConfigs.add(RESET_CONVERSATION_TURN_COUNT_CONFIG)
              model.configs = newConfigs
            }
          }
        }

        // Find models from allowlist if a task's `modelNames` field is not empty.
        for (task in curTasks) {
          if (task.modelNames.isNotEmpty()) {
            for (modelName in task.modelNames) {
              val model = nameToModel[modelName]
              if (model == null) {
                Log.w(TAG, "Model '${modelName}' in task '${task.label}' not found in allowlist.")
                continue
              }
              task.models.add(model)
            }
          }
        }

        // Process all tasks.
        processTasks()

        // Update UI state.
        val refreshedState =
          createUiState()
            .copy(
              loadingModelAllowlist = false,
              tasks = curTasks,
              tasksByCategory = groupTasksByCategory(),
            )
        _uiState.update { refreshedState }

        // Process pending downloads.
        processPendingDownloads()
      } catch (e: Exception) {
        Log.e(TAG, "Failed to load model allowlist", e)
        _uiState.update {
          it.copy(
            loadingModelAllowlist = false,
            loadingModelAllowlistError = stringResource(R.string.model_allowlist_load_failed),
          )
        }
      }
    }
  }

  fun clearLoadModelAllowlistError() {
    val curTasks = customTasks.map { it.task }
    processTasks()
    viewModelScope.launch(Dispatchers.IO) {
      val refreshedState =
        createUiState()
          .copy(
            loadingModelAllowlist = false,
            tasks = curTasks,
            loadingModelAllowlistError = "",
            tasksByCategory = groupTasksByCategory(),
          )
      _uiState.update { refreshedState }
    }
  }

  fun setAppInForeground(foreground: Boolean) {
    lifecycleProvider.isAppInForeground = foreground
  }

  private fun isNetworkAvailable(context: Context): Boolean {
    val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = connectivityManager.activeNetwork ?: return false
    val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  private fun saveModelAllowlistToDisk(modelAllowlistContent: String) {
    try {
      Log.d(TAG, "Saving model allowlist to disk...")
      val file = File(externalFilesDir, MODEL_ALLOWLIST_FILENAME)
      file.writeText(modelAllowlistContent)
      Log.d(TAG, "Done: saving model allowlist to disk.")
    } catch (e: Exception) {
      Log.e(TAG, "failed to write model allowlist to disk", e)
    }
  }

  private fun readModelAllowlistFromDisk(
    fileName: String = MODEL_ALLOWLIST_FILENAME
  ): ModelAllowlist? {
    try {
      Log.d(TAG, "Reading model allowlist from disk: $fileName")
      val baseDir =
        if (fileName == MODEL_ALLOWLIST_TEST_FILENAME) File("/data/local/tmp") else externalFilesDir
      val file = File(baseDir, fileName)
      if (file.exists()) {
        val content = file.readText()
        Log.d(TAG, "Model allowlist content from local file: $content")

        val gson = Gson()
        return gson.fromJson(content, ModelAllowlist::class.java)
      }
    } catch (e: Exception) {
      Log.e(TAG, "failed to read model allowlist from disk", e)
      return null
    }

    return null
  }

  private fun isModelPartiallyDownloaded(model: Model): Boolean {
    if (model.localModelFilePathOverride.isNotEmpty()) {
      return false
    }

    // A model is partially downloaded when the tmp file exists.
    val tmpFilePath =
      model.getPath(context = context, fileName = "${model.downloadFileName}.$TMP_FILE_EXT")
    return File(tmpFilePath).exists()
  }

  private fun createEmptyUiState(): ModelManagerUiState {
    return ModelManagerUiState(
      tasks = listOf(),
      tasksByCategory = mapOf(),
      modelDownloadStatus = mapOf(),
      modelInitializationStatus = mapOf(),
      deviceAiStateMessage = stringResource(R.string.device_ai_protocol_idle),
    )
  }

  private suspend fun createUiState(): ModelManagerUiState {
    val modelDownloadStatus: MutableMap<String, ModelDownloadStatus> = mutableMapOf()
    val modelInstances: MutableMap<String, ModelInitializationStatus> = mutableMapOf()
    val tasks: MutableMap<String, Task> = mutableMapOf()
    val checkedModelNames = mutableSetOf<String>()
    for (customTask in customTasks) {
      val task = customTask.task
      tasks.put(key = task.id, value = task)
      for (model in task.models) {
        if (checkedModelNames.contains(model.name)) {
          continue
        }
        modelDownloadStatus[model.name] = getModelDownloadStatus(model = model)
        modelInstances[model.name] =
          ModelInitializationStatus(status = ModelInitializationStatusType.NOT_INITIALIZED)
        checkedModelNames.add(model.name)
      }
    }

    // Load imported models.
    for (importedModel in dataStoreRepository.readImportedModels()) {
      Log.d(TAG, "stored imported model: $importedModel")

      // Create model.
      val model = createModelFromImportedModelInfo(info = importedModel)

      // Add to task.
      tasks.get(key = BuiltInTaskId.LLM_CHAT)?.models?.add(model)
      tasks.get(key = BuiltInTaskId.LLM_PROMPT_LAB)?.models?.add(model)
      if (model.llmSupportImage) {
        tasks.get(key = BuiltInTaskId.LLM_ASK_IMAGE)?.models?.add(model)
      }
      if (model.llmSupportAudio) {
        tasks.get(key = BuiltInTaskId.LLM_ASK_AUDIO)?.models?.add(model)
      }
      if (model.llmSupportTinyGarden) {
        tasks.get(key = BuiltInTaskId.LLM_TINY_GARDEN)?.models?.add(model)
        val newConfigs = model.configs.toMutableList()
        newConfigs.add(RESET_CONVERSATION_TURN_COUNT_CONFIG)
        model.configs = newConfigs
        model.preProcess()
      }
      if (model.llmSupportMobileActions) {
        tasks.get(key = BuiltInTaskId.LLM_MOBILE_ACTIONS)?.models?.add(model)
      }

      // Update status.
      modelDownloadStatus[model.name] =
        ModelDownloadStatus(
          status = ModelDownloadStatusType.SUCCEEDED,
          receivedBytes = importedModel.fileSize,
          totalBytes = importedModel.fileSize,
        )
    }

    val textInputHistory = dataStoreRepository.readTextInputHistory()
    val appLocaleTag = normalizeAppLocaleTag(dataStoreRepository.readAppLocale())
    Log.d(TAG, "text input history: $textInputHistory")

    Log.d(TAG, "model download status: $modelDownloadStatus")
    return ModelManagerUiState(
      tasks = customTasks.map { it.task }.toList(),
      tasksByCategory = mapOf(),
      modelDownloadStatus = modelDownloadStatus,
      modelInitializationStatus = modelInstances,
      appLocaleTag = appLocaleTag,
      textInputHistory = textInputHistory,
    )
  }

  private fun createModelFromImportedModelInfo(info: ImportedModel): Model {
    val accelerators: MutableList<Accelerator> =
      info.llmConfig.compatibleAcceleratorsList
        .mapNotNull { acceleratorLabel ->
          when (acceleratorLabel.trim()) {
            Accelerator.GPU.label -> Accelerator.GPU
            Accelerator.CPU.label -> Accelerator.CPU
            else -> null // Ignore unknown accelerator labels
          }
        }
        .toMutableList()
    val llmMaxToken = info.llmConfig.defaultMaxTokens
    val configs: MutableList<Config> =
      createLlmChatConfigs(
          defaultMaxToken = llmMaxToken,
          defaultTopK = info.llmConfig.defaultTopk,
          defaultTopP = info.llmConfig.defaultTopp,
          defaultTemperature = info.llmConfig.defaultTemperature,
          accelerators = accelerators,
        )
        .toMutableList()
    val llmSupportImage = info.llmConfig.supportImage
    val llmSupportAudio = info.llmConfig.supportAudio
    val llmSupportTinyGarden = info.llmConfig.supportTinyGarden
    val llmSupportMobileActions = info.llmConfig.supportMobileActions
    val model =
      Model(
        name = info.fileName,
        url = "",
        configs = configs,
        sizeInBytes = info.fileSize,
        downloadFileName = "$IMPORTS_DIR/${info.fileName}",
        showBenchmarkButton = false,
        showRunAgainButton = false,
        imported = true,
        llmSupportImage = llmSupportImage,
        llmSupportAudio = llmSupportAudio,
        llmSupportTinyGarden = llmSupportTinyGarden,
        llmSupportMobileActions = llmSupportMobileActions,
        llmMaxToken = llmMaxToken,
        accelerators = accelerators,
        // We assume all imported models are LLM for now.
        isLlm = true,
      )
    model.preProcess()

    return model
  }

  private fun groupTasksByCategory(): Map<String, List<Task>> {
    val tasks = customTasks.map { it.task }

    val categoryMap: Map<String, CategoryInfo> =
      tasks.associateBy { it.category.id }.mapValues { it.value.category }

    val groupedTasks = tasks.groupBy { it.category.id }
    val groupedSortedTasks: MutableMap<String, List<Task>> = mutableMapOf()
    // Sort the tasks in categories by pre-defined order. Sort other tasks by label.
    for (categoryId in groupedTasks.keys) {
      val sortedTasks =
        groupedTasks[categoryId]!!.sortedWith { a, b ->
          if (categoryId == Category.LLM.id) {
            val order: List<String> =
              when (categoryId) {
                Category.LLM.id -> PREDEFINED_LLM_TASK_ORDER
                else -> listOf()
              }
            val indexA = order.indexOf(a.id)
            val indexB = order.indexOf(b.id)
            if (indexA != -1 && indexB != -1) {
              indexA.compareTo(indexB)
            } else if (indexA != -1) {
              -1
            } else if (indexB != -1) {
              1
            } else {
              val ca = categoryMap[a.id]!!
              val cb = categoryMap[b.id]!!
              val caLabel = getCategoryLabel(context = context, category = ca)
              val cbLabel = getCategoryLabel(context = context, category = cb)
              caLabel.compareTo(cbLabel)
            }
          } else {
            a.label.compareTo(b.label)
          }
        }
      for ((index, task) in sortedTasks.withIndex()) {
        task.index = index
      }
      groupedSortedTasks[categoryId] = sortedTasks
    }

    return groupedSortedTasks
  }

  private fun getCategoryLabel(context: Context, category: CategoryInfo): String {
    val stringRes = category.labelStringRes
    val label = category.label
    if (stringRes != null) {
      return context.getString(stringRes)
    } else if (label != null) {
      return label
    }
    return context.getString(R.string.category_unlabeled)
  }

  /**
   * Retrieves the download status of a model.
   *
   * This function determines the download status of a given model by checking if it's fully
   * downloaded, partially downloaded, or not downloaded at all. It also retrieves the received and
   * total bytes for partially downloaded models.
   */
  private fun getModelDownloadStatus(model: Model): ModelDownloadStatus {
    Log.d(TAG, "Checking model ${model.name} download status...")

    if (model.localFileRelativeDirPathOverride.isNotEmpty()) {
      Log.d(TAG, "Model has localFileRelativeDirPathOverride set. Set status to SUCCEEDED")
      return ModelDownloadStatus(
        status = ModelDownloadStatusType.SUCCEEDED,
        receivedBytes = 0,
        totalBytes = 0,
      )
    }

    var status = ModelDownloadStatusType.NOT_DOWNLOADED
    var receivedBytes = 0L
    var totalBytes = 0L

    // Partially downloaded.
    if (isModelPartiallyDownloaded(model = model)) {
      status = ModelDownloadStatusType.PARTIALLY_DOWNLOADED
      val tmpFilePath =
        model.getPath(context = context, fileName = "${model.downloadFileName}.$TMP_FILE_EXT")
      val tmpFile = File(tmpFilePath)
      receivedBytes = tmpFile.length()
      totalBytes = model.totalBytes
      Log.d(TAG, "${model.name} is partially downloaded. $receivedBytes/$totalBytes")
    }
    // Fully downloaded.
    else if (isModelDownloaded(model = model)) {
      status = ModelDownloadStatusType.SUCCEEDED
      Log.d(TAG, "${model.name} has been downloaded.")
    }
    // Not downloaded.
    else {
      Log.d(TAG, "${model.name} has not been downloaded.")
    }

    return ModelDownloadStatus(
      status = status,
      receivedBytes = receivedBytes,
      totalBytes = totalBytes,
    )
  }

  private fun isFileInExternalFilesDir(fileName: String): Boolean {
    val file = File(externalFilesDir, fileName)
    return file.exists()
  }

  private fun isFileInDataLocalTmpDir(fileName: String): Boolean {
    val file = File("/data/local/tmp", fileName)
    return file.exists()
  }

  private fun deleteFileFromExternalFilesDir(fileName: String) {
    if (isFileInExternalFilesDir(fileName)) {
      val file = File(externalFilesDir, fileName)
      file.delete()
    }
  }

  /**
   * Deletes files from the the model imports directory whose absolute paths start with a given
   * prefix.
   */
  private fun deleteFilesFromImportDir(fileName: String) {
    val dir = File(externalFilesDir, IMPORTS_DIR)
    val prefixAbsolutePath = "${externalFilesDir.absolutePath}${File.separator}$fileName"
    val filesToDelete =
      dir.listFiles { dirFile, name ->
        File(dirFile, name).absolutePath.startsWith(prefixAbsolutePath)
      } ?: arrayOf()
    for (file in filesToDelete) {
      Log.d(TAG, "Deleting file: ${file.name}")
      file.delete()
    }
  }

  private fun deleteDirFromExternalFilesDir(dir: String) {
    if (isFileInExternalFilesDir(dir)) {
      val file = File(externalFilesDir, dir)
      file.deleteRecursively()
    }
  }

  private fun updateModelInitializationStatus(
    model: Model,
    status: ModelInitializationStatusType,
    error: String = "",
  ) {
    val curModelInstance = uiState.value.modelInitializationStatus.toMutableMap()
    curModelInstance[model.name] = ModelInitializationStatus(status = status, error = error)
    val newUiState = uiState.value.copy(modelInitializationStatus = curModelInstance)
    _uiState.update { newUiState }
  }

  private fun isModelDownloaded(model: Model): Boolean {
    val modelRelativePath =
      listOf(model.normalizedName, model.version, model.downloadFileName)
        .joinToString(File.separator)
    val downloadedFileExists =
      model.downloadFileName.isNotEmpty() &&
        ((model.localModelFilePathOverride.isEmpty() &&
          isFileInExternalFilesDir(modelRelativePath)) ||
          (model.localModelFilePathOverride.isNotEmpty() &&
            File(model.localModelFilePathOverride).exists()))

    val unzippedDirectoryExists =
      model.isZip &&
        model.unzipDir.isNotEmpty() &&
        isFileInExternalFilesDir(
          listOf(model.normalizedName, model.version, model.unzipDir).joinToString(File.separator)
        )

    return downloadedFileExists || unzippedDirectoryExists
  }

}

private fun getAllowlistUrl(): String {
  val version = BuildConfig.VERSION_NAME.replace(".", "_")

  return "${VertuRuntimeConfig.modelAllowlistBaseUrl}/${version}.json"
}
