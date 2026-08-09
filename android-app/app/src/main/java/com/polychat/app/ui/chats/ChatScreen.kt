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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polychat.app.data.model.Message
import com.polychat.app.data.repo.ChatRepository
import com.polychat.app.ui.components.MessageBubble
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Full-screen chat for a room (roomId != null) or DM conversation (convId != null).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: ChatViewModel,
    roomId: Long?,
    convId: Long?,
    onBack: () -> Unit
) {
    val messages by viewModel.messages.collectAsState()
    val title by viewModel.title.collectAsState()
    val subtitle by viewModel.subtitle.collectAsState()
    val myId by viewModel.myId.collectAsState()
    val loading by viewModel.loading.collectAsState()

    var draft by remember { mutableStateOf("") }
    var menuMessage by remember { mutableStateOf<Message?>(null) }
    val listState = rememberLazyListState()

    LaunchedEffect(roomId, convId) {
        viewModel.open(roomId, convId)
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.scrollToItem(messages.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, style = MaterialTheme.typography.titleMedium)
                        if (subtitle.isNotBlank()) {
                            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    Box {
                        var menuOpen by remember { mutableStateOf(false) }
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "更多")
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("搜索消息") }, onClick = { menuOpen = false })
                            DropdownMenuItem(text = { Text("置顶消息") }, onClick = { menuOpen = false })
                            DropdownMenuItem(text = { Text("成员管理") }, onClick = { menuOpen = false })
                        }
                    }
                }
            )
        },
        modifier = Modifier.imePadding()
    ) { innerPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(innerPadding)
        ) {
            if (loading) {
                Box(Modifier.fillMaxSize().weight(1f), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(messages, key = { it.id }) { message ->
                        val isOwn = message.user_id == myId
                        MessageBubble(
                            message = message,
                            isOwn = isOwn,
                            avatarUrl = viewModel.resolveAvatar(message.avatar_updated_at, message.user_id),
                            attachmentUrl = viewModel.resolveFile(message.attachment_id),
                            onOpenMenu = { menuMessage = it }
                        )
                    }
                }
            }

            // Composer
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("输入消息，支持 Markdown 与 $公式$") },
                    maxLines = 5,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        if (draft.isNotBlank()) {
                            viewModel.send(draft)
                            draft = ""
                        }
                    },
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(Icons.Filled.Send, contentDescription = "发送", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }

    // Message action menu (bottom sheet style).
    menuMessage?.let { msg ->
        androidx.compose.material3.ModalBottomSheet(
            onDismissRequest = { menuMessage = null }
        ) {
            Column(Modifier.padding(bottom = 24.dp)) {
                SheetAction("回复") { menuMessage = null }
                SheetAction("复制 Markdown") { menuMessage = null }
                if (msg.user_id == myId) {
                    SheetAction("编辑") { menuMessage = null }
                }
                if (msg.user_id == myId || viewModel.isAdmin) {
                    SheetAction("撤回", danger = true) {
                        viewModel.retract(msg)
                        menuMessage = null
                    }
                }
            }
        }
    }
}

@Composable
private fun SheetAction(text: String, danger: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp)
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            color = if (danger) Color(0xFFDC2626) else MaterialTheme.colorScheme.onSurface
        )
    }
}

@HiltViewModel
class ChatViewModel @Inject constructor(
    val chatRepo: ChatRepository,
    private val authRepo: AuthRepository,
    private val prefs: com.polychat.app.data.local.PreferencesStore
) : ViewModel() {
    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages.asStateFlow()

    private val _title = MutableStateFlow("")
    val title: StateFlow<String> = _title.asStateFlow()

    private val _subtitle = MutableStateFlow("")
    val subtitle: StateFlow<String> = _subtitle.asStateFlow()

    private val _myId = MutableStateFlow(0L)
    val myId: StateFlow<Long> = _myId.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    var isAdmin: Boolean = false
        private set

    private var roomId: Long? = null
    private var convId: Long? = null
    private var serverUrl: String? = null

    suspend fun open(roomId: Long?, convId: Long?) {
        this.roomId = roomId
        this.convId = convId
        _loading.value = true
        _messages.value = emptyList()
        serverUrl = chatRepo.serverUrlOrNull()
        _myId.value = prefs.getUserId() ?: 0L
        val me = authRepo.me()
        isAdmin = me?.is_admin == true
        if (roomId != null) {
            _title.value = chatRepo.roomName(roomId) ?: "房间"
            _subtitle.value = chatRepo.roomSubtitle(roomId)
            val list = chatRepo.loadRoomMessages(roomId)
            _messages.value = list
        } else if (convId != null) {
            _title.value = chatRepo.convName(convId) ?: "私信"
            _subtitle.value = ""
            val list = chatRepo.loadDmMessages(convId)
            _messages.value = list
            list.lastOrNull()?.let { chatRepo.markDmRead(convId, it.id) }
        }
        _loading.value = false
    }

    fun send(text: String) {
        viewModelScope.launch {
            try {
                if (roomId != null) chatRepo.sendRoomMessage(roomId!!, text, null, null)
                else if (convId != null) chatRepo.sendDm(convId!!, text, null, null)
            } catch (e: Exception) { /* surface via snackbar */ }
        }
    }

    fun retract(message: Message) {
        viewModelScope.launch {
            try {
                if (roomId != null) chatRepo.deleteRoomMessage(message.id)
                else chatRepo.deleteDmMessage(message.id)
                refresh()
            } catch (e: Exception) { }
        }
    }

    private suspend fun refresh() {
        roomId?.let { _messages.value = chatRepo.loadRoomMessages(it) }
        convId?.let { _messages.value = chatRepo.loadDmMessages(it) }
    }

    fun resolveAvatar(avatarUpdatedAt: Long?, userId: Long): String? {
        if (avatarUpdatedAt == null) return null
        val base = serverUrl ?: return null
        return "$base/api/users/$userId/avatar?v=$avatarUpdatedAt"
    }

    fun resolveFile(attachmentId: Long?): String? {
        if (attachmentId == null) return null
        val base = serverUrl ?: return null
        return "$base/api/files/$attachmentId?inline=1"
    }
}
