package com.polychat.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.polychat.app.data.api.AuthInterceptor
import com.polychat.app.data.local.PreferencesStore
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

@HiltAndroidApp
class PolyChatApp : Application(), ImageLoaderFactory {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface AppEntryPoint {
        fun prefs(): PreferencesStore
    }

    // Default ImageLoader for Coil — attach the auth interceptor so avatar and
    // attachment images carry the Bearer token (server requires login for both).
    override fun newImageLoader(): ImageLoader {
        val prefs = EntryPointAccessors.fromApplication(this, AppEntryPoint::class.java).prefs()
        return ImageLoader.Builder(this)
            .okHttpClient {
                OkHttpClient.Builder()
                    .connectTimeout(20, TimeUnit.SECONDS)
                    .readTimeout(60, TimeUnit.SECONDS)
                    .addInterceptor(AuthInterceptor(prefs))
                    .build()
            }
            .crossfade(true)
            .build()
    }
}
