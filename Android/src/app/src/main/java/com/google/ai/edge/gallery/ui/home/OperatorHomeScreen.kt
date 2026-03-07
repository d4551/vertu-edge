package com.google.ai.edge.gallery.ui.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowOutward
import androidx.compose.material.icons.rounded.AutoMode
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.CloudDownload
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.SettingsEthernet
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.ai.edge.gallery.GalleryTopAppBar
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.common.APP_LOCALE_SYSTEM
import com.google.ai.edge.gallery.common.applyAppLocale
import com.google.ai.edge.gallery.customtasks.mobileactions.MobileActionsViewModel
import com.google.ai.edge.gallery.customtasks.mobileactions.OperatorApprovalRequest
import com.google.ai.edge.gallery.customtasks.mobileactions.OperatorAutomationResult
import com.google.ai.edge.gallery.data.AppBarAction
import com.google.ai.edge.gallery.data.AppBarActionType
import com.google.ai.edge.gallery.data.BuiltInTaskId
import com.google.ai.edge.gallery.data.Task
import com.google.ai.edge.gallery.ui.common.textandvoiceinput.HoldToDictate
import com.google.ai.edge.gallery.ui.common.textandvoiceinput.HoldToDictateViewModel
import com.google.ai.edge.gallery.ui.common.textandvoiceinput.VoiceRecognizerOverlay
import com.google.ai.edge.gallery.ui.common.tos.AppTosDialog
import com.google.ai.edge.gallery.ui.common.tos.TosViewModel
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel
import com.google.ai.edge.gallery.ui.modelmanager.OperatorRuntimeSummary
import com.google.ai.edge.gallery.ui.modelmanager.OperatorTimelineEntry
import com.google.ai.edge.gallery.ui.modelmanager.OperatorTimelineRole
import com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadiness
import com.vertu.edge.core.flow.FlowExecutionState
import kotlinx.coroutines.launch

private const val OPERATOR_COMPOSER_ITEM_INDEX = 0
private val OPERATOR_LANGUAGE_OPTIONS =
  listOf(
    APP_LOCALE_SYSTEM to R.string.settings_language_system,
    "en" to R.string.settings_language_english,
    "es" to R.string.settings_language_spanish,
    "fr" to R.string.settings_language_french,
    "zh-CN" to R.string.settings_language_chinese_simplified,
  )

/** Primary entry surface for conversational RPA operations. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OperatorHomeScreen(
  modelManagerViewModel: ModelManagerViewModel,
  tosViewModel: TosViewModel,
  navigateToTaskScreen: (Task) -> Unit,
  onModelsClicked: () -> Unit,
  onRuntimeAdminClicked: () -> Unit,
  mobileActionsViewModel: MobileActionsViewModel = hiltViewModel(),
  modifier: Modifier = Modifier,
) {
  val uiState by modelManagerViewModel.uiState.collectAsState()
  val tosAccepted by tosViewModel.isTosAccepted.collectAsState()
  val operatorScope = rememberCoroutineScope()
  val listState = rememberLazyListState()
  val holdToDictateViewModel: HoldToDictateViewModel = hiltViewModel()
  val holdToDictateUiState by holdToDictateViewModel.uiState.collectAsState()
  var showSettingsDialog by remember { mutableStateOf(false) }
  var showTosDialog by remember { mutableStateOf(!tosAccepted) }
  var runOnPhone by remember { mutableStateOf(false) }
  var phoneAutomationState by remember { mutableStateOf(FlowExecutionState.IDLE) }
  var phoneAutomationMessage by remember { mutableStateOf("") }
  var isRunningPhoneAutomation by remember { mutableStateOf(false) }
  var pendingApproval by remember { mutableStateOf<OperatorApprovalRequest?>(null) }
  var phoneAutomationJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
  var curAmplitude by remember { mutableStateOf(0) }

  LaunchedEffect(tosAccepted) {
    showTosDialog = !tosAccepted
  }

  LaunchedEffect(Unit) {
    modelManagerViewModel.ensureCloudProvidersLoaded()
    modelManagerViewModel.selectDefaultModelForTask(BuiltInTaskId.LLM_CHAT)
  }

  if (showTosDialog) {
    AppTosDialog(onTosAccepted = tosViewModel::acceptTos)
    return
  }

  val localChatTask = modelManagerViewModel.getTaskById(BuiltInTaskId.LLM_CHAT)
  val localAutomationTask = modelManagerViewModel.getTaskById(BuiltInTaskId.LLM_MOBILE_ACTIONS)
  val runtimeSummary = modelManagerViewModel.buildOperatorRuntimeSummary()
  val requiredModelReadiness = modelManagerViewModel.buildRequiredModelReadiness()
  val userTimelineTitle = stringResource(R.string.operator_timeline_user_title)
  val assistantTimelineTitle = stringResource(R.string.operator_timeline_assistant_title)
  val planTimelineTitle = stringResource(R.string.operator_timeline_plan_title)
  val phoneTimelineTitle = stringResource(R.string.operator_timeline_phone_title)
  val runtimeTimelineTitle = stringResource(R.string.operator_timeline_runtime_title)
  val phoneStartingMessage = stringResource(R.string.operator_phone_starting)
  val phoneModelMissingMessage = stringResource(R.string.operator_phone_model_missing)
  val phoneApprovalSubmittingMessage = stringResource(R.string.operator_phone_approval_submitting)
  val phoneApprovalDismissedMessage = stringResource(R.string.operator_phone_approval_dismissed)

  VertuScaffold(
    modifier = modifier,
    topBar = {
      GalleryTopAppBar(
        title = stringResource(R.string.operator_home_title),
        subtitle = stringResource(R.string.operator_home_subtitle),
        showLogo = true,
        leftAction = AppBarAction(AppBarActionType.MENU, onRuntimeAdminClicked),
        rightAction = AppBarAction(AppBarActionType.APP_SETTING, { showSettingsDialog = true }),
      )
    },
    floatingActionButton = {
      VertuFloatingChatBubble(
        onClick = { operatorScope.launch { listState.animateScrollToItem(OPERATOR_COMPOSER_ITEM_INDEX) } },
        icon = Icons.Rounded.ChatBubbleOutline,
      )
    },
  ) { innerPadding ->
    Box(modifier = Modifier.fillMaxSize()) {
      LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(
          start = 16.dp,
          end = 16.dp,
          top = innerPadding.calculateTopPadding() + 12.dp,
          bottom = innerPadding.calculateBottomPadding() + 84.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
      ) {
        item(key = "composer") {
          OperatorComposerCard(
            message = uiState.cloudChatMessage,
            requestTts = uiState.cloudChatRequestTts,
            runOnPhone = runOnPhone,
            isSending = if (runOnPhone) isRunningPhoneAutomation else uiState.isSendingCloudChat,
            localChatTask = localChatTask,
            holdToDictateViewModel = holdToDictateViewModel,
            onMessageChanged = modelManagerViewModel::setCloudChatMessage,
            onRequestTtsChanged = modelManagerViewModel::setCloudChatRequestTts,
            onRunOnPhoneChanged = { enabled ->
              runOnPhone = enabled
              if (enabled) {
                modelManagerViewModel.selectDefaultModelForTask(BuiltInTaskId.LLM_MOBILE_ACTIONS)
              }
            },
            onAmplitudeChanged = { curAmplitude = it },
            onSend = {
              val outboundMessage = uiState.cloudChatMessage.trim()
              if (outboundMessage.isBlank()) {
                return@OperatorComposerCard
              }
              modelManagerViewModel.setCloudChatMessage("")
              if (!runOnPhone) {
                pendingApproval = null
                modelManagerViewModel.setCloudChatMessage(outboundMessage)
                modelManagerViewModel.sendCloudChat()
                modelManagerViewModel.setCloudChatMessage("")
                return@OperatorComposerCard
              }

              modelManagerViewModel.addOperatorTimelineEntry(
                role = OperatorTimelineRole.USER,
                title = userTimelineTitle,
                body = outboundMessage,
                state = FlowExecutionState.SUCCESS,
              )

              operatorScope.launch {
                val automationModel =
                  modelManagerViewModel.getPreferredModelForTask(BuiltInTaskId.LLM_MOBILE_ACTIONS)
                if (automationModel == null) {
                  phoneAutomationState = FlowExecutionState.ERROR_NON_RETRYABLE
                  phoneAutomationMessage = phoneModelMissingMessage
                  modelManagerViewModel.addOperatorTimelineEntry(
                    role = OperatorTimelineRole.RUN,
                    title = phoneTimelineTitle,
                    body = phoneModelMissingMessage,
                    state = FlowExecutionState.ERROR_NON_RETRYABLE,
                  )
                  return@launch
                }

                isRunningPhoneAutomation = true
                pendingApproval = null
                phoneAutomationState = FlowExecutionState.LOADING
                phoneAutomationMessage = phoneStartingMessage
                modelManagerViewModel.addOperatorTimelineEntry(
                  role = OperatorTimelineRole.RUN,
                  title = runtimeTimelineTitle,
                  body = phoneStartingMessage,
                  state = FlowExecutionState.LOADING,
                )
                phoneAutomationJob = operatorScope.launch {
                  val result =
                    mobileActionsViewModel.executeOperatorPrompt(
                      model = automationModel,
                      userPrompt = outboundMessage,
                      modelManagerViewModel = modelManagerViewModel,
                    )
                  applyOperatorAutomationResult(
                    modelManagerViewModel = modelManagerViewModel,
                    result = result,
                    assistantTitle = assistantTimelineTitle,
                    planTitle = planTimelineTitle,
                    phoneTitle = phoneTimelineTitle,
                    onPhoneStatusChanged = { state, message ->
                      phoneAutomationState = state
                      phoneAutomationMessage = message
                    },
                    onPendingApprovalChanged = { pendingApproval = it },
                  )
                  isRunningPhoneAutomation = false
                  phoneAutomationJob = null
                }
                phoneAutomationJob?.invokeOnCompletion {
                  isRunningPhoneAutomation = false
                  phoneAutomationJob = null
                }
              }
            },
          )
        }
        item(key = "runtime-strip") {
          OperatorRuntimeStrip(
            runtimeSummary = runtimeSummary,
            requiredModelReadiness = requiredModelReadiness,
            appLocaleTag = uiState.appLocaleTag,
            providerOptions = uiState.providerOptions,
            selectedProvider = uiState.selectedProvider,
            selectedCloudModel = uiState.selectedCloudModel,
            cloudModelOptions = uiState.cloudModelOptions,
            providerMessage = uiState.providerRegistryMessage,
            modelMessage = uiState.cloudModelListMessage,
            pullMessage = uiState.cloudPullMessage,
            isLoadingProviders = uiState.isLoadingProviderRegistry,
            isLoadingModels = uiState.isLoadingCloudModels,
            isPulling = uiState.isSubmittingCloudPull || uiState.isPollingCloudPull,
            onProviderSelected = modelManagerViewModel::setSelectedProvider,
            onModelSelected = modelManagerViewModel::setSelectedCloudModel,
            onLoadProviders = modelManagerViewModel::loadCloudProviders,
            onLoadModels = modelManagerViewModel::loadCloudModelsForSelectedProvider,
            onOpenRuntimeAdmin = onRuntimeAdminClicked,
            onLocaleSelected = { appLocaleTag ->
              modelManagerViewModel.saveAppLocale(appLocaleTag)
              applyAppLocale(appLocaleTag)
            },
            onPrimaryReadinessAction = {
              if (requiredModelReadiness.state == com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.NOT_INSTALLED ||
                requiredModelReadiness.state == com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.FAILED
              ) {
                modelManagerViewModel.runDeviceAiProtocol()
              } else {
                modelManagerViewModel.runDeviceAiProtocol()
              }
            },
            onPullModel = {
              if (uiState.cloudPullModelRef.isBlank() && uiState.selectedCloudModel.isNotBlank()) {
                modelManagerViewModel.setCloudPullModelRef(uiState.selectedCloudModel)
              }
              if (uiState.cloudPullSource.isBlank() && uiState.selectedProvider.isNotBlank()) {
                modelManagerViewModel.setCloudPullSource(uiState.selectedProvider)
              }
              modelManagerViewModel.pullCloudModel()
            },
            onFocusComposer = { operatorScope.launch { listState.animateScrollToItem(OPERATOR_COMPOSER_ITEM_INDEX) } },
          )
        }
        if (pendingApproval != null) {
          item(key = "approval") {
            OperatorApprovalCard(
              approval = pendingApproval!!,
              isSubmitting = isRunningPhoneAutomation,
              onApprove = {
                val approval = pendingApproval ?: return@OperatorApprovalCard
                operatorScope.launch {
                  isRunningPhoneAutomation = true
                  phoneAutomationState = FlowExecutionState.LOADING
                  phoneAutomationMessage = phoneApprovalSubmittingMessage
                  modelManagerViewModel.addOperatorTimelineEntry(
                    role = OperatorTimelineRole.RUN,
                    title = phoneTimelineTitle,
                    body = phoneApprovalSubmittingMessage,
                    state = FlowExecutionState.LOADING,
                  )
                  val result = mobileActionsViewModel.approveOperatorPrompt(approval = approval)
                  applyOperatorAutomationResult(
                    modelManagerViewModel = modelManagerViewModel,
                    result = result,
                    assistantTitle = assistantTimelineTitle,
                    planTitle = planTimelineTitle,
                    phoneTitle = phoneTimelineTitle,
                    onPhoneStatusChanged = { state, message ->
                      phoneAutomationState = state
                      phoneAutomationMessage = message
                    },
                    onPendingApprovalChanged = { pendingApproval = it },
                  )
                  isRunningPhoneAutomation = false
                }
              },
              onDismiss = {
                pendingApproval = null
                phoneAutomationState = FlowExecutionState.IDLE
                phoneAutomationMessage = phoneApprovalDismissedMessage
              },
            )
          }
        }
        item(key = "timeline") {
          OperatorTimelineCard(entries = uiState.operatorTimeline)
        }
        item(key = "status") {
          OperatorExecutionStatusCard(
            cloudChatState = uiState.cloudChatState,
            cloudChatMessage = uiState.cloudChatStateMessage,
            cloudPullState = uiState.cloudPullState,
            cloudPullMessage = uiState.cloudPullMessage,
            cloudPullJobId = uiState.cloudPullJobId,
            deviceAiState = uiState.deviceAiState,
            deviceAiMessage = uiState.deviceAiStateMessage,
            deviceAiCorrelationId = uiState.deviceAiCorrelationId,
            phoneAutomationState = phoneAutomationState,
            phoneAutomationMessage = phoneAutomationMessage,
          )
        }
        item(key = "action-bar") {
          OperatorActionBar(
            onRuntimeAdminClicked = onRuntimeAdminClicked,
            onModelsClicked = onModelsClicked,
            onVerifyDeviceModelClicked = modelManagerViewModel::runDeviceAiProtocol,
            onOpenLocalChat = { localChatTask?.let(navigateToTaskScreen) },
            onOpenLocalAutomation = { localAutomationTask?.let(navigateToTaskScreen) },
          )
        }
      }
      AnimatedVisibility(
        holdToDictateUiState.recognizing,
        enter = fadeIn(animationSpec = tween(durationMillis = 150, easing = FastOutSlowInEasing)),
        exit = fadeOut(animationSpec = tween(durationMillis = 100, easing = FastOutSlowInEasing, delayMillis = 300)),
      ) {
        localChatTask?.let { task ->
          VoiceRecognizerOverlay(
            task = task,
            viewModel = holdToDictateViewModel,
            bottomPadding = innerPadding.calculateBottomPadding(),
            curAmplitude = curAmplitude,
          )
        }
      }
    }
  }

  if (showSettingsDialog) {
    SettingsDialog(
      curThemeOverride = modelManagerViewModel.readThemeOverride(),
      modelManagerViewModel = modelManagerViewModel,
      onDismissed = { showSettingsDialog = false },
    )
  }
}

@Composable
private fun OperatorRuntimeStrip(
  runtimeSummary: OperatorRuntimeSummary,
  requiredModelReadiness: RequiredModelReadiness,
  appLocaleTag: String,
  providerOptions: List<String>,
  selectedProvider: String,
  selectedCloudModel: String,
  cloudModelOptions: List<String>,
  providerMessage: String,
  modelMessage: String,
  pullMessage: String,
  isLoadingProviders: Boolean,
  isLoadingModels: Boolean,
  isPulling: Boolean,
  onProviderSelected: (String) -> Unit,
  onModelSelected: (String) -> Unit,
  onLoadProviders: () -> Unit,
  onLoadModels: () -> Unit,
  onOpenRuntimeAdmin: () -> Unit,
  onLocaleSelected: (String) -> Unit,
  onPrimaryReadinessAction: () -> Unit,
  onPullModel: () -> Unit,
  onFocusComposer: () -> Unit,
) {
  VertuPanel(
    title = stringResource(R.string.operator_runtime_strip_title),
    subtitle = stringResource(R.string.operator_runtime_strip_subtitle),
  ) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      VertuChip(
        label = stringResource(R.string.operator_runtime_source_local),
        active = runtimeSummary.activeLocalModel.isNotBlank(),
        leadingIcon = Icons.Rounded.PhoneAndroid,
      )
      VertuChip(
        label = stringResource(R.string.operator_runtime_source_cloud),
        active = runtimeSummary.activeProvider.isNotBlank(),
        leadingIcon = Icons.Rounded.Public,
      )
      VertuChip(
        label = stringResource(R.string.operator_runtime_provider_value, runtimeSummary.activeProvider.ifBlank { stringResource(R.string.operator_not_set) }),
        active = runtimeSummary.activeProvider.isNotBlank(),
        leadingIcon = Icons.Rounded.Public,
      )
      VertuChip(
        label = stringResource(R.string.operator_runtime_model_value, runtimeSummary.activeCloudModel.ifBlank { stringResource(R.string.operator_not_set) }),
        active = runtimeSummary.activeCloudModel.isNotBlank(),
        leadingIcon = Icons.Rounded.AutoMode,
      )
      VertuChip(
        label = stringResource(R.string.operator_runtime_local_model_value, runtimeSummary.activeLocalModel.ifBlank { stringResource(R.string.operator_not_set) }),
        active = runtimeSummary.activeLocalModel.isNotBlank(),
        leadingIcon = Icons.Rounded.PhoneAndroid,
      )
    }

    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      runtimeSummary.capabilities.forEach { capability ->
        VertuChip(
          label = capability.label,
          active = capability.available,
          leadingIcon =
            when (capability.key) {
              "chat" -> Icons.Rounded.ChatBubbleOutline
              "automation" -> Icons.Rounded.PhoneAndroid
              "voice_in" -> Icons.Rounded.Mic
              else -> Icons.Rounded.ArrowOutward
            },
        )
      }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(stringResource(R.string.settings_language), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OPERATOR_LANGUAGE_OPTIONS.forEach { (localeTag, labelRes) ->
          VertuChip(
            label = stringResource(labelRes),
            active = localeTag == appLocaleTag,
            leadingIcon = Icons.Rounded.Public,
            onClick = { onLocaleSelected(localeTag) },
          )
        }
      }
    }

    if (providerOptions.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.operator_provider_picker_title), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          providerOptions.forEach { provider ->
            VertuChip(
              label = provider,
              active = provider == selectedProvider,
              leadingIcon = if (provider.equals("ollama", ignoreCase = true)) Icons.Rounded.PhoneAndroid else Icons.Rounded.Public,
              onClick = { onProviderSelected(provider) },
            )
          }
        }
      }
    }

    if (cloudModelOptions.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.operator_model_picker_title), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          cloudModelOptions.take(10).forEach { model ->
            VertuChip(
              label = model,
              active = model == selectedCloudModel,
              leadingIcon = Icons.Rounded.Memory,
              onClick = { onModelSelected(model) },
            )
          }
        }
      }
    }

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      VertuSecondaryButton(
        label = stringResource(R.string.load_configured_providers),
        onClick = onLoadProviders,
        modifier = Modifier.weight(1f),
        leadingIcon = Icons.Rounded.Public,
        enabled = !isLoadingProviders,
      )
      VertuSecondaryButton(
        label = stringResource(R.string.runtime_admin_load_models),
        onClick = onLoadModels,
        modifier = Modifier.weight(1f),
        leadingIcon = Icons.Rounded.Memory,
        enabled = selectedProvider.isNotBlank() && !isLoadingModels,
      )
    }

    if (providerMessage.isNotBlank() || modelMessage.isNotBlank()) {
      Text(
        listOf(providerMessage, modelMessage).filter(String::isNotBlank).joinToString(" · "),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    RequiredModelCard(
      readiness = requiredModelReadiness,
      runtimeSummary = runtimeSummary,
      pullMessage = pullMessage,
      isPulling = isPulling,
      onPrimaryReadinessAction = onPrimaryReadinessAction,
      onPullModel = onPullModel,
      onOpenRuntimeAdmin = onOpenRuntimeAdmin,
      onFocusComposer = onFocusComposer,
    )
  }
}

@Composable
private fun RequiredModelCard(
  readiness: RequiredModelReadiness,
  runtimeSummary: OperatorRuntimeSummary,
  pullMessage: String,
  isPulling: Boolean,
  onPrimaryReadinessAction: () -> Unit,
  onPullModel: () -> Unit,
  onOpenRuntimeAdmin: () -> Unit,
  onFocusComposer: () -> Unit,
) {
  VertuPanel(
    title = readiness.title,
    subtitle = readiness.detail,
  ) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      VertuChip(
        label = stringResource(R.string.operator_runtime_readiness_state, readinessLabel(readiness.state)),
        active = readiness.state != com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.FAILED,
        leadingIcon = Icons.Rounded.SettingsEthernet,
      )
      VertuChip(
        label = stringResource(R.string.operator_runtime_ready_state, operatorReadyLabel(runtimeSummary.runtimeReady)),
        active = runtimeSummary.runtimeReady,
        leadingIcon = Icons.Rounded.AutoMode,
      )
      if (pullMessage.isNotBlank()) {
        VertuChip(
          label = pullMessage,
          active = isPulling,
          leadingIcon = Icons.Rounded.CloudDownload,
        )
      }
    }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      VertuPrimaryButton(
        label = readiness.actionLabel,
        onClick = onPrimaryReadinessAction,
        modifier = Modifier.weight(1f),
        leadingIcon = Icons.Rounded.CloudDownload,
      )
      VertuSecondaryButton(
        label = stringResource(R.string.runtime_admin_pull_model),
        onClick = onPullModel,
        modifier = Modifier.weight(1f),
        leadingIcon = Icons.Rounded.ArrowOutward,
      )
    }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      VertuSecondaryButton(
        label = stringResource(R.string.operator_action_runtime_admin),
        onClick = onOpenRuntimeAdmin,
        modifier = Modifier.weight(1f),
        leadingIcon = Icons.Rounded.SettingsEthernet,
      )
      VertuSecondaryButton(
        label = stringResource(R.string.operator_action_return_to_chat),
        onClick = onFocusComposer,
        modifier = Modifier.weight(1f),
        leadingIcon = Icons.Rounded.ChatBubbleOutline,
      )
    }
  }
}

@Composable
private fun OperatorActionBar(
  onRuntimeAdminClicked: () -> Unit,
  onModelsClicked: () -> Unit,
  onVerifyDeviceModelClicked: () -> Unit,
  onOpenLocalChat: () -> Unit,
  onOpenLocalAutomation: () -> Unit,
) {
  VertuPanel(
    title = stringResource(R.string.operator_actions_title),
    subtitle = stringResource(R.string.operator_actions_subtitle),
  ) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      VertuSecondaryButton(label = stringResource(R.string.operator_action_runtime_admin), onClick = onRuntimeAdminClicked, leadingIcon = Icons.Rounded.SettingsEthernet)
      VertuSecondaryButton(label = stringResource(R.string.operator_action_models), onClick = onModelsClicked, leadingIcon = Icons.Rounded.Memory)
      VertuSecondaryButton(label = stringResource(R.string.operator_action_verify_device_model), onClick = onVerifyDeviceModelClicked, leadingIcon = Icons.Rounded.CloudDownload)
      VertuSecondaryButton(label = stringResource(R.string.operator_action_local_chat), onClick = onOpenLocalChat, leadingIcon = Icons.Rounded.ChatBubbleOutline)
      VertuSecondaryButton(label = stringResource(R.string.operator_action_local_automation), onClick = onOpenLocalAutomation, leadingIcon = Icons.Rounded.PhoneAndroid)
    }
  }
}

@Composable
private fun OperatorComposerCard(
  message: String,
  requestTts: Boolean,
  runOnPhone: Boolean,
  isSending: Boolean,
  localChatTask: Task?,
  holdToDictateViewModel: HoldToDictateViewModel,
  onMessageChanged: (String) -> Unit,
  onRequestTtsChanged: (Boolean) -> Unit,
  onRunOnPhoneChanged: (Boolean) -> Unit,
  onAmplitudeChanged: (Int) -> Unit,
  onSend: () -> Unit,
) {
  VertuPanel(
    title = stringResource(R.string.operator_conversation_title),
    subtitle = stringResource(R.string.operator_conversation_description),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.Top,
    ) {
      VertuInput(
        value = message,
        onValueChange = onMessageChanged,
        modifier = Modifier.weight(1f),
        minLines = 5,
        label = stringResource(R.string.operator_message_label),
        placeholder = stringResource(R.string.operator_message_placeholder),
      )
      if (localChatTask != null) {
        HoldToDictate(
          task = localChatTask,
          viewModel = holdToDictateViewModel,
          onDone = { text -> onMessageChanged(if (message.isBlank()) text else "$message\n$text") },
          onAmplitudeChanged = onAmplitudeChanged,
          enabled = !isSending,
          modifier = Modifier.size(56.dp),
        )
      }
    }
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(stringResource(R.string.operator_request_tts), style = MaterialTheme.typography.bodyMedium)
          Switch(checked = requestTts, onCheckedChange = onRequestTtsChanged)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(stringResource(R.string.operator_run_on_phone), style = MaterialTheme.typography.bodyMedium)
          Switch(checked = runOnPhone, onCheckedChange = onRunOnPhoneChanged)
        }
      }
      VertuPrimaryButton(
        label = stringResource(R.string.operator_send),
        onClick = onSend,
        enabled = !isSending && message.isNotBlank(),
        leadingIcon = Icons.Rounded.ArrowOutward,
      )
    }
    if (isSending) {
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.primary)
        Text(stringResource(R.string.operator_state_loading), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

@Composable
private fun OperatorApprovalCard(
  approval: OperatorApprovalRequest,
  isSubmitting: Boolean,
  onApprove: () -> Unit,
  onDismiss: () -> Unit,
) {
  VertuPanel(
    title = stringResource(R.string.operator_approval_title),
    subtitle = stringResource(R.string.operator_approval_summary, approval.riskLevel.ifBlank { stringResource(R.string.operator_not_set) }, approval.commandCount),
  ) {
    Text(
      stringResource(R.string.operator_approval_correlation, approval.correlationId),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      VertuPrimaryButton(
        label = stringResource(R.string.operator_approval_approve),
        onClick = onApprove,
        enabled = !isSubmitting,
        modifier = Modifier.weight(1f),
      )
      VertuSecondaryButton(
        label = stringResource(R.string.operator_approval_dismiss),
        onClick = onDismiss,
        enabled = !isSubmitting,
        modifier = Modifier.weight(1f),
      )
    }
  }
}

@Composable
private fun OperatorTimelineCard(entries: List<OperatorTimelineEntry>) {
  VertuPanel(
    title = stringResource(R.string.operator_timeline_title),
    subtitle = if (entries.isEmpty()) stringResource(R.string.operator_timeline_empty) else null,
  ) {
    if (entries.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        entries.takeLast(12).forEach { entry ->
          OperatorTimelineBubble(entry = entry)
        }
      }
    }
  }
}

@Composable
private fun OperatorTimelineBubble(entry: OperatorTimelineEntry) {
  val (accentColor, contentColor, alignment) =
    when (entry.role) {
      OperatorTimelineRole.USER -> Triple(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.onPrimary, Alignment.CenterEnd)
      OperatorTimelineRole.ASSISTANT -> Triple(MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer, Alignment.CenterStart)
      OperatorTimelineRole.RUN -> Triple(MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer, Alignment.CenterStart)
      OperatorTimelineRole.SYSTEM -> Triple(MaterialTheme.colorScheme.surfaceContainerHigh, MaterialTheme.colorScheme.onSurface, Alignment.CenterStart)
    }
  VertuTimelineBubble(
    title = entry.title,
    body = entry.body,
    state = entry.state,
    accentColor = accentColor,
    contentColor = contentColor,
    alignment = alignment,
  )
}

@Composable
private fun OperatorExecutionStatusCard(
  cloudChatState: FlowExecutionState,
  cloudChatMessage: String,
  cloudPullState: FlowExecutionState,
  cloudPullMessage: String,
  cloudPullJobId: String?,
  deviceAiState: FlowExecutionState,
  deviceAiMessage: String,
  deviceAiCorrelationId: String,
  phoneAutomationState: FlowExecutionState,
  phoneAutomationMessage: String,
) {
  VertuPanel(
    title = stringResource(R.string.operator_status_title),
    subtitle = stringResource(R.string.operator_status_subtitle),
  ) {
    VertuStatusCard(title = stringResource(R.string.operator_status_chat), state = cloudChatState, detail = cloudChatMessage)
    VertuStatusCard(
      title = stringResource(R.string.operator_status_pull),
      state = cloudPullState,
      detail = listOfNotNull(cloudPullMessage.takeIf { it.isNotBlank() }, cloudPullJobId).joinToString(" · "),
    )
    VertuStatusCard(
      title = stringResource(R.string.operator_status_device_ai),
      state = deviceAiState,
      detail = listOfNotNull(deviceAiMessage.takeIf { it.isNotBlank() }, deviceAiCorrelationId.takeIf { it.isNotBlank() }).joinToString(" · "),
    )
    VertuStatusCard(
      title = stringResource(R.string.operator_status_phone),
      state = phoneAutomationState,
      detail = phoneAutomationMessage,
    )
  }
}

private fun applyOperatorAutomationResult(
  modelManagerViewModel: ModelManagerViewModel,
  result: OperatorAutomationResult,
  assistantTitle: String,
  planTitle: String,
  phoneTitle: String,
  onPhoneStatusChanged: (FlowExecutionState, String) -> Unit,
  onPendingApprovalChanged: (OperatorApprovalRequest?) -> Unit,
) {
  if (result.assistantMessage.isNotBlank()) {
    modelManagerViewModel.addOperatorTimelineEntry(
      role = OperatorTimelineRole.ASSISTANT,
      title = assistantTitle,
      body = result.assistantMessage,
      state =
        if (result.state == FlowExecutionState.SUCCESS || result.state == FlowExecutionState.EMPTY) {
          FlowExecutionState.SUCCESS
        } else {
          result.state
        },
    )
  }
  if (result.actionDetails.isNotEmpty()) {
    modelManagerViewModel.addOperatorTimelineEntry(
      role = OperatorTimelineRole.SYSTEM,
      title = planTitle,
      body = result.actionDetails.joinToString(separator = "\n"),
      state = FlowExecutionState.SUCCESS,
    )
  }
  result.executions.forEach { execution ->
    modelManagerViewModel.addOperatorTimelineEntry(
      role = OperatorTimelineRole.RUN,
      title = phoneTitle,
      body = execution.message,
      state = execution.state,
    )
  }
  val pendingApproval = result.executions.firstNotNullOfOrNull { it.approvalRequest }
  onPendingApprovalChanged(pendingApproval)
  val statusMessage =
    result.executions.lastOrNull()?.message.takeIf { !it.isNullOrBlank() }
      ?: result.assistantMessage
  onPhoneStatusChanged(result.state, statusMessage)
}

@Composable
private fun readinessLabel(state: com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState): String {
  return when (state) {
    com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.NOT_INSTALLED -> stringResource(R.string.operator_readiness_not_installed)
    com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.DOWNLOADING -> stringResource(R.string.operator_readiness_downloading)
    com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.VERIFYING -> stringResource(R.string.operator_readiness_verifying)
    com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.READY -> stringResource(R.string.operator_readiness_ready)
    com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.IN_USE -> stringResource(R.string.operator_readiness_in_use)
    com.google.ai.edge.gallery.ui.modelmanager.RequiredModelReadinessState.FAILED -> stringResource(R.string.operator_readiness_failed)
  }
}

@Composable
private fun operatorReadyLabel(isReady: Boolean): String {
  return if (isReady) {
    stringResource(R.string.operator_ready_yes)
  } else {
    stringResource(R.string.operator_ready_no)
  }
}
