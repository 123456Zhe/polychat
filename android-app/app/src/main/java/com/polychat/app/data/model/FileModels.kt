package com.polychat.app.data.model

import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable

@Serializable
data class UploadInitRequest(
    val name: String,
    val type: String,
    val size: Long
)

@Serializable
data class UploadState(
    val id: String,
    val name: String? = null,
    val type: String? = null,
    val size: Long = 0,
    val offset: Long = 0,
    val chunk_size: Long = 1048576,
    val expires_at: Long? = null
)

@Serializable
data class UploadResponse(
    val upload: UploadState
)

@Serializable
data class UploadChunkRequest(
    val offset: Long,
    val data: String // base64
)

@Serializable
data class UploadFile(
    val id: Long,
    val name: String,
    val type: String,
    val size: Long,
    val url: String? = null
)

@Serializable
data class UploadComplete(
    @Contextual val completed: Boolean = false,
    val file: UploadFile? = null,
    val upload: UploadState? = null
)

@Serializable
data class LegacyFileRequest(
    val name: String,
    val type: String,
    val data: String // base64
)

@Serializable
data class FileResponse(
    val file: UploadFile
)

@Serializable
data class P2pConfig(
    val ice_servers: List<kotlinx.serialization.json.JsonObject> = emptyList(),
    val min_size: Long = 5 * 1024 * 1024,
    val connect_timeout_ms: Long = 30000
)

@Serializable
data class P2pTransfer(
    val id: Long,
    val conversation_id: Long = 0,
    val sender_id: Long = 0,
    val receiver_id: Long = 0,
    val name: String = "",
    val type: String = "",
    val size: Long = 0,
    val status: String = "pending",
    val sha256: String? = null,
    val created_at: String? = null,
    @Contextual val peer_online: Boolean = false
)

@Serializable
data class P2pTransferResponse(
    val transfer: P2pTransfer
)

@Serializable
data class CreateP2pRequest(
    val conversation_id: Long,
    val name: String,
    val type: String,
    val size: Long,
    val content: String? = null,
    val reply_to: Long? = null
)

@Serializable
data class P2pCompleteRequest(
    val sha256: String? = null
)

@Serializable
data class P2pCompleteResponse(
    val transfer: P2pTransfer? = null,
    val message: Message? = null
)
