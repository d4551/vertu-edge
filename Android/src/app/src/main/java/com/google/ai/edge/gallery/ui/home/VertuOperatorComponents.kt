package com.google.ai.edge.gallery.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.ui.theme.VertuShape
import com.google.ai.edge.gallery.ui.theme.customColors
import com.vertu.edge.core.flow.FlowExecutionState

@Composable
@ReadOnlyComposable
private fun vertuGold(): Color = MaterialTheme.customColors.appTitleGradientColors.firstOrNull() ?: MaterialTheme.colorScheme.primary

@Composable
@ReadOnlyComposable
private fun vertuGoldSoft(): Color = vertuGold().copy(alpha = 0.16f)

@Composable
@ReadOnlyComposable
private fun vertuBorder(): BorderStroke = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.8f))

/** Branded scaffold for operator surfaces. */
@Composable
fun VertuScaffold(
  topBar: @Composable () -> Unit,
  modifier: Modifier = Modifier,
  floatingActionButton: @Composable () -> Unit = {},
  content: @Composable (PaddingValues) -> Unit,
) {
  Scaffold(
    modifier = modifier.background(MaterialTheme.colorScheme.background),
    topBar = topBar,
    floatingActionButton = floatingActionButton,
    contentColor = MaterialTheme.colorScheme.onBackground,
    containerColor = MaterialTheme.colorScheme.background,
    contentWindowInsets = ScaffoldDefaults.contentWindowInsets,
    content = content,
  )
}

/** Elevated branded panel used across operator surfaces. */
@Composable
fun VertuPanel(
  title: String,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  content: @Composable ColumnScope.() -> Unit,
) {
  Card(
    modifier = modifier.fillMaxWidth(),
    shape = VertuShape.Panel,
    border = vertuBorder(),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (!subtitle.isNullOrBlank()) {
          Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      content()
    }
  }
}

/** Branded runtime/status chip. */
@Composable
fun VertuChip(
  label: String,
  modifier: Modifier = Modifier,
  active: Boolean = false,
  leadingIcon: ImageVector? = null,
  onClick: (() -> Unit)? = null,
) {
  val containerColor = if (active) vertuGoldSoft() else MaterialTheme.colorScheme.surface
  val contentColor = if (active) vertuGold() else MaterialTheme.colorScheme.onSurfaceVariant
  val chipModifier =
    modifier
      .clip(VertuShape.Chip)
      .background(containerColor)
      .border(BorderStroke(1.dp, if (active) vertuGold().copy(alpha = 0.55f) else MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f)), VertuShape.Chip)
      .padding(horizontal = 12.dp, vertical = 9.dp)
  val rowContent: @Composable () -> Unit = {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      if (leadingIcon != null) {
        Icon(leadingIcon, contentDescription = null, tint = contentColor, modifier = Modifier.size(16.dp))
      }
      Text(label, style = MaterialTheme.typography.labelMedium, color = contentColor, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium)
    }
  }
  if (onClick == null) {
    Box(modifier = chipModifier) { rowContent() }
  } else {
    Box(modifier = chipModifier.clickable(onClick = onClick), contentAlignment = Alignment.Center) {
      rowContent()
    }
  }
}

/** Primary branded action button. */
@Composable
fun VertuPrimaryButton(
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  leadingIcon: ImageVector? = null,
) {
  Button(
    onClick = onClick,
    modifier = modifier,
    enabled = enabled,
    shape = VertuShape.Button,
    colors = ButtonDefaults.buttonColors(
      containerColor = vertuGold(),
      contentColor = MaterialTheme.colorScheme.onPrimary,
      disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
      disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ),
    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
  ) {
    if (leadingIcon != null) {
      Icon(leadingIcon, contentDescription = null, modifier = Modifier.size(18.dp))
      Box(modifier = Modifier.size(8.dp))
    }
    Text(label, fontWeight = FontWeight.SemiBold)
  }
}

/** Secondary branded action button. */
@Composable
fun VertuSecondaryButton(
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  leadingIcon: ImageVector? = null,
) {
  OutlinedButton(
    onClick = onClick,
    modifier = modifier,
    enabled = enabled,
    shape = VertuShape.Button,
    border = BorderStroke(1.dp, vertuGold().copy(alpha = 0.4f)),
    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
  ) {
    if (leadingIcon != null) {
      Icon(leadingIcon, contentDescription = null, modifier = Modifier.size(18.dp), tint = vertuGold())
      Box(modifier = Modifier.size(8.dp))
    }
    Text(label, fontWeight = FontWeight.Medium)
  }
}

/** Branded multiline input for the operator composer and admin forms. */
@Composable
fun VertuInput(
  value: String,
  onValueChange: (String) -> Unit,
  label: String,
  modifier: Modifier = Modifier,
  placeholder: String? = null,
  minLines: Int = 1,
  singleLine: Boolean = false,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    modifier = modifier,
    minLines = minLines,
    singleLine = singleLine,
    shape = VertuShape.Input,
    label = { Text(label) },
    placeholder = placeholder?.let { { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
    colors = TextFieldDefaults.colors(
      focusedContainerColor = MaterialTheme.colorScheme.surface,
      unfocusedContainerColor = MaterialTheme.colorScheme.surface,
      focusedIndicatorColor = vertuGold(),
      unfocusedIndicatorColor = MaterialTheme.colorScheme.outlineVariant,
      focusedLabelColor = vertuGold(),
    ),
  )
}

/** Branded timeline bubble that maps deterministic execution state to one visual contract. */
@Composable
fun VertuTimelineBubble(
  title: String,
  body: String,
  state: FlowExecutionState,
  modifier: Modifier = Modifier,
  accentColor: Color,
  contentColor: Color,
  alignment: Alignment,
) {
  Box(modifier = modifier.fillMaxWidth(), contentAlignment = alignment) {
    Card(
      modifier = Modifier.fillMaxWidth(0.94f),
      shape = VertuShape.Input,
      border = BorderStroke(1.dp, accentColor.copy(alpha = 0.28f)),
      colors = CardDefaults.cardColors(containerColor = accentColor.copy(alpha = 0.14f), contentColor = contentColor),
    ) {
      Column(modifier = Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        Text(body, style = MaterialTheme.typography.bodyMedium)
        Text(operatorStateLabel(state), style = MaterialTheme.typography.labelSmall, color = contentColor.copy(alpha = 0.72f))
      }
    }
  }
}

/** Branded summary row for execution and readiness states. */
@Composable
fun VertuStatusCard(
  title: String,
  state: FlowExecutionState,
  detail: String,
  modifier: Modifier = Modifier,
) {
  Card(
    modifier = modifier.fillMaxWidth(),
    shape = VertuShape.Bubble,
    border = vertuBorder(),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
  ) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        Text(operatorStateLabel(state), style = MaterialTheme.typography.labelSmall, color = operatorStateColor(state))
      }
      if (detail.isNotBlank()) {
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

/** Secondary floating shortcut that returns focus to the inline command center. */
@Composable
fun VertuFloatingChatBubble(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  icon: ImageVector,
) {
  SmallFloatingActionButton(
    onClick = onClick,
    modifier = modifier,
    shape = CircleShape,
    containerColor = vertuGold(),
    contentColor = MaterialTheme.colorScheme.onPrimary,
  ) {
    Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
  }
}

@Composable
private fun operatorStateColor(state: FlowExecutionState): Color {
  return when (state) {
    FlowExecutionState.SUCCESS -> MaterialTheme.customColors.successColor
    FlowExecutionState.ERROR_RETRYABLE,
    FlowExecutionState.ERROR_NON_RETRYABLE,
    FlowExecutionState.UNAUTHORIZED -> MaterialTheme.colorScheme.error
    FlowExecutionState.LOADING -> vertuGold()
    FlowExecutionState.EMPTY,
    FlowExecutionState.IDLE -> MaterialTheme.colorScheme.onSurfaceVariant
  }
}

@Composable
private fun operatorStateLabel(state: FlowExecutionState): String {
  return when (state) {
    FlowExecutionState.IDLE -> stringResource(R.string.operator_state_idle)
    FlowExecutionState.LOADING -> stringResource(R.string.operator_state_loading)
    FlowExecutionState.SUCCESS -> stringResource(R.string.operator_state_success)
    FlowExecutionState.EMPTY -> stringResource(R.string.operator_state_empty)
    FlowExecutionState.ERROR_RETRYABLE -> stringResource(R.string.operator_state_error_retryable)
    FlowExecutionState.ERROR_NON_RETRYABLE -> stringResource(R.string.operator_state_error_non_retryable)
    FlowExecutionState.UNAUTHORIZED -> stringResource(R.string.operator_state_unauthorized)
  }
}
