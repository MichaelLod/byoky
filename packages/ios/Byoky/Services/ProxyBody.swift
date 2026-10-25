import Foundation

/// A proxied request body as the SDK sends it. Text goes as is; binary
/// bodies (`ArrayBuffer`, `Blob`, streams) and `FormData` can't cross
/// `postMessage` as strings, so the SDK encodes them and says how in
/// `bodyEncoding`. Mirrors `reconstructBody` in the extension's background.ts.
enum ProxyBody: Equatable {
    case text(String)
    case binary(Data)
    case multipart(Data, boundary: String)

    struct DecodeError: Error {}

    /// Nil when the request has no body. Unknown encodings are treated as
    /// text, like the extension does.
    static func decode(body: String?, encoding: String?) throws -> ProxyBody? {
        guard let body else { return nil }
        switch encoding {
        case "base64":
            guard let data = Data(base64Encoded: body) else { throw DecodeError() }
            return .binary(data)
        case "formdata":
            return try multipart(fromSerialized: body)
        default:
            return .text(body)
        }
    }

    /// The JSON text, for routing, translation and logging. Nil for binary
    /// and form bodies, which are forwarded untouched.
    var asText: String? {
        if case .text(let text) = self { return text }
        return nil
    }

    var data: Data {
        switch self {
        case .text(let text): return Data(text.utf8)
        case .binary(let data), .multipart(let data, _): return data
        }
    }

    /// The Content-Type the wallet must send instead of the app's (a form
    /// body gets a new boundary).
    var contentTypeOverride: String? {
        if case .multipart(_, let boundary) = self { return "multipart/form-data; boundary=\(boundary)" }
        return nil
    }

    // MARK: - FormData

    /// One entry of the SDK's serialized FormData (`SerializedFormDataEntry`
    /// in packages/core/src/types.ts). File values are base64.
    private struct FormEntry: Decodable {
        let name: String
        let value: String
        let type: String
        let filename: String?
        let contentType: String?
    }

    static func multipart(fromSerialized json: String, boundary: String = "----byoky" + UUID().uuidString) throws -> ProxyBody {
        guard let entries = try? JSONDecoder().decode([FormEntry].self, from: Data(json.utf8)) else {
            throw DecodeError()
        }
        var data = Data()
        for entry in entries {
            data.append(Data("--\(boundary)\r\n".utf8))
            if entry.type == "text" {
                data.append(Data("Content-Disposition: form-data; name=\"\(escape(entry.name))\"\r\n\r\n".utf8))
                data.append(Data(entry.value.utf8))
            } else {
                guard let bytes = Data(base64Encoded: entry.value) else { throw DecodeError() }
                // A Blob appended without a name is sent as "blob" by browsers.
                let filename = escape(entry.filename ?? "blob")
                let contentType = (entry.contentType?.isEmpty == false ? entry.contentType! : "application/octet-stream")
                    .filter { $0 != "\r" && $0 != "\n" }
                data.append(Data("Content-Disposition: form-data; name=\"\(escape(entry.name))\"; filename=\"\(filename)\"\r\n".utf8))
                data.append(Data("Content-Type: \(contentType)\r\n\r\n".utf8))
                data.append(bytes)
            }
            data.append(Data("\r\n".utf8))
        }
        data.append(Data("--\(boundary)--\r\n".utf8))
        return .multipart(data, boundary: boundary)
    }

    /// Field and file names are quoted; escape them the way browsers do.
    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\"", with: "%22")
            .replacingOccurrences(of: "\r", with: "%0D")
            .replacingOccurrences(of: "\n", with: "%0A")
    }
}
