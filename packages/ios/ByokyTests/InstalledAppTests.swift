import XCTest
@testable import Byoky

/// Add-app-by-URL validation and the one-time legacy data cleanup.
final class InstalledAppTests: XCTestCase {

    // MARK: - URL normalization

    func testAcceptsHttpsURL() throws {
        let url = try InstalledApp.normalizedURL(from: "https://Chat.Example.com/app?x=1#/c")
        XCTAssertEqual(url.absoluteString, "https://chat.example.com/app?x=1#/c")
    }

    func testBareHostAssumesHttps() throws {
        let url = try InstalledApp.normalizedURL(from: "  example.com  ")
        XCTAssertEqual(url.absoluteString, "https://example.com/")
    }

    func testRejectsNonHttpsSchemes() {
        for input in ["http://example.com", "HTTP://example.com", "http:example.com",
                      "ftp://example.com", "file:///etc/passwd", "wss://example.com"] {
            XCTAssertThrowsError(try InstalledApp.normalizedURL(from: input), input) { error in
                XCTAssertEqual(error as? InstalledApp.AddError, .notHTTPS, input)
            }
        }
    }

    func testRejectsGarbageAndScriptURLs() {
        for input in ["javascript:alert(1)", "data:text/html,hi", "https://", "not a url", "https://user:pw@evil.com"] {
            XCTAssertThrowsError(try InstalledApp.normalizedURL(from: input), input) { error in
                XCTAssertEqual(error as? InstalledApp.AddError, .invalidURL, input)
            }
        }
    }

    func testRejectsEmptyInput() {
        XCTAssertThrowsError(try InstalledApp.normalizedURL(from: "   ")) { error in
            XCTAssertEqual(error as? InstalledApp.AddError, .empty)
        }
    }

    func testOriginKeepsNonDefaultPort() throws {
        let plain = try InstalledApp.normalizedURL(from: "https://example.com:443/x")
        XCTAssertEqual(InstalledApp.origin(of: plain), "https://example.com")
        let custom = try InstalledApp.normalizedURL(from: "localhost:8443/app")
        XCTAssertEqual(InstalledApp.origin(of: custom), "https://localhost:8443")
    }

    func testMakeDerivesNameAndIcon() throws {
        let app = try InstalledApp.make(from: "https://www.example.com/chat", name: "  ")
        XCTAssertEqual(app.name, "example.com")
        XCTAssertEqual(app.url, "https://www.example.com/chat")
        XCTAssertEqual(app.icon, "https://www.example.com/apple-touch-icon.png")
        XCTAssertTrue(app.enabled)

        let named = try InstalledApp.make(from: "example.com", name: " My App ")
        XCTAssertEqual(named.name, "My App")
    }

    func testDecodesEntriesSavedByOlderVersions() throws {
        let legacy = """
        [{"id":"a1","slug":"chat","name":"Chat","url":"https://chat.example.com","icon":"https://cdn.example.com/i.png",
          "description":"d","category":"chat","providers":["anthropic"],"authorName":"x","authorWebsite":null,
          "verified":true,"installedAt":700000000,"enabled":false}]
        """
        let apps = try JSONDecoder().decode([InstalledApp].self, from: Data(legacy.utf8))
        XCTAssertEqual(apps.first?.name, "Chat")
        XCTAssertEqual(apps.first?.enabled, false)
    }

    // MARK: - Legacy cleanup

    func testCleanupNeverTargetsPasswordOrCredentials() {
        for key in ["password_hash", "master_salt", "credentials", "key_123"] {
            XCTAssertTrue(LegacyDataCleanup.isProtected(key), key)
        }
        for key in LegacyDataCleanup.staleKeychainKeys {
            XCTAssertFalse(LegacyDataCleanup.isProtected(key), key)
            XCTAssertFalse(["sessions", "requestLog", "groups", "appGroups", "tokenAllowances"].contains(key), key)
        }
    }

    func testPurgeDeletesStaleEntriesAndPrunesPairedSessions() throws {
        let keychain = KeychainService.shared
        let suiteName = "byoky.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        // Preserve whatever the test host has stored under "sessions".
        let originalSessions = try? keychain.load(key: "sessions")
        defer {
            if let originalSessions {
                try? keychain.save(key: "sessions", data: originalSessions)
            } else {
                try? keychain.delete(key: "sessions")
            }
        }

        let protectedProbe = "key_legacyCleanupProbe"
        defer { try? keychain.delete(key: protectedProbe) }

        try keychain.saveString(key: "gifts", value: "[]")
        try keychain.saveString(key: "cloudVault_token", value: "stale")
        try keychain.saveString(key: protectedProbe, value: "v2:ciphertext")
        defaults.set(1.0, forKey: "vaultBannerDismissedAt")

        let installed = try InstalledApp.make(from: "https://chat.example.com", name: nil)
        defaults.set(try JSONEncoder().encode([installed]), forKey: "installedApps")
        let now = Date()
        let sessions = [
            Session(id: "1", appOrigin: "https://chat.example.com", sessionKey: "k1",
                    providers: [], createdAt: now, expiresAt: now.addingTimeInterval(60)),
            Session(id: "2", appOrigin: "https://desktop-paired.example.org", sessionKey: "k2",
                    providers: [], createdAt: now, expiresAt: now.addingTimeInterval(60)),
        ]
        try keychain.saveCodable(key: "sessions", value: sessions)

        XCTAssertTrue(LegacyDataCleanup.purge(defaults: defaults, keychain: keychain))

        XCTAssertThrowsError(try keychain.load(key: "gifts"))
        XCTAssertThrowsError(try keychain.load(key: "cloudVault_token"))
        XCTAssertNil(defaults.object(forKey: "vaultBannerDismissedAt"))
        XCTAssertEqual(try keychain.loadString(key: protectedProbe), "v2:ciphertext")
        let kept = try keychain.loadCodable(key: "sessions", as: [Session].self)
        XCTAssertEqual(kept.map(\.appOrigin), ["https://chat.example.com"])
    }

    func testRetiredNoticeOnlyForUsersOfRetiredFeatures() throws {
        let keychain = KeychainService.shared
        let originalSessions = try? keychain.load(key: "sessions")
        defer {
            if let originalSessions { try? keychain.save(key: "sessions", data: originalSessions) }
            try? keychain.delete(key: "giftedCredentials")
        }
        try? keychain.delete(key: "sessions")

        // Never used a retired feature: no notice, key stays absent.
        let cleanSuite = "byoky.tests.\(UUID().uuidString)"
        let clean = try XCTUnwrap(UserDefaults(suiteName: cleanSuite))
        defer { clean.removePersistentDomain(forName: cleanSuite) }
        LegacyDataCleanup.purge(defaults: clean, keychain: keychain)
        LegacyDataCleanup.runIfNeeded(defaults: clean, keychain: keychain)
        XCTAssertFalse(LegacyDataCleanup.shouldShowRetiredNotice(defaults: clean))
        XCTAssertNil(clean.object(forKey: LegacyDataCleanup.retiredNoticeDefaultsKey))

        // Had a received gift: notice is queued before the data is deleted.
        let usedSuite = "byoky.tests.\(UUID().uuidString)"
        let used = try XCTUnwrap(UserDefaults(suiteName: usedSuite))
        defer { used.removePersistentDomain(forName: usedSuite) }
        try keychain.saveString(key: "giftedCredentials", value: #"[{"giftId":"g1"}]"#)
        LegacyDataCleanup.runIfNeeded(defaults: used, keychain: keychain)
        XCTAssertTrue(LegacyDataCleanup.shouldShowRetiredNotice(defaults: used))
        XCTAssertThrowsError(try keychain.load(key: "giftedCredentials"))

        // Dismissed stays dismissed, even if a retry finds leftovers again.
        LegacyDataCleanup.dismissRetiredNotice(defaults: used)
        used.set(0, forKey: LegacyDataCleanup.versionDefaultsKey)
        try keychain.saveString(key: "giftedCredentials", value: #"[{"giftId":"g1"}]"#)
        LegacyDataCleanup.runIfNeeded(defaults: used, keychain: keychain)
        XCTAssertFalse(LegacyDataCleanup.shouldShowRetiredNotice(defaults: used))
    }

    func testRetiredNoticeShowsOnlyOnce() throws {
        let keychain = KeychainService.shared
        let originalSessions = try? keychain.load(key: "sessions")
        defer {
            if let originalSessions { try? keychain.save(key: "sessions", data: originalSessions) }
            try? keychain.delete(key: "giftedCredentials")
        }
        try? keychain.delete(key: "sessions")

        let suite = "byoky.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        try keychain.saveString(key: "giftedCredentials", value: #"[{"giftId":"g1"}]"#)
        LegacyDataCleanup.runIfNeeded(defaults: defaults, keychain: keychain)

        // Queued but not displayed yet (e.g. the wallet stayed locked): it
        // is still there on the next launch.
        XCTAssertTrue(LegacyDataCleanup.shouldShowRetiredNotice(defaults: defaults))
        LegacyDataCleanup.runIfNeeded(defaults: defaults, keychain: keychain)
        XCTAssertTrue(LegacyDataCleanup.shouldShowRetiredNotice(defaults: defaults))

        // Displayed once, never dismissed: gone on every later launch.
        LegacyDataCleanup.markRetiredNoticeShown(defaults: defaults)
        XCTAssertFalse(LegacyDataCleanup.shouldShowRetiredNotice(defaults: defaults))

        // Not even a cleanup retry that finds leftovers brings it back.
        defaults.set(0, forKey: LegacyDataCleanup.versionDefaultsKey)
        try keychain.saveString(key: "giftedCredentials", value: #"[{"giftId":"g1"}]"#)
        LegacyDataCleanup.runIfNeeded(defaults: defaults, keychain: keychain)
        XCTAssertFalse(LegacyDataCleanup.shouldShowRetiredNotice(defaults: defaults))
    }

    func testRunIfNeededRecordsVersion() throws {
        let keychain = KeychainService.shared
        let suiteName = "byoky.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        // The empty suite has no installed apps, so the cleanup would prune
        // every session — keep the test host's sessions intact.
        let originalSessions = try? keychain.load(key: "sessions")
        defer {
            if let originalSessions { try? keychain.save(key: "sessions", data: originalSessions) }
        }

        LegacyDataCleanup.runIfNeeded(defaults: defaults, keychain: keychain)
        XCTAssertEqual(defaults.integer(forKey: LegacyDataCleanup.versionDefaultsKey),
                       LegacyDataCleanup.currentVersion)
    }
}
