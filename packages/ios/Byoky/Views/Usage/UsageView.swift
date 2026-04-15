import SwiftUI

enum TimeRange: String, CaseIterable {
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

struct UsageView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var range: TimeRange = .week

    private var filtered: [RequestLog] {
        guard let interval = range.interval else { return wallet.requestLogs }
        let cutoff = Date().addingTimeInterval(-interval)
        return wallet.requestLogs.filter { $0.timestamp > cutoff }
    }

    private var successful: [RequestLog] {
        filtered.filter { $0.statusCode < 400 }
    }

    private var totalInput: Int {
        successful.reduce(0) { $0 + ($1.inputTokens ?? 0) }
    }

    private var totalOutput: Int {
        successful.reduce(0) { $0 + ($1.outputTokens ?? 0) }
    }

    private var byProvider: [(providerId: String, requests: Int, input: Int, output: Int)] {
        var map: [String: (requests: Int, input: Int, output: Int)] = [:]
        for entry in successful {
            let prev = map[entry.providerId] ?? (0, 0, 0)
            map[entry.providerId] = (
                prev.requests + 1,
                prev.input + (entry.inputTokens ?? 0),
                prev.output + (entry.outputTokens ?? 0)
            )
        }
        return map.map { (providerId: $0.key, requests: $0.value.requests, input: $0.value.input, output: $0.value.output) }
            .sorted { ($0.input + $0.output) > ($1.input + $1.output) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    rangePicker
                    totalsSection
                    if !byProvider.isEmpty {
                        providerSection
                    }
                }
                .padding()
            }
            .background(Theme.bgMain)
            .toolbarBackground(Theme.bgMain, for: .navigationBar)
            .navigationTitle("Usage")
        }
    }

    private var rangePicker: some View {
        HStack(spacing: 0) {
            ForEach(TimeRange.allCases, id: \.self) { r in
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
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var totalsSection: some View {
        HStack(spacing: 12) {
            statCard(value: successful.count, label: "Requests")
            statCard(value: totalInput, label: "Input tokens", format: true)
            statCard(value: totalOutput, label: "Output tokens", format: true)
        }
    }

    private func statCard(value: Int, label: String, format: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(format ? formatTokens(value) : "\(value)")
                .font(.title2.weight(.bold).monospacedDigit())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(Theme.bgCard)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var providerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("By Provider")
                .font(.headline)
                .padding(.top, 4)

            ForEach(byProvider, id: \.providerId) { p in
                let provider = Provider.find(p.providerId)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider?.name ?? p.providerId)
                                .font(.body.weight(.medium))
                            Text("\(p.requests) request\(p.requests == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if p.input + p.output > 0 {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(formatTokens(p.input + p.output))
                                    .font(.body.weight(.semibold).monospacedDigit())
                                Text("tokens")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if p.input + p.output > 0 {
                        GeometryReader { geo in
                            HStack(spacing: 2) {
                                let total = CGFloat(p.input + p.output)
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Theme.accent.opacity(0.7))
                                    .frame(width: max(4, geo.size.width * CGFloat(p.input) / total))
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Theme.accent)
                                    .frame(width: max(4, geo.size.width * CGFloat(p.output) / total))
                            }
                        }
                        .frame(height: 6)

                        HStack {
                            Label(formatTokens(p.input) + " in", systemImage: "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(Theme.accent.opacity(0.7))
                            Spacer()
                            Label(formatTokens(p.output) + " out", systemImage: "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(Theme.accent)
                        }
                    }
                }
                .padding(14)
                .background(Theme.bgCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Theme.border, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
        return "\(n)"
    }
}
