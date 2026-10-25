package com.byoky.app.ui.screens

import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import com.byoky.app.data.formatTokens
import com.byoky.app.proxy.TranslationEngine
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.DialogButton
import com.byoky.app.ui.components.GhostButton
import com.byoky.app.ui.components.RetroBottomSheet
import com.byoky.app.ui.components.RetroDialog
import com.byoky.app.ui.components.RetroDropdownMenu
import com.byoky.app.ui.components.RetroTextField
import com.byoky.app.ui.components.RetroTopBar
import com.byoky.app.ui.components.SectionLabel
import com.byoky.app.ui.components.Tag
import com.byoky.app.ui.components.dotGrid
import com.byoky.app.ui.components.panel
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The Connected tab — apps that connected to the wallet (from the in-wallet
 * browser), bucketed by group, with per-app routing
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
    val allowances by wallet.tokenAllowances.collectAsState()
    val requestLogs by wallet.requestLogs.collectAsState()
    val context = LocalContext.current
    val engine = remember { TranslationEngine.get(context) }
    val scope = rememberCoroutineScope()

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
        modifier = Modifier
            .background(Void)
            .dotGrid(),
        topBar = {
            RetroTopBar(
                title = "Connected",
                actions = {
                    if (sessions.size > 1) {
                        IconButton(onClick = {
                            sessions.forEach { wallet.revokeSession(it) }
                        }) {
                            Icon(Icons.Default.Close, "Disconnect all", tint = Alarm)
                        }
                    }
                },
            )
        },
        containerColor = Color.Transparent,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding),
            contentPadding = PaddingValues(start = 20.dp, top = 16.dp, end = 20.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                GhostButton(
                    "New group",
                    onClick = { creatingGroup = true },
                    icon = Icons.Default.Add,
                    modifier = Modifier.fillMaxWidth(),
                )
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
                        Box(
                            modifier = Modifier
                                .size(64.dp)
                                .border(1.dp, SeamStrong),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Default.Link, null, tint = Phosphor, modifier = Modifier.size(28.dp))
                        }
                        Spacer(Modifier.height(18.dp))
                        CapsText("No Apps Connected", style = HeadingStyle, color = Bone)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Apps you open from the Apps tab appear here once they connect. Group them, set token limits, and reroute their requests across providers.",
                            color = Fog,
                            textAlign = TextAlign.Center,
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                            modifier = Modifier.padding(horizontal = 16.dp),
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
                val logs = requestLogs
                movingApp = null
                scope.launch {
                    // describeModel blocks on the JS sandbox: off the main thread.
                    val pending = targetGroup?.let {
                        withContext(Dispatchers.IO) { capabilityPendingMove(session, it, logs, engine) }
                    }
                    if (pending != null) {
                        // Defer the move: the warning dialog takes over.
                        pendingMove = pending
                    } else {
                        try { wallet.setAppGroup(session.appOrigin, groupId) } catch (_: Throwable) {}
                    }
                }
            },
            onDismiss = { movingApp = null },
        )
    }

    pendingMove?.let { pending ->
        RetroDialog(
            onDismissRequest = { pendingMove = null },
            title = "Capability mismatch",
            text = {
                val singular = pending.gapLabels.size == 1
                Text(
                    "${pending.displayHost} has used ${pending.gapLabels.joinToString(", ")} in past requests, " +
                        "but ${pending.model} in ${pending.groupName} does not support " +
                        (if (singular) "it" else "one or more of these") +
                        ". Requests using " +
                        (if (singular) "that feature" else "those features") +
                        " will fail until you switch back.",
                )
            },
            confirmButton = {
                DialogButton(
                    "Move anyway",
                    onClick = {
                        try { wallet.setAppGroup(pending.origin, pending.groupId) } catch (_: Throwable) {}
                        pendingMove = null
                    },
                    color = Alarm,
                )
            },
            dismissButton = {
                DialogButton("Cancel", onClick = { pendingMove = null }, color = Fog)
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
    var menuOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .panel()
            .padding(start = 16.dp, top = 12.dp, end = 4.dp, bottom = 16.dp),
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CapsText(
                        group.name,
                        style = HeadingStyle.copy(fontSize = 16.sp),
                        color = Bone,
                        maxLines = 1,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (group.providerId.isNotEmpty()) {
                        Spacer(Modifier.width(8.dp))
                        Tag(provider?.name ?: group.providerId)
                    }
                    if (!group.model.isNullOrEmpty()) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            group.model!!,
                            color = Fog,
                            style = MonoStyle.copy(fontSize = 10.sp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .weight(1f, fill = false)
                                .border(1.dp, Seam)
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    when {
                        group.providerId.isEmpty() -> "No routing — apps use the provider they request"
                        pinnedCred != null -> "Using ${pinnedCred.label}"
                        else -> "Any ${provider?.name ?: group.providerId} credential"
                    },
                    color = Dim,
                    style = MonoStyle.copy(fontSize = 11.sp),
                )
            }
            // The default group stays routing-neutral (ensureDefaultGroup
            // resets it), so it has nothing to edit or delete.
            if (!isDefault) {
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(
                            Icons.Default.MoreVert,
                            "Group menu",
                            tint = Phosphor,
                        )
                    }
                    RetroDropdownMenu(
                        expanded = menuOpen,
                        onDismissRequest = { menuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Edit", color = Bone) },
                            onClick = { menuOpen = false; onEditGroup() },
                            leadingIcon = { Icon(Icons.Default.Edit, null, tint = Phosphor) },
                        )
                        DropdownMenuItem(
                            text = { Text("Delete", color = Alarm) },
                            onClick = { menuOpen = false; onDeleteGroup() },
                            leadingIcon = { Icon(Icons.Default.Delete, null, tint = Alarm) },
                        )
                    }
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
        }

        Spacer(Modifier.height(12.dp))

        if (sessions.isEmpty()) {
            Text(
                if (isDefault) "Apps without an assigned group land here."
                else "Long-press an app and pick this group to move it here.",
                color = Dim,
                fontSize = 12.sp,
                modifier = Modifier
                    .padding(end = 12.dp)
                    .fillMaxWidth()
                    .border(1.dp, Seam)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            )
        } else {
            Column(
                modifier = Modifier.padding(end = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
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
        color = Ash,
        shape = RectangleShape,
        border = BorderStroke(1.dp, Seam),
    ) {
        Column(modifier = Modifier.padding(start = 12.dp, top = 8.dp, end = 4.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .border(1.dp, SeamStrong),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        displayHost.firstOrNull()?.uppercase() ?: "?",
                        color = Lilac,
                        style = MonoStyle.copy(fontSize = 13.sp),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        displayHost,
                        color = Bone,
                        style = MonoStyle.copy(fontSize = 14.sp, lineHeight = 19.sp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        DateUtils.getRelativeTimeSpanString(
                            session.createdAt,
                            System.currentTimeMillis(),
                            DateUtils.MINUTE_IN_MILLIS,
                        ).toString(),
                        color = Dim,
                        style = MonoStyle.copy(fontSize = 11.sp),
                    )
                }
                IconButton(onClick = onEditAllowance) {
                    Icon(
                        Icons.Default.Speed,
                        "Set limit",
                        tint = Phosphor,
                        modifier = Modifier.size(18.dp),
                    )
                }
                IconButton(onClick = onRevoke) {
                    Icon(
                        Icons.Default.Close,
                        "Disconnect",
                        tint = Alarm,
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
                        modifier = Modifier.weight(1f).height(4.dp),
                        color = if (progress >= 0.8f) Amber else Violet,
                        trackColor = Seam,
                        strokeCap = StrokeCap.Butt,
                        gapSize = 0.dp,
                        drawStopIndicator = {},
                    )
                    Text(
                        "${formatTokens(tokensUsed)} / ${formatTokens(limit)}",
                        style = MonoStyle.copy(fontSize = 10.sp),
                        color = Dim,
                        modifier = Modifier.padding(end = 8.dp),
                    )
                }
            } else {
                Text(
                    "${formatTokens(tokensUsed)} tokens used",
                    style = MonoStyle.copy(fontSize = 11.sp),
                    color = Dim,
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

    RetroBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            CapsText(
                "Move app",
                style = HeadingStyle.copy(fontSize = 20.sp, lineHeight = 26.sp),
                color = Bone,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                displayHost,
                color = Fog,
                style = MonoStyle.copy(fontSize = 13.sp),
            )
            Spacer(Modifier.height(16.dp))
            SectionLabel("Move to group")
            Spacer(Modifier.height(8.dp))
            groups.forEach { group ->
                val provider = Provider.find(group.providerId)
                val current = group.id == currentGroupId
                Surface(
                    onClick = { onSelect(group.id) },
                    color = if (current) VioletSoft else Color.Transparent,
                    shape = RectangleShape,
                    border = BorderStroke(1.dp, if (current) Violet else Seam),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                group.name,
                                fontWeight = FontWeight.Medium,
                                color = Bone,
                                fontSize = 14.sp,
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    if (group.providerId.isEmpty()) "No routing"
                                    else provider?.name ?: group.providerId,
                                    color = Fog,
                                    fontSize = 12.sp,
                                )
                                if (!group.model.isNullOrEmpty()) {
                                    Text(" · ", color = Fog, fontSize = 12.sp)
                                    Text(
                                        group.model!!,
                                        color = Fog,
                                        style = MonoStyle,
                                    )
                                }
                            }
                        }
                        if (current) {
                            Icon(Icons.Default.Check, null, tint = Phosphor)
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "The next request from this app will use the group's credential. Cross-family requests are translated on the fly.",
                color = Dim,
                fontSize = 12.sp,
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
    val isDefault = existing?.id == DEFAULT_GROUP_ID

    var name by remember { mutableStateOf(existing?.name ?: "") }
    var providerId by remember { mutableStateOf(existing?.providerId ?: "anthropic") }
    // Pinned credential id, or null for "any credential of the provider".
    var pinnedCredentialId by remember { mutableStateOf(existing?.credentialId) }
    var model by remember { mutableStateOf(existing?.model ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var providerExpanded by remember { mutableStateOf(false) }
    var credentialExpanded by remember { mutableStateOf(false) }

    val matchingCreds = credentials.filter { it.providerId == providerId }
    val providerName = Provider.find(providerId)?.name ?: providerId

    // Resolve the current pin to a display label for the dropdown anchor.
    val pinnedLabel: String = remember(pinnedCredentialId, matchingCreds) {
        matchingCreds.firstOrNull { it.id == pinnedCredentialId }?.label
            ?: "Any $providerName credential"
    }

    // Engine calls block on the JS sandbox, whose first connect is delivered
    // on the main thread: they run on IO, and the results show up when ready.
    val engine = remember { TranslationEngine.get(context) }
    var suggestedModels by remember { mutableStateOf(emptyList<Pair<String, String>>()) }
    LaunchedEffect(providerId, engine.isSupported) {
        suggestedModels = emptyList()
        if (!engine.isSupported) return@LaunchedEffect
        suggestedModels = withContext(Dispatchers.IO) {
            try {
                val json = org.json.JSONArray(engine.getModelsForProvider(providerId))
                (0 until json.length()).map { i ->
                    val obj = json.getJSONObject(i)
                    obj.getString("id") to obj.getString("displayName")
                }
            } catch (_: Throwable) { emptyList() }
        }
    }
    var modelInfo by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model, engine.isSupported) {
        modelInfo = null
        if (!engine.isSupported || model.isEmpty()) return@LaunchedEffect
        modelInfo = withContext(Dispatchers.IO) {
            try {
                val raw = engine.describeModel(model) ?: return@withContext null
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
    }

    RetroDialog(
        onDismissRequest = onDismiss,
        title = when {
            existing == null -> "New Group"
            isDefault -> "Default Group"
            else -> "Edit Group"
        },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 480.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (!isDefault) {
                    RetroTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = "Group name",
                        placeholder = "e.g. Coding",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                ExposedDropdownMenuBox(
                    expanded = providerExpanded,
                    onExpandedChange = { providerExpanded = !providerExpanded },
                ) {
                    RetroTextField(
                        value = providerName,
                        onValueChange = {},
                        readOnly = true,
                        label = "Provider",
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = providerExpanded) },
                        fieldModifier = Modifier.menuAnchor(),
                    )
                    ExposedDropdownMenu(
                        expanded = providerExpanded,
                        onDismissRequest = { providerExpanded = false },
                        shape = RectangleShape,
                        containerColor = Crypt,
                        tonalElevation = 0.dp,
                        shadowElevation = 0.dp,
                        border = BorderStroke(1.dp, SeamStrong),
                    ) {
                        Provider.all.forEach { provider ->
                            DropdownMenuItem(
                                text = { Text(provider.name, color = Bone) },
                                onClick = {
                                    providerId = provider.id
                                    pinnedCredentialId = null  // provider change invalidates any pin
                                    providerExpanded = false
                                },
                            )
                        }
                    }
                }

                if (matchingCreds.isNotEmpty()) {
                    ExposedDropdownMenuBox(
                        expanded = credentialExpanded,
                        onExpandedChange = { credentialExpanded = !credentialExpanded },
                    ) {
                        RetroTextField(
                            value = pinnedLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = "Credential",
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = credentialExpanded) },
                            fieldModifier = Modifier.menuAnchor(),
                        )
                        ExposedDropdownMenu(
                            expanded = credentialExpanded,
                            onDismissRequest = { credentialExpanded = false },
                            shape = RectangleShape,
                            containerColor = Crypt,
                            tonalElevation = 0.dp,
                            shadowElevation = 0.dp,
                            border = BorderStroke(1.dp, SeamStrong),
                        ) {
                            DropdownMenuItem(
                                text = { Text("Any $providerName credential", color = Bone) },
                                onClick = {
                                    pinnedCredentialId = null
                                    credentialExpanded = false
                                },
                            )
                            matchingCreds.forEach { c ->
                                DropdownMenuItem(
                                    text = { Text(c.label, color = Bone) },
                                    onClick = {
                                        pinnedCredentialId = c.id
                                        credentialExpanded = false
                                    },
                                )
                            }
                        }
                    }
                } else {
                    // Inline warning when the chosen provider has no
                    // credential. The save still goes through (permissive
                    // mode) but the user is told up front that this group
                    // won't work until a matching key is added.
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .panel(background = Void, border = Amber.copy(alpha = 0.5f))
                            .padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Icon(Icons.Default.Warning, null, tint = Amber, modifier = Modifier.size(16.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                "No $providerName credential",
                                color = Amber,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                "This group can be saved, but apps using it will fail until you add a $providerName key.",
                                color = Fog,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }

                RetroTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = "Model (optional)",
                    placeholder = "e.g. claude-sonnet-4-5",
                    mono = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                val info = modelInfo
                if (info != null) {
                    Text(info, color = Dim, style = MonoStyle.copy(fontSize = 11.sp))
                } else {
                    Text(
                        "Leave empty to pass through. Set to override (required for cross-family routing).",
                        color = Dim,
                        fontSize = 11.sp,
                    )
                }

                if (suggestedModels.isNotEmpty()) {
                    SectionLabel("Suggested models")
                    suggestedModels.forEach { (id, displayName) ->
                        Surface(
                            onClick = { model = id },
                            color = Void,
                            shape = RectangleShape,
                            border = BorderStroke(1.dp, if (model == id) Violet else Seam),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(displayName, color = Bone, fontSize = 12.sp)
                                Text(
                                    id,
                                    color = Dim,
                                    style = MonoStyle.copy(fontSize = 11.sp),
                                )
                            }
                        }
                    }
                }

                error?.let {
                    Text(it, color = Alarm, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            DialogButton(
                "Save",
                onClick = {
                    try {
                        val credentialPin = pinnedCredentialId?.takeIf { id -> matchingCreds.any { it.id == id } }
                        if (existing == null) {
                            wallet.createGroup(
                                name = name,
                                providerId = providerId,
                                credentialId = credentialPin,
                                model = model.ifEmpty { null },
                            )
                        } else {
                            wallet.updateGroup(
                                id = existing.id,
                                name = if (isDefault) null else name,
                                providerId = providerId,
                                credentialId = credentialPin,
                                unsetCredentialId = credentialPin == null,
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
            )
        },
        dismissButton = {
            DialogButton("Cancel", onClick = onDismiss, color = Fog)
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

    RetroDialog(
        onDismissRequest = onDismiss,
        title = "Token Limit",
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(origin, color = Fog, style = MonoStyle.copy(fontSize = 13.sp))

                RetroTextField(
                    value = totalLimit,
                    onValueChange = { totalLimit = it },
                    label = "Total token limit",
                    placeholder = "Unlimited",
                    mono = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )

                if (providers.isNotEmpty()) {
                    SectionLabel("Per provider")
                    providers.forEach { id ->
                        RetroTextField(
                            value = providerLimits[id] ?: "",
                            onValueChange = { providerLimits = providerLimits + (id to it) },
                            label = Provider.find(id)?.name ?: id,
                            placeholder = "Unlimited",
                            mono = true,
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                    }
                }
            }
        },
        confirmButton = {
            DialogButton("Save", onClick = {
                val total = totalLimit.toIntOrNull()?.takeIf { it > 0 }
                val pLimits = providerLimits
                    .mapValues { (_, v) -> v.toIntOrNull() ?: 0 }
                    .filterValues { it > 0 }
                    .takeIf { it.isNotEmpty() }
                onSave(TokenAllowance(origin = origin, totalLimit = total, providerLimits = pLimits))
            })
        },
        dismissButton = {
            Row {
                if (allowance != null) {
                    DialogButton("Remove", onClick = onRemove, color = Alarm)
                }
                DialogButton("Cancel", onClick = onDismiss, color = Fog)
            }
        },
    )
}
