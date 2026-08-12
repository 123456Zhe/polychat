package com.polychat.app.ui.chats

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.HelpOutline
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polychat.app.data.api.toUserMessage
import com.polychat.app.data.model.Message
import com.polychat.app.data.model.Mentionable
import com.polychat.app.data.repo.AuthRepository
import com.polychat.app.data.repo.ChatRepository
import com.polychat.app.ui.components.ImagePreviewOverlay
import com.polychat.app.ui.components.MessageBubble
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
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
    val mentionables by viewModel.mentionables.collectAsState()
    val uploading by viewModel.uploading.collectAsState()
    val errorMessage by viewModel.error.collectAsState()
    val context = LocalContext.current

    var draft by remember { mutableStateOf(TextFieldValue("")) }
    var menuMessage by remember { mutableStateOf<Message?>(null) }
    var mdHelpOpen by remember { mutableStateOf(false) }
    var previewUrl by remember { mutableStateOf<String?>(null) }
    var previewMessage by remember { mutableStateOf<Message?>(null) }
    val listState = rememberLazyListState()
    var firstScroll by remember { mutableStateOf(true) }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.sendFile(uri, context.contentResolver)
    }

    // Android 7–9 need the storage permission before writing to Downloads.
    var pendingDownload by remember { mutableStateOf<Message?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val msg = pendingDownload
        pendingDownload = null
        if (granted && msg != null) viewModel.downloadFile(msg, context)
        else if (!granted) Toast.makeText(context, "需要存储权限才能下载", Toast.LENGTH_SHORT).show()
    }
    fun requestDownload(msg: Message) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownload = msg
            permissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            viewModel.downloadFile(msg, context)
        }
    }

    LaunchedEffect(roomId, convId) {
        viewModel.open(roomId, convId)
        viewModel.loadMentionables()
        firstScroll = true
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty() && firstScroll) {
            listState.scrollToItem(messages.size - 1)
            firstScroll = false
        }
    }
    // Load older messages when user scrolls near the top.
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .collect { index ->
                if (index < 5 && viewModel.hasOlder.value) {
                    viewModel.loadOlder()
                }
            }
    }
    LaunchedEffect(errorMessage) {
        errorMessage?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            viewModel.clearError()
        }
    }

    // @-mention picker state (rooms only, mirrors the web client).
    val mentionState = remember(draft.text, draft.selection.end, mentionables, roomId) {
        detectMentionQuery(roomId, draft.text, draft.selection.end, mentionables)
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
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(messages, key = { it.id }) { message ->
                        val isOwn = message.user_id == myId
                        MessageBubble(
                            message = message,
                            isOwn = isOwn,
                            avatarUrl = viewModel.resolveAvatar(message.avatar_updated_at, message.user_id),
                            attachmentUrl = viewModel.resolveFile(message.attachment_id),
                            onOpenMenu = { menuMessage = it },
                            onImageClick = { msg, url ->
                                previewMessage = msg
                                previewUrl = url
                            },
                            onFileClick = { requestDownload(it) }
                        )
                    }
                }
            }

            // @-mention suggestion list above the composer.
            mentionState?.let { state ->
                MentionSuggestions(
                    matches = state.matches,
                    onSelect = { user ->
                        draft = insertMention(draft, state.start, state.query, user)
                    }
                )
            }

            // Composer.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 6.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                IconButton(onClick = { filePicker.launch(arrayOf("*/*")) }, enabled = !uploading) {
                    Icon(Icons.Filled.AttachFile, contentDescription = "发送文件")
                }
                IconButton(onClick = { mdHelpOpen = true }, enabled = !uploading) {
                    Icon(Icons.Filled.HelpOutline, contentDescription = "Markdown 语法速查")
                }
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("输入消息，支持 Markdown 与 \$公式\$，输入 @ 提及") },
                    maxLines = 5,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(6.dp))
                if (uploading) {
                    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 3.dp)
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary)
                            .clickable(enabled = draft.text.isNotBlank()) {
                                viewModel.send(draft.text.trim())
                                draft = TextFieldValue("")
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Filled.Send,
                            contentDescription = "发送",
                            tint = if (draft.text.isNotBlank()) MaterialTheme.colorScheme.onPrimary
                            else MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.4f)
                        )
                    }
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
                if (msg.attachment_id != null) {
                    SheetAction("下载文件") {
                        requestDownload(msg)
                        menuMessage = null
                    }
                }
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

    // Markdown / LaTeX quick reference sheet.
    if (mdHelpOpen) {
        androidx.compose.material3.ModalBottomSheet(
            onDismissRequest = { mdHelpOpen = false }
        ) {
            Column(
                Modifier
                    .padding(horizontal = 20.dp, vertical = 8.dp)
                    .padding(bottom = 28.dp)
            ) {
                Text("Markdown 语法速查", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(2.dp))
                mdCheatRows.forEach { (syntax, desc) ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Text(
                                syntax,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(desc, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }

    // Full-screen image preview with pinch-to-zoom.
    if (previewUrl != null && previewMessage != null) {
        ImagePreviewOverlay(
            url = previewUrl!!,
            contentDescription = previewMessage?.attachment_name ?: "图片",
            onClose = {
                previewUrl = null
                previewMessage = null
            },
            onDownload = { previewMessage?.let { requestDownload(it) } }
        )
    }
}

@Composable
private fun MentionSuggestions(
    matches: List<Mentionable>,
    onSelect: (Mentionable) -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 3.dp,
        shadowElevation = 4.dp
    ) {
        LazyColumn(
            modifier = Modifier.heightIn(max = 220.dp),
            contentPadding = PaddingValues(vertical = 4.dp)
        ) {
            items(matches.size) { index ->
                val member = matches[index]
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(member) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primaryContainer),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            member.username.take(1).uppercase(),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(member.username, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

/** Active @-mention state while typing: cursor is inside `@query` after a word boundary. */
private data class MentionQuery(val start: Int, val query: String, val matches: List<Mentionable>)

private fun detectMentionQuery(
    roomId: Long?,
    text: String,
    cursor: Int,
    members: List<Mentionable>
): MentionQuery? {
    if (roomId == null || members.isEmpty() || cursor <= 0) return null
    var i = cursor - 1
    while (i >= 0 && text[i] != '@' && text[i] != ' ' && text[i] != '\n') i--
    if (i >= 0 && text[i] == '@') {
        val query = text.substring(i + 1, cursor)
        val lower = query.lowercase()
        val matches = members.filter {
            query.isEmpty() || it.username.lowercase().contains(lower) || it.id.toString().contains(lower)
        }
        if (matches.isNotEmpty()) return MentionQuery(i, query, matches)
    }
    return null
}

/** Replaces `@query` at [start] with the `[at:userId] ` token the server understands. */
private fun insertMention(draft: TextFieldValue, start: Int, query: String, user: Mentionable): TextFieldValue {
    val before = draft.text.substring(0, start)
    val after = draft.text.substring(start + 1 + query.length)
    val token = "[at:${user.id}] "
    return TextFieldValue(
        text = before + token + after,
        selection = TextRange(before.length + token.length)
    )
}

/** Markdown / LaTeX quick reference shown in the composer help sheet. */
private val mdCheatRows = listOf(
    "# 标题" to "一级到六级标题（# ～ ######）",
    "**加粗**" to "加粗",
    "*斜体*" to "斜体",
    "~~删除线~~" to "删除线",
    "`行内代码`" to "行内代码",
    "```js 代码块```" to "多行代码块（可指定语言）",
    "[文字](https://…)" to "链接",
    "![说明](图片URL)" to "图片",
    "> 引用" to "引用",
    "- 项目 / 1. 第一项" to "无序 / 有序列表",
    "| 列1 | 列2 |" to "表格（第二行写 | --- |）",
    "\$E=mc^2\$" to "行内 LaTeX 公式",
    "\$\$…\$\$" to "块级 LaTeX 公式",
    "@用户名" to "提及用户（会高亮提醒）"
)

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
    private val prefs: com.polychat.app.data.local.PreferencesStore,
    @ApplicationContext private val context: android.content.Context
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

    private val _mentionables = MutableStateFlow<List<Mentionable>>(emptyList())
    val mentionables: StateFlow<List<Mentionable>> = _mentionables.asStateFlow()

    private val _uploading = MutableStateFlow(false)
    val uploading: StateFlow<Boolean> = _uploading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    var isAdmin: Boolean = false
        private set

    private var roomId: Long? = null
    private var convId: Long? = null
    private var serverUrl: String? = null
    private var oldestId: Long? = null
    private val _hasOlder = MutableStateFlow(false)
    val hasOlder: StateFlow<Boolean> = _hasOlder.asStateFlow()

    suspend fun open(roomId: Long?, convId: Long?) {
        this.roomId = roomId
        this.convId = convId
        _loading.value = true
        _messages.value = emptyList()
        oldestId = null
        _hasOlder.value = false
        serverUrl = chatRepo.serverUrlOrNull()
        _myId.value = prefs.getUserId() ?: 0L
        val me = authRepo.me()
        isAdmin = me?.is_admin == true
        if (roomId != null) {
            chatRepo.clearMention(roomId)
            _title.value = chatRepo.roomName(roomId) ?: "房间"
            _subtitle.value = chatRepo.roomSubtitle(roomId)
            val list = chatRepo.loadRoomMessages(roomId, before = Long.MAX_VALUE)
            _messages.value = list
            oldestId = list.firstOrNull()?.id
            _hasOlder.value = list.size >= 60
        } else if (convId != null) {
            _title.value = chatRepo.convName(convId) ?: "私信"
            _subtitle.value = ""
            val list = chatRepo.loadDmMessages(convId, before = Long.MAX_VALUE)
            _messages.value = list
            oldestId = list.firstOrNull()?.id
            _hasOlder.value = list.size >= 60
            list.lastOrNull()?.let { chatRepo.markDmRead(convId, it.id) }
        }
        _loading.value = false
    }

    fun loadMentionables() {
        val rid = roomId ?: return
        viewModelScope.launch {
            runCatching { chatRepo.loadMentionables(rid) }
                .onSuccess { _mentionables.value = it }
                .onFailure { _mentionables.value = emptyList() }
        }
    }

    fun loadOlder() {
        viewModelScope.launch {
            val rid = roomId ?: return@launch
            val before = oldestId ?: return@launch
            try {
                val older = chatRepo.loadRoomMessages(rid, before = before, limit = 60)
                if (older.isNotEmpty()) {
                    _messages.value = older + _messages.value
                    oldestId = older.first().id
                    _hasOlder.value = older.size >= 60
                } else {
                    _hasOlder.value = false
                }
            } catch (_: Exception) { }
        }
    }

    fun send(text: String) {
        viewModelScope.launch {
            try {
                if (roomId != null) chatRepo.sendRoomMessage(roomId!!, text, null, null)
                else if (convId != null) chatRepo.sendDm(convId!!, text, null, null)
            } catch (e: Exception) { _error.value = e.toUserMessage() }
        }
    }

    /** Uploads a picked file in chunks, then sends it as a message attachment. */
    fun sendFile(uri: android.net.Uri, contentResolver: android.content.ContentResolver) {
        if (_uploading.value) return
        viewModelScope.launch {
            _uploading.value = true
            try {
                val file = copyUriToTempFile(uri, contentResolver)
                val name = queryDisplayName(uri, contentResolver) ?: "file"
                val mime = contentResolver.getType(uri) ?: "application/octet-stream"
                val attachmentId = chatRepo.uploadFile(file, name, mime)
                if (roomId != null) chatRepo.sendRoomMessage(roomId!!, null, attachmentId, null)
                else if (convId != null) chatRepo.sendDm(convId!!, null, attachmentId, null)
            } catch (e: Exception) {
                _error.value = e.toUserMessage()
            } finally {
                _uploading.value = false
            }
        }
    }

    /** Downloads an attachment to the Downloads directory and opens it. */
    fun downloadFile(message: Message, activityContext: android.content.Context) {
        val attachmentId = message.attachment_id ?: return
        viewModelScope.launch {
            try {
                val file = chatRepo.downloadAttachment(
                    attachmentId,
                    message.attachment_name ?: "file",
                    message.attachment_type
                )
                if (file != null) {
                    Toast.makeText(activityContext, "已保存到「下载」", Toast.LENGTH_SHORT).show()
                    openFile(activityContext, file, message.attachment_type)
                }
            } catch (e: Exception) {
                Toast.makeText(activityContext, e.toUserMessage(), Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun clearError() {
        _error.value = null
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
        val base = serverUrl ?: com.polychat.app.data.api.ApiClient.DEFAULT_SERVER_URL
        return "$base/api/users/$userId/avatar?v=$avatarUpdatedAt"
    }

    fun resolveFile(attachmentId: Long?): String? {
        if (attachmentId == null) return null
        val base = serverUrl ?: com.polychat.app.data.api.ApiClient.DEFAULT_SERVER_URL
        return "$base/api/files/$attachmentId?inline=1"
    }

    private fun copyUriToTempFile(uri: android.net.Uri, resolver: android.content.ContentResolver): java.io.File {
        val dir = java.io.File(context.cacheDir, "uploads").apply { mkdirs() }
        val name = queryDisplayName(uri, resolver) ?: ("file_" + System.currentTimeMillis())
        val target = java.io.File(dir, name.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
        resolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { out -> input.copyTo(out) }
        } ?: throw java.io.IOException("无法读取所选文件")
        return target
    }

    private fun queryDisplayName(uri: android.net.Uri, resolver: android.content.ContentResolver): String? =
        runCatching {
            resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull()

    private fun openFile(activityContext: android.content.Context, file: java.io.File, mimeType: String?) {
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                activityContext,
                "${activityContext.packageName}.fileprovider",
                file
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType ?: "application/octet-stream")
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (activityContext !is android.app.Activity) addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activityContext.startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(activityContext, "已保存到「下载」，但无法直接打开该文件", Toast.LENGTH_SHORT).show()
        }
    }
}
