package com.google.ai.edge.gallery.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowOutward
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.SettingsEthernet
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.ai.edge.gallery.GalleryTopAppBar
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.data.AppBarAction
import com.google.ai.edge.gallery.data.AppBarActionType
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerUiState
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel

/** Dedicated runtime administration screen for cloud, local, and required-model operations. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuntimeAdminScreen(
  modelManagerViewModel: ModelManagerViewModel,
  onNavigateUp: () -> Unit,
  onModelsClicked: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val uiState by modelManagerViewModel.uiState.collectAsState()

  LaunchedEffect(Unit) {
    modelManagerViewModel.ensureCloudProvidersLoaded()
  }

  VertuScaffold(
    modifier = modifier,
    topBar = {
      GalleryTopAppBar(
        title = stringResource(R.string.runtime_admin_title),
        subtitle = stringResource(R.string.runtime_admin_subtitle),
        leftAction = AppBarAction(AppBarActionType.NAVIGATE_UP, onNavigateUp),
        rightAction = AppBarAction(AppBarActionType.APP_SETTING, onModelsClicked),
      )
    },
  ) { innerPadding ->
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(top = innerPadding.calculateTopPadding())
        .verticalScroll(rememberScrollState())
        .padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      RuntimeIdentityCard(
        selectedProvider = uiState.selectedProvider,
        selectedModel = uiState.selectedCloudModel,
        pullSource = uiState.cloudPullSource,
      )
      RuntimeProviderCard(state = uiState, modelManagerViewModel = modelManagerViewModel)
      RuntimeModelPullCard(state = uiState, modelManagerViewModel = modelManagerViewModel)
      DeviceReadinessCard(state = uiState, modelManagerViewModel = modelManagerViewModel)
    }
  }
}

@Composable
private fun RuntimeIdentityCard(selectedProvider: String, selectedModel: String, pullSource: String) {
  VertuPanel(
    title = stringResource(R.string.runtime_admin_identity_title),
    subtitle = stringResource(R.string.runtime_admin_subtitle),
  ) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      VertuChip(
        label = stringResource(R.string.runtime_admin_provider_value, selectedProvider.ifBlank { stringResource(R.string.operator_not_set) }),
        active = selectedProvider.isNotBlank(),
        leadingIcon = Icons.Rounded.Public,
      )
      VertuChip(
        label = stringResource(R.string.runtime_admin_model_value, selectedModel.ifBlank { stringResource(R.string.operator_not_set) }),
        active = selectedModel.isNotBlank(),
        leadingIcon = Icons.Rounded.Memory,
      )
      VertuChip(
        label = stringResource(R.string.runtime_admin_pull_source_value, pullSource.ifBlank { stringResource(R.string.operator_not_set) }),
        active = pullSource.isNotBlank(),
        leadingIcon = Icons.Rounded.ArrowOutward,
      )
    }
  }
}

@Composable
private fun RuntimeProviderCard(state: ModelManagerUiState, modelManagerViewModel: ModelManagerViewModel) {
  VertuPanel(
    title = stringResource(R.string.runtime_admin_cloud_title),
    subtitle = stringResource(R.string.operator_runtime_strip_subtitle),
  ) {
    VertuInput(
      value = state.controlPlaneBaseUrl,
      onValueChange = modelManagerViewModel::setControlPlaneBaseUrl,
      modifier = Modifier.fillMaxWidth(),
      label = stringResource(R.string.control_plane_base_url),
      singleLine = true,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
      VertuSecondaryButton(
        label = stringResource(R.string.load_configured_providers),
        onClick = modelManagerViewModel::loadCloudProviders,
        enabled = !state.isLoadingProviderRegistry,
        leadingIcon = Icons.Rounded.Public,
      )
      VertuSecondaryButton(
        label = stringResource(R.string.runtime_admin_load_models),
        onClick = modelManagerViewModel::loadCloudModelsForSelectedProvider,
        enabled = !state.isLoadingCloudModels && state.selectedProvider.isNotBlank(),
        leadingIcon = Icons.Rounded.Memory,
      )
      if (state.isLoadingProviderRegistry || state.isLoadingCloudModels) {
        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.padding(start = 4.dp))
      }
    }
    if (state.providerRegistryMessage.isNotBlank() || state.cloudModelListMessage.isNotBlank()) {
      Text(
        listOf(state.providerRegistryMessage, state.cloudModelListMessage).filter(String::isNotBlank).joinToString(" · "),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    if (state.providerOptions.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.operator_provider_picker_title), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        state.providerOptions.forEach { provider ->
          Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            RadioButton(selected = state.selectedProvider == provider, onClick = { modelManagerViewModel.setSelectedProvider(provider) })
            Text(provider, style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }
    VertuInput(
      value = state.providerApiKey,
      onValueChange = modelManagerViewModel::setProviderApiKey,
      modifier = Modifier.fillMaxWidth(),
      label = stringResource(R.string.ai_provider_api_key),
      singleLine = true,
    )
    VertuInput(
      value = state.providerBaseUrl,
      onValueChange = modelManagerViewModel::setProviderBaseUrl,
      modifier = Modifier.fillMaxWidth(),
      label = stringResource(R.string.ai_provider_base_url),
      singleLine = true,
    )
    if (state.cloudModelOptions.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.operator_model_picker_title), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        state.cloudModelOptions.take(16).forEach { model ->
          Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            RadioButton(selected = state.selectedCloudModel == model, onClick = { modelManagerViewModel.setSelectedCloudModel(model) })
            Text(model, style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }
  }
}

@Composable
private fun RuntimeModelPullCard(state: ModelManagerUiState, modelManagerViewModel: ModelManagerViewModel) {
  VertuPanel(
    title = stringResource(R.string.runtime_admin_pull_title),
    subtitle = stringResource(R.string.operator_required_model_missing_detail),
  ) {
    VertuInput(
      value = state.cloudPullModelRef,
      onValueChange = modelManagerViewModel::setCloudPullModelRef,
      modifier = Modifier.fillMaxWidth(),
      label = stringResource(R.string.cloud_pull_model_reference),
      singleLine = true,
    )
    VertuInput(
      value = state.cloudPullSource,
      onValueChange = modelManagerViewModel::setCloudPullSource,
      modifier = Modifier.fillMaxWidth(),
      label = stringResource(R.string.cloud_pull_source),
      singleLine = true,
    )
    VertuInput(
      value = state.cloudPullTimeoutMsText,
      onValueChange = modelManagerViewModel::setCloudPullTimeoutMs,
      modifier = Modifier.fillMaxWidth(),
      label = stringResource(R.string.cloud_pull_timeout_ms),
      singleLine = true,
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
      Text(stringResource(R.string.cloud_pull_force), style = MaterialTheme.typography.bodyMedium)
      androidx.compose.material3.Switch(checked = state.cloudPullForce, onCheckedChange = modelManagerViewModel::setCloudPullForce)
    }
    VertuPrimaryButton(
      label = stringResource(R.string.runtime_admin_pull_model),
      onClick = modelManagerViewModel::pullCloudModel,
      enabled = !state.isSubmittingCloudPull,
      leadingIcon = Icons.Rounded.ArrowOutward,
    )
    if (state.isSubmittingCloudPull || state.isPollingCloudPull) {
      CircularProgressIndicator(strokeWidth = 2.dp)
    }
    if (state.cloudPullMessage.isNotBlank()) {
      Text(state.cloudPullMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun DeviceReadinessCard(state: ModelManagerUiState, modelManagerViewModel: ModelManagerViewModel) {
  VertuPanel(
    title = stringResource(R.string.runtime_admin_device_title),
    subtitle = stringResource(R.string.runtime_admin_device_description),
  ) {
    VertuPrimaryButton(
      label = stringResource(R.string.operator_action_verify_device_model),
      onClick = modelManagerViewModel::runDeviceAiProtocol,
      enabled = !state.isRunningDeviceAiProtocol,
      leadingIcon = Icons.Rounded.SettingsEthernet,
    )
    if (state.isRunningDeviceAiProtocol) {
      CircularProgressIndicator(strokeWidth = 2.dp)
    }
    if (state.deviceAiStateMessage.isNotBlank()) {
      Text(state.deviceAiStateMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (state.deviceAiCorrelationId.isNotBlank()) {
      Text(state.deviceAiCorrelationId, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
