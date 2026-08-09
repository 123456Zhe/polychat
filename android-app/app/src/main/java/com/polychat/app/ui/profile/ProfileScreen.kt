package com.polychat.app.ui.profile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.polychat.app.ui.components.Avatar
import com.polychat.app.ui.main.MainViewModel
import com.polychat.app.ui.theme.PolyTheme

/** "我的" tab: profile, theme, notifications, server settings, account actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    viewModel: MainViewModel,
    modifier: Modifier = Modifier
) {
    val currentUser by viewModel.currentUser.collectAsState()
    val theme by viewModel.theme.collectAsState()
    var showThemePicker by remember { mutableStateOf(false) }
    var showServerDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        },
        modifier = modifier
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            Spacer(Modifier.height(8.dp))
            // Profile header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .clickable { }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Avatar(
                    avatarUrl = currentUser?.let { "${viewModel.serverUrl()}/api/users/${it.id}/avatar?v=${it.avatar_updated_at ?: 0}" },
                    name = currentUser?.username ?: "?",
                    size = 56
                )
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(currentUser?.username ?: "…", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "#${currentUser?.id ?: 0}${if (currentUser?.is_admin == true) " · 管理员" else ""}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            MenuRow("◐ 主题", "当前：${PolyTheme.fromId(theme).label}") { showThemePicker = true }
            MenuRow("🔔 通知", "本地通知（WS 实时）") { viewModel.toggleNotifications() }
            if (currentUser?.is_admin == true) {
                MenuRow("⚙ 管理面板", "") { viewModel.openAdmin() }
            }
            MenuRow("⚙ 服务器地址", viewModel.serverUrl()) { showServerDialog = true }
            MenuRow("↓ 导出聊天记录", "") { viewModel.exportData() }
            MenuRow("✕ 删除账号", "") { showDeleteDialog = true }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))

            TextButton(
                onClick = { viewModel.logout() },
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                Text("退出登录", color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (showThemePicker) {
        AlertDialog(
            onDismissRequest = { showThemePicker = false },
            title = { Text("选择主题") },
            text = {
                Column {
                    PolyTheme.entries.forEach { t ->
                        TextButton(
                            onClick = { viewModel.setTheme(t.id); showThemePicker = false },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (t.id == theme) "● ${t.label}" else t.label)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showThemePicker = false }) { Text("关闭") } }
        )
    }

    if (showServerDialog) {
        var url by remember { mutableStateOf(viewModel.serverUrl()) }
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            title = { Text("服务器地址") },
            text = {
                Column {
                    Text("默认 http://68.64.177.154:3000", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = url,
                        onValueChange = { url = it },
                        placeholder = { Text("http://host:port") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.setServerUrl(url); showServerDialog = false }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showServerDialog = false }) { Text("取消") } }
        )
    }

    if (showDeleteDialog) {
        var password by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("删除账号") },
            text = {
                Column {
                    Text("删除账号将永久移除所有消息和文件。输入密码确认：", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = { Text("密码") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteAccount(password)
                    showDeleteDialog = false
                }) { Text("确认删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showDeleteDialog = false }) { Text("取消") } }
        )
    }
}

@Composable
private fun MenuRow(title: String, subtitle: String, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (subtitle.isNotBlank()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
