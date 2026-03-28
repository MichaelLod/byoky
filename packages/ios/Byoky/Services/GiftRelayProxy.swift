import Foundation

enum GiftRelayEvent {
    case meta(status: Int, statusText: String, headers: [String: String])
    case chunk(String)
    case done
    case usage(giftId: String, usedTokens: Int)
}

enum GiftRelayError: LocalizedError {
    case invalidRelayUrl
    case timeout(String)
    case authFailed(String)
    case senderOffline
    case relayError(String)

    var errorDescription: String? {
        switch self {
        case .invalidRelayUrl: return "Invalid gift relay URL"
        case .timeout(let msg): return msg
        case .authFailed(let msg): return "Gift auth failed: \(msg)"
        case .senderOffline: return "Gift sender is not online"
        case .relayError(let msg): return msg
        }
    }
}

/// Connect to a gift relay as a recipient and proxy a single API request.
/// Returns an async stream of events: meta → chunk* → done, with optional usage.
func proxyViaGiftRelay(
    giftedCredential gc: GiftedCredential,
    requestId: String,
    providerId: String,
    url: String,
    method: String,
    headers: [String: String],
    body: String?
) -> AsyncThrowingStream<GiftRelayEvent, Error> {
    AsyncThrowingStream { continuation in
        guard let wsUrl = URL(string: gc.relayUrl), wsUrl.scheme == "wss" else {
            continuation.finish(throwing: GiftRelayError.invalidRelayUrl)
            return
        }

        let ws = URLSession.shared.webSocketTask(with: wsUrl)
        var requestSent = false
        var authenticated = false
        var finished = false

        func complete(throwing error: Error? = nil) {
            guard !finished else { return }
            finished = true
            if let error {
                continuation.finish(throwing: error)
            } else {
                continuation.finish()
            }
        }

        let authTimeout = DispatchWorkItem {
            ws.cancel(with: .normalClosure, reason: nil)
            complete(throwing: GiftRelayError.timeout("Gift relay auth timed out"))
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: authTimeout)

        var requestTimeout: DispatchWorkItem?
        var peerTimeout: DispatchWorkItem?

        func sendRequest() {
            guard !requestSent else { return }
            requestSent = true
            peerTimeout?.cancel()

            var reqMsg: [String: Any] = [
                "type": "relay:request",
                "requestId": requestId,
                "providerId": providerId,
                "url": url,
                "method": method,
                "headers": headers,
            ]
            if let body { reqMsg["body"] = body }

            guard let data = try? JSONSerialization.data(withJSONObject: reqMsg),
                  let str = String(data: data, encoding: .utf8) else { return }
            ws.send(.string(str)) { _ in }

            let timeout = DispatchWorkItem {
                ws.cancel(with: .normalClosure, reason: nil)
                complete(throwing: GiftRelayError.timeout("Gift relay request timed out"))
            }
            requestTimeout = timeout
            DispatchQueue.global().asyncAfter(deadline: .now() + 120, execute: timeout)
        }

        func listen() {
            guard !finished else { return }
            ws.receive { result in
                switch result {
                case .success(.string(let text)):
                    guard let msgData = text.data(using: .utf8),
                          let json = try? JSONSerialization.jsonObject(with: msgData) as? [String: Any],
                          let type = json["type"] as? String else {
                        listen()
                        return
                    }

                    switch type {
                    case "relay:auth:result":
                        authTimeout.cancel()
                        guard json["success"] as? Bool == true else {
                            let error = json["error"] as? String ?? "Auth failed"
                            ws.cancel(with: .normalClosure, reason: nil)
                            complete(throwing: GiftRelayError.authFailed(error))
                            return
                        }
                        authenticated = true
                        if json["peerOnline"] as? Bool == true {
                            sendRequest()
                        } else {
                            let pt = DispatchWorkItem {
                                ws.cancel(with: .normalClosure, reason: nil)
                                complete(throwing: GiftRelayError.senderOffline)
                            }
                            peerTimeout = pt
                            DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: pt)
                        }
                        listen()

                    case "relay:peer:status":
                        if json["online"] as? Bool == true && authenticated && !requestSent {
                            sendRequest()
                        }
                        listen()

                    case "relay:response:meta":
                        guard json["requestId"] as? String == requestId else { listen(); return }
                        requestTimeout?.cancel()
                        let status = json["status"] as? Int ?? 0
                        let statusText = json["statusText"] as? String ?? ""
                        let hdrs = json["headers"] as? [String: String] ?? [:]
                        continuation.yield(.meta(status: status, statusText: statusText, headers: hdrs))
                        listen()

                    case "relay:response:chunk":
                        guard json["requestId"] as? String == requestId else { listen(); return }
                        if let chunk = json["chunk"] as? String {
                            continuation.yield(.chunk(chunk))
                        }
                        listen()

                    case "relay:response:done":
                        guard json["requestId"] as? String == requestId else { listen(); return }
                        continuation.yield(.done)
                        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                            ws.cancel(with: .normalClosure, reason: nil)
                            complete()
                        }
                        listen()

                    case "relay:response:error":
                        guard json["requestId"] as? String == requestId else { listen(); return }
                        requestTimeout?.cancel()
                        let errorObj = json["error"] as? [String: Any]
                        let message = errorObj?["message"] as? String ?? "Gift relay error"
                        ws.cancel(with: .normalClosure, reason: nil)
                        complete(throwing: GiftRelayError.relayError(message))

                    case "relay:usage":
                        if let giftId = json["giftId"] as? String,
                           let usedTokens = json["usedTokens"] as? Int {
                            continuation.yield(.usage(giftId: giftId, usedTokens: usedTokens))
                        }
                        listen()

                    default:
                        listen()
                    }

                case .failure(let error):
                    authTimeout.cancel()
                    requestTimeout?.cancel()
                    peerTimeout?.cancel()
                    complete(throwing: error)

                default:
                    listen()
                }
            }
        }

        ws.resume()

        let auth: [String: Any] = [
            "type": "relay:auth",
            "roomId": gc.giftId,
            "authToken": gc.authToken,
            "role": "recipient",
        ]
        if let data = try? JSONSerialization.data(withJSONObject: auth),
           let str = String(data: data, encoding: .utf8) {
            ws.send(.string(str)) { _ in }
        }

        listen()

        continuation.onTermination = { _ in
            authTimeout.cancel()
            requestTimeout?.cancel()
            peerTimeout?.cancel()
            ws.cancel(with: .normalClosure, reason: nil)
        }
    }
}

/// Sensitive response headers that should be stripped from relay responses.
let sensitiveResponseHeaders: Set<String> = [
    "server", "x-request-id", "x-cloud-trace-context",
    "set-cookie", "set-cookie2", "alt-svc", "via",
]

/// Providers that need `stream_options.include_usage` injected for streaming.
private let streamUsageProviders: Set<String> = [
    "openai", "azure-openai", "together", "deepseek",
]

/// Inject `stream_options.include_usage` into the request body for providers
/// that don't report token usage in streaming responses by default.
func injectStreamUsageOptions(providerId: String, body: Data?) -> Data? {
    guard let body, streamUsageProviders.contains(providerId) else { return body }
    guard var parsed = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          parsed["stream"] as? Bool == true else { return body }
    var streamOptions = parsed["stream_options"] as? [String: Any] ?? [:]
    if streamOptions["include_usage"] as? Bool != true {
        streamOptions["include_usage"] = true
        parsed["stream_options"] = streamOptions
        return try? JSONSerialization.data(withJSONObject: parsed)
    }
    return body
}

/// String variant of injectStreamUsageOptions for relay request bodies.
func injectStreamUsageOptions(providerId: String, body: String?) -> String? {
    guard let body else { return nil }
    guard let data = body.data(using: .utf8),
          let injected = injectStreamUsageOptions(providerId: providerId, body: data),
          let result = String(data: injected, encoding: .utf8) else { return body }
    return result
}
