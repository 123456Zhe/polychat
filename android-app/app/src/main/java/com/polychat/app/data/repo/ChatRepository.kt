package com.polychat.app.data.repo

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.polychat.app.data.api.AnnouncementRequest
import com.polychat.app.data.api.ApiService
import com.polychat.app.data.api.uploadOffset
import com.polychat.app.data.local.PreferencesStore
import com.polychat.app.data.model.*
import com.polychat.app.data.ws.ChatWebSocketClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** UI-agnostic chat state held in memory, fed by WS events and REST calls. */
@Singleton
class ChatRepository @Inject constructor(
    private val api: ApiService,
    private val prefs: PreferencesStore,
    @ApplicationContext private val context: Context,
    val ws: ChatWebSocketClient
) {
    // ---- State ----
    private val _rooms = MutableStateFlow<List<Room>>(emptyList())
    val rooms: StateFlow<List<Room>> = _rooms.asStateFlow()

    private val _conversations = MutableStateFlow<List<DmConversation>>(emptyList())
    val conversations: StateFlow<List<DmConversation>> = _conversations.asStateFlow()

    private val _friends = MutableStateFlow(FriendsResponse())
    val friends: StateFlow<FriendsResponse> = _friends.asStateFlow()

    private val _onlineUsers = MutableStateFlow<Set<Long>>(emptySet())
    val onlineUsers: StateFlow<Set<Long>> = _onlineUsers.asStateFlow()

    private val _roomMessages = MutableStateFlow<Map<Long, List<Message>>>(emptyMap())
    val roomMessages: StateFlow<Map<Long, List<Message>>> = _roomMessages.asStateFlow()

    private val _dmMessages = MutableStateFlow<Map<Long, List<Message>>>(emptyMap())
    val dmMessages: StateFlow<Map<Long, List<Message>>> = _dmMessages.asStateFlow()

    private val _roomUnread = MutableStateFlow<Map<Long, Long>>(emptyMap())
    val roomUnread: StateFlow<Map<Long, Long>> = _roomUnread.asStateFlow()

    /** Rooms with an unread message that @mentions me (red @ badge, mirrors web). */
    private val _mentionedRooms = MutableStateFlow<Set<Long>>(emptySet())
    val mentionedRooms: StateFlow<Set<Long>> = _mentionedRooms.asStateFlow()

    private val _dmUnread = MutableStateFlow<Map<Long, Long>>(emptyMap())
    val dmUnread: StateFlow<Map<Long, Long>> = _dmUnread.asStateFlow()

    private val _typingByRoom = MutableStateFlow<Map<Long, Set<Long>>>(emptyMap())
    val typingByRoom: StateFlow<Map<Long, Set<Long>>> = _typingByRoom.asStateFlow()

    val events: Flow<WsEvent> = ws.events

    // ---- Rooms ----
    suspend fun loadRooms() {
        _rooms.value = api.rooms().rooms
    }

    suspend fun createRoom(name: String, isPrivate: Boolean): Room =
        api.createRoom(CreateRoomRequest(name, isPrivate)).room

    suspend fun loadRoomMessages(roomId: Long, before: Long? = null, limit: Int = 60): List<Message> {
        val resp = api.roomMessages(roomId, before = before, limit = limit)
        _roomMessages.update { map ->
            val current = map[roomId].orEmpty()
            val known = current.map { it.id }.toSet()
            val fresh = resp.messages.filter { it.id !in known }
            map + (roomId to (fresh + current).sortedByDescending { it.id })
        }
        return resp.messages
    }

    suspend fun sendRoomMessage(roomId: Long, content: String?, attachmentId: Long?, replyTo: Long?): Message {
        val resp = api.sendRoomMessage(roomId, SendMessageRequest(content, attachmentId, replyTo))
        appendRoomMessage(roomId, resp.message)
        return resp.message
    }

    fun appendRoomMessage(roomId: Long, message: Message) {
        _roomMessages.update { map ->
            val list = map[roomId].orEmpty()
            if (list.any { it.id == message.id }) map else map + (roomId to (list + message))
        }
        // Live messages that @mention me light up the red @ badge.
        val myId = runCatching { prefs.getUserId() }.getOrNull()
        if (myId != null && message.user_id != myId && message.mentions.any { it.id == myId }) {
            _mentionedRooms.update { it + roomId }
        }
    }

    fun clearMention(roomId: Long) {
        _mentionedRooms.update { it - roomId }
    }

    suspend fun editRoomMessage(messageId: Long, content: String): Message =
        api.editMessage(messageId, EditMessageRequest(content)).message

    suspend fun deleteRoomMessage(messageId: Long) {
        api.deleteMessage(messageId)
    }

    suspend fun toggleRoomReaction(messageId: Long, emoji: String): List<Reaction> =
        api.toggleReaction(messageId, ReactionRequest(emoji)).reactions

    suspend fun loadPins(roomId: Long): List<Message> = api.roomPins(roomId).messages

    suspend fun pinMessage(roomId: Long, messageId: Long) = api.pinMessage(roomId, messageId)

    suspend fun unpinMessage(roomId: Long, messageId: Long) = api.unpinMessage(roomId, messageId)

    suspend fun loadMentionables(roomId: Long): List<Mentionable> = api.mentionables(roomId).users

    suspend fun loadMembers(roomId: Long): List<RoomMember> = api.roomMembers(roomId).members

    suspend fun addMember(roomId: Long, username: String, role: String?) = api.addMember(roomId, AddMemberRequest(username, role))

    suspend fun removeMember(roomId: Long, userId: Long) = api.removeMember(roomId, userId)

    suspend fun updateAnnouncement(roomId: Long, content: String) = api.updateAnnouncement(roomId, AnnouncementRequest(content))

    suspend fun deleteAnnouncement(roomId: Long) = api.deleteAnnouncement(roomId)

    suspend fun loadInviteCodes(roomId: Long): List<InviteCode> = api.inviteCodes(roomId).codes

    suspend fun createInviteCode(roomId: Long, maxUses: Long?, durationHours: Long?): InviteCode =
        api.createInviteCode(roomId, CreateInviteCodeRequest(maxUses, durationHours)).code

    suspend fun joinByInvite(code: String): Room = api.joinByInviteCode(code).room

    suspend fun searchMessages(q: String, roomId: Long? = null): List<Message> = api.search(q, roomId).messages

    suspend fun loadThread(rootId: Long): List<Message> = api.thread(rootId).messages

    suspend fun sendThread(roomId: Long, rootId: Long, content: String): Message =
        api.sendRoomMessage(roomId, SendMessageRequest(content, null, null, rootId)).message

    // ---- DM ----
    suspend fun loadConversations() {
        val list = api.conversations().conversations
        _conversations.value = list
        _dmUnread.value = list.associate { it.id to it.unread }.filterValues { it > 0 }
    }

    suspend fun openConversation(username: String): DmConversation = api.openConversation(OpenDmRequest(username)).conversation

    suspend fun loadDmMessages(convId: Long, before: Long? = null, limit: Int = 60): List<Message> {
        val resp = api.dmMessages(convId, before = before, limit = limit)
        _dmMessages.update { map ->
            val current = map[convId].orEmpty()
            val known = current.map { it.id }.toSet()
            val fresh = resp.messages.filter { it.id !in known }
            map + (convId to (fresh + current).sortedByDescending { it.id })
        }
        return resp.messages
    }

    suspend fun sendDm(convId: Long, content: String?, attachmentId: Long?, replyTo: Long?): Message {
        val resp = api.sendDm(convId, SendMessageRequest(content, attachmentId, replyTo))
        appendDmMessage(convId, resp.message)
        return resp.message
    }

    fun appendDmMessage(convId: Long, message: Message) {
        _dmMessages.update { map ->
            val list = map[convId].orEmpty()
            if (list.any { it.id == message.id }) map else map + (convId to (list + message))
        }
        // clear unread for the active conversation
        _dmUnread.update { it - convId }
    }

    suspend fun markDmRead(convId: Long, messageId: Long) {
        api.markRead(convId, ReadRequest(messageId))
        _dmUnread.update { it - convId }
    }

    suspend fun editDmMessage(messageId: Long, content: String): Message =
        api.editDm(messageId, EditMessageRequest(content)).message

    suspend fun deleteDmMessage(messageId: Long) = api.deleteDm(messageId)

    suspend fun toggleDmReaction(messageId: Long, emoji: String): List<Reaction> =
        api.toggleDmReaction(messageId, ReactionRequest(emoji)).reactions

    // ---- Friends ----
    suspend fun loadFriends() {
        _friends.value = api.friends()
    }

    suspend fun searchUsers(q: String): List<Friend> = api.searchUsers(q).users

    suspend fun sendFriendRequest(username: String) = api.sendFriendRequest(FriendRequest(username))

    suspend fun acceptFriend(userId: Long) = api.acceptFriend(userId)

    suspend fun declineFriend(userId: Long) = api.declineFriend(userId)

    suspend fun removeFriend(userId: Long) = api.removeFriend(userId)

    // ---- Notifications (via REST) ----
    suspend fun loadNotifications(): List<NotificationItem> = api.notifications().notifications
    suspend fun loadUnreadCount(): Long = api.unreadCount().count
    suspend fun markNotifRead(id: Long) = api.markNotifRead(id)
    suspend fun markAllNotifRead() = api.markAllNotifRead()

    // ---- Files / chunked upload ----
    /**
     * Uploads a file in 1MB chunks following the server protocol.
     * Returns the resulting attachment id.
     */
    suspend fun uploadFile(file: File, name: String, mimeType: String): Long = withContext(Dispatchers.IO) {        val total = file.length()
        val init = api.uploadInit(UploadInitRequest(name, mimeType, total))
        val sessionId = init.upload.id
        var offset = 0L
        try {
            java.io.RandomAccessFile(file, "r").use { raf ->
                while (offset < total) {
                    val chunkSize = 1024 * 1024L
                    val len = minOf(chunkSize, total - offset)
                    val bytes = ByteArray(len.toInt())
                    raf.seek(offset)
                    raf.readFully(bytes)
                    val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    val resp = try {
                        api.uploadChunk(sessionId, UploadChunkRequest(offset, b64))
                    } catch (e: Exception) {
                        // offset mismatch (409) — re-sync from server
                        val serverOffset = e.uploadOffset()
                        if (serverOffset != null) {
                            offset = serverOffset
                            raf.seek(offset)
                            raf.readFully(bytes)
                            api.uploadChunk(sessionId, UploadChunkRequest(offset, b64))
                        } else throw e
                    }
                    if (resp.completed && resp.file != null) {
                        return@withContext resp.file.id
                    }
                    offset = resp.upload?.offset ?: (offset + chunkSize)
                }
            }
            throw IOException("upload did not complete")
        } catch (e: Exception) {
            runCatching { api.cancelUpload(sessionId) }
            throw e
        }
    }

    // ---- File download ----
    /**
     * Downloads an attachment to the app cache (for opening) and persists a
     * copy to the system Downloads directory. Returns the cached file, or null
     * if the download fails (the caller surfaces the error message).
     */
    suspend fun downloadAttachment(attachmentId: Long, name: String, mimeType: String?): File? =
        withContext(Dispatchers.IO) {
            val resp = api.downloadFile(attachmentId)
            val body = resp.body()
            if (!resp.isSuccessful || body == null) throw IOException("下载失败 (${resp.code()})")
            val safeName = sanitizeFileName(name.ifBlank { "file_$attachmentId" })
            val cacheDir = File(context.cacheDir, "downloads").apply { mkdirs() }
            val cacheFile = File(cacheDir, safeName)
            body.byteStream().use { input ->
                cacheFile.outputStream().use { out -> input.copyTo(out) }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveToMediaStore(cacheFile, safeName, mimeType)
            } else {
                saveToLegacyDownloads(cacheFile, safeName)
            }
            cacheFile
        }

    private fun saveToMediaStore(source: File, name: String, mimeType: String?) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mimeType ?: "application/octet-stream")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("无法写入下载目录")
        try {
            resolver.openOutputStream(uri)?.use { out ->
                source.inputStream().use { it.copyTo(out) }
            } ?: throw IOException("无法写入下载目录")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }
    }

    @Suppress("DEPRECATION")
    private fun saveToLegacyDownloads(source: File, name: String) {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists()) dir.mkdirs()
        source.inputStream().use { input ->
            File(dir, name).outputStream().use { out -> input.copyTo(out) }
        }
    }

    private fun sanitizeFileName(name: String): String {
        val cleaned = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
        return cleaned.ifBlank { "file" }
    }

    // ---- WS helpers ----
    fun sendTyping(roomId: Long, typing: Boolean) = ws.sendTyping(roomId, typing)

    fun applyPresence(userId: Long, online: Boolean) {
        _onlineUsers.update { if (online) it + userId else it - userId }
    }

    fun applyPresenceSnapshot(ids: Set<Long>) {
        _onlineUsers.value = ids
    }

    fun clearDmUnread(conversationId: Long, readerUserId: Long) {
        // dm_read is broadcast to all clients; clearing locally is safe.
        _dmUnread.update { it - conversationId }
    }

    fun applyTyping(roomId: Long, userId: Long, typing: Boolean) {
        _typingByRoom.update { map ->
            val set = map[roomId].orEmpty()
            val newSet = if (typing) set + userId else set - userId
            if (newSet.isEmpty()) map - roomId else map + (roomId to newSet)
        }
    }

    // ---- Admin ----
    suspend fun adminOverview(): AdminOverview = api.adminOverview()

    suspend fun adminSetAdmin(userId: Long, isAdmin: Boolean) =
        api.setAdmin(userId, com.polychat.app.data.model.AdminSetRequest(isAdmin))

    suspend fun adminBanUser(userId: Long) =
        api.banUser(userId, com.polychat.app.data.model.AdminDurationRequest(24))

    suspend fun adminMuteUser(userId: Long) =
        api.muteUser(userId, com.polychat.app.data.model.AdminDurationRequest(1))

    suspend fun adminBannedIps(): List<BannedIp> = api.bannedIps().ips

    suspend fun adminUnbanIp(ip: String) = api.unbanIp(UnbanIpRequest(ip))

    suspend fun adminBotRequests(): List<BotRequest> = api.botRequests().requests

    suspend fun adminBotTokens(): List<BotToken> = api.botTokens().tokens

    suspend fun adminReviewBotRequest(id: Long, status: String) = api.reviewBotRequest(id, ReviewBotRequest(status))

    suspend fun adminRevokeBotToken(token: String) = api.revokeBotToken(token)

    // ---- Convenience accessors for UI ----
    suspend fun serverUrlOrNull(): String? = prefs.getServerUrl()

    fun serverUrlOrDefault(): String =
        runCatching { prefs.getServerUrl() }.getOrNull() ?: com.polychat.app.data.api.ApiClient.DEFAULT_SERVER_URL

    fun roomName(roomId: Long): String? = _rooms.value.firstOrNull { it.id == roomId }?.name

    fun roomSubtitle(roomId: Long): String {
        val room = _rooms.value.firstOrNull { it.id == roomId } ?: return ""
        val online = _onlineUsers.value.count()
        return if (room.is_private) "🔒 私有 · $online 在线" else "$online 人在线"
    }

    fun convName(convId: Long): String? = _conversations.value.firstOrNull { it.id == convId }?.peer?.username

    fun setCurrentUserIsAdmin(isAdmin: Boolean) { /* UI caches from /api/me */ }
}
