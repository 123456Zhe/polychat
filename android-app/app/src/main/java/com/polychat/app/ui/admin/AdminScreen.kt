package com.polychat.app.ui.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polychat.app.data.model.AdminOverview
import com.polychat.app.data.model.BotRequest
import com.polychat.app.data.model.BotToken
import com.polychat.app.data.repo.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

private enum class AdminTab(val label: String) { USERS("用户"), SECURITY("安全"), BOTS("机器人") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    viewModel: AdminViewModel,
    onBack: () -> Unit
) {
    var tab by remember { mutableIntStateOf(0) }
    val overview by viewModel.overview.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("管理面板") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(Modifier.fillMaxSize().padding(innerPadding)) {
            TabRow(selectedTabIndex = tab) {
                AdminTab.entries.forEachIndexed { index, t ->
                    Tab(
                        selected = tab == index,
                        onClick = { tab = index },
                        text = { Text(t.label) }
                    )
                }
            }

            when (AdminTab.entries[tab]) {
                AdminTab.USERS -> UsersTab(viewModel)
                AdminTab.SECURITY -> SecurityTab(viewModel)
                AdminTab.BOTS -> BotsTab(viewModel)
            }
        }
    }

    // Trigger data load when entering the screen.
    LaunchedEffect(Unit) {
        viewModel.loadAll()
    }
}

@Composable
private fun UsersTab(viewModel: AdminViewModel) {
    val overview by viewModel.overview.collectAsState()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Card {
                Column(Modifier.padding(16.dp)) {
                    Text("统计", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(6.dp))
                    Text("用户 ${overview.stats.users} · 房间 ${overview.stats.rooms} · 消息 ${overview.stats.messages} · 文件 ${overview.stats.files}",
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        items(overview.users, key = { it.id }) { user ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${user.username}  #${user.id}${if (user.is_admin) " · 管理员" else ""}",
                            style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOfNotNull(
                                user.banned_until?.let { "封禁中" },
                                user.muted_until?.let { "禁言中" },
                                "${user.message_count ?: 0} 条消息"
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (!user.is_admin) {
                        TextButton(onClick = { viewModel.toggleAdmin(user.id, true) }) { Text("设管理员") }
                        TextButton(onClick = { viewModel.banUser(user.id) }) { Text("封禁", color = MaterialTheme.colorScheme.error) }
                        TextButton(onClick = { viewModel.muteUser(user.id) }) { Text("禁言") }
                    }
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun SecurityTab(viewModel: AdminViewModel) {
    val bannedIps by viewModel.bannedIps.collectAsState()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        item { Text("已封禁 IP", style = MaterialTheme.typography.titleMedium) }
        if (bannedIps.isEmpty()) {
            item { Text("暂无封禁", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(bannedIps, key = { it.ip_address }) { ip ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(ip.ip_address, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                TextButton(onClick = { viewModel.unbanIp(ip.ip_address) }) { Text("解封") }
            }
        }
    }
}

@Composable
private fun BotsTab(viewModel: AdminViewModel) {
    val requests by viewModel.botRequests.collectAsState()
    val tokens by viewModel.botTokens.collectAsState()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        item { Text("机器人申请", style = MaterialTheme.typography.titleMedium) }
        if (requests.isEmpty()) {
            item { Text("暂无申请", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(requests, key = { it.id }) { req ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("${req.name} (${req.username ?: "?"})", style = MaterialTheme.typography.bodyLarge)
                    Text("状态：${req.status}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (req.status == "pending") {
                    TextButton(onClick = { viewModel.reviewRequest(req.id, "approved") }) { Text("通过") }
                    TextButton(onClick = { viewModel.reviewRequest(req.id, "rejected") }) { Text("拒绝") }
                }
            }
        }
        item { Text("已签发 Token", style = MaterialTheme.typography.titleMedium) }
        items(tokens, key = { it.token }) { t ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(t.name.ifBlank { "bot" }, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                TextButton(onClick = { viewModel.revokeToken(t.token) }) { Text("吊销", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@HiltViewModel
class AdminViewModel @Inject constructor(
    private val chatRepo: ChatRepository
) : ViewModel() {
    private val _overview = MutableStateFlow(AdminOverview())
    val overview: StateFlow<AdminOverview> = _overview.asStateFlow()

    private val _bannedIps = MutableStateFlow<List<com.polychat.app.data.model.BannedIp>>(emptyList())
    val bannedIps: StateFlow<List<com.polychat.app.data.model.BannedIp>> = _bannedIps.asStateFlow()

    private val _botRequests = MutableStateFlow<List<BotRequest>>(emptyList())
    val botRequests: StateFlow<List<BotRequest>> = _botRequests.asStateFlow()

    private val _botTokens = MutableStateFlow<List<BotToken>>(emptyList())
    val botTokens: StateFlow<List<BotToken>> = _botTokens.asStateFlow()

    fun loadAll() {
        viewModelScope.launch {
            runCatching { _overview.value = chatRepo.adminOverview() }
            runCatching { _bannedIps.value = chatRepo.adminBannedIps() }
            runCatching { _botRequests.value = chatRepo.adminBotRequests() }
            runCatching { _botTokens.value = chatRepo.adminBotTokens() }
        }
    }

    fun toggleAdmin(userId: Long, isAdmin: Boolean) {
        viewModelScope.launch {
            runCatching { chatRepo.adminSetAdmin(userId, isAdmin) }
            loadAll()
        }
    }

    fun banUser(userId: Long) {
        viewModelScope.launch {
            runCatching { chatRepo.adminBanUser(userId) }
            loadAll()
        }
    }

    fun muteUser(userId: Long) {
        viewModelScope.launch {
            runCatching { chatRepo.adminMuteUser(userId) }
            loadAll()
        }
    }

    fun unbanIp(ip: String) {
        viewModelScope.launch {
            runCatching { chatRepo.adminUnbanIp(ip) }
            loadAll()
        }
    }

    fun reviewRequest(id: Long, status: String) {
        viewModelScope.launch {
            runCatching { chatRepo.adminReviewBotRequest(id, status) }
            loadAll()
        }
    }

    fun revokeToken(token: String) {
        viewModelScope.launch {
            runCatching { chatRepo.adminRevokeBotToken(token) }
            loadAll()
        }
    }
}
