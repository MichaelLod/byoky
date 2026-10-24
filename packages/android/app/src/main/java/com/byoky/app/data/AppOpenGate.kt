package com.byoky.app.data

/**
 * What opening an installed app should do. Opening an app from the wallet
 * normally counts as consent to connect it. The exception is an origin the
 * user disconnected in Connected Apps: that app reconnects only after the
 * user confirms (MetaMask-style, same as the extension). An app that
 * disconnected itself was never revoked and opens as usual.
 *
 * Pure Kotlin, unit-tested on the JVM.
 */
object AppOpenGate {
    sealed class Decision {
        /** Open the app right away. */
        data object Open : Decision()

        /** The user revoked [app]'s origin: ask before reconnecting it. */
        data class ConfirmReconnect(val app: InstalledApp, val host: String) : Decision()
    }

    /** [revokedOrigins]: origins the user disconnected from the wallet. */
    fun decide(app: InstalledApp, revokedOrigins: Set<String>): Decision {
        val origin = app.origin
        if (origin !in revokedOrigins) return Decision.Open
        return Decision.ConfirmReconnect(app, host = origin.substringAfter("://"))
    }
}
