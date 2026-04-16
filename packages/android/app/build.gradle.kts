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
        versionCode = 19
        versionName = "1.0.16"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Live-provider smoke tests pull API keys from environment variables at
        // build time. Empty strings when not set — tests then call assumeTrue()
        // to skip cleanly. Never commit real keys; export them in your shell
        // before running ./gradlew connectedAndroidTest:
        //   export BYOKY_TEST_ANTHROPIC_KEY=sk-ant-...
        //   export BYOKY_TEST_OPENAI_KEY=sk-...
        //   export BYOKY_TEST_GEMINI_KEY=AIza...
        //   export BYOKY_TEST_COHERE_KEY=...
        buildConfigField("String", "TEST_ANTHROPIC_KEY", "\"${System.getenv("BYOKY_TEST_ANTHROPIC_KEY") ?: ""}\"")
        buildConfigField("String", "TEST_OPENAI_KEY", "\"${System.getenv("BYOKY_TEST_OPENAI_KEY") ?: ""}\"")
        buildConfigField("String", "TEST_GEMINI_KEY", "\"${System.getenv("BYOKY_TEST_GEMINI_KEY") ?: ""}\"")
        buildConfigField("String", "TEST_COHERE_KEY", "\"${System.getenv("BYOKY_TEST_COHERE_KEY") ?: ""}\"")
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
        buildConfig = true
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
    implementation("androidx.core:core-splashscreen:1.0.1")
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

    // Instrumented tests for the JS bridge. JavaScriptSandbox needs a real
    // Android runtime + WebView, so these run via `./gradlew connectedAndroidTest`
    // on a connected device or emulator (API ≥ 26 with WebView ≥ 110). Pure
    // JVM unit tests can't exercise the bridge.
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
}
