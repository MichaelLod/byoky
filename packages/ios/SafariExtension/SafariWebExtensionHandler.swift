import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message = request?.userInfo?[SFExtensionMessageKey]

        let response = NSExtensionItem()

        guard let messageDict = message as? [String: Any],
              let action = messageDict["action"] as? String else {
            response.userInfo = [SFExtensionMessageKey: ["error": "invalid message"]]
            context.completeRequest(returningItems: [response])
            return
        }

        switch action {
        case "getStatus":
            let status = checkWalletStatus()
            response.userInfo = [SFExtensionMessageKey: status]

        case "getCredentials":
            let providers = getAvailableProviders()
            response.userInfo = [SFExtensionMessageKey: ["providers": providers]]

        default:
            response.userInfo = [SFExtensionMessageKey: ["error": "unknown action"]]
        }

        context.completeRequest(returningItems: [response])
    }

    // MARK: - App Group Communication

    private let appGroupId = "group.com.byoky.app"

    private func checkWalletStatus() -> [String: Any] {
        let defaults = UserDefaults(suiteName: appGroupId)
        let isUnlocked = defaults?.bool(forKey: "walletUnlocked") ?? false
        return [
            "isUnlocked": isUnlocked,
            "hasCredentials": defaults?.bool(forKey: "hasCredentials") ?? false,
        ]
    }

    private func getAvailableProviders() -> [String] {
        let defaults = UserDefaults(suiteName: appGroupId)
        return defaults?.stringArray(forKey: "availableProviders") ?? []
    }
}
