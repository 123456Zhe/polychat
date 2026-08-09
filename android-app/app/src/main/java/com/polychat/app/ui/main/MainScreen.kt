package com.polychat.app.ui.main

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import com.polychat.app.ui.admin.AdminScreen
import com.polychat.app.ui.admin.AdminViewModel
import com.polychat.app.ui.chats.ChatListScreen
import com.polychat.app.ui.chats.ChatScreen
import com.polychat.app.ui.chats.ChatViewModel
import com.polychat.app.ui.contacts.ContactsScreen
import com.polychat.app.ui.profile.ProfileScreen

enum class MainTab(val label: String, val icon: ImageVector) {
    CHATS("聊天", Icons.Filled.Chat),
    CONTACTS("联系人", Icons.Filled.People),
    PROFILE("我的", Icons.Filled.Person)
}

@Composable
fun MainScreen(viewModel: MainViewModel) {
    var selectedTab by remember { mutableStateOf(MainTab.CHATS) }
    val roomId by viewModel.roomId.collectAsState()
    val convId by viewModel.convId.collectAsState()
    val adminOpen by viewModel.adminOpen.collectAsState()

    // Full-screen chat page takes over the whole surface (no bottom bar).
    if (roomId != null || convId != null) {
        val chatVm: ChatViewModel = hiltViewModel()
        ChatScreen(
            viewModel = chatVm,
            roomId = roomId,
            convId = convId,
            onBack = { viewModel.closeChat() }
        )
        return
    }

    if (adminOpen) {
        val adminVm: AdminViewModel = hiltViewModel()
        AdminScreen(
            viewModel = adminVm,
            onBack = { viewModel.closeAdmin() }
        )
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                MainTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
                            selectedTextColor = MaterialTheme.colorScheme.onSurface
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        val pad = Modifier.padding(innerPadding)
        when (selectedTab) {
            MainTab.CHATS -> ChatListScreen(
                viewModel = viewModel,
                modifier = pad,
                onOpenRoom = { viewModel.openRoom(it) },
                onOpenDm = { viewModel.openDm(it) }
            )
            MainTab.CONTACTS -> ContactsScreen(viewModel, modifier = pad)
            MainTab.PROFILE -> ProfileScreen(viewModel, modifier = pad)
        }
    }
}
