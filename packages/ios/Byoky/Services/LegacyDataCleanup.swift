import Foundation

/// One-time, best-effort removal of data left behind by features that no
/// longer exist: the cloud vault (account, sync metadata, vault-derived key),
/// gifts (sent, received, preferences) and relay pairing. Byoky is a purely
/// local wallet now, so this data is never read again — only deleted.
///
/// It never touches the master password hash, the master salt, the
/// credential list or any encrypted key (`key_<id>`). Those accounts are not
/// in the lists below, and `isProtected` filters them out regardless.
///
/// When the data shows the user actually used one of those features, a
/// one-time notice is queued for the Wallet screen before anything is deleted.
enum LegacyDataCleanup {
    /// Bump when another batch of retired keys is added.
    static let currentVersion = 1
    static let versionDefaultsKey = "byoky_legacyCleanupVersion"

    /// Tri-state: absent = never used a retired feature (no notice),
    /// true = notice pending (not shown yet), false = shown or dismissed.
    static let retiredNoticeDefaultsKey = "byoky_showRetiredFeaturesNotice"

    /// Keychain accounts written only by the retired features.
    static let staleKeychainKeys: [String] = [
        // Gifts
        "gifts",
        "giftedCredentials",
        "giftPreferences",
        // Cloud vault
        "cloudVault_enabled",
        "cloudVault_username",
        "cloudVault_lastUsername",
        "cloudVault_token",
        "cloudVault_sessionId",
        "cloudVault_tokenIssuedAt",
        "cloudVault_tokenExpired",
        "cloudVault_credentialMap",
        "cloudVault_credentialMeta",
        "cloudVault_lastSyncAt",
        "cloudVault_vaultKey",
    ]

    /// UserDefaults keys written only by the retired features.
    static let staleDefaultsKeys: [String] = [
        "vaultBannerDismissedAt",
    ]

    private static let protectedKeychainKeys: Set<String> = [
        "password_hash",
        "master_salt",
        "credentials",
    ]

    private static let sessionsKey = "sessions"
    private static let installedAppsKey = "installedApps"

    /// True for keychain accounts that hold the password data or credentials.
    static func isProtected(_ key: String) -> Bool {
        protectedKeychainKeys.contains(key) || key.hasPrefix("key_")
    }

    /// Run the cleanup once per `currentVersion`. When a keychain operation
    /// fails (for example because the device is locked), the version is not
    /// recorded and the cleanup simply runs again on the next launch.
    static func runIfNeeded(
        defaults: UserDefaults = .standard,
        keychain: KeychainService = .shared
    ) {
        guard defaults.integer(forKey: versionDefaultsKey) < currentVersion else { return }
        // Record the notice before deleting the evidence. Only ever set it
        // once, so a retry after a failed delete can't resurrect a notice
        // the user already dismissed.
        if defaults.object(forKey: retiredNoticeDefaultsKey) == nil,
           usedRetiredFeatures(defaults: defaults, keychain: keychain) {
            defaults.set(true, forKey: retiredNoticeDefaultsKey)
        }
        if purge(defaults: defaults, keychain: keychain) {
            defaults.set(currentVersion, forKey: versionDefaultsKey)
        }
    }

    // MARK: - Retired-features notice

    static func shouldShowRetiredNotice(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: retiredNoticeDefaultsKey)
    }

    static func dismissRetiredNotice(defaults: UserDefaults = .standard) {
        defaults.set(false, forKey: retiredNoticeDefaultsKey)
    }

    /// The notice was displayed. It is shown once: later launches skip it
    /// whether or not the user dismissed it. Recorded when it renders, not
    /// at launch, so a launch that never gets past the lock screen doesn't
    /// use it up unseen.
    static func markRetiredNoticeShown(defaults: UserDefaults = .standard) {
        defaults.set(false, forKey: retiredNoticeDefaultsKey)
    }

    /// True when the stored data shows the user had cloud sync turned on (or
    /// a vault account), had sent or received a gift, or had paired an app.
    static func usedRetiredFeatures(defaults: UserDefaults, keychain: KeychainService) -> Bool {
        if (try? keychain.loadString(key: "cloudVault_enabled")) == "true" { return true }
        for key in ["cloudVault_username", "cloudVault_lastUsername"] {
            if let username = try? keychain.loadString(key: key), !username.isEmpty { return true }
        }
        for key in ["gifts", "giftedCredentials"] {
            if let data = try? keychain.load(key: key),
               let list = try? JSONSerialization.jsonObject(with: data) as? [Any],
               !list.isEmpty {
                return true
            }
        }
        if let split = splitSessions(defaults: defaults, keychain: keychain),
           split.kept.count != split.all.count {
            return true
        }
        return false
    }

    /// Delete every retired entry. Returns false if a keychain operation
    /// failed for a reason other than "item not found".
    @discardableResult
    static func purge(
        defaults: UserDefaults = .standard,
        keychain: KeychainService = .shared
    ) -> Bool {
        var succeeded = true
        for key in staleKeychainKeys where !isProtected(key) {
            do {
                try keychain.delete(key: key)
            } catch {
                succeeded = false
            }
        }
        for key in staleDefaultsKeys {
            defaults.removeObject(forKey: key)
        }
        if !pruneRelayPairedSessions(defaults: defaults, keychain: keychain) {
            succeeded = false
        }
        return succeeded
    }

    /// Relay pairing stored each paired desktop app as a `Session` in the
    /// shared "sessions" keychain entry. The only other writer on iOS is the
    /// in-wallet browser, whose sessions always belong to an installed app, so
    /// a session whose origin matches no installed app came from relay pairing
    /// (or from an app that has since been removed) and is dropped.
    ///
    /// Leaves the entry untouched when it or the installed-app list can't be
    /// read; returns false only when writing the pruned list back fails.
    private static func pruneRelayPairedSessions(
        defaults: UserDefaults,
        keychain: KeychainService
    ) -> Bool {
        guard let split = splitSessions(defaults: defaults, keychain: keychain),
              split.kept.count != split.all.count else {
            return true
        }
        do {
            try keychain.saveCodable(key: sessionsKey, value: split.kept)
            return true
        } catch {
            return false
        }
    }

    /// All stored sessions plus the subset that belongs to an installed app.
    /// Nil when there are no sessions or either list can't be read.
    private static func splitSessions(
        defaults: UserDefaults,
        keychain: KeychainService
    ) -> (all: [Session], kept: [Session])? {
        guard let sessions = try? keychain.loadCodable(key: sessionsKey, as: [Session].self),
              !sessions.isEmpty else {
            return nil
        }

        var installedApps: [InstalledApp] = []
        if let data = defaults.data(forKey: installedAppsKey) {
            guard let decoded = try? JSONDecoder().decode([InstalledApp].self, from: data) else {
                return nil
            }
            installedApps = decoded
        }

        var appOrigins = Set<String>()
        for app in installedApps {
            guard let url = URL(string: app.url), let host = url.host else { continue }
            appOrigins.insert(InstalledApp.origin(of: url))
            // Older builds keyed in-wallet browser sessions by host only.
            appOrigins.insert("https://\(host)")
        }

        return (sessions, sessions.filter { appOrigins.contains($0.appOrigin) })
    }
}
