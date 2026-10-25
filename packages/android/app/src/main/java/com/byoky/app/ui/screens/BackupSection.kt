package com.byoky.app.ui.screens

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import com.byoky.app.data.BackupFile
import com.byoky.app.data.PasswordStrength
import com.byoky.app.data.UnlockResult
import com.byoky.app.data.WalletBackup
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

/** A picked backup file, already read off the main thread. */
private data class PickedBackup(val name: String, val contents: String)

private data class ResultMessage(val title: String, val body: String)

/**
 * Settings card for `.byoky` backups: export every key to a password-protected
 * file (Storage Access Framework, so it can go to Files, Drive or anywhere a
 * provider offers) and import one back, merging into this wallet.
 */
@Composable
fun BackupSection(wallet: WalletStore) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val credentials by wallet.credentials.collectAsState()
    val backup = remember(wallet) { WalletBackup(wallet) }

    // Progress is published from worker threads; a StateFlow keeps that safe.
    val progressFlow = remember { MutableStateFlow<WalletBackup.Progress?>(null) }
    val progress by progressFlow.collectAsState()

    var showExportPassword by remember { mutableStateOf(false) }
    var pendingExportPassword by remember { mutableStateOf<String?>(null) }
    var pickedImport by remember { mutableStateOf<PickedBackup?>(null) }
    var importError by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<ResultMessage?>(null) }
    // The running export/import, so the progress dialog can cancel it.
    var job by remember { mutableStateOf<Job?>(null) }

    val createDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val password = pendingExportPassword
        pendingExportPassword = null
        if (uri == null) return@rememberLauncherForActivityResult
        if (password == null) {
            // The screen was recreated while the picker was open and the
            // password (deliberately never persisted) is gone. Don't leave
            // an empty file behind.
            scope.launch {
                withContext(Dispatchers.IO) { deleteDocumentQuietly(context, uri) }
                result = ResultMessage("Export interrupted", "Please start the export again.")
            }
            return@rememberLauncherForActivityResult
        }
        job = scope.launch {
            progressFlow.value = WalletBackup.Progress("Reading keys…", 0, 0)
            try {
                val contents = backup.export(password) { progressFlow.value = it }
                withContext(Dispatchers.IO) { writeDocument(context, uri, contents) }
                val count = credentials.size
                result = ResultMessage(
                    "Backup saved",
                    "Exported $count key${if (count == 1) "" else "s"}. Anyone with this file and its password can use your keys, so store both safely.",
                )
            } catch (e: CancellationException) {
                // Cancelled or left the screen mid-export: remove the partial file.
                withContext(NonCancellable + Dispatchers.IO) { deleteDocumentQuietly(context, uri) }
                result = ResultMessage("Export cancelled", "No backup file was saved.")
                throw e
            } catch (e: Exception) {
                withContext(Dispatchers.IO) { deleteDocumentQuietly(context, uri) }
                result = ResultMessage("Export failed", e.message ?: "Could not write the backup file.")
            } finally {
                progressFlow.value = null
            }
        }
    }

    val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                pickedImport = withContext(Dispatchers.IO) { readBackupFile(context, uri) }
                importError = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                result = ResultMessage("Can't open file", e.message ?: "The file could not be read.")
            }
        }
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("Backup", fontWeight = FontWeight.SemiBold, color = TextPrimary)
            Spacer(Modifier.height(4.dp))
            Text(
                "Move keys to another phone or the browser extension with a password-protected .byoky file. Nothing is uploaded anywhere.",
                color = TextSecondary,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(12.dp))
            BackupRow(
                icon = { Icon(Icons.Default.Upload, null, tint = if (credentials.isEmpty()) TextMuted else Accent, modifier = Modifier.size(20.dp)) },
                title = "Export backup",
                subtitle = if (credentials.isEmpty()) "Add keys before exporting" else null,
                enabled = credentials.isNotEmpty() && progress == null,
                onClick = { showExportPassword = true },
            )
            BackupRow(
                icon = { Icon(Icons.Default.Download, null, tint = Accent, modifier = Modifier.size(20.dp)) },
                title = "Import backup",
                subtitle = null,
                enabled = progress == null,
                onClick = { openDocument.launch(arrayOf("*/*")) },
            )
        }
    }

    if (showExportPassword) {
        ExportPasswordDialog(
            wallet = wallet,
            onDismiss = { showExportPassword = false },
            onConfirm = { password ->
                showExportPassword = false
                pendingExportPassword = password
                createDocument.launch("byoky-backup-${LocalDate.now()}.byoky")
            },
        )
    }

    val picked = pickedImport
    if (picked != null && progress == null) {
        ImportPasswordDialog(
            fileName = picked.name,
            error = importError,
            onDismiss = { pickedImport = null; importError = null },
            onConfirm = { password ->
                importError = null
                job = scope.launch {
                    progressFlow.value = WalletBackup.Progress("Unlocking backup…", 0, 0)
                    try {
                        val summary = backup.import(picked.contents, password) { progressFlow.value = it }
                        pickedImport = null
                        result = ResultMessage("Import complete", importSummaryText(summary))
                    } catch (e: BackupFile.BackupException) {
                        // Keep the dialog open so a mistyped password can be retried.
                        importError = e.message
                    } catch (e: CancellationException) {
                        // Only offered before anything is written.
                        pickedImport = null
                        result = ResultMessage("Import cancelled", "Nothing was changed.")
                        throw e
                    } catch (e: Exception) {
                        pickedImport = null
                        result = ResultMessage("Import failed", e.message ?: "The backup could not be imported.")
                    } finally {
                        progressFlow.value = null
                    }
                }
            },
        )
    }

    progress?.let { p ->
        BackupProgressDialog(p, onCancel = if (p.cancellable) ({ job?.cancel() }) else null)
    }

    result?.let { message ->
        AlertDialog(
            onDismissRequest = { result = null },
            containerColor = BgCard,
            title = { Text(message.title, color = TextPrimary) },
            text = { Text(message.body, color = TextSecondary, fontSize = 13.sp) },
            confirmButton = { TextButton(onClick = { result = null }) { Text("OK") } },
        )
    }
}

private fun importSummaryText(summary: WalletBackup.ImportSummary): String {
    if (summary.imported == 0 && summary.skipped == 0) return "The backup contains no keys."
    val lines = mutableListOf("Imported ${summary.imported}, skipped ${summary.skipped}.")
    if (summary.duplicates > 0) {
        lines += "${summary.duplicates} already in this wallet."
    }
    if (summary.unsupported > 0) {
        lines += "${summary.unsupported} not usable on Android (unknown provider, missing or unsafe server URL, or a sign-in that needs refreshing)."
    }
    if (summary.invalidKeys > 0) {
        lines += "${summary.invalidKeys} with a character API keys never have, often an invisible one picked up while copying. Add ${if (summary.invalidKeys == 1) "it" else "them"} again by hand."
    }
    return lines.joinToString("\n")
}

@Composable
private fun BackupRow(
    icon: @Composable () -> Unit,
    title: String,
    subtitle: String?,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        color = BgCard,
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon()
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, color = if (enabled) TextPrimary else TextMuted)
                if (subtitle != null) Text(subtitle, color = TextMuted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    isError: Boolean = false,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        isError = isError,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                    contentDescription = if (visible) "Hide password" else "Show password",
                    tint = TextMuted,
                )
            }
        },
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Export needs the wallet's master password again (re-auth: an unlocked
 * phone alone must not be enough to take every key away), plus a new export
 * password following the extension's rule: 12+ characters, strength ≥ 2.
 */
@Composable
private fun ExportPasswordDialog(wallet: WalletStore, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var walletPassword by remember { mutableStateOf("") }
    var walletPasswordError by remember { mutableStateOf<String?>(null) }
    var verifying by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    val strength = remember(password) { PasswordStrength.check(password) }
    val strongEnough = PasswordStrength.isAcceptableForExport(password)
    val matches = password == confirm

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = { Text("Export backup", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Confirm it's you, then choose a password to encrypt the backup. You'll need that password to import the file on another device; it can't be recovered.",
                    color = TextSecondary,
                    fontSize = 13.sp,
                )
                PasswordField(
                    walletPassword,
                    { walletPassword = it; walletPasswordError = null },
                    "Wallet password",
                    isError = walletPasswordError != null,
                )
                walletPasswordError?.let { Text(it, color = Danger, fontSize = 12.sp) }
                PasswordField(password, { password = it }, "Export password")
                if (password.isNotEmpty()) {
                    val color = when (strength.score) {
                        0, 1 -> Danger
                        2 -> Warning
                        else -> Success
                    }
                    Column {
                        LinearProgressIndicator(
                            progress = { (strength.score + 1) / 5f },
                            modifier = Modifier.fillMaxWidth().height(4.dp),
                            color = color,
                            trackColor = BgHover,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            strength.label + (strength.feedback.firstOrNull()?.let { " · $it" } ?: ""),
                            color = color,
                            fontSize = 12.sp,
                        )
                    }
                }
                PasswordField(
                    confirm,
                    { confirm = it },
                    "Confirm password",
                    isError = confirm.isNotEmpty() && !matches,
                )
                if (confirm.isNotEmpty() && !matches) {
                    Text("Passwords do not match", color = Danger, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    verifying = true
                    scope.launch {
                        when (val r = wallet.confirmMasterPassword(walletPassword)) {
                            is UnlockResult.Success -> onConfirm(password)
                            is UnlockResult.WrongPassword -> walletPasswordError = "Wrong wallet password"
                            is UnlockResult.LockedOut -> walletPasswordError = "Too many attempts. Try again in ${r.secondsRemaining}s"
                        }
                        verifying = false
                    }
                },
                enabled = walletPassword.isNotEmpty() && strongEnough && matches && !verifying,
            ) { Text(if (verifying) "Checking…" else "Choose location") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !verifying) { Text("Cancel") } },
    )
}

@Composable
private fun ImportPasswordDialog(
    fileName: String,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = { Text("Import backup", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(fileName, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Text(
                    "Keys from the file are added to this wallet. Existing keys are never replaced or deleted, and exact duplicates are skipped.",
                    color = TextSecondary,
                    fontSize = 13.sp,
                )
                PasswordField(password, { password = it }, "Backup password", isError = error != null)
                error?.let { Text(it, color = Danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(password) }, enabled = password.isNotEmpty()) { Text("Import") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun BackupProgressDialog(progress: WalletBackup.Progress, onCancel: (() -> Unit)?) {
    AlertDialog(
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
        containerColor = BgCard,
        title = { Text(progress.message, color = TextPrimary, fontSize = 16.sp) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (progress.total > 0) {
                    LinearProgressIndicator(
                        progress = { progress.done.toFloat() / progress.total },
                        modifier = Modifier.fillMaxWidth(),
                        color = Accent,
                        trackColor = BgHover,
                    )
                    Text("${progress.done} of ${progress.total}", color = TextMuted, fontSize = 12.sp)
                } else {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Accent, trackColor = BgHover)
                }
                Text(
                    "Each key is protected with 600,000 rounds of key stretching, so this can take a moment.",
                    color = TextSecondary,
                    fontSize = 12.sp,
                )
            }
        },
        confirmButton = {},
        dismissButton = onCancel?.let { cancel -> { TextButton(onClick = cancel) { Text("Cancel") } } },
    )
}

// ── Storage Access Framework I/O (call on Dispatchers.IO) ────────────────

private fun readBackupFile(context: Context, uri: Uri): PickedBackup {
    val resolver = context.contentResolver
    var name = "backup.byoky"
    var declaredSize: Long? = null
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) declaredSize = cursor.getLong(sizeIndex)
        }
    }
    val tooLarge = "This file is larger than 10 MB, so it isn't a Byoky backup."
    if ((declaredSize ?: 0L) > BackupFile.MAX_FILE_BYTES) throw BackupFile.BackupException(tooLarge)

    // Read with a hard cap: the declared size can be missing or wrong.
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            total += read
            if (total > BackupFile.MAX_FILE_BYTES) throw BackupFile.BackupException(tooLarge)
            out.write(buffer, 0, read)
        }
        out.toByteArray()
    } ?: throw BackupFile.BackupException("The file could not be opened.")
    return PickedBackup(name, String(bytes, Charsets.UTF_8))
}

private fun writeDocument(context: Context, uri: Uri, contents: String) {
    val resolver = context.contentResolver
    val stream = try {
        resolver.openOutputStream(uri, "wt")
    } catch (_: Exception) {
        // Some providers don't support truncate mode; the document is new anyway.
        resolver.openOutputStream(uri, "w")
    } ?: throw IllegalStateException("Could not open the destination for writing")
    stream.use { it.write(contents.toByteArray(Charsets.UTF_8)) }
}

private fun deleteDocumentQuietly(context: Context, uri: Uri) {
    try { DocumentsContract.deleteDocument(context.contentResolver, uri) } catch (_: Exception) {}
}
