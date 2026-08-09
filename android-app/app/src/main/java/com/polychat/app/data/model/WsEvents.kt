package com.polychat.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * WebSocket events pushed by the server at /ws.
 * Field names match the server's broadcast payloads exactly.
 */
sealed class WsEvent {
    data class Ready(val type: String = "ready") : WsEvent()

    data class PresenceSnapshot(val users: List<UserLite> = emptyList()) : WsEvent()

    data class Presence(
        val user_id: Long,
        val username: String,
        val online: Boolean
    ) : WsEvent()

    data class Typing(
        val room_id: Long,
        val user_id: Long,
        val username: String,
        val typing: Boolean
    ) : WsEvent()

    data class Rooms(val type: String = "rooms") : WsEvent()

    data class Announcement(val room_id: Long) : WsEvent()

    data class Message(
        val room_id: Long,
        val message_id: Long,
        val thread_root: Long? = null,
        val message: com.polychat.app.data.model.Message? = null
    ) : WsEvent()

    data class ThreadMessage(
        val room_id: Long,
        val message_id: Long,
        val thread_root: Long? = null,
        val message: com.polychat.app.data.model.Message? = null
    ) : WsEvent()

    data class MessageUpdate(
        val room_id: Long,
        val message_id: Long
    ) : WsEvent()

    data class Pins(val room_id: Long) : WsEvent()

    data class DmMessage(
        val conversation_id: Long,
        val message: com.polychat.app.data.model.Message
    ) : WsEvent()

    data class DmMessageUpdate(
        val conversation_id: Long,
        val message_id: Long
    ) : WsEvent()

    data class DmRead(
        val conversation_id: Long,
        val user_id: Long,
        val message_id: Long
    ) : WsEvent()

    data class FriendRequest(
        val from: Friend? = null,
        val user_id: Long
    ) : WsEvent()

    data class FriendAccept(
        val user_id: Long,
        val friend: Friend
    ) : WsEvent()

    data class FriendRemove(
        val user_id: Long,
        val friend_id: Long
    ) : WsEvent()

    data class Notification(val notification: NotificationItem) : WsEvent()

    data class P2pInvite(
        val transfer: P2pTransfer,
        val sender_username: String
    ) : WsEvent()

    data class P2pAccepted(val transfer_id: Long) : WsEvent()
    data class P2pRejected(val transfer_id: Long) : WsEvent()
    data class P2pCanceled(val transfer_id: Long) : WsEvent()
    data class P2pSignal(
        val transfer_id: Long,
        val from_user_id: Long,
        val data: JsonElement
    ) : WsEvent()

    data class Unknown(val type: String, val raw: JsonElement) : WsEvent()
}

@Serializable
data class UserLite(
    val id: Long,
    val username: String
)
