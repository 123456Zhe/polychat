package com.polychat.app.data.api

import com.polychat.app.data.model.*
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

/**
 * REST API surface — mirrors server.mjs endpoints. All endpoints use
 * Authorization: Bearer <token> via AuthInterceptor.
 */
interface ApiService {

    // ---- Auth ----
    @POST("api/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    @POST("api/login")
    suspend fun login(@Body body: RegisterRequest): AuthResponse

    @POST("api/logout")
    suspend fun logout(): OkResponse

    @GET("api/me")
    suspend fun me(): MeResponse

    @POST("api/me/avatar")
    suspend fun setAvatar(@Body body: AvatarRequest): MeResponse

    @DELETE("api/me/avatar")
    suspend fun removeAvatar(): MeResponse

    @GET("api/me/export")
    suspend fun exportData(): ExportResponse

    @DELETE("api/me")
    suspend fun deleteAccount(@Body body: DeleteAccountRequest): OkResponse

    // ---- Rooms ----
    @GET("api/rooms")
    suspend fun rooms(): RoomsResponse

    @POST("api/rooms")
    suspend fun createRoom(@Body body: CreateRoomRequest): RoomResponse

    @PUT("api/rooms/{id}")
    suspend fun renameRoom(@Path("id") id: Long, @Body body: CreateRoomRequest): RoomResponse

    @DELETE("api/rooms/{id}")
    suspend fun deleteRoom(@Path("id") id: Long): OkResponse

    @GET("api/rooms/{id}/messages")
    suspend fun roomMessages(
        @Path("id") id: Long,
        @Query("after") after: Long? = null,
        @Query("before") before: Long? = null,
        @Query("limit") limit: Int = 60
    ): MessagesResponse

    @POST("api/rooms/{id}/messages")
    suspend fun sendRoomMessage(@Path("id") id: Long, @Body body: SendMessageRequest): MessageResponse

    @GET("api/rooms/{id}/pins")
    suspend fun roomPins(@Path("id") id: Long): PinsResponse

    @PUT("api/rooms/{id}/pins/{messageId}")
    suspend fun pinMessage(@Path("id") id: Long, @Path("messageId") messageId: Long): OkResponse

    @DELETE("api/rooms/{id}/pins/{messageId}")
    suspend fun unpinMessage(@Path("id") id: Long, @Path("messageId") messageId: Long): OkResponse

    @GET("api/rooms/{id}/announcement")
    suspend fun roomAnnouncement(@Path("id") id: Long): MessageResponse

    @PUT("api/rooms/{id}/announcement")
    suspend fun updateAnnouncement(@Path("id") id: Long, @Body body: AnnouncementRequest): OkResponse

    @DELETE("api/rooms/{id}/announcement")
    suspend fun deleteAnnouncement(@Path("id") id: Long): OkResponse

    @GET("api/rooms/{id}/members")
    suspend fun roomMembers(@Path("id") id: Long): MembersResponse

    @POST("api/rooms/{id}/members")
    suspend fun addMember(@Path("id") id: Long, @Body body: AddMemberRequest): MessageResponse

    @DELETE("api/rooms/{id}/members/{userId}")
    suspend fun removeMember(@Path("id") id: Long, @Path("userId") userId: Long): OkResponse

    @GET("api/rooms/{id}/mentionables")
    suspend fun mentionables(@Path("id") id: Long): MentionablesResponse

    @GET("api/rooms/{id}/invite-codes")
    suspend fun inviteCodes(@Path("id") id: Long): InviteCodesResponse

    @POST("api/rooms/{id}/invite-codes")
    suspend fun createInviteCode(@Path("id") id: Long, @Body body: CreateInviteCodeRequest): InviteCodeResponse

    @DELETE("api/rooms/{id}/invite-codes/{codeId}")
    suspend fun deleteInviteCode(@Path("id") id: Long, @Path("codeId") codeId: Long): OkResponse

    @POST("api/invite/{code}")
    suspend fun joinByInviteCode(@Path("code") code: String): JoinInviteResponse

    @GET("api/search")
    suspend fun search(@Query("q") q: String, @Query("room_id") roomId: Long? = null): SearchResponse

    @GET("api/events")
    suspend fun events(@Query("after") after: Long? = null, @Query("bootstrap") bootstrap: Int? = null): EventsResponse

    @GET("api/messages/{id}")
    suspend fun message(@Path("id") id: Long): MessageResponse

    @GET("api/messages/{id}/thread")
    suspend fun thread(@Path("id") id: Long): ThreadResponse

    @PUT("api/messages/{id}")
    suspend fun editMessage(@Path("id") id: Long, @Body body: EditMessageRequest): MessageResponse

    @DELETE("api/messages/{id}")
    suspend fun deleteMessage(@Path("id") id: Long): OkResponse

    @POST("api/messages/{id}/reactions")
    suspend fun toggleReaction(@Path("id") id: Long, @Body body: ReactionRequest): ReactionResponse

    // ---- DM ----
    @GET("api/dm/conversations")
    suspend fun conversations(): ConversationsResponse

    @POST("api/dm/conversations")
    suspend fun openConversation(@Body body: OpenDmRequest): ConversationResponse

    @GET("api/dm/conversations/{id}/messages")
    suspend fun dmMessages(
        @Path("id") id: Long,
        @Query("after") after: Long? = null,
        @Query("before") before: Long? = null,
        @Query("limit") limit: Int = 60
    ): MessagesResponse

    @POST("api/dm/conversations/{id}/messages")
    suspend fun sendDm(@Path("id") id: Long, @Body body: SendMessageRequest): MessageResponse

    @POST("api/dm/conversations/{id}/read")
    suspend fun markRead(@Path("id") id: Long, @Body body: ReadRequest): OkResponse

    @PUT("api/dm/messages/{id}")
    suspend fun editDm(@Path("id") id: Long, @Body body: EditMessageRequest): MessageResponse

    @DELETE("api/dm/messages/{id}")
    suspend fun deleteDm(@Path("id") id: Long): OkResponse

    @POST("api/dm/messages/{id}/reactions")
    suspend fun toggleDmReaction(@Path("id") id: Long, @Body body: ReactionRequest): ReactionResponse

    // ---- Friends ----
    @GET("api/friends")
    suspend fun friends(): FriendsResponse

    @GET("api/users/search")
    suspend fun searchUsers(@Query("q") q: String): UserSearchResponse

    @POST("api/friends/request")
    suspend fun sendFriendRequest(@Body body: FriendRequest): FriendResponse

    @POST("api/friends/{id}/accept")
    suspend fun acceptFriend(@Path("id") id: Long): FriendResponse

    @POST("api/friends/{id}/decline")
    suspend fun declineFriend(@Path("id") id: Long): OkResponse

    @DELETE("api/friends/{id}")
    suspend fun removeFriend(@Path("id") id: Long): OkResponse

    // ---- Files ----
    @POST("api/uploads")
    suspend fun uploadInit(@Body body: UploadInitRequest): UploadResponse

    @GET("api/uploads/{id}")
    suspend fun uploadState(@Path("id") id: String): UploadResponse

    @PUT("api/uploads/{id}/chunks")
    suspend fun uploadChunk(@Path("id") id: String, @Body body: UploadChunkRequest): UploadComplete

    @DELETE("api/uploads/{id}")
    suspend fun cancelUpload(@Path("id") id: String): OkResponse

    @POST("api/files")
    suspend fun uploadLegacy(@Body body: LegacyFileRequest): FileResponse

    /** Streams attachment bytes (Authorization attached by AuthInterceptor). */
    @Streaming
    @GET("api/files/{id}")
    suspend fun downloadFile(@Path("id") id: Long): Response<ResponseBody>

    @GET("api/p2p/config")
    suspend fun p2pConfig(): P2pConfig

    @POST("api/p2p/transfers")
    suspend fun createP2p(@Body body: CreateP2pRequest): P2pTransferResponse

    @GET("api/p2p/transfers/{id}")
    suspend fun p2pTransfer(@Path("id") id: Long): P2pTransferResponse

    @POST("api/p2p/transfers/{id}/accept")
    suspend fun acceptP2p(@Path("id") id: Long): P2pTransferResponse

    @POST("api/p2p/transfers/{id}/reject")
    suspend fun rejectP2p(@Path("id") id: Long): P2pTransferResponse

    @POST("api/p2p/transfers/{id}/cancel")
    suspend fun cancelP2p(@Path("id") id: Long): P2pTransferResponse

    @POST("api/p2p/transfers/{id}/complete")
    suspend fun completeP2p(@Path("id") id: Long, @Body body: P2pCompleteRequest): P2pCompleteResponse

    @POST("api/p2p/transfers/{id}/fail")
    suspend fun failP2p(@Path("id") id: Long, @Body body: P2pCompleteRequest): P2pTransferResponse

    // ---- Notifications ----
    @GET("api/notifications")
    suspend fun notifications(@Query("unread") unread: Int? = null): NotificationsResponse

    @GET("api/notifications/unread-count")
    suspend fun unreadCount(): UnreadCountResponse

    @PUT("api/notifications/{id}/read")
    suspend fun markNotifRead(@Path("id") id: Long): OkResponse

    @POST("api/notifications/read-all")
    suspend fun markAllNotifRead(): OkResponse

    // ---- Push ----
    @GET("api/push/vapid-public-key")
    suspend fun vapidKey(): PushVapidKey

    @POST("api/push/subscriptions")
    suspend fun subscribePush(@Body body: PushSubscriptionRequest): OkResponse

    @DELETE("api/push/subscriptions")
    suspend fun unsubscribePush(@Body body: PushSubscriptionRequest): OkResponse

    // ---- Bot requests (user) ----
    @POST("api/bot-requests")
    suspend fun createBotRequest(@Body body: CreateBotRequest): OkResponse

    // ---- Admin ----
    @GET("api/admin/overview")
    suspend fun adminOverview(): AdminOverview

    @PUT("api/admin/users/{id}/admin")
    suspend fun setAdmin(@Path("id") id: Long, @Body body: AdminSetRequest): MessageResponse

    @PUT("api/admin/users/{id}/ban")
    suspend fun banUser(@Path("id") id: Long, @Body body: AdminDurationRequest): MessageResponse

    @PUT("api/admin/users/{id}/unban")
    suspend fun unbanUser(@Path("id") id: Long): MessageResponse

    @PUT("api/admin/users/{id}/mute")
    suspend fun muteUser(@Path("id") id: Long, @Body body: AdminDurationRequest): MessageResponse

    @PUT("api/admin/users/{id}/unmute")
    suspend fun unmuteUser(@Path("id") id: Long): MessageResponse

    @GET("api/admin/audit-logs")
    suspend fun auditLogs(): AuditLogsResponse

    @GET("api/admin/banned-ips")
    suspend fun bannedIps(): BannedIpsResponse

    @PUT("api/admin/banned-ips/ban")
    suspend fun banIp(@Body body: BanIpRequest): OkResponse

    @PUT("api/admin/banned-ips/unban")
    suspend fun unbanIp(@Body body: UnbanIpRequest): OkResponse

    @GET("api/admin/banned-fingerprints")
    suspend fun bannedFingerprints(): BannedFingerprintsResponse

    @PUT("api/admin/banned-fingerprints/ban")
    suspend fun banFingerprint(@Body body: BanFingerprintRequest): OkResponse

    @PUT("api/admin/banned-fingerprints/unban")
    suspend fun unbanFingerprint(@Body body: UnbanFingerprintRequest): OkResponse

    @GET("api/admin/bot/tokens")
    suspend fun botTokens(): BotTokensResponse

    @POST("api/admin/bot/tokens")
    suspend fun createBotToken(@Body body: CreateBotTokenRequest): CreateBotTokenResponse

    @DELETE("api/admin/bot/tokens/{token}")
    suspend fun revokeBotToken(@Path("token") token: String): OkResponse

    @GET("api/admin/bot-requests")
    suspend fun botRequests(): BotRequestsResponse

    @PUT("api/admin/bot-requests/{id}")
    suspend fun reviewBotRequest(@Path("id") id: Long, @Body body: ReviewBotRequest): OkResponse
}

@kotlinx.serialization.Serializable
data class RegisterRequest(
    val username: String,
    val password: String,
    val fingerprint: String? = null
)

@kotlinx.serialization.Serializable
data class AvatarRequest(
    val type: String,
    val data: String
)

@kotlinx.serialization.Serializable
data class AnnouncementRequest(
    val content: String
)
