package com.google.ai.edge.gallery.ui.home

import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MultiChoiceSegmentedButtonRow
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.google.ai.edge.gallery.BuildConfig
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.common.APP_LOCALE_SYSTEM
import com.google.ai.edge.gallery.common.applyAppLocale
import com.google.ai.edge.gallery.proto.Theme
import com.google.ai.edge.gallery.ui.common.tos.AppTosDialog
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel
import com.google.ai.edge.gallery.ui.theme.ThemeSettings
import com.google.android.gms.oss.licenses.OssLicensesMenuActivity
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.min

private val THEME_OPTIONS = listOf(Theme.THEME_AUTO, Theme.THEME_LIGHT, Theme.THEME_DARK)
private val APP_LOCALE_OPTIONS =
  listOf(
    APP_LOCALE_SYSTEM to R.string.settings_language_system,
    "en" to R.string.settings_language_english,
    "es" to R.string.settings_language_spanish,
    "fr" to R.string.settings_language_french,
    "zh-CN" to R.string.settings_language_chinese_simplified,
  )

/** Settings dialog trimmed to theme, token, and legal/about controls. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsDialog(
  curThemeOverride: Theme,
  modelManagerViewModel: ModelManagerViewModel,
  onDismissed: () -> Unit,
) {
  var selectedTheme by remember { mutableStateOf(curThemeOverride) }
  val uiState by modelManagerViewModel.uiState.collectAsState()
  val tokenStatusAndData by modelManagerViewModel.tokenStatusAndData.collectAsState()
  val hfToken = tokenStatusAndData.data
  val dateFormatter = remember {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault())
  }
  var customHfToken by remember { mutableStateOf("") }
  val focusRequester = remember { FocusRequester() }
  var showTos by remember { mutableStateOf(false) }

  Dialog(onDismissRequest = onDismissed) {
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp)) {
      Column(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
      ) {
        Column {
          Text(
            stringResource(R.string.settings),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 4.dp),
          )
          Text(
            stringResource(R.string.app_version, BuildConfig.VERSION_NAME),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }

        Column(
          modifier = Modifier.verticalScroll(rememberScrollState()).weight(1f, fill = false),
          verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
              stringResource(R.string.theme),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            MultiChoiceSegmentedButtonRow {
              THEME_OPTIONS.forEachIndexed { index, theme ->
                SegmentedButton(
                  shape = SegmentedButtonDefaults.itemShape(index = index, count = THEME_OPTIONS.size),
                  onCheckedChange = {
                    selectedTheme = theme
                    ThemeSettings.themeOverride.value = theme
                    modelManagerViewModel.saveThemeOverride(theme)
                    val uiModeManager =
                      context.applicationContext.getSystemService(Context.UI_MODE_SERVICE)
                        as UiModeManager
                    when (theme) {
                      Theme.THEME_AUTO -> uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO)
                      Theme.THEME_LIGHT -> uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_NO)
                      Theme.THEME_DARK -> uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_YES)
                      else -> uiModeManager.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO)
                    }
                  },
                  checked = theme == selectedTheme,
                  label = { Text(themeLabel(theme)) },
                )
              }
            }
          }

          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
              stringResource(R.string.settings_language),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            FlowRow(
              horizontalArrangement = Arrangement.spacedBy(8.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              APP_LOCALE_OPTIONS.forEach { (localeTag, labelResId) ->
                VertuChip(
                  label = stringResource(labelResId),
                  active = uiState.appLocaleTag == localeTag,
                  onClick = {
                    modelManagerViewModel.saveAppLocale(localeTag)
                    applyAppLocale(localeTag)
                  },
                )
              }
            }
            Text(
              stringResource(R.string.settings_language_hint),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }

          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
              stringResource(R.string.huggingface_access_token),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            if (hfToken != null && hfToken.accessToken.isNotEmpty()) {
              Text(
                hfToken.accessToken.substring(0, min(16, hfToken.accessToken.length)) + "...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
              Text(
                stringResource(R.string.expires_at, dateFormatter.format(Instant.ofEpochMilli(hfToken.expiresAtMs))),
                style = MaterialTheme.typography.bodySmall,
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              OutlinedButton(onClick = { modelManagerViewModel.clearAccessToken() }, enabled = hfToken != null) {
                Text(stringResource(R.string.clear))
              }
            }
            val handleSaveToken = {
              modelManagerViewModel.saveAccessToken(
                accessToken = customHfToken,
                refreshToken = "",
                expiresAt = System.currentTimeMillis() + 1000L * 60 * 60 * 24 * 365 * 10,
              )
              customHfToken = ""
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
                    Icon(Icons.Rounded.CheckCircle, contentDescription = stringResource(R.string.cd_done_icon))
                  }
                }
              },
              modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
            )
          }

          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
              stringResource(R.string.operator_settings_admin_note_title),
              style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
            )
            Text(
              stringResource(R.string.operator_settings_admin_note_body),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }

          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { showTos = true }) {
              Text(stringResource(R.string.settings_dialog_view_app_terms_of_service))
            }
            TextButton(
              onClick = {
                val intent = Intent(Intent.ACTION_VIEW)
                intent.data = android.net.Uri.parse("https://ai.google.dev/gemma/prohibited_use_policy")
                context.startActivity(intent)
              },
            ) {
              Text(stringResource(R.string.settings_dialog_gemma_prohibited_use_policy))
            }
            TextButton(onClick = { context.startActivity(Intent(context, OssLicensesMenuActivity::class.java)) }) {
              Text(stringResource(R.string.oss_licenses))
            }
          }
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
    Theme.THEME_AUTO -> stringResource(R.string.system)
    Theme.THEME_LIGHT -> stringResource(R.string.light)
    Theme.THEME_DARK -> stringResource(R.string.dark)
    else -> stringResource(R.string.system)
  }
}
