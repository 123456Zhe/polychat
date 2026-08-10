package com.polychat.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

/**
 * Full-screen image viewer: pinch-to-zoom (1x–5x), pan while zoomed,
 * double-tap to toggle 1x / 2.5x, single-tap closes. Top-right buttons
 * download the original or close. Uses the app-level Coil ImageLoader, which
 * attaches the Bearer token so the server serves the bytes.
 */
@Composable
fun ImagePreviewOverlay(
    url: String,
    contentDescription: String?,
    onClose: () -> Unit,
    onDownload: () -> Unit
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        AsyncImage(
            model = url,
            contentDescription = contentDescription,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offsetX
                    translationY = offsetY
                }
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(1f, 5f)
                        offsetX += pan.x
                        offsetY += pan.y
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = {
                            val target = if (scale > 1.01f) 1f else 2.5f
                            scale = target
                            offsetX = 0f
                            offsetY = 0f
                        },
                        onTap = { onClose() }
                    )
                }
        )

        // Top action bar (download + close).
        Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.35f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.End
        ) {
            IconButton(onClick = onDownload) {
                Icon(Icons.Filled.Download, contentDescription = "下载", tint = Color.White)
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = "关闭", tint = Color.White)
            }
        }
    }
}
