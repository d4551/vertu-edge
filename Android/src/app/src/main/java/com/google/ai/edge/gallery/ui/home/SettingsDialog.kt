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

import com.google.android.gms.oss.licenses.OssLicensesMenuActivity
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MultiChoiceSegmentedButtonRow
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.google.ai.edge.gallery.BuildConfig
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.common.VertuRuntimeConfig
import com.google.ai.edge.gallery.proto.Theme
import com.google.ai.edge.gallery.ui.common.ClickableLink
import com.google.ai.edge.gallery.ui.common.tos.AppTosDialog
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel
import com.google.ai.edge.gallery.ui.theme.ThemeSettings
import com.google.ai.edge.gallery.ui.theme.labelSmallNarrow
import com.vertu.edge.core.flow.FlowExecutionState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.min

private val THEME_OPTIONS = listOf(Theme.THEME_AUTO, Theme.THEME_LIGHT, Theme.THEME_DARK)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsDialog(
  curThemeOverride: Theme,
  modelManagerViewModel: ModelManagerViewModel,
  onDismissed: () -> Unit,
) {
  var selectedTheme by remember { mutableStateOf(curThemeOverride) }
  var hfToken by remember { mutableStateOf(modelManagerViewModel.getTokenStatusAndData().data) }
  val dateFormatter = remember {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
      .withZone(ZoneId.systemDefault())
  }
  var customHfToken by remember { mutableStateOf("") }
  val focusRequester = remember { FocusRequester() }
  val interactionSource = remember { MutableInteractionSource() }
  var showTos by remember { mutableStateOf(false) }
  val cloudUiState by modelManagerViewModel.uiState.collectAsState()
  val resolvedCloudPullModelRef = cloudUiState.cloudPullModelRef.ifBlank { cloudUiState.selectedCloudModel }.trim()

  Dialog(onDismissRequest = onDismissed) {
    val focusManager = LocalFocusManager.current
    Card(
      modifier =
        Modifier.fillMaxWidth().clickable(
          interactionSource = interactionSource,
          indication = null, // Disable the ripple effect
        ) {
          focusManager.clearFocus()
        },
      shape = RoundedCornerShape(16.dp),
    ) {
      Column(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
      ) {
        // Dialog title and subtitle.
        Column {
          Text(
            stringResource(R.string.settings),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 8.dp),
          )
          // Subtitle.
          Text(
            stringResource(R.string.app_version, BuildConfig.VERSION_NAME),
            style = labelSmallNarrow,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.offset(y = (-6).dp),
          )
        }

        Column(
          modifier = Modifier.verticalScroll(rememberScrollState()).weight(1f, fill = false),
          verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
          val context = LocalContext.current
          // Theme switcher.
          Column(modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
            Text(
              stringResource(R.string.theme),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            MultiChoiceSegmentedButtonRow {
              THEME_OPTIONS.forEachIndexed { index, theme ->
                SegmentedButton(
                  shape =
                    SegmentedButtonDefaults.itemShape(index = index, count = THEME_OPTIONS.size),
                  onCheckedChange = {
                    selectedTheme = theme

                    // Update theme settings.
                    // This will update app's theme.
                    ThemeSettings.themeOverride.value = theme

                    // Save to data store.
                    modelManagerViewModel.saveThemeOverride(theme)

                    // Update ui mode.
                    //
                    // This is necessary to make other Activities launched from MainActivity to have
                    // the correct theme.
                    val uiModeManager =
                      context.applicationContext.getSystemService(Context.UI_MODE_SERVICE)
                        as UiModeManager
                    if (theme == Theme.THEME_AUTO) {
                      uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO)
                    } else if (theme == Theme.THEME_LIGHT) {
                      uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_NO)
                    } else {
                      uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_YES)
                    }
                  },
                  checked = theme == selectedTheme,
                  label = { Text(themeLabel(theme)) },
                )
              }
            }
          }

          // HF Token management.
          Column(
            modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(4.dp),
          ) {
            Text(
              stringResource(R.string.huggingface_access_token),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            // Show the start of the token.
            val curHfToken = hfToken
            if (curHfToken != null && curHfToken.accessToken.isNotEmpty()) {
              Text(
                curHfToken.accessToken.substring(0, min(16, curHfToken.accessToken.length)) + "...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
              Text(
                stringResource(R.string.expires_at, dateFormatter.format(Instant.ofEpochMilli(curHfToken.expiresAtMs))),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            } else {
              Text(
                stringResource(R.string.not_available),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
              Text(
                stringResource(R.string.token_auto_retrieve_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
              OutlinedButton(
                onClick = {
                  modelManagerViewModel.clearAccessToken()
                  hfToken = null
                },
                enabled = curHfToken != null,
              ) {
                Text(stringResource(R.string.clear))
              }
              val handleSaveToken = {
                modelManagerViewModel.saveAccessToken(
                  accessToken = customHfToken,
                  refreshToken = "",
                  expiresAt = System.currentTimeMillis() + 1000L * 60 * 60 * 24 * 365 * 10,
                )
                hfToken = modelManagerViewModel.getTokenStatusAndData().data
                focusManager.clearFocus()
              }
              OutlinedTextField(
                value = customHfToken,
                onValueChange = { customHfToken = it },
                label = { Text(stringResource(R.string.enter_token_manually)) },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { handleSaveToken() }),
                trailingIcon = {
                  if (customHfToken.isNotEmpty()) {
                    IconButton(onClick = handleSaveToken) {
                      Icon(
                        Icons.Rounded.CheckCircle,
                        contentDescription = stringResource(R.string.cd_done_icon),
                      )
                    }
                  }
                },
                modifier =
                  Modifier.fillMaxWidth()
                    .focusRequester(focusRequester),
              )
            }
          }

          // Cloud control plane controls (providers, models, pulls, chat).
          Column(
            modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text(
              stringResource(R.string.cloud_ai_controls),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )

            OutlinedTextField(
              value = cloudUiState.controlPlaneBaseUrl,
              onValueChange = { modelManagerViewModel.setControlPlaneBaseUrl(it) },
              label = { Text(stringResource(R.string.control_plane_base_url)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
              Button(
                onClick = { modelManagerViewModel.loadCloudProviders() },
                enabled = !cloudUiState.isLoadingProviderRegistry,
              ) {
                Text(stringResource(R.string.load_configured_providers))
              }
              if (cloudUiState.isLoadingProviderRegistry) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp))
              }
            }
            Text(
              cloudUiState.providerRegistryMessage,
              style = MaterialTheme.typography.bodySmall,
              color = stateColor(cloudUiState.providerRegistryState),
            )
            if (cloudUiState.providerRegistryState == FlowExecutionState.ERROR_RETRYABLE) {
              OutlinedButton(
                onClick = { modelManagerViewModel.loadCloudProviders() },
                enabled = !cloudUiState.isLoadingProviderRegistry,
              ) {
                Text(stringResource(R.string.retry))
              }
            }

            if (cloudUiState.providerOptions.isNotEmpty()) {
              Text(
                stringResource(R.string.cloud_provider),
                style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
              )
              Column {
                cloudUiState.providerOptions.forEach { provider ->
                  Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                  ) {
                    val isSelectedProvider = provider == cloudUiState.selectedProvider
                    RadioButton(
                      selected = isSelectedProvider,
                      onClick = {
                        modelManagerViewModel.setSelectedProvider(provider)
                      },
                    )
                    Text(provider)
                  }
                }
              }
            }
            OutlinedTextField(
              value = cloudUiState.providerApiKey,
              onValueChange = { modelManagerViewModel.setProviderApiKey(it) },
              label = { Text(stringResource(R.string.cloud_provider_api_key)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
              value = cloudUiState.providerBaseUrl,
              onValueChange = { modelManagerViewModel.setProviderBaseUrl(it) },
              label = { Text(stringResource(R.string.cloud_provider_base_url_optional)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )

            HorizontalDivider()

            Text(
              stringResource(R.string.cloud_models),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            OutlinedTextField(
              value = cloudUiState.cloudModelSource,
              onValueChange = { modelManagerViewModel.setCloudModelSource(it) },
              label = { Text(stringResource(R.string.cloud_model_source)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            if (cloudUiState.modelSourceOptions.isNotEmpty()) {
              Text(
                stringResource(R.string.cloud_source_options),
                style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
              )
              Column(
                modifier = Modifier.fillMaxWidth().wrapContentHeight(),
              ) {
                cloudUiState.modelSourceOptions.forEach { source ->
                  val sourceLabel =
                    if (source.displayName.equals(source.id, ignoreCase = true)) {
                      source.displayName
                    } else {
                      "${source.displayName} (${source.id})"
                    }
                  TextButton(onClick = { modelManagerViewModel.setCloudModelSource(source.id) }) {
                    Text(sourceLabel, style = MaterialTheme.typography.bodySmall)
                  }
                }
              }
            }
            OutlinedTextField(
              value = cloudUiState.selectedCloudModel,
              onValueChange = { modelManagerViewModel.setSelectedCloudModel(it) },
              label = { Text(stringResource(R.string.cloud_model)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            if (cloudUiState.cloudModelOptions.isNotEmpty()) {
              Text(
                stringResource(R.string.cloud_model_options),
                style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
              )
              Column(
                modifier =
                  Modifier
                    .fillMaxWidth()
                    .wrapContentHeight(),
              ) {
                cloudUiState.cloudModelOptions.forEach { model ->
                  TextButton(onClick = { modelManagerViewModel.setSelectedCloudModel(model) }) {
                    Text(model, style = MaterialTheme.typography.bodySmall)
                  }
                }
              }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
              Button(
                onClick = { modelManagerViewModel.loadCloudModelsForSelectedProvider() },
                enabled =
                  !cloudUiState.isLoadingCloudModels &&
                    cloudUiState.selectedProvider.isNotBlank(),
              ) {
                Text(stringResource(R.string.refresh_model_list))
              }
              if (cloudUiState.isLoadingCloudModels) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp))
              }
            }
            Text(
              cloudUiState.cloudModelListMessage,
              style = MaterialTheme.typography.bodySmall,
              color = stateColor(cloudUiState.cloudModelListState),
            )
            if (cloudUiState.cloudModelListState == FlowExecutionState.ERROR_RETRYABLE) {
              OutlinedButton(
                onClick = { modelManagerViewModel.loadCloudModelsForSelectedProvider() },
                enabled =
                  !cloudUiState.isLoadingCloudModels &&
                    cloudUiState.selectedProvider.isNotBlank(),
              ) {
                Text(stringResource(R.string.retry))
              }
            }

            OutlinedTextField(
              value = cloudUiState.cloudPullSource,
              onValueChange = { modelManagerViewModel.setCloudPullSource(it) },
              label = { Text(stringResource(R.string.cloud_pull_source)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            if (cloudUiState.modelSourceOptions.isNotEmpty()) {
              Column(
                modifier = Modifier.fillMaxWidth().wrapContentHeight(),
              ) {
                cloudUiState.modelSourceOptions.forEach { source ->
                  val sourceLabel =
                    if (source.displayName.equals(source.id, ignoreCase = true)) {
                      source.displayName
                    } else {
                      "${source.displayName} (${source.id})"
                    }
                  TextButton(onClick = { modelManagerViewModel.setCloudPullSource(source.id) }) {
                    Text(sourceLabel, style = MaterialTheme.typography.bodySmall)
                  }
                }
              }
            }
            OutlinedTextField(
              value = cloudUiState.cloudPullModelRef,
              onValueChange = { modelManagerViewModel.setCloudPullModelRef(it) },
              label = { Text(stringResource(R.string.cloud_pull_model_reference)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
              value = cloudUiState.cloudPullTimeoutMsText,
              onValueChange = { modelManagerViewModel.setCloudPullTimeoutMs(it) },
              label = { Text(stringResource(R.string.cloud_pull_timeout_ms)) },
              placeholder = {
                Text(VertuRuntimeConfig.controlPlaneDefaultPullTimeoutMs.toString())
              },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              Checkbox(
                checked = cloudUiState.cloudPullForce,
                onCheckedChange = { modelManagerViewModel.setCloudPullForce(it) },
              )
              Text(stringResource(R.string.cloud_pull_force))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
              Button(
                onClick = { modelManagerViewModel.pullCloudModel() },
                enabled =
                  !cloudUiState.isSubmittingCloudPull &&
                    !cloudUiState.isPollingCloudPull &&
                    cloudUiState.selectedProvider.isNotBlank() &&
                    resolvedCloudPullModelRef.isNotBlank(),
              ) {
                Text(stringResource(R.string.start_model_pull))
              }
              if (cloudUiState.isSubmittingCloudPull || cloudUiState.isPollingCloudPull) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp))
              }
            }
            Text(
              cloudUiState.cloudPullMessage,
              style = MaterialTheme.typography.bodySmall,
              color = stateColor(cloudUiState.cloudPullState),
            )
            if (cloudUiState.cloudPullState == FlowExecutionState.ERROR_RETRYABLE) {
              OutlinedButton(
                onClick = { modelManagerViewModel.pullCloudModel() },
                enabled =
                  !cloudUiState.isSubmittingCloudPull &&
                    !cloudUiState.isPollingCloudPull &&
                    cloudUiState.selectedProvider.isNotBlank() &&
                    resolvedCloudPullModelRef.isNotBlank(),
              ) {
                Text(stringResource(R.string.retry))
              }
            }
            cloudUiState.cloudPullJobId?.let { jobId ->
              Text(
                stringResource(R.string.cloud_pull_job_id, jobId),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }

            HorizontalDivider()

            Text(
              stringResource(R.string.cloud_chat),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            OutlinedTextField(
              value = cloudUiState.cloudChatMessage,
              onValueChange = { modelManagerViewModel.setCloudChatMessage(it) },
              label = { Text(stringResource(R.string.cloud_chat_message)) },
              minLines = 2,
              maxLines = 5,
              modifier = Modifier.fillMaxWidth(),
              keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
              keyboardActions =
                KeyboardActions(
                  onDone = {
                    modelManagerViewModel.sendCloudChat()
                    focusManager.clearFocus()
                  },
                ),
            )
            OutlinedTextField(
              value = cloudUiState.cloudChatSpeechInputMimeType,
              onValueChange = { modelManagerViewModel.setCloudChatSpeechInputMimeType(it) },
              label = { Text(stringResource(R.string.cloud_chat_speech_input_mime_type)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
              value = cloudUiState.cloudChatSpeechInputData,
              onValueChange = { modelManagerViewModel.setCloudChatSpeechInputData(it) },
              label = { Text(stringResource(R.string.cloud_chat_speech_input_data)) },
              minLines = 2,
              maxLines = 6,
              modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
              Checkbox(
                checked = cloudUiState.cloudChatRequestTts,
                onCheckedChange = modelManagerViewModel::setCloudChatRequestTts,
              )
              Text(
                stringResource(R.string.cloud_chat_request_tts),
                style = MaterialTheme.typography.bodyMedium,
              )
            }
            OutlinedTextField(
              value = cloudUiState.cloudChatTtsOutputMimeType,
              onValueChange = { modelManagerViewModel.setCloudChatTtsOutputMimeType(it) },
              label = { Text(stringResource(R.string.cloud_chat_tts_output_mime_type)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
              value = cloudUiState.cloudChatTtsVoice,
              onValueChange = { modelManagerViewModel.setCloudChatTtsVoice(it) },
              label = { Text(stringResource(R.string.cloud_chat_tts_voice)) },
              singleLine = true,
              modifier = Modifier.fillMaxWidth(),
            )

            val canSubmitCloudChat = !cloudUiState.isSendingCloudChat &&
              cloudUiState.selectedProvider.isNotBlank() &&
              cloudUiState.selectedCloudModel.isNotBlank() &&
              (
                cloudUiState.cloudChatMessage.isNotBlank() ||
                  (cloudUiState.cloudChatSpeechInputMimeType.isNotBlank()
                    && cloudUiState.cloudChatSpeechInputData.isNotBlank())
              )

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
              Button(
                onClick = {
                  modelManagerViewModel.sendCloudChat()
                  focusManager.clearFocus()
                },
                enabled = canSubmitCloudChat,
              ) {
                Text(stringResource(R.string.send))
              }
              if (cloudUiState.isSendingCloudChat) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp))
              }
              OutlinedButton(
                onClick = { modelManagerViewModel.clearCloudChatReply() },
                enabled = cloudUiState.cloudChatReply.isNotBlank(),
              ) {
                Text(stringResource(R.string.clear))
              }
            }
            Text(
              cloudUiState.cloudChatStateMessage,
              style = MaterialTheme.typography.bodySmall,
              color = stateColor(cloudUiState.cloudChatState),
            )
            if (cloudUiState.cloudChatState == FlowExecutionState.ERROR_RETRYABLE) {
              OutlinedButton(
                onClick = {
                  modelManagerViewModel.sendCloudChat()
                  focusManager.clearFocus()
                },
                enabled = canSubmitCloudChat,
              ) {
                Text(stringResource(R.string.retry))
              }
            }
            if (cloudUiState.cloudChatReply.isNotBlank()) {
              Text(
                stringResource(R.string.cloud_chat_reply),
                style = MaterialTheme.typography.titleSmall,
              )
              Text(
                cloudUiState.cloudChatReply,
                style = MaterialTheme.typography.bodySmall,
              )
            }
            if (cloudUiState.cloudChatSpeechTranscript.isNotBlank()) {
              Text(
                stringResource(R.string.cloud_chat_speech_transcript),
                style = MaterialTheme.typography.titleSmall,
              )
              Text(
                cloudUiState.cloudChatSpeechTranscript,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
            if (cloudUiState.cloudChatTtsBase64Audio.isNotBlank()) {
              Text(
                stringResource(R.string.cloud_chat_tts_payload),
                style = MaterialTheme.typography.titleSmall,
              )
              Text(
                stringResource(
                  R.string.cloud_chat_tts_mime_label,
                  cloudUiState.cloudChatTtsMimeType.ifBlank { "audio/mpeg" },
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
              Text(
                cloudUiState.cloudChatTtsBase64Audio,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
              )
            }
          }

          // Third party licenses.
          Column(modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
            Text(
              stringResource(R.string.third_party_libraries),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            OutlinedButton(
              onClick = {
                // Create an Intent to launch a license viewer that displays a list of
                // third-party library names. Clicking a name will show its license content.
                val intent = Intent(context, OssLicensesMenuActivity::class.java)
                context.startActivity(intent)
              }
            ) {
              Text(stringResource(R.string.view_licenses))
            }
          }

          // Tos
          Column(modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
            Text(
              stringResource(R.string.settings_dialog_tos_title),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            OutlinedButton(onClick = { showTos = true }) {
              Text(stringResource(R.string.settings_dialog_view_app_terms_of_service))
            }
            ClickableLink(
              url = "https://ai.google.dev/gemma/terms",
              linkText = stringResource(R.string.tos_dialog_title_gemma),
              modifier = Modifier.padding(top = 4.dp),
            )
            ClickableLink(
              url = "https://ai.google.dev/gemma/prohibited_use_policy",
              linkText = stringResource(R.string.settings_dialog_gemma_prohibited_use_policy),
              modifier = Modifier.padding(top = 8.dp),
            )
          }
        }

        // Button row.
        Row(
          modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
          horizontalArrangement = Arrangement.End,
        ) {
          // Close button
          Button(onClick = { onDismissed() }) { Text(stringResource(R.string.close)) }
        }
      }
    }
  }

  if (showTos) {
    AppTosDialog(onTosAccepted = { showTos = false }, viewingMode = true)
  }
}

@Composable
private fun themeLabel(theme: Theme): String {
  return when (theme) {
    Theme.THEME_AUTO -> stringResource(R.string.theme_auto)
    Theme.THEME_LIGHT -> stringResource(R.string.theme_light)
    Theme.THEME_DARK -> stringResource(R.string.theme_dark)
    else -> stringResource(R.string.theme_unknown)
  }
}

@Composable
private fun stateColor(state: FlowExecutionState): androidx.compose.ui.graphics.Color {
  return when (state) {
    FlowExecutionState.IDLE -> MaterialTheme.colorScheme.onSurfaceVariant
    FlowExecutionState.EMPTY -> MaterialTheme.colorScheme.secondary
    FlowExecutionState.LOADING -> MaterialTheme.colorScheme.primary
    FlowExecutionState.SUCCESS -> MaterialTheme.colorScheme.primary
    FlowExecutionState.ERROR_RETRYABLE -> MaterialTheme.colorScheme.error
    FlowExecutionState.ERROR_NON_RETRYABLE -> MaterialTheme.colorScheme.error
    FlowExecutionState.UNAUTHORIZED -> MaterialTheme.colorScheme.error
  }
}
