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

package com.google.ai.edge.gallery.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel

/** In-conversation runtime selector: provider and model selection without leaving the conversation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuntimeSelectorSheet(
  modelManagerViewModel: ModelManagerViewModel,
  onDismiss: () -> Unit,
) {
  val uiState by modelManagerViewModel.uiState.collectAsState()
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

  LaunchedEffect(Unit) {
    modelManagerViewModel.ensureCloudProvidersLoaded()
  }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Text(
        stringResource(R.string.runtime_selector_sheet_title),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
      )
      if (uiState.providerOptions.isEmpty()) {
        if (uiState.isLoadingProviderRegistry) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            CircularProgressIndicator(strokeWidth = 2.dp)
            Text(
              stringResource(R.string.runtime_selector_loading_providers),
              modifier = Modifier.padding(start = 8.dp),
              style = MaterialTheme.typography.bodyMedium,
            )
          }
        } else {
          Text(
            stringResource(R.string.runtime_selector_no_providers),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      } else {
        val providers = uiState.providerOptions
        val localProviders = providers.filter { it.equals("ollama", ignoreCase = true) }
        val cloudProviders = providers.filter { !it.equals("ollama", ignoreCase = true) }
        val hasLocal = localProviders.isNotEmpty()
        val hasCloud = cloudProviders.isNotEmpty()
        if (hasLocal && hasCloud) {
          Text(
            stringResource(R.string.runtime_selector_local_title),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
          )
          localProviders.forEach { provider ->
            Row(
              verticalAlignment = Alignment.CenterVertically,
              modifier = Modifier.fillMaxWidth(),
            ) {
              RadioButton(
                selected = uiState.selectedProvider == provider,
                onClick = { modelManagerViewModel.setSelectedProvider(provider) },
              )
              Text(provider, style = MaterialTheme.typography.bodyMedium)
            }
          }
          Text(
            stringResource(R.string.runtime_selector_cloud_title),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
          )
          cloudProviders.forEach { provider ->
            Row(
              verticalAlignment = Alignment.CenterVertically,
              modifier = Modifier.fillMaxWidth(),
            ) {
              RadioButton(
                selected = uiState.selectedProvider == provider,
                onClick = { modelManagerViewModel.setSelectedProvider(provider) },
              )
              Text(provider, style = MaterialTheme.typography.bodyMedium)
            }
          }
        } else {
          Text(
            stringResource(R.string.runtime_selector_providers_title),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
          )
          providers.forEach { provider ->
            Row(
              verticalAlignment = Alignment.CenterVertically,
              modifier = Modifier.fillMaxWidth(),
            ) {
              RadioButton(
                selected = uiState.selectedProvider == provider,
                onClick = { modelManagerViewModel.setSelectedProvider(provider) },
              )
              Text(provider, style = MaterialTheme.typography.bodyMedium)
            }
          }
        }
        Row(
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Button(
            onClick = modelManagerViewModel::loadCloudModelsForSelectedProvider,
            enabled = !uiState.isLoadingCloudModels && uiState.selectedProvider.isNotBlank(),
          ) {
            Text(stringResource(R.string.runtime_admin_load_models))
          }
          if (uiState.isLoadingCloudModels) {
            CircularProgressIndicator(strokeWidth = 2.dp)
          }
        }
        if (uiState.cloudModelListMessage.isNotBlank()) {
          Text(
            uiState.cloudModelListMessage,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        if (uiState.cloudModelOptions.isNotEmpty()) {
          Text(
            stringResource(R.string.runtime_selector_model_title),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
          )
          uiState.cloudModelOptions.take(16).forEach { model ->
            Row(
              verticalAlignment = Alignment.CenterVertically,
              modifier = Modifier.fillMaxWidth(),
            ) {
              RadioButton(
                selected = uiState.selectedCloudModel == model,
                onClick = { modelManagerViewModel.setSelectedCloudModel(model) },
              )
              Text(model, style = MaterialTheme.typography.bodyMedium)
            }
          }
        }
      }
    }
  }
}
