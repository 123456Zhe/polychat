package com.polychat.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class DmConversation(
    val id: Long,
    val peer: User? = null,
    val last_message: Message? = null,
    val unread: Long = 0
)

@Serializable
data class ConversationsResponse(
    val conversations: List<DmConversation>
)

@Serializable
data class ConversationResponse(
    val conversation: DmConversation
)

@Serializable
data class OpenDmRequest(
    val username: String
)

@Serializable
data class ReadRequest(
    val message_id: Long
)

@Serializable
data class Friend(
    val id: Long,
    val username: String,
    val is_admin: Boolean = false,
    val avatar_updated_at: Long? = null,
    val avatar_url: String? = null,
    val banned_until: Long? = null,
    val muted_until: Long? = null
)

@Serializable
data class FriendsResponse(
    val accepted: List<Friend> = emptyList(),
    val incoming: List<Friend> = emptyList(),
    val outgoing: List<Friend> = emptyList()
)

@Serializable
data class UserSearchResponse(
    val users: List<Friend>
)

@Serializable
data class FriendRequest(
    val username: String
)

@Serializable
data class FriendResponse(
    val friend: Friend
)
