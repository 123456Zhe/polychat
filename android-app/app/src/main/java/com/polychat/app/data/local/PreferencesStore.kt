package com.polychat.app.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "polychat")

/**
 * Session/settings persistence. DataStore reads are suspend; hot fields
 * (token, serverUrl) are mirrored in memory so OkHttp interceptors and the
 * WebSocket client can read them synchronously.
 */
@Singleton
class PreferencesStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private object Keys {
        val TOKEN = stringPreferencesKey("token")
        val USER_ID = longPreferencesKey("user_id")
        val USERNAME = stringPreferencesKey("username")
        val SERVER_URL = stringPreferencesKey("server_url")
        val THEME = stringPreferencesKey("theme")
        val DARK_MODE = stringPreferencesKey("dark_mode")
    }

    // In-memory cache (loaded lazily) for synchronous access.
    @Volatile private var cachedToken: String? = null
    @Volatile private var cachedUserId: Long? = null
    @Volatile private var cachedUsername: String? = null
    @Volatile private var cachedServerUrl: String? = null
    private var cacheLoaded = false

    private val prefs: DataStore<Preferences> get() = context.dataStore

    // ---- Flows (for Compose observers) ----
    val token: Flow<String?> = prefs.data.map { it[Keys.TOKEN] }
    val userId: Flow<Long?> = prefs.data.map { it[Keys.USER_ID] }
    val username: Flow<String?> = prefs.data.map { it[Keys.USERNAME] }
    val serverUrl: Flow<String?> = prefs.data.map { it[Keys.SERVER_URL] }
    val theme: Flow<String?> = prefs.data.map { it[Keys.THEME] }
    val darkMode: Flow<String?> = prefs.data.map { it[Keys.DARK_MODE] }

    // ---- Synchronous access (for interceptors / WS) ----
    fun getToken(): String? {
        ensureCache()
        return cachedToken
    }

    fun getServerUrl(): String? {
        ensureCache()
        return cachedServerUrl
    }

    fun getUserId(): Long? {
        ensureCache()
        return cachedUserId
    }

    private fun ensureCache() {
        if (cacheLoaded) return
        synchronized(this) {
            if (cacheLoaded) return
            runBlocking {
                val d = prefs.data.first()
                cachedToken = d[Keys.TOKEN]
                cachedUserId = d[Keys.USER_ID]
                cachedUsername = d[Keys.USERNAME]
                cachedServerUrl = d[Keys.SERVER_URL]
            }
            cacheLoaded = true
        }
    }

    suspend fun saveSession(token: String, userId: Long, username: String) {
        prefs.edit { p ->
            p[Keys.TOKEN] = token
            p[Keys.USER_ID] = userId
            p[Keys.USERNAME] = username
        }
        cachedToken = token
        cachedUserId = userId
        cachedUsername = username
    }

    suspend fun setServerUrl(url: String) {
        prefs.edit { it[Keys.SERVER_URL] = url }
        cachedServerUrl = url
    }

    suspend fun setTheme(id: String) {
        prefs.edit { it[Keys.THEME] = id }
    }

    suspend fun setDarkMode(mode: String) {
        prefs.edit { it[Keys.DARK_MODE] = mode }
    }

    suspend fun clearSession() {
        prefs.edit { p ->
            p.remove(Keys.TOKEN)
            p.remove(Keys.USER_ID)
            p.remove(Keys.USERNAME)
        }
        cachedToken = null
        cachedUserId = null
        cachedUsername = null
    }
}
