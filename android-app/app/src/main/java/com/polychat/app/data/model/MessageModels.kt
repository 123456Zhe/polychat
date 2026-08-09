package com.polychat.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class Mention(
    val id: Long,
    val username: String,
    val type: String = "user"
)

@Serializable
data class Reaction(
    val emoji: String,
    val count: Long = 0,
    val reacted: Boolean = false
)

@Serializable
data class Message(
    val id: Long,
    val content: String? = null,
    val created_at: String? = null,
    val edited_at: String? = null,
    val deleted_at: String? = null,
    val user_id: Long = 0,
    val username: String = "",
    val avatar_updated_at: Long? = null,
    val reply_to: Long? = null,
    val reply_content: String? = null,
    val reply_username: String? = null,
    val thread_root: Long? = null,
    val room_id: Long? = null,
    val attachment_id: Long? = null,
    val attachment_name: String? = null,
    val attachment_type: String? = null,
    val attachment_size: Long? = null,
    val attachment_stored_name: String? = null,
    val p2p_transfer_id: Long? = null,
    val p2p_sender_id: Long? = null,
    val p2p_receiver_id: Long? = null,
    val p2p_name: String? = null,
    val p2p_type: String? = null,
    val p2p_size: Long? = null,
    val p2p_sha256: String? = null,
    val p2p_status: String? = null,
    val is_deleted: Boolean = false,
    val reactions: List<Reaction> = emptyList(),
    val mentions: List<Mention> = emptyList()
) {
    val isRetracted: Boolean get() = deleted_at != null || is_deleted
    val isOwn: Boolean get() = false // filled by view layer with current user id
}

@Serializable
data class MessagesResponse(
    val messages: List<Message>,
    val has_more: Boolean = false
)

@Serializable
data class MessageResponse(
    val message: Message,
    val ok: Boolean? = null
)

@Serializable
data class SendMessageRequest(
    val content: String? = null,
    val attachment_id: Long? = null,
    val reply_to: Long? = null,
    val thread_root: Long? = null
)

@Serializable
data class EditMessageRequest(
    val content: String
)

@Serializable
data class ReactionRequest(
    val emoji: String
)

@Serializable
data class ReactionResponse(
    val reactions: List<Reaction>
)

@Serializable
data class EventsResponse(
    val cursor: Long? = null,
    val messages: List<Message> = emptyList()
)

@Serializable
data class ThreadResponse(
    val messages: List<Message>
)
