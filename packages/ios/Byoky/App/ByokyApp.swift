import SwiftUI

@main
struct ByokyApp: App {
    @StateObject private var wallet: WalletStore

    init() {
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
        // interactions and go straight to the screens under test.
        if isUITest {
            Self.autoSetupIfNeeded()
        }

        _wallet = StateObject(wrappedValue: WalletStore.shared)
    }

    private static func autoSetupIfNeeded() {
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard let data = FileManager.default.contents(atPath: configPath),
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
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(wallet)
                .preferredColorScheme(.light)
                // Tapping a .byoky backup in Files, AirDrop or Mail opens it
                // here; the import sheet appears once the wallet is unlocked.
                .onOpenURL { url in
                    guard url.isFileURL else { return }
                    wallet.receiveBackupFile(at: url)
                }
        }
    }
}
