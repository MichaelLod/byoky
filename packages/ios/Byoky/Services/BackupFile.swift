import Foundation
import UniformTypeIdentifiers

extension UTType {
    /// `.byoky` encrypted backup file (declared in Info.plist).
    static let byokyBackup = UTType(exportedAs: "com.byoky.backup", conformingTo: .data)
}

/// The `.byoky` backup file: the portable, server-free way to move keys
/// between Byoky wallets (browser extension, iOS, Android). Mirrors
/// packages/extension/lib/vault-file.ts.
///
/// File contents are a single base64 string:
///
///     encrypt(JSON.stringify(payload), exportPassword)
///     payload = { "version": 2, "exportedAt": <epoch ms>, "credentials": [...] }
///
/// using @byoky/core's password-based AES-256-GCM (see
/// `CryptoService.encrypt(plaintext:password:)`). Credential metadata sits in
/// the clear inside that envelope; each secret is additionally encrypted on
/// its own under the export password with the same scheme:
///
///     encryptedKey          api_key credentials ("" for keyless local servers)
///     encryptedAccessToken  oauth credentials (Anthropic setup token)
///
/// `baseUrl` is only written for providers without a fixed host. Older files
/// may also carry `lastUsedAt`, `gifts` / `giftedCredentials`; they are ignored.
///
/// An imported file is untrusted input (same rules as the extension):
///   - more than 500 entries, a structurally broken entry, or a key that
///     won't decrypt rejects the whole file;
///   - unknown providers, and Azure/Ollama/LM Studio entries without a safe
///     base URL (`Provider.customBaseUrl`), are skipped;
///   - `baseUrl` is dropped for fixed-host providers, `createdAt` is capped
///     at now, and labels are trimmed to 200 characters.
/// iOS additionally skips credentials it can't use (OAuth other than an
/// Anthropic setup token, expired OAuth, a non-local entry with no key).
///
/// Everything here is synchronous and runs one PBKDF2 (600k iterations) per
/// secret, so callers run it off the main actor.
enum BackupFile {
    static let version = 2
    static let fileExtension = "byoky"
    /// Same cap as the extension's import UI.
    static let maxFileBytes = 10 * 1024 * 1024
    /// Decrypted payload cap, guarding the JSON parser.
    static let maxPayloadLength = 10_485_760
    /// Files with more credentials than this are rejected outright.
    static let maxEntries = 500
    static let maxLabelLength = 200

    enum BackupError: LocalizedError, Equatable {
        case tooLarge
        case tooManyEntries
        case notABackupFile
        case wrongPasswordOrCorrupted
        case invalidFormat
        case credentialUnreadable
        case nothingToExport

        var errorDescription: String? {
            switch self {
            case .tooLarge: return "File too large (max 10 MB)."
            case .tooManyEntries: return "The backup has more than \(BackupFile.maxEntries) keys."
            case .notABackupFile: return "This isn't a Byoky backup file."
            case .wrongPasswordOrCorrupted: return "Wrong password or corrupted file"
            case .invalidFormat: return "Invalid backup file format."
            case .credentialUnreadable: return "Could not decrypt a key in the file."
            case .nothingToExport: return "Add a key before exporting."
            }
        }
    }

    /// A credential with its plaintext secret, on its way into or out of a file.
    struct Entry: Equatable {
        /// The source credential's id. Written to the file like the extension
        /// does; importers always assign fresh ids.
        var id: String?
        var providerId: String
        var label: String
        var authMethod: AuthMethod
        var createdAt: Date
        var baseUrl: String?
        var secret: String
    }

    /// A decrypted file, reduced to the entries this device can use.
    struct Contents: Equatable {
        var entries: [Entry]
        /// Skipped entries: unknown providers, missing or unsafe base URLs,
        /// and credentials iOS can't use.
        var unsupportedCount: Int
    }

    struct MergePlan: Equatable {
        var toAdd: [Entry]
        var duplicateCount: Int
    }

    // MARK: - Export

    /// Build the contents of a `.byoky` file. Each secret and then the whole
    /// payload are encrypted under `password`. `progress` goes 0 → 1.
    static func export(
        _ entries: [Entry],
        password: String,
        now: Date = Date(),
        crypto: CryptoService = .shared,
        progress: ((Double) -> Void)? = nil
    ) throws -> String {
        guard !entries.isEmpty else { throw BackupError.nothingToExport }
        let totalSteps = Double(entries.count + 1)

        var credentials: [[String: Any]] = []
        for (index, entry) in entries.enumerated() {
            var out: [String: Any] = [
                "id": entry.id ?? UUID().uuidString,
                "providerId": entry.providerId,
                "label": entry.label,
                "authMethod": entry.authMethod.rawValue,
                "createdAt": epochMillis(entry.createdAt),
            ]
            if let baseUrl = entry.baseUrl, !baseUrl.isEmpty,
               Provider.find(entry.providerId)?.requiresCustomBaseUrl == true {
                out["baseUrl"] = baseUrl
            }
            let encrypted = entry.secret.isEmpty ? "" : try crypto.encrypt(plaintext: entry.secret, password: password)
            switch entry.authMethod {
            case .apiKey: out["encryptedKey"] = encrypted
            case .oauth: out["encryptedAccessToken"] = encrypted
            }
            credentials.append(out)
            progress?(Double(index + 1) / totalSteps)
        }

        let payload: [String: Any] = [
            "version": version,
            "exportedAt": epochMillis(now),
            "credentials": credentials,
        ]
        let json = try JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes])
        let file = try crypto.encrypt(plaintext: String(decoding: json, as: UTF8.self), password: password)
        progress?(1)
        return file
    }

    static func suggestedFileName(for date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return "byoky-backup-\(formatter.string(from: date)).\(fileExtension)"
    }

    // MARK: - Import

    /// Read a picked or opened file. Rejects anything over 10 MB or not UTF-8
    /// text; the content itself is validated by `open`.
    static func readFile(at url: URL) throws -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > maxFileBytes {
            throw BackupError.tooLarge
        }
        let data = try Data(contentsOf: url)
        guard data.count <= maxFileBytes else { throw BackupError.tooLarge }
        guard let text = String(data: data, encoding: .utf8) else { throw BackupError.notABackupFile }
        return text
    }

    /// Decrypt and validate a `.byoky` file. Like the extension it is
    /// all-or-nothing: a malformed credential or a secret that won't decrypt
    /// fails the whole import. Secrets of unusable entries are not decrypted.
    static func open(
        _ fileContents: String,
        password: String,
        now: Date = Date(),
        crypto: CryptoService = .shared,
        progress: ((Double) -> Void)? = nil
    ) throws -> Contents {
        guard fileContents.utf8.count <= maxFileBytes else { throw BackupError.tooLarge }

        let json: String
        do {
            json = try crypto.decrypt(
                encoded: fileContents.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
        } catch {
            throw BackupError.wrongPasswordOrCorrupted
        }
        guard json.utf16.count <= maxPayloadLength else { throw BackupError.tooLarge }

        guard let payload = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let version = number(payload["version"]), version >= 1,
              let rawCredentials = payload["credentials"] as? [Any] else {
            throw BackupError.invalidFormat
        }
        guard rawCredentials.count <= maxEntries else { throw BackupError.tooManyEntries }

        let parsed = try rawCredentials.map { raw -> FileCredential in
            guard let credential = FileCredential(raw, now: now) else { throw BackupError.invalidFormat }
            return credential
        }

        var usable: [FileCredential] = []
        var unsupported = 0
        for credential in parsed {
            if isUsable(credential, now: now) { usable.append(credential) } else { unsupported += 1 }
        }

        let totalSteps = Double(usable.count + 1)
        progress?(1 / totalSteps)
        var entries: [Entry] = []
        for (index, credential) in usable.enumerated() {
            // Each secret costs a full PBKDF2; let the user cancel between them.
            try Task.checkCancellation()
            let secret: String
            if let encrypted = credential.encryptedSecret, !encrypted.isEmpty {
                do {
                    secret = try crypto.decrypt(encoded: encrypted, password: password)
                } catch {
                    throw BackupError.credentialUnreadable
                }
            } else {
                secret = ""
            }
            entries.append(Entry(
                id: nil,
                providerId: credential.providerId,
                label: credential.label,
                authMethod: credential.authMethod,
                createdAt: credential.createdAt,
                baseUrl: credential.baseUrl,
                secret: secret
            ))
            progress?(Double(index + 2) / totalSteps)
        }
        return Contents(entries: entries, unsupportedCount: unsupported)
    }

    /// Merge, never replace: everything new is added; entries that duplicate
    /// a key already in the wallet (or earlier in the file) — same provider,
    /// same secret, same base URL, as in the extension — are skipped.
    static func plan(_ imported: [Entry], existing: [Entry]) -> MergePlan {
        var seen = Set(existing.map(duplicateKey))
        var toAdd: [Entry] = []
        var duplicates = 0
        for entry in imported {
            if seen.insert(duplicateKey(entry)).inserted {
                toAdd.append(entry)
            } else {
                duplicates += 1
            }
        }
        return MergePlan(toAdd: toAdd, duplicateCount: duplicates)
    }

    // MARK: - Internals

    private struct FileCredential {
        let providerId: String
        let label: String
        let authMethod: AuthMethod
        let createdAt: Date
        /// Sanitized: nil unless the provider needs one and it's safe.
        let baseUrl: String?
        let expiresAt: Date?
        /// encryptedKey for api_key, encryptedAccessToken for oauth.
        let encryptedSecret: String?

        /// Field rules match `parseFileCredential` in vault-file.ts.
        init?(_ raw: Any, now: Date) {
            guard let c = raw as? [String: Any],
                  let providerId = c["providerId"] as? String, !providerId.isEmpty,
                  let method = c["authMethod"] as? String else { return nil }
            switch method {
            case "api_key":
                if let key = c["encryptedKey"], !(key is String) { return nil }
                authMethod = .apiKey
                encryptedSecret = c["encryptedKey"] as? String
            case "oauth":
                guard let token = c["encryptedAccessToken"] as? String, !token.isEmpty else { return nil }
                authMethod = .oauth
                encryptedSecret = token
            default:
                return nil
            }
            self.providerId = providerId
            let label = String((c["label"] as? String ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .prefix(BackupFile.maxLabelLength))
            self.label = label.isEmpty ? (Provider.find(providerId)?.name ?? providerId) : label
            // Never trust a future timestamp (routing prefers newer keys).
            if let ms = number(c["createdAt"]), ms.isFinite, ms > 0 {
                createdAt = min(Date(timeIntervalSince1970: ms / 1000), now)
            } else {
                createdAt = now
            }
            // A base URL only means something for custom-host providers, and
            // only a safe one is kept; fixed-host providers lose it here.
            let rawBaseUrl = c["baseUrl"] as? String
            baseUrl = Provider.customBaseUrl(for: providerId, credentialBaseUrl: rawBaseUrl) != nil ? rawBaseUrl : nil
            expiresAt = number(c["expiresAt"]).map { Date(timeIntervalSince1970: $0 / 1000) }
        }
    }

    private static func isUsable(_ credential: FileCredential, now: Date) -> Bool {
        guard let provider = Provider.find(credential.providerId) else { return false }
        if credential.authMethod == .oauth {
            // iOS can only use Anthropic setup tokens, and can't refresh an
            // expired OAuth access token.
            guard credential.providerId == "anthropic" else { return false }
            if let expiresAt = credential.expiresAt, expiresAt <= now { return false }
        }
        // Azure/Ollama/LM Studio need a safe base URL of their own.
        if provider.requiresCustomBaseUrl && credential.baseUrl == nil { return false }
        if !Provider.isLocal(credential.providerId) && (credential.encryptedSecret ?? "").isEmpty { return false }
        return true
    }

    private static func duplicateKey(_ entry: Entry) -> [String] {
        [entry.providerId, entry.secret, entry.baseUrl ?? ""]
    }

    private static func epochMillis(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    /// A JSON number (not a boolean), like `typeof x === 'number'`.
    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
    }
}

/// Export-password rule, ported from `checkPasswordStrength` and
/// `MIN_PASSWORD_LENGTH` in packages/core/src/password-strength.ts, which the
/// extension's export screen uses: at least 12 characters and a score of 2+.
struct BackupPasswordStrength: Equatable {
    static let minLength = 12

    let score: Int
    let label: String
    let feedback: [String]

    var isAcceptable: Bool { score >= 2 }

    private static let labels = ["Too weak", "Weak", "Fair", "Strong", "Very strong"]

    private static let commonPasswords: Set<String> = [
        "password", "12345678", "qwerty12", "letmein12", "welcome1",
        "monkey12", "dragon12", "master12", "abc12345", "password1",
        "password12", "iloveyou1", "sunshine1", "trustno1", "princess1",
        "football1", "shadow123", "michael1", "jordan123", "superman1",
        "password123", "admin12345", "letmein123", "p@ssw0rd", "p@ssw0rd1",
        "qwerty1234", "changeme12", "welcome123", "1234567890", "baseball1",
        "starwars12", "whatever1", "passw0rd1", "mustang12", "access1234",
        "charlie123", "donald1234", "maggie1234", "master1234", "michael123",
        "jennifer1", "hunter1234", "thomas1234", "corvette12", "robert1234",
        "summer1234", "george1234", "harley1234", "cheese1234", "computer1",
        "internet1", "secret1234", "diamond1", "chicken123", "pepper1234",
        "jessica123", "hannah1234", "ginger1234", "joshua1234", "abcdefgh1",
        "qwertyuiop", "asdfghjkl1", "zxcvbnm123", "1q2w3e4r5t", "passpass1",
    ]

    private static let sequences = ["012", "123", "234", "345", "456", "567", "678", "789", "abc", "bcd", "cde", "def"]

    static func check(_ password: String) -> BackupPasswordStrength {
        // JS string length counts UTF-16 code units.
        if password.utf16.count < minLength {
            return BackupPasswordStrength(score: 0, label: labels[0], feedback: ["Use at least 12 characters"])
        }
        var feedback: [String] = []
        var score = 1
        if password.utf16.count >= 16 { score += 1 }

        if commonPasswords.contains(password.lowercased()) {
            return BackupPasswordStrength(score: 0, label: labels[0], feedback: ["This is a commonly used password"])
        }

        let scalars = password.unicodeScalars
        let hasLower = scalars.contains { ("a"..."z").contains($0) }
        let hasUpper = scalars.contains { ("A"..."Z").contains($0) }
        let hasDigit = scalars.contains { ("0"..."9").contains($0) }
        let hasSymbol = scalars.contains { !(("a"..."z").contains($0) || ("A"..."Z").contains($0) || ("0"..."9").contains($0)) }
        let charTypes = [hasLower, hasUpper, hasDigit, hasSymbol].filter { $0 }.count

        if charTypes < 2 {
            feedback.append("Mix uppercase, lowercase, numbers, and symbols")
        } else if charTypes >= 3 {
            score += 1
        }
        if charTypes >= 4 { score += 1 }

        if hasRun(of: 4, in: password) {
            feedback.append("Avoid repeated characters")
            score = max(0, score - 1)
        }

        let lowered = password.lowercased()
        if sequences.contains(where: { lowered.contains($0) }) {
            feedback.append("Avoid sequential patterns")
            score = max(0, score - 1)
        }

        let capped = min(4, max(0, score))
        if feedback.isEmpty && capped < 3 {
            feedback.append("Add more character variety or length")
        }
        return BackupPasswordStrength(score: capped, label: labels[capped], feedback: feedback)
    }

    /// The same character `length` or more times in a row — `/(.)\1{3,}/`.
    private static func hasRun(of length: Int, in password: String) -> Bool {
        var previous: Unicode.Scalar?
        var run = 0
        for scalar in password.unicodeScalars {
            if scalar == previous, scalar != "\n", scalar != "\r" {
                run += 1
                if run >= length { return true }
            } else {
                previous = scalar
                run = 1
            }
        }
        return false
    }
}
