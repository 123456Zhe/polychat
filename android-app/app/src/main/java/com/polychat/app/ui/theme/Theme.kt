package com.polychat.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * PolyChat theme system — mirrors the 5 web presets mapped to Material 3 tokens.
 * [mist] (default) is a light blue-grey; the rest cover dark and accent palettes.
 */
enum class PolyTheme(
    val id: String,
    val label: String,
    val isDark: Boolean,
    val primary: Color,
    val onPrimary: Color,
    val primaryContainer: Color,
    val onPrimaryContainer: Color,
    val secondary: Color,
    val surface: Color,
    val onSurface: Color,
    val surfaceContainer: Color,
    val surfaceContainerHigh: Color,
    val outline: Color,
    val ownBubble: Color,
    val incomingBubble: Color,
    val onBubble: Color
) {
    MIST(
        id = "mist", label = "雾蓝", isDark = false,
        primary = Color(0xFF58789A), onPrimary = Color.White,
        primaryContainer = Color(0xFFD6E4EF), onPrimaryContainer = Color(0xFF1E3A5F),
        secondary = Color(0xFF665981),
        surface = Color(0xFFF2F0EF), onSurface = Color(0xFF26344B),
        surfaceContainer = Color(0xFFF8F7F6), surfaceContainerHigh = Color(0xFFE4E0DF),
        outline = Color(0xFFC9C2C1),
        ownBubble = Color(0xFFD6E4EF), incomingBubble = Color(0xFFE4E0DF), onBubble = Color(0xFF26344B)
    ),
    MIDNIGHT(
        id = "midnight", label = "午夜靛蓝", isDark = true,
        primary = Color(0xFF6366F1), onPrimary = Color.White,
        primaryContainer = Color(0xFF312E81), onPrimaryContainer = Color(0xFFE0E7FF),
        secondary = Color(0xFF8B5CF6),
        surface = Color(0xFF111827), onSurface = Color(0xFFE5E7EB),
        surfaceContainer = Color(0xFF1E293B), surfaceContainerHigh = Color(0xFF243047),
        outline = Color(0xFF34425C),
        ownBubble = Color(0xFF312E81), incomingBubble = Color(0xFF243047), onBubble = Color(0xFFE5E7EB)
    ),
    TEAL(
        id = "teal", label = "青绿浅色", isDark = false,
        primary = Color(0xFF0D9488), onPrimary = Color.White,
        primaryContainer = Color(0xFFCCFBF1), onPrimaryContainer = Color(0xFF134E4A),
        secondary = Color(0xFF64748B),
        surface = Color(0xFFF8FAFC), onSurface = Color(0xFF1E293B),
        surfaceContainer = Color(0xFFF1F5F9), surfaceContainerHigh = Color(0xFFE2E8F0),
        outline = Color(0xFFCBD5E1),
        ownBubble = Color(0xFFCCFBF1), incomingBubble = Color(0xFFE2E8F0), onBubble = Color(0xFF1E293B)
    ),
    MOCHA(
        id = "mocha", label = "Catppuccin Mocha", isDark = true,
        primary = Color(0xFF89B4FA), onPrimary = Color(0xFF1E1E2E),
        primaryContainer = Color(0xFF313244), onPrimaryContainer = Color(0xFFB4BEFE),
        secondary = Color(0xFFCBA6F7),
        surface = Color(0xFF1E1E2E), onSurface = Color(0xFFCDD6F4),
        surfaceContainer = Color(0xFF181825), surfaceContainerHigh = Color(0xFF313244),
        outline = Color(0xFF45475A),
        ownBubble = Color(0xFF313244), incomingBubble = Color(0xFF181825), onBubble = Color(0xFFCDD6F4)
    ),
    AMBER_ROSE(
        id = "amber-rose", label = "琥珀玫瑰", isDark = false,
        primary = Color(0xFFD97706), onPrimary = Color.White,
        primaryContainer = Color(0xFFFEF3C7), onPrimaryContainer = Color(0xFF78350F),
        secondary = Color(0xFFBE185D),
        surface = Color(0xFFFEF3C7), onSurface = Color(0xFF451A03),
        surfaceContainer = Color(0xFFFFFBEB), surfaceContainerHigh = Color(0xFFFDE68A),
        outline = Color(0xFFFDE68A),
        ownBubble = Color(0xFFFEF3C7), incomingBubble = Color(0xFFFDE68A), onBubble = Color(0xFF451A03)
    );

    fun toColorScheme(): ColorScheme = if (isDark) darkColorScheme(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = primaryContainer,
        onPrimaryContainer = onPrimaryContainer,
        secondary = secondary,
        surface = surface,
        onSurface = onSurface,
        surfaceVariant = surfaceContainer,
        onSurfaceVariant = outline,
        outline = outline,
        error = Color(0xFFDC2626)
    ) else lightColorScheme(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = primaryContainer,
        onPrimaryContainer = onPrimaryContainer,
        secondary = secondary,
        surface = surface,
        onSurface = onSurface,
        surfaceVariant = surfaceContainer,
        onSurfaceVariant = outline,
        outline = outline,
        error = Color(0xFFDC2626)
    )

    companion object {
        fun fromId(id: String?): PolyTheme = entries.firstOrNull { it.id == id } ?: MIST
    }
}

/** Extra tokens not covered by Material ColorScheme (chat bubbles). */
data class ChatTokens(
    val ownBubble: Color,
    val incomingBubble: Color,
    val onBubble: Color,
    val onlineDot: Color = Color(0xFF22C55E),
    val unreadBadge: Color = Color(0xFFDC2626)
)

val LocalChatTokens = staticCompositionLocalOf { ChatTokens(PolyTheme.MIST.ownBubble, PolyTheme.MIST.incomingBubble, PolyTheme.MIST.onBubble) }

@Composable
fun PolyChatTheme(
    themeId: String?,
    darkMode: String?, // "system" | "light" | "dark"
    content: @Composable () -> Unit
) {
    val base = PolyTheme.fromId(themeId)
    val systemDark = isSystemInDarkTheme()
    // Follow system when darkMode == "system", otherwise force.
    val effectiveDark = when (darkMode) {
        "light" -> false
        "dark" -> true
        else -> systemDark
    }
    // When the theme is itself a dark palette, respect it; else map to effective mode.
    val theme = if (base.isDark) base else base

    val tokens = ChatTokens(
        ownBubble = if (effectiveDark) base.ownBubble.copy(alpha = 1f) else base.ownBubble,
        incomingBubble = if (effectiveDark) base.incomingBubble else base.incomingBubble,
        onBubble = if (effectiveDark) base.onBubble else base.onBubble
    )

    CompositionLocalProvider(LocalChatTokens provides tokens) {
        MaterialTheme(
            colorScheme = theme.toColorScheme(),
            typography = PolyTypography,
            content = content
        )
    }
}
