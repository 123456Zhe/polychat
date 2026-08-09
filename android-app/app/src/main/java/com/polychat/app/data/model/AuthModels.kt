package com.polychat.app.data.model

import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable

@Serializable
data class AuthResponse(
    val token: String,
    val user: User
)

@Serializable
data class OkResponse(
    @Contextual val ok: Boolean = true
)

@Serializable
data class ErrorResponse(
    val error: String = "",
    val offset: Long? = null,
    val banned_until: Long? = null
)

@Serializable
data class User(
    val id: Long,
    val number: Long = id,
    val username: String,
    @Contextual val is_admin: Boolean = false,
    val avatar_updated_at: Long? = null,
    val avatar_url: String? = null,
    val banned_until: Long? = null,
    val muted_until: Long? = null,
    val last_ip: String? = null,
    val device_fingerprint: String? = null,
    val message_count: Long? = null
)

@Serializable
data class MeResponse(
    val user: User
)
