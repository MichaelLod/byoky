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
        .background(ScreenBackground())
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
            }
        }
    }

    private var missing: some View {
        VStack {
            PromptLine("No data")
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
                                trailing: formatWalletTokens(row.total) + " tokens",
                                monospace: true
                            )
                        }
                    }
                }
            }
            .padding()
        }
        .retroNavigationTitle(credential.label)
    }

    private var header: some View {
        HStack(spacing: 12) {
            ProviderTile(providerId: credential.providerId, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(provider?.name ?? credential.providerId)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.bone)
                Text("Shared across all credentials of this provider")
                    .font(.caption)
                    .foregroundStyle(Theme.fog)
            }
        }
    }

    private var rangePicker: some View {
        HStack(spacing: 0) {
            ForEach(WalletStatsRange.allCases, id: \.self) { r in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { range = r }
                } label: {
                    Text(r.rawValue)
                        .uppercaseDisplay()
                        .font(.mono(13, weight: .medium, relativeTo: .subheadline))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(range == r ? Theme.violet : Color.clear)
                        .foregroundStyle(range == r ? .white : Theme.fog)
                }
            }
        }
        .background(Theme.void)
        .overlay(Rectangle().strokeBorder(Theme.seamStrong, lineWidth: 1))
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
            .foregroundStyle(Theme.fog)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 8)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .retroCard()
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
                .font(.mono(20, weight: .medium, relativeTo: .title3))
                .foregroundStyle(Theme.bone)
            Text(label)
                .uppercaseDisplay()
                .font(.mono(10, relativeTo: .caption2))
                .tracking(1)
                .foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .retroCard()
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
                    .font(monospace ? .mono(12, relativeTo: .caption) : .callout)
                    .foregroundStyle(Theme.bone)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let subtitle {
                    Text(subtitle)
                        .font(.mono(11, relativeTo: .caption2))
                        .foregroundStyle(Theme.dim)
                }
            }
            Spacer()
            Text(trailing)
                .font(.mono(13, relativeTo: .callout))
                .foregroundStyle(Theme.bone)
        }
        .padding(.vertical, 6)
    }
}
