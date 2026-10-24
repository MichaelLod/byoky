import XCTest
@testable import Byoky

/// `.byoky` backup compatibility with @byoky/core and the extension's
/// vault-file.ts. `BackupFixture` was produced by the real core `encrypt()`
/// under Node WebCrypto.
final class BackupFileTests: XCTestCase {
    private let crypto = CryptoService.shared

    // MARK: - Crypto compatibility

    func testDecryptsCiphertextFromCore() throws {
        let plain = try crypto.decrypt(encoded: BackupFixture.coreCiphertext, password: BackupFixture.corePassword)
        XCTAssertEqual(plain, BackupFixture.corePlaintext)
    }

    func testEncryptUsesCoreLayout() throws {
        let plaintext = "sk-ant-api03-ключ"
        let encoded = try crypto.encrypt(plaintext: plaintext, password: "layout-pass")
        let raw = try XCTUnwrap(Data(base64Encoded: encoded))
        // salt[16] ‖ iv[12] ‖ ciphertext (same length as UTF-8 plaintext) ‖ tag[16]
        XCTAssertEqual(raw.count, 16 + 12 + plaintext.utf8.count + 16)
        XCTAssertEqual(try crypto.decrypt(encoded: encoded, password: "layout-pass"), plaintext)
        XCTAssertThrowsError(try crypto.decrypt(encoded: encoded, password: "wrong-pass"))
    }

    // MARK: - Fixture from the extension format

    func testOpensFixtureWrittenByCore() throws {
        let contents = try BackupFile.open(BackupFixture.fileContents, password: BackupFixture.password)

        // The `replicate` credential is an unknown provider here.
        XCTAssertEqual(contents.unsupportedCount, 1)
        XCTAssertEqual(contents.entries.count, 5)

        let created = Date(timeIntervalSince1970: 1_760_000_000)
        XCTAssertEqual(contents.entries[0], BackupFile.Entry(
            providerId: "anthropic", label: "Anthropic work", authMethod: .apiKey,
            createdAt: created, baseUrl: nil, secret: "sk-ant-api03-FIXTURE-ánthropic-ключ"
        ))
        XCTAssertEqual(contents.entries[1].secret, "sk-proj-FIXTURE-openai")
        let azure = contents.entries[2]
        XCTAssertEqual(azure.providerId, "azure_openai")
        XCTAssertEqual(azure.label, "Azure (Contoso)")
        XCTAssertEqual(azure.baseUrl, "https://contoso.openai.azure.com")
        XCTAssertEqual(azure.secret, "azure-FIXTURE-key")
        XCTAssertEqual(azure.createdAt.timeIntervalSince1970, 1_760_000_000.002, accuracy: 0.0005)
        XCTAssertEqual(contents.entries[3].providerId, "ollama")
        XCTAssertEqual(contents.entries[3].baseUrl, "http://localhost:11434")
        XCTAssertEqual(contents.entries[3].secret, "")
        XCTAssertEqual(contents.entries[4].authMethod, .oauth)
        XCTAssertEqual(contents.entries[4].secret, "sk-ant-oat01-FIXTURE-setup-token")
    }

    func testFixtureWithWrongPassword() {
        XCTAssertThrowsError(try BackupFile.open(BackupFixture.fileContents, password: "not-the-password")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .wrongPasswordOrCorrupted)
            XCTAssertEqual(error.localizedDescription, "Wrong password or corrupted file")
        }
    }

    func testFixtureMergesIntoExistingWallet() throws {
        let contents = try BackupFile.open(BackupFixture.fileContents, password: BackupFixture.password)
        let existing = [
            BackupFile.Entry(providerId: "openai", label: "Mine", authMethod: .apiKey,
                             createdAt: Date(), baseUrl: nil, secret: "sk-proj-FIXTURE-openai"),
            // Same provider and (empty) secret, different server: not a duplicate.
            BackupFile.Entry(providerId: "ollama", label: "Other box", authMethod: .apiKey,
                             createdAt: Date(), baseUrl: "http://192.168.1.20:11434", secret: ""),
        ]
        let plan = BackupFile.plan(contents.entries, existing: existing)
        XCTAssertEqual(plan.duplicateCount, 1)
        XCTAssertEqual(plan.toAdd.map(\.providerId), ["anthropic", "azure_openai", "ollama", "anthropic"])
    }

    // MARK: - Round trip

    func testExportThenImportRoundTrips() throws {
        let created = Date(timeIntervalSince1970: 1_700_000_000.123)
        let entries = [
            BackupFile.Entry(id: "a", providerId: "anthropic", label: "Key", authMethod: .apiKey,
                             createdAt: created, baseUrl: nil, secret: "sk-ant-1"),
            BackupFile.Entry(id: "b", providerId: "lm_studio", label: "Local", authMethod: .apiKey,
                             createdAt: created, baseUrl: "http://localhost:1234", secret: ""),
            BackupFile.Entry(id: "c", providerId: "anthropic", label: "Setup", authMethod: .oauth,
                             createdAt: created, baseUrl: nil, secret: "sk-ant-oat01-x"),
        ]
        var progress: [Double] = []
        let file = try BackupFile.export(entries, password: "Round-Trip-Passw0rd!") { progress.append($0) }
        XCTAssertEqual(progress.last, 1)

        let opened = try BackupFile.open(file, password: "Round-Trip-Passw0rd!")
        XCTAssertEqual(opened.unsupportedCount, 0)
        XCTAssertEqual(opened.entries.map(\.secret), entries.map(\.secret))
        XCTAssertEqual(opened.entries.map(\.baseUrl), entries.map(\.baseUrl))
        XCTAssertEqual(opened.entries.map(\.authMethod), entries.map(\.authMethod))
        XCTAssertEqual(opened.entries[0].createdAt.timeIntervalSince1970, 1_700_000_000.123, accuracy: 0.001)

        // Importing the same file again adds nothing.
        XCTAssertEqual(BackupFile.plan(opened.entries, existing: entries).toAdd, [])
    }

    func testExportPayloadMatchesVaultFileFormat() throws {
        let created = Date(timeIntervalSince1970: 1_760_000_000)
        let file = try BackupFile.export([
            BackupFile.Entry(id: "id-1", providerId: "openai", label: "OpenAI", authMethod: .apiKey,
                             createdAt: created, baseUrl: nil, secret: "sk-1"),
            BackupFile.Entry(id: "id-2", providerId: "ollama", label: "Ollama", authMethod: .apiKey,
                             createdAt: created, baseUrl: "http://localhost:11434", secret: ""),
            BackupFile.Entry(id: "id-3", providerId: "anthropic", label: "Max", authMethod: .oauth,
                             createdAt: created, baseUrl: nil, secret: "sk-ant-oat01-y"),
        ], password: "Fixture-Pässwort-2026!", now: created)

        let json = try crypto.decrypt(encoded: file, password: "Fixture-Pässwort-2026!")
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(payload["version"] as? Int, 2)
        XCTAssertEqual(payload["exportedAt"] as? Int64, 1_760_000_000_000)
        let creds = try XCTUnwrap(payload["credentials"] as? [[String: Any]])
        XCTAssertEqual(creds.count, 3)

        XCTAssertEqual(Set(creds[0].keys), ["id", "providerId", "label", "authMethod", "createdAt", "encryptedKey"])
        XCTAssertEqual(creds[0]["id"] as? String, "id-1")
        XCTAssertEqual(creds[0]["authMethod"] as? String, "api_key")
        XCTAssertEqual(creds[0]["createdAt"] as? Int64, 1_760_000_000_000)
        let key = try XCTUnwrap(creds[0]["encryptedKey"] as? String)
        XCTAssertEqual(try crypto.decrypt(encoded: key, password: "Fixture-Pässwort-2026!"), "sk-1")

        XCTAssertEqual(creds[1]["baseUrl"] as? String, "http://localhost:11434")
        XCTAssertEqual(creds[1]["encryptedKey"] as? String, "")

        XCTAssertEqual(creds[2]["authMethod"] as? String, "oauth")
        XCTAssertNil(creds[2]["encryptedKey"])
        let token = try XCTUnwrap(creds[2]["encryptedAccessToken"] as? String)
        XCTAssertEqual(try crypto.decrypt(encoded: token, password: "Fixture-Pässwort-2026!"), "sk-ant-oat01-y")
    }

    // MARK: - Validation

    func testRejectsOversizedAndGarbageInput() throws {
        let huge = String(repeating: "A", count: BackupFile.maxFileBytes + 1)
        XCTAssertThrowsError(try BackupFile.open(huge, password: "x")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .tooLarge)
        }
        XCTAssertThrowsError(try BackupFile.open("definitely not base64 !!", password: "x")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .wrongPasswordOrCorrupted)
        }
        let notJSON = try crypto.encrypt(plaintext: "hello", password: "pw")
        XCTAssertThrowsError(try BackupFile.open(notJSON, password: "pw")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .invalidFormat)
        }
        let noCredentials = try crypto.encrypt(plaintext: #"{"version":2,"exportedAt":1}"#, password: "pw")
        XCTAssertThrowsError(try BackupFile.open(noCredentials, password: "pw")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .invalidFormat)
        }
    }

    func testOneMalformedCredentialFailsTheWholeImport() throws {
        let payload = #"{"version":2,"exportedAt":1,"credentials":[{"providerId":"openai","authMethod":"api_key","encryptedKey":""},{"providerId":"openai","authMethod":"password"}]}"#
        let file = try crypto.encrypt(plaintext: payload, password: "pw")
        XCTAssertThrowsError(try BackupFile.open(file, password: "pw")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .invalidFormat)
        }
    }

    func testUndecryptableSecretFailsTheWholeImport() throws {
        let foreign = try crypto.encrypt(plaintext: "sk-1", password: "some-other-password")
        let payload = #"{"version":2,"exportedAt":1,"credentials":[{"providerId":"openai","authMethod":"api_key","encryptedKey":"\#(foreign)"}]}"#
        let file = try crypto.encrypt(plaintext: payload, password: "pw")
        XCTAssertThrowsError(try BackupFile.open(file, password: "pw")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .credentialUnreadable)
        }
    }

    func testSkipsCredentialsThisDeviceCannotUse() throws {
        let token = try crypto.encrypt(plaintext: "tok", password: "pw")
        let payload = """
        {"version":2,"exportedAt":1,"credentials":[
          {"providerId":"openai","authMethod":"oauth","encryptedAccessToken":"\(token)"},
          {"providerId":"anthropic","authMethod":"oauth","encryptedAccessToken":"\(token)","expiresAt":1000},
          {"providerId":"azure_openai","authMethod":"api_key","encryptedKey":"\(token)"},
          {"providerId":"openai","authMethod":"api_key","encryptedKey":""},
          {"providerId":"huggingface","authMethod":"api_key","encryptedKey":"\(token)"},
          {"providerId":"anthropic","authMethod":"oauth","encryptedAccessToken":"\(token)","encryptedRefreshToken":"\(token)"}
        ],"gifts":[{"id":"g"}]}
        """
        let file = try crypto.encrypt(plaintext: payload, password: "pw")
        let contents = try BackupFile.open(file, password: "pw")
        XCTAssertEqual(contents.unsupportedCount, 5)
        XCTAssertEqual(contents.entries.count, 1)
        XCTAssertEqual(contents.entries.first?.authMethod, .oauth)
        // Missing label falls back to the provider's name, like the extension.
        XCTAssertEqual(contents.entries.first?.label, "Anthropic")
    }

    // MARK: - Hostile files

    func testBaseUrlsAreSanitized() throws {
        let key = try crypto.encrypt(plaintext: "k", password: "pw")
        let payload = """
        {"version":2,"exportedAt":1,"credentials":[
          {"providerId":"openai","authMethod":"api_key","encryptedKey":"\(key)","baseUrl":"https://evil.example"},
          {"providerId":"azure_openai","authMethod":"api_key","encryptedKey":"\(key)","baseUrl":"https://evil.example"},
          {"providerId":"azure_openai","authMethod":"api_key","encryptedKey":"\(key)","baseUrl":"https://contoso.openai.azure.com"},
          {"providerId":"ollama","authMethod":"api_key","encryptedKey":"","baseUrl":"http://192.168.1.20:11434"},
          {"providerId":"ollama","authMethod":"api_key","encryptedKey":"","baseUrl":"http://localhost:11434/?token=x"},
          {"providerId":"lm_studio","authMethod":"api_key","encryptedKey":"","baseUrl":"http://127.0.0.1:1234"}
        ]}
        """
        let contents = try BackupFile.open(try crypto.encrypt(plaintext: payload, password: "pw"), password: "pw")
        // Fixed host: kept, base URL dropped. Unsafe custom base URLs: skipped.
        XCTAssertEqual(contents.unsupportedCount, 3)
        XCTAssertEqual(contents.entries.map(\.providerId), ["openai", "azure_openai", "lm_studio"])
        XCTAssertEqual(contents.entries.map(\.baseUrl), [nil, "https://contoso.openai.azure.com", "http://127.0.0.1:1234"])
    }

    func testFutureTimestampsAndLongLabelsAreClamped() throws {
        let key = try crypto.encrypt(plaintext: "k", password: "pw")
        let longLabel = String(repeating: "x", count: 500)
        let payload = """
        {"version":2,"exportedAt":1,"credentials":[
          {"providerId":"openai","label":"  \(longLabel)  ","authMethod":"api_key","encryptedKey":"\(key)","createdAt":99999999999999,"lastUsedAt":99999999999999}
        ]}
        """
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let contents = try BackupFile.open(try crypto.encrypt(plaintext: payload, password: "pw"), password: "pw", now: now)
        let entry = try XCTUnwrap(contents.entries.first)
        XCTAssertEqual(entry.createdAt, now)
        XCTAssertEqual(entry.label.count, BackupFile.maxLabelLength)
    }

    func testTooManyEntriesRejectsTheFile() throws {
        let entry = #"{"providerId":"openai","authMethod":"api_key","encryptedKey":""}"#
        let payload = #"{"version":2,"exportedAt":1,"credentials":["# + Array(repeating: entry, count: 501).joined(separator: ",") + "]}"
        XCTAssertThrowsError(try BackupFile.open(try crypto.encrypt(plaintext: payload, password: "pw"), password: "pw")) { error in
            XCTAssertEqual(error as? BackupFile.BackupError, .tooManyEntries)
        }
    }

    func testOpenStopsWhenCancelled() async throws {
        let task = Task.detached {
            try BackupFile.open(BackupFixture.fileContents, password: BackupFixture.password)
        }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError, "\(error)")
        }
    }

    func testExportOmitsBaseUrlForFixedHostProviders() throws {
        let file = try BackupFile.export([
            BackupFile.Entry(providerId: "openai", label: "o", authMethod: .apiKey,
                             createdAt: Date(), baseUrl: "https://evil.example", secret: "k"),
        ], password: "pw")
        let json = try crypto.decrypt(encoded: file, password: "pw")
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let creds = try XCTUnwrap(payload["credentials"] as? [[String: Any]])
        XCTAssertNil(creds.first?["baseUrl"])
        XCTAssertNil(creds.first?["lastUsedAt"])
    }

    func testSuggestedFileName() {
        let date = Date(timeIntervalSince1970: 1_760_000_000) // 2025-10-09 UTC
        XCTAssertTrue(BackupFile.suggestedFileName(for: date).hasPrefix("byoky-backup-2025-10-"))
        XCTAssertTrue(BackupFile.suggestedFileName(for: date).hasSuffix(".byoky"))
    }

    // MARK: - Export password rule (vectors from core checkPasswordStrength)

    func testPasswordStrengthMatchesCore() {
        let vectors: [(String, Int, String, [String])] = [
            ("Short1!", 0, "Too weak", ["Use at least 12 characters"]),
            ("Password123", 0, "Too weak", ["Use at least 12 characters"]),
            ("abcdefghijkl", 0, "Too weak", ["Mix uppercase, lowercase, numbers, and symbols", "Avoid sequential patterns"]),
            ("aaaaBBBB1111", 1, "Weak", ["Avoid repeated characters"]),
            ("Password1234", 1, "Weak", ["Avoid sequential patterns"]),
            ("Tr0ub4dor&3xyq", 3, "Strong", []),
            ("Fixture-Pässwort-2026!", 4, "Very strong", []),
            ("correcthorsebattery", 2, "Fair", ["Mix uppercase, lowercase, numbers, and symbols"]),
            ("password1234", 0, "Too weak", ["Avoid sequential patterns"]),
            ("qwertyuiopas", 1, "Weak", ["Mix uppercase, lowercase, numbers, and symbols"]),
            ("ABCDEFGHIJKLMNOP", 1, "Weak", ["Mix uppercase, lowercase, numbers, and symbols", "Avoid sequential patterns"]),
            ("zzzzzzzzzzzzzzzz9", 1, "Weak", ["Avoid repeated characters"]),
            ("P@ssw0rd!Long#2026", 4, "Very strong", []),
        ]
        for (password, score, label, feedback) in vectors {
            let result = BackupPasswordStrength.check(password)
            XCTAssertEqual(result.score, score, password)
            XCTAssertEqual(result.label, label, password)
            XCTAssertEqual(result.feedback, feedback, password)
        }
        XCTAssertTrue(BackupPasswordStrength.check("correcthorsebattery").isAcceptable)
        XCTAssertFalse(BackupPasswordStrength.check("Password1234").isAcceptable)
    }
}
