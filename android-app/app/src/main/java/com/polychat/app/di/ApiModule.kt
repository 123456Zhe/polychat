package com.polychat.app.di

import android.content.Context
import com.polychat.app.data.api.ApiClient
import com.polychat.app.data.api.ApiService
import com.polychat.app.data.local.PreferencesStore
import com.polychat.app.data.repo.AuthRepository
import com.polychat.app.data.repo.ChatRepository
import com.polychat.app.data.repo.NotificationsRepository
import com.polychat.app.data.ws.ChatWebSocketClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt wiring. [PreferencesStore], [ApiClient], [ChatWebSocketClient] are
 * constructor-injected (Hilt provides them automatically); only the built
 * [ApiService] and repositories are exposed here.
 */
@Module
@InstallIn(SingletonComponent::class)
object ApiModule {

    @Provides
    @Singleton
    fun provideApiService(client: ApiClient): ApiService = client.build()

    @Provides
    @Singleton
    fun provideAuthRepository(
        api: ApiService,
        prefs: PreferencesStore,
        ws: ChatWebSocketClient
    ): AuthRepository = AuthRepository(api, prefs, ws)

    @Provides
    @Singleton
    fun provideChatRepository(
        api: ApiService,
        prefs: PreferencesStore,
        ws: ChatWebSocketClient,
        @ApplicationContext context: Context
    ): ChatRepository = ChatRepository(api, prefs, context, ws)

    @Provides
    @Singleton
    fun provideNotificationsRepository(
        api: ApiService,
        ws: ChatWebSocketClient
    ): NotificationsRepository = NotificationsRepository(api, ws)
}
