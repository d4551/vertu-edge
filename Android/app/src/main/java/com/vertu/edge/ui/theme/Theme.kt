package com.vertu.edge.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val VertuDarkColorScheme = darkColorScheme(
    primary = VertuGold,
    onPrimary = VertuBlack,
    primaryContainer = VertuGoldDark,
    onPrimaryContainer = VertuGoldLight,
    secondary = VertuAccent,
    onSecondary = VertuWhite,
    background = VertuBlack,
    onBackground = VertuWhite,
    surface = VertuDarkGray,
    onSurface = VertuWhite,
    surfaceVariant = VertuMedGray,
    onSurfaceVariant = VertuLightGray,
    error = VertuError,
)

private val VertuLightColorScheme = lightColorScheme(
    primary = VertuGoldDark,
    onPrimary = VertuWhite,
    primaryContainer = VertuGoldLight,
    onPrimaryContainer = VertuBlack,
    secondary = VertuAccent,
    onSecondary = VertuWhite,
    background = VertuWhite,
    onBackground = VertuBlack,
    surface = Color(0xFFF0F0F0),
    onSurface = VertuBlack,
    error = VertuError,
)

@Composable
fun VertuEdgeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) VertuDarkColorScheme else VertuLightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = VertuTypography,
        content = content
    )
}
