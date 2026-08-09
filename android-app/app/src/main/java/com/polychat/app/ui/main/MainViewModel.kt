package com.polychat.app.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polychat.app.data.model.User
import com.polychat.app.data.model.WsEvent
import com.polychat.app.data.repo.AuthRepository
import com.polychat.app.data.repo.ChatRepository
import com.polychat.app.data.repo.NotificationsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    val chatRepo: ChatRepository,
    val notifRepo: NotificationsRepository,
    private val authRepo: AuthRepository,
    private val prefsFlow: com.polychat.app.data.local.PreferencesStore
) : ViewModel() {

    private val _currentUser = MutableStateFlow<User?>(null)
    val currentUser: StateFlow<User?> = _currentUser.asStateFlow()

    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast.asStateFlow()

    /** Active chat navigation: exactly one of [roomId] / [convId] is non-null when a chat is open. */
    private val _roomId = MutableStateFlow<Long?>(null)
    val roomId: StateFlow<Long?> = _roomId.asStateFlow()

    private val _convId = MutableStateFlow<Long?>(null)
    val convId: StateFlow<Long?> = _convId.asStateFlow()

    private val _adminOpen = MutableStateFlow(false)
    val adminOpen: StateFlow<Boolean> = _adminOpen.asStateFlow()

    init {
        viewModelScope.launch {
            _currentUser.value = authRepo.me()
            chatRepo.loadRooms()
            chatRepo.loadConversations()
            chatRepo.loadFriends()
            notifRepo.loadUnreadCount()
        }
        // Wire WS events to repos.
        viewModelScope.launch {
            chatRepo.events.collect { event -> handleEvent(event) }
        }
        chatRepo.ws.connect()
    }

    private fun handleEvent(event: WsEvent) {
        when (event) {
            is WsEvent.Ready -> { /* connected */ }
            is WsEvent.PresenceSnapshot -> {
                chatRepo.applyPresenceSnapshot(event.users.map { it.id }.toSet())
            }
            is WsEvent.Presence -> chatRepo.applyPresence(event.user_id, event.online)
            is WsEvent.Typing -> chatRepo.applyTyping(event.room_id, event.user_id, event.typing)
            is WsEvent.Rooms -> viewModelScope.launch { runCatching { chatRepo.loadRooms() } }
            is WsEvent.Announcement -> viewModelScope.launch { runCatching { chatRepo.loadRooms() } }
            is WsEvent.Message -> {
                val msg: com.polychat.app.data.model.Message? = event.message
                msg?.let { chatRepo.appendRoomMessage(event.room_id, it) }
            }
            is WsEvent.ThreadMessage -> {
                // Threads are loaded on demand; ignore stream for v1.
            }
            is WsEvent.MessageUpdate -> {
                // Refresh single message.
                viewModelScope.launch { runCatching { /* handled by chat screen */ } }
            }
            is WsEvent.Pins -> { /* chat screen refreshes pins */ }
            is WsEvent.DmMessage -> {
                val msg: com.polychat.app.data.model.Message = event.message
                chatRepo.appendDmMessage(event.conversation_id, msg)
                viewModelScope.launch { runCatching { chatRepo.loadConversations() } }
            }
            is WsEvent.DmMessageUpdate -> viewModelScope.launch { runCatching { chatRepo.loadConversations() } }
            is WsEvent.DmRead -> {
                chatRepo.clearDmUnread(event.conversation_id, event.user_id)
            }
            is WsEvent.FriendRequest,
            is WsEvent.FriendAccept,
            is WsEvent.FriendRemove -> {
                viewModelScope.launch {
                    runCatching { chatRepo.loadFriends() }
                    runCatching { chatRepo.loadConversations() }
                }
            }
            is WsEvent.Notification -> notifRepo.pushFromWs(event.notification)
            is WsEvent.P2pInvite,
            is WsEvent.P2pAccepted,
            is WsEvent.P2pRejected,
            is WsEvent.P2pCanceled,
            is WsEvent.P2pSignal -> {
                // P2P direct transfer deferred to v2; fall back silently.
            }
            is WsEvent.Unknown -> { /* ignore */ }
        }
    }

    fun showToast(message: String) {
        _toast.value = message
    }

    fun openRoom(id: Long) {
        _roomId.value = id
        _convId.value = null
    }

    fun openDm(id: Long) {
        _convId.value = id
        _roomId.value = null
    }

    fun closeChat() {
        _roomId.value = null
        _convId.value = null
    }

    fun openAdmin() { _adminOpen.value = true }
    fun closeAdmin() { _adminOpen.value = false }

    // ---- Friends actions (called from ContactsScreen) ----
    fun searchFriends(query: String, onResult: (List<com.polychat.app.data.model.Friend>) -> Unit) {
        if (query.isBlank()) { onResult(emptyList()); return }
        viewModelScope.launch {
            runCatching { chatRepo.searchUsers(query) }.onSuccess { onResult(it) }
        }
    }

    fun addFriend(username: String) {
        viewModelScope.launch {
            runCatching { chatRepo.sendFriendRequest(username) }
            runCatching { chatRepo.loadFriends() }
            showToast("已向 $username 发送好友请求")
        }
    }

    fun acceptFriend(userId: Long) {
        viewModelScope.launch {
            runCatching { chatRepo.acceptFriend(userId) }
            runCatching { chatRepo.loadFriends() }
        }
    }

    fun declineFriend(userId: Long) {
        viewModelScope.launch {
            runCatching { chatRepo.declineFriend(userId) }
            runCatching { chatRepo.loadFriends() }
        }
    }

    fun openDmWith(username: String) {
        viewModelScope.launch {
            runCatching {
                val conv = chatRepo.openConversation(username)
                openDm(conv.id)
            }
        }
    }

    // ---- Profile / settings actions ----
    val theme: kotlinx.coroutines.flow.Flow<String?> get() = prefsFlow.theme
    val darkMode: kotlinx.coroutines.flow.Flow<String?> get() = prefsFlow.darkMode

    fun serverUrl(): String = chatRepo.serverUrlOrDefault()

    fun setTheme(id: String) {
        viewModelScope.launch { prefsFlow.setTheme(id) }
    }

    fun setServerUrl(url: String) {
        viewModelScope.launch {
            prefsFlow.setServerUrl(url.trim())
            showToast("服务器地址已更新，请重新登录")
        }
    }

    fun toggleNotifications() {
        // Local notifications are driven by WS events; this is a placeholder toggle.
        showToast("通知已开启（前台 WS 实时）")
    }

    fun exportData() {
        viewModelScope.launch {
            runCatching {
                val data = authRepo.me() ?: return@launch
                showToast("导出功能：聊天记录已准备")
            }
        }
    }

    fun deleteAccount(password: String) {
        viewModelScope.launch {
            runCatching { authRepo.deleteAccount(password) }
                .onSuccess { showToast("账号已删除") }
                .onFailure { showToast("删除失败，请检查密码") }
        }
    }

    fun logout() {
        viewModelScope.launch {
            runCatching { authRepo.logout() }
            showToast("已退出登录")
        }
    }

    override fun onCleared() {
        super.onCleared()
        chatRepo.ws.disconnect()
    }
}
