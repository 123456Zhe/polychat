package com.polychat.app.data.model

import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable

@Serializable
data class Room(
    val id: Long,
    val name: String,
    val created_at: String? = null,
    @Contextual val is_private: Boolean = false,
    val role: String? = null,
    val announcement: String? = null,
    val announcement_by: Long? = null,
    val announcement_username: String? = null,
    val announcement_updated_at: String? = null,
    val message_count: Long? = null
)

@Serializable
data class RoomsResponse(
    val rooms: List<Room>
)

@Serializable
data class RoomResponse(
    val room: Room
)

@Serializable
data class CreateRoomRequest(
    val name: String,
    @Contextual val is_private: Boolean = false
)

@Serializable
data class RoomMember(
    val id: Long,
    val username: String,
    val role: String
)

@Serializable
data class MembersResponse(
    val members: List<RoomMember>
)

@Serializable
data class AddMemberRequest(
    val username: String,
    val role: String? = null
)

@Serializable
data class InviteCode(
    val id: Long,
    val code: String,
    val max_uses: Long? = null,
    val use_count: Long = 0,
    val expires_at: Long? = null,
    val created_by_name: String? = null
)

@Serializable
data class InviteCodesResponse(
    val codes: List<InviteCode>
)

@Serializable
data class CreateInviteCodeRequest(
    val max_uses: Long? = null,
    val duration_hours: Long? = null
)

@Serializable
data class InviteCodeResponse(
    val code: InviteCode
)

@Serializable
data class JoinInviteResponse(
    @Contextual val ok: Boolean,
    val room: Room
)

@Serializable
data class Mentionable(
    val id: Long,
    val username: String
)

@Serializable
data class MentionablesResponse(
    val users: List<Mentionable>
)

@Serializable
data class PinsResponse(
    val messages: List<Message>
)

@Serializable
data class SearchResponse(
    val messages: List<Message>
)
