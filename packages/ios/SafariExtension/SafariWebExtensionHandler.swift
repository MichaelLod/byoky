import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message = request?.userInfo?[SFExtensionMessageKey]

        // Handle messages from the Safari extension's JavaScript
        let response = NSExtensionItem()

        guard let messageDict = message as? [String: Any],
              let action = messageDict["action"] as? String else {
            response.userInfo = [SFExtensionMessageKey: ["error": "invalid message"]]
            context.completeRequest(returningItems: [response])
            return
        }

        switch action {
        case "getStatus":
            // Check if wallet is unlocked and return status
            let status = checkWalletStatus()
            response.userInfo = [SFExtensionMessageKey: status]

        case "getCredentials":
            // Return available provider IDs (not the actual keys)
            let providers = getAvailableProviders()
            response.userInfo = [SFExtensionMessageKey: ["providers": providers]]

        case "proxy":
            // Handle proxy request — read from App Groups shared container
            guard let providerId = messageDict["providerId"] as? String,
                  let url = messageDict["url"] as? String,
                  let method = messageDict["method"] as? String else {
                response.userInfo = [SFExtensionMessageKey: ["error": "missing proxy params"]]
                context.completeRequest(returningItems: [response])
                return
            }

            let headers = messageDict["headers"] as? [String: String] ?? [:]
            let bodyString = messageDict["body"] as? String

            handleProxyRequest(
                providerId: providerId,
                url: url,
                method: method,
                headers: headers,
                body: bodyString?.data(using: .utf8)
            ) { result in
                switch result {
                case .success(let data):
                    response.userInfo = [SFExtensionMessageKey: [
                        "status": "ok",
                        "data": String(data: data.0, encoding: .utf8) ?? "",
                        "statusCode": data.1,
                    ]]
                case .failure(let error):
                    response.userInfo = [SFExtensionMessageKey: [
                        "error": error.localizedDescription,
                    ]]
                }
                context.completeRequest(returningItems: [response])
            }
            return

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

    private func handleProxyRequest(
        providerId: String,
        url: String,
        method: String,
        headers: [String: String],
        body: Data?,
        completion: @escaping (Result<(Data, Int), Error>) -> Void
    ) {
        // Write the proxy request to the shared container for the main app to process
        // The main app's bridge service reads from here and writes the response back
        let defaults = UserDefaults(suiteName: appGroupId)

        let requestId = UUID().uuidString
        let request: [String: Any] = [
            "id": requestId,
            "providerId": providerId,
            "url": url,
            "method": method,
            "headers": headers,
            "body": body?.base64EncodedString() ?? "",
            "timestamp": Date().timeIntervalSince1970,
        ]

        defaults?.set(request, forKey: "pendingProxyRequest")

        // Poll for response (with timeout)
        // In production, use Darwin notifications or a more efficient IPC mechanism
        let startTime = Date()
        let timeout: TimeInterval = 30

        func checkResponse() {
            guard Date().timeIntervalSince(startTime) < timeout else {
                completion(.failure(NSError(domain: "com.byoky", code: -1, userInfo: [NSLocalizedDescriptionKey: "Request timed out. Make sure the Byoky app is open."])))
                return
            }

            if let response = defaults?.dictionary(forKey: "proxyResponse_\(requestId)") {
                defaults?.removeObject(forKey: "proxyResponse_\(requestId)")

                if let error = response["error"] as? String {
                    completion(.failure(NSError(domain: "com.byoky", code: -1, userInfo: [NSLocalizedDescriptionKey: error])))
                } else if let dataString = response["data"] as? String,
                          let data = dataString.data(using: .utf8),
                          let statusCode = response["statusCode"] as? Int {
                    completion(.success((data, statusCode)))
                } else {
                    completion(.failure(NSError(domain: "com.byoky", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])))
                }
                return
            }

            DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
                checkResponse()
            }
        }

        checkResponse()
    }
}
