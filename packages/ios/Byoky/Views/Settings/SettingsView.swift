import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) private var dismiss
    @State private var showResetWalletConfirm = false
    @State private var showExportBackup = false
    @State private var showBackupPicker = false
    @State private var pickedBackup: PendingBackupFile?

    @State private var debugSelfTestReport: String?

    var body: some View {
        NavigationStack {
            List {
                backupSection
                securitySection
                safariExtensionSection
                #if DEBUG
                translationDebugSection
                #endif
                aboutSection
                dangerZoneSection
            }
            .retroList()
            .retroNavigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("settings.done")
                }
            }
            .sheet(isPresented: $showExportBackup) {
                ExportBackupView()
                    .environmentObject(wallet)
            }
            .fileImporter(isPresented: $showBackupPicker, allowedContentTypes: [.item]) { result in
                guard case .success(let url) = result else { return }
                do {
                    pickedBackup = PendingBackupFile(fileName: url.lastPathComponent, contents: try BackupFile.readFile(at: url))
                } catch {
                    pickedBackup = PendingBackupFile(fileName: url.lastPathComponent, contents: "", readError: error.localizedDescription)
                }
            }
            .sheet(item: $pickedBackup) { file in
                ImportBackupView(file: file)
                    .environmentObject(wallet)
            }
            #if DEBUG
            .sheet(isPresented: Binding(
                get: { debugSelfTestReport != nil },
                set: { if !$0 { debugSelfTestReport = nil } }
            )) {
                NavigationStack {
                    ScrollView {
                        Text(debugSelfTestReport ?? "")
                            .font(.mono(12, relativeTo: .caption))
                            .foregroundStyle(Theme.fog)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                    .background(Theme.ink)
                    .retroNavigationTitle("Self-test")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { debugSelfTestReport = nil }
                        }
                    }
                }
            }
            #endif
            .alert("Reset Wallet?", isPresented: $showResetWalletConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    wallet.resetWallet()
                }
            } message: {
                Text("All keys on this device will be permanently deleted. This cannot be undone.")
            }
        }
    }

    private var backupSection: some View {
        Section {
            Button {
                showExportBackup = true
            } label: {
                Label("Export Backup", systemImage: "square.and.arrow.up")
            }
            .disabled(wallet.credentials.isEmpty)
            .accessibilityIdentifier("settings.exportBackup")

            Button {
                showBackupPicker = true
            } label: {
                Label("Import Backup", systemImage: "square.and.arrow.down")
            }
            .accessibilityIdentifier("settings.importBackup")
        } header: {
            ListHeader("Backup")
        } footer: {
            ListFooter(wallet.credentials.isEmpty
                ? "Add a key before exporting. You can import a .byoky backup from the Byoky extension or another device."
                : "Keys in this app live only on this device. Export an encrypted .byoky file to back them up or move them to another device — the Byoky extension (also in Safari) and Android app can import it too.")
        }
        .retroRow()
    }

    private var dangerZoneSection: some View {
        Section {
            Button(role: .destructive) {
                showResetWalletConfirm = true
            } label: {
                HStack {
                    Label("Reset Wallet", systemImage: "arrow.counterclockwise")
                    Spacer()
                }
                .foregroundStyle(Theme.alarm)
                .contentShape(Rectangle())
            }
        } header: {
            ListHeader("Danger Zone")
        } footer: {
            ListFooter("Reset wallet clears all keys on this device.")
        }
        .retroRow(border: Theme.alarm)
    }

    #if DEBUG
    private var translationDebugSection: some View {
        Section {
            Button {
                Task {
                    // Run on a background queue so the UI stays responsive on
                    // first call (cold-start bundle eval is fast but nonzero).
                    let report = await Task.detached(priority: .userInitiated) {
                        TranslationEngine.shared.runSelfTest()
                    }.value
                    debugSelfTestReport = report
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "ant.circle")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.phosphor)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Run TranslationEngine self-test")
                            .font(.body.weight(.medium))
                            .foregroundStyle(Theme.bone)
                        Text("Verify the @byoky/core JS bundle round-trips a translation")
                            .font(.caption)
                            .foregroundStyle(Theme.fog)
                    }

                    Spacer()
                }
            }
        } header: {
            ListHeader("Translation Engine (debug)")
        }
        .retroRow()
    }
    #endif

    private var securitySection: some View {
        Section {
            Button {
                wallet.lock()
            } label: {
                HStack {
                    Label("Lock Wallet", systemImage: "lock")
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .foregroundStyle(Theme.bone)
            .accessibilityIdentifier("settings.lock")

            infoRow("Encryption", value: "AES-256-GCM")
            infoRow("Key Derivation", value: "PBKDF2 (600K)")
            infoRow("Storage", value: "iOS Keychain")
        } header: {
            ListHeader("Security")
        }
        .retroRow()
    }

    /// The Safari extension that ships with the app is a wallet of its own:
    /// how to turn it on, and how to get these keys into it.
    private var safariExtensionSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Use Byoky in Safari", systemImage: "safari")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.bone)
                SwiftUI.Group {
                    Text("1. Open \(Self.safariExtensionsPath).")
                    Text("2. Turn on Byoky and allow it on the sites you use.")
                    Text("3. In Safari, open Byoky from the extensions menu and set up its wallet.")
                }
                .font(.callout)
                .foregroundStyle(Theme.fog)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("settings.safariExtension")
        } header: {
            ListHeader("Safari extension")
        } footer: {
            ListFooter("The Safari extension is a separate wallet with its own password and keys; keys in this app aren't available there. To use them in Safari, Export Backup here and import the .byoky file in the extension's settings.")
        }
        .retroRow()
    }

    /// Where iOS keeps Safari's extension switches.
    private static var safariExtensionsPath: String {
        if #available(iOS 18, *) {
            return "Settings > Apps > Safari > Extensions"
        }
        return "Settings > Safari > Extensions"
    }

    private var aboutSection: some View {
        Section {
            infoRow("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")

            Link(destination: URL(string: "https://github.com/MichaelLod/byoky")!) {
                Label("GitHub", systemImage: "link")
            }

            Link(destination: URL(string: "https://byoky.com")!) {
                Label("Website", systemImage: "globe")
            }
        } header: {
            ListHeader("About")
        }
        .retroRow()
    }

    /// A fact about the wallet, its value in mono.
    private func infoRow(_ label: String, value: String) -> some View {
        LabeledContent {
            Text(value)
                .font(.mono(13, relativeTo: .callout))
                .foregroundStyle(Theme.fog)
        } label: {
            Text(label)
                .foregroundStyle(Theme.bone)
        }
    }
}
