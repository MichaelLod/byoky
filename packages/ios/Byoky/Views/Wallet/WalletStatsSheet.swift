import SwiftUI

enum WalletStatsRange: String, CaseIterable {
    case day = "24h"
    case week = "7d"
    case month = "30d"
    case all = "All"

    var interval: TimeInterval? {
        switch self {
        case .day: return 86400
        case .week: return 604800
        case .month: return 2592000
        case .all: return nil
        }
    }
}

struct WalletStatsSheet: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) private var dismiss
    let target: WalletStatsTarget

    var body: some View {
        SwiftUI.Group {
            switch target {
            case .credential(let id):
                if let cred = wallet.credentials.first(where: { $0.id == id }) {
                    CredentialStatsView(credential: cred)
                } else {
                    missing
                }
            }
        }
        .background(Theme.bgMain)
        .toolbarBackground(Theme.bgMain, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
            }
        }
    }

    private var missing: some View {
        VStack {
            Text("No data").font(.headline)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CredentialStatsView: View {
    @EnvironmentObject var wallet: WalletStore
    let credential: Credential
    @State private var range: WalletStatsRange = .week

    private var provider: Provider? { Provider.find(credential.providerId) }

    private var logs: [RequestLog] {
        let all = wallet.requestLogs.filter { $0.providerId == credential.providerId && $0.statusCode < 400 }
        guard let interval = range.interval else { return all }
        let cutoff = Date().addingTimeInterval(-interval)
        return all.filter { $0.timestamp > cutoff }
    }

    private var totalInput: Int { logs.reduce(0) { $0 + ($1.inputTokens ?? 0) } }
    private var totalOutput: Int { logs.reduce(0) { $0 + ($1.outputTokens ?? 0) } }

    private var byModel: [(model: String, total: Int, requests: Int)] {
        var map: [String: (total: Int, requests: Int)] = [:]
        for e in logs {
            guard let m = e.model else { continue }
            let prev = map[m] ?? (0, 0)
            map[m] = (prev.total + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), prev.requests + 1)
        }
        return map.map { (model: $0.key, total: $0.value.total, requests: $0.value.requests) }
            .sorted { $0.total > $1.total }
    }

    private var byApp: [(origin: String, total: Int, requests: Int)] {
        var map: [String: (total: Int, requests: Int)] = [:]
        for e in logs {
            let prev = map[e.appOrigin] ?? (0, 0)
            map[e.appOrigin] = (prev.total + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), prev.requests + 1)
        }
        return map.map { (origin: $0.key, total: $0.value.total, requests: $0.value.requests) }
            .sorted { $0.total > $1.total }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                rangePicker

                totalsRow

                if logs.isEmpty {
                    emptySection
                }

                if !byModel.isEmpty {
                    section("By Model") {
                        ForEach(byModel, id: \.model) { row in
                            StatRow(
                                title: row.model,
                                subtitle: "\(row.requests) request\(row.requests == 1 ? "" : "s")",
                                trailing: formatWalletTokens(row.total) + " tokens",
                                monospace: true
                            )
                        }
                    }
                }

                if !byApp.isEmpty {
                    section("By App") {
                        ForEach(byApp, id: \.origin) { row in
                            StatRow(
                                title: hostname(row.origin),
                                subtitle: "\(row.requests) request\(row.requests == 1 ? "" : "s")",
                                trailing: formatWalletTokens(row.total) + " tokens"
                            )
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle(credential.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(provider?.name ?? credential.providerId)
                .font(.subheadline.weight(.semibold))
            Text("Shared across all credentials of this provider")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var rangePicker: some View {
        HStack(spacing: 0) {
            ForEach(WalletStatsRange.allCases, id: \.self) { r in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { range = r }
                } label: {
                    Text(r.rawValue)
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(range == r ? Theme.accent : Color.clear)
                        .foregroundStyle(range == r ? .white : .secondary)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .background(Theme.bgRaised)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var totalsRow: some View {
        HStack(spacing: 12) {
            StatCard(value: "\(logs.count)", label: "Requests")
            StatCard(value: formatWalletTokens(totalInput), label: "Input")
            StatCard(value: formatWalletTokens(totalOutput), label: "Output")
        }
    }

    private var emptySection: some View {
        Text("No usage in this period.")
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 8)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            content()
        }
        .padding(14)
        .background(Theme.bgCard)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func hostname(_ origin: String) -> String {
        URL(string: origin)?.host ?? origin
    }
}

private struct StatCard: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Theme.bgCard)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct StatRow: View {
    let title: String
    var subtitle: String? = nil
    let trailing: String
    var monospace: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(monospace ? .caption.monospaced() : .callout)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(trailing)
                .font(.callout.monospacedDigit())
                .foregroundStyle(.primary)
        }
        .padding(.vertical, 6)
    }
}
