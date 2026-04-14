package com.byoky.app.ui.screens

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.DEFAULT_GROUP_ID
import com.byoky.app.data.Group
import com.byoky.app.data.Provider
import com.byoky.app.data.RequestLog
import com.byoky.app.data.Session
import com.byoky.app.data.TokenAllowance
import com.byoky.app.data.WalletStore
import com.byoky.app.data.capabilityGaps
import com.byoky.app.data.capabilityLabel
import com.byoky.app.data.detectAppCapabilities
import com.byoky.app.data.giftBudgetRemaining
import com.byoky.app.data.isGiftExpired
import com.byoky.app.proxy.TranslationEngine
import com.byoky.app.ui.theme.*

/**
 * The Apps screen — connected apps bucketed by group, with per-app routing
 * (assign an app to a group → its requests use that group's credential and,
 * when the group's destination is in a different family, get translated on
 * the fly). Mirrors the extension's `ConnectedApps.tsx` page; the mobile
 * gesture is long-press → "Move to group" sheet rather than drag-and-drop
 * since touch drag is awkward for small targets.
 */
/**
 * Pending capability-gap confirmation. Set when the user has tapped a target
 * group whose model lacks features the app has been using; we surface a
 * confirmation dialog before committing the move so a misroute doesn't
 * silently start failing requests.
 */
private data class PendingCapabilityMove(
    val origin: String,
    val displayHost: String,
    val groupId: String,
    val groupName: String,
    val model: String,
    val gapLabels: List<String>,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(wallet: WalletStore) {
    val sessions by wallet.sessions.collectAsState()
    val groups by wallet.groups.collectAsState()
    val appGroups by wallet.appGroups.collectAsState()
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    val allowances by wallet.tokenAllowances.collectAsState()
    val requestLogs by wallet.requestLogs.collectAsState()
    val context = LocalContext.current
    val engine = remember { TranslationEngine.get(context) }

    var movingApp by remember { mutableStateOf<Session?>(null) }
    var editingAllowanceFor by remember { mutableStateOf<Session?>(null) }
    var editingGroup by remember { mutableStateOf<Group?>(null) }
    var creatingGroup by remember { mutableStateOf(false) }
    var pendingMove by remember { mutableStateOf<PendingCapabilityMove?>(null) }

    val orderedGroups = remember(groups) {
        val def = groups.filter { it.id == DEFAULT_GROUP_ID }
        val rest = groups.filter { it.id != DEFAULT_GROUP_ID }.sortedBy { it.createdAt }
        def + rest
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Apps") },
                actions = {
                    if (sessions.size > 1) {
                        IconButton(onClick = {
                            sessions.forEach { wallet.revokeSession(it) }
                        }) {
                            Icon(Icons.Default.Close, "Disconnect all", tint = Danger)
                        }
                    }
                    IconButton(onClick = { creatingGroup = true }) {
                        Icon(Icons.Default.Add, "New group", tint = Accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!cloudVaultEnabled && sessions.isNotEmpty()) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Warning.copy(alpha = 0.1f)),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(Icons.Default.Wifi, null, tint = Warning, modifier = Modifier.size(16.dp))
                            Text(
                                "Your device must stay online for connected apps to work. Enable Cloud Sync in Settings for offline access.",
                                color = Warning,
                                fontSize = 12.sp,
                            )
                        }
                    }
                }
            }

            items(orderedGroups, key = { it.id }) { group ->
                val groupSessions = sessions.filter { (appGroups[it.appOrigin] ?: DEFAULT_GROUP_ID) == group.id }
                GroupBucket(
                    group = group,
                    sessions = groupSessions,
                    allowances = allowances,
                    wallet = wallet,
                    onMove = { movingApp = it },
                    onEditAllowance = { editingAllowanceFor = it },
                    onEditGroup = { editingGroup = group },
                    onDeleteGroup = {
                        try { wallet.deleteGroup(group.id) } catch (_: Throwable) {}
                    },
                )
            }

            if (sessions.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 32.dp, bottom = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            Icons.Default.Link,
                            null,
                            tint = TextMuted,
                            modifier = Modifier.size(48.dp),
                        )
                        Spacer(Modifier.height(16.dp))
                        Text("No Apps Connected", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Pair an app via the Connect tab. Connected apps appear here, where you can group them, set token limits, and reroute requests across providers.",
                            color = TextSecondary,
                            textAlign = TextAlign.Center,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 24.dp),
                        )
                    }
                }
            }
        }
    }

    movingApp?.let { session ->
        MoveToGroupSheet(
            session = session,
            groups = orderedGroups,
            currentGroupId = appGroups[session.appOrigin] ?: DEFAULT_GROUP_ID,
            onSelect = { groupId ->
                val targetGroup = orderedGroups.firstOrNull { it.id == groupId }
                val pending = targetGroup?.let {
                    capabilityPendingMove(session, it, requestLogs, engine)
                }
                if (pending != null) {
                    // Defer the move — show the warning dialog. Keep movingApp
                    // null so the bottom sheet closes; the dialog takes over.
                    pendingMove = pending
                    movingApp = null
                } else {
                    try { wallet.setAppGroup(session.appOrigin, groupId) } catch (_: Throwable) {}
                    movingApp = null
                }
            },
            onDismiss = { movingApp = null },
        )
    }

    pendingMove?.let { pending ->
        AlertDialog(
            onDismissRequest = { pendingMove = null },
            containerColor = BgCard,
            title = { Text("Capability mismatch", color = TextPrimary) },
            text = {
                val singular = pending.gapLabels.size == 1
                Text(
                    "${pending.displayHost} has used ${pending.gapLabels.joinToString(", ")} in past requests, " +
                        "but ${pending.model} in ${pending.groupName} does not support " +
                        (if (singular) "it" else "one or more of these") +
                        ". Requests using " +
                        (if (singular) "that feature" else "those features") +
                        " will fail until you switch back.",
                    color = TextSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    try { wallet.setAppGroup(pending.origin, pending.groupId) } catch (_: Throwable) {}
                    pendingMove = null
                }) {
                    Text("Move anyway", color = Danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingMove = null }) {
                    Text("Cancel", color = TextSecondary)
                }
            },
        )
    }

    editingAllowanceFor?.let { session ->
        val allowance = allowances.firstOrNull { it.origin == session.appOrigin }
        AllowanceDialog(
            origin = session.appOrigin,
            providers = session.providers,
            allowance = allowance,
            onSave = { wallet.setAllowance(it); editingAllowanceFor = null },
            onRemove = { wallet.removeAllowance(session.appOrigin); editingAllowanceFor = null },
            onDismiss = { editingAllowanceFor = null },
        )
    }

    if (creatingGroup) {
        GroupEditorDialog(
            wallet = wallet,
            existing = null,
            onDismiss = { creatingGroup = false },
        )
    }

    editingGroup?.let { group ->
        GroupEditorDialog(
            wallet = wallet,
            existing = group,
            onDismiss = { editingGroup = null },
        )
    }
}

/**
 * One group with its assigned apps. Header shows the group name + provider/model
 * pin, body lists the connected apps, footer is empty placeholder when nothing's
 * assigned. Long-press an app to move it.
 */
@Composable
private fun GroupBucket(
    group: Group,
    sessions: List<Session>,
    allowances: List<TokenAllowance>,
    wallet: WalletStore,
    onMove: (Session) -> Unit,
    onEditAllowance: (Session) -> Unit,
    onEditGroup: () -> Unit,
    onDeleteGroup: () -> Unit,
) {
    val isDefault = group.id == DEFAULT_GROUP_ID
    val provider = Provider.find(group.providerId)
    val pinnedCred = group.credentialId?.let { id ->
        wallet.credentials.value.firstOrNull { it.id == id }
    }
    val pinnedGift = group.giftId?.let { gid ->
        wallet.giftedCredentials.value.firstOrNull { it.giftId == gid }
    }
    var menuOpen by remember { mutableStateOf(false) }

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            group.name,
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary,
                        )
                        Spacer(Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .background(Accent.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        ) {
                            Text(
                                provider?.name ?: group.providerId,
                                color = Accent,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                        if (!group.model.isNullOrEmpty()) {
                            Spacer(Modifier.width(6.dp))
                            Box(
                                modifier = Modifier
                                    .background(BgMain, RoundedCornerShape(8.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    group.model!!,
                                    color = TextSecondary,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        when {
                            pinnedGift != null -> "Using gift from ${pinnedGift.senderLabel} · ${formatTokens(giftBudgetRemaining(pinnedGift.usedTokens, pinnedGift.maxTokens))} left"
                            pinnedCred != null -> "Using ${pinnedCred.label}"
                            else -> "Any ${provider?.name ?: group.providerId} credential"
                        },
                        color = TextMuted,
                        fontSize = 11.sp,
                    )
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(
                            Icons.Default.MoreVert,
                            "Group menu",
                            tint = Accent,
                        )
                    }
                    DropdownMenu(
                        expanded = menuOpen,
                        onDismissRequest = { menuOpen = false },
                        modifier = Modifier.background(BgRaised),
                    ) {
                        DropdownMenuItem(
                            text = { Text(if (isDefault) "Edit default" else "Edit", color = TextPrimary) },
                            onClick = { menuOpen = false; onEditGroup() },
                            leadingIcon = { Icon(Icons.Default.Edit, null, tint = Accent) },
                        )
                        if (!isDefault) {
                            DropdownMenuItem(
                                text = { Text("Delete", color = Danger) },
                                onClick = { menuOpen = false; onDeleteGroup() },
                                leadingIcon = { Icon(Icons.Default.Delete, null, tint = Danger) },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            if (sessions.isEmpty()) {
                Text(
                    if (isDefault) "Apps without an assigned group land here."
                    else "Long-press an app and pick this group to move it here.",
                    color = TextMuted,
                    fontSize = 12.sp,
                    fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    sessions.forEach { session ->
                        AppSessionCard(
                            session = session,
                            allowance = allowances.firstOrNull { it.origin == session.appOrigin },
                            tokensUsed = wallet.tokenUsage(session.appOrigin),
                            onMove = { onMove(session) },
                            onEditAllowance = { onEditAllowance(session) },
                            onRevoke = { wallet.revokeSession(session) },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Connected app card. Tap = move to group; trailing icons = set limit, revoke.
 * Same content as the old SessionsScreen card but tighter and group-aware.
 */
@Composable
private fun AppSessionCard(
    session: Session,
    allowance: TokenAllowance?,
    tokensUsed: Int,
    onMove: () -> Unit,
    onEditAllowance: () -> Unit,
    onRevoke: () -> Unit,
) {
    val displayHost = remember(session.appOrigin) {
        try { java.net.URL(session.appOrigin).host ?: session.appOrigin }
        catch (_: Exception) { session.appOrigin }
    }

    Surface(
        onClick = onMove,
        color = BgRaised,
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Accent.copy(alpha = 0.15f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        displayHost.firstOrNull()?.uppercase() ?: "?",
                        color = Accent,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                    )
                }
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        displayHost,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary,
                        fontSize = 14.sp,
                    )
                    Text(
                        DateUtils.getRelativeTimeSpanString(
                            session.createdAt,
                            System.currentTimeMillis(),
                            DateUtils.MINUTE_IN_MILLIS,
                        ).toString(),
                        color = TextMuted,
                        fontSize = 11.sp,
                    )
                }
                IconButton(onClick = onEditAllowance) {
                    Icon(
                        Icons.Default.Speed,
                        "Set limit",
                        tint = Accent,
                        modifier = Modifier.size(18.dp),
                    )
                }
                IconButton(onClick = onRevoke) {
                    Icon(
                        Icons.Default.Close,
                        "Disconnect",
                        tint = Danger,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(Modifier.height(6.dp))

            if (allowance?.totalLimit != null) {
                val limit = allowance.totalLimit!!
                val progress = (tokensUsed.toFloat() / limit).coerceIn(0f, 1f)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier.weight(1f).height(5.dp),
                        color = if (progress >= 0.8f) Warning else Accent,
                        trackColor = TextMuted.copy(alpha = 0.2f),
                    )
                    Text(
                        "${formatTokens(tokensUsed)} / ${formatTokens(limit)}",
                        fontSize = 10.sp,
                        color = TextMuted,
                    )
                }
            } else {
                Text(
                    "${formatTokens(tokensUsed)} tokens used",
                    fontSize = 11.sp,
                    color = TextMuted,
                )
            }
        }
    }
}

/**
 * Diff the app's used-capability union against a candidate group's destination
 * model. Returns null when there is no gap (the move is safe to commit
 * directly), or a [PendingCapabilityMove] describing the gap when we need to
 * ask the user to confirm. Skipped entirely when the group has no pinned
 * model — pass-through groups can't introduce a capability mismatch.
 */
private fun capabilityPendingMove(
    session: Session,
    target: Group,
    requestLogs: List<RequestLog>,
    engine: TranslationEngine,
): PendingCapabilityMove? {
    val model = target.model
    if (model.isNullOrEmpty()) return null
    if (!engine.isSupported) return null
    val raw = try { engine.describeModel(model) } catch (_: Throwable) { null } ?: return null
    val caps: Map<String, Boolean> = try {
        val parsed = org.json.JSONObject(raw).getJSONObject("capabilities")
        mapOf(
            "tools" to parsed.optBoolean("tools"),
            "vision" to parsed.optBoolean("vision"),
            "structuredOutput" to parsed.optBoolean("structuredOutput"),
            "reasoning" to parsed.optBoolean("reasoning"),
        )
    } catch (_: Throwable) { return null }
    val appEntries = requestLogs.filter { it.appOrigin == session.appOrigin }
    val used = detectAppCapabilities(appEntries)
    val gaps = capabilityGaps(used, caps)
    if (gaps.isEmpty()) return null
    val displayHost = try { java.net.URL(session.appOrigin).host ?: session.appOrigin }
        catch (_: Exception) { session.appOrigin }
    return PendingCapabilityMove(
        origin = session.appOrigin,
        displayHost = displayHost,
        groupId = target.id,
        groupName = target.name,
        model = model,
        gapLabels = gaps.map(::capabilityLabel),
    )
}

/**
 * Bottom sheet for assigning a connected app to a group. Tap a group → bind →
 * dismiss. Current group has a checkmark. The next request will route through
 * the chosen group's credential.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MoveToGroupSheet(
    session: Session,
    groups: List<Group>,
    currentGroupId: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val displayHost = remember(session.appOrigin) {
        try { java.net.URL(session.appOrigin).host ?: session.appOrigin }
        catch (_: Exception) { session.appOrigin }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = BgCard,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Text(
                "Move app",
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                displayHost,
                color = TextSecondary,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "MOVE TO GROUP",
                color = TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(8.dp))
            groups.forEach { group ->
                val provider = Provider.find(group.providerId)
                Surface(
                    onClick = { onSelect(group.id) },
                    color = Color.Transparent,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                group.name,
                                fontWeight = FontWeight.Medium,
                                color = TextPrimary,
                                fontSize = 14.sp,
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    provider?.name ?: group.providerId,
                                    color = TextSecondary,
                                    fontSize = 12.sp,
                                )
                                if (!group.model.isNullOrEmpty()) {
                                    Text(" · ", color = TextSecondary, fontSize = 12.sp)
                                    Text(
                                        group.model!!,
                                        color = TextSecondary,
                                        fontSize = 12.sp,
                                        fontFamily = FontFamily.Monospace,
                                    )
                                }
                            }
                        }
                        if (group.id == currentGroupId) {
                            Icon(Icons.Default.Check, null, tint = Accent)
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "The next request from this app will use the group's credential. Cross-family requests are translated on the fly.",
                color = TextMuted,
                fontSize = 11.sp,
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}

/**
 * Create or edit a routing group. Default group can be edited but not renamed
 * or deleted. Model is optional — leave empty to pass through whatever model
 * the app requested; set to override (required for cross-family routing).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GroupEditorDialog(
    wallet: WalletStore,
    existing: Group?,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val credentials by wallet.credentials.collectAsState()
    val giftedCredentials by wallet.giftedCredentials.collectAsState()
    val isDefault = existing?.id == DEFAULT_GROUP_ID

    var name by remember { mutableStateOf(existing?.name ?: "") }
    var providerId by remember { mutableStateOf(existing?.providerId ?: "anthropic") }
    // Unified pin value: "", "cred:<id>", or "gift:<giftId>".
    var pinValue by remember {
        mutableStateOf(
            when {
                existing?.giftId != null -> "gift:${existing.giftId}"
                existing?.credentialId != null -> "cred:${existing.credentialId}"
                else -> ""
            }
        )
    }
    var model by remember { mutableStateOf(existing?.model ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var providerExpanded by remember { mutableStateOf(false) }
    var credentialExpanded by remember { mutableStateOf(false) }

    val matchingCreds = credentials.filter { it.providerId == providerId }
    val matchingGifts = giftedCredentials.filter {
        it.providerId == providerId
                && !isGiftExpired(it.expiresAt)
                && it.usedTokens < it.maxTokens
    }
    val hasAnyPinnable = matchingCreds.isNotEmpty() || matchingGifts.isNotEmpty()
    val providerName = Provider.find(providerId)?.name ?: providerId

    // Resolve the current pin to a display label for the dropdown anchor.
    val pinnedLabel: String = remember(pinValue, matchingCreds, matchingGifts) {
        when {
            pinValue.startsWith("cred:") -> {
                val id = pinValue.removePrefix("cred:")
                matchingCreds.firstOrNull { it.id == id }?.label
                    ?: "Any $providerName credential"
            }
            pinValue.startsWith("gift:") -> {
                val gid = pinValue.removePrefix("gift:")
                matchingGifts.firstOrNull { it.giftId == gid }?.let { gc ->
                    "🎁 ${gc.senderLabel} · ${formatTokens(giftBudgetRemaining(gc.usedTokens, gc.maxTokens))} left"
                } ?: "Any $providerName credential"
            }
            else -> "Any $providerName credential"
        }
    }

    val engine = remember { TranslationEngine.get(context) }
    val suggestedModels = remember(providerId, engine.isSupported) {
        if (!engine.isSupported) return@remember emptyList<Pair<String, String>>()
        try {
            val json = org.json.JSONArray(engine.getModelsForProvider(providerId))
            (0 until json.length()).map { i ->
                val obj = json.getJSONObject(i)
                obj.getString("id") to obj.getString("displayName")
            }
        } catch (_: Throwable) { emptyList() }
    }
    val modelInfo = remember(model, engine.isSupported) {
        if (!engine.isSupported || model.isEmpty()) return@remember null as String?
        try {
            val raw = engine.describeModel(model) ?: return@remember null as String?
            val parsed = org.json.JSONObject(raw)
            val caps = parsed.getJSONObject("capabilities")
            val bits = buildList {
                if (caps.optBoolean("tools")) add("tools")
                if (caps.optBoolean("vision")) add("vision")
                if (caps.optBoolean("structuredOutput")) add("JSON schema")
                if (caps.optBoolean("reasoning")) add("reasoning")
            }
            val display = parsed.optString("displayName", model)
            val ctx = parsed.optInt("contextWindow", 0)
            val ctxK = if (ctx >= 1000) "${ctx / 1000}K" else "$ctx"
            "$display: $ctxK ctx · ${bits.joinToString(" · ")}"
        } catch (_: Throwable) { null }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = {
            Text(
                when {
                    existing == null -> "New Group"
                    isDefault -> "Default Group"
                    else -> "Edit Group"
                },
                color = TextPrimary,
            )
        },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 480.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (!isDefault) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Group name") },
                        placeholder = { Text("e.g. Coding") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                }

                ExposedDropdownMenuBox(
                    expanded = providerExpanded,
                    onExpandedChange = { providerExpanded = !providerExpanded },
                ) {
                    OutlinedTextField(
                        value = providerName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Provider") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = providerExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(),
                    )
                    ExposedDropdownMenu(
                        expanded = providerExpanded,
                        onDismissRequest = { providerExpanded = false },
                    ) {
                        Provider.all.forEach { provider ->
                            DropdownMenuItem(
                                text = { Text(provider.name) },
                                onClick = {
                                    providerId = provider.id
                                    pinValue = ""  // provider change invalidates any pin
                                    providerExpanded = false
                                },
                            )
                        }
                    }
                }

                if (hasAnyPinnable) {
                    ExposedDropdownMenuBox(
                        expanded = credentialExpanded,
                        onExpandedChange = { credentialExpanded = !credentialExpanded },
                    ) {
                        OutlinedTextField(
                            value = pinnedLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Credential") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = credentialExpanded) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .menuAnchor(),
                        )
                        ExposedDropdownMenu(
                            expanded = credentialExpanded,
                            onDismissRequest = { credentialExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Any $providerName credential") },
                                onClick = {
                                    pinValue = ""
                                    credentialExpanded = false
                                },
                            )
                            if (matchingCreds.isNotEmpty()) {
                                DropdownMenuItem(
                                    enabled = false,
                                    text = { Text("YOUR CREDENTIALS", color = TextMuted, fontSize = 10.sp) },
                                    onClick = {},
                                )
                                matchingCreds.forEach { c ->
                                    DropdownMenuItem(
                                        text = { Text(c.label) },
                                        onClick = {
                                            pinValue = "cred:${c.id}"
                                            credentialExpanded = false
                                        },
                                    )
                                }
                            }
                            if (matchingGifts.isNotEmpty()) {
                                DropdownMenuItem(
                                    enabled = false,
                                    text = { Text("GIFTS", color = TextMuted, fontSize = 10.sp) },
                                    onClick = {},
                                )
                                matchingGifts.forEach { gc ->
                                    val remaining = formatTokens(giftBudgetRemaining(gc.usedTokens, gc.maxTokens))
                                    DropdownMenuItem(
                                        text = { Text("🎁 ${gc.senderLabel} · $remaining left") },
                                        onClick = {
                                            pinValue = "gift:${gc.giftId}"
                                            credentialExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                    }
                } else {
                    // Inline warning when the chosen provider has no
                    // credentials AND no active gifts. The save still
                    // goes through (permissive mode) but the user is
                    // told up front that this group won't actually work
                    // until a credential is added or a gift is redeemed.
                    Surface(
                        color = BgMain,
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Text("⚠️", fontSize = 14.sp)
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    "No $providerName credential or gift",
                                    color = TextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                )
                                Text(
                                    "This group can be saved, but apps using it will fail until you add a $providerName key or redeem a matching gift.",
                                    color = TextMuted,
                                    fontSize = 11.sp,
                                )
                            }
                        }
                    }
                }

                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("Model (optional)") },
                    placeholder = { Text("e.g. claude-sonnet-4-5") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                if (modelInfo != null) {
                    Text(modelInfo, color = TextMuted, fontSize = 11.sp)
                } else {
                    Text(
                        "Leave empty to pass through. Set to override (required for cross-family routing).",
                        color = TextMuted,
                        fontSize = 11.sp,
                    )
                }

                if (suggestedModels.isNotEmpty()) {
                    Text("Suggested models", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                    suggestedModels.forEach { (id, displayName) ->
                        Surface(
                            onClick = { model = id },
                            color = BgMain,
                            shape = RoundedCornerShape(6.dp),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 8.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(displayName, color = TextPrimary, fontSize = 12.sp)
                                Text(
                                    id,
                                    color = TextMuted,
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                        }
                    }
                }

                error?.let {
                    Text(it, color = Danger, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    try {
                        val credentialPin: String? = if (pinValue.startsWith("cred:")) pinValue.removePrefix("cred:") else null
                        val giftPin: String? = if (pinValue.startsWith("gift:")) pinValue.removePrefix("gift:") else null
                        if (existing == null) {
                            wallet.createGroup(
                                name = name,
                                providerId = providerId,
                                credentialId = credentialPin,
                                giftId = giftPin,
                                model = model.ifEmpty { null },
                            )
                        } else {
                            wallet.updateGroup(
                                id = existing.id,
                                name = if (isDefault) null else name,
                                providerId = providerId,
                                credentialId = credentialPin,
                                unsetCredentialId = credentialPin == null,
                                giftId = giftPin,
                                unsetGiftId = giftPin == null,
                                model = model.ifEmpty { null },
                                unsetModel = model.isEmpty(),
                            )
                        }
                        onDismiss()
                    } catch (t: Throwable) {
                        error = t.message ?: "Failed to save group"
                    }
                },
                enabled = isDefault || name.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

/**
 * Per-app token allowance editor (ported from old SessionsScreen). Total cap
 * + optional per-provider caps. The proxy enforces these on every request.
 */
@Composable
private fun AllowanceDialog(
    origin: String,
    providers: List<String>,
    allowance: TokenAllowance?,
    onSave: (TokenAllowance) -> Unit,
    onRemove: () -> Unit,
    onDismiss: () -> Unit,
) {
    var totalLimit by remember { mutableStateOf(allowance?.totalLimit?.toString() ?: "") }
    var providerLimits by remember {
        mutableStateOf(
            providers.associateWith { id ->
                allowance?.providerLimits?.get(id)?.toString() ?: ""
            }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = { Text("Token Limit", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(origin, color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.Medium)

                OutlinedTextField(
                    value = totalLimit,
                    onValueChange = { totalLimit = it },
                    label = { Text("Total token limit") },
                    placeholder = { Text("Unlimited") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )

                if (providers.isNotEmpty()) {
                    Text("Per provider", color = TextSecondary, fontSize = 12.sp)
                    providers.forEach { id ->
                        OutlinedTextField(
                            value = providerLimits[id] ?: "",
                            onValueChange = { providerLimits = providerLimits + (id to it) },
                            label = { Text(Provider.find(id)?.name ?: id) },
                            placeholder = { Text("Unlimited") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val total = totalLimit.toIntOrNull()?.takeIf { it > 0 }
                val pLimits = providerLimits
                    .mapValues { (_, v) -> v.toIntOrNull() ?: 0 }
                    .filterValues { it > 0 }
                    .takeIf { it.isNotEmpty() }
                onSave(TokenAllowance(origin = origin, totalLimit = total, providerLimits = pLimits))
            }) { Text("Save") }
        },
        dismissButton = {
            Row {
                if (allowance != null) {
                    TextButton(onClick = onRemove) {
                        Text("Remove", color = Danger)
                    }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

private fun formatTokens(count: Int): String {
    return when {
        count >= 1_000_000 -> String.format("%.1fM", count / 1_000_000.0)
        count >= 1_000 -> String.format("%.0fK", count / 1_000.0)
        else -> count.toString()
    }
}
