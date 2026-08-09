package com.polychat.app.data.ws

import com.polychat.app.data.local.PreferencesStore
import com.polychat.app.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.booleanOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min

/**
 * Real-time channel to the server /ws endpoint. Emits parsed [WsEvent]s.
 * Authentication: ?token= query param (supported by server) or Bearer header.
 */
@Singleton
class ChatWebSocketClient @Inject constructor(
    private val prefs: PreferencesStore
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 128)
    val events: SharedFlow<WsEvent> = _events

    private var webSocket: WebSocket? = null
    private var reconnectAttempts = 0
    private val reconnectDelayMs = 1000L
    private var shouldReconnect = false

    @Volatile var isConnected: Boolean = false
        private set

    fun connect() {
        shouldReconnect = true
        openSocket()
    }

    private fun openSocket() {
        val token = runCatching { prefs.getToken() }.getOrNull()
        if (token == null) return
        val url = prefs.getServerUrl()?.trim()?.trimEnd('/') ?: ""
        if (url.isEmpty()) return
        val wsUrl = if (url.startsWith("https")) url.replaceFirst("https", "wss") else url.replaceFirst("http", "ws")
        val fullUrl = "$wsUrl/ws?token=${java.net.URLEncoder.encode(token, "UTF-8")}"

        val request = Request.Builder().url(fullUrl).build()
        val client = OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS) // server sends ping every 30s; pong handled automatically
            .connectTimeout(20, TimeUnit.SECONDS)
            .build()

        try {
            webSocket = client.newWebSocket(request, listener)
        } catch (e: Exception) {
            scheduleReconnect()
        }
    }

    fun send(jsonText: String) {
        webSocket?.send(jsonText)
    }

    fun sendTyping(roomId: Long, typing: Boolean) {
        send("""{"type":"typing","room_id":$roomId,"typing":$typing}""")
    }

    fun sendP2pSignal(transferId: Long, toUserId: Long, data: JsonElement) {
        send("""{"type":"p2p_signal","transfer_id":$transferId,"to_user_id":$toUserId,"data":${data}}""")
    }

    fun disconnect() {
        shouldReconnect = false
        webSocket?.close(1000, "client disconnect")
        webSocket = null
        isConnected = false
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        reconnectAttempts++
        val delayMs = reconnectDelayMs * min(reconnectAttempts, 5)
        GlobalScope.launch(Dispatchers.IO) {
            delay(delayMs)
            if (shouldReconnect) openSocket()
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            isConnected = true
            reconnectAttempts = 0
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val event = runCatching { parseEvent(text) }.getOrNull()
            if (event != null) {
                _events.tryEmit(event)
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            // Binary frames not expected from server.
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            isConnected = false
            if (shouldReconnect) scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            isConnected = false
            if (shouldReconnect) scheduleReconnect()
        }
    }

    private fun parseEvent(text: String): WsEvent? {
        val obj: JsonObject = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: return null
        return when (type) {
            "ready" -> WsEvent.Ready()
            "presence_snapshot" -> {
                val users = obj["users"]?.let { el ->
                    runCatching { json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(com.polychat.app.data.model.UserLite.serializer()), el) }.getOrNull()
                } ?: emptyList()
                WsEvent.PresenceSnapshot(users)
            }
            "presence" -> WsEvent.Presence(
                user_id = obj["user_id"]?.jsonPrimitive?.longOrNull ?: 0,
                username = obj["username"]?.jsonPrimitive?.contentOrNull ?: "",
                online = obj["online"]?.jsonPrimitive?.booleanOrNull ?: false
            )
            "typing" -> WsEvent.Typing(
                room_id = obj["room_id"]?.jsonPrimitive?.longOrNull ?: 0,
                user_id = obj["user_id"]?.jsonPrimitive?.longOrNull ?: 0,
                username = obj["username"]?.jsonPrimitive?.contentOrNull ?: "",
                typing = obj["typing"]?.jsonPrimitive?.booleanOrNull ?: false
            )
            "rooms" -> WsEvent.Rooms()
            "announcement" -> WsEvent.Announcement(obj["room_id"]?.jsonPrimitive?.longOrNull ?: 0)
            "message" -> WsEvent.Message(
                room_id = obj["room_id"]?.jsonPrimitive?.longOrNull ?: 0,
                message_id = obj["message_id"]?.jsonPrimitive?.longOrNull ?: 0,
                thread_root = obj["thread_root"]?.jsonPrimitive?.longOrNull,
                message = decodeMessage(obj["message"])
            )
            "thread_message" -> WsEvent.ThreadMessage(
                room_id = obj["room_id"]?.jsonPrimitive?.longOrNull ?: 0,
                message_id = obj["message_id"]?.jsonPrimitive?.longOrNull ?: 0,
                thread_root = obj["thread_root"]?.jsonPrimitive?.longOrNull,
                message = decodeMessage(obj["message"])
            )
            "message_update" -> WsEvent.MessageUpdate(
                room_id = obj["room_id"]?.jsonPrimitive?.longOrNull ?: 0,
                message_id = obj["message_id"]?.jsonPrimitive?.longOrNull ?: 0
            )
            "pins" -> WsEvent.Pins(obj["room_id"]?.jsonPrimitive?.longOrNull ?: 0)
            "dm_message" -> WsEvent.DmMessage(
                conversation_id = obj["conversation_id"]?.jsonPrimitive?.longOrNull ?: 0,
                message = decodeMessage(obj["message"]) ?: return null
            )
            "dm_message_update" -> WsEvent.DmMessageUpdate(
                conversation_id = obj["conversation_id"]?.jsonPrimitive?.longOrNull ?: 0,
                message_id = obj["message_id"]?.jsonPrimitive?.longOrNull ?: 0
            )
            "dm_read" -> WsEvent.DmRead(
                conversation_id = obj["conversation_id"]?.jsonPrimitive?.longOrNull ?: 0,
                user_id = obj["user_id"]?.jsonPrimitive?.longOrNull ?: 0,
                message_id = obj["message_id"]?.jsonPrimitive?.longOrNull ?: 0
            )
            "friend_request" -> WsEvent.FriendRequest(
                from = decodeFriend(obj["from"]),
                user_id = obj["user_id"]?.jsonPrimitive?.longOrNull ?: 0
            )
            "friend_accept" -> WsEvent.FriendAccept(
                user_id = obj["user_id"]?.jsonPrimitive?.longOrNull ?: 0,
                friend = decodeFriend(obj["friend"]) ?: return null
            )
            "friend_remove" -> WsEvent.FriendRemove(
                user_id = obj["user_id"]?.jsonPrimitive?.longOrNull ?: 0,
                friend_id = obj["friend_id"]?.jsonPrimitive?.longOrNull ?: 0
            )
            "notification" -> WsEvent.Notification(
                notification = runCatching {
                    json.decodeFromJsonElement(com.polychat.app.data.model.NotificationItem.serializer(), obj["notification"]!!)
                }.getOrNull() ?: return null
            )
            "p2p_invite" -> WsEvent.P2pInvite(
                transfer = runCatching {
                    json.decodeFromJsonElement(com.polychat.app.data.model.P2pTransfer.serializer(), obj["transfer"]!!)
                }.getOrNull() ?: return null,
                sender_username = obj["sender_username"]?.jsonPrimitive?.contentOrNull ?: ""
            )
            "p2p_accepted" -> WsEvent.P2pAccepted(obj["transfer_id"]?.jsonPrimitive?.longOrNull ?: 0)
            "p2p_rejected" -> WsEvent.P2pRejected(obj["transfer_id"]?.jsonPrimitive?.longOrNull ?: 0)
            "p2p_canceled" -> WsEvent.P2pCanceled(obj["transfer_id"]?.jsonPrimitive?.longOrNull ?: 0)
            "p2p_signal" -> WsEvent.P2pSignal(
                transfer_id = obj["transfer_id"]?.jsonPrimitive?.longOrNull ?: 0,
                from_user_id = obj["from_user_id"]?.jsonPrimitive?.longOrNull ?: 0,
                data = obj["data"] ?: return null
            )
            else -> WsEvent.Unknown(type, obj)
        }
    }

    private fun decodeMessage(el: JsonElement?): com.polychat.app.data.model.Message? {
        if (el == null) return null
        return runCatching { json.decodeFromJsonElement(com.polychat.app.data.model.Message.serializer(), el) }.getOrNull()
    }

    private fun decodeFriend(el: JsonElement?): com.polychat.app.data.model.Friend? {
        if (el == null) return null
        return runCatching { json.decodeFromJsonElement(com.polychat.app.data.model.Friend.serializer(), el) }.getOrNull()
    }
}
