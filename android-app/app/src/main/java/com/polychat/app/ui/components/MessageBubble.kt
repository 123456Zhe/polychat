package com.polychat.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.polychat.app.data.model.Message
import com.polychat.app.ui.theme.LocalChatTokens
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** A single chat message bubble — own messages align right, others left. */
@Composable
fun MessageBubble(
    message: Message,
    isOwn: Boolean,
    avatarUrl: String?,
    attachmentUrl: String?,
    onOpenMenu: (Message) -> Unit
) {
    val tokens = LocalChatTokens.current
    val bubbleColor = if (isOwn) tokens.ownBubble else tokens.incomingBubble
    val textColor = tokens.onBubble

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isOwn) Arrangement.End else Arrangement.Start
    ) {
        // Avatar for incoming messages only.
        if (!isOwn) {
            Avatar(avatarUrl, name = message.username, size = 36)
            Spacer(Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = 300.dp),
            horizontalAlignment = if (isOwn) Alignment.End else Alignment.Start
        ) {
            // Reply reference.
            message.reply_content?.let {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = bubbleColor.copy(alpha = 0.6f)
                ) {
                    Text(
                        text = "回复 ${message.reply_username.orEmpty()}: ${it.take(60)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = textColor.copy(alpha = 0.75f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }

            Spacer(Modifier.height(2.dp))

            // Bubble body.
            Surface(
                shape = RoundedCornerShape(
                    topStart = if (isOwn) 14.dp else 4.dp,
                    topEnd = if (isOwn) 4.dp else 14.dp,
                    bottomStart = 14.dp,
                    bottomEnd = 14.dp
                ),
                color = bubbleColor,
                modifier = Modifier.clickable { onOpenMenu(message) }
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                    // Retracted message.
                    if (message.isRetracted) {
                        Text("此消息已撤回", style = MaterialTheme.typography.bodySmall, color = textColor.copy(alpha = 0.6f))
                    } else {
                        // Text content (Markdown + LaTeX via WebView).
                        if (!message.content.isNullOrBlank()) {
                            MarkdownWebView(
                                content = message.content,
                                mentions = message.mentions,
                                bubbleColor = bubbleColor
                            )
                        }
                        // Attachment.
                        message.attachment_name?.let { name ->
                            if (message.attachment_type?.startsWith("image/") == true && !attachmentUrl.isNullOrEmpty()) {
                                AsyncImage(
                                    model = attachmentUrl,
                                    contentDescription = name,
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier
                                        .widthIn(max = 260.dp)
                                        .height(180.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                )
                            } else {
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = Color.Transparent
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("📎", style = MaterialTheme.typography.titleMedium)
                                        Spacer(Modifier.width(6.dp))
                                        Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                        // P2P card (read-only in v1).
                        if (message.p2p_transfer_id != null) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = Color.Transparent
                            ) {
                                Column {
                                    Text("📦 ${message.p2p_name.orEmpty()}", style = MaterialTheme.typography.bodyMedium)
                                    Text("P2P 直传 · 仅到达对方设备", style = MaterialTheme.typography.bodySmall, color = textColor.copy(alpha = 0.6f))
                                }
                            }
                        }
                    }
                }
            }

            // Timestamp + edited marker.
            Text(
                text = buildString {
                    append(formatTime(message.created_at))
                    if (message.edited_at != null) append(" · 已编辑")
                },
                style = MaterialTheme.typography.bodySmall,
                color = textColor.copy(alpha = 0.5f),
                modifier = Modifier.padding(
                    top = 3.dp,
                    start = if (isOwn) 0.dp else 4.dp,
                    end = if (isOwn) 4.dp else 0.dp
                )
            )
        }
    }
}

@Composable
fun Avatar(avatarUrl: String?, name: String, size: Int = 40) {
    val initials = name.take(1).uppercase(Locale.getDefault()).ifBlank { "?" }
    if (!avatarUrl.isNullOrEmpty()) {
        AsyncImage(
            model = avatarUrl,
            contentDescription = name,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size.dp).clip(CircleShape)
        )
    } else {
        Box(
            modifier = Modifier
                .size(size.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer)
                .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(initials, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}

private fun formatTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return try {
        // Server returns "YYYY-MM-DD HH:MM:SS" in UTC.
        val parser = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        val date = parser.parse(iso)
        if (date == null) return iso
        SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(date)
    } catch (_: Exception) {
        iso
    }
}
