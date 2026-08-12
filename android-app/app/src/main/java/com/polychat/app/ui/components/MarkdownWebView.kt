package com.polychat.app.ui.components

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.webkit.JavascriptInterface
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.polychat.app.data.model.Mention
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlin.math.ceil

/**
 * Renders one message's Markdown (including LaTeX via KaTeX) inside a
 * transparent WebView using the bundled assets/markdown.html template.
 *
 * The initial height is estimated so the list can lay out immediately. The
 * page then reports its rendered height after Markdown, fonts and images have
 * settled, preventing long messages from being clipped.
 *
 * Touch: the WebView does not consume any touches, otherwise it would swallow
 * drags and the message list could not scroll. Links inside messages are
 * therefore not tappable (acceptable for now).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MarkdownWebView(
    content: String,
    mentions: List<Mention>,
    bubbleColor: Color,
    modifier: Modifier = Modifier
) {
    val estimatedDp = remember(content) { estimateHeightDp(content) }
    var heightDp by remember(content) { mutableIntStateOf(estimatedDp) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var pageReady by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf("light") }

    DisposableEffect(Unit) {
        onDispose {
            webView?.destroy()
            webView = null
        }
    }

    // Render whenever content changes (after the page is loaded).
    LaunchedEffect(content, mentions, pageReady) {
        val wv = webView ?: return@LaunchedEffect
        if (!pageReady) return@LaunchedEffect
        val escaped = content
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "")
        val mentionsJson = runCatching {
            Json { ignoreUnknownKeys = true }.encodeToString(ListSerializer(Mention.serializer()), mentions)
        }.getOrDefault("[]")
        wv.evaluateJavascript("renderMessage('$escaped', $mentionsJson);", null)
    }

    // Adjust text color for dark bubbles.
    LaunchedEffect(bubbleColor) {
        val lum = 0.299 * bubbleColor.red + 0.587 * bubbleColor.green + 0.114 * bubbleColor.blue
        mode = if (lum < 0.5f) "dark" else "light"
        if (pageReady) webView?.evaluateJavascript("setMode('$mode');", null)
    }

    AndroidView(
        factory = { ctx ->
            // Pass through every touch to the parent LazyColumn — the bubble
            // content is overflow:hidden, so there is nothing to scroll inside.
            // Without this the WebView swallows drags and the message list is
            // stuck.
            val wv = object : WebView(ctx) {
                override fun onTouchEvent(event: MotionEvent): Boolean = false
                override fun onInterceptTouchEvent(event: MotionEvent): Boolean = false
                override fun dispatchTouchEvent(event: MotionEvent): Boolean = false
            }
            wv.settings.javaScriptEnabled = true
            wv.settings.allowFileAccess = true
            wv.settings.domStorageEnabled = true
            wv.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun reportHeight(heightPx: Float) {
                        wv.post {
                            // WebView scrollHeight is measured in CSS px, which
                            // maps to dp under the viewport's device scale.
                            val renderedDp = (ceil(heightPx).toInt() + 2).coerceAtLeast(32)
                            if (heightDp != renderedDp) heightDp = renderedDp
                        }
                    }
                },
                "PolyChatLayout"
            )
            wv.setBackgroundColor(AndroidColor.TRANSPARENT)
            wv.isVerticalScrollBarEnabled = false
            wv.isHorizontalScrollBarEnabled = false
            wv.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            wv.webChromeClient = WebChromeClient()
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    pageReady = true
                    view.evaluateJavascript("setMode('$mode');", null)
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

private val MARKDOWN_IMAGE = Regex("""!\[[^\]]*\]\([^)]*\)""")
private val MARKDOWN_BLOCK = Regex("""(?m)^(#{1,6} |```|[-*>] |\d+\. )""")
private val MARKDOWN_INLINE = listOf(
    Regex("""\*\*[^\n]+\*\*"""),        // **bold**
    Regex("""\*[^*\n]+\*"""),           // *italic*
    Regex("""~~[^\n]+~~"""),            // ~~strikethrough~~
    Regex("""`[^`\n]+`"""),             // `inline code`
    Regex("""\[[^\]]+\]\([^)]+\)"""),   // [link](url)
    Regex("""\[at:\d+\]"""),            // @mention placeholder [at:123]
    Regex("""\$[^$\n]+\$"""),           // inline math $...$
    Regex("""^\s*\|.*\|\s*$""", RegexOption.MULTILINE) // table row
)

/**
 * Detects whether a message contains Markdown / LaTeX syntax that needs the
 * WebView renderer. Pure-text messages skip the (expensive) per-message
 * WebView pipeline entirely and are drawn with a plain Text instead.
 */
fun containsMarkdown(text: String): Boolean {
    if (MARKDOWN_IMAGE.containsMatchIn(text)) return true
    if (MARKDOWN_BLOCK.containsMatchIn(text)) return true
    return MARKDOWN_INLINE.any { it.containsMatchIn(text) }
}

/**
 * Rough static height estimate (dp) for a rendered markdown message:
 * full-width chars count 2, half-width 1, ~100 half-width units per line,
 * ~10dp per line; block elements (headings, code fences, lists, quotes) and
 * math/`$...$` formulas get extra room; each markdown image ~170dp.
 * Deliberately over-estimates so content is never clipped.
 */
private fun estimateHeightDp(content: String): Int {
    var width = 0
    var lines = 1
    for (ch in content) {
        if (ch == '\n') {
            lines++
            width = 0
            continue
        }
        width += if (ch.code > 0x2E7F) 2 else 1
        if (width > 100) {
            lines++
            width = 0
        }
    }
    val blocks = MARKDOWN_BLOCK.findAll(content).count()
    val imgCount = MARKDOWN_IMAGE.findAll(content).count()
    val mathCount = content.count { it == '$' } / 2
    return lines * 10 + blocks * 8 + 6 + imgCount * 170 + mathCount * 8
}
