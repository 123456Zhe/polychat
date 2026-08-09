package com.polychat.app.ui.components

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.roundToInt

/**
 * Renders one message's Markdown (including LaTeX via KaTeX) inside a
 * transparent WebView using the bundled assets/markdown.html template.
 *
 * The WebView reports its content height back through a JS bridge, which
 * drives the Compose height so the bubble wraps the rendered content exactly.
 * KaTeX fonts + marked/DOMPurify are bundled in assets/vendor.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MarkdownWebView(
    content: String,
    mentions: List<com.polychat.app.data.model.Mention>,
    bubbleColor: Color,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current.density
    var heightDp by remember(content) { mutableIntStateOf(20) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            webView?.destroy()
            webView = null
        }
    }

    // Render whenever content changes.
    LaunchedEffect(content, mentions) {
        val wv = webView ?: return@LaunchedEffect
        val escaped = content
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "")
        val mentionsJson = runCatching {
            kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.encodeToString(
                kotlinx.serialization.builtins.ListSerializer(
                    com.polychat.app.data.model.Mention.serializer()
                ),
                mentions
            )
        }.getOrDefault("[]")
        wv.evaluateJavascript("renderMessage('$escaped', $mentionsJson);", null)
    }

    // Adjust text color for dark bubbles.
    LaunchedEffect(bubbleColor) {
        val wv = webView ?: return@LaunchedEffect
        val lum = 0.299 * bubbleColor.red + 0.587 * bubbleColor.green + 0.114 * bubbleColor.blue
        wv.evaluateJavascript("setMode('${if (lum < 0.5f) "dark" else "light"}');", null)
    }

    AndroidView(
        factory = { ctx ->
            val wv = WebView(ctx)
            wv.settings.javaScriptEnabled = true
            wv.settings.allowFileAccess = true
            wv.settings.domStorageEnabled = true
            wv.setBackgroundColor(AndroidColor.TRANSPARENT)
            wv.isVerticalScrollBarEnabled = false
            wv.isHorizontalScrollBarEnabled = false
            wv.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            wv.webChromeClient = WebChromeClient()
            wv.addJavascriptInterface(Bridge { px -> heightDp = (px / density).roundToInt() }, "PolyChatBridge")
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    view.evaluateJavascript("setMode('light');", null)
                }
            }
            wv.loadUrl("file:///android_asset/markdown.html")
            webView = wv
            wv
        },
        update = { wv ->
            wv.setBackgroundColor(AndroidColor.TRANSPARENT)
        },
        modifier = modifier.fillMaxWidth().height(heightDp.dp)
    )
}

private class Bridge(private val onHeight: (Int) -> Unit) {
    @JavascriptInterface
    fun onHeightChanged(height: Int) {
        onHeight(height)
    }
}
