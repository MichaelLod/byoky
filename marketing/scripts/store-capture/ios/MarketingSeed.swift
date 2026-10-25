#if DEBUG
import Foundation

// Store screenshots only. run.sh copies this file into a scratch copy of
// packages/ios (never into the repo) and calls it from the DEBUG auto-setup
// hook in ByokyApp, so the captured screens show plausible usage instead of
// zeros. Everything here is fake: the keys are placeholders, the origins are
// byoky.com and example.com, and no request ever leaves the simulator.
extension WalletStore {
    func seedMarketingData(_ config: [String: Any]) {
        guard config["marketingSeed"] as? Bool == true else { return }
        // Anthropic first, as a user who added it first would see it.
        let order = ["anthropic", "openai", "gemini"]
        credentials.sort { (order.firstIndex(of: $0.providerId) ?? 9) < (order.firstIndex(of: $1.providerId) ?? 9) }
        let anthropic = credentials.first { $0.providerId == "anthropic" }
        let openai = credentials.first { $0.providerId == "openai" }
        let now = Date()
        let minute: TimeInterval = 60

        let demo = "https://byoky.com"
        let chat = "https://chat.example.com"

        // Connected apps, with believable "connected … ago" times.
        sessions = [
            Session(id: UUID().uuidString, appOrigin: demo, sessionKey: UUID().uuidString,
                    providers: ["anthropic", "openai"], createdAt: now.addingTimeInterval(-42 * minute),
                    expiresAt: now.addingTimeInterval(30 * 86_400)),
            Session(id: UUID().uuidString, appOrigin: chat, sessionKey: UUID().uuidString,
                    providers: ["anthropic"], createdAt: now.addingTimeInterval(-3 * 60 * minute),
                    expiresAt: now.addingTimeInterval(30 * 86_400)),
        ]
        for s in sessions { _ = try? upsertSession(appOrigin: s.appOrigin, providers: s.providers) }

        // Routing: chat.example.com asks for Anthropic, its group sends it to OpenAI.
        if let openai, let group = try? createGroup(name: "Fast", providerId: "openai", credentialId: openai.id, model: "gpt-4o-mini") {
            try? setAppGroup(origin: chat, groupId: group.id)
        }

        // A week of small requests.
        struct Row { let origin: String; let provider: String; let model: String; let input: Int; let output: Int; let ago: Double; var status = 200; var actual: String? = nil; var actualModel: String? = nil }
        var rows: [Row] = []
        let anthropicSizes = [(2140, 512), (1870, 430), (3320, 690), (1210, 288), (2650, 604), (1980, 455), (2410, 571), (1630, 377), (2890, 640), (1450, 330), (2230, 498), (3010, 702), (1760, 401), (2570, 589), (1340, 296), (2060, 470), (2780, 615), (1590, 352), (2320, 520), (1910, 433), (2470, 560)]
        for (i, s) in anthropicSizes.enumerated() {
            rows.append(Row(origin: demo, provider: "anthropic", model: "claude-sonnet-4-5", input: s.0, output: s.1, ago: Double(i) * 410 + 4))
        }
        let openaiSizes = [(1320, 310), (980, 240), (1540, 362), (1110, 255), (1720, 398), (890, 204), (1430, 330), (1260, 287)]
        for (i, s) in openaiSizes.enumerated() {
            rows.append(Row(origin: demo, provider: "openai", model: "gpt-4o-mini", input: s.0, output: s.1, ago: Double(i) * 620 + 11))
        }
        let routed = [(1840, 420), (1210, 296), (2260, 514), (1580, 361), (1990, 447), (1370, 318)]
        for (i, s) in routed.enumerated() {
            rows.append(Row(origin: chat, provider: "anthropic", model: "claude-sonnet-4-5", input: s.0, output: s.1, ago: Double(i) * 530 + 7, actual: "openai", actualModel: "gpt-4o-mini"))
        }
        let geminiSizes = [(2210, 380), (1650, 290), (1980, 341), (1430, 260)]
        for (i, s) in geminiSizes.enumerated() {
            rows.append(Row(origin: demo, provider: "gemini", model: "gemini-2.5-flash", input: s.0, output: s.1, ago: Double(i) * 900 + 20))
        }
        rows.sort { $0.ago < $1.ago }

        let urls = ["anthropic": "https://api.anthropic.com/v1/messages",
                    "openai": "https://api.openai.com/v1/chat/completions",
                    "gemini": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"]
        requestLogs = rows.map { r in
            var e = RequestLog(id: UUID().uuidString, appOrigin: r.origin, providerId: r.provider, method: "POST",
                               url: urls[r.provider] ?? "", statusCode: r.status, timestamp: now.addingTimeInterval(-r.ago * minute))
            e.inputTokens = r.input
            e.outputTokens = r.output
            e.model = r.model
            e.actualProviderId = r.actual
            e.actualModel = r.actualModel
            return e
        }
        // Count the same requests against the apps' allowances.
        for r in rows {
            if case .success(let hold) = reserveTokens(origin: r.origin, providerId: r.provider, estimatedTokens: 0) {
                settleReservation(hold, usedTokens: r.input + r.output)
            }
        }
        // One more through the real logging path, which also saves the log.
        logRequest(appOrigin: demo, providerId: "anthropic", method: "POST", url: urls["anthropic"]!, statusCode: 200,
                   requestBody: Data(#"{"model":"claude-sonnet-4-5","max_tokens":1024,"messages":[]}"#.utf8),
                   usage: UsageParser.TokenUsage(inputTokens: 1720, outputTokens: 388))

        setAllowance(TokenAllowance(origin: demo, totalLimit: 100_000, providerLimits: ["anthropic": 80_000]))
        _ = anthropic

        // Apps on example.com subdomains: their icons don't load, so each shows
        // its initial instead of a third-party favicon.
        for (url, name) in [("chat.example.com", "Chat"), ("notes.example.com", "Notes"), ("review.example.com", "Review")] {
            _ = try? addApp(urlString: url, name: name)
        }
    }
}
#endif
