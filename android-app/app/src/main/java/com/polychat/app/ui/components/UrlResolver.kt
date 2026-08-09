package com.polychat.app.ui.components

/** Resolves server-relative paths (e.g. /api/files/5) to absolute URLs. */
object UrlResolver {
    fun resolve(serverUrl: String?, path: String?): String? {
        if (path.isNullOrBlank()) return null
        val base = serverUrl?.trim()?.trimEnd('/') ?: return path
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        return "$base$path"
    }

    fun avatarUrl(serverUrl: String?, avatarPath: String?): String? = resolve(serverUrl, avatarPath)
}
