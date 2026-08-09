package com.polychat.app.ui.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.polychat.app.data.model.Friend
import com.polychat.app.ui.components.Avatar
import com.polychat.app.ui.main.MainViewModel

/** Contacts tab: friend requests, search, and accepted friends. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(
    viewModel: MainViewModel,
    modifier: Modifier = Modifier
) {
    val friends by viewModel.chatRepo.friends.collectAsState()
    var query by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<Friend>>(emptyList()) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("联系人") },
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        modifier = modifier
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(innerPadding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
                item {
                    OutlinedTextField(
                        value = query,
                        onValueChange = {
                            query = it
                            viewModel.searchFriends(it) { searchResults = it }
                        },
                        placeholder = { Text("搜索用户名并添加好友") },
                        trailingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                if (searchResults.isNotEmpty()) {
                    item { SectionLabel("搜索结果") }
                    items(searchResults, key = { "s_${it.id}" }) { user ->
                        FriendActionRow(
                            friend = user,
                            trailing = {
                                TextButton(onClick = { viewModel.addFriend(user.username) }) { Text("＋ 加好友") }
                            }
                        )
                    }
                }

                if (friends.incoming.isNotEmpty()) {
                    item { SectionLabel("好友请求 (${friends.incoming.size})") }
                    items(friends.incoming, key = { "i_${it.id}" }) { f ->
                        FriendActionRow(
                            friend = f,
                            trailing = {
                                Row {
                                    TextButton(onClick = { viewModel.acceptFriend(f.id) }) {
                                        Text("接受", color = MaterialTheme.colorScheme.primary)
                                    }
                                    TextButton(onClick = { viewModel.declineFriend(f.id) }) {
                                        Text("忽略", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        )
                    }
                }

                item { SectionLabel("我的好友 (${friends.accepted.size})") }
                if (friends.accepted.isEmpty()) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) {
                            Text("还没有好友，搜索并发送好友请求吧", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                items(friends.accepted, key = { "a_${it.id}" }) { f ->
                    FriendActionRow(
                        friend = f,
                        onClick = { viewModel.openDmWith(f.username) },
                        trailing = {
                            TextButton(onClick = { viewModel.openDmWith(f.username) }) {
                                Text("私信", color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    )
                }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, top = 10.dp, bottom = 2.dp)
    )
}

@Composable
private fun FriendActionRow(
    friend: Friend,
    trailing: @Composable () -> Unit,
    onClick: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(16.dp))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Avatar(
            avatarUrl = null,
            name = friend.username,
            size = 40
        )
        Spacer(Modifier.width(12.dp))
        Text(friend.username, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        trailing()
    }
}
