import SwiftUI

struct SessionsView: View {
    @EnvironmentObject var wallet: WalletStore

    var body: some View {
        NavigationStack {
            List {
                if wallet.sessions.isEmpty {
                    emptyState
                } else {
                    activeSessions
                }
            }
            .navigationTitle("Sessions")
        }
    }

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "link")
                    .font(.system(size: 40))
                    .foregroundStyle(Color(.systemGray3))

                Text("No Active Sessions")
                    .font(.headline)

                Text("When you approve a website to use your API keys, its session will appear here. You can revoke access at any time.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var activeSessions: some View {
        if !wallet.cloudVaultEnabled {
            Section {
                Label("Your device must stay online for connected apps to work. Enable Cloud Vault in Settings for offline access.", systemImage: "wifi")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }

        Section {
            ForEach(Array(wallet.sessions)) { session in
                SessionRow(session: session)
                    .environmentObject(wallet)
            }
        } header: {
            Text("\(wallet.sessions.count) active session\(wallet.sessions.count == 1 ? "" : "s")")
        }
    }
}

struct SessionRow: View {
    @EnvironmentObject var wallet: WalletStore
    let session: Session
    @State private var showAllowanceForm = false

    private var allowance: TokenAllowance? {
        wallet.tokenAllowances.first { $0.origin == session.appOrigin }
    }

    private var tokensUsed: Int {
        wallet.tokenUsage(for: session.appOrigin)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session.appOrigin)
                .font(.body.weight(.medium))

            HStack(spacing: 12) {
                Label("\(session.providers.count) provider\(session.providers.count == 1 ? "" : "s")", systemImage: "cpu")
                Text(session.expiresAt, format: .relative(presentation: .named))
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let allowance, let limit = allowance.totalLimit {
                HStack(spacing: 8) {
                    ProgressView(value: min(Double(tokensUsed) / Double(limit), 1.0))
                        .tint(Double(tokensUsed) / Double(limit) >= 0.8 ? .orange : Theme.accent)

                    Text("\(formatTokens(tokensUsed)) / \(formatTokens(limit))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                HStack(spacing: 4) {
                    Text("\(formatTokens(tokensUsed)) tokens used")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                try? wallet.revokeSession(session)
            } label: {
                Label("Revoke", systemImage: "xmark.circle")
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                showAllowanceForm = true
            } label: {
                Label("Limit", systemImage: "gauge.with.dots.needle.33percent")
            }
            .tint(Theme.accent)
        }
        .sheet(isPresented: $showAllowanceForm) {
            AllowanceFormView(
                origin: session.appOrigin,
                providers: session.providers,
                allowance: allowance
            )
            .environmentObject(wallet)
        }
    }
}

struct AllowanceFormView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    let origin: String
    let providers: [String]
    let allowance: TokenAllowance?

    @State private var totalLimit: String = ""
    @State private var providerLimits: [String: String] = [:]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(origin)
                        .font(.callout.weight(.medium))
                } header: {
                    Text("App")
                }

                Section {
                    TextField("Unlimited", text: $totalLimit)
                        .keyboardType(.numberPad)
                } header: {
                    Text("Total token limit")
                } footer: {
                    Text("Leave empty for unlimited")
                }

                if !providers.isEmpty {
                    Section {
                        ForEach(providers, id: \.self) { providerId in
                            HStack {
                                Text(Provider.find(providerId)?.name ?? providerId)
                                    .font(.callout)
                                Spacer()
                                TextField("Unlimited", text: binding(for: providerId))
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 120)
                            }
                        }
                    } header: {
                        Text("Per provider")
                    }
                }
            }
            .navigationTitle("Token Limit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    if allowance != nil {
                        Button("Remove Limit", role: .destructive) {
                            wallet.removeAllowance(origin: origin)
                            dismiss()
                        }
                        .foregroundStyle(.red)
                    }
                    Spacer()
                }
            }
        }
        .onAppear {
            if let allowance {
                if let limit = allowance.totalLimit {
                    totalLimit = String(limit)
                }
                for (id, limit) in allowance.providerLimits ?? [:] {
                    providerLimits[id] = String(limit)
                }
            }
        }
    }

    private func binding(for providerId: String) -> Binding<String> {
        Binding(
            get: { providerLimits[providerId] ?? "" },
            set: { providerLimits[providerId] = $0 }
        )
    }

    private func save() {
        var parsed = TokenAllowance(origin: origin)

        if let total = Int(totalLimit), total > 0 {
            parsed.totalLimit = total
        }

        var pLimits: [String: Int] = [:]
        for (id, val) in providerLimits {
            if let n = Int(val), n > 0 {
                pLimits[id] = n
            }
        }
        if !pLimits.isEmpty {
            parsed.providerLimits = pLimits
        }

        wallet.setAllowance(parsed)
        dismiss()
    }
}

private func formatTokens(_ count: Int) -> String {
    if count >= 1_000_000 {
        let m = Double(count) / 1_000_000
        return String(format: "%.1fM", m)
    } else if count >= 1_000 {
        let k = Double(count) / 1_000
        return String(format: "%.0fK", k)
    }
    return "\(count)"
}
