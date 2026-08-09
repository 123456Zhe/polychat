package com.polychat.app.data.repo

import com.polychat.app.data.api.ApiService
import com.polychat.app.data.model.NotificationItem
import com.polychat.app.data.ws.ChatWebSocketClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationsRepository @Inject constructor(
    private val api: ApiService,
    val ws: ChatWebSocketClient
) {
    private val _notifications = MutableStateFlow<List<NotificationItem>>(emptyList())
    val notifications: StateFlow<List<NotificationItem>> = _notifications.asStateFlow()

    private val _unreadCount = MutableStateFlow(0L)
    val unreadCount: StateFlow<Long> = _unreadCount.asStateFlow()

    suspend fun loadNotifications() {
        _notifications.value = api.notifications().notifications
    }

    suspend fun loadUnreadCount() {
        _unreadCount.value = api.unreadCount().count
    }

    suspend fun markRead(id: Long) {
        api.markNotifRead(id)
        _notifications.update { list -> list.map { if (it.id == id) it.copy(is_read = true) else it } }
        _unreadCount.update { (it - 1).coerceAtLeast(0) }
    }

    suspend fun markAllRead() {
        api.markAllNotifRead()
        _notifications.update { list -> list.map { it.copy(is_read = true) } }
        _unreadCount.value = 0
    }

    fun pushFromWs(notification: NotificationItem) {
        _notifications.update { list -> (listOf(notification) + list).take(100) }
        _unreadCount.update { it + 1 }
    }
}
