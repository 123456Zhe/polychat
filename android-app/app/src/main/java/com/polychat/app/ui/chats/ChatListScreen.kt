package com.polychat.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.polychat.app.data.model.DmConversation
import com.polychat.app.data.model.Room
import com.polychat.app.ui.main.MainViewModel
import com.polychat.app.ui.theme.PolyTheme

/** Chat list tab: rooms + DM conversations, with unread badges. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    viewModel: MainViewModel,
    modifier: Modifier = Modifier,
    onOpenRoom: (Long) -> Unit = {},
    onOpenDm: (Long) -> Unit = {}
) {
    val rooms by viewModel.chatRepo.rooms.collectAsState()
    val conversations by viewModel.chatRepo.conversations.collectAsState()
    val roomUnread by viewModel.chatRepo.roomUnread.collectAsState()
    val dmUnread by viewModel.chatRepo.dmUnread.collectAsState()
    val mentionedRooms by viewModel.chatRepo.mentionedRooms.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("PolyChat") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { /* new room dialog */ }) {
                Icon(Icons.Filled.Add, contentDescription = "新建聊天室")
            }
        },
        modifier = modifier
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(innerPadding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (rooms.isNotEmpty()) {
                item { SectionLabel("聊天室") }
                items(rooms, key = { "room_${it.id}" }) { room ->
                    RoomRow(
                        room = room,
                        unread = roomUnread[room.id] ?: 0,
                        mentioned = mentionedRooms.contains(room.id),
                        onClick = { onOpenRoom(room.id) }
                    )
                }
            }
            if (conversations.isNotEmpty()) {
                item { SectionLabel("私信") }
                items(conversations, key = { "dm_${it.id}" }) { conv ->
                    DmRow(conv, unread = dmUnread[conv.id] ?: 0, onClick = { onOpenDm(conv.id) })
                }
            }
            if (rooms.isEmpty() && conversations.isEmpty()) {
                item {
                    Box(Modifier.fillMaxWidth().padding(top = 80.dp), contentAlignment = Alignment.Center) {
                        Text("还没有聊天，创建一个聊天室或找好友私信吧", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, top = 10.dp, bottom = 2.dp)
    )
}

@Composable
private fun RoomRow(room: Room, unread: Long, mentioned: Boolean, onClick: () -> Unit) {
    ListRow(
        leading = {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(PolyTheme.MIST.primary, PolyTheme.MIST.secondary)
                        )
                    ),
                contentAlignment = Alignment.Center
            ) { Text("#", color = Color.White, style = MaterialTheme.typography.titleMedium) }
        },
        title = room.name,
        subtitle = if (room.is_private) "🔒 私有聊天室" else "公共聊天室",
        unread = unread,
        mentioned = mentioned,
        onClick = onClick
    )
}

@Composable
private fun DmRow(conv: DmConversation, unread: Long, onClick: () -> Unit) {
    val peer = conv.peer
    ListRow(
        leading = {
            val initials = peer?.username?.take(1)?.uppercase() ?: "?"
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) { Text(initials, color = MaterialTheme.colorScheme.onPrimaryContainer) }
        },
        title = peer?.username ?: "私信",
        subtitle = conv.last_message?.content?.take(40) ?: "开始私信",
        unread = unread,
        onClick = onClick
    )
}

@Composable
private fun ListRow(
    leading: @Composable () -> Unit,
    title: String,
    subtitle: String,
    unread: Long,
    mentioned: Boolean = false,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        leading()
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (mentioned) {
            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFDC2626)),
                contentAlignment = Alignment.Center
            ) {
                Text("@", color = Color.White, style = MaterialTheme.typography.labelSmall)
            }
        } else if (unread > 0) {
            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFDC2626)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    if (unread > 99) "99+" else unread.toString(),
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall
                )
            }
        }
    }
}
