package com.polychat.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polychat.app.data.api.toUserMessage
import com.polychat.app.data.repo.AuthRepository
import com.polychat.app.ui.SessionViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@Composable
fun LoginScreen(
    viewModel: LoginViewModel = hiltViewModel(),
    sessionVm: SessionViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    var isLogin by remember { mutableStateOf(true) }

    Scaffold { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Spacer(Modifier.height(32.dp))
            Text("PolyChat", style = MaterialTheme.typography.headlineSmall)
            Text("让交流保持简单", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(32.dp))

            Column {
                OutlinedTextField(
                    value = state.username,
                    onValueChange = { viewModel.onUsernameChange(it) },
                    label = { Text("用户名") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.password,
                    onValueChange = { viewModel.onPasswordChange(it) },
                    label = { Text("密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                state.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                }
                Button(
                    onClick = { viewModel.login(isLogin, sessionVm) },
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    if (state.loading) CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    else Text(if (isLogin) "登录" else "创建账号")
                }
                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = { isLogin = !isLogin; viewModel.clearError() },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (isLogin) "没有账号？注册" else "已有账号？登录")
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepo: AuthRepository
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onUsernameChange(v: String) { _state.value = _state.value.copy(username = v, error = null) }
    fun onPasswordChange(v: String) { _state.value = _state.value.copy(password = v, error = null) }
    fun clearError() { _state.value = _state.value.copy(error = null) }

    fun login(isLogin: Boolean, sessionVm: SessionViewModel) {
        val s = _state.value
        if (s.username.isBlank() || s.password.length < 8) {
            _state.value = s.copy(error = "用户名不能为空，密码至少 8 位")
            return
        }
        _state.value = s.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val resp = if (isLogin) authRepo.login(s.username, s.password, null)
                else authRepo.register(s.username, s.password, null)
                authRepo.saveSession(resp)
                _state.value = _state.value.copy(loading = false)
                sessionVm.onLoggedIn()
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.toUserMessage())
            }
        }
    }
}
