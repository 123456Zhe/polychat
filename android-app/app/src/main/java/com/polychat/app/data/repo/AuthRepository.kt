package com.polychat.app.data.repo

import com.polychat.app.data.api.ApiService
import com.polychat.app.data.api.AvatarRequest
import com.polychat.app.data.api.RegisterRequest
import com.polychat.app.data.local.PreferencesStore
import com.polychat.app.data.model.AuthResponse
import com.polychat.app.data.model.DeleteAccountRequest
import com.polychat.app.data.model.OkResponse
import com.polychat.app.data.model.User
import com.polychat.app.data.ws.ChatWebSocketClient
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: ApiService,
    private val prefs: PreferencesStore,
    private val ws: ChatWebSocketClient
) {
    val token: Flow<String?> = prefs.token
    val username: Flow<String?> = prefs.username

    suspend fun register(username: String, password: String, fingerprint: String?): AuthResponse =
        api.register(RegisterRequest(username, password, fingerprint))

    suspend fun login(username: String, password: String, fingerprint: String?): AuthResponse =
        api.login(RegisterRequest(username, password, fingerprint))

    suspend fun saveSession(resp: AuthResponse) {
        prefs.saveSession(resp.token, resp.user.id, resp.user.username)
        ws.connect()
    }

    suspend fun logout() {
        runCatching { api.logout() }
        prefs.clearSession()
        ws.disconnect()
    }

    suspend fun me(): User? = runCatching { api.me().user }.getOrNull()

    suspend fun hasSession(): Boolean = prefs.getToken() != null

    suspend fun setAvatar(type: String, data: String): User? =
        runCatching { api.setAvatar(AvatarRequest(type, data)).user }.getOrNull()

    suspend fun removeAvatar(): User? =
        runCatching { api.removeAvatar().user }.getOrNull()

    suspend fun deleteAccount(password: String): OkResponse =
        api.deleteAccount(DeleteAccountRequest(password))
}
