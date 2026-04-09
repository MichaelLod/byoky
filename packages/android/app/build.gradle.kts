plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

import java.io.FileInputStream
import java.util.Properties

val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) load(FileInputStream(keystorePropsFile))
}

android {
    namespace = "com.byoky.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.byoky.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 10
        versionName = "1.0.9"
    }

    if (keystorePropsFile.exists()) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(keystoreProps["STORE_FILE"] as String)
                storePassword = keystoreProps["STORE_PASSWORD"] as String
                keyAlias = keystoreProps["KEY_ALIAS"] as String
                keyPassword = keystoreProps["KEY_PASSWORD"] as String
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePropsFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

// Sync the @byoky/core mobile bundle into assets before any build that
// packages resources. The canonical bundle lives at
// packages/core/dist/mobile.js (built by `pnpm --filter @byoky/core build`)
// and the script in scripts/sync-mobile-bundle.sh copies it into both
// mobile app trees. This task is a fail-fast guard so a build never
// silently uses a stale or missing assets/mobile.js.
tasks.register("verifyMobileBundle") {
    description = "Verify the @byoky/core mobile.js bundle is present in assets."
    group = "verification"
    doLast {
        val bundle = file("src/main/assets/mobile.js")
        if (!bundle.exists()) {
            throw GradleException(
                "Missing src/main/assets/mobile.js. Run from the repo root:\n" +
                "  pnpm --filter @byoky/core build && ./scripts/sync-mobile-bundle.sh"
            )
        }
        logger.lifecycle("verifyMobileBundle: ${bundle.length()} bytes ok")
    }
}

tasks.matching { it.name == "preBuild" }.configureEach {
    dependsOn("verifyMobileBundle")
}

dependencies {
    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")

    // Compose
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    // Security / Crypto
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JavaScript engine for the cross-family translation bridge.
    // We embed the @byoky/core IIFE bundle (assets/mobile.js) and run it via
    // Google's V8-backed sandbox so the translate layer is the same code on
    // mobile and desktop. Out-of-process for security — even a JS-side bug
    // can't reach credentials in the main process. Min API 26 (matches our
    // minSdk). Available on devices with WebView 110+ (Android 12L+ in
    // practice; gracefully degrades by throwing on older devices).
    implementation("androidx.javascriptengine:javascriptengine:1.0.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // kotlinx-coroutines-guava: lets us await ListenableFuture results from
    // suspend functions. Pinned to the 1.7.3 line that's already pulled in
    // transitively by androidx.lifecycle, to avoid two coroutines versions
    // colliding on the classpath.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.7.3")

    // CameraX (QR scanner)
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")

    // ML Kit Barcode Scanning
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // Lifecycle (for auto-lock)
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")

    // Debug
    debugImplementation("androidx.compose.ui:ui-tooling")
}
