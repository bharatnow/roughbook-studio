package com.example.harbor.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(primary = Color(0xFF8FD3C1), background = Color(0xFF101414), surface = Color(0xFF101414))
private val LightColors = lightColorScheme(primary = Color(0xFF1F5C45), background = Color(0xFFFAF8F3), surface = Color(0xFFFAF8F3))

@Composable
fun HarborTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
