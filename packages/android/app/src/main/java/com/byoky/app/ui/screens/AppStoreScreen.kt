package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.MarketplaceApp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

private const val MARKETPLACE_URL = "https://byoky.com/api/apps"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppStoreScreen(wallet: WalletStore, onBack: () -> Unit) {
    val installedApps by wallet.installedApps.collectAsState()
    val installedIds = installedApps.map { it.id }.toSet()

    var apps by remember { mutableStateOf<List<MarketplaceApp>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }

    LaunchedEffect(search) {
        loading = true
        try {
            val url = if (search.isNotBlank()) {
                val encoded = java.net.URLEncoder.encode(search, "UTF-8")
                "$MARKETPLACE_URL/apps?search=$encoded"
            } else "$MARKETPLACE_URL/apps"
            apps = fetchMarketplaceApps(url)
            error = null
        } catch (e: Exception) {
            error = e.message
        }
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("App Store") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                placeholder = { Text("Search apps...") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                singleLine = true,
            )

            when {
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Failed to load: $error", color = TextMuted)
                }
                apps.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No apps found", color = TextMuted)
                }
                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(apps, key = { it.id }) { app ->
                        StoreAppCard(
                            app = app,
                            installed = installedIds.contains(app.id),
                            onInstall = { wallet.installApp(app) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StoreAppCard(app: MarketplaceApp, installed: Boolean, onInstall: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = BgRaised),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(AccentSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = app.name.take(1).uppercase(),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Accent,
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(app.name, fontWeight = FontWeight.SemiBold)
                        if (app.verified) {
                            Icon(Icons.Default.Verified, contentDescription = "Verified", modifier = Modifier.size(16.dp), tint = Accent)
                        }
                    }
                    Text(app.authorName, fontSize = 12.sp, color = TextMuted)
                    Spacer(Modifier.height(4.dp))
                    Text(app.description, fontSize = 12.sp, color = TextSecondary, maxLines = 2)

                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        app.providers.forEach { provider ->
                            Text(
                                text = provider,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Accent,
                                modifier = Modifier
                                    .background(AccentSoft, RoundedCornerShape(10.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            Button(
                onClick = onInstall,
                enabled = !installed,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (installed) BgCard else Accent,
                ),
            ) {
                Text(if (installed) "Installed" else "Install")
            }
        }
    }
}

private suspend fun fetchMarketplaceApps(url: String): List<MarketplaceApp> = withContext(Dispatchers.IO) {
    val client = OkHttpClient()
    val request = Request.Builder().url(url).build()
    val response = client.newCall(request).execute()
    val body = response.body?.string() ?: throw Exception("Empty response")
    val json = JSONObject(body)
    val arr = json.getJSONArray("apps")
    val apps = mutableListOf<MarketplaceApp>()
    for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        val providers = mutableListOf<String>()
        val pArr = o.optJSONArray("providers")
        if (pArr != null) for (j in 0 until pArr.length()) providers.add(pArr.getString(j))
        val author = o.optJSONObject("author")
        apps.add(MarketplaceApp(
            id = o.getString("id"),
            name = o.getString("name"),
            slug = o.getString("slug"),
            url = o.getString("url"),
            icon = o.optString("icon", ""),
            description = o.optString("description", ""),
            category = o.optString("category", "other"),
            providers = providers,
            authorName = author?.optString("name", "") ?: "",
            authorWebsite = author?.optString("website", null),
            status = o.optString("status", "approved"),
            verified = o.optBoolean("verified", false),
            featured = o.optBoolean("featured", false),
            createdAt = o.optLong("createdAt", 0),
        ))
    }
    apps
}
