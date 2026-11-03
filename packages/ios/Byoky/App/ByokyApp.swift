import SwiftUI

@main
struct ByokyApp: App {
    @StateObject private var wallet: WalletStore

    init() {
        // UI-test launch hooks; compiled out of release builds so no launch
        // argument can wipe or pre-fill a shipped wallet.
        #if DEBUG
        let args = CommandLine.arguments
        let isUITest = args.contains("-byokyUITest")
        let shouldReset = args.contains("-byokyResetOnLaunch")

        if shouldReset {
            WalletStore.shared.resetWallet()
        }

        // Test-only fast path: if a config file exists at
        // /tmp/byoky-ios-test-config.json with a `geminiKey` (or other
        // provider keys), auto-create the wallet + import the keys so the
        // XCUITest can skip the onboarding + add-credential form
        // interactions and go straight to the screens under test. A UI test
        // can pass the same JSON in the BYOKY_UITEST_CONFIG environment
        // variable instead.
        if isUITest {
            Self.autoSetupIfNeeded()
        }
        #endif

        _wallet = StateObject(wrappedValue: WalletStore.shared)
        Theme.applyAppearance()
    }

    #if DEBUG
    private static func autoSetupIfNeeded() {
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard let data = ProcessInfo.processInfo.environment["BYOKY_UITEST_CONFIG"].map({ Data($0.utf8) })
                ?? FileManager.default.contents(atPath: configPath),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        let w = WalletStore.shared
        if w.status == .uninitialized {
            let password = (config["password"] as? String) ?? "UITestDefault1234!"
            try? w.createPassword(password)

            if let geminiKey = config["geminiKey"] as? String, !geminiKey.isEmpty {
                try? w.addCredential(providerId: "gemini", label: "Google Gemini", apiKey: geminiKey)
            }
            if let anthropicKey = config["anthropicKey"] as? String, !anthropicKey.isEmpty {
                try? w.addCredential(providerId: "anthropic", label: "Anthropic", apiKey: anthropicKey)
            }
            if let openaiKey = config["openaiKey"] as? String, !openaiKey.isEmpty {
                try? w.addCredential(providerId: "openai", label: "OpenAI", apiKey: openaiKey)
            }
            // Apps already connected, as if each had connected in the
            // in-wallet browser: `connectedApps: ["https://…"]`.
            for origin in config["connectedApps"] as? [String] ?? [] {
                try? w.upsertSession(appOrigin: origin, providers: w.credentials.map(\.providerId))
            }
        }
    }
    #endif

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(wallet)
                // The design is dark only.
                .preferredColorScheme(.dark)
                .tint(Theme.phosphor)
                // Tapping a .byoky backup in Files, AirDrop or Mail opens it
                // here; the import sheet appears once the wallet is unlocked.
                .onOpenURL { url in
                    guard url.isFileURL else { return }
                    wallet.receiveBackupFile(at: url)
                }
        }
    }
}
