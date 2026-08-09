package com.polychat.app.data.model

import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable

@Serializable
data class AdminStats(
    val users: Long = 0,
    val rooms: Long = 0,
    val messages: Long = 0,
    val files: Long = 0
)

@Serializable
data class AdminUser(
    val id: Long,
    val username: String,
    @Contextual val is_admin: Boolean = false,
    val banned_until: Long? = null,
    val muted_until: Long? = null,
    val last_ip: String? = null,
    val device_fingerprint: String? = null,
    val message_count: Long? = null
)

@Serializable
data class AdminOverview(
    val stats: AdminStats = AdminStats(),
    val users: List<AdminUser> = emptyList()
)

@Serializable
data class AdminSetRequest(
    @Contextual val is_admin: Boolean = false
)

@Serializable
data class AdminDurationRequest(
    val duration_hours: Long = 24
)

@Serializable
data class AuditLog(
    val id: Long,
    val admin_id: Long? = null,
    val action: String = "",
    val target_user_id: Long? = null,
    val details: String? = null,
    val created_at: String? = null,
    val admin_name: String? = null,
    val target_name: String? = null
)

@Serializable
data class AuditLogsResponse(
    val logs: List<AuditLog>
)

@Serializable
data class BannedIp(
    val ip_address: String,
    val banned_until: Long? = null,
    val reason: String? = null,
    val created_by: Long? = null,
    val admin_name: String? = null
)

@Serializable
data class BannedIpsResponse(
    val ips: List<BannedIp>
)

@Serializable
data class BanIpRequest(
    val ip: String,
    val duration_hours: Long? = null,
    val reason: String? = null
)

@Serializable
data class UnbanIpRequest(
    val ip: String
)

@Serializable
data class BannedFingerprint(
    val fingerprint: String,
    val banned_until: Long? = null,
    val reason: String? = null,
    val created_by: Long? = null,
    val admin_name: String? = null
)

@Serializable
data class BannedFingerprintsResponse(
    val fingerprints: List<BannedFingerprint>
)

@Serializable
data class BanFingerprintRequest(
    val fingerprint: String,
    val duration_hours: Long? = null,
    val reason: String? = null
)

@Serializable
data class UnbanFingerprintRequest(
    val fingerprint: String
)

@Serializable
data class BotRequest(
    val id: Long,
    val user_id: Long = 0,
    val name: String = "",
    val reason: String = "",
    val status: String = "pending",
    val username: String? = null,
    val created_at: String? = null,
    val reviewed_at: String? = null
)

@Serializable
data class BotRequestsResponse(
    val requests: List<BotRequest>
)

@Serializable
data class CreateBotRequest(
    val name: String,
    val reason: String? = null
)

@Serializable
data class ReviewBotRequest(
    val status: String
)

@Serializable
data class BotToken(
    val token: String,
    val name: String = "",
    val created_at: String? = null,
    val user_id: Long? = null,
    val username: String? = null
)

@Serializable
data class BotTokensResponse(
    val tokens: List<BotToken>
)

@Serializable
data class CreateBotTokenRequest(
    val user_id: Long,
    val name: String? = null
)

@Serializable
data class CreateBotTokenResponse(
    val token: BotToken
)
