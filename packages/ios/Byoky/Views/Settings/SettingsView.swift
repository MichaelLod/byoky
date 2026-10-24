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
                #if DEBUG
                translationDebugSection
                #endif
                aboutSection
                dangerZoneSection
            }
            .navigationTitle("Settings")
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
                            .font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                    .navigationTitle("Self-test")
                    .navigationBarTitleDisplayMode(.inline)
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
            Text("Backup")
        } footer: {
            Text(wallet.credentials.isEmpty
                ? "Add a key before exporting. You can import a .byoky backup from the Byoky extension or another device."
                : "Keys live only on this device. Export an encrypted .byoky file to back them up or move them to another device — the Byoky extension and Android app can import it too.")
        }
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
                .contentShape(Rectangle())
            }
        } header: {
            Text("Danger Zone")
        } footer: {
            Text("Reset wallet clears all keys on this device.")
        }
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
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Run TranslationEngine self-test")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Verify the @byoky/core JS bundle round-trips a translation")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }
            }
        } header: {
            Text("Translation Engine (debug)")
        }
    }
    #endif

    private var securitySection: some View {
        Section("Security") {
            Button {
                wallet.lock()
            } label: {
                HStack {
                    Label("Lock Wallet", systemImage: "lock")
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .foregroundStyle(.primary)
            .accessibilityIdentifier("settings.lock")

            LabeledContent("Encryption", value: "AES-256-GCM")
            LabeledContent("Key Derivation", value: "PBKDF2 (600K)")
            LabeledContent("Storage", value: "iOS Keychain")
        }
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")

            Link(destination: URL(string: "https://github.com/MichaelLod/byoky")!) {
                Label("GitHub", systemImage: "link")
            }

            Link(destination: URL(string: "https://byoky.com")!) {
                Label("Website", systemImage: "globe")
            }
        }
    }
}
