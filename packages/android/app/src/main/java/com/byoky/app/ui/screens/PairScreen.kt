package com.byoky.app.ui.screens

import android.Manifest
import android.util.Log
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.byoky.app.data.WalletStore
import com.byoky.app.relay.PairPayload
import com.byoky.app.relay.PairStatus
import com.byoky.app.relay.RelayPairService
import com.byoky.app.ui.theme.*
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairScreen(wallet: WalletStore, pairService: RelayPairService) {
    val status by pairService.status.collectAsState()
    val requestCount by pairService.requestCount.collectAsState()
    val credentials by wallet.credentials.collectAsState()
    var showScanner by remember { mutableStateOf(false) }
    var manualCode by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Pair") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (status) {
                PairStatus.IDLE -> IdleContent(
                    manualCode = manualCode,
                    onManualCodeChange = { manualCode = it },
                    onScanClick = { showScanner = true },
                    onConnect = {
                        connectWithCode(it, pairService, wallet)
                    },
                )
                PairStatus.CONNECTING -> ConnectingContent()
                PairStatus.PAIRED -> PairedContent(
                    appOrigin = status.appOrigin ?: "",
                    requestCount = requestCount,
                    credentialCount = credentials.size,
                    onDisconnect = { pairService.disconnect() },
                )
                PairStatus.ERROR -> ErrorContent(
                    message = status.errorMessage ?: "Unknown error",
                    onRetry = { pairService.disconnect() },
                )
            }
        }

        if (showScanner) {
            QRScannerDialog(
                onCode = { code ->
                    showScanner = false
                    connectWithCode(code, pairService, wallet)
                },
                onDismiss = { showScanner = false },
            )
        }
    }
}

private fun connectWithCode(code: String, pairService: RelayPairService, wallet: WalletStore) {
    val cleaned = code.trim()
    val payload = PairPayload.decode(cleaned)
    if (payload == null) {
        pairService.disconnect()
        // Set error state
        return
    }
    pairService.connect(payload, wallet)
}

@Composable
private fun IdleContent(
    manualCode: String,
    onManualCodeChange: (String) -> Unit,
    onScanClick: () -> Unit,
    onConnect: (String) -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(AccentSoft),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.QrCodeScanner, null, tint = Accent, modifier = Modifier.size(36.dp))
            }

            Spacer(Modifier.height(16.dp))

            Text("Pair with Web App", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 18.sp)

            Spacer(Modifier.height(8.dp))

            Text(
                "Scan the QR code shown on the web app, or paste the pairing code below. Your phone becomes the wallet \u2014 keys never leave this device. Keep the app open while using the web app.",
                color = TextSecondary,
                textAlign = TextAlign.Center,
                fontSize = 14.sp,
            )

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = onScanClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Icon(Icons.Default.CameraAlt, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Scan QR Code", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    Spacer(Modifier.height(16.dp))

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
        ) {
            Text("Manual Entry", fontWeight = FontWeight.SemiBold, color = TextSecondary, fontSize = 12.sp)

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = manualCode,
                onValueChange = onManualCodeChange,
                placeholder = { Text("Paste pairing code") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Border,
                    focusedContainerColor = BgRaised,
                    unfocusedContainerColor = BgRaised,
                ),
                shape = RoundedCornerShape(12.dp),
            )

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = { onConnect(manualCode) },
                enabled = manualCode.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                Text("Connect")
            }

            Spacer(Modifier.height(8.dp))

            Text(
                "Copy the pairing code from the web app and paste it here.",
                color = TextMuted,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun ColumnScope.ConnectingContent() {
    Spacer(Modifier.weight(1f))

    CircularProgressIndicator(color = Accent, modifier = Modifier.size(48.dp).align(Alignment.CenterHorizontally))

    Spacer(Modifier.height(16.dp))

    Text("Connecting to web app...", color = TextSecondary, modifier = Modifier.align(Alignment.CenterHorizontally))

    Spacer(Modifier.weight(1f))
}

@Composable
private fun PairedContent(
    appOrigin: String,
    requestCount: Int,
    credentialCount: Int,
    onDisconnect: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(Success.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.CheckCircle, null, tint = Success, modifier = Modifier.size(36.dp))
            }

            Spacer(Modifier.height(16.dp))

            Text("Connected", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 18.sp)

            Spacer(Modifier.height(4.dp))

            Text(appOrigin, color = TextSecondary, fontSize = 14.sp)
        }
    }

    Spacer(Modifier.height(16.dp))

    // Keep app open warning
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Default.Warning, null, tint = Warning, modifier = Modifier.size(24.dp))
            Column {
                Text("Keep this app open", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 14.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "API calls are proxied through your phone. Locking your phone or switching apps will pause the connection.",
                    color = TextSecondary,
                    fontSize = 12.sp,
                )
            }
        }
    }

    Spacer(Modifier.height(16.dp))

    // Stats
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            InfoRow("Requests proxied", "$requestCount")
            InfoRow("Credentials available", "$credentialCount")
        }
    }

    Spacer(Modifier.height(16.dp))

    Button(
        onClick = onDisconnect,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Danger),
    ) {
        Icon(Icons.Default.Close, null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Disconnect", fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ColumnScope.ErrorContent(message: String, onRetry: () -> Unit) {
    Spacer(Modifier.weight(1f))

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(Warning.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Warning, null, tint = Warning, modifier = Modifier.size(36.dp))
            }

            Spacer(Modifier.height(16.dp))

            Text("Connection Failed", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 18.sp)

            Spacer(Modifier.height(8.dp))

            Text(message, color = TextSecondary, textAlign = TextAlign.Center, fontSize = 14.sp)

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = onRetry,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Text("Try Again", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    Spacer(Modifier.weight(1f))
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = TextSecondary, fontSize = 14.sp)
        Text(value, color = TextPrimary, fontSize = 14.sp)
    }
}

// QR Scanner Dialog
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QRScannerDialog(
    onCode: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasCameraPermission by remember { mutableStateOf(false) }
    var found by remember { mutableStateOf(false) }

    // Check permission
    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        contract = androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        if (!granted) onDismiss()
    }

    LaunchedEffect(Unit) {
        val result = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
        if (result == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            hasCameraPermission = true
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    if (!hasCameraPermission) return

    BasicAlertDialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(0.75f),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = BgCard),
        ) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Scan QR Code", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, "Close", tint = TextSecondary)
                    }
                }

                AndroidView(
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(bottomStart = 16.dp, bottomEnd = 16.dp)),
                    factory = { ctx ->
                        val previewView = PreviewView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT,
                            )
                            scaleType = PreviewView.ScaleType.FILL_CENTER
                        }

                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()

                            val preview = Preview.Builder().build().also {
                                it.surfaceProvider = previewView.surfaceProvider
                            }

                            val barcodeScanner = BarcodeScanning.getClient()
                            val executor = Executors.newSingleThreadExecutor()

                            val imageAnalysis = ImageAnalysis.Builder()
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .build()
                                .also { analysis ->
                                    analysis.setAnalyzer(executor) { imageProxy ->
                                        processImage(imageProxy, barcodeScanner) { code ->
                                            if (!found) {
                                                found = true
                                                onCode(code)
                                            }
                                        }
                                    }
                                }

                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    CameraSelector.DEFAULT_BACK_CAMERA,
                                    preview,
                                    imageAnalysis,
                                )
                            } catch (e: Exception) {
                                Log.e("QRScanner", "Camera binding failed", e)
                            }
                        }, ContextCompat.getMainExecutor(ctx))

                        previewView
                    },
                )
            }
        }
    }
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun processImage(
    imageProxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    onCode: (String) -> Unit,
) {
    val mediaImage = imageProxy.image
    if (mediaImage == null) {
        imageProxy.close()
        return
    }

    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
    scanner.process(image)
        .addOnSuccessListener { barcodes ->
            for (barcode in barcodes) {
                barcode.rawValue?.let { onCode(it) }
            }
        }
        .addOnCompleteListener {
            imageProxy.close()
        }
}
