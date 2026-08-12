package com.polychat.app.data.api

import com.polychat.app.data.local.PreferencesStore
import com.polychat.app.data.model.ErrorResponse
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Lenient Boolean decoder: the server stores booleans in SQLite as 0/1 ints,
 * so JSON may contain `0`, `1`, `true`, or `false`. kotlinx-serialization's
 * strict Boolean decoding crashes on `0`/`1`. This serializer accepts all four.
 */
@Serializer(forClass = Boolean::class)
object LenientBooleanSerializer : KSerializer<Boolean> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("LenientBoolean", PrimitiveKind.BOOLEAN)

    override fun deserialize(decoder: Decoder): Boolean {
        val jsonDecoder = decoder as kotlinx.serialization.json.JsonDecoder
        val element = jsonDecoder.decodeJsonElement()
        val text = element.toString()
        return text == "true" || text == "1"
    }

    override fun serialize(encoder: Encoder, value: Boolean) {
        encoder.encodeBoolean(value)
    }
}

/** Thrown when an API call fails; carries a human-readable message and optional upload offset. */
class ApiException(message: String, val code: Int = 0, val offset: Long? = null) : Exception(message)

/** Converts any Throwable from a Retrofit call into a friendly user message. */
fun Throwable.toUserMessage(): String {
    if (this is ApiException) return message ?: "请求失败"
    if (this is HttpException) {
        return try {
            val body = response()?.errorBody()?.string().orEmpty()
            val parsed = runCatching {
                Json { ignoreUnknownKeys = true }.decodeFromString<ErrorResponse>(body).error
            }.getOrNull()
            parsed ?: "请求失败 (${code()})"
        } catch (_: Exception) {
            "请求失败 (${code()})"
        }
    }
    if (this is SocketTimeoutException) return "连接超时，请检查网络或服务器地址"
    if (this is ConnectException || this is UnknownHostException) return "无法连接服务器，请检查地址"
    return message ?: "发生错误"
}

/** Extracts the upload offset from a chunked-upload 409 response. */
fun Throwable.uploadOffset(): Long? {
    if (this is HttpException) {
        return try {
            val body = response()?.errorBody()?.string().orEmpty()
            Json { ignoreUnknownKeys = true }.decodeFromString<ErrorResponse>(body).offset
        } catch (_: Exception) {
            null
        }
    }
    return (this as? ApiException)?.offset
}

@Singleton
class ApiClient @Inject constructor(
    private val prefs: PreferencesStore
) {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        serializersModule = kotlinx.serialization.modules.SerializersModule {
            contextual(Boolean::class, LenientBooleanSerializer)
        }
    }

    /** Rebuilds the Retrofit service using the current server URL. */
    fun build(): ApiService {
        val base = (prefs.getServerUrl()?.trim()?.trimEnd('/') ?: DEFAULT_SERVER_URL) + "/"
        val okHttp = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(AuthInterceptor(prefs))
            .build()
        return Retrofit.Builder()
            .baseUrl(base)
            .client(okHttp)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
    }

    fun wsUrl(): String {
        val base = prefs.getServerUrl()?.trim()?.trimEnd('/') ?: DEFAULT_SERVER_URL
        return if (base.startsWith("https")) base.replaceFirst("https", "wss") + "/ws"
        else base.replaceFirst("http", "ws") + "/ws"
    }

    companion object {
 const val DEFAULT_SERVER_URL = "https://chat.zhezhe.online"
    }
}

class AuthInterceptor(private val prefs: PreferencesStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = runCatching { prefs.getToken() }.getOrNull()
        val newRequest: Request = if (token != null) {
            request.newBuilder().header("Authorization", "Bearer $token").build()
        } else request
        return chain.proceed(newRequest)
    }
}
