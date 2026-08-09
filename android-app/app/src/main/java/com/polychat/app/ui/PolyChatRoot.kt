package com.polychat.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polychat.app.data.local.PreferencesStore
import com.polychat.app.data.repo.AuthRepository
import com.polychat.app.ui.auth.LoginScreen
import com.polychat.app.ui.auth.LoginViewModel
import com.polychat.app.ui.main.MainScreen
import com.polychat.app.ui.main.MainViewModel
import com.polychat.app.ui.theme.PolyChatTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@Composable
fun PolyChatRoot(viewModel: SessionViewModel = hiltViewModel()) {
    val session by viewModel.session.collectAsState()
    val themeId by viewModel.themeId.collectAsState()
    val darkMode by viewModel.darkMode.collectAsState()

    PolyChatTheme(themeId = themeId, darkMode = darkMode) {
        Surface(modifier = Modifier.fillMaxSize()) {
            when (session) {
                SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                SessionState.LoggedOut -> {
                    val loginVm: LoginViewModel = hiltViewModel()
                    LoginScreen(viewModel = loginVm)
                }
                SessionState.LoggedIn -> {
                    val mainVm: MainViewModel = hiltViewModel()
                    MainScreen(viewModel = mainVm)
                }
            }
        }
    }
}

enum class SessionState { Loading, LoggedIn, LoggedOut }

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    private val prefs: PreferencesStore
) : ViewModel() {

    private val _session = MutableStateFlow(SessionState.Loading)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    val themeId: StateFlow<String?> = prefs.theme
    val darkMode: StateFlow<String?> = prefs.darkMode

    init {
        viewModelScope.launch {
            val has = authRepo.hasSession()
            if (has) {
                val me = authRepo.me()
                _session.value = if (me != null) SessionState.LoggedIn else SessionState.LoggedOut
            } else {
                _session.value = SessionState.LoggedOut
            }
        }
    }

    fun onLoggedIn() {
        _session.value = SessionState.LoggedIn
    }

    fun onLoggedOut() {
        _session.value = SessionState.LoggedOut
    }
}
