import SwiftUI

struct BridgeView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var isStarting = false

    var body: some View {
        List {
            statusSection
            explainerSection
            if wallet.bridgeStatus.isActive {
                activeInfoSection
            }
        }
    }

    private var statusSection: some View {
        Section {
            VStack(spacing: 20) {
                ZStack {
                    Circle()
                        .fill(statusColor.opacity(0.15))
                        .frame(width: 80, height: 80)
                    Image(systemName: statusIcon)
                        .font(.system(size: 32))
                        .foregroundStyle(statusColor)
                }

                Text(wallet.bridgeStatus.displayText)
                    .font(.headline)

                if case .error(let msg) = wallet.bridgeStatus {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Button {
                    toggleBridge()
                } label: {
                    Text(wallet.bridgeStatus.isActive ? "Stop Bridge" : "Start Bridge")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(wallet.bridgeStatus.isActive ? .red : Theme.accent)
                .disabled(isStarting)
            }
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
    }

    private var explainerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                Label {
                    Text("What is the Bridge?")
                        .font(.subheadline.weight(.semibold))
                } icon: {
                    Image(systemName: "questionmark.circle")
                        .foregroundStyle(Theme.accent)
                }

                Text("The bridge acts as a local proxy between Safari and your API keys. It's needed for:")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    bridgeFeature(
                        icon: "key.horizontal",
                        title: "OAuth Setup Tokens",
                        description: "Claude setup tokens require requests from a non-browser context. The bridge handles this using native iOS networking."
                    )
                    bridgeFeature(
                        icon: "cloud",
                        title: "Remote Tools",
                        description: "Tools like OpenClaw running on remote servers can connect through the relay while the bridge is active."
                    )
                }
            }
            .padding(.vertical, 8)
        } footer: {
            Text("The bridge must remain active while you're using these features. If you switch away from the app, the bridge will pause and resume when you return.")
        }
    }

    private var activeInfoSection: some View {
        Section("Connection Info") {
            if case .active(let port) = wallet.bridgeStatus {
                LabeledContent("Status", value: "Active")
                LabeledContent("Port", value: "\(port)")
                LabeledContent("Credentials", value: "\(wallet.credentials.count) available")
            }
        }
    }

    private func bridgeFeature(icon: String, title: String, description: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(Theme.accent)
                .frame(width: 20, alignment: .center)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.callout.weight(.medium))
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var statusColor: Color {
        switch wallet.bridgeStatus {
        case .inactive: return .secondary
        case .starting: return .orange
        case .active: return .green
        case .error: return .red
        }
    }

    private var statusIcon: String {
        switch wallet.bridgeStatus {
        case .inactive: return "antenna.radiowaves.left.and.right.slash"
        case .starting: return "antenna.radiowaves.left.and.right"
        case .active: return "antenna.radiowaves.left.and.right"
        case .error: return "exclamationmark.triangle"
        }
    }

    private func toggleBridge() {
        if wallet.bridgeStatus.isActive {
            Task {
                await ProxyService.shared.stop()
                wallet.bridgeStatus = .inactive
            }
        } else {
            isStarting = true
            wallet.bridgeStatus = .starting
            Task {
                do {
                    let port = try await ProxyService.shared.start(wallet: wallet)
                    wallet.bridgeStatus = .active(port: port)
                } catch {
                    wallet.bridgeStatus = .error(error.localizedDescription)
                }
                isStarting = false
            }
        }
    }
}
