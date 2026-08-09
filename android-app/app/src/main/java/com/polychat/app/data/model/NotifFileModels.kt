package com.polychat.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class NotificationItem(
    val id: Long,
    val type: String = "system",
    val title: String = "",
    val content: String = "",
    val link: String? = null,
    val data: JsonElement? = null,
    val is_read: Boolean = false,
    val created_at: String? = null
)

@Serializable
data class NotificationsResponse(
    val notifications: List<NotificationItem>
)

@Serializable
data class UnreadCountResponse(
    val count: Long
)

@Serializable
data class PushVapidKey(
    val publicKey: String
)

@Serializable
data class PushKeys(
    val p256dh: String,
    val auth: String
)

@Serializable
data class PushSubscriptionRequest(
    val endpoint: String,
    val keys: PushKeys
)

@Serializable
data class ExportResponse(
    val user: User? = null,
    val export_date: String? = null,
    val message_count: Long? = null,
    val messages: List<ExportMessage> = emptyList()
)

@Serializable
data class ExportMessage(
    val room: String? = null,
    val content: String? = null,
    val attachment: String? = null,
    val created_at: String? = null,
    val edited_at: String? = null,
    val is_deleted: Boolean = false
)

@Serializable
data class DeleteAccountRequest(
    val password: String
)
